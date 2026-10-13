import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import { AlertTriangle, ArrowLeft, Download } from 'lucide-react';
import api from '../api';
import PermissionGate from '../components/PermissionGate';
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
  const navigate = useNavigate();
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

  return (
    <PermissionGate required="system.cleanup.read" minRank={1} title="Access Restricted" message="Data Cleanup needs its privilege and a rank 1 role.">
      <div className="space-y-4 max-w-5xl">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate('/dashboard/settings')} aria-label="Back to System Settings"
            className="w-10 h-10 rounded-full bg-white border border-[#E8DFD8] flex items-center justify-center text-[#180200] hover:bg-[#FAF7F2] cursor-pointer">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-[#180200] tracking-tight">Data Cleanup</h1>
        </div>

        <div className="bg-white rounded-2xl border border-[#E8DFD8] p-5 flex items-start gap-4">
          <span className="w-12 h-12 rounded-xl bg-[#FAF1EE] text-[#ED4636] flex items-center justify-center shrink-0"><AlertTriangle className="w-6 h-6" /></span>
          <div>
            <h2 className="text-lg font-bold text-[#180200]">Clear only operational records</h2>
            <p className="text-sm text-[#863221]">Select operational data to clear. Master setup data stays protected. Cleared rows cannot be brought back.</p>
          </div>
        </div>

        {error && <p className="text-sm font-semibold text-red-700">{error}</p>}

        <div className="bg-white rounded-2xl border border-[#E8DFD8] overflow-hidden">
          <div className="grid grid-cols-[1fr_2fr_auto] gap-4 px-5 py-3 bg-[#FAF7F2] text-xs font-bold uppercase tracking-widest text-[#863221]">
            <span>Data group</span><span>Description</span><span>Clear</span>
          </div>
          {groups.map((g) => (
            <label key={g.key} className="grid grid-cols-[1fr_2fr_auto] gap-4 px-5 py-4 border-t border-[#F1E9E2] items-center cursor-pointer hover:bg-[#FAF7F2]/60">
              <span className="font-bold text-[#180200]">
                {g.label}
                <span className="block text-xs font-normal text-[#863221] mt-0.5">{g.rows} rows{forced(g.key) ? ' - cleared along with your selection' : ''}</span>
              </span>
              <span className="text-sm text-[#180200]/70">
                {g.description}
                {g.has_files && <span className="block text-xs text-[#863221] mt-1">Uploaded files of these records are deleted from the server too.</span>}
                {g.warning && effective.has(g.key) && <span className="block text-xs font-semibold text-[#ED4636] mt-1">{g.warning}</span>}
              </span>
              <input type="checkbox" className="w-5 h-5" checked={effective.has(g.key)} disabled={forced(g.key)} onChange={() => toggle(g.key)} aria-label={`Clear ${g.label}`} />
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-[#180200]">
            <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
            <Download className="w-4 h-4 text-[#863221]" /> Download a backup (CSV files) before clearing
          </label>
          {canWrite && (
            <button type="button" onClick={clear} disabled={busy || chosen.length === 0}
              className="px-5 py-2.5 rounded-xl bg-[#ED4636] text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
              {busy ? 'Clearing...' : `Clear selected data${rows ? ` (${rows} rows)` : ''}`}
            </button>
          )}
        </div>
      </div>
    </PermissionGate>
  );
}
