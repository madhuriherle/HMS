import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
import {
  ChevronRight,
  Search,
  Eye,
  Pencil,
  Trash2,
  Link as LinkIcon,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  X,
  FileSpreadsheet,
  User,
  Phone,
  Calendar,
  Award,
  Check,
  RotateCcw,
  Printer,
  FileText,
  Building,
  CreditCard
} from 'lucide-react';
import Modal from '../components/Modal';
import { isReceiptUnmapped } from '../utils/displayHelpers';
import { loadParticulars, loadMembers, loadPaymentModeConfigs } from '../utils/serverData';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import api from '../api';
import { formatDate } from '../utils/dateUtils';
import DateInput from '../components/DateInput';
import { apiErrorMessage } from '../utils/apiError';
import { askForm, askReason, confirmYesNo } from '../utils/dialogs';
import { notify } from '../utils/notify';
import { fetchReceipts, normalizeReceipt, receiptToApiPayload } from '../utils/apiAdapters';

// Helper to format currency in Indian Rupees
const formatINR = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount || 0);
};

// Helper to format date string (YYYY-MM-DD to DD-MM-YYYY)
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

export default function ReceiptTracking() {
  const { hasPermission } = useAuth();
  // Master Synchronized Stores
  const [receipts, setReceipts] = useState([]);
  const [members, setMembers] = useState([]);
  const [unapprovedMembers, setUnapprovedMembers] = useState([]);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [particularsFilter, setParticularsFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL'); // ALL, Assigned, Unassigned

  // Modals State
  const [viewingReceipt, setViewingReceipt] = useState(null);
  const [editingReceipt, setEditingReceipt] = useState(null);
  const [editFormData, setEditFormData] = useState({});
  const [editFormErrors, setEditFormErrors] = useState({});
  const [deletingReceipt, setDeletingReceipt] = useState(null);

  // Toast State
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (message, type = 'success') => {
    notify(message, type);
  };

  // Particular names for the filter / edit dropdowns come from the Particulars master
  const [particularOptions, setParticularOptions] = useState([]);
  const [paymentModeOptions, setPaymentModeOptions] = useState([]);

  const reloadData = async () => {
    const fail = (what) => (error) => {
      console.error(`Failed to load ${what}.`, error);
      showToast(error.response?.data?.detail || `Failed to load ${what} from the server.`, 'error');
    };
    await Promise.all([
      fetchReceipts().then(setReceipts).catch(fail('receipts')),
      api.get('/members/', { params: { limit: 500 } })
        .then((res) => setMembers((res.data?.data || []).map((m) => ({
          ...m,
          name: [m.first_name_en, m.last_name_en].filter(Boolean).join(' ')
        }))))
        .catch(fail('members')),
      loadMembers({ approval_status: 'UNAPPROVED' }).then(setUnapprovedMembers).catch(fail('unapproved members')),
      loadParticulars()
        .then((all) => setParticularOptions(all.filter((p) => p.status === 'Active').map((p) => p.name)))
        .catch(fail('particulars')),
      loadPaymentModeConfigs()
        .then((all) => setPaymentModeOptions([...new Set(all.filter((c) => c.status === 'Active').map((c) => c.paymentMode))]))
        .catch(fail('payment modes'))
    ]);
  };

  // Synchronize on mount
  useEffect(() => {
    reloadData();
  }, []);

  // ----------------------------------------------------
  // FILTERING LOGIC
  // ----------------------------------------------------
  const filteredReceipts = useMemo(() => {
    return receipts.filter((r) => {
      const isUnmapped = isReceiptUnmapped(r);

      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const numMatch = (r.receiptNumber || '').toLowerCase().includes(q);
        const nameMatch = (r.name || '').toLowerCase().includes(q);
        const mobileMatch = (r.mobile || '').includes(q);
        const memberNoMatch = (r.membershipNo || '').toLowerCase().includes(q);
        const particularsMatch = (r.particulars || '').toLowerCase().includes(q);
        const txnMatch = (r.transactionId || '').toLowerCase().includes(q);

        if (
          !numMatch &&
          !nameMatch &&
          !mobileMatch &&
          !memberNoMatch &&
          !particularsMatch &&
          !txnMatch
        ) {
          return false;
        }
      }

      // 2. Particulars / Receipt Type Filter
      if (particularsFilter !== 'ALL') {
        const rPart = (r.particulars || '').toLowerCase();
        if (rPart !== particularsFilter.toLowerCase()) {
          return false;
        }
      }

      // 3. Status Filter (Assigned vs Unassigned)
      if (statusFilter === 'Assigned' && isUnmapped) {
        return false;
      }
      if (statusFilter === 'Unassigned' && !isUnmapped) {
        return false;
      }

      return true;
    });
  }, [receipts, searchQuery, particularsFilter, statusFilter]);

  // ----------------------------------------------------
  // ACTION HANDLERS
  // ----------------------------------------------------

  // 1. Open Edit Modal
  const handleOpenEdit = (receipt) => {
    setEditingReceipt(receipt);
    setEditFormData({
      receiptNumber: receipt.receiptNumber || '',
      receiptDate: receipt.receiptDate || '',
      name: receipt.name || '',
      panNo: receipt.panNo || '',
      membershipNo: receipt.membershipNo || '',
      mobile: receipt.mobile || '',
      particulars: receipt.particulars || 'Membership',
      donationDetails: receipt.donationDetails || '',
      othersDescription: receipt.othersDescription || '',
      amount: String(receipt.amount || ''),
      paymentMode: receipt.paymentMode || 'Online',
      bankName: receipt.bankName || receipt.bankAccount || '',
      transactionId: receipt.transactionId || '',
      transactionDate: receipt.transactionDate || '',
      description: receipt.description || ''
    });
    setEditFormErrors({});
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    if (name === 'amount') {
      const cleaned = value.replace(/\D/g, '');
      setEditFormData((prev) => ({ ...prev, amount: cleaned }));
    } else if (name === 'panNo') {
      setEditFormData((prev) => ({ ...prev, panNo: value.toUpperCase() }));
    } else if (name === 'mobile') {
      const cleaned = value.replace(/\D/g, '').slice(0, 10);
      setEditFormData((prev) => ({ ...prev, mobile: cleaned }));
    } else {
      setEditFormData((prev) => ({ ...prev, [name]: value }));
    }

    if (editFormErrors[name]) {
      setEditFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    const errors = {};

    if (!editFormData.receiptNumber?.trim()) {
      errors.receiptNumber = 'Receipt No. is required';
    }
    if (!editFormData.receiptDate) {
      errors.receiptDate = 'Receipt Date is required';
    }
    if (!editFormData.particulars) {
      errors.particulars = 'Please select Receipt Type';
    }
    const amt = Number(editFormData.amount);
    if (!editFormData.amount || isNaN(amt) || amt <= 0) {
      errors.amount = 'Valid Amount > 0 is required';
    }
    if (!editFormData.paymentMode) {
      errors.paymentMode = 'Payment Mode is required';
    }

    if (Object.keys(errors).length > 0) {
      setEditFormErrors(errors);
      showToast('Please fix highlighted required fields.', 'error');
      return;
    }

    const uiPayload = {
      receiptNumber: editFormData.receiptNumber.trim(),
      receiptDate: editFormData.receiptDate,
      name: editFormData.name ? editFormData.name.trim() : '',
      panNo: editFormData.panNo ? editFormData.panNo.trim() : '',
      membershipNo: editFormData.membershipNo ? editFormData.membershipNo.trim() : '',
      mobile: editFormData.mobile ? editFormData.mobile.trim() : '',
      particulars: editFormData.particulars,
      donationDetails: editFormData.donationDetails ? editFormData.donationDetails.trim() : '',
      othersDescription: editFormData.othersDescription ? editFormData.othersDescription.trim() : '',
      amount: Number(editFormData.amount),
      paymentMode: editFormData.paymentMode,
      bankName: editFormData.bankName ? editFormData.bankName.trim() : '',
      bankAccount: editFormData.bankName ? editFormData.bankName.trim() : '',
      transactionId: editFormData.transactionId ? editFormData.transactionId.trim() : '',
      transactionDate: editFormData.transactionDate,
      description: editFormData.description ? editFormData.description.trim() : ''
    };

    try {
      const apiPayload = receiptToApiPayload(uiPayload);
      delete apiPayload.receipt_number;
      delete apiPayload.items;
      delete apiPayload.allocations;
      const editId = editingReceipt.id;
      // Close the form first so the confirmation popup opens over a closed form.
      setEditingReceipt(null);
      const { data } = await api.put(`/receipts/${editId}`, apiPayload);
      const updated = normalizeReceipt(data);
      setReceipts((prev) => prev.map((r) => (r.id === editId ? updated : r)));
      showToast(`Receipt #${updated.receiptNumber} updated successfully.`);
    } catch (error) {
      console.error('Failed to update receipt.', error);
      showToast(error.response?.data?.detail || 'Failed to update receipt through API.', 'error');
    }
  };

  // 2. Delete Receipt
  // ----------------------------------------------------
  // RECEIPT ACTIONS (all server calls): map / unmap, refund, cancel
  // ----------------------------------------------------
  const isPendingApproval = (data) => Boolean(data && (data.approval_request_id || data.status === 'PENDING'));

  const afterReceiptAction = async (data, doneMessage, pendingMessage) => {
    showToast(isPendingApproval(data) ? pendingMessage : doneMessage);
    setViewingReceipt(null);
    await reloadData();
  };

  const handleMapReceipt = async (receipt) => {
    const v = await askForm({
      title: `Map receipt #${receipt.receiptNumber} to a member`,
      confirmText: 'Map receipt',
      fields: [
        {
          name: 'memberId',
          label: 'Member',
          type: 'select',
          required: true,
          options: members.map((m) => ({
            value: m.id,
            label: `${m.name || m.first_name_en || ''} (${m.member_code || `#${m.id}`})`
          }))
        },
        { name: 'amount', label: 'Amount to allocate', type: 'number', required: true, value: receipt.amount }
      ]
    });
    if (!v) return;
    try {
      const { data } = await api.post(`/receipts/${receipt.id}/allocate`, {
        member_id: Number(v.memberId),
        allocated_amount: v.amount
      });
      await afterReceiptAction(data, 'Receipt mapped to the member.', 'Mapping submitted for approval.');
    } catch (error) {
      showToast(error.response?.data?.detail || 'Error mapping the receipt', 'error');
    }
  };

  const handleRemoveMapping = async (receipt) => {
    try {
      const { data: allocations } = await api.get(`/receipts/${receipt.id}/allocations`);
      if (!allocations.length) {
        showToast('This receipt is not mapped to anyone.', 'error');
        return;
      }
      let target = allocations[0];
      if (allocations.length > 1) {
        const v = await askForm({
          title: 'Remove which mapping?',
          confirmText: 'Remove',
          fields: [{
            name: 'allocationId',
            label: 'Mapping',
            type: 'select',
            required: true,
            options: allocations.map((a) => ({
              value: a.id,
              label: `${a.member_name || a.associate_name || `#${a.id}`} - ${a.allocated_amount}`
            }))
          }]
        });
        if (!v) return;
        target = allocations.find((a) => String(a.id) === String(v.allocationId));
      } else {
        const ok = await confirmYesNo({
          title: 'Remove the mapping?',
          text: `Receipt #${receipt.receiptNumber} will no longer be mapped to ${target.member_name || 'this member'}.`,
          confirmText: 'Yes, remove',
          danger: true
        });
        if (!ok) return;
      }
      const { data } = await api.delete(`/receipts/${receipt.id}/allocations/${target.id}`);
      await afterReceiptAction(data, 'Mapping removed.', 'Removal submitted for approval.');
    } catch (error) {
      showToast(error.response?.data?.detail || 'Error removing the mapping', 'error');
    }
  };

  const handleRefundReceipt = async (receipt) => {
    const v = await askForm({
      title: `Refund receipt #${receipt.receiptNumber}`,
      confirmText: 'Record refund',
      fields: [
        { name: 'amount', label: 'Refund amount', type: 'number', required: true, value: receipt.amount },
        { name: 'reference', label: 'Refund reference (optional)' }
      ]
    });
    if (!v) return;
    try {
      const { data } = await api.post(`/receipts/${receipt.id}/refund`, {
        amount: v.amount,
        status: 'PENDING',
        refund_reference: v.reference || null
      });
      await afterReceiptAction(data, 'Refund recorded.', 'Refund submitted for approval.');
    } catch (error) {
      showToast(error.response?.data?.detail || 'Error recording the refund', 'error');
    }
  };

  const handleCancelReceipt = async (receipt) => {
    const reason = await askReason({
      title: `Cancel receipt #${receipt.receiptNumber}?`,
      text: 'A cancelled receipt stays on record but no longer counts as paid.',
      confirmText: 'Yes, cancel receipt',
      danger: true
    });
    if (!reason) return;
    try {
      const { data } = await api.post(`/receipts/${receipt.id}/cancel`, { reason });
      await afterReceiptAction(data, 'Receipt cancelled.', 'Cancellation submitted for approval.');
    } catch (error) {
      showToast(error.response?.data?.detail || 'Error cancelling the receipt', 'error');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingReceipt) return;

    const num = deletingReceipt.receiptNumber;
    try {
      await api.delete(`/receipts/${deletingReceipt.id}`, { params: { reason: 'Deleted via UI' } });
      setReceipts((prev) => prev.filter((r) => r.id !== deletingReceipt.id));
      showToast(`Receipt #${num} deleted successfully.`);
    } catch (error) {
      console.error('Failed to delete receipt.', error);
      showToast(error.response?.data?.detail || 'Failed to delete receipt through API.', 'error');
    }

    setDeletingReceipt(null);
  };

  return (
    <PermissionGate required="receipts.tracking.read">
    <div className="space-y-6 pb-16 font-sans">
      {/* Toast Alert Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-[10000] flex items-center gap-3 rounded-2xl px-5 py-3.5 shadow-2xl border transition-all animate-in slide-in-from-bottom-4 duration-200 ${
            toastMessage.type === 'error'
              ? 'bg-[#180200] text-white border-red-500/50'
              : 'bg-[#180200] text-white border-emerald-500/50'
          }`}
        >
          {toastMessage.type === 'error' ? (
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          )}
          <span className="text-xs sm:text-sm font-medium">{toastMessage.message}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 rounded-lg p-1 hover:bg-white/10 text-stone-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header, Filter & Search Toolbar */}
      <SearchFilterBar
        
        title={<h1 className="text-2xl sm:text-3xl font-bold text-[#180200] tracking-tight">Receipt Tracking</h1>}
        searchQuery={searchQuery}
        onSearchChange={(val) => setSearchQuery(val)}
        activeFiltersCount={
          (particularsFilter !== 'ALL' ? 1 : 0) +
          (statusFilter !== 'ALL' ? 1 : 0)
        }
        onResetFilters={() => {
          setSearchQuery('');
          setParticularsFilter('ALL');
          setStatusFilter('ALL');
        }}
      >
        {/* Receipt Type Filter */}
        <FilterSelect
          value={particularsFilter}
          onChange={(val) => setParticularsFilter(val)}
          options={[
            { value: 'ALL', label: 'All Receipt Types' },
            ...particularOptions.map((opt) => ({ value: opt, label: opt }))
          ]}
          widthClass="w-full sm:w-56"
        />

        {/* Status Filter */}
        <FilterSelect
          value={statusFilter}
          onChange={(val) => setStatusFilter(val)}
          options={[
            { value: 'ALL', label: 'All Statuses' },
            { value: 'Assigned', label: 'Assigned' },
            { value: 'Unassigned', label: 'Unassigned' }
          ]}
          widthClass="w-full sm:w-48"
        />
      </SearchFilterBar>

      {/* Main Table Card (EXACTLY 6 Columns) */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-bold text-[#863221] uppercase tracking-wider">
                <th className="py-3.5 px-4 whitespace-nowrap">Receipt Number</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Receipt Date</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Name</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Mobile</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Receipt Type</th>
                <th className="py-3.5 px-4 text-right whitespace-nowrap">Amount</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Payment Mode</th>
                <th className="py-3.5 px-4 text-right whitespace-nowrap min-w-[170px]">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8] text-xs sm:text-sm">
              {filteredReceipts.length === 0 ? (
                <tr>
                  <td colSpan="8" className="py-14 text-center text-[#863221]">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <FileSpreadsheet className="w-10 h-10 text-[#863221]/40" />
                      <p className="text-base font-bold text-[#180200]">No receipts found</p>
                      <p className="text-xs text-[#863221] max-w-sm mx-auto">
                        Every receipt in the system (assigned and unassigned) will appear here.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredReceipts.map((receipt) => {
                  const isUnmapped = isReceiptUnmapped(receipt);

                  return (
                    <tr
                      key={receipt.id}
                      className={`transition-colors ${
                        isUnmapped
                          ? 'bg-amber-50/70 hover:bg-amber-100/60 text-[#180200]'
                          : 'bg-white hover:bg-[#FAF7F2]/60 text-[#180200]'
                      }`}
                    >
                      {/* Column 1: Receipt Number */}
                      <td className="py-3.5 px-4 font-mono font-bold text-xs">
                        <span className={`px-2 py-0.5 rounded tracking-wider border ${
                          isUnmapped
                            ? 'bg-amber-100/80 text-amber-900 border-amber-300'
                            : 'bg-[#510601]/5 text-[#510601] border-[#510601]/20'
                        }`}>
                          #{receipt.receiptNumber}
                        </span>
                      </td>

                      {/* Column 2: Receipt Date */}
                      <td className="py-3.5 px-4 font-mono text-xs whitespace-nowrap">
                        {formatDate(receipt.receiptDate)}
                      </td>

                      {/* Column 3: Member Name */}
                      <td className="py-3.5 px-4">
                        <div>
                          <span className="font-bold text-[#180200]">{receipt.name || '—'}</span>
                          {isUnmapped ? (
                            <div className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-200/60 text-amber-900 border border-amber-300/80">
                              <AlertTriangle className="w-3 h-3 text-amber-700 shrink-0" />
                              <span>Unassigned</span>
                            </div>
                          ) : (
                            receipt.membershipNo && (
                              <div className="text-[10px] font-mono text-[#863221] mt-0.5">#{receipt.membershipNo}</div>
                            )
                          )}
                        </div>
                      </td>

                      {/* Column 4: Mobile */}
                      <td className="py-3.5 px-4 font-mono text-xs">
                        {!receipt.mobile ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          receipt.mobile
                        )}
                      </td>

                      {/* Column 5: Receipt Type */}
                      <td className="py-3.5 px-4 font-semibold text-[#510601] text-xs">
                        {receipt.particulars || 'Membership'}
                      </td>

                      {/* Column 5b/5c: Amount and Payment Mode */}
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-xs whitespace-nowrap">
                        {formatINR(receipt.amount)}
                      </td>
                      <td className="py-3.5 px-4 text-xs">{receipt.paymentMode || '—'}</td>

                      {/* Column 6: Action */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* View Action */}
                          <button
                            type="button"
                            onClick={() => setViewingReceipt(receipt)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#510601] bg-[#FAF7F2] border border-[#E8DFD8] rounded-lg hover:bg-[#F1E7DE] transition-colors cursor-pointer shrink-0"
                            title="View Receipt Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View</span>
                          </button>

                          {/* Edit Action */}
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(receipt)}
                            disabled={!hasPermission('receipts.tracking.write')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                            title={!hasPermission('receipts.tracking.write') ? 'Requires receipts.tracking.write permission' : 'Edit Receipt'}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>

                          {/* Delete Action */}
                          <button
                            type="button"
                            onClick={() => setDeletingReceipt(receipt)}
                            disabled={!hasPermission('receipts.tracking.delete')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                            title={!hasPermission('receipts.tracking.delete') ? 'Requires receipts.tracking.delete permission' : 'Delete Receipt'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary bar */}
        <div className="px-5 py-3.5 bg-[#FAF7F2]/60 border-t border-[#E8DFD8] flex flex-col sm:flex-row items-center justify-between text-xs text-[#863221] gap-2">
          <div>
            Showing <strong className="text-[#180200]">{filteredReceipts.length}</strong> of{' '}
            <strong className="text-[#180200]">{receipts.length}</strong> total receipts
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">
              <span className="w-2 h-2 rounded-full bg-emerald-600" />
              <span>{receipts.filter((r) => !isReceiptUnmapped(r)).length} Assigned</span>
            </span>
            <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>{receipts.filter((r) => isReceiptUnmapped(r)).length} Unassigned</span>
            </span>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* MODAL 1: VIEW RECEIPT DETAILS                                */}
      {/* ============================================================ */}
      <Modal isOpen={Boolean(viewingReceipt)} onClose={() => setViewingReceipt(null)}>
        {viewingReceipt && (
          <div className="bg-white rounded-2xl max-w-3xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#510601] text-white flex items-center justify-center font-bold">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[#180200]">
                    Receipt #{viewingReceipt.receiptNumber}
                  </h2>
                  <p className="text-xs text-[#863221]">
                    Issued on {formatDate(viewingReceipt.receiptDate)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setViewingReceipt(null)}
                className="p-1.5 rounded-lg text-stone-400 hover:text-[#510601] hover:bg-stone-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              {/* Status Header Chip */}
              <div className="p-3 bg-[#FAF7F2]/60 rounded-xl border border-[#E8DFD8] flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221] block">Status</span>
                  {isReceiptUnmapped(viewingReceipt) ? (
                    <span className="inline-flex items-center gap-1 mt-0.5 px-2.5 py-0.5 rounded-md text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                      <span>Unassigned</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 mt-0.5 px-2.5 py-0.5 rounded-md text-xs font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Assigned to Member #{viewingReceipt.membershipNo || viewingReceipt.memberId}</span>
                    </span>
                  )}
                </div>

                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-[#863221] block">Amount Paid</span>
                  <span className="text-base font-extrabold text-[#510601]">
                    {formatINR(viewingReceipt.amount)}
                  </span>
                </div>
              </div>

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
                      {viewingReceipt.name || <span className="text-gray-400 italic">Unassigned</span>}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Membership No.</span>
                    <p className="font-mono mt-0.5">{viewingReceipt.membershipNo || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Mobile</span>
                    <p className="font-mono mt-0.5">{viewingReceipt.mobile || '—'}</p>
                  </div>
                  {viewingReceipt.panNo && (
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#863221]">PAN</span>
                      <p className="font-mono mt-0.5">{viewingReceipt.panNo}</p>
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
                    <p className="font-bold text-[#510601] mt-0.5">{viewingReceipt.particulars || 'Membership'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Payment Mode</span>
                    <p className="font-medium mt-0.5">{viewingReceipt.paymentMode || 'Online'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Amount in Words</span>
                    <p className="italic text-[#863221] mt-0.5">{numberToWords(viewingReceipt.amount)}</p>
                  </div>
                  {viewingReceipt.bankName && (
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#863221]">Bank / Account</span>
                      <p className="font-medium mt-0.5">{viewingReceipt.bankName}</p>
                    </div>
                  )}
                  {viewingReceipt.transactionId && (
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#863221]">Txn ID / Cheque No.</span>
                      <p className="font-mono mt-0.5">{viewingReceipt.transactionId}</p>
                    </div>
                  )}
                </div>

                {viewingReceipt.description && (
                  <div className="pt-2 border-t border-[#E8DFD8]">
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Remarks / Description</span>
                    <p className="mt-0.5 text-[#180200]">{viewingReceipt.description}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Read-only footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 border-t border-[#E8DFD8] bg-[#FAF7F2]">
              <div />
              <button
                type="button"
                onClick={() => setViewingReceipt(null)}
                className="px-5 py-2 bg-white hover:bg-stone-50 border border-[#E8DFD8] text-[#863221] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ============================================================ */}
      {/* MODAL 2: EDIT RECEIPT RECORD                                 */}
      {/* ============================================================ */}
      <Modal isOpen={Boolean(editingReceipt)} onClose={() => setEditingReceipt(null)}>
        {editingReceipt && (
          <div className="bg-white rounded-2xl max-w-4xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            <form onSubmit={handleSaveEdit}>
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2]">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#510601] text-white flex items-center justify-center font-bold">
                    <Pencil className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-[#180200]">
                      Edit Receipt #{editingReceipt.receiptNumber}
                    </h2>
                    <p className="text-xs text-[#863221]">
                      Update existing receipt details
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingReceipt(null)}
                  className="p-1.5 rounded-lg text-stone-400 hover:text-[#510601] hover:bg-stone-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Receipt Number */}
                  <div>
                    <label className="block text-[11px] font-bold text-[#863221] uppercase mb-1">
                      Receipt Number <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="receiptNumber"
                      value={editFormData.receiptNumber || ''}
                      onChange={handleEditChange}
                      className="w-full py-2 px-3 bg-white border border-[#E8DFD8] rounded-xl font-mono text-xs focus:outline-none focus:border-[#510601]"
                    />
                    {editFormErrors.receiptNumber && (
                      <p className="text-[10px] text-red-500 mt-1">{editFormErrors.receiptNumber}</p>
                    )}
                  </div>

                  {/* Receipt Date */}
                  <div>
                    <label className="block text-[11px] font-bold text-[#863221] uppercase mb-1">
                      Receipt Date <span className="text-red-500">*</span>
                    </label>
                    <DateInput
                      name="receiptDate"
                      value={editFormData.receiptDate || ''}
                      onChange={handleEditChange}
                      className="w-full py-2 px-3 bg-white border border-[#E8DFD8] rounded-xl font-mono text-xs focus:outline-none focus:border-[#510601]"
                    />
                  </div>

                  {/* Payee / Member Name */}
                  <div>
                    <label className="block text-[11px] font-bold text-[#863221] uppercase mb-1">
                      Payee / Member Name
                    </label>
                    <input
                      type="text"
                      name="name"
                      value={editFormData.name || ''}
                      onChange={handleEditChange}
                      className="w-full py-2 px-3 bg-white border border-[#E8DFD8] rounded-xl text-xs focus:outline-none focus:border-[#510601]"
                    />
                  </div>

                  {/* Mobile */}
                  <div>
                    <label className="block text-[11px] font-bold text-[#863221] uppercase mb-1">
                      Mobile Number
                    </label>
                    <input
                      type="text"
                      name="mobile"
                      value={editFormData.mobile || ''}
                      onChange={handleEditChange}
                      maxLength={10}
                      className="w-full py-2 px-3 bg-white border border-[#E8DFD8] rounded-xl font-mono text-xs focus:outline-none focus:border-[#510601]"
                    />
                  </div>

                  {/* Particulars / Receipt Type */}
                  <div>
                    <label className="block text-[11px] font-bold text-[#863221] uppercase mb-1">
                      Receipt Type / Particulars <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="particulars"
                      value={editFormData.particulars || 'Membership'}
                      onChange={handleEditChange}
                      className="w-full py-2 px-3 bg-white border border-[#E8DFD8] rounded-xl text-xs focus:outline-none focus:border-[#510601] cursor-pointer"
                    >
                      {particularOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="block text-[11px] font-bold text-[#863221] uppercase mb-1">
                      Amount (₹) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="amount"
                      value={editFormData.amount || ''}
                      onChange={handleEditChange}
                      className="w-full py-2 px-3 bg-white border border-[#E8DFD8] rounded-xl font-mono font-bold text-xs focus:outline-none focus:border-[#510601]"
                    />
                    {editFormErrors.amount && (
                      <p className="text-[10px] text-red-500 mt-1">{editFormErrors.amount}</p>
                    )}
                  </div>

                  {/* Payment Mode */}
                  <div>
                    <label className="block text-[11px] font-bold text-[#863221] uppercase mb-1">
                      Payment Mode <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="paymentMode"
                      value={editFormData.paymentMode || ''}
                      onChange={handleEditChange}
                      className="w-full py-2 px-3 bg-white border border-[#E8DFD8] rounded-xl text-xs focus:outline-none focus:border-[#510601] cursor-pointer"
                    >
                      {editFormData.paymentMode && !paymentModeOptions.includes(editFormData.paymentMode) && (
                        <option value={editFormData.paymentMode}>{editFormData.paymentMode}</option>
                      )}
                      {paymentModeOptions.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Transaction ID */}
                  <div>
                    <label className="block text-[11px] font-bold text-[#863221] uppercase mb-1">
                      Txn ID / Cheque No.
                    </label>
                    <input
                      type="text"
                      name="transactionId"
                      value={editFormData.transactionId || ''}
                      onChange={handleEditChange}
                      className="w-full py-2 px-3 bg-white border border-[#E8DFD8] rounded-xl font-mono text-xs focus:outline-none focus:border-[#510601]"
                    />
                  </div>

                  {/* Description / Remarks */}
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-[#863221] uppercase mb-1">
                      Description / Remarks
                    </label>
                    <textarea
                      name="description"
                      value={editFormData.description || ''}
                      onChange={handleEditChange}
                      rows={2}
                      className="w-full py-2 px-3 bg-white border border-[#E8DFD8] rounded-xl text-xs focus:outline-none focus:border-[#510601]"
                    />
                  </div>
                </div>
              </div>

              {/* Footer */}
              </div>
            <div className="shrink-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E8DFD8] bg-[#FAF7F2]">
                <button
                  type="button"
                  onClick={() => setEditingReceipt(null)}
                  className="px-4 py-2 bg-white hover:bg-stone-50 border border-[#E8DFD8] text-[#863221] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!hasPermission('receipts.tracking.write')}
                  title={!hasPermission('receipts.tracking.write') ? 'Requires receipts.tracking.write permission' : undefined}
                  className="px-5 py-2 bg-[#510601] hover:bg-[#863221] text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        )}
      </Modal>

      {/* ============================================================ */}
      {/* MODAL 4: DELETE CONFIRMATION MODAL                           */}
      {/* ============================================================ */}
      <Modal isOpen={Boolean(deletingReceipt)} onClose={() => setDeletingReceipt(null)}>
        {deletingReceipt && (
          <div className="bg-white rounded-2xl max-w-2xl w-full border border-[#E8DFD8] shadow-2xl p-6 text-center animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-[#180200]">Delete Receipt</h3>
            <p className="text-xs text-[#863221] mt-1.5 leading-relaxed">
              Are you sure you want to delete receipt <strong>#{deletingReceipt.receiptNumber}</strong>? This will permanently remove the record.
            </p>

            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setDeletingReceipt(null)}
                className="w-full py-2.5 px-4 bg-white hover:bg-stone-50 border border-[#E8DFD8] text-[#863221] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={!hasPermission('receipts.tracking.delete')}
                title={!hasPermission('receipts.tracking.delete') ? 'Requires receipts.tracking.delete permission' : undefined}
                className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-sm transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
    </PermissionGate>
  );
}
