import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Check, Eye, Pencil } from 'lucide-react';
import api from '../api';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import { loadUnapprovedPage } from '../utils/serverData';
import { fetchReceiptRow } from '../utils/apiAdapters';
import ReceiptViewModal from '../components/ReceiptViewModal';
import Pager from '../components/Pager';
import { confirmYesNo } from '../utils/dialogs';
import { notify } from '../utils/notify';
import { formatDate } from '../utils/dateUtils';
import { formatMoney } from '../utils/money';

const inr = formatMoney;

// Final-approval queue: unapproved members whose receipt is already assigned.
// Approving gives the permanent membership number.
export default function AssignedApprovals() {
  const navigate = useNavigate();
  const [viewingReceipt, setViewingReceipt] = useState(null); // the receipt open in the shared receipt popup
  const openReceipt = async (m) => {
    try {
      setViewingReceipt((await fetchReceiptRow({ id: m.receipt?.id, number: m.assignedReceiptNumber, memberId: m.id })) || m.receipt || null);
    } catch (error) {
      notify('Could not open this receipt.', 'error');
    }
  };
  const { hasPermission } = useAuth();
  const canApprove = hasPermission('members.assigned.write');

  const [members, setMembers] = useState([]); // ONE page (at most 200); the rest stays on the server
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [busy, setBusy] = useState(false);
  const selectedCache = useRef(new Map()); // id -> row, so a ticked applicant from another page still approves
  const requestSeq = useRef(0);

  // the members whose receipt is mapped, one page at a time; the search runs on all of them (rule 10.6)
  const load = async () => {
    const seq = (requestSeq.current += 1);
    setLoading(true);
    try {
      const result = await loadUnapprovedPage({
        receipt_assigned: true, page, limit: pageSize,
        ...(debouncedQuery.trim() ? { search: debouncedQuery.trim() } : {}),
      });
      if (seq !== requestSeq.current) return;
      setMembers(result.rows);
      setTotal(result.total);
      setPages(Math.max(1, result.pages));
      if (page > Math.max(1, result.pages)) setPage(Math.max(1, result.pages));
    } catch (error) {
      if (seq !== requestSeq.current) return;
      notify(error.response?.data?.detail || 'Failed to load the list from the server.', 'error');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, debouncedQuery]);
  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, pageSize]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const rows = members; // the server already searched and paged them
  const allOnPage = rows.length > 0 && rows.every((m) => selected.has(m.id));

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        const row = members.find((m) => m.id === id);
        if (row) selectedCache.current.set(id, row);
      }
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      rows.forEach((m) => {
        if (allOnPage) next.delete(m.id);
        else { next.add(m.id); selectedCache.current.set(m.id, m); }
      });
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

  const chosen = [...selected].map((id) => selectedCache.current.get(id)).filter(Boolean);

  return (
    <PermissionGate required="members.assigned.read">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-end gap-3 -mb-2">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <Search className="w-4 h-4 text-[#863221]/50 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, mobile, receipt…"
                className="w-full pl-9 pr-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs sm:text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
              />
            </div>
            {canApprove && (
              <button
                type="button"
                onClick={() => approve(chosen)}
                disabled={chosen.length === 0 || busy}
                title={'Approve the ticked members'}
                className="disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-xl bg-[#510601] hover:bg-[#8C1801] text-white text-xs sm:text-sm font-bold shadow-sm transition-colors cursor-pointer inline-flex items-center gap-1.5 shrink-0"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Approve selected{chosen.length ? ` (${chosen.length})` : ''}</span>
              </button>
            )}
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
                          ID: {m.id}
                          {m.mobile ? ` · ${m.mobile}` : ''}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-xs font-semibold text-[#510601]">{m.membershipType || '—'}</td>
                      <td className="py-3.5 px-4">
                        <button
                          type="button"
                          onClick={() => openReceipt(m)}
                          className="font-mono font-bold text-xs text-[#510601] underline decoration-dotted underline-offset-2 hover:text-[#8C1801] cursor-pointer"
                          title="View this receipt"
                        >
                          {m.assignedReceiptNumber}
                        </button>
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
                        {hasPermission('members.list.write') && (
                          <button
                            type="button"
                            onClick={() => navigate(`/dashboard/membership/edit/${m.id}`, { state: { returnPath: '/dashboard/membership/assigned' } })}
                            className="btn-act"
                            title={hasPermission('members.list.write') ? 'Edit Application' : 'Requires members.list.write permission'}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                        )}
                        {canApprove && (
                          <button
                            type="button"
                            onClick={() => approve([m])}
                            disabled={busy}
                            title={'Approve and give the permanent membership number'}
                            className="btn-act btn-act-ok"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Approve</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {total > 0 && (
            <div className="px-5 py-3 bg-[#FAF7F2] border-t border-[#E8DFD8]">
              <Pager page={page} pages={pages} total={total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
            </div>
          )}
        </div>
      </div>
      <ReceiptViewModal receipt={viewingReceipt} onClose={() => setViewingReceipt(null)} />
    </PermissionGate>
  );
}
