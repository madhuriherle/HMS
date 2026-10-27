import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Loader2, Search } from 'lucide-react';
import api from '../api';
import Pager from '../components/Pager';
import { notify } from '../utils/notify';
import { formatDate } from '../utils/dateUtils';
import useAuth from '../hooks/useAuth';
import VerificationBadge from '../components/VerificationBadge';
import VerifyMemberModal from '../components/VerifyMemberModal';

// Members who may be the same person. Only a pointer for the office: nothing is merged or changed here.
const KINDS = [
  { id: 'mobile', label: 'Same mobile' },
  { id: 'name', label: 'Same name' },
  { id: 'similar', label: 'Similar names' }
];

const REASON_TONE = {
  'Same mobile, same name': 'bg-[#8C1801]/10 text-[#8C1801] border-[#8C1801]/20',
  'Same name, same mobile': 'bg-[#8C1801]/10 text-[#8C1801] border-[#8C1801]/20'
};

export default function DuplicateMembers() {
  const [kind, setKind] = useState('mobile');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ groups: [], total: 0, pages: 1, members_in_groups: 0 });
  const [loading, setLoading] = useState(true);
  const [kyc, setKyc] = useState('');        // '' = all, verified, not_verified
  const [verifying, setVerifying] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { hasPermission } = useAuth();
  const canVerify = hasPermission('members.list.write');

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    api.get('/members/duplicates', { params: { kind, page, limit: pageSize, ...(kyc ? { verification: kyc } : {}), ...(debounced ? { search: debounced } : {}) } })
      .then(({ data: d }) => { if (current) setData(d); })
      .catch((e) => { if (current) notify(e.response?.data?.detail || 'Could not load the duplicate report from the server.', 'error'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [kind, page, pageSize, debounced, kyc, reloadKey]);

  const download = async () => {
    try {
      const { data: blob } = await api.get('/members/duplicates', {
        params: { kind, export: 'excel', ...(kyc ? { verification: kyc } : {}), ...(debounced ? { search: debounced } : {}) }, responseType: 'blob'
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `duplicate_members_${kind}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      notify(e.response?.data?.detail || 'Could not download the report.', 'error');
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
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
            value={kyc}
            onChange={(e) => { setKyc(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601]"
          >
            <option value="">All KYC</option>
            <option value="not_verified">Not verified</option>
            <option value="verified">Verified</option>
          </select>
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

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#7D7068] py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : !data.groups.length ? (
        <div className="text-sm text-[#7D7068] py-10 text-center bg-white border border-[#E8DFD8] rounded-2xl">No duplicates found.</div>
      ) : (
        <div className="space-y-3">
          {data.groups.map((g, gi) => (
            <div key={`${kind}-${g.key}-${gi}`} className="bg-white border border-[#E8DFD8] rounded-2xl shadow-xs overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-[#FAF7F2] border-b border-[#E8DFD8]">
                <div className="text-sm font-bold text-[#180200] break-words min-w-0">{g.key}</div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${REASON_TONE[g.reason] || 'bg-[#510601]/10 text-[#510601] border-[#510601]/20'}`}>{g.reason}</span>
                  <span className="text-[10px] font-bold text-[#7D7068]">{g.members.length} members</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[#7D7068] uppercase tracking-wider text-[10px]">
                      <th className="px-4 py-2">Name</th>
                      <th className="px-3 py-2">Membership no</th>
                      <th className="px-3 py-2">Old no</th>
                      <th className="px-3 py-2">Mobile</th>
                      <th className="px-3 py-2">Date of birth</th>
                      <th className="px-3 py-2">Father / husband</th>
                      <th className="px-3 py-2">Post office · Taluk</th>
                      <th className="px-3 py-2">Pincode</th>
                      <th className="px-3 py-2">District</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">KYC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFE6DE]/70">
                    {g.members.map((m) => (
                      <tr key={m.id} className="hover:bg-[#FAF7F2]">
                        <td className="px-4 py-2 font-semibold text-[#180200]">
                          <Link to={`/dashboard/membership/profile/${m.id}`} className="text-[#510601] hover:underline">{m.name || '—'}</Link>
                          {m.same_name_count > 1 && <span className="ml-2 text-[10px] font-bold text-[#7D7068]">+{m.same_name_count - 1} with this exact name</span>}
                        </td>
                        <td className="px-3 py-2">{m.membership_no || (m.approval === 'APPROVED' ? '—' : `ID: ${m.id}`)}</td>
                        <td className="px-3 py-2">{m.old_no || '—'}</td>
                        <td className="px-3 py-2">{m.mobile || '—'}</td>
                        <td className="px-3 py-2">{formatDate(m.dob)}</td>
                        <td className="px-3 py-2">{m.father || '—'}</td>
                        <td className="px-3 py-2">{[m.post_office, m.taluk].filter(Boolean).join(' · ') || m.place || '—'}</td>
                        <td className="px-3 py-2">{m.pincode || '—'}</td>
                        <td className="px-3 py-2">{m.district || '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {/* Approved is the usual case, so it is left out; only a member who is not approved shows the approval too */}
                          {[m.approval !== 'APPROVED' ? m.approval : '', m.status].filter(Boolean).map((s) => (
                            <span key={s} className={`mr-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                              s === 'ACTIVE' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}>{s.charAt(0) + s.slice(1).toLowerCase()}</span>
                          )) }
                          {!m.approval && !m.status && '—'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <VerificationBadge status={m.verification} title={[m.verified_at && formatDate(m.verified_at), m.verification_remark].filter(Boolean).join(' · ')} />
                          {canVerify && (
                            <button type="button" onClick={() => setVerifying(m.id)} className="ml-2 text-[11px] font-bold text-[#510601] underline cursor-pointer">Verify</button>
                          )}
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

      {verifying && <VerifyMemberModal memberId={verifying} onClose={() => setVerifying(null)} onSaved={() => setReloadKey((k) => k + 1)} />}

      <Pager page={page} pages={data.pages} total={data.total} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
    </div>
  );
}
