import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Eye, Loader2, Search } from 'lucide-react';
import api from '../api';
import Modal from '../components/Modal';
import ModalFooter from '../components/ModalFooter';
import Pager from '../components/Pager';
import ReceiptViewModal from '../components/ReceiptViewModal';
import { fetchReceiptPage } from '../utils/apiAdapters';
import { notify } from '../utils/notify';
import { formatDate } from '../utils/dateUtils';
import { formatMoney } from '../utils/money';

// Register numbers the office used more than once (32170, 32170/2 ...). Only a pointer for the office: nothing is changed here.
const KINDS = [
  { id: 'ALL', label: 'All numbers' },
  { id: '2', label: 'Used 2 times' },
  { id: '3', label: 'Used 3 times' },
  { id: '4PLUS', label: 'Used 4 or more' }
];

const uniq = (list) => [...new Set(list.filter(Boolean))];
const short = (list, n = 2) => (list.length > n ? `${list.slice(0, n).join(', ')} +${list.length - n}` : list.join(', ')) || '—';

export default function RepeatedReceipts() {
  const [kind, setKind] = useState('ALL');
  const [fy, setFy] = useState('');
  const [years, setYears] = useState([]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ groups: [], total: 0, pages: 1, counts: {} });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);          // the number whose records are being compared
  const [viewing, setViewing] = useState(null);    // one receipt in the usual receipt popup

  useEffect(() => {
    api.get('/receipts/tracking-options').then(({ data: d }) => setYears(d.financial_years || [])).catch(() => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const params = useMemo(() => ({ kind, ...(fy ? { fy } : {}), ...(debounced ? { search: debounced } : {}) }), [kind, fy, debounced]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    api.get('/receipts/repeats', { params: { ...params, page, limit: pageSize } })
      .then(({ data: d }) => { if (current) setData(d); })
      .catch((e) => { if (current) notify(e.response?.data?.detail || 'Could not load the repeated receipt numbers from the server.', 'error'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [params, page, pageSize]);

  const download = async () => {
    try {
      const { data: blob } = await api.get('/receipts/repeats', { params: { ...params, export: 'excel' }, responseType: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'repeated_receipt_numbers.xlsx';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      notify(e.response?.data?.detail || 'Could not download the report.', 'error');
    }
  };

  const openReceipt = async (id) => {
    try {
      const { rows } = await fetchReceiptPage({ receipt_id: id, limit: 1 });
      if (rows[0]) setViewing(rows[0]);
    } catch (e) {
      notify(e.response?.data?.detail || 'Could not open the receipt.', 'error');
    }
  };

  const th = 'px-3 py-2.5 text-left whitespace-nowrap';
  return (
    <div className="space-y-4 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/dashboard/receipts/tracking" className="text-xs font-bold text-[#510601] hover:underline mr-2">← Receipt Tracking</Link>
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => { setKind(k.id); setPage(1); }}
              className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                kind === k.id ? 'bg-[#510601] text-white border-[#510601]' : 'bg-white text-[#510601] border-[#E8DFD8] hover:border-[#510601]'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={fy}
            onChange={(e) => { setFy(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601]"
          >
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={y}>FY {y}</option>)}
          </select>
          <div className="relative">
            <Search className="w-4 h-4 text-[#9E8B7F] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Receipt no, name or mobile"
              className="pl-9 pr-3 py-2 w-64 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601]"
            />
          </div>
          <button
            type="button"
            onClick={download}
            disabled={!data.total}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-[#510601] text-[#510601] hover:bg-[#510601]/5 text-xs font-bold rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Download className="w-4 h-4" /> Export Excel
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#7D7068] py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : !data.groups.length ? (
        <div className="text-sm text-[#7D7068] py-10 text-center bg-white border border-[#E8DFD8] rounded-2xl">No repeated receipt numbers found.</div>
      ) : (
        <div className="bg-white border border-[#E8DFD8] rounded-2xl shadow-xs overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#863221] uppercase tracking-wider text-[10px] font-bold">
                <th className={th}>Receipt number</th>
                <th className={th}>Year</th>
                <th className={th}>Times used</th>
                <th className={th}>Names</th>
                <th className={th}>Dates</th>
                <th className={`${th} text-right`}>Amounts</th>
                <th className={th} />
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFE6DE]/70">
              {data.groups.map((g) => {
                const dates = g.items.map((i) => i.receipt_date).filter(Boolean).sort();
                return (
                  <tr key={`${g.financial_year}-${g.number}`} className="hover:bg-[#FAF7F2]">
                    <td className="px-3 py-2.5 font-mono font-bold text-[#510601]">{g.number}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">FY {g.financial_year}</td>
                    <td className="px-3 py-2.5 font-bold">{g.count}</td>
                    <td className="px-3 py-2.5">{short(uniq(g.items.map((i) => i.name)))}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {dates.length ? (dates[0] === dates[dates.length - 1] ? formatDate(dates[0]) : `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}`) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">{short(uniq(g.items.map((i) => formatMoney(i.amount))))}</td>
                    <td className="px-3 py-2.5 text-[11px] text-[#863221] whitespace-nowrap">{g.alike.length ? 'Same name and amount' : ''}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button type="button" onClick={() => setOpen(g)} className="btn-act" title="Compare the records"><Eye className="w-3.5 h-3.5" /><span>View</span></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pager page={page} pages={data.pages} total={data.total} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />

      {open && (
        <Modal
          isOpen
          onClose={() => setOpen(null)}
          title={`Receipt number ${open.number} · FY ${open.financial_year}`}
          maxWidthClass="max-w-4xl"
          footer={<ModalFooter kind="view" onCancel={() => setOpen(null)} />}
        >
          <div className="space-y-3 text-xs">
            <p className="text-[#863221]">
              The register used this number {open.count} times. The first record keeps the number; the others carry /2, /3 and so on.
              {!open.has_original && ' The first record is not in the register.'}
            </p>
            <div className="overflow-x-auto border border-[#E8DFD8] rounded-xl">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#FAF7F2] text-[#863221] uppercase tracking-wider text-[10px] font-bold">
                    <th className={th}>Receipt no</th>
                    <th className={th}>Date</th>
                    <th className={th}>Name</th>
                    <th className={`${th} text-right`}>Amount</th>
                    <th className={th}>Mode</th>
                    <th className={th}>Status</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE6DE]/70">
                  {open.items.map((i) => (
                    <tr key={i.id}>
                      <td className="px-3 py-2.5 font-mono font-bold text-[#510601] whitespace-nowrap">
                        {i.receipt_number}{!i.repeat_no && <span className="ml-1.5 font-sans font-normal text-[#863221]">(first)</span>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(i.receipt_date)}</td>
                      <td className="px-3 py-2.5 font-semibold">{i.name || '—'}</td>
                      <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">{formatMoney(i.amount)}</td>
                      <td className="px-3 py-2.5">{i.payment_mode || '—'}</td>
                      <td className="px-3 py-2.5">{i.receipt_status ? i.receipt_status.charAt(0) + i.receipt_status.slice(1).toLowerCase() : '—'}</td>
                      <td className="px-3 py-2.5 text-right">
                        <button type="button" onClick={() => openReceipt(i.id)} className="btn-act" title="Open the receipt"><Eye className="w-3.5 h-3.5" /><span>View</span></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {open.alike.length > 0 && (
              <p className="text-[#863221]">Same name and same amount as the first record: {open.alike.join(', ')}. Worth checking.</p>
            )}
          </div>
        </Modal>
      )}

      <ReceiptViewModal receipt={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
