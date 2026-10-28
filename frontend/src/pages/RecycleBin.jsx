import FilterToggle from '../components/FilterToggle';
import React, { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Search, Trash2 } from 'lucide-react';
import api from '../api';
import PermissionGate from '../components/PermissionGate';
import Pager from '../components/Pager';
import { askReason } from '../utils/dialogs';
import { notify } from '../utils/notify';
import { apiErrorMessage } from '../utils/apiError';
import { formatDateTime } from '../utils/dateUtils';
import useAuth from '../hooks/useAuth';

const LIMIT = 25;

export default function RecycleBin() {
  const canWrite = useAuth().hasPermission('system.recycle_bin.write');
  const [rows, setRows] = useState([]);
  const [types, setTypes] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typed, setTyped] = useState('');
  const [entity, setEntity] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/system/recycle-bin', { params: { search, entity, page, limit: LIMIT } });
      setRows(data.data);
      setTypes(data.types);
      setTotal(data.total);
      setPages(data.pages);
      setError('');
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load the recycle bin.'));
    }
  }, [search, entity, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setSearch(typed.trim()); }, 300);
    return () => clearTimeout(t);
  }, [typed]);

  const allOnPage = rows.length > 0 && rows.every((r) => picked.has(r.key));
  const toggle = (key) => setPicked((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const toggleAll = () => setPicked((s) => {
    const n = new Set(s);
    rows.forEach((r) => (allOnPage ? n.delete(r.key) : n.add(r.key)));
    return n;
  });
  const chosen = rows.filter((r) => picked.has(r.key)).map((r) => ({ entity: r.entity, id: r.entity_id }));

  const report = (res, doneWord, count) => {
    const failed = res.failed || [];
    if (failed.length) {
      const why = failed.slice(0, 3).map((f) => `${f.name || f.key} - ${f.error}`).join(' | ');
      notify(`${count} ${doneWord}. ${failed.length} could not be done: ${why}`, count ? 'success' : 'error');
    } else {
      notify(`${count} ${doneWord}.${res.relinked_receipts ? ` ${res.relinked_receipts} receipt${res.relinked_receipts === 1 ? ' was' : 's were'} linked back to the restored member.` : ''}`);
    }
  };

  const run = async ({ url, body, title, text, confirmText, danger, doneWord, countKey }) => {
    const reason = await askReason({ title, text, confirmText, danger });
    if (!reason) return;
    setBusy(true);
    try {
      const { data } = await api.post(url, body, { params: { reason } });
      report(data, doneWord, data[countKey] || 0);
      setPicked(new Set());
      await load();
    } catch (e) {
      if (!e?.isCancelled) notify(apiErrorMessage(e, 'That did not work.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const plural = (n) => `${n} record${n === 1 ? '' : 's'}`;
  const restore = (items) => run({
    url: '/system/recycle-bin/restore', body: { items }, title: `Restore ${plural(items.length)}?`,
    text: 'They will appear again in their lists. Why are you restoring them?', confirmText: 'Restore', doneWord: 'restored', countKey: 'restored',
  });
  const purge = (items) => run({
    url: '/system/recycle-bin/purge', body: { items }, title: `Delete ${plural(items.length)} permanently?`,
    text: 'This cannot be undone. Why are you deleting them?', confirmText: 'Delete permanently', danger: true, doneWord: 'deleted', countKey: 'deleted',
  });
  const empty = () => run({
    url: '/system/recycle-bin/empty', body: { entity: entity || null },
    title: entity ? `Empty the recycle bin for ${types.find((t) => t.value === entity)?.label}?` : 'Empty the whole recycle bin?',
    text: 'Everything in it is deleted permanently. Records still used elsewhere are kept. Why are you emptying it?',
    confirmText: 'Empty recycle bin', danger: true, doneWord: 'deleted', countKey: 'deleted',
  });

  const all = types.reduce((n, t) => n + t.count, 0);
  const [filtersOpen, setFiltersOpen] = useState(false); // the type filter shows only when the filter icon is clicked

  return (
    <PermissionGate required="system.recycle_bin.read" title="Access Restricted" message="You need the Recycle Bin privilege to open this screen.">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap -mb-1">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#FFF1E0] text-[#C2570C] border border-[#F8D9B5]">Admin tool</span>
          {canWrite && (
            <button type="button" onClick={empty} disabled={busy || total === 0}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#ED4636] text-white text-sm font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">
              <Trash2 className="w-4 h-4" /> Empty Recycle Bin
            </button>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-[#E8DFD8] p-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 text-[#863221] absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search by name..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-[#FAF7F2] border border-[#E8DFD8] rounded-lg focus:outline-none focus:border-[#510601]" />
          </div>
          <div className="ml-auto flex items-center gap-3">
            {filtersOpen && (
              <label className="flex items-center gap-2 text-sm font-semibold text-[#180200]">
                Filter by Type:
                <select value={entity} onChange={(e) => { setPage(1); setEntity(e.target.value); setPicked(new Set()); }}
                  className="px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-lg">
                  <option value="">All Deleted Records ({all})</option>
                  {types.filter((t) => t.count > 0 || t.value === entity).map((t) => (
                    <option key={t.value} value={t.value}>{t.label} ({t.count})</option>
                  ))}
                </select>
              </label>
            )}
            <FilterToggle open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} count={entity ? 1 : 0} />
          </div>
        </div>

        {canWrite && picked.size > 0 && (
          <div className="flex items-center gap-3 bg-[#FAF1EE] border border-[#E8DFD8] rounded-xl px-4 py-2 text-sm">
            <span className="font-semibold">{picked.size} selected</span>
            <button type="button" disabled={busy} onClick={() => restore(chosen)} className="px-3 py-1 rounded-lg border border-emerald-600 text-emerald-700 font-semibold bg-white cursor-pointer">Restore</button>
            <button type="button" disabled={busy} onClick={() => purge(chosen)} className="px-3 py-1 rounded-lg border border-red-300 text-red-600 font-semibold bg-white cursor-pointer">Delete</button>
          </div>
        )}

        {error && <p className="text-sm font-semibold text-red-700">{error}</p>}

        <div className="bg-white rounded-2xl border border-[#E8DFD8] overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-[#863221] border-b border-[#E8DFD8]">
                <th className="p-3 w-10"><input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Select all on this page" /></th>
                <th className="p-3">Record name</th>
                <th className="p-3">Table / Type</th>
                <th className="p-3">Deleted at</th>
                <th className="p-3">Deleted by</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-[#F1E9E2] last:border-0 hover:bg-[#FAF7F2]">
                  <td className="p-3"><input type="checkbox" checked={picked.has(r.key)} onChange={() => toggle(r.key)} aria-label={`Select ${r.name}`} /></td>
                  <td className="p-3 font-bold text-[#180200]">{r.name}</td>
                  <td className="p-3"><span className="inline-block px-2.5 py-0.5 rounded-full border border-[#E8DFD8] bg-[#FAF7F2] text-[11px] font-bold uppercase tracking-wide text-[#510601]">{r.type}</span></td>
                  <td className="p-3 whitespace-nowrap">{r.deleted_at ? formatDateTime(r.deleted_at) : '-'}</td>
                  <td className="p-3">{r.deleted_by || '-'}</td>
                  <td className="p-3">
                    {canWrite && (
                      <div className="flex justify-end gap-2">
                        <button type="button" disabled={busy} onClick={() => restore([{ entity: r.entity, id: r.entity_id }])}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-600 text-emerald-700 text-xs font-bold cursor-pointer">
                          <RotateCcw className="w-3.5 h-3.5" /> Restore
                        </button>
                        <button type="button" disabled={busy} onClick={() => purge([{ entity: r.entity, id: r.entity_id }])}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 text-xs font-bold cursor-pointer">
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !error && (
                <tr><td colSpan={6} className="p-8 text-center text-[#863221]">The recycle bin is empty.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="p-4 bg-[#FAF7F2]/40 border-t border-[#E8DFD8] rounded-b-2xl">
            <Pager
              page={page}
              pages={pages}
              total={total}
              pageSize={LIMIT}
              onPage={setPage}
              onPageSize={() => {}}
              sizes={[LIMIT]}
            />
          </div>
        )}
      </div>
    </PermissionGate>
  );
}
