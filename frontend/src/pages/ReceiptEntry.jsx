import React, { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import {
  ChevronRight,
  User,
  CheckCircle2,
  AlertCircle,
  X,
  RotateCcw,
  Save,
  Users,
  Info,
  Search,
  Eye,
  FileText,
  MapPin,
  Phone,
  Mail,
  Printer,
  Tag,
  Building,
  Heart,
  Briefcase
} from 'lucide-react';
import Modal from '../components/Modal';
import {
  loadParticulars,
  loadMembershipTypes,
  loadPaymentModeConfigs,
  loadRenewals,
  loadMembers,
  loadReceipts
} from '../utils/serverData';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import api from '../api';
import {
  fetchMembers,
  fetchReceipts,
  normalizeReceipt,
  receiptToApiPayload,
  unwrapList,
} from '../utils/apiAdapters';

// Helper to convert number to words (Indian Numbering System)
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

export default function ReceiptEntry() {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  // Master datasets
  const [particularsMaster, setParticularsMaster] = useState([]);
  const [unapprovedMembers, setUnapprovedMembers] = useState([]);
  const [unapprovedRenewals, setUnapprovedRenewals] = useState([]);
  const [approvedMembers, setApprovedMembers] = useState([]);
  const [membershipTypes, setMembershipTypes] = useState([]);
  const [existingReceipts, setExistingReceipts] = useState([]);
  const [paymentModeConfigs, setPaymentModeConfigs] = useState([]);

  // Active Particulars loaded dynamically from Particulars Master
  const activeParticulars = useMemo(() => {
    return particularsMaster.filter((p) => (p.status || 'Active') === 'Active');
  }, [particularsMaster]);

  // Search filter for Unapproved Renewal Payment List
  const [renewalSearchQuery, setRenewalSearchQuery] = useState('');

  // Active online bank account options fetched dynamically from Masters -> Payment Mode Setup
  const activeOnlineBanks = useMemo(() => {
    const configs = paymentModeConfigs;
    const online = configs.filter(
      (c) =>
        (c.paymentType === 'Online' ||
          c.paymentMode === 'Online' ||
          (c.bankAccount &&
            c.bankAccount !== 'Not Applicable' &&
            c.bankAccount !== 'NA' &&
            c.bankAccount !== '—')) &&
        (c.status || 'Active') === 'Active'
    );
    return online;
  }, [paymentModeConfigs]);

  // Selected Member / Renewal State
  const [selectedMember, setSelectedMember] = useState(location.state?.selectedMember || null);
  const [isMemberPickerOpen, setIsMemberPickerOpen] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');

  // View Renewal Details Modal State
  const [viewingRenewal, setViewingRenewal] = useState(null);

  // Preview Label Modal State
  const [isPreviewLabelOpen, setIsPreviewLabelOpen] = useState(false);

  // Form State
  const today = new Date().toISOString().split('T')[0];

  const defaultParticularName = useMemo(() => {
    const mem = activeParticulars.find((p) => p.name === 'Membership');
    if (mem) return 'Membership';
    return activeParticulars[0]?.name || 'Membership';
  }, [activeParticulars]);

  const [formData, setFormData] = useState({
    receiptNumber: '', // Strictly MANUAL entry
    receiptDate: today,
    name: '',
    panNo: '',
    membershipNo: '',
    mobile: '',
    membershipType: '',
    membershipTypeId: '',
    particulars: 'Membership',
    donationSubType: '',
    othersDescription: '',
    amount: '', // Strictly EMPTY on initial/assign per requirements
    paymentMode: 'Cash', // 'Cash' | 'Online'
    bankAccount: '',
    transactionId: '',
    transactionDate: '',
    paymentReceivedDetails: '',
    description: ''
  });

  const [formErrors, setFormErrors] = useState({});
  const [successModal, setSuccessModal] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // Determine current selected particular object & active sub-types dynamically
  const currentParticularObj = useMemo(() => {
    return particularsMaster.find(
      (p) => (p.name || '').toLowerCase().trim() === (formData.particulars || '').toLowerCase().trim()
    );
  }, [particularsMaster, formData.particulars]);

  const activeSubTypes = useMemo(() => {
    if (!currentParticularObj || !currentParticularObj.subTypes) return [];
    return currentParticularObj.subTypes.filter((st) => (st.status || 'Active') === 'Active');
  }, [currentParticularObj]);

  const hasActiveSubTypes = activeSubTypes.length > 0;

  const showToast = (message, type = 'success') => {
    setToastMessage({ message, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // ----------------------------------------------------
  // HELPER: Resolve Membership Type Active Price
  // ----------------------------------------------------
  const resolveMembershipFee = (typeNameOrId) => {
    if (typeNameOrId === undefined || typeNameOrId === null || typeNameOrId === '') return 0;
    const clean = String(typeNameOrId).toLowerCase().trim();
    const found = membershipTypes.find(
      (mt) => String(mt.id) === clean || String(mt.name || '').toLowerCase() === clean
    );
    return found ? Number(found.currentPrice) || 0 : 0;
  };

  // ----------------------------------------------------
  // ENRICHED SELECTED MEMBER DETAILS FOR RIGHT PANEL
  // ----------------------------------------------------
  const enrichedMember = useMemo(() => {
    if (!selectedMember) return null;
    const allMembers = approvedMembers;
    const unapproved = unapprovedMembers;
    const renewals = unapprovedRenewals;

    const memNum = selectedMember.membershipNumber;
    const regNum = selectedMember.registrationNumber || selectedMember.id;
    const mob = selectedMember.contactNumber || selectedMember.mobile || selectedMember.mobileNumber || selectedMember.phone;
    const nm = selectedMember.name || selectedMember.fullName;

    const foundApproved = allMembers.find(
      (m) =>
        (memNum && String(m.membershipNumber) === String(memNum)) ||
        (regNum && (String(m.registrationNumber) === String(regNum) || String(m.id) === String(regNum))) ||
        (mob && (m.mobile === mob || m.phone === mob || m.mobileNumber === mob)) ||
        (nm && (m.fullName === nm || m.name === nm))
    );

    const foundUnapproved = unapproved.find(
      (m) =>
        (regNum && String(m.id) === String(regNum)) ||
        (mob && (m.mobile === mob || m.mobileNumber === mob)) ||
        (nm && (m.fullName === nm || m.name === nm))
    );

    const foundRenewal = renewals.find(
      (r) =>
        (regNum && String(r.registrationNumber) === String(regNum)) ||
        (memNum && String(r.membershipNumber) === String(memNum)) ||
        (r.id && r.id === selectedMember.id)
    );

    const base = {
      ...(foundRenewal || {}),
      ...(foundUnapproved || {}),
      ...(foundApproved || {}),
      ...selectedMember
    };

    const name = selectedMember.fullName || selectedMember.name || foundApproved?.fullName || foundApproved?.name || foundUnapproved?.fullName || foundRenewal?.name || '—';
    const membershipNumber = selectedMember.membershipNumber || foundApproved?.membershipNumber || foundRenewal?.membershipNumber || '—';
    const mobile = selectedMember.contactNumber || selectedMember.mobile || selectedMember.mobileNumber || foundApproved?.mobile || foundApproved?.phone || foundUnapproved?.mobile || '—';
    const email = selectedMember.email || foundApproved?.email || foundUnapproved?.email || '—';
    const altPhone = selectedMember.phone || selectedMember.altPhone || foundApproved?.phone || '—';
    const status = selectedMember.status || foundApproved?.status || (selectedMember.registrationNumber ? 'Renewal Pending' : 'Unapproved');
    const gotra = selectedMember.gothra || selectedMember.gotra || foundApproved?.gothra || foundApproved?.gotra || '—';
    const bloodGroup = selectedMember.bloodGroup || foundApproved?.bloodGroup || '—';

    const address = selectedMember.address || selectedMember.addressLine || foundApproved?.addressLine || foundApproved?.address || foundUnapproved?.address || '—';
    const postTaluk = [
      selectedMember.post || foundApproved?.post,
      selectedMember.talukName || selectedMember.taluk || foundApproved?.talukName || foundApproved?.place
    ].filter(Boolean).join(' / ') || '—';

    const districtState = [
      selectedMember.districtName || foundApproved?.districtName,
      selectedMember.stateName || foundApproved?.stateName
    ].filter(Boolean).join(', ');

    const pinCode = selectedMember.postalCode || selectedMember.pinCode || selectedMember.pincode || foundApproved?.postalCode || foundUnapproved?.pin || '—';
    const labelPoint = selectedMember.labelPoint || foundApproved?.labelPoint || '—';

    const category = selectedMember.category || foundApproved?.category || 'General';
    const profession = selectedMember.profession || foundApproved?.profession || '—';
    const nativeDetails = selectedMember.nativeDetails || foundApproved?.nativeDetails || '—';
    const magazineRemarks = selectedMember.magazineRemarks || selectedMember.remarks || foundApproved?.magazineRemarks || foundApproved?.remarks || '—';

    return {
      ...base,
      name,
      membershipNumber,
      mobile,
      email,
      altPhone,
      status,
      gotra,
      bloodGroup,
      address,
      postTaluk,
      districtState,
      pinCode,
      labelPoint,
      category,
      profession,
      nativeDetails,
      magazineRemarks
    };
  }, [selectedMember, approvedMembers, unapprovedMembers, unapprovedRenewals]);

  // ----------------------------------------------------
  // POPULATE FORM FROM SELECTED MEMBER
  // ----------------------------------------------------
  const applyMemberToForm = (member) => {
    setSelectedMember(member);
    const memType = member.membershipType || '';
    const defaultOnlineBank = activeOnlineBanks[0]?.bankAccount || '';

    setFormData((prev) => ({
      ...prev,
      receiptNumber: '', // Strictly MANUAL and EMPTY
      receiptDate: prev.receiptDate || today,
      name: member.fullName || member.name || '',
      panNo: member.panNo || member.pan || '',
      membershipNo: member.membershipNumber || member.registrationNumber || '',
      mobile: member.mobile || member.mobileNumber || member.contactNumber || member.phone || '',
      membershipType: memType,
      membershipTypeId: member.membershipTypeId || '',
      particulars: 'Membership',
      donationSubType: '',
      othersDescription: '',
      amount: '', // Strictly EMPTY / ready for new payment
      paymentMode: member.transactionReference ? 'Online' : (prev.paymentMode || 'Cash'),
      bankAccount: prev.bankAccount || defaultOnlineBank,
      transactionId: member.transactionReference || member.transactionId || '',
      transactionDate: member.transactionDate || prev.transactionDate || '',
      paymentReceivedDetails: prev.paymentReceivedDetails || '',
      description: `Membership registration receipt for ${member.fullName || member.name}`
    }));

    setFormErrors({});
  };

  // ----------------------------------------------------
  // ASSIGN RENEWAL TO RECEIPT FORM
  // ----------------------------------------------------
  const handleAssignRenewalToReceipt = (renewal) => {
    setSelectedMember(renewal);
    const memType = renewal.membershipType || 'Poshaka';
    const defaultOnlineBank = activeOnlineBanks[0]?.bankAccount || '';

    setFormData((prev) => ({
      ...prev,
      receiptNumber: '', // Strictly EMPTY and manual entry required
      receiptDate: prev.receiptDate || today,
      name: renewal.name || renewal.fullName || '',
      panNo: renewal.panNo || renewal.pan || '',
      membershipNo: renewal.membershipNumber || renewal.registrationNumber || '',
      mobile: renewal.contactNumber || renewal.mobile || '',
      membershipType: memType,
      membershipTypeId: renewal.membershipTypeId || '',
      particulars: 'Membership',
      donationSubType: '',
      othersDescription: '',
      amount: '', // Strictly EMPTY for operator to enter new payment amount
      paymentMode: prev.paymentMode || 'Cash',
      bankAccount: prev.bankAccount || defaultOnlineBank,
      transactionId: '',
      transactionDate: prev.transactionDate || '',
      paymentReceivedDetails: `Renewal payment for Reg #${renewal.registrationNumber} (Mem: ${renewal.membershipNumber})`,
      description: `Membership renewal receipt for ${renewal.name || renewal.fullName}`
    }));

    setFormErrors({});
    showToast(`Assigned ${renewal.name} (Reg #${renewal.registrationNumber}) to Receipt Entry.`);
  };

  // Sync on initial mount or when navigation state arrives
  useEffect(() => {
    const fail = (what) => (error) => {
      console.error(`Failed to load ${what}.`, error);
      showToast(error.response?.data?.detail || `Failed to load ${what} from the server.`, 'error');
    };
    loadParticulars().then(setParticularsMaster).catch(fail('particulars'));
    loadMembershipTypes().then(setMembershipTypes).catch(fail('membership types'));
    loadMembers().then(setApprovedMembers).catch(fail('members'));
    loadMembers({ approval_status: 'UNAPPROVED' }).then(setUnapprovedMembers).catch(fail('unapproved members'));
    loadRenewals().then(setUnapprovedRenewals).catch(fail('renewals'));
    loadReceipts().then(setExistingReceipts).catch(fail('receipts'));
    loadPaymentModeConfigs()
      .then((all) => setPaymentModeConfigs(all.filter((c) => c.status === 'Active')))
      .catch(fail('payment modes'));

    if (location.state?.selectedMember) {
      applyMemberToForm(location.state.selectedMember);
    }
  }, [location.state]);

  // Update Particulars Change
  const handleParticularsChange = (e) => {
    const selectedParticular = e.target.value;

    setFormData((prev) => ({
      ...prev,
      particulars: selectedParticular,
      donationSubType: '',
      othersDescription: selectedParticular === 'Others' ? prev.othersDescription : ''
    }));

    if (formErrors.particulars || formErrors.othersDescription || formErrors.donationSubType) {
      setFormErrors((prev) => ({ ...prev, particulars: '', othersDescription: '', donationSubType: '' }));
    }
  };

  // Payment Mode Change (Cash / Online)
  const handlePaymentModeChange = (e) => {
    const selectedMode = e.target.value;
    const defaultOnlineBank = activeOnlineBanks[0]?.bankAccount || '';

    setFormData((prev) => ({
      ...prev,
      paymentMode: selectedMode,
      bankAccount: selectedMode === 'Online' ? (prev.bankAccount || defaultOnlineBank) : '',
      transactionId: selectedMode === 'Cash' ? '' : prev.transactionId
    }));

    if (formErrors.paymentMode || formErrors.transactionId || formErrors.bankAccount) {
      setFormErrors((prev) => ({
        ...prev,
        paymentMode: '',
        transactionId: '',
        bankAccount: ''
      }));
    }
  };

  // Handle Generic Form Inputs
  const handleInputChange = (e) => {
    const { name, value } = e.target;

    if (name === 'amount') {
      const cleaned = value.replace(/\D/g, '');
      setFormData((prev) => ({ ...prev, amount: cleaned }));
    } else if (name === 'panNo') {
      setFormData((prev) => ({ ...prev, panNo: value.toUpperCase() }));
    } else if (name === 'mobile') {
      const cleaned = value.replace(/\D/g, '').slice(0, 10);
      setFormData((prev) => ({ ...prev, mobile: cleaned }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }

    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  // ----------------------------------------------------
  // FORM VALIDATION
  // ----------------------------------------------------
  const validateForm = () => {
    const errors = {};

    // 1. Receipt No. (Mandatory & Unique Manual Entry)
    if (!formData.receiptNumber.trim()) {
      errors.receiptNumber = 'Receipt No. is mandatory.';
    } else {
      const isDuplicate = existingReceipts.some(
        (r) => r.receiptNumber.toLowerCase().trim() === formData.receiptNumber.toLowerCase().trim()
      );
      if (isDuplicate) {
        errors.receiptNumber = 'This Receipt Number already exists. Please enter a unique Receipt No.';
      }
    }

    // 2. Receipt Date (Mandatory)
    if (!formData.receiptDate) {
      errors.receiptDate = 'Receipt Date is mandatory.';
    }

    // 3. Name (Mandatory)
    if (!formData.name.trim()) {
      errors.name = 'Applicant / Payee Name is mandatory.';
    }

    // 4. Particulars (Mandatory)
    if (!formData.particulars) {
      errors.particulars = 'Particulars selection is mandatory.';
    }

    // 5. If Donation: Donation Sub-Type is mandatory if active sub-types exist
    if (formData.particulars === 'Donation' && hasActiveSubTypes && !formData.donationSubType) {
      errors.donationSubType = 'Please select a Donation Sub-Type.';
    }

    // 6. If Others: Description is mandatory
    if (formData.particulars === 'Others' && !formData.othersDescription.trim()) {
      errors.othersDescription = 'Please specify the description for Others.';
    }

    // 7. Amount (Mandatory, positive integer)
    if (!formData.amount || Number(formData.amount) <= 0) {
      errors.amount = 'Please enter a valid amount greater than 0.';
    }

    // 8. Payment Mode
    if (!formData.paymentMode) {
      errors.paymentMode = 'Payment Mode is mandatory.';
    }

    // 9. If Online: Bank Account and Transaction ID
    if (formData.paymentMode === 'Online') {
      if (!formData.bankAccount) {
        errors.bankAccount = 'Please select a Bank Account.';
      }
      if (!formData.transactionId.trim()) {
        errors.transactionId = 'Transaction ID is mandatory for Online payments.';
      }
    }

    // 10. Mobile (If entered, validate 10 digits)
    if (formData.mobile && formData.mobile.length !== 10) {
      errors.mobile = 'Mobile number must be exactly 10 digits.';
    }

    // 11. PAN (If entered, validate standard format)
    if (formData.panNo && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(formData.panNo)) {
      errors.panNo = 'Enter a valid 10-character PAN (e.g. ABCDE1234F).';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ----------------------------------------------------
  // SUBMIT & SAVE RECEIPT
  // ----------------------------------------------------
  const handleSaveReceipt = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      showToast('Please correct the validation errors before saving.', 'error');
      return;
    }

    const payload = {
      receiptNumber: formData.receiptNumber.trim(),
      receiptDate: formData.receiptDate,
      name: formData.name.trim(),
      panNo: formData.panNo.trim(),
      membershipNo: formData.membershipNo.trim(),
      mobile: formData.mobile.trim(),
      particulars: formData.particulars,
      donationSubType: formData.particulars === 'Donation' ? formData.donationSubType : '',
      othersDescription: formData.particulars === 'Others' ? formData.othersDescription.trim() : '',
      amount: Number(formData.amount),
      paymentMode: formData.paymentMode,
      bankAccount: formData.paymentMode === 'Online' ? formData.bankAccount : '',
      transactionId: formData.paymentMode === 'Online' ? formData.transactionId.trim() : '',
      transactionDate: formData.transactionDate || '',
      paymentReceivedDetails: formData.paymentReceivedDetails.trim(),
      description: formData.description.trim(),
      memberId: selectedMember ? selectedMember.id : null
    };

    try {
      const { data } = await api.post('/receipts/', receiptToApiPayload(payload, selectedMember));
      const saved = normalizeReceipt(data);
      setExistingReceipts((prev) => [saved, ...prev]);
      setSuccessModal(saved);
    } catch (error) {
      console.error('Failed to save receipt.', error);
      showToast(error.response?.data?.detail || 'Failed to save receipt through API.', 'error');
    }
  };

  // Reset Form
  const handleClearForm = () => {
    setSelectedMember(null);
    const initialPart = activeParticulars.some((p) => p.name === 'Membership') ? 'Membership' : (activeParticulars[0]?.name || 'Membership');
    setFormData({
      receiptNumber: '',
      receiptDate: today,
      name: '',
      panNo: '',
      membershipNo: '',
      mobile: '',
      membershipType: '',
      membershipTypeId: '',
      particulars: initialPart,
      donationSubType: '',
      othersDescription: '',
      amount: '',
      paymentMode: 'Cash',
      bankAccount: '',
      transactionId: '',
      transactionDate: '',
      paymentReceivedDetails: '',
      description: ''
    });
    setFormErrors({});
  };

  // Filter unapproved members for picker modal
  const filteredUnapprovedMembers = useMemo(() => {
    if (!memberSearchQuery.trim()) return unapprovedMembers;
    const q = memberSearchQuery.toLowerCase().trim();
    return unapprovedMembers.filter(
      (m) =>
        (m.fullName || m.name || '').toLowerCase().includes(q) ||
        (m.mobile || m.mobileNumber || '').includes(q) ||
        (m.id || '').toLowerCase().includes(q) ||
        (m.membershipType || '').toLowerCase().includes(q)
    );
  }, [unapprovedMembers, memberSearchQuery]);

  // Filter renewals for Unapproved Renewal Payment List
  const filteredRenewals = useMemo(() => {
    if (!renewalSearchQuery.trim()) return unapprovedRenewals;
    const q = renewalSearchQuery.toLowerCase().trim();
    return unapprovedRenewals.filter(
      (r) =>
        (r.registrationNumber || '').toLowerCase().includes(q) ||
        (r.name || r.fullName || '').toLowerCase().includes(q) ||
        (r.membershipNumber || '').toLowerCase().includes(q) ||
        (r.membershipName || '').toLowerCase().includes(q) ||
        (r.contactNumber || r.mobile || '').includes(q)
    );
  }, [unapprovedRenewals, renewalSearchQuery]);

  return (
    <PermissionGate required="receipts.read">
    <div className="space-y-6 pb-16 font-sans">

      {/* Toast Notification Alert */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl px-5 py-3.5 shadow-2xl border transition-all animate-in slide-in-from-bottom-4 duration-200 ${toastMessage.type === 'error'
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
            className="ml-2 rounded-lg p-1 hover:bg-white/10 text-stone-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Success Modal */}
      <Modal isOpen={Boolean(successModal)} onClose={() => setSuccessModal(null)}>
        {successModal && (
          <div
            className="bg-white rounded-3xl max-w-md w-full border border-[#E8DFD8] shadow-2xl p-6 sm:p-8 text-center animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-16 h-16 rounded-full bg-emerald-50 text-[#3D705C] flex items-center justify-center mx-auto mb-4 border border-emerald-200 shadow-sm">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <h3 className="text-xl font-bold text-[#180200]">
              Receipt Saved Successfully
            </h3>

            <p className="text-xs sm:text-sm text-[#863221] mt-2 leading-relaxed">
              Official payment receipt has been issued and stored.
            </p>

            {/* Receipt Summary Snippet */}
            <div className="my-5 p-4 rounded-2xl bg-[#FAF7F2] border border-[#E8DFD8] text-left space-y-2 text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-[#E8DFD8]">
                <span className="text-[#863221] font-semibold">Receipt No:</span>
                <span className="font-mono font-bold text-[#510601] text-sm">
                  {successModal.receiptNumber}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#863221]">Applicant:</span>
                <span className="font-bold text-[#180200]">{successModal.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#863221]">Particulars:</span>
                <span className="font-semibold text-[#510601]">
                  {successModal.particulars}
                  {successModal.donationSubType ? ` — ${successModal.donationSubType}` : ''}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#863221]">Amount Paid:</span>
                <span className="font-mono font-bold text-[#3D705C] text-sm">
                  ₹{Number(successModal.amount).toLocaleString('en-IN')}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#863221]">Payment Mode:</span>
                <span className="font-semibold text-[#180200]">{successModal.paymentMode}</span>
              </div>
              {successModal.memberId && successModal.particulars === 'Membership' && (
                <div className="pt-2 border-t border-[#E8DFD8] text-[11px] text-emerald-700 font-medium">
                  ✓ Member status updated to <strong>Receipt Status: Assigned</strong> in records.
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setSuccessModal(null);
                  handleClearForm();
                }}
                className="w-full py-2.5 px-4 bg-white hover:bg-[#FAF7F2] text-[#510601] border border-[#E8DFD8] hover:border-[#510601] text-xs font-bold rounded-xl transition-all cursor-pointer"
              >
                New Receipt
              </button>

              <button
                type="button"
                onClick={() => {
                  setSuccessModal(null);
                  navigate('/dashboard/receipts/tracking');
                }}
                className="w-full py-2.5 px-4 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer"
              >
                Receipt Tracking
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Member Picker Modal (When selecting applicant from Unapproved Membership) */}
      <Modal isOpen={isMemberPickerOpen} onClose={() => setIsMemberPickerOpen(false)}>
        <div
          className="bg-white rounded-3xl max-w-2xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between border-b border-[#E8DFD8] bg-[#FAF7F2] px-6 py-4 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-[#180200]">
                  Select Unapproved Member
                </h3>
                <p className="text-xs text-[#863221]">
                  Choose an online applicant to assign receipt details.
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsMemberPickerOpen(false)}
              className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Search bar */}
          <div className="p-4 border-b border-[#E8DFD8] bg-white">
            <input
              type="text"
              value={memberSearchQuery}
              onChange={(e) => setMemberSearchQuery(e.target.value)}
              placeholder="Search by Name, Mobile, or ID..."
              className="w-full px-4 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601]"
            />
          </div>

          {/* Member List */}
          <div className="p-4 overflow-y-auto space-y-2 divide-y divide-[#E8DFD8]/60">
            {filteredUnapprovedMembers.length === 0 ? (
              <div className="py-8 text-center text-[#863221] text-xs">
                No matching unapproved members found.
              </div>
            ) : (
              filteredUnapprovedMembers.map((m) => {
                const isAssigned = m.receiptStatus === 'Assigned';
                const fee = resolveMembershipFee(m.membershipType);

                return (
                  <div
                    key={m.id}
                    className="pt-2 first:pt-0 flex items-center justify-between gap-4 p-3 rounded-xl hover:bg-[#FAF7F2] transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#180200]">{m.fullName || m.name}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#510601]/10 text-[#510601] border border-[#510601]/20">
                          {m.membershipType || 'Poshaka'}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isAssigned ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
                          }`}>
                          {m.receiptStatus || 'Pending'}
                        </span>
                      </div>
                      <div className="text-xs text-[#863221] mt-1 flex items-center gap-3">
                        <span>ID: <strong className="font-mono text-[#180200]">{m.id}</strong></span>
                        <span>•</span>
                        <span>Mobile: <strong className="font-mono text-[#180200]">{m.mobile || m.mobileNumber}</strong></span>
                        <span>•</span>
                        <span>Fee: <strong className="font-mono text-[#3D705C]">₹{fee.toLocaleString('en-IN')}</strong></span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        applyMemberToForm(m);
                        setIsMemberPickerOpen(false);
                      }}
                      className="px-3.5 py-1.5 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer shrink-0"
                    >
                      Assign
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Modal>

      {/* View Renewal Profile Modal */}
      <Modal isOpen={Boolean(viewingRenewal)} onClose={() => setViewingRenewal(null)}>
        {viewingRenewal && (
          <div
            className="bg-white rounded-3xl max-w-lg w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#E8DFD8] bg-[#FAF7F2] px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#180200]">
                    Renewal Applicant Details
                  </h3>
                  <p className="text-xs text-[#863221]">
                    Registration No: {viewingRenewal.registrationNumber}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setViewingRenewal(null)}
                className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4 pb-4 border-b border-[#E8DFD8]/60">
                <div>
                  <span className="text-xs text-[#863221] block">Registration Number</span>
                  <strong className="font-mono text-[#510601]">{viewingRenewal.registrationNumber}</strong>
                </div>
                <div>
                  <span className="text-xs text-[#863221] block">Gender</span>
                  <strong className="text-[#180200]">{viewingRenewal.gender || '—'}</strong>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pb-4 border-b border-[#E8DFD8]/60">
                <div>
                  <span className="text-xs text-[#863221] block">Name</span>
                  <strong className="text-[#180200]">{viewingRenewal.name}</strong>
                </div>
                <div>
                  <span className="text-xs text-[#863221] block">Contact Number</span>
                  <strong className="font-mono text-[#180200]">{viewingRenewal.contactNumber}</strong>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xs text-[#863221] block">Membership Number</span>
                  <strong className="font-mono text-[#180200]">{viewingRenewal.membershipNumber}</strong>
                </div>
                <div>
                  <span className="text-xs text-[#863221] block">Membership Name</span>
                  <strong className="text-[#180200]">{viewingRenewal.membershipName}</strong>
                </div>
              </div>

              {viewingRenewal.membershipType && (
                <div className="p-3 bg-[#FAF7F2] rounded-xl border border-[#E8DFD8] flex items-center justify-between text-xs mt-2">
                  <span className="text-[#863221]">Membership Type:</span>
                  <span className="font-bold text-[#510601]">{viewingRenewal.membershipType}</span>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-[#E8DFD8] bg-[#FAF7F2]/50 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setViewingRenewal(null)}
                className="px-4 py-2 bg-white border border-[#E8DFD8] hover:border-[#863221] text-xs font-semibold text-[#863221] rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  handleAssignRenewalToReceipt(viewingRenewal);
                  setViewingRenewal(null);
                }}
                className="px-4 py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer inline-flex items-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Assign to Receipt</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Preview Label Modal */}
      <Modal isOpen={isPreviewLabelOpen} onClose={() => setIsPreviewLabelOpen(false)}>
        {enrichedMember && (
          <div
            className="bg-white rounded-3xl max-w-md w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#E8DFD8] bg-[#FAF7F2] px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#180200]">
                    Label Preview
                  </h3>
                  <p className="text-xs text-[#863221]">
                    Address Postal Slip Format
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsPreviewLabelOpen(false)}
                className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6">
              <div className="bg-[#FAF7F2] border-2 border-dashed border-[#E8DFD8] rounded-2xl p-5 text-sm space-y-1.5 text-[#180200] font-sans">
                <div className="flex items-center justify-between border-b border-[#E8DFD8]/80 pb-2 mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#510601]">HMS MMA Dispatch</span>
                  <span className="font-mono text-xs font-bold text-[#510601]">#{enrichedMember.membershipNumber}</span>
                </div>
                <div className="font-bold text-base text-[#180200]">{enrichedMember.name}</div>
                <div className="text-xs text-[#180200] leading-relaxed">{enrichedMember.address}</div>
                <div className="text-xs text-[#863221] font-medium">Post / Taluk: {enrichedMember.postTaluk}</div>
                <div className="text-xs text-[#863221] font-medium">{enrichedMember.districtState} - <span className="font-mono font-bold text-[#180200]">{enrichedMember.pinCode}</span></div>
                <div className="pt-2 text-xs flex items-center justify-between text-[#863221] border-t border-[#E8DFD8]/60 mt-2">
                  <span>Ph: <strong className="font-mono text-[#180200]">{enrichedMember.mobile}</strong></span>
                  {enrichedMember.labelPoint !== '—' && (
                    <span className="px-2 py-0.5 rounded bg-white border border-[#E8DFD8] text-[10px] font-bold text-[#510601]">
                      LP: {enrichedMember.labelPoint}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-[#E8DFD8] bg-[#FAF7F2]/50 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setIsPreviewLabelOpen(false)}
                className="px-4 py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Breadcrumb Navigation */}
      <div>
{/* Page Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#180200] tracking-tight">
              Receipt Entry
            </h1>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* TOP SECTION: RECEIPT ENTRY FORM + SELECTED MEMBER DETAILS   */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start w-full">

        {/* ------------------------------------------------------------ */}
        {/* LEFT SIDE: RECEIPT ENTRY FORM                                */}
        {/* ------------------------------------------------------------ */}
        <div className="w-full">
          <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_16px_-4px_rgba(24,2,0,0.06)] p-6 sm:p-7">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#E8DFD8]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#510601]/10 text-[#510601] flex items-center justify-center font-bold">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[#180200]">Receipt Entry</h2>
                  <p className="text-[11px] text-[#863221]">Enter payment details and manual receipt number</p>
                </div>
              </div>
              {selectedMember && (
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#510601]/10 text-[#510601] border border-[#510601]/20">
                  Member Active
                </span>
              )}
            </div>

            <form onSubmit={handleSaveReceipt} className="space-y-4">

              {/* Two-Column Grid Layout */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4">

                {/* 1. Receipt No. * (Left Column) */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] mb-1.5">
                    Receipt No. <span className="text-[#ED4636]">*</span>
                  </label>
                  <input
                    type="text"
                    name="receiptNumber"
                    value={formData.receiptNumber}
                    onChange={handleInputChange}
                    placeholder="Enter Receipt No."
                    className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-mono font-bold text-[#180200] placeholder-[#863221]/30 focus:outline-none transition-colors ${formErrors.receiptNumber
                      ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                      : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                      }`}
                  />
                  {formErrors.receiptNumber && (
                    <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {formErrors.receiptNumber}
                    </p>
                  )}
                </div>

                {/* 2. Receipt Date * (Right Column) */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] mb-1.5">
                    Receipt Date <span className="text-[#ED4636]">*</span>
                  </label>
                  <input
                    type="date"
                    name="receiptDate"
                    value={formData.receiptDate}
                    onChange={handleInputChange}
                    className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm text-[#180200] focus:outline-none transition-colors ${formErrors.receiptDate
                      ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                      : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                      }`}
                  />
                  {formErrors.receiptDate && (
                    <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {formErrors.receiptDate}
                    </p>
                  )}
                </div>

                {/* 3. Name * (Left Column) */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] mb-1.5">
                    Name <span className="text-[#ED4636]">*</span>
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="Applicant / Payee Name"
                    className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-semibold text-[#180200] placeholder-[#863221]/30 focus:outline-none transition-colors ${formErrors.name
                      ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                      : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                      }`}
                  />
                  {formErrors.name && (
                    <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {formErrors.name}
                    </p>
                  )}
                </div>

                {/* 4. PAN (Right Column) */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] mb-1.5">
                    PAN
                  </label>
                  <input
                    type="text"
                    name="panNo"
                    value={formData.panNo}
                    onChange={handleInputChange}
                    maxLength={10}
                    placeholder="e.g. ABCDE1234F"
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm font-mono font-bold text-[#180200] placeholder-[#863221]/30 focus:outline-none transition-colors"
                  />
                </div>

                {/* 5. Membership No (Left Column) */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] mb-1.5">
                    Membership No
                  </label>
                  <input
                    type="text"
                    name="membershipNo"
                    value={formData.membershipNo}
                    onChange={handleInputChange}
                    placeholder="e.g. MEM-2026-001"
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm font-mono text-[#180200] placeholder-[#863221]/30 focus:outline-none transition-colors"
                  />
                </div>

                {/* 6. Mobile (Right Column) */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] mb-1.5">
                    Mobile
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#863221]/70">
                      +91
                    </span>
                    <input
                      type="tel"
                      name="mobile"
                      value={formData.mobile}
                      onChange={handleInputChange}
                      maxLength={10}
                      placeholder="10-digit mobile number"
                      className="w-full pl-12 pr-4 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm font-mono text-[#180200] placeholder-[#863221]/30 focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                {/* 7. Particulars (Left Column) - Dynamically loaded from Particulars Master */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] mb-1.5">
                    Particulars <span className="text-[#ED4636]">*</span>
                  </label>
                  <select
                    name="particulars"
                    value={formData.particulars}
                    onChange={handleParticularsChange}
                    className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-semibold text-[#180200] focus:outline-none cursor-pointer transition-colors ${formErrors.particulars
                      ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30'
                      : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                      }`}
                  >
                    {activeParticulars.map((opt) => (
                      <option key={opt.id || opt.name} value={opt.name}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                  {formErrors.particulars && (
                    <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {formErrors.particulars}
                    </p>
                  )}
                </div>

                {/* 8. Sub-Type (Right Column) */}
                {hasActiveSubTypes ? (
                  <div>
                    <label className="block text-xs font-bold text-[#180200] mb-1.5">
                      {formData.particulars === 'Donation' ? 'Donation Sub-Type' : `${formData.particulars} Sub-Type`} <span className="text-[#ED4636]">*</span>
                    </label>
                    <select
                      name="donationSubType"
                      value={formData.donationSubType}
                      onChange={handleInputChange}
                      className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-semibold text-[#180200] focus:outline-none cursor-pointer transition-colors ${formErrors.donationSubType
                        ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30'
                        : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                        }`}
                    >
                      <option value="">{`Select ${formData.particulars === 'Donation' ? 'Donation Sub-Type' : 'Sub-Type'}`}</option>
                      {activeSubTypes.map((st) => (
                        <option key={st.id || st.name} value={st.name}>
                          {st.name}
                        </option>
                      ))}
                    </select>
                    {formErrors.donationSubType && (
                      <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {formErrors.donationSubType}
                      </p>
                    )}
                  </div>
                ) : formData.particulars === 'Others' ? (
                  <div>
                    <label className="block text-xs font-bold text-[#180200] mb-1.5">
                      Others <span className="text-[#ED4636]">*</span>
                    </label>
                    <input
                      type="text"
                      name="othersDescription"
                      value={formData.othersDescription}
                      onChange={handleInputChange}
                      placeholder="Specify details for Others"
                      className={`w-full px-3.5 py-2.5 rounded-xl text-sm text-[#180200] focus:outline-none transition-colors ${formErrors.othersDescription
                        ? 'bg-white border border-[#ED4636] ring-1 ring-[#ED4636]/30'
                        : 'bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                        }`}
                    />
                    {formErrors.othersDescription && (
                      <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {formErrors.othersDescription}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="hidden md:block" />
                )}

                {/* 9. Amount (Left Column) */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] mb-1.5">
                    Amount <span className="text-[#ED4636]">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-[#863221]/70">
                      ₹
                    </span>
                    <input
                      type="text"
                      name="amount"
                      value={formData.amount}
                      onChange={handleInputChange}
                      placeholder="e.g. 500"
                      className={`w-full pl-8 pr-4 py-2.5 border rounded-xl text-sm font-mono font-bold text-[#180200] focus:outline-none transition-colors ${formErrors.amount
                        ? 'bg-red-50/20 border-[#ED4636] ring-1 ring-[#ED4636]/30'
                        : 'bg-white border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                        }`}
                    />
                  </div>
                  {formErrors.amount && (
                    <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {formErrors.amount}
                    </p>
                  )}
                  {formData.amount && Number(formData.amount) > 0 && (
                    <p className="text-[10px] text-[#863221]/80 italic mt-1 truncate" title={numberToWords(formData.amount)}>
                      {numberToWords(formData.amount)}
                    </p>
                  )}
                </div>

                {/* 10. Payment Mode (Right Column) */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] mb-1.5">
                    Payment Mode <span className="text-[#ED4636]">*</span>
                  </label>
                  <select
                    name="paymentMode"
                    value={formData.paymentMode}
                    onChange={handlePaymentModeChange}
                    className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-semibold text-[#180200] focus:outline-none cursor-pointer transition-colors ${formErrors.paymentMode
                      ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30'
                      : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                      }`}
                  >
                    <option value="Cash">Cash</option>
                    <option value="Online">Online</option>
                  </select>
                  {formErrors.paymentMode && (
                    <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {formErrors.paymentMode}
                    </p>
                  )}
                </div>

                {/* If Online: Bank Account Selection */}
                {formData.paymentMode === 'Online' && (
                  <div className="md:col-span-2 p-3 bg-[#FAF7F2] rounded-xl border border-[#E8DFD8] space-y-2">
                    <label className="block text-xs font-bold text-[#180200]">
                      Bank Account <span className="text-[#ED4636]">*</span>
                    </label>
                    <select
                      name="bankAccount"
                      value={formData.bankAccount}
                      onChange={handleInputChange}
                      className={`w-full px-3.5 py-2 bg-white border rounded-xl text-sm font-semibold text-[#180200] focus:outline-none cursor-pointer transition-colors ${formErrors.bankAccount
                        ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30'
                        : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                        }`}
                    >
                      {activeOnlineBanks.map((bank) => {
                        const label = bank.bankAccount || bank.paymentMode;
                        return (
                          <option key={bank.id || label} value={label}>
                            {label} {bank.branch ? `— ${bank.branch}` : ''}
                          </option>
                        );
                      })}
                    </select>
                    {formErrors.bankAccount && (
                      <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {formErrors.bankAccount}
                      </p>
                    )}
                    <p className="text-[10px] text-[#863221]/80">
                      Bank accounts loaded from <strong>Masters → Payment Mode Setup</strong>.
                    </p>
                  </div>
                )}

                {/* 11. Transaction Id (Left Column) */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] mb-1.5">
                    Transaction Id {formData.paymentMode === 'Online' && <span className="text-[#ED4636]">*</span>}
                  </label>
                  <input
                    type="text"
                    name="transactionId"
                    value={formData.transactionId}
                    onChange={handleInputChange}
                    disabled={formData.paymentMode === 'Cash'}
                    placeholder={
                      formData.paymentMode === 'Cash'
                        ? 'Disabled (Not required for Cash)'
                        : 'e.g. UPI-TXN-8849102 or UTR-00124'
                    }
                    className={`w-full px-3.5 py-2.5 rounded-xl text-sm font-mono text-[#180200] focus:outline-none transition-colors ${formData.paymentMode === 'Cash'
                      ? 'bg-[#FAF7F2]/70 text-stone-400 cursor-not-allowed border border-[#E8DFD8]/80'
                      : formErrors.transactionId
                        ? 'bg-white border border-[#ED4636] ring-1 ring-[#ED4636]/30'
                        : 'bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                      }`}
                  />
                  {formErrors.transactionId && (
                    <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {formErrors.transactionId}
                    </p>
                  )}
                </div>

                {/* 12. Transaction Date (Right Column) */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] mb-1.5">
                    Transaction Date
                  </label>
                  <input
                    type="date"
                    name="transactionDate"
                    value={formData.transactionDate}
                    onChange={handleInputChange}
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm text-[#180200] focus:outline-none transition-colors"
                  />
                </div>

                {/* 13. Payment Received Details (Full Width) */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-[#180200] mb-1.5">
                    Payment Received Details
                  </label>
                  <input
                    type="text"
                    name="paymentReceivedDetails"
                    value={formData.paymentReceivedDetails}
                    onChange={handleInputChange}
                    placeholder="Enter payment received details or remarks"
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm text-[#180200] placeholder-[#863221]/30 focus:outline-none transition-colors"
                  />
                </div>

                {/* 14. Description (Full Width Textarea) */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-[#180200] mb-1.5">
                    Description
                  </label>
                  <textarea
                    rows={2}
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    placeholder="Enter description or notes for this receipt..."
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm text-[#180200] placeholder-[#863221]/30 focus:outline-none transition-colors resize-y"
                  />
                </div>

              </div>

              {/* Action Buttons (Clear & Save) */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E8DFD8]">
                <button
                  type="button"
                  onClick={handleClearForm}
                  className="px-5 py-2.5 rounded-xl border border-[#E8DFD8] hover:border-[#863221] bg-white text-[#863221] text-xs sm:text-sm font-semibold hover:bg-[#FAF7F2] transition-colors cursor-pointer inline-flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Clear</span>
                </button>

                <button
                  type="submit"
                  disabled={!hasPermission('receipts.write')}
                  title={!hasPermission('receipts.write') ? 'Requires receipts.write permission' : undefined}
                  className="px-6 py-2.5 rounded-xl bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs sm:text-sm font-bold shadow-sm hover:shadow transition-all cursor-pointer inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Save className="w-4 h-4" />
                  <span>Save</span>
                </button>
              </div>

            </form>
          </div>
        </div>

        {/* ------------------------------------------------------------ */}
        {/* RIGHT SIDE: SELECTED MEMBER DETAILS                          */}
        {/* ------------------------------------------------------------ */}
        <div className="w-full">
          {selectedMember && enrichedMember ? (
            <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_16px_-4px_rgba(24,2,0,0.06)] overflow-hidden animate-in fade-in duration-200">

              {/* Right Panel Header */}
              <div className="bg-[#FAF7F2] border-b border-[#E8DFD8] p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#510601] text-white flex items-center justify-center font-bold text-sm shadow-sm shrink-0">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base font-bold text-[#180200]">
                        {enrichedMember.name}
                      </h2>
                      {enrichedMember.membershipNumber !== '—' && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#510601]/10 text-[#510601] border border-[#510601]/20">
                          #{enrichedMember.membershipNumber}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#863221] mt-0.5">
                      Selected Member Profile Details (Read-only)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsPreviewLabelOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-[#FAF7F2] text-[#510601] border border-[#E8DFD8] hover:border-[#510601] rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
                    title="Preview Label Slip"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Preview Label</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClearForm}
                    className="p-1.5 rounded-lg text-[#863221] hover:text-[#ED4636] hover:bg-red-50 transition-colors"
                    title="Clear Member Selection"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Profile Information List */}
              <div className="p-5 sm:p-6 space-y-5 text-xs sm:text-sm">

                {/* 1. Core Profile Details */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 pb-4 border-b border-[#E8DFD8]">
                  <div>
                    <span className="text-[11px] font-semibold text-[#863221] block">Member Name</span>
                    <span className="font-bold text-[#180200] block truncate">{enrichedMember.name}</span>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold text-[#863221] block">Membership Number</span>
                    <span className="font-mono font-bold text-[#510601] block">{enrichedMember.membershipNumber}</span>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold text-[#863221] block">Status</span>
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 mt-0.5">
                      {enrichedMember.status}
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold text-[#863221] block">Mobile</span>
                    <span className="font-mono font-medium text-[#180200] block">{enrichedMember.mobile}</span>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold text-[#863221] block">Email</span>
                    <span className="text-[#180200] block truncate">{enrichedMember.email}</span>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold text-[#863221] block">Alt Phone</span>
                    <span className="font-mono text-[#180200] block">{enrichedMember.altPhone}</span>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold text-[#863221] block">Gotra</span>
                    <span className="font-medium text-[#180200] block">{enrichedMember.gotra}</span>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold text-[#863221] block">Blood Group</span>
                    <span className="font-bold text-[#510601] block">{enrichedMember.bloodGroup}</span>
                  </div>
                </div>

                {/* 2. ADDRESS & GEOGRAPHICAL HIERARCHY */}
                <div className="space-y-3 pb-4 border-b border-[#E8DFD8]">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#510601] flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#510601]" />
                    <span>Address & Geographical Hierarchy</span>
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#FAF7F2] p-3.5 rounded-xl border border-[#E8DFD8]/80">
                    <div className="sm:col-span-2">
                      <span className="text-[11px] font-semibold text-[#863221] block">Street Address</span>
                      <span className="text-[#180200] font-medium leading-relaxed block">{enrichedMember.address}</span>
                    </div>

                    <div>
                      <span className="text-[11px] font-semibold text-[#863221] block">Post / Taluk</span>
                      <span className="text-[#180200] font-medium block">{enrichedMember.postTaluk}</span>
                    </div>

                    <div>
                      <span className="text-[11px] font-semibold text-[#863221] block">District & State</span>
                      <span className="text-[#180200] font-medium block">{enrichedMember.districtState}</span>
                    </div>

                    <div>
                      <span className="text-[11px] font-semibold text-[#863221] block">PIN Code</span>
                      <span className="font-mono font-bold text-[#180200] block">{enrichedMember.pinCode}</span>
                    </div>

                    <div>
                      <span className="text-[11px] font-semibold text-[#863221] block">Label Point</span>
                      <span className="font-bold text-[#510601] block">{enrichedMember.labelPoint}</span>
                    </div>
                  </div>
                </div>

                {/* 3. OTHER MEMBER DETAILS */}
                <div className="space-y-3">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#510601] flex items-center gap-1.5">
                    <Briefcase className="w-3.5 h-3.5 text-[#510601]" />
                    <span>Other Member Details</span>
                  </h3>

                  <div className="grid grid-cols-2 gap-3.5">
                    <div>
                      <span className="text-[11px] font-semibold text-[#863221] block">Category</span>
                      <span className="font-medium text-[#180200] block">{enrichedMember.category}</span>
                    </div>

                    <div>
                      <span className="text-[11px] font-semibold text-[#863221] block">Profession</span>
                      <span className="font-medium text-[#180200] block">{enrichedMember.profession}</span>
                    </div>

                    <div className="col-span-2">
                      <span className="text-[11px] font-semibold text-[#863221] block">Native Details</span>
                      <span className="text-[#180200] font-medium block">{enrichedMember.nativeDetails}</span>
                    </div>

                    <div className="col-span-2">
                      <span className="text-[11px] font-semibold text-[#863221] block">Magazine Remarks</span>
                      <span className="text-[#180200] font-medium block">{enrichedMember.magazineRemarks}</span>
                    </div>
                  </div>
                </div>

                {/* Verification Notice */}
                <div className="pt-2 border-t border-[#E8DFD8] flex items-center justify-between text-[11px] text-[#863221]">
                  <span>✓ Verification panel — Read-only member details</span>
                  <button
                    type="button"
                    onClick={() => setIsPreviewLabelOpen(true)}
                    className="text-[#510601] hover:underline font-bold"
                  >
                    Preview Label →
                  </button>
                </div>

              </div>

            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_16px_-4px_rgba(24,2,0,0.06)] p-8 sm:p-10 flex flex-col items-center justify-center text-center min-h-[480px]">
              <div className="w-16 h-16 rounded-2xl bg-[#510601]/5 text-[#510601] flex items-center justify-center mb-4 border border-[#510601]/10 shadow-sm">
                <User className="w-8 h-8 opacity-70" />
              </div>
              <h3 className="text-base font-bold text-[#180200]">
                Selected Member Details
              </h3>
              <p className="text-xs text-[#863221] mt-1.5 max-w-sm leading-relaxed">
                Click <strong className="text-[#510601]">Assign to Receipt</strong> in the Unapproved Renewal Payment List below to load the member profile and auto-fill the receipt.
              </p>
              <div className="mt-5 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#FAF7F2] border border-[#E8DFD8] text-[11px] font-semibold text-[#863221]">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                <span>No Member Selected</span>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* ============================================================ */}
      {/* BOTTOM SECTION: UNAPPROVED RENEWAL PAYMENT LIST               */}
      {/* ============================================================ */}
      <div className="w-full pt-2">
        <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_16px_-4px_rgba(24,2,0,0.06)] overflow-hidden">

          {/* Panel Header */}
          <div className="p-4 sm:p-5 border-b border-[#E8DFD8] bg-[#FAF7F2]/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#180200] tracking-tight">
                  Unapproved Renewal Payment List
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#510601]/10 text-[#510601] border border-[#510601]/20">
                  {filteredRenewals.length}
                </span>
              </div>
              <p className="text-xs text-[#863221] mt-0.5">
                Click <strong>Assign to Receipt</strong> to load the member profile and auto-fill the receipt form.
              </p>
            </div>

            {/* Quick Search */}
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-[#863221]/60 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={renewalSearchQuery}
                onChange={(e) => setRenewalSearchQuery(e.target.value)}
                placeholder="Search by Reg, Name, Mobile..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-[#E8DFD8] rounded-xl focus:outline-none focus:border-[#510601] text-[#180200] placeholder-[#863221]/40"
              />
            </div>
          </div>

          {/* Table with EXACT Columns: Registration Number, Name, Gender, Membership Number, Membership Name, Contact Number, Action */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E8DFD8] bg-[#FAF7F2] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-3.5 whitespace-nowrap">Registration Number</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Name</th>
                  <th className="py-3 px-3 whitespace-nowrap">Gender</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Membership Number</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Membership Name</th>
                  <th className="py-3 px-3.5 whitespace-nowrap">Contact Number</th>
                  <th className="py-3 px-3.5 text-right whitespace-nowrap min-w-[220px]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {filteredRenewals.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="py-10 text-center text-[#863221]">
                      <p className="font-semibold text-sm text-[#180200]">No renewal records found</p>
                      <p className="text-xs text-[#863221] mt-1">All unapproved renewal payments have been processed.</p>
                    </td>
                  </tr>
                ) : (
                  filteredRenewals.map((renewal) => {
                    const isCurrentlyActive = selectedMember?.id === renewal.id || selectedMember?.registrationNumber === renewal.registrationNumber;

                    return (
                      <tr
                        key={renewal.id}
                        className={`transition-colors hover:bg-[#FAF7F2]/60 ${
                          isCurrentlyActive ? 'bg-amber-50/50' : ''
                        }`}
                      >
                        {/* 1. Registration Number */}
                        <td className="py-3 px-3.5 font-mono font-bold text-[#510601]">
                          {renewal.registrationNumber}
                        </td>

                        {/* 2. Name */}
                        <td className="py-3 px-3.5 font-bold text-[#180200] whitespace-nowrap">
                          {renewal.name || renewal.fullName}
                        </td>

                        {/* 3. Gender */}
                        <td className="py-3 px-3 text-[#180200]">
                          {renewal.gender || '—'}
                        </td>

                        {/* 4. Membership Number */}
                        <td className="py-3 px-3.5 font-mono font-semibold text-[#180200] whitespace-nowrap">
                          {renewal.membershipNumber}
                        </td>

                        {/* 5. Membership Name */}
                        <td className="py-3 px-3.5 text-[#180200] whitespace-nowrap font-medium">
                          {renewal.membershipName}
                        </td>

                        {/* 6. Contact Number */}
                        <td className="py-3 px-3.5 font-mono text-[#180200] whitespace-nowrap">
                          {renewal.contactNumber || renewal.mobile}
                        </td>

                        {/* 7. Action: [ Assign to Receipt ] [ View ] */}
                        <td className="py-3 px-3.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            {/* Primary Action: Assign to Receipt */}
                            <button
                              type="button"
                              onClick={() => handleAssignRenewalToReceipt(renewal)}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 h-8 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs font-bold rounded-xl shadow-sm hover:shadow transition-all cursor-pointer shrink-0"
                              title="Auto-fill renewal details into Receipt Entry and load Member Profile"
                            >
                              <FileText className="w-3.5 h-3.5 shrink-0" />
                              <span>Assign to Receipt</span>
                            </button>

                            {/* Secondary Action: View */}
                            <button
                              type="button"
                              onClick={() => setViewingRenewal(renewal)}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 h-8 bg-white hover:bg-[#FAF7F2] text-[#510601] hover:text-[#180200] text-xs font-bold rounded-xl border border-[#E8DFD8] hover:border-[#510601] shadow-sm transition-all cursor-pointer shrink-0"
                              title="View renewal application details"
                            >
                              <Eye className="w-3.5 h-3.5 shrink-0 text-[#863221]" />
                              <span>View</span>
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

          {/* Footer Summary */}
          <div className="p-3.5 bg-[#FAF7F2]/40 border-t border-[#E8DFD8] text-[11px] text-[#863221] flex items-center justify-between">
            <span>Showing {filteredRenewals.length} unapproved renewal records</span>
            <span>Click <strong>Assign to Receipt</strong> to load into top section</span>
          </div>

        </div>
      </div>

    </div>
    </PermissionGate>
  );
}
