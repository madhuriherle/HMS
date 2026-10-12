import React, { useEffect, useRef, useState } from 'react';
import api from '../api';
import { notify } from '../utils/notify';
import { apiErrorMessage } from '../utils/apiError';
import useAuth from '../hooks/useAuth';
import PermissionGate from '../components/PermissionGate';

const SEP_LABEL = { '': 'None', '-': 'Dash ( - )', '/': 'Slash ( / )', '.': 'Dot ( . )' };

const HELP = {
  MEMBER_CODE: 'The permanent ID a member gets when approved.',
  MEMBERSHIP_NO: 'The number printed on the membership, given when the membership is approved.',
  RECEIPT: 'The receipt number. Receipt Entry pre-fills the next one.',
};

const labelCls = 'block text-xs font-semibold text-[#863221] mb-1';
const fieldCls =
  'w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#510601]/20 focus:border-[#510601] disabled:bg-[#FAF7F2] disabled:text-stone-400';

function FormatCard({ item, options, canWrite, onSaved }) {
  const [form, setForm] = useState(item);
  const [example, setExample] = useState(item.example);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const timer = useRef(null);

  const allowedDates = new Set(options.allowed_dates[form.restart] || []);
  const dirty = JSON.stringify({ ...form, example: '', next_number: '' }) !== JSON.stringify({ ...item, example: '', next_number: '' });

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Changing "restart" can make the chosen date invalid: move to the first date that is allowed.
  const setRestart = (restart) => {
    const ok = new Set(options.allowed_dates[restart] || []);
    const date_part = ok.has(form.date_part) ? form.date_part : options.date_parts.find((d) => ok.has(d.value))?.value;
    set({ restart, date_part });
  };

  // Live preview from the server (nothing is saved).
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const body = {
          prefix: form.prefix || '', date_part: form.date_part, separator: form.separator, digits: Number(form.digits),
          start_value: Number(form.start_value), restart: form.restart, suffix: form.suffix || '', allow_manual: form.allow_manual,
        };
        const { data } = await api.post(`/system/number-formats/${item.doc_type}/preview`, body);
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
      const { data } = await api.put(`/system/number-formats/${item.doc_type}`, {
        prefix: form.prefix || '', date_part: form.date_part, separator: form.separator, digits: Number(form.digits),
        start_value: Number(form.start_value), restart: form.restart, suffix: form.suffix || '', allow_manual: form.allow_manual,
      });
      if (data?.doc_type) {
        notify(`${item.label} format saved. New numbers will look like ${data.example}.`);
        onSaved(data);
      } else if (data?.approval_request_id) {
        notify('Sent for approval.');
      }
    } catch (e) {
      if (e?.isCancelled) return;
      notify(apiErrorMessage(e, 'Could not save the format.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white border border-[#E8DFD8] rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-[#180200]">{item.label}</h3>
          <p className="text-xs text-[#863221] mt-0.5">{HELP[item.doc_type]}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase font-semibold text-[#863221]">Example</p>
          <p className="font-mono text-base font-bold text-[#510601]">{example}</p>
          <p className="text-[11px] text-stone-500 mt-0.5">
            Next number now: <span className="font-mono">{item.next_number}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={labelCls}>Prefix</label>
          <input className={fieldCls} value={form.prefix || ''} maxLength={12} disabled={!canWrite}
            onChange={(e) => set({ prefix: e.target.value.toUpperCase() })} placeholder="e.g. HMS" />
        </div>
        <div>
          <label className={labelCls}>Restart counter</label>
          <select className={fieldCls} value={form.restart} disabled={!canWrite} onChange={(e) => setRestart(e.target.value)}>
            {options.restarts.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
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
        <div>
          <label className={labelCls}>Next number at least</label>
          <input type="number" min={1} className={fieldCls} value={form.start_value} disabled={!canWrite}
            onChange={(e) => set({ start_value: Number(e.target.value) })} />
        </div>
        <div>
          <label className={labelCls}>Suffix</label>
          <input className={fieldCls} value={form.suffix || ''} maxLength={12} disabled={!canWrite}
            onChange={(e) => set({ suffix: e.target.value.toUpperCase() })} placeholder="optional" />
        </div>
        {item.doc_type === 'RECEIPT' && (
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-[#180200] pb-2 cursor-pointer">
              <input type="checkbox" className="accent-[#510601]" checked={form.allow_manual} disabled={!canWrite}
                onChange={(e) => set({ allow_manual: e.target.checked })} />
              Allow typing a number by hand
            </label>
          </div>
        )}
      </div>

      {error && <p className="text-xs font-semibold text-red-700">{error}</p>}

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-[11px] text-stone-500">
          Only new numbers use this format. Numbers already issued do not change.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setForm(item)} disabled={!dirty || saving}
            className="px-4 py-2 text-xs font-semibold border border-[#E8DFD8] text-[#863221] rounded-xl hover:bg-[#FAF7F2] disabled:opacity-40 cursor-pointer">
            Reset
          </button>
          <button type="button" onClick={save} disabled={!canWrite || !dirty || saving || Boolean(error)}
            className="px-5 py-2 text-xs font-bold text-white bg-[#510601] rounded-xl hover:bg-[#3D0400] disabled:opacity-40 cursor-pointer">
            {saving ? 'Saving...' : 'Save format'}
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
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-bold text-[#180200]">Number Formats</h2>
          <p className="text-sm text-[#863221] mt-1">
            Choose how member IDs, membership numbers and receipt numbers look. The example updates as you change the options.
          </p>
        </div>
        {loadError && <p className="text-sm font-semibold text-red-700">{loadError}</p>}
        {!data && !loadError && <p className="text-sm text-[#863221]">Loading...</p>}
        {data?.data.map((item) => (
          <FormatCard
            key={item.doc_type}
            item={item}
            options={data.options}
            canWrite={hasPermission('system.write')}
            onSaved={load}
          />
        ))}
      </div>
    </PermissionGate>
  );
}
