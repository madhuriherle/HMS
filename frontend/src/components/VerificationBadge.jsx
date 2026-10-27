import React from 'react';

// Result of the office's phone check on a member. A member nobody has called yet is "Not verified".
export const VERIFICATION = {
  VERIFIED: { label: 'Verified', tone: 'bg-green-50 text-green-700 border-green-200' },
  NOT_VERIFIED: { label: 'Not verified', tone: 'bg-gray-100 text-gray-600 border-gray-200' },
  NOT_REACHABLE: { label: 'Not reachable', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  WRONG_NUMBER: { label: 'Wrong number', tone: 'bg-red-50 text-red-700 border-red-200' },
  CALL_BACK: { label: 'Call back', tone: 'bg-blue-50 text-blue-700 border-blue-200' }
};

// With onClick the badge is the button that opens the KYC call popup.
export default function VerificationBadge({ status, title, onClick }) {
  const v = VERIFICATION[String(status || 'NOT_VERIFIED').toUpperCase()] || VERIFICATION.NOT_VERIFIED;
  const look = `inline-block whitespace-nowrap text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${v.tone}`;
  if (!onClick) return <span title={title} className={look}>{v.label}</span>;
  return (
    <button type="button" onClick={onClick} title={title || 'Record a KYC call'} className={`${look} cursor-pointer hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-[#510601]/30`}>{v.label}</button>
  );
}
