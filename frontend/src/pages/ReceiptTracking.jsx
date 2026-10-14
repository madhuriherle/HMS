import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
import {
  ChevronRight,
  Search,
  Eye,
  Pencil,
  Trash2,
  Link as LinkIcon,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  X,
  FileSpreadsheet,
  User,
  Phone,
  Calendar,
  Award,
  Check,
  RotateCcw,
  FileText,
  Building,
  CreditCard,
  CheckSquare
} from 'lucide-react';
import Modal from '../components/Modal';
import { isReceiptUnmapped } from '../utils/displayHelpers';
import { loadParticulars, loadMembers, loadPaymentModeConfigs } from '../utils/serverData';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import useSwalConfirm from '../hooks/useSwalConfirm';
import api from '../api';
import { formatDate } from '../utils/dateUtils';
import { apiErrorMessage } from '../utils/apiError';
import { askForm, askReason, confirmYesNo } from '../utils/dialogs';
import { notify } from '../utils/notify';
import { fetchReceipts } from '../utils/apiAdapters';
import { currentRules } from '../hooks/useRules';
import { useList } from '../hooks/useLists';
import { formatMoney } from '../utils/money';

import ModalFooter from '../components/ModalFooter';
// Financial year (April-March) of an ISO date: 2026-10-12 -> 2026-27
const fyOf = (iso) => {
  if (!iso || String(iso).length < 7) return '';
  const y = Number(String(iso).slice(0, 4));
  const m = Number(String(iso).slice(5, 7));
  const startMonth = currentRules()?.financial_year?.start_month;
  if (!startMonth) return '';
  const start = m >= startMonth ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
};

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;


// Helper to format date string (YYYY-MM-DD to DD-MM-YYYY)
// Helper for number to words (Indian Numbering System)
const numberToWords = (num) => {
  if (!num || isNaN(num) || num <= 0) return '';
  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const n = ('000000000' + num).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
  if (!n) return '';
  let str = '';
  str += (Number(n[1]) !== 0) ? (a[Number(n[1])] || b[n[1][0]] + ' ' + a[n[1][1]]) + 'Crore ' : '';
  str += (Number(n[2]) !== 0) ? (a[Number(n[2])] || b[n[2][0]] + ' ' + a[n[2][1]]) + 'Lakh ' : '';
  str += (Number(n[3]) !== 0) ? (a[Number(n[3])] || b[n[3][0]] + ' ' + a[n[3][1]]) + 'Thousand ' : '';
  str += (Number(n[4]) !== 0) ? (a[Number(n[4])] || b[n[4][0]] + ' ' + a[n[4][1]]) + 'Hundred ' : '';
  str += (Number(n[5]) !== 0) ? ((str !== '') ? 'and ' : '') + (a[Number(n[5])] || b[n[5][0]] + ' ' + a[n[5][1]]) : '';
  return str.trim() + ' Rupees Only';
};

// the status names and chip colours come from the server (receipt_statuses in GET /meta/lists)
function StatusDot({ receipt }) {
  const statuses = useList('receipt_statuses');
  const key = receipt.receiptStatus || (isReceiptUnmapped(receipt) ? 'UNASSIGNED' : 'ASSIGNED');
  const look = statuses.find((s) => s.code === key);
  if (!look) return <span className="chip chip-off">{key}</span>;
  return (
    <span className={`chip ${look.extra || 'chip-off'}`}>{look.label}</span>
  );
}

export default function ReceiptTracking() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  // Master Synchronized Stores
  const [receipts, setReceipts] = useState([]);
  const [members, setMembers] = useState([]);
  const [unapprovedMembers, setUnapprovedMembers] = useState([]);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState(() => new URLSearchParams(window.location.search).get('search') || '');
  const [particularsFilter, setParticularsFilter] = useState('ALL');
  const [subTypeFilter, setSubTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL'); // ALL, Assigned, Unassigned
  const [fyFilter, setFyFilter] = useState('ALL');
  const [modeFilter, setModeFilter] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false); // checkboxes show only after the Select button is pressed
  const [dayBook, setDayBook] = useState(null); // { date, data }

  // Modals State
  const [viewingReceipt, setViewingReceipt] = useState(null);
  const [deletingReceipt, setDeletingReceipt] = useState(null);

  // Toast State
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (message, type = 'success') => {
    notify(message, type);
  };

  // Particular names for the filter / edit dropdowns come from the Particulars master
  const [particularOptions, setParticularOptions] = useState([]);
  const [paymentModeOptions, setPaymentModeOptions] = useState([]);

  const reloadData = async () => {
    const fail = (what) => (error) => {
      console.error(`Failed to load ${what}.`, error);
      showToast(error.response?.data?.detail || `Failed to load ${what} from the server.`, 'error');
    };
    await Promise.all([
      fetchReceipts().then(setReceipts).catch(fail('receipts')),
      api.get('/members/', { params: { limit: 500 } })
        .then((res) => setMembers((res.data?.data || []).map((m) => ({
          ...m,
          name: [m.first_name_en, m.last_name_en].filter(Boolean).join(' ')
        }))))
        .catch(fail('members')),
      loadMembers({ approval_status: 'UNAPPROVED' }).then(setUnapprovedMembers).catch(fail('unapproved members')),
      loadParticulars()
        .then((all) => setParticularOptions(all.filter((p) => p.status === 'Active').map((p) => p.name)))
        .catch(fail('particulars')),
      loadPaymentModeConfigs()
        .then((all) => setPaymentModeOptions([...new Set(all.filter((c) => c.status === 'Active').map((c) => c.paymentMode))]))
        .catch(fail('payment modes'))
    ]);
  };

  // Synchronize on mount
  useEffect(() => {
    reloadData();
  }, []);

  // ----------------------------------------------------
  // FILTERING LOGIC
  // ----------------------------------------------------
  const filteredReceipts = useMemo(() => {
    return receipts.filter((r) => {
      const isUnmapped = isReceiptUnmapped(r);

      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const numMatch = (r.receiptNumber || '').toLowerCase().includes(q);
        const nameMatch = (r.name || '').toLowerCase().includes(q);
        const mobileMatch = (r.mobile || '').includes(q);
        const memberNoMatch = (r.membershipNo || '').toLowerCase().includes(q);
        const particularsMatch = (r.particulars || '').toLowerCase().includes(q);
        const txnMatch = (r.transactionId || '').toLowerCase().includes(q);

        if (
          !numMatch &&
          !nameMatch &&
          !mobileMatch &&
          !memberNoMatch &&
          !particularsMatch &&
          !txnMatch
        ) {
          return false;
        }
      }

      // 2. Particulars / Receipt Type Filter
      if (particularsFilter !== 'ALL') {
        const rPart = (r.particulars || '').toLowerCase();
        if (rPart !== particularsFilter.toLowerCase()) {
          return false;
        }
      }

      // Sub type (the detail on a receipt line, e.g. the donation kind)
      if (subTypeFilter !== 'ALL' && !(r.items || []).some((i) => (i.description || '').trim() === subTypeFilter)) {
        return false;
      }

      // 3. Status Filter (Assigned vs Unassigned)
      if (fyFilter !== 'ALL' && fyOf(r.receiptDate) !== fyFilter) return false;
      if (modeFilter !== 'ALL' && (r.paymentMode || '').toLowerCase() !== modeFilter.toLowerCase()) return false;
      if (fromDate && String(r.receiptDate || '') < fromDate) return false;
      if (toDate && String(r.receiptDate || '') > toDate) return false;

      const rs = r.receiptStatus || (isUnmapped ? 'UNASSIGNED' : 'ASSIGNED');
      if (statusFilter === 'Assigned' && rs !== 'ASSIGNED' && rs !== 'APPROVED') return false;
      if (statusFilter === 'Unassigned' && rs !== 'UNASSIGNED') return false;
      if (statusFilter === 'Approved' && rs !== 'APPROVED') return false;
      if (statusFilter === 'Cancelled' && rs !== 'CANCELLED') return false;

      return true;
    });
  }, [receipts, searchQuery, particularsFilter, subTypeFilter, statusFilter, fyFilter, modeFilter, fromDate, toDate]);

  // sub types actually used on the receipt lines
  const subTypeOptions = useMemo(
    () => [...new Set(receipts.flatMap((r) => (r.items || []).map((i) => (i.description || '').trim())).filter(Boolean))].sort(),
    [receipts]
  );

  const fyOptions = useMemo(
    () => [...new Set(receipts.map((r) => fyOf(r.receiptDate)).filter(Boolean))].sort().reverse(),
    [receipts]
  );
  const modeOptions = useMemo(
    () => [...new Set(receipts.map((r) => r.paymentMode).filter(Boolean))].sort(),
    [receipts]
  );
  const unassignedVisible = useMemo(
    () => filteredReceipts.filter((r) => isReceiptUnmapped(r)),
    [filteredReceipts]
  );

  // ----------------------------------------------------
  // EXPORT, DAY BOOK, BULK MAP
  // ----------------------------------------------------
  const exportVisibleReceipts = () => {
    const head = ['Receipt No', 'Date', 'Financial Year', 'Name', 'Mobile', 'Particulars', 'Amount', 'Payment Mode', 'Reference', 'Status'];
    const rows = filteredReceipts.map((r) => [
      r.receiptNumber,
      r.receiptDate,
      fyOf(r.receiptDate),
      r.name,
      r.mobile,
      r.items?.length > 1 ? r.items.map((i) => `${i.particular} ${i.amount}`).join('; ') : r.particulars,
      r.amount,
      r.paymentMode,
      r.transactionId,
      r.receiptStatus === 'CANCELLED' ? 'Cancelled' : isReceiptUnmapped(r) ? 'Unassigned' : 'Assigned'
    ]);
    const csv = [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `receipts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    showToast(`Exported ${rows.length} receipt(s).`);
  };

  const loadDayBook = async (date) => {
    try {
      const { data } = await api.get('/receipts/day-book', { params: { from_date: date, to_date: date } });
      setDayBook({ date, data });
    } catch (error) {
      showToast(apiErrorMessage(error, 'Could not load the day book.'), 'error');
    }
  };

  const toggleSelected = (id) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleBulkMap = async () => {
    const chosen = receipts.filter((r) => selectedIds.has(r.id));
    if (!chosen.length) return;
    const total = chosen.filter((r) => r.receiptStatus !== 'CANCELLED').reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const v = await askForm({
      title: `Map ${chosen.length} receipt(s) (${formatMoney(total)}) to one member`,
      confirmText: 'Map receipts',
      fields: [
        {
          name: 'memberId',
          label: 'Member',
          type: 'select',
          required: true,
          options: members.map((m) => ({
            value: m.id,
            label: `${m.name || m.first_name_en || ''}${(m.membership_number || m.member_code) ? ` (${m.membership_number || m.member_code})` : ` (App ID #${m.id})`}`
          }))
        }
      ]
    });
    if (!v) return;
    let done = 0;
    const failed = [];
    for (const r of chosen) {
      try {
        await api.post(
          `/receipts/${r.id}/allocate`,
          { member_id: Number(v.memberId), allocated_amount: r.amount },
          { params: { reason: 'Bulk mapping from Receipt Tracking' } }
        );
        done += 1;
      } catch (error) {
        failed.push(`#${r.receiptNumber}: ${apiErrorMessage(error, 'failed')}`);
      }
    }
    setSelectedIds(new Set());
    await reloadData();
    if (failed.length) showToast(`Mapped ${done}. Failed: ${failed.join(' | ')}`, 'error');
    else showToast(`Mapped ${done} receipt(s) to the member.`);
  };

  // ----------------------------------------------------
  // ACTION HANDLERS
  // ----------------------------------------------------

  // 1. Edit: the Receipt Entry screen, opened on this receipt
  const handleOpenEdit = (receipt) => navigate(`/dashboard/receipts/edit/${receipt.id}`);

  // 2. Delete Receipt
  // ----------------------------------------------------
  // RECEIPT ACTIONS (all server calls): map / unmap, refund, cancel
  // ----------------------------------------------------
  const isPendingApproval = (data) => Boolean(data && (data.approval_request_id || data.status === 'PENDING'));

  const afterReceiptAction = async (data, doneMessage, pendingMessage) => {
    showToast(isPendingApproval(data) ? pendingMessage : doneMessage);
    setViewingReceipt(null);
    await reloadData();
  };

  const handleMapReceipt = async (receipt) => {
    const v = await askForm({
      title: `Map receipt #${receipt.receiptNumber} to a member`,
      confirmText: 'Map receipt',
      fields: [
        {
          name: 'memberId',
          label: 'Member',
          type: 'select',
          required: true,
          options: members.map((m) => ({
            value: m.id,
            label: `${m.name || m.first_name_en || ''}${(m.membership_number || m.member_code) ? ` (${m.membership_number || m.member_code})` : ` (App ID #${m.id})`}`
          }))
        },
        { name: 'amount', label: 'Amount to allocate', type: 'number', required: true, value: receipt.amount }
      ]
    });
    if (!v) return;
    try {
      const { data } = await api.post(`/receipts/${receipt.id}/allocate`, {
        member_id: Number(v.memberId),
        allocated_amount: v.amount
      });
      await afterReceiptAction(data, 'Receipt mapped to the member.', 'Mapping submitted for approval.');
    } catch (error) {
      showToast(error.response?.data?.detail || 'Error mapping the receipt', 'error');
    }
  };

  const handleRemoveMapping = async (receipt) => {
    try {
      const { data: allocations } = await api.get(`/receipts/${receipt.id}/allocations`);
      if (!allocations.length) {
        showToast('This receipt is not mapped to anyone.', 'error');
        return;
      }
      let target = allocations[0];
      if (allocations.length > 1) {
        const v = await askForm({
          title: 'Remove which mapping?',
          confirmText: 'Remove',
          fields: [{
            name: 'allocationId',
            label: 'Mapping',
            type: 'select',
            required: true,
            options: allocations.map((a) => ({
              value: a.id,
              label: `${a.member_name || a.associate_name || `#${a.id}`} - ${a.allocated_amount}`
            }))
          }]
        });
        if (!v) return;
        target = allocations.find((a) => String(a.id) === String(v.allocationId));
      } else {
        const ok = await confirmYesNo({
          title: 'Remove the mapping?',
          text: `Receipt #${receipt.receiptNumber} will no longer be mapped to ${target.member_name || 'this member'}.`,
          confirmText: 'Yes, remove',
          danger: true
        });
        if (!ok) return;
      }
      const { data } = await api.delete(`/receipts/${receipt.id}/allocations/${target.id}`);
      await afterReceiptAction(data, 'Mapping removed.', 'Removal submitted for approval.');
    } catch (error) {
      showToast(error.response?.data?.detail || 'Error removing the mapping', 'error');
    }
  };

  const handleRefundReceipt = async (receipt) => {
    const v = await askForm({
      title: `Refund receipt #${receipt.receiptNumber}`,
      confirmText: 'Record refund',
      fields: [
        { name: 'amount', label: 'Refund amount', type: 'number', required: true, value: receipt.amount },
        { name: 'reference', label: 'Refund reference (optional)' }
      ]
    });
    if (!v) return;
    try {
      const { data } = await api.post(`/receipts/${receipt.id}/refund`, {
        amount: v.amount,
        status: 'PENDING',
        refund_reference: v.reference || null
      });
      await afterReceiptAction(data, 'Refund recorded.', 'Refund submitted for approval.');
    } catch (error) {
      showToast(error.response?.data?.detail || 'Error recording the refund', 'error');
    }
  };

  const handleCancelReceipt = async (receipt) => {
    const reason = await askReason({
      title: `Cancel receipt #${receipt.receiptNumber}?`,
      text: 'A cancelled receipt stays on record but no longer counts as paid.',
      confirmText: 'Yes, cancel receipt',
      danger: true
    });
    if (!reason) return;
    try {
      const { data } = await api.post(`/receipts/${receipt.id}/cancel`, { reason });
      await afterReceiptAction(data, 'Receipt cancelled.', 'Cancellation submitted for approval.');
    } catch (error) {
      showToast(error.response?.data?.detail || 'Error cancelling the receipt', 'error');
    }
  };

  const deleteInFlight = useRef(false);

  const handleConfirmDelete = async () => {
    if (!deletingReceipt || deleteInFlight.current) return;
    deleteInFlight.current = true;

    const num = deletingReceipt.receiptNumber;
    try {
      await api.delete(`/receipts/${deletingReceipt.id}`, { params: { reason: 'Deleted via UI' } });
      setReceipts((prev) => prev.filter((r) => r.id !== deletingReceipt.id));
      showToast(`Receipt #${num} deleted successfully.`);
    } catch (error) {
      if (error.response?.status === 404) {
        // Already removed (e.g. a repeated click): just refresh the list.
        setReceipts((prev) => prev.filter((r) => r.id !== deletingReceipt.id));
        showToast(`Receipt #${num} was already deleted.`);
        reloadData();
      } else {
        console.error('Failed to delete receipt.', error);
        showToast(error.response?.data?.detail || 'Failed to delete receipt through API.', 'error');
      }
    } finally {
      deleteInFlight.current = false;
    }

    setDeletingReceipt(null);
  };

  useSwalConfirm(
    deletingReceipt,
    () => setDeletingReceipt(null),
    (d) => ({
      title: 'Delete receipt?',
      text: `Are you sure you want to delete receipt #${d.receiptNumber}? This will permanently remove the record.`,
      confirmText: 'Yes, delete',
      danger: true,
    }),
    handleConfirmDelete
  );

  return (
    <PermissionGate required="receipts.tracking.read">
    <div className="space-y-6 pb-16 font-sans">
      {/* Toast Alert Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-[10000] flex items-center gap-3 rounded-2xl px-5 py-3.5 shadow-2xl border transition-all animate-in slide-in-from-bottom-4 duration-200 ${
            toastMessage.type === 'error'
              ? 'bg-[#180200] text-white border-red-500/50'
              : 'bg-[#180200] text-white border-emerald-500/50'
          }`}
        >
          {toastMessage.type === 'error' ? (
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          )}
          <span className="text-xs sm:text-sm font-medium">{toastMessage.message}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 rounded-lg p-1 hover:bg-white/10 text-stone-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header, Filter & Search Toolbar */}
      <SearchFilterBar
        searchInHeader
        title={<h1 className="text-xl sm:text-2xl font-bold text-[#180200] tracking-tight">Receipt Tracking</h1>}
        searchQuery={searchQuery}
        onSearchChange={(val) => setSearchQuery(val)}
        activeFiltersCount={
          (particularsFilter !== 'ALL' ? 1 : 0) +
          (subTypeFilter !== 'ALL' ? 1 : 0) +
          (statusFilter !== 'ALL' ? 1 : 0) +
          (fyFilter !== 'ALL' ? 1 : 0) +
          (modeFilter !== 'ALL' ? 1 : 0) +
          (fromDate || toDate ? 1 : 0)
        }
        onResetFilters={() => {
          setSearchQuery('');
          setParticularsFilter('ALL');
          setSubTypeFilter('ALL');
          setStatusFilter('ALL');
          setFyFilter('ALL');
          setModeFilter('ALL');
          setFromDate('');
          setToDate('');
        }}
        rightSlot={
          <>
            {hasPermission('receipts.tracking.write') && (
              <button
                type="button"
                onClick={() => {
                  setSelectionMode((on) => !on);
                  setSelectedIds(new Set());
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border cursor-pointer ${
                  selectionMode ? 'text-white bg-[#510601] border-[#510601]' : 'text-[#510601] bg-white border-[#E8DFD8] hover:bg-[#FAF7F2]'
                }`}
                title="Select unassigned receipts to map to one member"
              >
                <CheckSquare className="w-4 h-4" />
                {selectionMode ? 'Done' : 'Select'}
              </button>
            )}
            <button
              type="button"
              onClick={() => loadDayBook(new Date().toISOString().slice(0, 10))}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#510601] bg-white border border-[#E8DFD8] rounded-xl hover:bg-[#FAF7F2] cursor-pointer"
            >
              <Calendar className="w-4 h-4" />
              Day Book
            </button>
            <button
              type="button"
              onClick={exportVisibleReceipts}
              disabled={filteredReceipts.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#510601] rounded-xl hover:bg-[#3D0400] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Export
            </button>
          </>
        }
      >
        {/* Financial Year / Payment Mode / Date range */}
        <FilterSelect
          value={fyFilter}
          onChange={(val) => setFyFilter(val)}
          options={[{ value: 'ALL', label: 'All Financial Years' }, ...fyOptions.map((f) => ({ value: f, label: `FY ${f}` }))]}
          widthClass="w-full sm:w-44"
        />
        <FilterSelect
          value={modeFilter}
          onChange={(val) => setModeFilter(val)}
          options={[{ value: 'ALL', label: 'All Payment Modes' }, ...modeOptions.map((m) => ({ value: m, label: m }))]}
          widthClass="w-full sm:w-48"
        />
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          title="From date"
          className="px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601]"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          title="To date"
          className="px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601]"
        />

        {/* Receipt Type Filter */}
        <FilterSelect
          value={particularsFilter}
          onChange={(val) => setParticularsFilter(val)}
          options={[
            { value: 'ALL', label: 'All Receipt Types' },
            ...particularOptions.map((opt) => ({ value: opt, label: opt }))
          ]}
          widthClass="w-full sm:w-56"
        />

        {/* Sub Type Filter */}
        <FilterSelect
          value={subTypeFilter}
          onChange={(val) => setSubTypeFilter(val)}
          options={[{ value: 'ALL', label: 'All Sub Types' }, ...subTypeOptions.map((t) => ({ value: t, label: t }))]}
          widthClass="w-full sm:w-52"
        />

        {/* Status Filter */}
        <FilterSelect
          value={statusFilter}
          onChange={(val) => setStatusFilter(val)}
          options={[
            { value: 'ALL', label: 'All Statuses' },
            { value: 'Assigned', label: 'Assigned' },
            { value: 'Unassigned', label: 'Unassigned' },
            { value: 'Approved', label: 'Approved' },
            { value: 'Cancelled', label: 'Cancelled' }
          ]}
          widthClass="w-full sm:w-48"
        />
      </SearchFilterBar>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-xs">
          <span className="font-semibold text-[#180200]">{selectedIds.size} unassigned receipt(s) selected</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 font-semibold text-[#863221] border border-[#E8DFD8] bg-white rounded-lg cursor-pointer"
            >
              Clear
            </button>
            {hasPermission('receipts.tracking.write') && (
              <button
                type="button"
                onClick={handleBulkMap}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 font-bold text-white bg-[#510601] rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <LinkIcon className="w-3.5 h-3.5" />
                Map to a member
              </button>
            )}
          </div>
        </div>
      )}

      {/* Phone layout: one card per receipt */}
      <div className="sm:hidden space-y-2.5">
        {filteredReceipts.length === 0 && (
          <p className="py-10 text-center text-sm text-[#863221]">No receipts found</p>
        )}
        {filteredReceipts.map((receipt) => {
          const unmapped = isReceiptUnmapped(receipt);
          return (
            <div
              key={receipt.id}
              className={`rounded-2xl border p-3.5 ${unmapped ? 'bg-amber-50/70 border-amber-200' : 'bg-white border-[#E8DFD8]'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono font-bold text-xs text-[#510601]">#{receipt.receiptNumber}</div>
                  <div className="text-sm font-bold text-[#180200] truncate">{receipt.name || '—'}</div>
                  <div className="text-[11px] text-[#863221]">
                    {formatDate(receipt.receiptDate)} · {receipt.paymentMode || '—'}
                    {receipt.items?.length > 1 ? ` · ${receipt.items.length} particulars` : ` · ${receipt.particulars || ''}`}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono font-bold text-sm">{formatMoney(receipt.amount)}</div>
                  {unmapped && <div className="text-[10px] font-bold text-amber-700">Unassigned</div>}
                  {receipt.receiptStatus === 'CANCELLED' && <div className="text-[10px] font-bold text-red-700">Cancelled</div>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {unmapped && selectionMode && (
                  <label className="mr-auto inline-flex items-center gap-1.5 text-[11px] text-[#863221]">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(receipt.id)}
                      onChange={() => toggleSelected(receipt.id)}
                      className="accent-[#510601]"
                    />
                    Select
                  </label>
                )}
                <button type="button" onClick={() => setViewingReceipt(receipt)} className="btn-act" title="View"><Eye className="w-3.5 h-3.5" /><span>View</span></button>
                {hasPermission('receipts.tracking.write') && (
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(receipt)}
                    className="btn-act"
                    title="Edit"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Table Card (EXACTLY 6 Columns) */}
      <div className="hidden sm:block bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-bold text-[#863221] uppercase tracking-wider">
                {selectionMode && <th className="py-3.5 pl-4 pr-0 w-8">
                  <input
                    type="checkbox"
                    title="Select all unassigned receipts shown"
                    checked={unassignedVisible.length > 0 && unassignedVisible.every((r) => selectedIds.has(r.id))}
                    disabled={unassignedVisible.length === 0}
                    onChange={(e) => setSelectedIds(e.target.checked ? new Set(unassignedVisible.map((r) => r.id)) : new Set())}
                    className="cursor-pointer accent-[#510601]"
                  />
                </th>}
                <th className="py-3.5 px-4 whitespace-nowrap">Receipt No.</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Date</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Name</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Particulars</th>
                <th className="py-3.5 px-4 text-right whitespace-nowrap">Amount</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Mode</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Status</th>
                <th className="py-3.5 px-4 text-right whitespace-nowrap min-w-[170px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8] text-xs sm:text-sm">
              {filteredReceipts.length === 0 ? (
                <tr>
                  <td colSpan="9" className="py-14 text-center text-[#863221]">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <FileSpreadsheet className="w-10 h-10 text-[#863221]/40" />
                      <p className="text-base font-bold text-[#180200]">No receipts found</p>
                      <p className="text-xs text-[#863221] max-w-sm mx-auto">
                        Every receipt in the system (assigned and unassigned) will appear here.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredReceipts.map((receipt) => {
                  const isUnmapped = isReceiptUnmapped(receipt);

                  return (
                    <tr
                      key={receipt.id}
                      className="transition-colors bg-white hover:bg-[#FAF7F2] text-[#180200]"
                    >
                      {selectionMode && <td className="py-3.5 pl-4 pr-0 w-8">
                        {isUnmapped && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(receipt.id)}
                            onChange={() => toggleSelected(receipt.id)}
                            className="cursor-pointer accent-[#510601]"
                          />
                        )}
                      </td>}
                      {/* Column 1: Receipt Number */}
                      <td className="py-3.5 px-4 font-mono font-bold text-xs">
                        <span className="text-[#510601] tracking-wider">#{receipt.receiptNumber}</span>
                      </td>

                      {/* Column 2: Receipt Date */}
                      <td className="py-3.5 px-4 font-mono text-xs whitespace-nowrap">
                        {formatDate(receipt.receiptDate)}
                      </td>

                      {/* Column 3: Member Name */}
                      <td className="py-3.5 px-4">
                        <div>
                          <span className="font-bold text-[#180200]">{receipt.name || '—'}</span>
                          {(receipt.mobile || (!isUnmapped && receipt.membershipNo)) && (
                            <div className="text-[11px] font-mono text-[#863221] mt-0.5">
                              {[!isUnmapped && receipt.membershipNo ? `#${receipt.membershipNo}` : '', receipt.mobile].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Column 5: Receipt Type */}
                      <td className="py-3.5 px-4 font-semibold text-[#510601] text-xs">
                        {receipt.items?.length > 1 ? receipt.items[0].particular : receipt.particulars || 'Membership'}
                        {receipt.items?.length > 1 && (
                          <span
                            className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[#FAF7F2] border border-[#E8DFD8] text-[10px] font-bold text-[#863221]"
                            title={receipt.items.map((i) => `${i.particular}${i.description && i.description !== i.particular ? ` (${i.description})` : ''}: ${formatMoney(i.amount)}`).join(', ')}
                          >
                            +{receipt.items.length - 1} more
                          </span>
                        )}
                      </td>

                      {/* Column 5b/5c: Amount and Payment Mode */}
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-xs whitespace-nowrap">
                        {formatMoney(receipt.amount)}
                      </td>
                      <td className="py-3.5 px-4 text-xs">{receipt.paymentMode || '—'}</td>
                      <td className="py-3.5 px-4"><StatusDot receipt={receipt} /></td>

                      {/* Column 6: Action */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {/* View Action */}
                          <button
                            type="button"
                            onClick={() => setViewingReceipt(receipt)}
                            className="btn-act"
                            title="View Receipt Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View</span>
                          </button>

                          {/* Edit Action */}
                          {hasPermission('receipts.tracking.write') && (
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(receipt)}
                              className="btn-act"
                              title={'Edit Receipt'}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>Edit</span>
                            </button>
                          )}

                          {/* Delete Action */}
                          {hasPermission('receipts.tracking.delete') && (
                            <button
                              type="button"
                              onClick={() => setDeletingReceipt(receipt)}
                              className="btn-act btn-act-danger"
                              title={'Delete Receipt'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary bar */}
        <div className="px-5 py-3.5 bg-[#FAF7F2]/60 border-t border-[#E8DFD8] flex flex-col sm:flex-row items-center justify-between text-xs text-[#863221] gap-2">
          <div>
            Showing <strong className="text-[#180200]">{filteredReceipts.length}</strong> of{' '}
            <strong className="text-[#180200]">{receipts.length}</strong> total receipts
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">
              <span className="w-2 h-2 rounded-full bg-emerald-600" />
              <span>{receipts.filter((r) => !isReceiptUnmapped(r)).length} Assigned</span>
            </span>
            <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>{receipts.filter((r) => isReceiptUnmapped(r)).length} Unassigned</span>
            </span>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* MODAL 1: VIEW RECEIPT DETAILS                                */}
      {/* ============================================================ */}
      <Modal isOpen={Boolean(viewingReceipt)} onClose={() => setViewingReceipt(null)}>
        {viewingReceipt && (
          <div className="bg-white rounded-2xl max-w-3xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#510601] text-white flex items-center justify-center font-bold">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[#180200]">
                    Receipt #{viewingReceipt.receiptNumber}
                  </h2>
                  <p className="text-xs text-[#863221]">
                    Issued on {formatDate(viewingReceipt.receiptDate)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setViewingReceipt(null)}
                className="p-1.5 rounded-lg text-stone-400 hover:text-[#510601] hover:bg-stone-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              {/* Status Header Chip */}
              <div className="p-3 bg-[#FAF7F2]/60 rounded-xl border border-[#E8DFD8] flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221] block">Status</span>
                  {isReceiptUnmapped(viewingReceipt) ? (
                    <span className="inline-flex items-center gap-1 mt-0.5 px-2.5 py-0.5 rounded-md text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                      <span>Unassigned</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 mt-0.5 px-2.5 py-0.5 rounded-md text-xs font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Assigned to Member #{viewingReceipt.membershipNo || viewingReceipt.memberId}</span>
                    </span>
                  )}
                </div>

                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-[#863221] block">Amount Paid</span>
                  <span className="text-base font-extrabold text-[#510601]">
                    {formatMoney(viewingReceipt.amount)}
                  </span>
                </div>
              </div>

              {/* Member Details */}
              <div className="bg-white rounded-xl p-4 border border-[#E8DFD8] space-y-2.5">
                <span className="text-[11px] font-bold text-[#510601] uppercase tracking-wider flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" />
                  <span>Member / Payee Information</span>
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Name</span>
                    <p className="font-bold text-[#180200] mt-0.5">
                      {viewingReceipt.name || <span className="text-gray-400 italic">Unassigned</span>}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Membership No.</span>
                    <p className="font-mono mt-0.5">{viewingReceipt.membershipNo || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Mobile</span>
                    <p className="font-mono mt-0.5">{viewingReceipt.mobile || '—'}</p>
                  </div>
                  {viewingReceipt.panNo && (
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#863221]">PAN</span>
                      <p className="font-mono mt-0.5">{viewingReceipt.panNo}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Payment Details */}
              <div className="bg-white rounded-xl p-4 border border-[#E8DFD8] space-y-2.5">
                <span className="text-[11px] font-bold text-[#510601] uppercase tracking-wider flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>Payment & Transaction</span>
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Receipt Type</span>
                    <p className="font-bold text-[#510601] mt-0.5">{viewingReceipt.particulars || 'Membership'}</p>
                  </div>
                  {viewingReceipt.items?.length > 1 && (
                    <div className="col-span-2 sm:col-span-3">
                      <span className="text-[10px] uppercase font-bold text-[#863221]">Particulars</span>
                      <div className="mt-1 rounded-xl border border-[#E8DFD8] overflow-hidden">
                        {viewingReceipt.items.map((it, i) => (
                          <div key={it.id || i} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs border-b last:border-b-0 border-[#E8DFD8]/70">
                            <span className="font-semibold text-[#180200]">
                              {i + 1}. {it.particular}
                              {it.description && it.description !== it.particular && (
                                <span className="font-normal text-[#863221]"> — {it.description}</span>
                              )}
                            </span>
                            <span className="font-mono font-bold">{formatMoney(it.amount)}</span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between px-3 py-1.5 text-xs bg-[#FAF7F2] font-bold">
                          <span>Total</span>
                          <span className="font-mono">{formatMoney(viewingReceipt.amount)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Payment Mode</span>
                    <p className="font-medium mt-0.5">{viewingReceipt.paymentMode || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Amount in Words</span>
                    <p className="italic text-[#863221] mt-0.5">{numberToWords(viewingReceipt.amount)}</p>
                  </div>
                  {viewingReceipt.bankName && (
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#863221]">Bank / Account</span>
                      <p className="font-medium mt-0.5">{viewingReceipt.bankName}</p>
                    </div>
                  )}
                  {viewingReceipt.transactionId && (
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#863221]">Txn ID / Cheque No.</span>
                      <p className="font-mono mt-0.5">{viewingReceipt.transactionId}</p>
                    </div>
                  )}
                </div>

                {(viewingReceipt.periodFromDate || viewingReceipt.periodToDate || viewingReceipt.periodFromTime || viewingReceipt.periodToTime) && (
                  <div className="pt-2 border-t border-[#E8DFD8]">
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Period</span>
                    <p className="mt-0.5 text-[#180200]">
                      {[
                        [viewingReceipt.periodFromDate, viewingReceipt.periodToDate].filter(Boolean).map(formatDate).join(' to '),
                        [viewingReceipt.periodFromTime, viewingReceipt.periodToTime].filter(Boolean).map((t) => String(t).slice(0, 5)).join(' to ')
                      ].filter(Boolean).join(', ')}
                    </p>
                  </div>
                )}

                {viewingReceipt.description && (
                  <div className="pt-2 border-t border-[#E8DFD8]">
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Remarks / Description</span>
                    <p className="mt-0.5 text-[#180200]">{viewingReceipt.description}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Read-only footer */}
            <ModalFooter kind="view" onCancel={() => setViewingReceipt(null)} />
          </div>
        )}
      </Modal>

      {/* ============================================================ */}
      {/* DAY BOOK                                                     */}
      {/* ============================================================ */}
      <Modal isOpen={Boolean(dayBook)} onClose={() => setDayBook(null)}>
        {dayBook && (
          <div className="bg-white rounded-2xl max-w-lg w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold text-[#180200] font-serif">Day Book</h3>
              <input
                type="date"
                value={dayBook.date}
                onChange={(e) => e.target.value && loadDayBook(e.target.value)}
                className="px-3 py-1.5 bg-white border border-[#E8DFD8] rounded-xl text-xs focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div className="p-6">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-[#863221]">{dayBook.data.receipt_count} receipt(s)</span>
              <span className="text-2xl font-bold font-mono text-[#510601]">{formatMoney(dayBook.data.total)}</span>
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-bold text-[#863221] uppercase tracking-wider text-[10px] mb-1.5">By payment mode</p>
                {dayBook.data.by_payment_mode.length === 0 && <p className="text-[#863221]/70">No receipts.</p>}
                {dayBook.data.by_payment_mode.map((m) => (
                  <div key={m.payment_mode} className="flex justify-between py-1 border-b border-[#E8DFD8]/60">
                    <span>{m.payment_mode} <span className="text-[#863221]/70">({m.count})</span></span>
                    <span className="font-mono font-bold">{formatMoney(m.amount)}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="font-bold text-[#863221] uppercase tracking-wider text-[10px] mb-1.5">By particular</p>
                {dayBook.data.by_particular.length === 0 && <p className="text-[#863221]/70">No receipts.</p>}
                {dayBook.data.by_particular.map((p) => (
                  <div key={p.particular} className="flex justify-between py-1 border-b border-[#E8DFD8]/60">
                    <span>{p.particular}</span>
                    <span className="font-mono font-bold">{formatMoney(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
            </div>
            <ModalFooter kind="view" onCancel={() => setDayBook(null)} />
          </div>
        )}
      </Modal>
    </div>
    </PermissionGate>
  );
}
