import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Eye, Loader2, Pencil, Search } from 'lucide-react';
import api from '../api';
import Pager from '../components/Pager';
import ReceiptViewModal from '../components/ReceiptViewModal';
import useAuth from '../hooks/useAuth';
import { fetchReceiptPage } from '../utils/apiAdapters';
import { notify } from '../utils/notify';
import { formatDate } from '../utils/dateUtils';
import { formatMoney } from '../utils/money';

// Register numbers the office used more than once (32170, 32170/2 ...): each number is a heading with every record that used it
// under it. Only a pointer for the office: nothing is changed here.
export default function RepeatedReceipts() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('receipts.tracking.write');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ groups: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null);    // one receipt in the usual receipt popup

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    api.get('/receipts/repeats', { params: { page, limit: pageSize, ...(debounced ? { search: debounced } : {}) } })
      .then(({ data: d }) => { if (current) setData(d); })
      .catch((e) => { if (current) notify(e.response?.data?.detail || 'Could not load the repeated receipt numbers from the server.', 'error'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [page, pageSize, debounced]);

  const openReceipt = async (id) => {
    try {
      const { rows } = await fetchReceiptPage({ receipt_id: id, limit: 1 });
      if (rows[0]) setViewing(rows[0]);
    } catch (e) {
      notify(e.response?.data?.detail || 'Could not open the receipt.', 'error');
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/dashboard/receipts/tracking"
          title="Back to Receipt Tracking"
          aria-label="Back to Receipt Tracking"
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white border border-[#E8DFD8] text-[#510601] hover:border-[#510601] transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
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
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#7D7068] py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : !data.groups.length ? (
        <div className="text-sm text-[#7D7068] py-10 text-center bg-white border border-[#E8DFD8] rounded-2xl">No repeated receipt numbers found.</div>
      ) : (
        <div className="space-y-3">
          {data.groups.map((g) => (
            <div key={`${g.financial_year}-${g.number}`} className="bg-white border border-[#E8DFD8] rounded-2xl shadow-xs overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-[#FAF7F2] border-b border-[#E8DFD8]">
                <div className="text-sm font-bold text-[#180200] break-words min-w-0">{g.number}</div>
                <div className="text-[10px] font-bold text-[#7D7068] shrink-0">FY {g.financial_year} · used {g.count} times</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[#7D7068] uppercase tracking-wider text-[10px]">
                      <th className="px-4 py-2">Receipt no</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2">Mode</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFE6DE]/70">
                    {g.items.map((i) => (
                      <tr key={i.id} className="hover:bg-[#FAF7F2]">
                        <td className="px-4 py-2 font-mono font-bold text-[#510601] whitespace-nowrap">{i.receipt_number}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatDate(i.receipt_date)}</td>
                        <td className="px-3 py-2 font-semibold text-[#180200]">{i.name || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{formatMoney(i.amount)}</td>
                        <td className="px-3 py-2">{i.payment_mode || '—'}</td>
                        <td className="px-3 py-2">{i.receipt_status ? i.receipt_status.charAt(0) + i.receipt_status.slice(1).toLowerCase() : '—'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button type="button" onClick={() => openReceipt(i.id)} className="btn-act" title="Open the receipt"><Eye className="w-3.5 h-3.5" /><span>View</span></button>
                            {/* the usual Receipt Edit screen, in a new tab so this list stays where it is; a cancelled receipt cannot be edited */}
                            {canEdit && i.receipt_status !== 'CANCELLED' && (
                              <a href={`/dashboard/receipts/edit/${i.id}`} target="_blank" rel="noopener noreferrer" className="btn-act" title="Edit the receipt (opens in a new tab)">
                                <Pencil className="w-3.5 h-3.5" /><span>Edit</span>
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pager page={page} pages={data.pages} total={data.total} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />

      <ReceiptViewModal receipt={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
