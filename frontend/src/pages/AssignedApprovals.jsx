import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, Check, Eye, Pencil } from 'lucide-react';
import api from '../api';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import { loadUnapprovedMembers } from '../utils/serverData';
import { confirmYesNo } from '../utils/dialogs';
import { notify } from '../utils/notify';
import { formatDate } from '../utils/dateUtils';
import { formatMoney } from '../utils/money';

const PAGE_SIZE = 25;
const inr = formatMoney;

// Final-approval queue: unapproved members whose receipt is already assigned.
// Approving gives the permanent membership number.
export default function AssignedApprovals() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canApprove = hasPermission('members.unapproved.write');

  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const all = await loadUnapprovedMembers();
      setMembers(all.filter((m) => m.receiptStatus === 'Assigned'));
    } catch (error) {
      notify(error.response?.data?.detail || 'Failed to load the list from the server.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) =>
      [m.fullName, m.name, m.mobile, m.id, m.assignedReceiptNumber, m.membershipType]
        .map((v) => String(v ?? '').toLowerCase())
        .some((v) => v.includes(q))
    );
  }, [members, query]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const allOnPage = rows.length > 0 && rows.every((m) => selected.has(m.id));

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      rows.forEach((m) => (allOnPage ? next.delete(m.id) : next.add(m.id)));
      return next;
    });

  const approve = async (list) => {
    if (!list.length || busy) return;
    const names = list.length === 1 ? list[0].fullName || list[0].name : `${list.length} members`;
    const ok = await confirmYesNo({
      title: `Approve ${names}?`,
      text: 'Each member gets their permanent membership number.',
      confirmText: 'Yes, approve'
    });
    if (!ok) return;
    setBusy(true);
    let done = 0;
    const failed = [];
    for (const m of list) {
      try {
        await api.put(`/members/${m.id}/approve`, null, { params: { reason: 'Approved from Assigned for Approval' } });
        done += 1;
      } catch (error) {
        failed.push(`${m.fullName || m.name}: ${error.response?.data?.detail || 'failed'}`);
      }
    }
    setBusy(false);
    setSelected(new Set());
    if (failed.length) notify(`Approved ${done}. ${failed.join('; ')}`, 'error');
    else notify(list.length === 1 ? `${names} approved.` : `${done} members approved.`);
    await load();
  };

  const chosen = members.filter((m) => selected.has(m.id));

  return (
    <PermissionGate required="members.unapproved.read">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl sm:text-2xl font-bold text-[#180200] tracking-tight">Assigned for Approval</h1>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <Search className="w-4 h-4 text-[#863221]/50 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search name, mobile, receipt…"
                className="w-full pl-9 pr-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs sm:text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
              />
            </div>
            <button
              type="button"
              onClick={() => approve(chosen)}
              disabled={!canApprove || chosen.length === 0 || busy}
              title={canApprove ? 'Approve the ticked members' : 'Requires members.unapproved.write permission'}
              className="disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-xl bg-[#510601] hover:bg-[#8C1801] text-white text-xs sm:text-sm font-bold shadow-sm transition-colors cursor-pointer inline-flex items-center gap-1.5 shrink-0"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Approve selected{chosen.length ? ` (${chosen.length})` : ''}</span>
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[760px]">
              <thead>
                <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-bold text-[#863221] uppercase tracking-wider">
                  <th className="py-3.5 pl-4 pr-0 w-8">
                    <input type="checkbox" checked={allOnPage} onChange={toggleAll} className="cursor-pointer accent-[#510601]" title="Select all on this page" />
                  </th>
                  <th className="py-3.5 px-4">Applicant</th>
                  <th className="py-3.5 px-4">Type</th>
                  <th className="py-3.5 px-4">Receipt</th>
                  <th className="py-3.5 px-4 text-right">Amount</th>
                  <th className="py-3.5 px-4">Mode</th>
                  <th className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8] text-xs sm:text-sm">
                {loading ? (
                  <tr>
                    <td colSpan="7" className="py-12 text-center text-[#863221]">Loading…</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="py-12 text-center">
                      <p className="font-semibold text-sm text-[#180200]">Nothing waiting for approval</p>
                      <p className="text-xs text-[#863221] mt-1">Members appear here once a receipt is assigned to them.</p>
                    </td>
                  </tr>
                ) : (
                  rows.map((m) => (
                    <tr key={m.id} className="bg-white hover:bg-[#FAF7F2] transition-colors text-[#180200]">
                      <td className="py-3.5 pl-4 pr-0">
                        <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} className="cursor-pointer accent-[#510601]" />
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-bold">{m.fullName || m.name}</span>
                        <div className="text-[11px] font-mono text-[#863221] mt-0.5">
                          MID {m.id}
                          {m.mobile ? ` · ${m.mobile}` : ''}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-xs font-semibold text-[#510601]">{m.membershipType || '—'}</td>
                      <td className="py-3.5 px-4">
                        <span className="font-mono font-bold text-xs text-[#510601]">#{m.assignedReceiptNumber}</span>
                        <div className="text-[11px] text-[#863221] mt-0.5">{formatDate(m.receipt?.receiptDate)}</div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-xs whitespace-nowrap">{inr(m.receipt?.amount)}</td>
                      <td className="py-3.5 px-4 text-xs">{m.receipt?.paymentMode || '—'}</td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => navigate(`/dashboard/membership/profile/${m.id}`)}
                          className="btn-act"
                          title="View"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/dashboard/membership/edit/${m.id}`, { state: { returnPath: '/dashboard/membership/assigned' } })}
                          disabled={!hasPermission('members.list.write')}
                          className="btn-act"
                          title={hasPermission('members.list.write') ? 'Edit Application' : 'Requires members.list.write permission'}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => approve([m])}
                          disabled={!canApprove || busy}
                          title={canApprove ? 'Approve and give the permanent membership number' : 'Requires members.unapproved.write permission'}
                          className="btn-act btn-act-ok"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Approve</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {filtered.length > PAGE_SIZE && (
            <div className="px-5 py-3 bg-[#FAF7F2] border-t border-[#E8DFD8] flex items-center justify-between text-xs text-[#863221]">
              <span>
                Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <span>
                  Page {page} of {pages}
                </span>
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-md border border-[#E8DFD8] bg-white disabled:opacity-40 cursor-pointer">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-md border border-[#E8DFD8] bg-white disabled:opacity-40 cursor-pointer">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </PermissionGate>
  );
}
