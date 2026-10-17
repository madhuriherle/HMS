import React from 'react';
import { CreditCard, FileText, User, X } from 'lucide-react';
import Modal from './Modal';
import ModalFooter from './ModalFooter';
import { formatMoney } from '../utils/money';
import { formatDate } from '../utils/dateUtils';

// Helper for number to words (Indian Numbering System)
const numberToWords = (num) => {
  if (!num || isNaN(num) || num <= 0) return '';
  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const n = ('000000000' + num).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
  if (!n) return '';
  let str = '';
  str += (Number(n[1]) !== 0) ? (a[Number(n[1])] || b[n[1][0]] + ' ' + a[n[1][1]]) + 'Crore ' : '';
  str += (Number(n[2]) !== 0) ? (a[Number(n[2])] || b[n[2][0]] + ' ' + a[n[2][1]]) + 'Lakh ' : '';
  str += (Number(n[3]) !== 0) ? (a[Number(n[3])] || b[n[3][0]] + ' ' + a[n[3][1]]) + 'Thousand ' : '';
  str += (Number(n[4]) !== 0) ? (a[Number(n[4])] || b[n[4][0]] + ' ' + a[n[4][1]]) + 'Hundred ' : '';
  str += (Number(n[5]) !== 0) ? ((str !== '') ? 'and ' : '') + (a[Number(n[5])] || b[n[5][0]] + ' ' + a[n[5][1]]) : '';
  return str.trim() + ' Rupees Only';
};

// What a receipt line is called: the sub type the clerk picked, else the particular itself
const lineLabel = (i) => {
  const sub = (i.sub_type || i.description || '').trim();
  return sub && sub.toLowerCase() !== String(i.particular || '').trim().toLowerCase() ? sub : (i.particular || '');
};

// the full name of a line: "Particular › sub type" (just the particular when there is no sub type)
const fullLabel = (i) => (lineLabel(i) !== i.particular ? `${i.particular} › ${lineLabel(i)}` : i.particular || '');


/**
 * The receipt view popup: payee, particulars with the total, payment details, period and remarks. `receipt` is a
 * receipt row as the Receipt Tracking list returns it (normalised); the popup is closed with `onClose`.
 */
export default function ReceiptViewModal({ receipt, onClose, onChange = null, changeTitle = '' }) {
  return (
    <Modal isOpen={Boolean(receipt)} onClose={onClose}>
      {receipt && (
        <div className="bg-white rounded-2xl max-w-3xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
          {/* Modal Header */}
          <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#510601] text-white flex items-center justify-center font-bold">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#180200]">
                  Receipt {receipt.receiptNumber}
                </h2>
                <p className="text-xs text-[#863221]">
                  Issued on {formatDate(receipt.receiptDate)}
                </p>
              </div>
            </div>
            <button
              onClick={() => onClose()}
              className="p-1.5 rounded-lg text-stone-400 hover:text-[#510601] hover:bg-stone-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
            {/* Member Details */}
            <div className="bg-white rounded-xl p-4 border border-[#E8DFD8] space-y-2.5">
              <span className="text-[11px] font-bold text-[#510601] uppercase tracking-wider flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                <span>Member / Payee Information</span>
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Name</span>
                  <p className="font-bold text-[#180200] mt-0.5">
                    {receipt.name || <span className="text-gray-400 italic">Unassigned</span>}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Membership No.</span>
                  <p className="font-mono mt-0.5">{receipt.membershipNo || '—'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Mobile</span>
                  <p className="font-mono mt-0.5">{receipt.mobile || '—'}</p>
                </div>
                {receipt.panNo && (
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">PAN</span>
                    <p className="font-mono mt-0.5">{receipt.panNo}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Payment Details */}
            <div className="bg-white rounded-xl p-4 border border-[#E8DFD8] space-y-2.5">
              <span className="text-[11px] font-bold text-[#510601] uppercase tracking-wider flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5" />
                <span>Payment & Transaction</span>
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Receipt Type</span>
                  {receipt.items?.[0] ? (
                    <>
                      <p className="font-bold text-[#510601] mt-0.5">{fullLabel(receipt.items[0])}</p>
                    </>
                  ) : (
                    <p className="font-bold text-[#510601] mt-0.5">{receipt.particulars || 'Membership'}</p>
                  )}
                </div>
                {/* the same Particulars list with its Total for every receipt, even one with a single particular */}
                {receipt.items?.length > 0 && (
                  <div className="col-span-2 sm:col-span-3">
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Particulars</span>
                    <div className="mt-1 rounded-xl border border-[#E8DFD8] overflow-hidden">
                      {receipt.items.map((it, i) => (
                        <div key={it.id || i} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs border-b last:border-b-0 border-[#E8DFD8]/70">
                          <span className="font-semibold text-[#180200]">
                            {i + 1}. {it.particular}
                            {(it.sub_type || it.description) && (it.sub_type || it.description) !== it.particular && (
                              <span className="font-normal text-[#863221]"> — {it.sub_type || it.description}</span>
                            )}
                          </span>
                          <span className="font-mono font-bold">{formatMoney(it.amount)}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between px-3 py-1.5 text-xs bg-[#FAF7F2] font-bold">
                        <span>Total</span>
                        <span className="font-mono">{formatMoney(receipt.amount)}</span>
                      </div>
                    </div>
                  </div>
                )}
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Payment Mode</span>
                  <p className="font-medium mt-0.5">{receipt.paymentMode || '—'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Amount in Words</span>
                  <p className="italic text-[#863221] mt-0.5">{numberToWords(receipt.amount)}</p>
                </div>
                {receipt.bankName && (
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Bank / Account</span>
                    <p className="font-medium mt-0.5">{receipt.bankName}</p>
                  </div>
                )}
                {receipt.transactionId && (
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Txn ID / Cheque No.</span>
                    <p className="font-mono mt-0.5">{receipt.transactionId}</p>
                  </div>
                )}
              </div>

              {(receipt.periodFromDate || receipt.periodToDate || receipt.periodFromTime || receipt.periodToTime) && (
                <div className="pt-2 border-t border-[#E8DFD8]">
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Period</span>
                  <p className="mt-0.5 text-[#180200]">
                    {[
                      [receipt.periodFromDate, receipt.periodToDate].filter(Boolean).map(formatDate).join(' to '),
                      [receipt.periodFromTime, receipt.periodToTime].filter(Boolean).map((t) => String(t).slice(0, 5)).join(' to ')
                    ].filter(Boolean).join(', ')}
                  </p>
                </div>
              )}

              {receipt.description && (
                <div className="pt-2 border-t border-[#E8DFD8]">
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Remarks / Description</span>
                  <p className="mt-0.5 text-[#180200]">{receipt.description}</p>
                </div>
              )}
            </div>
          </div>

          {/* Read-only footer */}
          <ModalFooter
            kind="view"
            onCancel={() => onClose()}
            left={
              onChange ? (
                <button
                  type="button"
                  onClick={onChange}
                  title={changeTitle || 'Replace this with another receipt'}
                  className="h-10 px-4 rounded-xl border border-[#510601] text-[#510601] hover:bg-white text-sm font-semibold transition-colors cursor-pointer"
                >
                  Change receipt
                </button>
              ) : null
            }
          />
        </div>
      )}
    </Modal>
  );
}
