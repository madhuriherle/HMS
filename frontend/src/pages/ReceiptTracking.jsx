import React, { useState, useEffect, useMemo, useRef } from 'react';
import MissingTags from '../components/MissingTags';
import useSort from '../hooks/useSort';
import SortTh from '../components/SortTh';
import { useNavigate } from 'react-router-dom';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
import {
  Search,
  Eye,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertCircle,
  X,
  FileSpreadsheet,
  Phone,
  Repeat,
} from 'lucide-react';
import { isReceiptUnmapped } from '../utils/displayHelpers';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import useSwalConfirm from '../hooks/useSwalConfirm';
import api from '../api';
import { formatDate } from '../utils/dateUtils';
import { apiErrorMessage } from '../utils/apiError';
import { notify } from '../utils/notify';
import { fetchReceiptPage } from '../utils/apiAdapters';
import { currentRules } from '../hooks/useRules';
import { formatMoney } from '../utils/money';

import ReceiptViewModal from '../components/ReceiptViewModal';
// Financial year (April-March) of an ISO date: 2026-10-12 -> 2026-27
const getCurrentFY = (date = new Date()) => {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const startMonth = currentRules()?.financial_year?.start_month || 4;
  const start = m >= startMonth ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
};




// Helper to format date string (YYYY-MM-DD to DD-MM-YYYY)
// Helper for number to words (Indian Numbering System)

// the status names and chip colours come from the server (receipt_statuses in GET /meta/lists)
// What a receipt line is called: the sub type the clerk picked, else the particular itself
const lineLabel = (i) => {
  const sub = (i.sub_type || i.description || '').trim();
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
    <div className="max-w-[170px] whitespace-normal break-words leading-snug" onMouseEnter={show} onMouseLeave={() => setTip(null)}>
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

export default function ReceiptTracking() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  // Master Synchronized Stores
  const [receipts, setReceipts] = useState([]); // ONE page of the register (at most 200 rows), the rest stays on the server
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({});
  const [page, setPage] = useState(1);
  const pageSize = 200; // Load more adds 200 at a time (rule 10.6: never more than 200 in one request)
  const [loadingPage, setLoadingPage] = useState(true);
  const [filterOptions, setFilterOptions] = useState({ financial_years: [], sub_types: {}, payment_modes: [] });
  const [debouncedSearch, setDebouncedSearch] = useState(() => new URLSearchParams(window.location.search).get('search') || '');

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState(() => new URLSearchParams(window.location.search).get('search') || '');
  const [particularsFilter, setParticularsFilter] = useState('ALL');
  const [subTypeFilter, setSubTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL'); // ALL, Assigned, Unassigned
  const [fyFilter, setFyFilter] = useState(() => getCurrentFY());
  const [monthFilter, setMonthFilter] = useState('ALL'); // ALL or a month number 1-12 (April to March within the period)
  const [modeFilter, setModeFilter] = useState('ALL');
  const [numberFilter, setNumberFilter] = useState('ALL'); // ALL, KNOWN, UNKNOWN (dummy number), ZERO (no amount)
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [periodMode, setPeriodMode] = useState('FY'); // ALL, TODAY, MONTH, FY, CUSTOM

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

  const { sort, toggle: toggleSort, params: sortParams } = useSort();
  // what the server is asked for: the page, the filters and the sort. The search and every filter run on the WHOLE
  // register in the database; this screen only ever holds the page it shows.
  const listParams = useMemo(() => {
    const statusCode = { Assigned: 'ASSIGNED', Unassigned: 'UNASSIGNED', Cancelled: 'CANCELLED' };
    return {
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
      ...(particularsFilter !== 'ALL' ? { particular: particularsFilter } : {}),
      ...(subTypeFilter !== 'ALL' ? { sub_type: subTypeFilter } : {}),
      ...(statusFilter !== 'ALL' ? { receipt_status: statusCode[statusFilter] } : {}),
      ...(fyFilter !== 'ALL' ? { fy: fyFilter } : {}),
      ...(monthFilter !== 'ALL' && (periodMode === 'FY' || periodMode === 'ALL') ? { month: Number(monthFilter) } : {}),
      ...(modeFilter !== 'ALL' ? { mode: modeFilter } : {}),
      ...(numberFilter !== 'ALL' ? { number_kind: numberFilter } : {}),
      ...(fromDate ? { from_date: fromDate } : {}),
      ...(toDate ? { to_date: toDate } : {}),
      ...sortParams,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, particularsFilter, subTypeFilter, statusFilter, fyFilter, monthFilter, periodMode, modeFilter, numberFilter, fromDate, toDate, sort.by, sort.dir]);

  const requestSeq = useRef(0);
  // Load more: page 1 replaces the list, a later page is added under it; reloadAll (after an edit or a delete) asks pages 1..page again
  const loadPage = async (reloadAll = false) => {
    const seq = (requestSeq.current += 1);
    setLoadingPage(true);
    try {
      const first = reloadAll || page === 1 ? 1 : page;
      let rows = [];
      let result = null;
      for (let n = first; n <= page; n += 1) {
        result = await fetchReceiptPage({ ...listParams, page: n, limit: pageSize });
        if (seq !== requestSeq.current) return; // a newer request is already on its way
        rows = rows.concat(result.rows);
      }
      setReceipts((prev) => (first === 1 ? rows : [...prev, ...rows.filter((r) => !prev.some((x) => x.id === r.id))]));
      setTotal(result.total);
      setSummary(result.summary);
      if (page > Math.max(1, result.pages)) setPage(Math.max(1, result.pages));
    } catch (error) {
      if (seq !== requestSeq.current) return;
      console.error('Failed to load receipts.', error);
      showToast(error.response?.data?.detail || 'Failed to load receipts from the server.', 'error');
    } finally {
      if (seq === requestSeq.current) setLoadingPage(false);
    }
  };

  const reloadData = async () => {
    const fail = (what) => (error) => {
      console.error(`Failed to load ${what}.`, error);
      showToast(error.response?.data?.detail || `Failed to load ${what} from the server.`, 'error');
    };
    await Promise.all([
      loadPage(true),
      // one call gives every filter: the years, sub types, payment modes in use, and the active particulars / payment modes
      api.get('/receipts/tracking-options')
        .then(({ data }) => {
          setFilterOptions(data);
          setParticularOptions(data.particulars || []);
          setPaymentModeOptions(data.configured_payment_modes || []);
        })
        .catch(fail('filter options')),
    ]);
  };

  // masters and options once; the register again whenever the page, a filter or the sort changes
  useEffect(() => {
    reloadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listParams, page]);
  // typing in the search box waits a moment, then asks the server
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  // a new search / filter / sort starts again from page 1
  useEffect(() => {
    setPage(1);
  }, [listParams]);

  const filteredReceipts = receipts; // the server already filtered, sorted and paged them

  // Receipt Type and Sub Type as one list: each type, then its sub types under it
  const typeOptions = useMemo(() => {
    const out = [{ value: 'ALL', label: 'All Receipt Types', display: 'Type' }];
    particularOptions.forEach((t) => {
      const subs = filterOptions.sub_types?.[t] || [];
      out.push({ value: `T|${t}`, label: subs.length ? `${t} (all)` : t, bold: true });
      subs.forEach((sub) => out.push({ value: `S|${sub}`, label: sub, indent: true }));
    });
    return out;
  }, [filterOptions, particularOptions]);

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
    setMonthFilter('ALL');
    setFromDate('');
    setToDate('');
    if (val.startsWith('FYM|')) {
      const [, fy, month] = val.split('|'); // a month of that financial year
      setPeriodMode('FY');
      setFyFilter(fy);
      setMonthFilter(month);
    } else if (val.startsWith('FY|')) {
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

  const fyOptions = useMemo(() => {
    const years = new Set(filterOptions.financial_years || []);
    const currentFY = getCurrentFY();
    if (currentFY) years.add(currentFY);
    return Array.from(years).sort().reverse();
  }, [filterOptions.financial_years]);
  // every active mode from Payment Mode Setup, plus any mode a receipt already carries that the master lacks
  const modeOptions = useMemo(() => {
    const out = [...paymentModeOptions];
    const have = new Set(out.map((m) => m.toLowerCase()));
    (filterOptions.payment_modes || []).forEach((m) => {
      if (!have.has(m.toLowerCase())) {
        have.add(m.toLowerCase());
        out.push(m);
      }
    });
    return out.sort((x, y) => x.localeCompare(y));
  }, [filterOptions, paymentModeOptions]);
  // ----------------------------------------------------
  // EXPORT, DAY BOOK
  // ----------------------------------------------------
  // The Export is made by the server (every field of every receipt in the filtered list, as an Excel file)
  const exportVisibleReceipts = async () => {
    try {
      const { data: blob } = await api.get('/receipts/tracking', { params: { ...listParams, export: 'excel' }, responseType: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `receipts-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast(`Exported ${total} receipt(s).`);
    } catch (error) {
      showToast(apiErrorMessage(error, 'Could not export the receipts.'), 'error');
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




  const deleteInFlight = useRef(false);

  const handleConfirmDelete = async () => {
    if (!deletingReceipt || deleteInFlight.current) return;
    deleteInFlight.current = true;

    const num = deletingReceipt.receiptNumber;
    try {
      await api.delete(`/receipts/${deletingReceipt.id}`, { params: { reason: 'Deleted via UI' } });
      showToast(`Receipt ${num} deleted successfully.`);
      await loadPage();
    } catch (error) {
      if (error.response?.status === 404) {
        // Already removed (e.g. a repeated click): just refresh the list.
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
        filtersAlwaysShown
        title="Receipt Tracking"
        searchQuery={searchQuery}
        onSearchChange={(val) => setSearchQuery(val)}
        activeFiltersCount={
          (particularsFilter !== 'ALL' ? 1 : 0) +
          (subTypeFilter !== 'ALL' ? 1 : 0) +
          (statusFilter !== 'ALL' ? 1 : 0) +
          (periodMode !== 'FY' || fyFilter !== getCurrentFY() ? 1 : 0) +
          (monthFilter !== 'ALL' ? 1 : 0) +
          (modeFilter !== 'ALL' ? 1 : 0) +
          (numberFilter !== 'ALL' ? 1 : 0)
        }
        onResetFilters={() => {
          const currentFY = getCurrentFY();
          setSearchQuery('');
          setParticularsFilter('ALL');
          setSubTypeFilter('ALL');
          setStatusFilter('ALL');
          setFyFilter(currentFY);
          setMonthFilter('ALL');
          setModeFilter('ALL');
          setNumberFilter('ALL');
          setFromDate('');
          setToDate('');
          setPeriodMode('FY');
        }}
        rightSlot={
          <>
            <button
              type="button"
              onClick={() => navigate('/dashboard/receipts/repeats')}
              title="Receipt numbers the register used more than once (32170, 32170/2)"
              aria-label="Repeated Numbers"
              className="inline-flex items-center justify-center h-9 w-9 text-[#510601] bg-white border border-[#E8DFD8] rounded-xl hover:bg-[#FAF7F2] cursor-pointer"
            >
              <Repeat className="w-4 h-4" />
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
        {/* Period: the financial years, with the months of the chosen year under it (April to March), and the date range */}
        <FilterSelect
          value={periodMode === 'FY' ? (monthFilter !== 'ALL' ? `FYM|${fyFilter}|${monthFilter}` : `FY|${fyFilter}`) : periodMode}
          onChange={choosePeriod}
          options={[
            { value: 'ALL', label: 'All Time' },
            { value: 'TODAY', label: 'Today' },
            { value: 'MONTH', label: 'This Month' },
            ...fyOptions.flatMap((f) => [
              { value: `FY|${f}`, label: `FY ${f}` },
              ...(periodMode === 'FY' && fyFilter === f
                ? [[4, 'April'], [5, 'May'], [6, 'June'], [7, 'July'], [8, 'August'], [9, 'September'], [10, 'October'], [11, 'November'], [12, 'December'], [1, 'January'], [2, 'February'], [3, 'March']]
                  .map(([n, label]) => ({ value: `FYM|${f}|${n}`, label, indent: true, display: `${label} ${f}` }))
                : [])
            ]),
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
          widthClass="w-full sm:w-44"
        />

        {/* Status: whether the receipt is linked to a member, plus the old-register receipts with no real number (FY43-0001 style) or no amount */}
        <FilterSelect
          value={numberFilter !== 'ALL' ? numberFilter : statusFilter}
          onChange={(val) => {
            if (val === 'UNKNOWN' || val === 'ZERO') { setNumberFilter(val); setStatusFilter('ALL'); }
            else { setNumberFilter('ALL'); setStatusFilter(val); }
          }}
          options={[
            { value: 'ALL', label: 'All Statuses', display: 'Status' },
            { value: 'Assigned', label: 'Assigned' },
            { value: 'Unassigned', label: 'Unassigned' },
            { value: 'Cancelled', label: 'Cancelled' },
            { value: 'UNKNOWN', label: 'No number' },
            { value: 'ZERO', label: 'No amount' }
          ]}
          widthClass="w-full sm:w-40"
        />

        {/* Payment Mode */}
        <FilterSelect
          value={modeFilter}
          onChange={(val) => setModeFilter(val)}
          options={[{ value: 'ALL', label: 'All Payment Modes', display: 'Mode' }, ...modeOptions.map((m) => ({ value: m, label: m }))]}
          widthClass="w-full sm:w-36"
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
                  <div className="font-mono font-bold text-xs text-[#510601]">{receipt.receiptNumber}<MissingTags noNumber={receipt.is_old_receipt} amount={receipt.amount} /></div>
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
                  receipt.receiptStatus === 'CANCELLED' || String(receipt.status || '').toUpperCase() === 'CANCELLED' ? (
                    <button
                      type="button"
                      disabled
                      className="btn-act opacity-40 cursor-not-allowed text-stone-400 border-stone-200"
                      title="Cancelled receipts cannot be edited"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(receipt)}
                      className="btn-act"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                  )
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
                <SortTh label="Receipt No." field="receipt_number" sort={sort} onSort={toggleSort} className="py-3.5 px-4 whitespace-nowrap" />
                <SortTh label="Date" field="receipt_date" sort={sort} onSort={toggleSort} className="py-3.5 px-4 whitespace-nowrap" />
                <SortTh label="Name" field="payer_name" sort={sort} onSort={toggleSort} className="py-3.5 px-4 whitespace-nowrap" />
                <th className="py-3.5 px-4 whitespace-nowrap">Particulars</th>
                <SortTh label="Amount" field="amount" sort={sort} onSort={toggleSort} className="py-3.5 px-4 text-right whitespace-nowrap" />
                <th className="py-3.5 px-4 whitespace-nowrap">Mode</th>
                <th className="py-3.5 px-4 text-right whitespace-nowrap min-w-[170px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8] text-xs sm:text-sm">
              {filteredReceipts.length === 0 ? (
                <tr>
                  <td colSpan="7" className="py-14 text-center text-[#863221]">
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
                        {(receipt.receiptStatus === 'CANCELLED' || String(receipt.status || '').toUpperCase() === 'CANCELLED') && <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide bg-red-50 text-red-700 border border-red-200 align-middle">CANCELLED</span>}
                        <MissingTags noNumber={receipt.is_old_receipt} amount={receipt.amount} />
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

                      {/* Column 6: Action */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex flex-nowrap items-center justify-end gap-1.5">
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
                            receipt.receiptStatus === 'CANCELLED' || String(receipt.status || '').toUpperCase() === 'CANCELLED' ? (
                              <button
                                type="button"
                                disabled
                                className="btn-act opacity-40 cursor-not-allowed text-stone-400 border-stone-200"
                                title="Cancelled receipts cannot be edited"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                <span>Edit</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(receipt)}
                                className="btn-act"
                                title={'Edit Receipt'}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                <span>Edit</span>
                              </button>
                            )
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

        {/* Footer: page controls, then the counts of the whole filtered set */}
        <div className="px-5 py-3.5 bg-[#FAF7F2] border-t border-[#E8DFD8] space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#863221]">
            <span>Showing <strong className="text-[#180200]">{receipts.length}</strong> of <strong className="text-[#180200]">{total}</strong></span>
            {receipts.length < total && (
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={loadingPage}
                className="px-4 py-2 text-xs font-bold text-[#510601] bg-white border border-[#510601] rounded-xl hover:bg-[#510601]/5 disabled:opacity-50 cursor-pointer"
              >
                {loadingPage ? 'Loading…' : `Load more (${Math.min(pageSize, total - receipts.length)})`}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#863221]">
            <span>
              {loadingPage ? 'Loading…' : <><strong className="text-[#180200]">{total}</strong> receipt(s) match</>}
              {summary.total_amount != null && <> · <strong className="text-[#180200]">{formatMoney(summary.total_amount)}</strong> collected</>}
            </span>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">
                <span className="w-2 h-2 rounded-full bg-emerald-600" />
                <span>{summary.by_status?.ASSIGNED || 0} Assigned</span>
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span>{summary.by_status?.UNASSIGNED || 0} Unassigned</span>
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-red-800">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span>{summary.by_status?.CANCELLED || 0} Cancelled</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* MODAL 1: VIEW RECEIPT DETAILS                                */}
      {/* ============================================================ */}
      <ReceiptViewModal receipt={viewingReceipt} onClose={() => setViewingReceipt(null)} />

    </div>
    </PermissionGate>
  );
}
