import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
import { notify } from '../utils/notify';
import {
  Printer,
  Search,
  CheckCircle2,
  X,
  AlertCircle,
  RefreshCw,
  User,
  CheckSquare,
  FileText,
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

  // what the server is asked for: the page, the search, the type and the last-receipt dates.
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

  // the server already searched, filtered and paged them
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
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg transition-all animate-bounce ${
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
            className="ml-2 rounded-lg p-1 hover:bg-white/20 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Action Buttons Toolbar */}
      <div className="flex flex-wrap items-center justify-end gap-3 -mb-2">
        {hasPermission('members.list.read') && (
          <Link
            to="/dashboard/membership/list"
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#E8DFD8] bg-white px-3.5 py-2 text-xs font-semibold text-[#863221] hover:bg-[#FAF7F2] shadow-xs transition-colors"
          >
            <User className="h-4 w-4 text-[#8C1801]" />
            <span>Membership List</span>
          </Link>
        )}

        {hasPermission('magazines.write') && (
          <button
            type="button"
            onClick={handleGenerateBatch}
            title="Generate a label batch (PDF) for paid members"
            className="inline-flex items-center gap-2 rounded-xl border border-[#E8DFD8] bg-white px-4 py-2 text-xs font-semibold text-[#510601] shadow-xs hover:bg-[#FAF7F2] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <Printer className="h-4 w-4" />
            <span>Generate Batch (PDF)</span>
          </button>
        )}

        <button
          type="button"
          disabled={selectedIds.length === 0}
          onClick={() => setIsPrintModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-[#510601] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#3D0400] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <Printer className="h-4 w-4" />
          <span>Print Labels</span>
          {selectedIds.length > 0 && (
            <span className="ml-1 inline-flex items-center justify-center rounded-full bg-[#FFC107] px-2 py-0.5 text-[10px] font-bold text-[#180200]">
              {selectedIds.length}
            </span>
          )}
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#E8DFD8] bg-white p-5 shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#863221]">
              Total In Queue
            </span>
            <div className="rounded-xl bg-amber-50 p-2 text-[#8C1801] border border-amber-200">
              <Printer className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-[#180200]">{total}</span>
            <span className="text-xs text-[#863221]/70">Ready to print</span>
          </div>
        </div>

        <div className="rounded-2xl border border-[#E8DFD8] bg-white p-5 shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#863221]">
              Selected for Printing
            </span>
            <div className="rounded-xl bg-emerald-50 p-2 text-[#3D705C] border border-emerald-200">
              <CheckSquare className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-[#3D705C]">{selectedIds.length}</span>
            <span className="text-xs font-semibold text-[#3D705C]">
              {total ? `${Math.round((selectedIds.length / total) * 100)}% of queue` : '0%'}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-[#E8DFD8] bg-white p-5 shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#863221]">
              In Current View
            </span>
            <div className="rounded-xl bg-[#FAF7F2] p-2 text-[#510601] border border-[#E8DFD8]">
              <User className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-[#180200]">
              {members.length}
            </span>
            <span className="text-xs text-[#863221]/70">Displaying on page</span>
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <SearchFilterBar
        title="Label List"
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
                className="ml-1 text-xs underline text-[#863221] hover:text-[#510601] cursor-pointer"
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
      <div className="overflow-hidden rounded-2xl border border-[#E8DFD8] bg-white shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[11px] font-bold uppercase tracking-wider text-[#863221]">
              <tr>
                {/* Select All Checkbox */}
                <th className="w-12 px-4 py-3.5 text-center">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleToggleSelectAll}
                    aria-label="Select all members on this page"
                    className="h-4 w-4 rounded border-[#E8DFD8] text-[#510601] focus:ring-[#510601] cursor-pointer"
                  />
                </th>
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">Member No.</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Mobile</th>
                <th className="py-3 px-4 min-w-[240px]">Address</th>
                <th className="py-3 px-4">Added On</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8]">
              {loadingPage ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#863221]">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#510601]" />
                    Loading label list...
                  </td>
                </tr>
              ) : paginatedList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#863221]">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <Printer className="h-10 w-10 text-[#863221]/30" />
                      <p className="text-sm font-semibold text-[#180200]">No members in label list</p>
                      <p className="text-xs text-[#863221]/70">
                        Select members from the Membership List to add to the label printing queue.
                      </p>
                      {hasPermission('members.list.read') && (
                        <Link
                          to="/dashboard/membership/list"
                          className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-[#510601] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#3D0400] transition-colors"
                        >
                          <User className="h-3.5 w-3.5" />
                          <span>Go to Membership List</span>
                        </Link>
                      )}
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
                      className={`hover:bg-[#FAF7F2]/60 transition-colors ${
                        isSelected ? 'bg-amber-50/60' : ''
                      }`}
                    >
                      {/* Individual Checkbox */}
                      <td className="px-4 py-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectItem(item.id)}
                          aria-label={`Select ${member.fullName}`}
                          className="h-4 w-4 rounded border-[#E8DFD8] text-[#510601] focus:ring-[#510601] cursor-pointer"
                        />
                      </td>

                      {/* Member Name */}
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-[#180200]">{member.fullName}</div>
                      </td>

                      {/* Membership Number */}
                      <td className="px-4 py-3.5 font-mono text-xs font-bold text-[#510601]">
                        {member.membershipNumber}
                      </td>

                      {/* Membership Type */}
                      <td className="px-4 py-3.5 text-xs">
                        <span className="inline-flex items-center rounded-full bg-[#FAF7F2] border border-[#E8DFD8] px-2.5 py-0.5 text-[10px] font-bold text-[#863221]">
                          {memType?.name || '—'}
                        </span>
                      </td>

                      {/* Mobile Number */}
                      <td className="px-4 py-3.5 font-mono text-xs text-[#863221]">
                        {member.mobile}
                      </td>

                      {/* Full Address */}
                      <td className="px-4 py-3.5 text-xs text-[#180200] leading-relaxed">
                        <div>{member.addressLine || '—'}</div>
                        <div className="text-[#863221] text-[11px]">
                          {member.talukName}, {member.districtName}, {member.stateName} -{' '}
                          <span className="font-mono font-bold text-[#180200]">
                            {member.postalCode}
                          </span>
                        </div>
                      </td>

                      {/* Added Date */}
                      <td className="px-4 py-3.5 text-xs text-[#863221]">
                        {formatDate(item.addedDate)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-center">
                        {hasPermission('receipts.tracking.read') && (
                          <Link
                            to="/dashboard/receipts/tracking"
                            title="Receipts decide who is on the label list"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#863221] bg-[#FAF7F2] hover:bg-[#E8DFD8] border border-[#E8DFD8] rounded-lg transition-colors cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5 text-[#510601]" />
                            <span>View receipts</span>
                          </Link>
                        )}
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
          <div className="border-t border-[#E8DFD8] bg-[#FAF7F2]/40 px-4 py-3">
            <Pager page={currentPage} pages={pages} total={total} pageSize={pageSize} onPage={setCurrentPage} onPageSize={setPageSize} />
          </div>
        )}
      </div>

      {/* ========================================================= */}
      {/* PRINT PREVIEW / PRINTABLE LABELS MODAL                    */}
      {/* ========================================================= */}
      <Modal isOpen={isPrintModalOpen} onClose={() => setIsPrintModalOpen(false)}>
        <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-[#E8DFD8] overflow-hidden max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
          {/* Modal Header */}
          <div className="flex items-center justify-between border-b border-[#E8DFD8] bg-[#FAF7F2] px-6 py-4 print:hidden no-print">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-[#510601] p-2 text-white">
                <Printer className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#180200]">
                  Print Member Labels
                </h3>
                <p className="text-xs text-[#863221]">
                  {itemsToPrint.length} label{itemsToPrint.length !== 1 ? 's' : ''} ready for dispatch printing
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsPrintModalOpen(false)}
              className="rounded-lg p-1 text-[#863221]/60 hover:bg-[#FAF7F2] hover:text-[#510601] cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Modal Printable Body */}
          <div className="flex-1 overflow-y-auto p-6 bg-[#FAF7F2]/40 print:bg-white print:p-0" ref={printAreaRef}>
            <div className="mb-4 flex items-center gap-2.5 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200 print:hidden no-print">
              <AlertCircle className="h-4 w-4 shrink-0 text-[#EE6A00]" />
              <span>
                A4 sticker sheet, 3 columns x 7 rows: membership number, name and address on each label.
              </span>
            </div>

            {/* Labels Grid: 3 across, no gaps */}
            <div className="label-sheet grid grid-cols-1 md:grid-cols-3 gap-0 print:grid-cols-3 print:gap-0">
              {itemsToPrint.map((item) => {
                const member = getMember(item.memberId);
                if (!member) return null;

                return (
                  <div
                    key={item.id}
                    className="printable-label-card border border-[#E8DFD8] bg-white px-3 py-2.5 relative"
                    style={{ minHeight: '42.4mm' }}
                  >
                    {/* Recipient Details: membership number, name in bold, address */}
                    <div className="leading-tight text-black">
                      <div className="text-[12px] mb-0.5 font-mono font-bold text-[#510601]">
                        {member.membershipNumber}
                      </div>
                      <div className="font-bold text-[12px] mb-0.5 uppercase text-[#180200]">
                        {member.fullName}
                      </div>
                      <div className="text-[13px] leading-snug text-[#180200]">
                        {member.addressLine}
                        <br />
                        {[member.talukName, member.districtName].filter(Boolean).join(', ')}
                        <br />
                        {member.stateName} - <span className="font-semibold font-mono">{member.postalCode}</span>
                      </div>
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
            left={<span className="text-xs font-semibold text-[#863221]">Total {itemsToPrint.length} label{itemsToPrint.length !== 1 ? 's' : ''} to print</span>}
          />
        </div>
      </Modal>
    </div>
  );
}
