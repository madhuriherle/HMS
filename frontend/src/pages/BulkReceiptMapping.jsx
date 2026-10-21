import React, { useState, useEffect } from 'react';
import Pager from '../components/Pager';
import FilterToggle from '../components/FilterToggle';
import { Link } from 'react-router-dom';
import { CheckCircle2, Search, Loader2, Sparkles, Filter, X } from 'lucide-react';
import api from '../api';
import { notify } from '../utils/notify';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import { formatDate } from '../utils/dateUtils';
import Modal from '../components/Modal';
import { formatMoney } from '../utils/money';


import ModalFooter from '../components/ModalFooter';
import { memberName } from '../utils/memberName';
export default function BulkReceiptMapping() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('receipts.bulk_mapping.write');

  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState([]);
  const [totalUnassigned, setTotalUnassigned] = useState(0);
  const [totalMatched, setTotalMatched] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState('ALL'); // 'ALL' | 'MATCHED' | 'UNMATCHED'

  // Selection for batch actions
  const [selectedReceiptIds, setSelectedReceiptIds] = useState(new Set());
  const selectionMode = true; // the checkboxes are always showing (matched receipts only)
  const [isAllocating, setIsAllocating] = useState(false);

  // Manual Member Selection Modal for unmatched receipts
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [activeReceiptForManual, setActiveReceiptForManual] = useState(null);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [memberSearchResults, setMemberSearchResults] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [memberPage, setMemberPage] = useState(1);
  const [memberPages, setMemberPages] = useState(1);
  const [memberTotal, setMemberTotal] = useState(0);
  const [searchingMembers, setSearchingMembers] = useState(false);

  const fetchCandidates = async () => {
    setLoading(true);
    try {
      // one page of the waiting receipts; the search and the filter run on all of them (rule 10.6)
      const params = { page, limit: pageSize };
      if (debouncedQuery.trim()) params.search = debouncedQuery.trim();
      if (filterTab !== 'ALL') params.filter_type = filterTab;

      const { data } = await api.get('/receipts/unassigned-candidates', { params });
      setCandidates(data?.candidates || []);
      setTotalUnassigned(data?.total_unassigned || 0);
      setTotalMatched(data?.total_matched || 0);
      setTotal(data?.total || 0);
      setPages(Math.max(1, data?.pages || 1));
      setSelectedReceiptIds(new Set());
    } catch (err) {
      console.error(err);
      notify(err.response?.data?.detail || 'Could not load unassigned receipts', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTab, page, pageSize, debouncedQuery]);
  useEffect(() => {
    setPage(1);
  }, [filterTab, pageSize, debouncedQuery]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setDebouncedQuery(searchQuery);
  };

  // Toggle selection
  const toggleSelectReceipt = (id) => {
    const next = new Set(selectedReceiptIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedReceiptIds(next);
  };

  // Select all visible candidates that have a matched member
  const handleSelectAllMatched = () => {
    const matchedIds = candidates
      .filter((c) => c.matched_member)
      .map((c) => c.receipt_id);
    setSelectedReceiptIds(new Set(matchedIds));
  };

  const handleClearSelection = () => {
    setSelectedReceiptIds(new Set());
  };

  // 1-Click Bulk Auto-Map for all matched receipts
  const handleBulkAutoMapAll = async () => {
    setIsAllocating(true);
    try {
      const matchItems = [];
      for (let n = 1; n <= 500; n += 1) {
        const { data: chunk } = await api.get('/receipts/unassigned-candidates', { params: { filter_type: 'MATCHED', page: n, limit: 200 } });
        (chunk?.candidates || []).forEach((c) => {
          if (c.matched_member) matchItems.push({ receipt_id: c.receipt_id, member_id: c.matched_member.id, allocated_amount: c.net_amount });
        });
        if (n >= (chunk?.pages || 1)) break;
      }
      if (matchItems.length === 0) {
        notify('No matched receipts available to map.', 'error');
        return;
      }
      let mapped = 0;
      for (let i = 0; i < matchItems.length; i += 200) {
        const { data } = await api.post('/receipts/bulk-allocate', { allocations: matchItems.slice(i, i + 200) });
        mapped += data?.allocated_count || 0;
      }

      notify(
        `Successfully auto-mapped ${mapped || matchItems.length} receipts to their respective members!`,
        'success'
      );
      await fetchCandidates();
    } catch (err) {
      console.error(err);
      notify(err.response?.data?.detail || 'Error allocating receipts in bulk', 'error');
    } finally {
      setIsAllocating(false);
    }
  };

  // Map selected receipts
  const handleMapSelected = async () => {
    if (selectedReceiptIds.size === 0) return;

    const itemsToMap = candidates
      .filter((c) => selectedReceiptIds.has(c.receipt_id) && c.matched_member)
      .map((c) => ({
        receipt_id: c.receipt_id,
        member_id: c.matched_member.id,
        allocated_amount: c.net_amount
      }));

    if (itemsToMap.length === 0) {
      notify('None of the selected receipts have a matched member.', 'error');
      return;
    }

    setIsAllocating(true);
    try {
      const { data } = await api.post('/receipts/bulk-allocate', {
        allocations: itemsToMap
      });

      notify(`Successfully mapped ${data?.allocated_count} selected receipt(s)!`, 'success');
      await fetchCandidates();
    } catch (err) {
      console.error(err);
      notify(err.response?.data?.detail || 'Error mapping selected receipts', 'error');
    } finally {
      setIsAllocating(false);
    }
  };

  // Map single candidate row
  const handleMapSingle = async (candidate) => {
    if (!candidate.matched_member) return;

    setIsAllocating(true);
    try {
      await api.post('/receipts/bulk-allocate', {
        allocations: [
          {
            receipt_id: candidate.receipt_id,
            member_id: candidate.matched_member.id,
            allocated_amount: candidate.net_amount
          }
        ]
      });

      notify(`Receipt ${candidate.receipt_number} mapped to ${candidate.matched_member.name}!`, 'success');
      await fetchCandidates();
    } catch (err) {
      console.error(err);
      notify(err.response?.data?.detail || 'Error mapping receipt', 'error');
    } finally {
      setIsAllocating(false);
    }
  };

  // Manual member search
  const searchMembers = async (q, pageNo = 1) => {
    if (!q || q.trim().length < 1) {
      setMemberSearchResults([]);
      setMemberTotal(0);
      setMemberPages(1);
      setMemberPage(1);
      return;
    }
    setSearchingMembers(true);
    try {
      const { data } = await api.get('/members/', { params: { search: q.trim(), page: pageNo, limit: 25 } });
      const list = data?.data || data?.members || data || [];
      setMemberSearchResults(Array.isArray(list) ? list : []);
      setMemberTotal(data?.total || 0);
      setMemberPages(Math.max(1, data?.pages || 1));
      setMemberPage(pageNo);
    } catch (err) {
      console.error(err);
    } finally {
      setSearchingMembers(false);
    }
  };

  const handleOpenManualModal = (cand) => {
    setActiveReceiptForManual(cand);
    setMemberSearchQuery(cand.payer_membership_no || cand.payer_name || '');
    setMemberSearchResults([]);
    setMemberTotal(0);
    setMemberPage(1);
    setManualModalOpen(true);
    if (cand.payer_membership_no || cand.payer_name) {
      searchMembers(cand.payer_membership_no || cand.payer_name);
    }
  };

  const handleAssignManualMember = async (member) => {
    if (!activeReceiptForManual) return;
    setIsAllocating(true);
    try {
      await api.post('/receipts/bulk-allocate', {
        allocations: [
          {
            receipt_id: activeReceiptForManual.receipt_id,
            member_id: member.id,
            allocated_amount: activeReceiptForManual.net_amount
          }
        ]
      });

      notify(`Receipt ${activeReceiptForManual.receipt_number} mapped to ${member.name || memberName(member)}!`, 'success');
      setManualModalOpen(false);
      await fetchCandidates();
    } catch (err) {
      console.error(err);
      notify(err.response?.data?.detail || 'Error allocating receipt', 'error');
    } finally {
      setIsAllocating(false);
    }
  };

  // Calculate statistics



  return (
    <PermissionGate required={['receipts.tracking.read', 'receipts.read']} title="Access Restricted" message="You need permission to track receipts to access Bulk Mapping.">
      <div className="space-y-6">

        {/* Action row: the filter icon, then the bulk buttons; the search and the filter tabs open in a card below it */}
        <div className="flex flex-wrap items-center justify-end gap-2 -mb-2">
          <FilterToggle open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} count={(filterTab !== 'ALL' ? 1 : 0) + (debouncedQuery.trim() ? 1 : 0)} />
          {totalMatched > 0 && (
            canWrite && (
              <button
                type="button"
                disabled={isAllocating}
                onClick={handleBulkAutoMapAll}
                title={"Link every receipt whose membership number matches a member"}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#3D705C] hover:bg-[#2d5445] text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isAllocating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 text-emerald-200" />
                )}
                Map all matched ({totalMatched})
              </button>
            )
          )}

          {canWrite && selectionMode && selectedReceiptIds.size > 0 && (
            <button
              type="button"
              disabled={isAllocating}
              onClick={handleMapSelected}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#510601] hover:bg-[#863221] text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer disabled:opacity-50"
            >
              Map Selected ({selectedReceiptIds.size})
            </button>
          )}
    
        </div>

        {filtersOpen && (
          <div className="bg-white border border-[#E8DFD8] rounded-2xl shadow-sm p-4">
          <div className="flex flex-col lg:flex-row lg:items-center gap-4">
            {/* Search Input */}
            <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-[#863221]/60 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search receipt #, payer name, member #, mobile..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl text-[#180200] placeholder-[#863221]/40 focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
                />
              </div>
              <button
                type="submit"
                className="px-3 py-2 bg-[#510601] text-white text-xs font-semibold rounded-xl hover:bg-[#863221] transition-colors cursor-pointer"
              >
                Search
              </button>
            </form>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1.5 p-1 bg-[#FAF7F2] rounded-xl border border-[#E8DFD8]">
              <button
                type="button"
                onClick={() => setFilterTab('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  filterTab === 'ALL' ? 'bg-white shadow-sm text-[#180200]' : 'text-[#863221] hover:text-[#180200]'
                }`}
              >
                All ({totalUnassigned})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('MATCHED')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  filterTab === 'MATCHED' ? 'bg-white shadow-sm text-[#3D705C]' : 'text-[#863221] hover:text-[#180200]'
                }`}
              >
                Matched ({totalMatched})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('UNMATCHED')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  filterTab === 'UNMATCHED' ? 'bg-white shadow-sm text-[#863221]' : 'text-[#863221] hover:text-[#180200]'
                }`}
              >
                Unmatched ({Math.max(0, totalUnassigned - totalMatched)})
              </button>
            </div>

          </div>
          </div>
        )}

        {/* Reconciliation Table */}
        <div className="bg-white border border-[#E8DFD8] rounded-2xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-xs text-[#863221] flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#510601]" />
              <span>Scanning unassigned receipts and cross-referencing members...</span>
            </div>
          ) : candidates.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <CheckCircle2 className="w-10 h-10 text-[#3D705C] mx-auto opacity-80" />
              <h3 className="text-sm font-bold text-[#180200]">All Receipts Are Mapped!</h3>
              <p className="text-xs text-[#863221] max-w-md mx-auto">
                There are no unassigned receipts matching the selected filter. Every receipt is properly linked to its member.
              </p>
              <Link
                to="/dashboard/receipts/tracking"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-[#FAF7F2] border border-[#E8DFD8] text-[#863221] hover:text-[#180200]"
              >
                Go to Receipt Tracking
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#180200] font-bold">
                  <tr>
                    <th className="py-3 px-3 w-10 text-center">
                      <input
                        type="checkbox"
                        aria-label="Select every matched receipt on this page"
                        title="Select every matched receipt on this page"
                        checked={candidates.some((c) => c.matched_member) && candidates.filter((c) => c.matched_member).every((c) => selectedReceiptIds.has(c.receipt_id))}
                        disabled={!candidates.some((c) => c.matched_member)}
                        onChange={(e) => (e.target.checked ? handleSelectAllMatched() : handleClearSelection())}
                        className="w-4 h-4 rounded border-[#E8DFD8] text-[#510601] focus:ring-[#510601] disabled:opacity-30 cursor-pointer"
                      />
                    </th>
                    <th className="py-3 px-3">Receipt</th>
                    <th className="py-3 px-3">Payer</th>
                    <th className="py-3 px-3">Amount</th>
                    <th className="py-3 px-3">Member</th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8DFD8]/60 text-[#180200]">
                  {candidates.map((cand) => {
                    const isSelected = selectedReceiptIds.has(cand.receipt_id);
                    const hasMatch = Boolean(cand.matched_member);

                    return (
                      <tr
                        key={cand.receipt_id}
                        className={`transition-colors hover:bg-[#FAF7F2]/60 ${
                          isSelected ? 'bg-[#510601]/5' : ''
                        }`}
                      >
                        {/* Checkbox */}
                        {selectionMode && <td className="py-3 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!hasMatch}
                            onChange={() => toggleSelectReceipt(cand.receipt_id)}
                            className="w-4 h-4 rounded border-[#E8DFD8] text-[#510601] focus:ring-[#510601] disabled:opacity-30 cursor-pointer"
                          />
                        </td>}

                        {/* Receipt Details */}
                        <td className="py-3 px-3">
                          <span className="font-mono font-bold text-[#510601] block">
                            {cand.receipt_number}
                          </span>
                          <span className="text-[11px] text-[#863221]/70 block">
                            {formatDate(cand.receipt_date)}
                          </span>
                        </td>

                        {/* Payer on Receipt */}
                        <td className="py-3 px-3">
                          <span className="font-semibold text-[#180200] block">{cand.payer_name || '—'}</span>
                          <span className="text-[11px] text-[#863221] font-mono block">
                            No: {cand.payer_membership_no || 'none typed'}
                          </span>
                          {cand.payer_mobile && (
                            <span className="text-[11px] text-[#863221] font-mono block">
                              📞 {cand.payer_mobile}
                            </span>
                          )}
                        </td>

                        {/* Amount */}
                        <td className="py-3 px-3 font-mono font-bold text-[#180200]">
                          {formatMoney(cand.net_amount)}
                        </td>

                        {/* Matched Live Member */}
                        <td className="py-3 px-3">
                          {cand.matched_member ? (
                            <div className="space-y-0.5">
                              <span className="font-bold text-[#3D705C] flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                {cand.matched_member.name}
                              </span>
                              <div className="flex items-center gap-2 text-[11px] text-[#863221]">
                                <span className="font-mono font-semibold">
                                  No: {cand.matched_member.membership_number || '—'}
                                </span>
                                {cand.matched_member.mobile && (
                                  <span>· {cand.matched_member.mobile}</span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11px] text-[#863221]/60 italic">
                              No matching member found
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {canWrite && (hasMatch ? (
                              <>
                                <button
                                  type="button"
                                  disabled={isAllocating}
                                  onClick={() => handleMapSingle(cand)}
                                  title={"Map to this member"}
                                  className="px-3 py-1.5 bg-[#3D705C] hover:bg-[#2d5445] text-white font-bold rounded-lg text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Map
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  disabled={isAllocating}
                                  onClick={() => handleOpenManualModal(cand)}
                                  title={"Search and select member"}
                                  className="px-2.5 py-1.5 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] font-semibold rounded-lg text-[11px] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Pick Member
                                </button>
                              </>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {total > 0 && (
            <div className="px-4 py-3 border-t border-[#E8DFD8] bg-[#FAF7F2]">
              <Pager page={page} pages={pages} total={total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
            </div>
          )}
        </div>

        {/* Modal: Manual Member Picker for unmatched receipt */}
        <Modal isOpen={manualModalOpen} onClose={() => setManualModalOpen(false)}>
          <div
            className="bg-white rounded-2xl max-w-3xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col h-[88vh] max-h-[88vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
              <div>
                <h3 className="text-base font-bold text-[#180200]">
                  Map Receipt {activeReceiptForManual?.receipt_number}
                </h3>
                <p className="text-xs text-[#863221]">
                  Amount: {formatMoney(activeReceiptForManual?.net_amount)} · Payer: {activeReceiptForManual?.payer_name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManualModalOpen(false)}
                className="p-1.5 rounded-lg text-[#863221] hover:bg-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 flex-1 overflow-y-auto">
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Search Member (by Name, Number, or Mobile)
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-[#863221]/60 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={memberSearchQuery}
                    onChange={(e) => {
                      setMemberSearchQuery(e.target.value);
                      searchMembers(e.target.value);
                    }}
                    placeholder="Type name, membership no, or phone..."
                    className="w-full pl-9 pr-3 py-2.5 text-xs bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
                  />
                </div>
              </div>

              {searchingMembers && (
                <div className="py-4 text-center text-xs text-[#863221] flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[#510601]" />
                  <span>Searching live members...</span>
                </div>
              )}

              <div className="space-y-2 flex-1 overflow-y-auto">
                {memberSearchResults.map((m) => (
                  <div
                    key={m.id}
                    className="p-3 rounded-xl border border-[#E8DFD8] hover:border-[#510601] bg-[#FAF7F2]/40 hover:bg-[#FAF7F2] flex items-center justify-between gap-3 transition-colors"
                  >
                    <div>
                      <h4 className="text-xs font-bold text-[#180200]">
                        {m.name || memberName(m)}
                      </h4>
                      <p className="text-[11px] text-[#863221]">
                        No: <span className="font-mono font-semibold">{m.membership_number || m.member_code || '—'}</span>
                        {m.mobile ? ` · 📞 ${m.mobile}` : ''}
                        {m.city ? ` · 📍 ${m.city}` : ''}
                      </p>
                    </div>

                    {canWrite && (
                      <button
                        type="button"
                        disabled={isAllocating}
                        onClick={() => handleAssignManualMember(m)}
                        className="px-3 py-1.5 bg-[#510601] hover:bg-[#863221] text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer"
                      >
                        Map to this Member
                      </button>
                    )}
                  </div>
                ))}
                {!searchingMembers && memberSearchQuery && memberSearchResults.length === 0 && (
                  <p className="py-4 text-center text-xs text-[#863221]/60">
                    No members matched "{memberSearchQuery}".
                  </p>
                )}
              </div>
              {memberTotal > 0 && (
                <Pager page={memberPage} pages={memberPages} total={memberTotal} pageSize={25} sizes={[25]} onPage={(n) => searchMembers(memberSearchQuery, n)} onPageSize={() => {}} />
              )}
            </div>

            <ModalFooter kind="view" onCancel={() => setManualModalOpen(false)} />
          </div>
        </Modal>
      </div>
    </PermissionGate>
  );
}
