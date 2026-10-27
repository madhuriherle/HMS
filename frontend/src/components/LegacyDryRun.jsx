import React, { useEffect, useRef, useState } from 'react';
import { Upload, Download, Loader2, FileSpreadsheet } from 'lucide-react';
import api from '../api';
import { notify } from '../utils/notify';

// What each count means, in the order the office reads them.
const LABELS = [
  ['members', 'Members in the file'],
  ['with_old_number', 'With an old number'],
  ['without_old_number', 'Without an old number'],
  ['expired', 'Expired'],
  ['deleted', 'Marked deleted (*)'],
  ['receipt_lines', 'Receipt lines'],
  ['receipts_to_import', 'Receipts that would be imported'],
  ['receipts_dummy_number', 'Dummy receipts (FY43-001 style)'],
  ['receipts_zero_amount', 'Receipts with a number but no amount'],
  ['receipts_shared_by_members', 'One receipt shared by several members'],
  ['receipts_wrong_date', 'Wrong dates (before 1943 or in the future), not imported'],
  ['receipts_no_date', 'Amounts with no date, not imported'],
  ['members_payment_mismatch', 'Members with a payment mismatch'],
  ['members_no_receipt', 'Members with no usable receipt'],
  ['duplicate_mobile_members', 'Members sharing a mobile number'],
  ['duplicate_name_members', 'Members sharing a name'],
  ['members_with_problems', 'Members with a problem to look at']
];

export default function LegacyDryRun() {
  const inputRef = useRef(null);
  const [job, setJob] = useState(null);
  const [state, setState] = useState(null); // the job as the server reports it
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!job || (state && state.status !== 'RUNNING')) return undefined;
    const timer = setInterval(async () => {
      try {
        const { data } = await api.get(`/members/legacy-import/dry-run/${job}`);
        setState(data);
        if (data.status !== 'RUNNING') setBusy(false);
      } catch {
        setBusy(false);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [job, state]);

  const start = async (file) => {
    if (!file) return;
    setBusy(true);
    setState(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/members/legacy-import/dry-run', form);
      setJob(data.job_id);
      setState({ status: 'RUNNING' });
    } catch (err) {
      setBusy(false);
      notify(err.response?.data?.detail || 'Could not start the check.', 'error');
    }
  };

  const download = async () => {
    const { data } = await api.get(`/members/legacy-import/dry-run/${job}/report`, { responseType: 'blob' });
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'old_register_dry_run.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const counts = state?.counts || {};
  return (
    <div className="bg-white border border-[#E8DFD8] rounded-2xl shadow-sm p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-[#180200] flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-[#863221]" /> Old register check (MstMember.xlsx)
          </h2>
          <p className="text-xs text-[#863221] mt-1">
            Reads the old register with its members, magazine and receipts and writes the reports. Nothing is saved: no member or receipt is created.
          </p>
        </div>
        <div>
          <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { start(e.target.files?.[0]); e.target.value = ''; }} />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#510601] hover:bg-[#8C1801] disabled:opacity-60 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {busy ? 'Checking, about a minute...' : 'Choose file and check'}
          </button>
        </div>
      </div>

      {state?.status === 'FAILED' && <p className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{state.error}</p>}

      {state?.status === 'DONE' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            {LABELS.map(([key, label]) => (
              <div key={key} className="flex items-baseline justify-between gap-3 border-b border-[#F1E9E2] py-1 text-xs">
                <span className="text-[#863221]">{label}</span>
                <b className="text-[#180200] tabular-nums">{(counts[key] ?? 0).toLocaleString('en-IN')}</b>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={download}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl bg-white border border-[#510601] text-[#510601] hover:bg-[#510601]/5 transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4" /> Download all reports (Excel)
          </button>
        </div>
      )}
    </div>
  );
}
