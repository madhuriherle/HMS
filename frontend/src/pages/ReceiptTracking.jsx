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
  CreditCard
} from 'lucide-react';
import Modal from '../components/Modal';
import { isReceiptUnmapped } from '../utils/displayHelpers';
import { loadParticulars, loadPaymentModeConfigs } from '../utils/serverData';
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
// What a receipt line is called: the sub type the clerk picked, else the particular itself
const lineLabel = (i) => {
  const sub = (i.description || '').trim();
  return sub && sub.toLowerCase() !== String(i.particular || '').trim().toLowerCase() ? sub : (i.particular || '');
};

// the full name of a line: "Particular › sub type" (just the particular when there is no sub type)
const fullLabel = (i) => (lineLabel(i) !== i.particular ? `${i.particular} › ${lineLabel(i)}` : i.particular || '');

// Receipt Type cell: "Particular › sub type" (wraps when narrow), "+N" for more lines, and a hover card listing every line
function TypeCell({ receipt }) {
  const [tip, setTip] = useState(null);
  const items = receipt.items || [];
  const first = items[0];
  const label = first ? fullLabel(first) : receipt.particulars || 'Membership';
  const more = items.length - 1;
  const show = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ left: Math.min(r.left, window.innerWidth - 340), top: r.bottom + 6 });
  };
  return (
    <div className="max-w-[220px] whitespace-normal break-words leading-snug" onMouseEnter={show} onMouseLeave={() => setTip(null)}>
      <span className="cursor-default">{label}</span>
      {more > 0 && (
        <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[#FAF7F2] border border-[#E8DFD8] text-[10px] font-bold text-[#863221]">
          +{more}
        </span>
      )}
      {tip && items.length > 0 && (
        <div style={{ position: 'fixed', left: tip.left, top: tip.top, width: 320 }} className="z-50 rounded-xl border border-[#E8DFD8] bg-white p-3 shadow-xl">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[#863221]">Receipt {receipt.receiptNumber}</p>
          <ul className="divide-y divide-[#E8DFD8]">
            {items.map((i, idx) => (
              <li key={idx} className="flex items-start justify-between gap-3 py-1.5 text-xs">
                <span className="min-w-0">
                  <span className="block font-semibold text-[#180200]">{fullLabel(i)}</span>
                </span>
                <span className="shrink-0 font-mono font-bold text-[#510601]">{formatMoney(i.amount)}</span>
              </li>
            ))}
          </ul>
          {items.length > 1 && (
            <div className="mt-1 flex justify-between border-t border-[#E8DFD8] pt-1.5 text-xs font-bold text-[#180200]">
              <span>Total</span>
              <span className="font-mono">{formatMoney(receipt.amount)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState(() => new URLSearchParams(window.location.search).get('search') || '');
  const [particularsFilter, setParticularsFilter] = useState('ALL');
  const [subTypeFilter, setSubTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL'); // ALL, Assigned, Unassigned
  const [fyFilter, setFyFilter] = useState('ALL');
  const [modeFilter, setModeFilter] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [periodMode, setPeriodMode] = useState('ALL'); // ALL, TODAY, MONTH, FY, CUSTOM
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
      if (
        modeFilter !== 'ALL' &&
        (r.paymentMode || '').toLowerCase() !== modeFilter.toLowerCase() &&
        (r.bankAccount || '').toLowerCase() !== modeFilter.toLowerCase()
      ) {
        return false;
      }
      if (fromDate && String(r.receiptDate || '') < fromDate) return false;
      if (toDate && String(r.receiptDate || '') > toDate) return false;

      const rs = r.receiptStatus || (isUnmapped ? 'UNASSIGNED' : 'ASSIGNED');
      if (statusFilter === 'Assigned' && rs !== 'ASSIGNED') return false;
      if (statusFilter === 'Unassigned' && rs !== 'UNASSIGNED') return false;
      if (statusFilter === 'Cancelled' && rs !== 'CANCELLED') return false;

      return true;
    });
  }, [receipts, searchQuery, particularsFilter, subTypeFilter, statusFilter, fyFilter, modeFilter, fromDate, toDate]);

  // Receipt Type and Sub Type as one list: each type, then its sub types under it
  const typeOptions = useMemo(() => {
    const subsOf = {};
    receipts.forEach((r) => {
      (r.items || []).forEach((i) => {
        const d = (i.description || '').trim();
        if (d && d.toLowerCase() !== String(r.particulars || '').toLowerCase()) {
          if (!subsOf[r.particulars]) subsOf[r.particulars] = new Set();
          subsOf[r.particulars].add(d);
        }
      });
    });
    const out = [{ value: 'ALL', label: 'All Receipt Types' }];
    particularOptions.forEach((t) => {
      const subs = [...(subsOf[t] || [])].sort();
      out.push({ value: `T|${t}`, label: subs.length ? `${t} (all)` : t, bold: true });
      subs.forEach((s) => out.push({ value: `S|${s}`, label: s, indent: true }));
    });
    return out;
  }, [receipts, particularOptions]);

  const chooseType = (val) => {
    if (val === 'ALL') {
      setParticularsFilter('ALL');
      setSubTypeFilter('ALL');
    } else if (val.startsWith('T|')) {
      setParticularsFilter(val.slice(2));
      setSubTypeFilter('ALL');
    } else {
      setParticularsFilter('ALL');
      setSubTypeFilter(val.slice(2));
    }
  };

  const choosePeriod = (val) => {
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const now = new Date();
    setFyFilter('ALL');
    setFromDate('');
    setToDate('');
    if (val.startsWith('FY|')) {
      setPeriodMode('FY');
      setFyFilter(val.slice(3));
    } else if (val === 'TODAY') {
      setPeriodMode('TODAY');
      setFromDate(iso(now));
      setToDate(iso(now));
    } else if (val === 'MONTH') {
      setPeriodMode('MONTH');
      setFromDate(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
      setToDate(iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
    } else {
      setPeriodMode(val);
    }
  };

  const fyOptions = useMemo(
    () => [...new Set(receipts.map((r) => fyOf(r.receiptDate)).filter(Boolean))].sort().reverse(),
    [receipts]
  );
  // every active mode from Payment Mode Setup, plus any mode a receipt already carries that the master lacks
  const modeOptions = useMemo(() => {
    const out = [...paymentModeOptions];
    const have = new Set(out.map((m) => m.toLowerCase()));
    receipts.forEach((r) => {
      if (r.paymentMode && !have.has(r.paymentMode.toLowerCase()) && !(r.bankAccount && have.has(r.bankAccount.toLowerCase()))) {
        have.add(r.paymentMode.toLowerCase());
        out.push(r.paymentMode);
      }
    });
    return out.sort((a, b) => a.localeCompare(b));
  }, [receipts, paymentModeOptions]);
  // ----------------------------------------------------
  // EXPORT, DAY BOOK
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

  // ----------------------------------------------------
  // ACTION HANDLERS
  // ----------------------------------------------------

  // 1. Edit: the Receipt Entry screen, opened on this receipt
  const handleOpenEdit = (receipt) => navigate(`/dashboard/receipts/edit/${receipt.id}`);

  // 2. Delete Receipt
  // ----------------------------------------------------
  // RECEIPT ACTIONS (all server calls): refund, cancel
  // ----------------------------------------------------
  const isPendingApproval = (data) => Boolean(data && (data.approval_request_id || data.status === 'PENDING'));

  const afterReceiptAction = async (data, doneMessage, pendingMessage) => {
    showToast(isPendingApproval(data) ? pendingMessage : doneMessage);
    setViewingReceipt(null);
    await reloadData();
  };

  const handleRefundReceipt = async (receipt) => {
    const v = await askForm({
      title: `Refund receipt ${receipt.receiptNumber}`,
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
      title: `Cancel receipt ${receipt.receiptNumber}?`,
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
      showToast(`Receipt ${num} deleted successfully.`);
    } catch (error) {
      if (error.response?.status === 404) {
        // Already removed (e.g. a repeated click): just refresh the list.
        setReceipts((prev) => prev.filter((r) => r.id !== deletingReceipt.id));
        showToast(`Receipt ${num} was already deleted.`);
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
      text: `Are you sure you want to delete receipt ${d.receiptNumber}? This will permanently remove the record.`,
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
          setPeriodMode('ALL');
        }}
        rightSlot={
          <>
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
        {/* Period: one dropdown for the financial year and the date range */}
        <FilterSelect
          value={periodMode === 'FY' ? `FY|${fyFilter}` : periodMode}
          onChange={choosePeriod}
          options={[
            { value: 'ALL', label: 'All Time' },
            { value: 'TODAY', label: 'Today' },
            { value: 'MONTH', label: 'This Month' },
            ...fyOptions.map((f) => ({ value: `FY|${f}`, label: `FY ${f}` })),
            { value: 'CUSTOM', label: 'Custom Dates...' }
          ]}
          widthClass="w-full sm:w-44"
        />
        {periodMode === 'CUSTOM' && (
          <>
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
          </>
        )}

        {/* Receipt Type and Sub Type in one list: each type, then its sub types under it */}
        <FilterSelect
          value={subTypeFilter !== 'ALL' ? `S|${subTypeFilter}` : particularsFilter !== 'ALL' ? `T|${particularsFilter}` : 'ALL'}
          onChange={chooseType}
          options={typeOptions}
          widthClass="w-full sm:w-56"
        />

        {/* Status Filter */}
        <FilterSelect
          value={statusFilter}
          onChange={(val) => setStatusFilter(val)}
          options={[
            { value: 'ALL', label: 'All Statuses' },
            { value: 'Assigned', label: 'Assigned' },
            { value: 'Unassigned', label: 'Unassigned' },
            { value: 'Cancelled', label: 'Cancelled' }
          ]}
          widthClass="w-full sm:w-48"
        />

        {/* Payment Mode */}
        <FilterSelect
          value={modeFilter}
          onChange={(val) => setModeFilter(val)}
          options={[{ value: 'ALL', label: 'All Payment Modes' }, ...modeOptions.map((m) => ({ value: m, label: m }))]}
          widthClass="w-full sm:w-48"
        />
      </SearchFilterBar>

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
                  <div className="font-mono font-bold text-xs text-[#510601]">{receipt.receiptNumber}</div>
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
                  <td colSpan="8" className="py-14 text-center text-[#863221]">
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
                      {/* Column 1: Receipt Number */}
                      <td className="py-3.5 px-4 font-mono font-bold text-xs">
                        <span className="text-[#510601] tracking-wider">{receipt.receiptNumber}</span>
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
                              {[!isUnmapped && receipt.membershipNo ? `${receipt.membershipNo}` : '', receipt.mobile].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Column 5: Receipt Type */}
                      <td className="py-3.5 px-4 font-semibold text-[#510601] text-xs">
                        <TypeCell receipt={receipt} />
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
        <div className="px-5 py-3.5 bg-[#FAF7F2] border-t border-[#E8DFD8] flex flex-col sm:flex-row items-center justify-between text-xs text-[#863221] gap-2">
          <div>
            Showing <strong className="text-[#180200]">{filteredReceipts.length}</strong> of{' '}
            <strong className="text-[#180200]">{receipts.length}</strong> total receipts
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">
              <span className="w-2 h-2 rounded-full bg-emerald-600" />
              <span>{receipts.filter((r) => r.receiptStatus === 'ASSIGNED').length} Assigned</span>
            </span>
            <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>{receipts.filter((r) => isReceiptUnmapped(r)).length} Unassigned</span>
            </span>
            <span className="inline-flex items-center gap-1 font-semibold text-red-800">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span>{receipts.filter((r) => r.receiptStatus === 'CANCELLED').length} Cancelled</span>
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
            <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#510601] text-white flex items-center justify-center font-bold">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[#180200]">
                    Receipt {viewingReceipt.receiptNumber}
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
                      <span>Assigned to Member {viewingReceipt.membershipNo || viewingReceipt.memberId}</span>
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
                    {viewingReceipt.items?.[0] ? (
                      <>
                        <p className="font-bold text-[#510601] mt-0.5">{fullLabel(viewingReceipt.items[0])}</p>
                      </>
                    ) : (
                      <p className="font-bold text-[#510601] mt-0.5">{viewingReceipt.particulars || 'Membership'}</p>
                    )}
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
            <div className="px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl flex items-center justify-between gap-3">
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
