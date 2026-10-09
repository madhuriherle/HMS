import React from 'react';
import { AlertTriangle, CheckCircle2, Loader2, UserCheck, XCircle } from 'lucide-react';
import { formatDate } from '../utils/dateUtils';

// Result of "who is this membership number?" under the Membership No. box of Receipt Entry.
// lookup: { status: 'idle' | 'loading' | 'done' | 'error', matches: [...] } from GET /receipts/member-lookup
export default function MemberLookupCard({ lookup, onUse }) {
  if (!lookup || lookup.status === 'idle') return null;

  if (lookup.status === 'loading') {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#863221]">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Checking this number...</span>
      </div>
    );
  }

  if (lookup.status === 'error') {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-700">
        <AlertTriangle className="w-3.5 h-3.5" />
        <span>Could not check this number right now.</span>
      </div>
    );
  }

  if (!lookup.matches || lookup.matches.length === 0) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[11px] font-semibold text-red-700">
        <XCircle className="w-3.5 h-3.5 shrink-0" />
        <span>No member or applicant has this number.</span>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {lookup.matches.map((m) => {
        const active = m.member_status === 'ACTIVE';
        const Field = ({ label, value }) => (
          <div className="min-w-0">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-[#863221]/70">{label}</span>
            <span className="block text-[#180200] font-medium truncate">{value || '—'}</span>
          </div>
        );
        return (
          <div key={m.id} className="rounded-xl border border-[#3D705C]/30 bg-[#3D705C]/5 p-3 text-xs space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                <CheckCircle2 className="w-4 h-4 text-[#3D705C] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-bold text-[#180200] truncate">{m.name || 'Unnamed'}</p>
                  <p className="text-[11px] text-[#863221]">
                    {m.kind === 'applicant' ? 'Applicant (not yet approved)' : 'Member'}
                    {m.membership_type ? ` · ${m.membership_type}` : ''}
                    {m.district ? ` · ${m.district}` : ''}
                  </p>
                </div>
              </div>
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${active ? 'bg-[#3D705C]/15 text-[#3D705C]' : 'bg-gray-100 text-gray-600'}`}>
                {active ? 'Active' : 'Inactive'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <Field label="Membership No." value={m.membership_number || m.member_code} />
              <Field label="Registration No." value={m.registration_number} />
              <Field label="Mobile" value={m.mobile} />
              <Field label="Valid till" value={m.valid_till ? formatDate(m.valid_till) : ''} />
              <div className="col-span-2 min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-[#863221]/70">Last receipt</span>
                <span className="block text-[#180200] font-medium truncate">
                  {m.last_receipt
                    ? `${m.last_receipt.receipt_number} · ${formatDate(m.last_receipt.receipt_date)} · ₹${Number(m.last_receipt.amount || 0).toLocaleString('en-IN')}`
                    : 'None yet'}
                </span>
              </div>
            </div>

            {m.warnings && m.warnings.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {m.warnings.map((w) => (
                  <span key={w.code} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[10px] font-semibold text-amber-800">
                    <AlertTriangle className="w-3 h-3" />
                    {w.text}
                  </span>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => onUse(m)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#510601] hover:bg-[#8C1801] text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Use this member</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
