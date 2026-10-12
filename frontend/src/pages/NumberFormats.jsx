import React, { useEffect, useRef, useState } from 'react';
import api from '../api';
import { notify } from '../utils/notify';
import { apiErrorMessage } from '../utils/apiError';
import useAuth from '../hooks/useAuth';
import PermissionGate from '../components/PermissionGate';

const SEP_LABEL = { '': 'None', '-': '-', '/': '/', '.': '.' };

const labelCls = 'block text-[11px] font-semibold text-[#863221] mb-1';
const fieldCls =
  'w-full px-2.5 py-1.5 text-sm bg-white border border-[#E8DFD8] rounded-lg focus:outline-none focus:border-[#510601] disabled:bg-[#FAF7F2] disabled:text-stone-400';

const toBody = (f) => ({
  prefix: f.prefix || '', date_part: f.date_part, separator: f.separator, digits: Number(f.digits),
  start_value: Number(f.start_value), restart: f.restart, suffix: f.suffix || '', allow_manual: f.allow_manual,
});

function FormatCard({ item, options, canWrite, onSaved }) {
  const [form, setForm] = useState(item);
  const [example, setExample] = useState(item.example);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const timer = useRef(null);

  const allowedDates = new Set(options.allowed_dates[form.restart] || []);
  const dirty = JSON.stringify(toBody(form)) !== JSON.stringify(toBody(item));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // A restart rule only allows some dates in the number; move to one that is allowed.
  const setRestart = (restart) => {
    const ok = new Set(options.allowed_dates[restart] || []);
    set({ restart, date_part: ok.has(form.date_part) ? form.date_part : options.date_parts.find((d) => ok.has(d.value))?.value });
  };

  // Live example from the server (a GET: nothing is saved, nothing to confirm).
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const { data } = await api.get(`/system/number-formats/${item.doc_type}/preview`, { params: toBody(form) });
        setExample(data.example);
        setError('');
      } catch (e) {
        setError(apiErrorMessage(e, 'This combination is not allowed.'));
      }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [form, item.doc_type]);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`/system/number-formats/${item.doc_type}`, toBody(form));
      if (data?.doc_type) {
        notify(`${item.label} saved. New numbers look like ${data.example}.`);
        onSaved();
      } else if (data?.approval_request_id) {
        notify('Sent for approval.');
      }
    } catch (e) {
      if (!e?.isCancelled) notify(apiErrorMessage(e, 'Could not save.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white border border-[#E8DFD8] rounded-2xl px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-[#180200]">{item.label}</h3>
        <p className="text-sm text-[#863221]">
          <span className="font-mono font-bold text-[#510601] text-base">{example}</span>
          <span className="ml-3 text-xs">next: <span className="font-mono">{item.next_number}</span></span>
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
        <div>
          <label className={labelCls}>Prefix</label>
          <input className={fieldCls} value={form.prefix || ''} maxLength={12} disabled={!canWrite}
            onChange={(e) => set({ prefix: e.target.value.toUpperCase() })} />
        </div>
        <div className="col-span-2">
          <label className={labelCls}>Date in number</label>
          <select className={fieldCls} value={form.date_part} disabled={!canWrite} onChange={(e) => set({ date_part: e.target.value })}>
            {options.date_parts.map((d) => (
              <option key={d.value} value={d.value} disabled={!allowedDates.has(d.value)}>{d.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Separator</label>
          <select className={fieldCls} value={form.separator} disabled={!canWrite} onChange={(e) => set({ separator: e.target.value })}>
            {options.separators.map((s) => <option key={s} value={s}>{SEP_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Digits</label>
          <select className={fieldCls} value={form.digits} disabled={!canWrite} onChange={(e) => set({ digits: Number(e.target.value) })}>
            {[3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className={labelCls}>Restart</label>
          <select className={fieldCls} value={form.restart} disabled={!canWrite} onChange={(e) => setRestart(e.target.value)}>
            {options.restarts.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Min. next</label>
          <input type="number" min={1} className={fieldCls} value={form.start_value} disabled={!canWrite}
            onChange={(e) => set({ start_value: Number(e.target.value) })} />
        </div>
        <div>
          <label className={labelCls}>Suffix</label>
          <input className={fieldCls} value={form.suffix || ''} maxLength={12} disabled={!canWrite}
            onChange={(e) => set({ suffix: e.target.value.toUpperCase() })} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs">
          {item.doc_type === 'RECEIPT' && (
            <label className="inline-flex items-center gap-2 text-[#180200] cursor-pointer">
              <input type="checkbox" className="accent-[#510601]" checked={form.allow_manual} disabled={!canWrite}
                onChange={(e) => set({ allow_manual: e.target.checked })} />
              Allow typing a number by hand
            </label>
          )}
          {error && <span className="font-semibold text-red-700">{error}</span>}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setForm(item)} disabled={!dirty || saving}
            className="px-3.5 py-1.5 text-xs font-semibold border border-[#E8DFD8] text-[#863221] rounded-lg hover:bg-[#FAF7F2] disabled:opacity-40 cursor-pointer">
            Reset
          </button>
          <button type="button" onClick={save} disabled={!canWrite || !dirty || saving || Boolean(error)}
            className="px-4 py-1.5 text-xs font-bold text-white bg-[#510601] rounded-lg hover:bg-[#3D0400] disabled:opacity-40 cursor-pointer">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </section>
  );
}

export default function NumberFormats() {
  const { hasPermission } = useAuth();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');

  const load = async () => {
    try {
      const res = await api.get('/system/number-formats');
      setData(res.data);
    } catch (e) {
      setLoadError(apiErrorMessage(e, 'Could not load the number formats.'));
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <PermissionGate required="system.read">
      <div className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold text-[#180200]">Number Formats</h2>
          <p className="text-xs text-[#863221]">Applies to new numbers only.</p>
        </div>
        {loadError && <p className="text-sm font-semibold text-red-700">{loadError}</p>}
        {!data && !loadError && <p className="text-sm text-[#863221]">Loading...</p>}
        {data?.data.map((item) => (
          <FormatCard key={item.doc_type} item={item} options={data.options} canWrite={hasPermission('system.write')} onSaved={load} />
        ))}
      </div>
    </PermissionGate>
  );
}
