import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, Inbox } from 'lucide-react';
import api from '../api';
import { formatDateTime } from '../utils/dateUtils';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import { askReason, confirmYesNo, showError, showSuccess } from '../utils/dialogs';

// Every kind of request that waits for a reviewer. All data and all actions are server calls.
const KINDS = [
  {
    key: 'requests',
    label: 'Change requests',
    path: '/approvals/requests',
    summary: (r) => `${r.action} ${r.entity_type}${r.entity_id ? ` #${r.entity_id}` : ''} (${r.module})`,
    detail: (r) => (r.payload ? JSON.stringify(r.payload) : r.error || '')
  },
  {
    key: 'deletions',
    label: 'Member deletions',
    path: '/approvals/deletion-requests',
    summary: (r) => `Delete member #${r.member_id} (${r.deletion_type})`,
    detail: (r) => r.reason || ''
  },
  {
    key: 'profile',
    label: 'Profile changes',
    path: '/approvals/profile-changes',
    summary: (r) => `Profile change for member #${r.member_id}`,
    detail: (r) => (r.new_values ? JSON.stringify(r.new_values) : '')
  },
  {
    key: 'types',
    label: 'Membership type changes',
    path: '/approvals/type-changes',
    summary: (r) => `Member #${r.member_id}: change to membership type #${r.requested_type_id}`,
    detail: (r) => r.reason || ''
  }
];


const badge = (status) =>
  status === 'APPROVED'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'REJECTED'
      ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-amber-50 text-amber-700 border-amber-200';

export default function Approvals() {
  const { hasPermission } = useAuth();
  const [kindKey, setKindKey] = useState('requests');
  const status = 'PENDING'; // the queue only lists requests still waiting for a reviewer
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const kind = KINDS.find((k) => k.key === kindKey);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { limit: 200 };
      if (status !== 'ALL') params.status = status;
      const res = await api.get(kind.path, { params });
      setRows(res.data?.data || []);
    } catch (err) {
      setRows([]);
      setError(err.response?.data?.detail || 'Failed to load requests from the server.');
    } finally {
      setLoading(false);
    }
  }, [kind.path, status]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (row) => {
    const ok = await confirmYesNo({
      title: 'Approve this request?',
      text: kind.summary(row),
      confirmText: 'Yes, approve'
    });
    if (!ok) return;
    try {
      await api.put(`${kind.path}/${row.id}/approve`);
      await showSuccess('Request approved.');
      await load();
    } catch (err) {
      await showError(err, 'Could not approve the request.');
      await load();
    }
  };

  const reject = async (row) => {
    const note = await askReason({
      title: 'Reject this request?',
      text: kind.summary(row),
      confirmText: 'Yes, reject',
      danger: true
    });
    if (!note) return;
    try {
      await api.put(`${kind.path}/${row.id}/reject`, null, { params: { note } });
      await showSuccess('Request rejected.');
      await load();
    } catch (err) {
      await showError(err, 'Could not reject the request.');
    }
  };

  return (
    <PermissionGate required="members.approvals.read">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#180200] tracking-tight">Approvals</h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => setKindKey(k.key)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer transition-colors ${
                  kindKey === k.key
                    ? 'bg-[#510601] text-white border-[#510601]'
                    : 'bg-white text-[#510601] border-[#E8DFD8] hover:bg-[#FAF7F2]'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

        <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">#</th>
                  <th className="py-3 px-4">Request</th>
                  <th className="py-3 px-4">Details</th>
                  <th className="py-3 px-4">Requested</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-[#863221]/70">
                      <div className="flex flex-col items-center gap-2">
                        <Inbox className="w-7 h-7" />
                        <span>{loading ? 'Loading…' : 'No requests found.'}</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="hover:bg-[#FAF7F2]/40">
                      <td className="py-3 px-4 font-mono text-[#510601]">{r.id}</td>
                      <td className="py-3 px-4 font-semibold text-[#180200]">{kind.summary(r)}</td>
                      <td className="py-3 px-4 max-w-[320px] truncate text-[#863221]" title={kind.detail(r)}>
                        {kind.detail(r) || '—'}
                      </td>
                      <td className="py-3 px-4 text-[#863221]">
                        {formatDateTime(r.created_at, '—', false)}
                        {r.requested_by ? <div className="text-[10px]">by user #{r.requested_by}</div> : null}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${badge(r.status)}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {r.status === 'PENDING' ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => approve(r)}
                              disabled={!hasPermission('approvals.write')}
                              title={!hasPermission('approvals.write') ? 'Requires approvals.write permission' : 'Approve'}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-white bg-[#3D705C] hover:bg-[#2e5646] rounded-lg cursor-pointer disabled:opacity-40"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Approve</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => reject(r)}
                              disabled={!hasPermission('approvals.write')}
                              title={!hasPermission('approvals.write') ? 'Requires approvals.write permission' : 'Reject'}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-[#ED4636] bg-white border border-red-200 hover:bg-red-50 rounded-lg cursor-pointer disabled:opacity-40"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Reject</span>
                            </button>
                          </div>
                        ) : (
                          <div className="text-right text-[#863221]/70">{r.review_note || ''}</div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PermissionGate>
  );
}
