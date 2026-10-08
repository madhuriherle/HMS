import React, { useState, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
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
import {
  getStoredLabelList,
  saveStoredLabelList,
  getStoredMembers,
  getStoredMembershipTypes
} from '../utils/receiptStore';

// Date formatter
const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
};

export default function LabelList() {
  // Synchronized stores
  const [labelList, setLabelList] = useState(getStoredLabelList());
  const [members] = useState(getStoredMembers());
  const [membershipTypes] = useState(getStoredMembershipTypes());

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

  // Remove confirmation modal
  const [itemToRemove, setItemToRemove] = useState(null);

  // Print Preview Modal
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const printAreaRef = useRef(null);

  // Toast
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'success' });
    }, 4000);
  };

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
        const matchesName = member.fullName.toLowerCase().includes(q);
        const matchesNo = member.membershipNumber.toLowerCase().includes(q);
        const matchesPhone = member.mobile.includes(q);
        const matchesCity = (member.talukName || '').toLowerCase().includes(q) || (member.districtName || '').toLowerCase().includes(q);

        if (!matchesName && !matchesNo && !matchesPhone && !matchesCity) {
          return false;
        }
      }

      // Membership Type
      if (membershipTypeFilter !== 'ALL') {
        if (member.membershipTypeId !== membershipTypeFilter) return false;
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

  // Remove member from Label List
  const handleConfirmRemove = () => {
    if (!itemToRemove) return;

    const updatedList = labelList.filter((item) => item.id !== itemToRemove.id);
    setLabelList(updatedList);
    saveStoredLabelList(updatedList);

    // Also remove from selection if selected
    setSelectedIds((prev) => prev.filter((id) => id !== itemToRemove.id));

    setItemToRemove(null);
    showToast('Member removed from label list.', 'success');
  };

  // Get items for printing
  const itemsToPrint = useMemo(() => {
    return labelList.filter((item) => selectedIds.includes(item.id));
  }, [labelList, selectedIds]);

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
          <nav className="flex items-center space-x-2 text-xs text-gray-500 mb-1">
            <Link to="/dashboard" className="hover:text-[#8C1801]">Dashboard</Link>
            <ChevronRight className="h-3 w-3 text-gray-400" />
            <Link to="/dashboard/receipts" className="hover:text-[#8C1801]">Receipts</Link>
            <ChevronRight className="h-3 w-3 text-gray-400" />
            <span className="text-gray-800 font-semibold">Label List</span>
          </nav>
          <h1 className="text-2xl font-bold text-[#180200]">
            Label List
          </h1>
          <p className="text-sm text-gray-600 mt-0.5">
            View members added for label printing. Select members to generate postal dispatch labels.
          </p>
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
        searchPlaceholder="Search..."
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
                  const memType = member ? getMembershipType(member.membershipTypeId) : null;
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
                          {memType?.name || 'Standard'}
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
                        <button
                          type="button"
                          onClick={() => setItemToRemove(item)}
                          title="Remove from Label List"
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Remove</span>
                        </button>
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
                const memType = member ? getMembershipType(member.membershipTypeId) : null;
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
      <Modal isOpen={Boolean(itemToRemove)} onClose={() => setItemToRemove(null)}>
        {itemToRemove && (
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-stone-200 p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-red-100 p-3 text-red-700">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Remove from Label List?
                </h3>
                <p className="text-xs text-gray-500">
                  Confirmation required
                </p>
              </div>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed">
              Are you sure you want to remove{' '}
              <strong className="text-gray-900">
                {getMember(itemToRemove.memberId)?.fullName}
              </strong>{' '}
              ({getMember(itemToRemove.memberId)?.membershipNumber}) from the label printing queue?
            </p>

            <div className="rounded-lg bg-stone-100 p-3 text-[11px] text-stone-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-stone-500 mt-0.5" />
              <span>
                <strong>Note:</strong> Removing this member from the label list will{' '}
                <strong>NOT</strong> delete, cancel, or unassign the associated receipt. It only removes the member from the current physical printing batch.
              </span>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setItemToRemove(null)}
                className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRemove}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-700 shadow-sm"
              >
                Remove Member
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
