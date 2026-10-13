import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Link2,
  CheckCircle2,
  AlertTriangle,
  Search,
  ArrowLeft,
  Loader2,
  Check,
  User,
  CreditCard,
  Building,
  RefreshCw,
  Sparkles,
  Layers,
  Filter,
  X
} from 'lucide-react';
import api from '../api';
import { notify } from '../utils/notify';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import { formatDate } from '../utils/dateUtils';
import Modal from '../components/Modal';

// Currency formatter
const formatINR = (val) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(val || 0);
};

export default function BulkReceiptMapping() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('receipts.tracking.write') || hasPermission('receipts.write');

  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState([]);
  const [totalUnassigned, setTotalUnassigned] = useState(0);
  const [totalMatched, setTotalMatched] = useState(0);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState('ALL'); // 'ALL' | 'MATCHED' | 'UNMATCHED'

  // Selection for batch actions
  const [selectedReceiptIds, setSelectedReceiptIds] = useState(new Set());
  const [isAllocating, setIsAllocating] = useState(false);

  // Manual Member Selection Modal for unmatched receipts
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [activeReceiptForManual, setActiveReceiptForManual] = useState(null);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [memberSearchResults, setMemberSearchResults] = useState([]);
  const [searchingMembers, setSearchingMembers] = useState(false);

  const fetchCandidates = async () => {
    setLoading(true);
    try {
      const params = {};
      if (searchQuery.trim()) params.search = searchQuery.trim();
      if (filterTab !== 'ALL') params.filter_type = filterTab;

      const { data } = await api.get('/receipts/unassigned-candidates', { params });
      setCandidates(data?.candidates || []);
      setTotalUnassigned(data?.total_unassigned || 0);
      setTotalMatched(data?.total_matched || 0);
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
  }, [filterTab]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchCandidates();
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
    const matchItems = candidates
      .filter((c) => c.matched_member)
      .map((c) => ({
        receipt_id: c.receipt_id,
        member_id: c.matched_member.id,
        allocated_amount: c.net_amount
      }));

    if (matchItems.length === 0) {
      notify('No matched receipts available to map.', 'error');
      return;
    }

    setIsAllocating(true);
    try {
      const { data } = await api.post('/receipts/bulk-allocate', {
        allocations: matchItems
      });

      notify(
        `Successfully auto-mapped ${data?.allocated_count || matchItems.length} receipts to their respective members!`,
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

      notify(`Receipt #${candidate.receipt_number} mapped to ${candidate.matched_member.name}!`, 'success');
      await fetchCandidates();
    } catch (err) {
      console.error(err);
      notify(err.response?.data?.detail || 'Error mapping receipt', 'error');
    } finally {
      setIsAllocating(false);
    }
  };

  // Manual member search
  const searchMembers = async (q) => {
    if (!q || q.trim().length < 2) {
      setMemberSearchResults([]);
      return;
    }
    setSearchingMembers(true);
    try {
      const { data } = await api.get('/members/lookup', { params: { q: q.trim() } });
      const list = data?.data || data || [];
      setMemberSearchResults(list);
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

      notify(`Receipt #${activeReceiptForManual.receipt_number} mapped to ${member.name || member.first_name_en}!`, 'success');
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
  const exactMatchCount = useMemo(() => {
    return candidates.filter((c) => c.match_type === 'EXACT_NUMBER').length;
  }, [candidates]);

  const matchedAmount = useMemo(() => {
    return candidates
      .filter((c) => c.matched_member)
      .reduce((sum, c) => sum + (c.net_amount || 0), 0);
  }, [candidates]);

  const totalAmount = useMemo(() => {
    return candidates.reduce((sum, c) => sum + (c.net_amount || 0), 0);
  }, [candidates]);

  return (
    <PermissionGate required={['receipts.tracking.read', 'receipts.read']} title="Access Restricted" message="You need permission to track receipts to access Bulk Mapping.">
      <div className="space-y-6">
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold text-[#180200] tracking-tight">Bulk Receipt Auto-Mapping</h1>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/dashboard/receipts/tracking"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Receipt Tracking
            </Link>
            <Link
              to="/dashboard/membership/import"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl border border-[#510601] text-[#510601] hover:bg-[#510601]/5 transition-colors"
            >
              Import Members
            </Link>
          </div>
        </div>

        {/* 3 KPI Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-[#FAF7F2] border border-[#E8DFD8] rounded-2xl p-4">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-[#863221]">
              Unassigned Receipts
            </span>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-2xl font-bold text-[#180200] font-mono">{totalUnassigned.toLocaleString()}</span>
              <span className="text-xs font-semibold text-[#863221]">{formatINR(totalAmount)}</span>
            </div>
            <p className="text-[10px] text-[#863221]/70 mt-1">Receipts waiting to be linked to members</p>
          </div>

          <div className="bg-[#3D705C]/5 border border-[#3D705C]/30 rounded-2xl p-4">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-[#3D705C]">
              Ready for Auto-Mapping (Matched)
            </span>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-2xl font-bold text-[#3D705C] font-mono">{totalMatched.toLocaleString()}</span>
              <span className="text-xs font-semibold text-[#3D705C]">{formatINR(matchedAmount)}</span>
            </div>
            <p className="text-[10px] text-[#3D705C]/80 mt-1">Member number matches imported register</p>
          </div>

          <div className="bg-white border border-[#E8DFD8] rounded-2xl p-4">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-[#863221]">
              Unmatched Receipts
            </span>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-2xl font-bold text-[#180200] font-mono">
                {Math.max(0, totalUnassigned - totalMatched).toLocaleString()}
              </span>
              <span className="text-xs font-semibold text-[#863221]">
                {formatINR(Math.max(0, totalAmount - matchedAmount))}
              </span>
            </div>
            <p className="text-[10px] text-[#863221]/70 mt-1">Can be mapped manually via member picker</p>
          </div>
        </div>

        {/* Action Bar: Filters + 1-Click Bulk Action Button */}
        <div className="bg-white border border-[#E8DFD8] rounded-2xl shadow-sm p-4 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
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

            {/* Primary Action Button: 1-Click Auto Map All Matches */}
            <div className="flex items-center gap-2">
              {totalMatched > 0 && (
                <button
                  type="button"
                  disabled={isAllocating || !canWrite}
                  onClick={handleBulkAutoMapAll}
                  title={!canWrite ? "Requires receipts.tracking.write permission" : "Auto-map all matched receipts"}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#3D705C] hover:bg-[#2d5445] text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isAllocating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 text-emerald-200" />
                  )}
                  ⚡ Auto-Map All {totalMatched} Matched Receipts ({formatINR(matchedAmount)})
                </button>
              )}

              {selectedReceiptIds.size > 0 && (
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
          </div>

          {/* Selection Helper Strip */}
          {candidates.length > 0 && (
            <div className="flex items-center justify-between text-xs text-[#863221] pt-1 border-t border-[#E8DFD8]/60">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleSelectAllMatched}
                  className="hover:underline font-semibold text-[#3D705C] cursor-pointer"
                >
                  Select all matched rows
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="hover:underline cursor-pointer"
                >
                  Clear selection
                </button>
              </div>

              <span>
                Showing <b>{candidates.length}</b> receipts
              </span>
            </div>
          )}
        </div>

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
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="py-3 px-3">Receipt Details</th>
                    <th className="py-3 px-3">Entered Member No</th>
                    <th className="py-3 px-3">Payer on Receipt</th>
                    <th className="py-3 px-3">Amount</th>
                    <th className="py-3 px-3">Matched Live Member</th>
                    <th className="py-3 px-3 text-center">Status</th>
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
                        <td className="py-3 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!hasMatch}
                            onChange={() => toggleSelectReceipt(cand.receipt_id)}
                            className="w-4 h-4 rounded border-[#E8DFD8] text-[#510601] focus:ring-[#510601] disabled:opacity-30 cursor-pointer"
                          />
                        </td>

                        {/* Receipt Details */}
                        <td className="py-3 px-3">
                          <span className="font-mono font-bold text-[#510601] block">
                            #{cand.receipt_number}
                          </span>
                          <span className="text-[11px] text-[#863221]/70 block">
                            {formatDate(cand.receipt_date)}
                          </span>
                        </td>

                        {/* Entered Member No */}
                        <td className="py-3 px-3">
                          {cand.payer_membership_no ? (
                            <span className="px-2.5 py-1 rounded-lg bg-[#FAF7F2] border border-[#E8DFD8] font-mono font-bold text-xs text-[#180200] inline-block">
                              {cand.payer_membership_no}
                            </span>
                          ) : (
                            <span className="text-[11px] text-[#863221]/50 italic">None typed</span>
                          )}
                        </td>

                        {/* Payer on Receipt */}
                        <td className="py-3 px-3">
                          <span className="font-semibold text-[#180200] block">{cand.payer_name || '—'}</span>
                          {cand.payer_mobile && (
                            <span className="text-[11px] text-[#863221] font-mono block">
                              📞 {cand.payer_mobile}
                            </span>
                          )}
                        </td>

                        {/* Amount */}
                        <td className="py-3 px-3 font-mono font-bold text-[#180200]">
                          {formatINR(cand.net_amount)}
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
                                  No: {cand.matched_member.membership_number || `#${cand.matched_member.id}`}
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

                        {/* Status Badge */}
                        <td className="py-3 px-3 text-center">
                          {cand.match_type === 'EXACT_NUMBER' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#3D705C]/15 text-[#3D705C] border border-[#3D705C]/30">
                              <Check className="w-3 h-3" />
                              Exact Match
                            </span>
                          ) : cand.match_type === 'MOBILE' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                              Phone Match
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-300">
                              Unmatched
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {hasMatch ? (
                              <button
                                type="button"
                                disabled={isAllocating || !canWrite}
                                onClick={() => handleMapSingle(cand)}
                                title={!canWrite ? "Requires receipts.tracking.write permission" : "Map to this member"}
                                className="px-3 py-1.5 bg-[#3D705C] hover:bg-[#2d5445] text-white font-bold rounded-lg text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                Map
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={isAllocating || !canWrite}
                                onClick={() => handleOpenManualModal(cand)}
                                title={!canWrite ? "Requires receipts.tracking.write permission" : "Search and select member"}
                                className="px-2.5 py-1.5 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] font-semibold rounded-lg text-[11px] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                Pick Member
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal: Manual Member Picker for unmatched receipt */}
        <Modal isOpen={manualModalOpen} onClose={() => setManualModalOpen(false)}>
          <div
            className="bg-white rounded-2xl max-w-xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2]">
              <div>
                <h3 className="text-base font-bold text-[#180200]">
                  Map Receipt #{activeReceiptForManual?.receipt_number}
                </h3>
                <p className="text-xs text-[#863221]">
                  Amount: {formatINR(activeReceiptForManual?.net_amount)} · Payer: {activeReceiptForManual?.payer_name}
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

              <div className="space-y-2 max-h-60 overflow-y-auto">
                {memberSearchResults.map((m) => (
                  <div
                    key={m.id}
                    className="p-3 rounded-xl border border-[#E8DFD8] hover:border-[#510601] bg-[#FAF7F2]/40 hover:bg-[#FAF7F2] flex items-center justify-between gap-3 transition-colors"
                  >
                    <div>
                      <h4 className="text-xs font-bold text-[#180200]">
                        {m.name || m.first_name_en} {m.last_name_en || ''}
                      </h4>
                      <p className="text-[11px] text-[#863221]">
                        No: <span className="font-mono font-semibold">{m.membership_number || m.member_code || `#${m.id}`}</span>
                        {m.mobile ? ` · 📞 ${m.mobile}` : ''}
                        {m.city ? ` · 📍 ${m.city}` : ''}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={isAllocating}
                      onClick={() => handleAssignManualMember(m)}
                      className="px-3 py-1.5 bg-[#510601] hover:bg-[#863221] text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer"
                    >
                      Map to this Member
                    </button>
                  </div>
                ))}
                {!searchingMembers && memberSearchQuery && memberSearchResults.length === 0 && (
                  <p className="py-4 text-center text-xs text-[#863221]/60">
                    No members matched "{memberSearchQuery}".
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end px-6 py-3 border-t border-[#E8DFD8] bg-[#FAF7F2]">
              <button
                type="button"
                onClick={() => setManualModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-white"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </PermissionGate>
  );
}
