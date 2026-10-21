import React, { useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import { Download, Trash2, AlertTriangle } from 'lucide-react';
import api from '../api';
import PermissionGate from '../components/PermissionGate';
import PageTitle from '../components/PageTitle';
import { askReason } from '../utils/dialogs';
import { notify } from '../utils/notify';
import { apiErrorMessage } from '../utils/apiError';
import useAuth from '../hooks/useAuth';

// A group that needs others cleared with it (members -> receipts), followed through all levels.
const withRequired = (keys, groups) => {
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
  const out = new Set();
  const add = (k) => {
    if (out.has(k) || !byKey[k]) return;
    out.add(k);
    byKey[k].requires.forEach(add);
  };
  keys.forEach(add);
  return out;
};

export default function DataCleanup() {
  const canWrite = useAuth().hasPermission('system.cleanup.write');
  const [groups, setGroups] = useState([]);
  const [word, setWord] = useState('CLEAR');
  const [picked, setPicked] = useState(new Set());
  const [backup, setBackup] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/system/cleanup');
      setGroups(data.data);
      setWord(data.confirm_word);
      setError('');
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load the data groups.'));
    }
  };
  useEffect(() => { load(); }, []);

  const effective = withRequired([...picked], groups);
  const forced = (key) => effective.has(key) && !picked.has(key);
  const chosen = groups.filter((g) => effective.has(g.key));
  const rows = chosen.reduce((n, g) => n + g.rows, 0);

  const toggle = (key) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const downloadBackup = async (keys) => {
    const { data } = await api.get('/system/cleanup/backup', { params: { groups: keys.join(',') }, responseType: 'blob' });
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hms-backup-before-cleanup.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const clear = async () => {
    const keys = chosen.map((g) => g.key);
    const list = chosen.map((g) => `<li>${g.label} (${g.rows})</li>`).join('');
    const typed = await Swal.fire({
      title: 'Clear this data permanently?',
      html: `<div style="text-align:left;font-size:14px"><p style="margin-bottom:8px">This will delete <b>${rows}</b> rows from:</p><ul style="margin:0 0 12px 18px;list-style:disc">${list}</ul><p>Master setup data is kept. Type <b>${word}</b> to continue.</p></div>`,
      icon: 'warning',
      input: 'text',
      inputPlaceholder: word,
      showCancelButton: true,
      confirmButtonText: 'Continue',
      confirmButtonColor: '#ED4636',
      cancelButtonColor: '#863221',
      reverseButtons: true,
      allowOutsideClick: false,
      customClass: { popup: 'hms-mini-swal' },
      inputValidator: (v) => (v === word ? undefined : `Type ${word} exactly`),
    });
    if (!typed.isConfirmed) return;
    const reason = await askReason({ title: 'Reason for clearing', text: 'It is saved in the activity log.', confirmText: 'Clear data', danger: true });
    if (!reason) return;

    setBusy(true);
    try {
      if (backup) await downloadBackup(keys);
      const { data } = await api.post('/system/cleanup', { groups: keys, confirm_text: typed.value }, { params: { reason } });
      const done = Object.entries(data.cleared).map(([k, n]) => `${groups.find((g) => g.key === k)?.label}: ${n}`).join(', ');
      notify(`Cleared. ${done}${data.files_deleted ? `. ${data.files_deleted} uploaded files removed` : ''}`);
      setPicked(new Set());
      await load();
    } catch (e) {
      if (!e?.isCancelled) notify(apiErrorMessage(e, 'Could not clear the data.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const labelOf = (key) => groups.find((g) => g.key === key)?.label || key;

  return (
    <PermissionGate required="system.cleanup.read" minRank={0} title="Access Restricted" message="You do not have access to this page.">
      <div className="space-y-6 pb-12">
        <PageTitle>Data Cleanup</PageTitle>

        {/* Warning / Informational Alert Banner */}
        <div className="bg-[#FAF7F2] border border-[#E8DFD8] rounded-2xl p-4 flex items-start gap-3 shadow-xs">
          <div className="p-2 rounded-xl bg-amber-50 text-[#EE6A00] border border-amber-200 shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="text-xs text-[#863221] leading-relaxed">
            <p className="font-bold text-[#180200] text-sm mb-0.5">Irreversible Data Purge Control</p>
            <p>
              Selected operational data can be cleared permanently. Master configuration (Taluks, Districts, Banks, and Membership Types) will always remain safely preserved. An automated CSV backup ZIP is created before deletion.
            </p>
          </div>
        </div>

        {error && <p className="text-xs font-semibold text-[#8C1801]">{error}</p>}

        <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#FAF7F2] text-[11px] font-bold uppercase tracking-wider text-[#863221] border-b border-[#E8DFD8]">
                  <th className="py-3 pl-5 pr-2 w-10" />
                  <th className="py-3 px-3">Data group</th>
                  <th className="py-3 px-3">Rows</th>
                  <th className="py-3 px-3">What it clears</th>
                  <th className="py-3 px-3">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {groups.map((g) => {
                  const on = effective.has(g.key);
                  const empty = g.rows === 0 && !forced(g.key);
                  return (
                    <tr
                      key={g.key}
                      onClick={() => !empty && !forced(g.key) && canWrite && toggle(g.key)}
                      className={`hover:bg-[#FAF7F2]/60 transition-colors ${empty ? 'opacity-50' : 'cursor-pointer'} ${on ? 'bg-amber-50/50' : ''}`}
                    >
                      <td className="py-3 pl-5 pr-2 align-top">
                        <input
                          type="checkbox"
                          className="w-4 h-4 mt-0.5 cursor-pointer accent-[#510601] disabled:cursor-not-allowed"
                          checked={on}
                          disabled={empty || forced(g.key) || !canWrite}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggle(g.key)}
                          aria-label={`Clear ${g.label}`}
                        />
                      </td>
                      <td className="py-3 px-3 align-top font-bold text-[#180200] whitespace-nowrap">{g.label}</td>
                      <td className="py-3 px-3 align-top">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold font-mono ${
                          g.rows > 0 ? 'bg-amber-50 text-[#863221] border border-amber-200' : 'bg-[#FAF7F2] text-[#863221]/60 border border-[#E8DFD8]'
                        }`}>
                          {g.rows}
                        </span>
                      </td>
                      <td className="py-3 px-3 align-top text-xs text-[#863221] min-w-[18rem]">{g.description}</td>
                      <td className="py-3 px-3 align-top">
                        <div className="flex flex-wrap gap-1.5">
                          {g.requires.length > 0 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FAF7F2] border border-[#E8DFD8] text-[#510601]" title="Cleared together with this group">
                              Also clears {g.requires.map(labelOf).join(', ')}
                            </span>
                          )}
                          {forced(g.key) && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FAF7F2] border border-[#E8DFD8] text-[#510601]">Cleared along with your selection</span>}
                          {g.has_files && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FAF7F2] border border-[#E8DFD8] text-[#863221]" title="Uploaded files of these records are deleted from the server too">
                              <Trash2 className="w-3 h-3" /> Files deleted
                            </span>
                          )}
                          {g.warning && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 border border-rose-200 text-[#8C1801]" title={g.warning}>{on ? g.warning : 'Signs everyone out'}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_16px_-2px_rgba(24,2,0,0.08)] px-5 py-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-[#180200] cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-[#510601] cursor-pointer" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
            <Download className="w-4 h-4 text-[#863221]" /> Download a backup (CSV files) before clearing
          </label>
          <div className="flex items-center gap-4">
            <span className="text-xs font-semibold text-[#863221]">
              {chosen.length === 0 ? 'Nothing selected' : `${chosen.length} group${chosen.length > 1 ? 's' : ''} selected · ${rows} rows`}
            </span>
            {canWrite && (
              <button
                type="button"
                onClick={clear}
                disabled={busy || chosen.length === 0}
                className="px-4 py-2 rounded-xl bg-[#510601] hover:bg-[#3D0400] text-white text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-xs transition-colors"
              >
                {busy ? 'Clearing...' : 'Clear selected data'}
              </button>
            )}
          </div>
        </div>
      </div>
    </PermissionGate>
  );
}
