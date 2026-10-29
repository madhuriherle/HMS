import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, Pencil, Search } from 'lucide-react';
import api from '../api';
import Pager from '../components/Pager';
import useAuth from '../hooks/useAuth';
import { notify } from '../utils/notify';
import { formatDate } from '../utils/dateUtils';

// Members whose stored data looks wrong, one tab per problem. Only a pointer for the office: the member is corrected on the Edit screen.
// `extra`: the columns this problem needs beside the common ones (heading and what to show)
const DOB_COLUMNS = [
  { head: 'Date of birth', cell: (m) => (m.dob ? formatDate(m.dob) : '—'), nowrap: true },
  { head: 'Age', cell: (m) => (m.age == null ? '—' : m.age < 0 ? 'Future date' : `${m.age} years`), nowrap: true }
];
const TABS = [
  { id: 'future_dob', label: 'Date of birth in the future', hint: 'The date of birth is after today: a typing mistake in the register.', extra: DOB_COLUMNS },
  { id: 'under_18', label: 'Under 18', hint: 'The date of birth makes the member younger than 18: most likely a wrong year.', extra: DOB_COLUMNS },
  { id: 'very_old', label: 'Over 110', hint: 'The date of birth makes the member older than 110: most likely a wrong year.', extra: DOB_COLUMNS },
  { id: 'alt_number', label: 'Alternate number', hint: 'The alternate number is not 10 to 12 digits (a landline with its STD code, or a short number).',
    extra: [{ head: 'Alternate number', cell: (m) => m.alternate_mobile || '—', nowrap: true, mono: true }] },
  { id: 'bad_email', label: 'Wrong email', hint: 'The email address is not in a valid format (for example no @, or a space or stray character in it).',
    extra: [{ head: 'Email', cell: (m) => m.email || '—', mono: true }] },
  { id: 'no_place', label: 'No pincode or district', hint: 'The member has no pincode or no district, so the state, district and taluk cannot be filled.',
    extra: [{ head: 'Missing', cell: (m) => (m.missing || []).join(', ') || '—' }] },
  { id: 'print_no_address', label: 'Printed magazine, no address', hint: 'The member gets the printed magazine but has no address (and no separate magazine address) to post it to.', extra: [] },
  { id: 'no_mobile', label: 'No mobile number', hint: 'The member has no mobile number.',
    extra: [{ head: 'Alternate number', cell: (m) => m.alternate_mobile || '—', nowrap: true, mono: true }] },
  { id: 'no_address', label: 'No address', hint: 'The member has no address.',
    extra: [{ head: 'Pincode / district missing', cell: (m) => (m.missing || []).join(', ') || '—' }] },
  { id: 'odd_name', label: 'Odd characters in name', hint: 'The name has something other than letters, spaces, dots, apostrophes or hyphens (a digit, a slash, a stray symbol).', extra: [] }
];

export default function DataCheck() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('members.list.write');
  const [kind, setKind] = useState('future_dob');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ rows: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    api.get('/data-check/members', { params: { kind, page, limit: pageSize, ...(debounced ? { search: debounced } : {}) } })
      .then(({ data: d }) => { if (current) setData(d); })
      .catch((e) => { if (current) notify(e.response?.data?.detail || 'Could not load the list from the server.', 'error'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [kind, page, pageSize, debounced]);

  const download = async () => {
    try {
      const { data: blob } = await api.get('/data-check/members', { params: { kind, export: 'excel', ...(debounced ? { search: debounced } : {}) }, responseType: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `members_${kind}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      notify(e.response?.data?.detail || 'Could not download the list.', 'error');
    }
  };

  const tab = TABS.find((t) => t.id === kind);
  const th = 'px-3 py-2.5 text-left whitespace-nowrap';
  return (
    <div className="space-y-4 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/dashboard/membership/list"
            title="Back to the Membership List"
            aria-label="Back to the Membership List"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white border border-[#E8DFD8] text-[#510601] hover:border-[#510601] transition-all mr-1"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setKind(t.id); setPage(1); }}
              className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                kind === t.id ? 'bg-[#510601] text-white border-[#510601]' : 'bg-white text-[#510601] border-[#E8DFD8] hover:border-[#510601]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-[#9E8B7F] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, mobile or membership no"
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

      <p className="text-xs text-[#863221]">{tab.hint}</p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#7D7068] py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : !data.rows.length ? (
        <div className="text-sm text-[#7D7068] py-10 text-center bg-white border border-[#E8DFD8] rounded-2xl">No members found.</div>
      ) : (
        <div className="bg-white border border-[#E8DFD8] rounded-2xl shadow-xs overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#863221] uppercase tracking-wider text-[10px] font-bold">
                <th className={th}>Name</th>
                <th className={th}>Membership no</th>
                <th className={th}>Old no</th>
                <th className={th}>Mobile</th>
                {tab.extra.map((c) => <th key={c.head} className={th}>{c.head}</th>)}
                <th className={th}>District</th>
                <th className={th}>Status</th>
                {canEdit && <th className={th} />}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFE6DE]/70">
              {data.rows.map((m) => (
                <tr key={m.id} className="hover:bg-[#FAF7F2]">
                  <td className="px-3 py-2.5 font-semibold">
                    <Link to={`/dashboard/membership/profile/${m.id}`} target="_blank" rel="noopener noreferrer" className="text-[#510601] hover:underline">{m.name || '—'}</Link>
                  </td>
                  <td className="px-3 py-2.5">{m.membership_no || '—'}</td>
                  <td className="px-3 py-2.5">{m.old_no || '—'}</td>
                  <td className="px-3 py-2.5">{m.mobile || '—'}</td>
                  {tab.extra.map((c) => (
                    <td key={c.head} className={`px-3 py-2.5 ${c.nowrap ? 'whitespace-nowrap' : ''} ${c.mono ? 'font-mono' : ''}`}>{c.cell(m)}</td>
                  ))}
                  <td className="px-3 py-2.5">{m.district || '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {[m.approval !== 'APPROVED' ? m.approval : '', m.status].filter(Boolean).map((s) => s.charAt(0) + s.slice(1).toLowerCase()).join(' · ') || '—'}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2.5 text-right">
                      <a href={`/dashboard/membership/edit/${m.id}`} target="_blank" rel="noopener noreferrer" className="btn-act" title="Edit the member (opens in a new tab)">
                        <Pencil className="w-3.5 h-3.5" /><span>Edit</span>
                      </a>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pager page={page} pages={data.pages} total={data.total} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
    </div>
  );
}
