import React from 'react';
import { Link } from 'react-router-dom';
import { User, CreditCard } from 'lucide-react';
import { formatDate } from '../utils/dateUtils';

// The details captured on the Register New Member form, shown in the member popups.
// `member` is a member as returned by normalizeMember (server data).
const Field = ({ label, value, wide = false, mono = false }) => (
  <div className={wide ? 'sm:col-span-2' : ''}>
    <span className="text-[10px] uppercase font-bold text-[#863221]">{label}</span>
    <p className={`mt-0.5 font-medium ${mono ? 'font-mono' : ''}`}>
      {value === undefined || value === null || value === '' ? '—' : value}
    </p>
  </div>
);

export default function MemberApplicationDetails({ member }) {
  if (!member) return null;
  const pay = member.registrationPayment || {};
  const hasPayment = Object.values(pay).some((v) => v !== null && v !== undefined && v !== '');

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl p-4 border border-[#E8DFD8] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[#510601] uppercase tracking-wider">
            <User className="w-4 h-4" />
            <span>Application Details</span>
          </div>
          {member.id ? (
            <Link
              to={`/dashboard/membership/view/${member.id}`}
              className="text-[11px] font-semibold text-[#510601] hover:underline"
            >
              View full registration
            </Link>
          ) : null}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <Field label="Title" value={member.nameTitle} />
          <Field label="Father / Husband Name" value={member.fatherHusbandName} />
          <Field
            label="Date of Birth"
            value={member.birthDate ? `${formatDate(member.birthDate)}${member.age ? ` (${member.age} yrs)` : ''}` : ''}
          />
          <Field label="Gender" value={member.gender} />
          <Field label="Aadhar Number" value={member.aadharNumber} mono />
          <Field label="WhatsApp" value={member.whatsappNumber} mono />
          <Field label="Qualification" value={member.qualification} />
          <Field label="Employment" value={member.employment} />
          <Field label="Native Place" value={member.nativePlaceText} />
          <Field label="Applying on behalf of" value={member.appliedOnBehalfOf} />
          <Field label="Magazine needed" value={member.magazineNeededLabel} />
          <Field label="Membership category" value={member.membershipTypeCategory} />
          <Field label="Referred by" value={member.referredBy} wide />
          <Field label="Family membership" value={member.familyMembership} wide />
        </div>
      </div>

      {hasPayment && (
        <div className="bg-white rounded-xl p-4 border border-[#E8DFD8] space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[#510601] uppercase tracking-wider">
            <CreditCard className="w-4 h-4" />
            <span>Payment entered with the application</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <Field label="Payment Mode" value={pay.payment_mode} />
            <Field label="Bank Account" value={pay.bank_account} />
            <Field label="Amount" value={pay.amount !== null && pay.amount !== undefined ? `₹${Number(pay.amount).toLocaleString('en-IN')}` : ''} mono />
            <Field label="Receipt Date" value={pay.receipt_date ? formatDate(pay.receipt_date) : ''} />
            <Field label="Transaction ID / Cheque No." value={pay.transaction_id} mono />
            <Field label="Transaction Date" value={pay.transaction_date ? formatDate(pay.transaction_date) : ''} />
            <Field label="Remarks" value={pay.remarks} wide />
          </div>
        </div>
      )}
    </div>
  );
}
