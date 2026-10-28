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
      maxWidthClass="max-w-lg"
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
      <div className="p-6 space-y-4">
        {/* Applicant Summary */}
        <div className="p-3.5 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs space-y-2">
          {isBulk ? (
            <>
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#180200] text-sm">
                  {members.length} Selected Applicants
                </span>
                <span className="text-[11px] font-semibold text-[#863221] bg-white px-2 py-0.5 rounded-md border border-[#E8DFD8]">
                  All receipts assigned
                </span>
              </div>
              <div className="max-h-28 overflow-y-auto divide-y divide-[#E8DFD8]/60 pr-1 border-t border-[#E8DFD8]/60 pt-1.5">
                {members.map((m) => (
                  <div key={m.id} className="py-1 flex items-center justify-between">
                    <span className="font-semibold text-[#180200]">{m.fullName || m.name}</span>
                    <span className="text-[11px] text-[#7D7068]">
                      {m.payment_mismatch && (
                        <b className="text-red-700 mr-2">{m.payment_no_receipt ? 'No payment' : `Short ₹${Number(m.payment_shortfall).toLocaleString('en-IN')}`}</b>
                      )}
                      {m.membershipType || ''}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="font-bold text-[#180200] text-sm">
                {singleMember.fullName || singleMember.name}
              </div>
              {singleMember.payment_mismatch && (
                <div className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
                  {singleMember.payment_no_receipt
                    ? 'No payment on record for this applicant.'
                    : `Paid ₹${Number(singleMember.payment_shortfall).toLocaleString('en-IN')} less than the price of the chosen type.`}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-[#863221]">
                <div>Type: <strong className="text-[#180200]">{singleMember.membershipType || '—'}</strong></div>
                <div>Mobile: <strong className="text-[#180200] font-mono">{singleMember.mobile || singleMember.mobileNumber || '—'}</strong></div>
                <div>Receipt: <strong className="text-[#180200] font-mono">{singleMember.receiptNumber || singleMember.assignedReceiptNumber || 'Assigned'}</strong></div>
                <div>Taluk: <strong className="text-[#180200]">{singleMember.talukName || singleMember.taluk || '—'}</strong></div>
              </div>
            </>
          )}
        </div>

        {/* Approval Date Selection */}
        <div>
          <label className="block text-xs font-bold text-[#180200] mb-1">
            Approval Date <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={approvalDate}
            max={getTodayDateStr()}
            onChange={(e) => setApprovalDate(e.target.value)}
            disabled={busy}
            className="w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] font-medium"
            required
          />
        </div>

        {/* Approval Note / Resolution */}
        <div>
          <label className="block text-xs font-bold text-[#180200] mb-1">
            Approval Note / Meeting Reference <span className="text-[#7D7068] font-normal">(Optional)</span>
          </label>
          <textarea
            value={approvalNote}
            onChange={(e) => setApprovalNote(e.target.value)}
            disabled={busy}
            rows={2}
            placeholder="e.g. EC Meeting Res #4, Approved by Executive Committee..."
            className="w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] placeholder:text-[#9E8B7F]"
          />
        </div>
      </div>
    </Modal>
  );
}
