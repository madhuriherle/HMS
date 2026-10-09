import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
import { notify } from '../utils/notify';
import {
  Printer,
  Search,
  Trash2,
  CheckCircle2,
  X,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  User,
  Phone,
  MapPin,
  Calendar,
  CheckSquare,
  Square,
  Building,
  FileText,
  SlidersHorizontal,
  Download
} from 'lucide-react';
import { loadMembers, loadMembershipTypes, loadReceipts } from '../utils/serverData';
import { formatDate } from '../utils/dateUtils';
import api from '../api';
import { askForm } from '../utils/dialogs';
import useAuth from '../hooks/useAuth';

export default function LabelList() {
  const { hasPermission } = useAuth();
  // Synchronized stores
  // Label list = members that have a receipt mapped to them (paid members), all read from the server
  const [labelList, setLabelList] = useState([]);
  const [members, setMembers] = useState([]);
  const [membershipTypes, setMembershipTypes] = useState([]);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [membershipTypeFilter, setMembershipTypeFilter] = useState('ALL');
  const [fromDateFilter, setFromDateFilter] = useState('');
  const [toDateFilter, setToDateFilter] = useState('');

  // Selection state (Array of labelList.id)
  const [selectedIds, setSelectedIds] = useState([]);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Print Preview Modal
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const printAreaRef = useRef(null);

  // Toast
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const showToast = (message, type = 'success') => {
    notify(message, type);
  };

  const loadLabelData = async (typeId) => {
    try {
      const [mems, recs, types] = await Promise.all([
        loadMembers({ limit: 5000, ...(typeId && typeId !== 'ALL' ? { membership_type_id: typeId } : {}) }),
        loadReceipts({ limit: 5000 }),
        loadMembershipTypes()
      ]);
      const lastReceiptDate = new Map();
      recs.forEach((r) => {
        if (r.memberId == null) return;
        const prev = lastReceiptDate.get(r.memberId);
        if (!prev || String(r.receiptDate) > prev) lastReceiptDate.set(r.memberId, String(r.receiptDate || ''));
      });
      setMembers(mems);
      setMembershipTypes(types);
      setLabelList(
        [...lastReceiptDate.entries()].map(([memberId, addedDate]) => ({ id: memberId, memberId, addedDate }))
      );
    } catch (error) {
      console.error('Failed to load label list.', error);
      showToast(error.response?.data?.detail || 'Failed to load the label list from the server.', 'error');
    }
  };

  // the membership-type filter is applied by the server
  useEffect(() => {
    loadLabelData(membershipTypeFilter);
  }, [membershipTypeFilter]);

  // Helper lookups
  const getMember = (memberId) => members.find((m) => m.id === memberId);
  const getMembershipType = (typeId) => membershipTypes.find((mt) => mt.id === typeId);

  // Filtered list
  const filteredList = useMemo(() => {
    return labelList.filter((item) => {
      const member = getMember(item.memberId);
      if (!member) return false;

      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = String(member.fullName ?? '').toLowerCase().includes(q);
        const matchesNo = String(member.membershipNumber ?? '').toLowerCase().includes(q);
        const matchesPhone = String(member.mobile ?? '').includes(q);
        const matchesCity = (member.talukName || '').toLowerCase().includes(q) || (member.districtName || '').toLowerCase().includes(q);

        if (!matchesName && !matchesNo && !matchesPhone && !matchesCity) {
          return false;
        }
      }

      // Date added
      if (fromDateFilter && item.addedDate < fromDateFilter) return false;
      if (toDateFilter && item.addedDate > toDateFilter) return false;

      return true;
    });
  }, [labelList, members, searchQuery, membershipTypeFilter, fromDateFilter, toDateFilter]);

  // Paginated List
  const totalPages = Math.ceil(filteredList.length / pageSize) || 1;
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredList.slice(start, start + pageSize);
  }, [filteredList, currentPage, pageSize]);

  // Selection handlers
  const isAllSelected = useMemo(() => {
    if (paginatedList.length === 0) return false;
    return paginatedList.every((item) => selectedIds.includes(item.id));
  }, [paginatedList, selectedIds]);

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      // Unselect only current page items
      const currentIds = paginatedList.map((i) => i.id);
      setSelectedIds((prev) => prev.filter((id) => !currentIds.includes(id)));
    } else {
      // Select all current page items
      const currentIds = paginatedList.map((i) => i.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...currentIds])));
    }
  };

  const handleToggleSelectItem = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllAcrossAllPages = () => {
    const allFilteredIds = filteredList.map((i) => i.id);
    setSelectedIds(allFilteredIds);
  };

  const handleClearSelection = () => {
    setSelectedIds([]);
  };


  // Get items for printing
  const itemsToPrint = useMemo(() => {
    return labelList.filter((item) => selectedIds.includes(item.id));
  }, [labelList, selectedIds]);

  // Generate a label batch on the server (paid members only) and download its PDF
  const handleGenerateBatch = async () => {
    const now = new Date();
    const v = await askForm({
      title: 'Generate label batch',
      text: 'Creates the labels for members who have paid, and downloads them as a PDF.',
      confirmText: 'Generate',
      fields: [
        {
          name: 'month',
          label: 'Magazine issue (month)',
          type: 'month',
          required: true,
          value: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        }
      ]
    });
    if (!v) return;
    try {
      const { data } = await api.post('/magazines/generate-labels', null, {
        params: { issue_month_year: v.month, only_paid: true }
      });
      if (data?.approval_request_id || data?.status === 'PENDING') {
        showToast('Label batch submitted for approval.');
        return;
      }
      const pdf = await api.get(`/magazines/label-batches/${data.batch_id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(pdf.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `labels-${v.month}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(`Label batch generated (${data.total_labels ?? data.total ?? ''} labels).`);
    } catch (error) {
      let detail = error.response?.data?.detail;
      if (!detail && error.response?.data instanceof Blob) {
        try {
          detail = JSON.parse(await error.response.data.text()).detail;
        } catch (_) {}
      }
      showToast(detail || 'Error generating the label batch', 'error');
    }
  };

  // Direct print trigger
  const handleTriggerPrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Alert */}
      {toast.show && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg transition-all animate-bounce ${
            toast.type === 'success'
              ? 'bg-[#3D705C] text-white'
              : toast.type === 'info'
              ? 'bg-[#8C1801] text-white'
              : 'bg-[#ED4636] text-white'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 shrink-0" />
          )}
          <span className="text-sm font-medium">{toast.message}</span>
          <button
            onClick={() => setToast({ show: false, message: '', type: 'success' })}
            className="ml-2 rounded p-1 hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header & Breadcrumb */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
<h1 className="text-2xl sm:text-3xl font-bold text-[#180200] tracking-tight">
            Label List
          </h1>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard/membership/list"
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 hover:bg-stone-50 transition-colors"
          >
            <User className="h-4 w-4 text-[#8C1801]" />
            <span>Membership List</span>
          </Link>

          <button
            type="button"
            onClick={handleGenerateBatch}
            disabled={!hasPermission('magazines.write')}
            title={!hasPermission('magazines.write') ? 'Requires magazines.write permission' : 'Generate a label batch (PDF) for paid members'}
            className="inline-flex items-center gap-2 rounded-lg border border-[#E8DFD8] bg-white px-4 py-2 text-sm font-medium text-[#510601] shadow-sm hover:bg-[#FAF7F2] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Printer className="h-4 w-4" />
            <span>Generate Batch (PDF)</span>
          </button>

          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => setIsPrintModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#8C1801] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#510601] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Printer className="h-4 w-4" />
            <span>Print Labels</span>
            {selectedIds.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center rounded-full bg-[#FFC107] px-2 py-0.5 text-xs font-bold text-[#180200]">
                {selectedIds.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Total In Queue
            </span>
            <div className="rounded-lg bg-amber-50 p-2 text-[#8C1801]">
              <Printer className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-[#180200]">{labelList.length}</span>
            <span className="text-xs text-gray-500">Ready to print</span>
          </div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Selected for Printing
            </span>
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
              <CheckSquare className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-emerald-700">{selectedIds.length}</span>
            <span className="text-xs font-medium text-emerald-600">
              {labelList.length ? `${Math.round((selectedIds.length / labelList.length) * 100)}% of queue` : '0%'}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Total Members
            </span>
            <div className="rounded-lg bg-stone-100 p-2 text-stone-700">
              <User className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-stone-800">
              {members.length}
            </span>
            <span className="text-xs text-gray-500">Registered members</span>
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <SearchFilterBar
        searchQuery={searchQuery}
        onSearchChange={(val) => {
          setSearchQuery(val);
          setCurrentPage(1);
        }}
        activeFiltersCount={membershipTypeFilter !== 'ALL' ? 1 : 0}
        onResetFilters={() => {
          setSearchQuery('');
          setMembershipTypeFilter('ALL');
          setFromDateFilter('');
          setToDateFilter('');
          setCurrentPage(1);
        }}
        rightSlot={
          selectedIds.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#FAF7F2] border border-[#8C1801]/30 rounded-xl text-xs font-semibold text-[#8C1801]">
              <CheckCircle2 className="w-4 h-4 text-[#8C1801]" />
              <span>{selectedIds.length} selected</span>
              <button
                type="button"
                onClick={handleClearSelection}
                className="ml-1 text-xs underline text-[#863221] hover:text-[#510601]"
              >
                Clear
              </button>
            </div>
          )
        }
      >
        {/* Membership Type Filter */}
        <FilterSelect
          value={membershipTypeFilter}
          onChange={(val) => {
            setMembershipTypeFilter(val);
            setCurrentPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All Membership Types' },
            ...membershipTypes.map((mt) => ({ value: mt.id, label: mt.name }))
          ]}
          widthClass="w-full sm:w-56"
        />
      </SearchFilterBar>

      {/* Label List Table */}
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-700">
            <thead className="bg-[#FAF7F2] border-b border-stone-200 text-xs font-semibold uppercase tracking-wider text-[#180200]">
              <tr>
                {/* Select All Checkbox */}
                <th className="w-12 px-4 py-3.5 text-center">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleToggleSelectAll}
                    aria-label="Select all members on this page"
                    className="h-4 w-4 rounded border-stone-300 text-[#8C1801] focus:ring-[#8C1801]"
                  />
                </th>
                <th className="px-4 py-3.5">Member Name</th>
                <th className="px-4 py-3.5">Membership Number</th>
                <th className="px-4 py-3.5">Membership Type</th>
                <th className="px-4 py-3.5">Mobile Number</th>
                <th className="px-4 py-3.5 min-w-[240px]">Postal Address</th>
                <th className="px-4 py-3.5">Added Date</th>
                <th className="px-4 py-3.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {paginatedList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <Printer className="h-10 w-10 text-stone-300" />
                      <p className="text-base font-medium text-gray-700">No members in label list</p>
                      <p className="text-xs text-gray-500">
                        Select members from the Membership List to add to the label printing queue.
                      </p>
                      <Link
                        to="/dashboard/membership/list"
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#8C1801] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#510601]"
                      >
                        <User className="h-3.5 w-3.5" />
                        <span>Go to Membership List</span>
                      </Link>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedList.map((item) => {
                  const member = getMember(item.memberId);
                  const memType = membershipTypeFilter !== 'ALL' ? membershipTypes.find((mt) => String(mt.id) === String(membershipTypeFilter)) : null;
                  const isSelected = selectedIds.includes(item.id);

                  if (!member) return null;

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-amber-50/40 transition-colors ${
                        isSelected ? 'bg-amber-50/70' : ''
                      }`}
                    >
                      {/* Individual Checkbox */}
                      <td className="px-4 py-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectItem(item.id)}
                          aria-label={`Select ${member.fullName}`}
                          className="h-4 w-4 rounded border-stone-300 text-[#8C1801] focus:ring-[#8C1801]"
                        />
                      </td>

                      {/* Member Name */}
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-gray-900">{member.fullName}</div>
                      </td>

                      {/* Membership Number */}
                      <td className="px-4 py-3.5 font-mono text-xs font-medium text-gray-800">
                        {member.membershipNumber}
                      </td>

                      {/* Membership Type */}
                      <td className="px-4 py-3.5 text-xs">
                        <span className="inline-flex items-center rounded-md bg-stone-100 px-2 py-1 text-xs font-medium text-stone-800">
                          {memType?.name || '—'}
                        </span>
                      </td>

                      {/* Mobile Number */}
                      <td className="px-4 py-3.5 font-mono text-xs text-gray-700">
                        {member.mobile}
                      </td>

                      {/* Full Address */}
                      <td className="px-4 py-3.5 text-xs text-gray-700 leading-relaxed">
                        <div>{member.addressLine || '—'}</div>
                        <div className="text-gray-500 text-[11px]">
                          {member.talukName}, {member.districtName}, {member.stateName} -{' '}
                          <span className="font-mono font-semibold text-gray-800">
                            {member.postalCode}
                          </span>
                        </div>
                      </td>

                      {/* Added Date */}
                      <td className="px-4 py-3.5 text-xs text-gray-600">
                        {formatDate(item.addedDate)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-center">
                        <Link
                          to="/dashboard/receipts/tracking"
                          title="Receipts decide who is on the label list"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#510601] bg-[#FAF7F2] border border-[#E8DFD8] rounded-lg hover:bg-[#F1E7DE] transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>View receipts</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-stone-200 bg-[#FAF7F2]/60 px-4 py-3 sm:flex-row text-xs text-gray-600">
          <div>
            Showing <span className="font-semibold">{paginatedList.length}</span> of{' '}
            <span className="font-semibold">{filteredList.length}</span> queued members
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="rounded border border-stone-200 bg-white px-2 py-1 text-xs focus:outline-none"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>

            <div className="ml-2 flex items-center space-x-1">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="rounded border border-stone-200 bg-white p-1 text-gray-600 hover:bg-stone-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2 font-medium text-gray-800">
                {currentPage} / {totalPages}
              </span>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-stone-200 bg-white p-1 text-gray-600 hover:bg-stone-50 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 10, 11. PRINT PREVIEW / PRINTABLE LABELS MODAL            */}
      {/* ========================================================= */}
      <Modal isOpen={isPrintModalOpen} onClose={() => setIsPrintModalOpen(false)}>
        <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-stone-200 overflow-hidden max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
          {/* Modal Header */}
          <div className="flex items-center justify-between border-b border-stone-200 bg-[#FAF7F2] px-6 py-4 print:hidden no-print">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-[#8C1801] p-2 text-white">
                <Printer className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#180200]">
                  Print Member Labels
                </h3>
                <p className="text-xs text-gray-600">
                  {itemsToPrint.length} label{itemsToPrint.length !== 1 ? 's' : ''} ready for dispatch printing
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsPrintModalOpen(false)}
              className="rounded-lg p-1 text-gray-400 hover:bg-stone-200 hover:text-gray-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Modal Printable Body */}
          <div className="flex-1 overflow-y-auto p-6 bg-stone-100/60 print:bg-white print:p-0" ref={printAreaRef}>
            <div className="mb-4 flex items-center gap-2.5 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200 print:hidden no-print">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-700" />
              <span>
                Clean, high-contrast label formatting suitable for standard sheet sticker printing (2 columns).
              </span>
            </div>

            {/* Labels Grid (2 columns Avery style) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2 print:gap-4">
              {itemsToPrint.map((item) => {
                const member = getMember(item.memberId);
                const memType = membershipTypeFilter !== 'ALL' ? membershipTypes.find((mt) => String(mt.id) === String(membershipTypeFilter)) : null;
                if (!member) return null;

                return (
                  <div
                    key={item.id}
                    className="printable-label-card rounded-lg border-2 border-dashed border-stone-400 bg-white p-4 shadow-sm relative flex flex-col justify-between"
                    style={{ minHeight: '180px' }}
                  >
                    {/* Organization Header */}
                    <div className="border-b border-stone-200 pb-1.5 mb-2 flex items-center justify-between">
                      <div className="font-bold text-xs tracking-wider text-[#8C1801] uppercase">
                        Havyaka MahaSabha
                      </div>
                      <span className="font-mono text-[10px] bg-stone-100 text-stone-700 px-1.5 py-0.5 rounded font-bold">
                        {memType?.name || 'Member'}
                      </span>
                    </div>

                    {/* Recipient Details */}
                    <div className="text-xs space-y-1 text-gray-900 flex-1">
                      <div className="font-bold text-sm text-[#180200]">
                        To: {member.fullName}
                      </div>
                      <div className="text-[11px] text-gray-600 font-mono font-medium">
                        ID: {member.membershipNumber}
                      </div>
                      <div className="text-xs text-gray-800 leading-snug pt-1">
                        {member.addressLine}
                        <br />
                        {member.talukName}, {member.districtName}
                        <br />
                        {member.stateName} - <span className="font-bold font-mono">{member.postalCode}</span>
                      </div>
                    </div>

                    {/* Footer / Mobile */}
                    <div className="border-t border-stone-200 pt-1.5 mt-2 flex items-center justify-between text-[11px] text-gray-600">
                      <span className="flex items-center gap-1 font-mono">
                        <Phone className="h-3 w-3 text-stone-400" />
                        Ph: {member.mobile}
                      </span>
                      <span className="text-[10px] text-stone-400">
                        HMS Dispatch
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-between border-t border-stone-200 bg-white px-6 py-4 print:hidden no-print">
            <span className="text-xs text-gray-500">
              Total {itemsToPrint.length} label{itemsToPrint.length !== 1 ? 's' : ''} to print
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsPrintModalOpen(false)}
                className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-stone-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleTriggerPrint}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#8C1801] px-5 py-2 text-xs font-medium text-white hover:bg-[#510601] shadow-sm transition-colors"
              >
                <Printer className="h-4 w-4" />
                <span>Send to Printer</span>
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ========================================================= */}
      {/* 12. REMOVE CONFIRMATION DIALOG                            */}
      {/* ========================================================= */}

    </div>
  );
}
