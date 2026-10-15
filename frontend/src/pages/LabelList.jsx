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
import { loadMembershipTypes } from '../utils/serverData';
import { fetchLabelPage } from '../utils/apiAdapters';
import Pager from '../components/Pager';
import { formatDate } from '../utils/dateUtils';
import api from '../api';
import { askForm } from '../utils/dialogs';
import useAuth from '../hooks/useAuth';

import ModalFooter from '../components/ModalFooter';
export default function LabelList() {
  const { hasPermission } = useAuth();
  // Synchronized stores
  // Label list = members that have a receipt mapped to them (paid members), all read from the server
  const [labelList, setLabelList] = useState([]);
  const [members, setMembers] = useState([]); // the members of the page on screen
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loadingPage, setLoadingPage] = useState(true);
  const [debouncedSearch, setDebouncedSearch] = useState('');
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
  const [pageSize, setPageSize] = useState(25);

  // Print Preview Modal
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const printAreaRef = useRef(null);

  // Toast
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const showToast = (message, type = 'success') => {
    notify(message, type);
  };

  // what the server is asked for: the page, the search, the type and the last-receipt dates. They run on every paid
  // member in the database; this screen only holds the page it shows (rule 10.6).
  const labelParams = () => ({
    ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
    ...(membershipTypeFilter !== 'ALL' ? { membership_type_id: membershipTypeFilter } : {}),
    ...(fromDateFilter ? { from_date: fromDateFilter } : {}),
    ...(toDateFilter ? { to_date: toDateFilter } : {}),
  });
  const requestSeq = useRef(0);
  const loadLabelData = async () => {
    const seq = (requestSeq.current += 1);
    setLoadingPage(true);
    try {
      const result = await fetchLabelPage({ ...labelParams(), page: currentPage, limit: pageSize });
      if (seq !== requestSeq.current) return;
      setMembers(result.rows);
      setTotal(result.total);
      setPages(Math.max(1, result.pages));
      setLabelList(result.rows.map((m) => ({ id: m.id, memberId: m.id, addedDate: m.last_receipt_date || '' })));
      if (currentPage > Math.max(1, result.pages)) setCurrentPage(Math.max(1, result.pages));
    } catch (error) {
      if (seq !== requestSeq.current) return;
      console.error('Failed to load label list.', error);
      showToast(error.response?.data?.detail || 'Failed to load the label list from the server.', 'error');
    } finally {
      if (seq === requestSeq.current) setLoadingPage(false);
    }
  };

  useEffect(() => {
    loadMembershipTypes().then(setMembershipTypes).catch(() => {});
  }, []);
  const filterKey = [debouncedSearch, membershipTypeFilter, fromDateFilter, toDateFilter].join('|');
  useEffect(() => {
    loadLabelData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, currentPage, pageSize]);
  useEffect(() => {
    setCurrentPage(1);
  }, [filterKey, pageSize]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // members ticked on any page stay printable
  const selectedCache = useRef(new Map()); // id -> { item, member }
  const getMember = (memberId) => members.find((m) => m.id === memberId) || selectedCache.current.get(memberId)?.member;
  const getMembershipType = (typeId) => membershipTypes.find((mt) => mt.id === typeId);

  // the server already searched, filtered and paged them
  const filteredList = labelList;
  const paginatedList = labelList;

  // Selection handlers
  const isAllSelected = useMemo(() => {
    if (paginatedList.length === 0) return false;
    return paginatedList.every((item) => selectedIds.includes(item.id));
  }, [paginatedList, selectedIds]);

  const remember = (item) => {
    const member = members.find((m) => m.id === item.memberId);
    if (member) selectedCache.current.set(item.id, { item, member });
  };

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      const currentIds = paginatedList.map((i) => i.id);
      setSelectedIds((prev) => prev.filter((id) => !currentIds.includes(id)));
    } else {
      paginatedList.forEach(remember);
      const currentIds = paginatedList.map((i) => i.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...currentIds])));
    }
  };

  const handleToggleSelectItem = (id) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      const item = labelList.find((i) => i.id === id);
      if (item) remember(item);
      return [...prev, id];
    });
  };

  // every member the filters match, read 200 at a time
  const handleSelectAllAcrossAllPages = async () => {
    const ids = [];
    for (let n = 1; n <= 200; n += 1) {
      const chunk = await fetchLabelPage({ ...labelParams(), page: n, limit: 200 });
      chunk.rows.forEach((m) => {
        selectedCache.current.set(m.id, { item: { id: m.id, memberId: m.id, addedDate: m.last_receipt_date || '' }, member: m });
        ids.push(m.id);
      });
      if (n >= chunk.pages) break;
    }
    setSelectedIds(ids);
  };

  const handleClearSelection = () => {
    setSelectedIds([]);
  };


  // Get items for printing
  const itemsToPrint = useMemo(() => {
    return selectedIds.map((id) => selectedCache.current.get(id)?.item).filter(Boolean);
  }, [selectedIds]);

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
<h1 className="text-xl sm:text-2xl font-bold text-[#180200] tracking-tight">
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

          {hasPermission('magazines.write') && (
            <button
              type="button"
              onClick={handleGenerateBatch}
              title={'Generate a label batch (PDF) for paid members'}
              className="inline-flex items-center gap-2 rounded-lg border border-[#E8DFD8] bg-white px-4 py-2 text-sm font-medium text-[#510601] shadow-sm hover:bg-[#FAF7F2] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Printer className="h-4 w-4" />
              <span>Generate Batch (PDF)</span>
            </button>
          )}

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
            <span className="text-2xl font-bold text-[#180200]">{total}</span>
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
              {total ? `${Math.round((selectedIds.length / total) * 100)}% of queue` : '0%'}
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
                <th className="px-4 py-3.5">Name</th>
                <th className="px-4 py-3.5">Member No.</th>
                <th className="px-4 py-3.5">Type</th>
                <th className="px-4 py-3.5">Mobile</th>
                <th className="px-4 py-3.5 min-w-[240px]">Address</th>
                <th className="px-4 py-3.5">Added On</th>
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
                          className="btn-act"
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

        {/* Table Footer: the server pages the list */}
        {total > 0 && (
          <div className="border-t border-[#E8DFD8] bg-[#FAF7F2] px-4 py-3">
            <Pager page={currentPage} pages={pages} total={total} pageSize={pageSize} onPage={setCurrentPage} onPageSize={setPageSize} />
          </div>
        )}
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
          <ModalFooter
            kind="confirm"
            cancelLabel="Close"
            submitLabel="Send to Printer"
            onCancel={() => setIsPrintModalOpen(false)}
            onSubmit={handleTriggerPrint}
            className="print:hidden no-print"
            left={<span className="text-xs text-[#863221]">Total {itemsToPrint.length} label{itemsToPrint.length !== 1 ? 's' : ''} to print</span>}
          />
        </div>
      </Modal>

      {/* ========================================================= */}
      {/* 12. REMOVE CONFIRMATION DIALOG                            */}
      {/* ========================================================= */}

    </div>
  );
}
