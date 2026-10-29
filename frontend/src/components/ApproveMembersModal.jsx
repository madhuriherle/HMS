import React, { useState } from 'react';
import Modal from './Modal';
import ModalFooter from './ModalFooter';
import api from '../api';
import { notify } from '../utils/notify';

const getTodayDateStr = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function ApproveMembersModal({
  isOpen = false,
  members = [],
  onClose,
  onApproved
}) {
  const [approvalDate, setApprovalDate] = useState(() => getTodayDateStr());
  const [approvalNote, setApprovalNote] = useState('');
  const [busy, setBusy] = useState(false);

  if (!isOpen || !members || members.length === 0) return null;

  const isBulk = members.length > 1;
  const singleMember = members[0];
  const short = members.filter((m) => m.payment_mismatch).length;

  const handleConfirm = async () => {
    if (!approvalDate) {
      notify('Please select an approval date.', 'error');
      return;
    }

    setBusy(true);
    let approvedCount = 0;
    const errors = [];

    for (const m of members) {
      try {
        const reason = approvalNote.trim() || (isBulk ? 'Bulk approved via UI' : 'Approved via UI');
        await api.put(`/members/${m.id}/approve`, null, {
          params: {
            reason,
            approved_date: approvalDate
          }
        });
        approvedCount++;
      } catch (err) {
        console.error(`Failed to approve member ${m.id}`, err);
        errors.push(`${m.fullName || m.name}: ${err.response?.data?.detail || 'Failed'}`);
      }
    }

    setBusy(false);

    if (errors.length > 0) {
      if (approvedCount > 0) {
        notify(`Approved ${approvedCount} member(s). ${errors.join('; ')}`, 'warning');
      } else {
        notify(errors.join('; '), 'error');
      }
    } else {
      if (isBulk) {
        notify(`Successfully approved ${approvedCount} member(s)! Moved to Membership List.`, 'success');
      } else {
        notify(`Membership for ${singleMember.fullName || singleMember.name} approved successfully! Moved to Membership List.`, 'success');
      }
    }

    if (onApproved) {
      onApproved({ approvedCount, errors, approvedIds: members.map((m) => m.id) });
    }
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !busy && onClose()}
      title={isBulk ? `Approve ${members.length} Members` : 'Approve Membership Application'}
      maxWidthClass="max-w-3xl"
      footer={
        <ModalFooter
          kind="confirm"
          onCancel={onClose}
          onSubmit={handleConfirm}
          busy={busy}
          disabled={!approvalDate}
          submitLabel={busy ? 'Approving...' : isBulk ? `Approve (${members.length})` : 'Approve'}
        />
      }
    >
      <div className="flex-1 bg-[#F6F1EA] p-5 sm:p-6 space-y-4">
        {/* Who is being approved */}
        <section className="bg-white border border-[#E8DFD8] rounded-2xl shadow-xs overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[#EFE6DE] bg-[#FDFBF8]">
            <div className="text-sm font-bold text-[#180200]">
              {isBulk ? `${members.length} selected applicants` : singleMember.fullName || singleMember.name}
            </div>
            <div className="flex items-center gap-2 text-[11px] font-semibold">
              <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">Receipt assigned</span>
              {short > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200">
                  {short} {short === 1 ? 'has' : 'have'} a payment shortage
                </span>
              )}
            </div>
          </div>

          {isBulk ? (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="sticky top-0 bg-[#FAF7F2] text-[10px] uppercase tracking-wider text-[#863221]">
                  <tr>
                    <th className="py-2 px-4 font-bold w-10">#</th>
                    <th className="py-2 px-2 font-bold">Applicant</th>
                    <th className="py-2 px-2 font-bold">Type</th>
                    <th className="py-2 px-2 font-bold">Receipt</th>
                    <th className="py-2 px-4 font-bold text-right">Payment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE6DE]">
                  {members.map((m, i) => (
                    <tr key={m.id} className="hover:bg-[#FDFBF8]">
                      <td className="py-2 px-4 text-[#A89B92]">{i + 1}</td>
                      <td className="py-2 px-2 font-semibold text-[#180200]">{m.fullName || m.name}</td>
                      <td className="py-2 px-2 text-[#5A4A42]">{m.membershipType || '—'}</td>
                      <td className="py-2 px-2 font-mono text-[#5A4A42]">{m.receiptNumber || m.assignedReceiptNumber || '—'}</td>
                      <td className="py-2 px-4 text-right">
                        {m.payment_mismatch ? (
                          <b className="text-red-700">{m.payment_no_receipt ? 'No payment' : `Short ₹${Number(m.payment_shortfall).toLocaleString('en-IN')}`}</b>
                        ) : (
                          <span className="text-emerald-700 font-medium">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {singleMember.payment_mismatch && (
                <div className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {singleMember.payment_no_receipt
                    ? 'No payment on record for this applicant.'
                    : `Paid ₹${Number(singleMember.payment_shortfall).toLocaleString('en-IN')} less than the price of the chosen type.`}
                </div>
              )}
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                {[
                  ['Type', singleMember.membershipType || '—'],
                  ['Mobile', singleMember.mobile || singleMember.mobileNumber || '—'],
                  ['Receipt', singleMember.receiptNumber || singleMember.assignedReceiptNumber || 'Assigned'],
                  ['Taluk', singleMember.talukName || singleMember.taluk || '—']
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-[#A89B92] mb-0.5">{label}</dt>
                    <dd className="font-semibold text-[#180200] break-words">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>

        {/* The decision: date and note */}
        <section className="bg-white border border-[#E8DFD8] rounded-2xl shadow-xs p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-[#180200] mb-1.5">
              Approval Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={approvalDate}
              max={getTodayDateStr()}
              onChange={(e) => setApprovalDate(e.target.value)}
              disabled={busy}
              className="w-full px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] font-medium"
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-[#180200] mb-1.5">
              Approval Note / Meeting Reference <span className="text-[#7D7068] font-normal">(Optional)</span>
            </label>
            <textarea
              value={approvalNote}
              onChange={(e) => setApprovalNote(e.target.value)}
              disabled={busy}
              rows={2}
              placeholder="e.g. EC Meeting Res #4, Approved by Executive Committee..."
              className="w-full px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] placeholder:text-[#9E8B7F]"
            />
          </div>
        </section>
      </div>
    </Modal>
  );
}
