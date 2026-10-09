import React, { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import {
  ChevronRight,
  ChevronLeft,
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
  Tag,
  Building,
  Heart,
  Briefcase,
  Award,
  Calendar,
  Layers,
  CreditCard,
  Hash
} from 'lucide-react';
import Modal from '../components/Modal';
import PermissionGate from '../components/PermissionGate';
import DateInput from '../components/DateInput';
import useAuth from '../hooks/useAuth';
import api from '../api';
import { notify } from '../utils/notify';
import { apiErrorMessage } from '../utils/apiError';
import { formatDate, formatDateTime, getTodayISODate } from '../utils/dateUtils';
import { receiptToApiPayload } from '../utils/apiAdapters';
import { formatPaymentModeLabel } from '../utils/displayHelpers';
import {
  loadParticulars,
  loadMembershipTypes,
  loadPaymentModeConfigs,
  loadRenewals,
  loadMembers,
  loadReceipts,
  loadLocations,
  findLocationByPin
} from '../utils/serverData';

// ----------------------------------------------------
// Server member -> the shape this screen draws
// ----------------------------------------------------
const titleCase = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1).toLowerCase() : '');

const ageFrom = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) years -= 1;
  return years >= 0 ? String(years) : '';
};

const toEntryMember = (m, loc) => {
  const nameOf = (list, id) => list.find((x) => String(x.id) === String(id))?.name || '';
  const pin = loc.postalCodes.find((p) => String(p.id) === String(m.pincode_id));
  const reg = m.registration_payment || {};
  const fullName = [m.name_title, m.first_name_en, m.middle_name_en, m.last_name_en].filter(Boolean).join(' ');
  const approved = String(m.approval_status).toUpperCase() === 'APPROVED';
  const districtName = nameOf(loc.districts, m.district_id);
  const stateName = nameOf(loc.states, m.state_id);
  const talukName = nameOf(loc.taluks, m.taluk_id);
  const created = m.created_at ? String(m.created_at) : '';
  return {
    id: m.id,
    registrationNumber: `REG-${new Date(created || Date.now()).getFullYear()}-${String(m.id).padStart(4, '0')}`,
    membershipNumber: m.member_code || '',
    fullName,
    name: fullName,
    mobile: m.mobile || '',
    contactNumber: m.mobile || '',
    mobileNumber: m.mobile || '',
    phone: m.alternate_mobile || '',
    email: m.email || '',
    postalCode: pin?.postalCode || '',
    pinCode: pin?.postalCode || '',
    locality: m.locality || m.post || pin?.area || '',
    talukName,
    taluk: talukName,
    districtName,
    district: districtName,
    stateName,
    state: stateName,
    address: m.address_line1 || '',
    addressLine: m.address_line1 || '',
    gothra: m.gotra_text || '',
    gotra: m.gotra_text || '',
    gender: titleCase(m.gender),
    bloodGroup: m.blood_group || '',
    birthDate: m.date_of_birth || '',
    age: ageFrom(m.date_of_birth),
    fatherHusbandName: m.father_husband_name || '',
    aadharNumber: m.aadhaar_number || '',
    qualification: m.qualification_text || '',
    employment: m.occupation || '',
    profession: m.occupation || '',
    nativePlace: m.native_place_text || '',
    membershipTypeCategory: m.membership_type_category || '',
    membershipType: '',
    registrationSource: m.registration_source || '',
    registrationType: m.registration_source || '',
    registrationDate: created,
    createdDate: created,
    // what was typed on the application's payment tab
    paymentMode: reg.payment_mode || '',
    bankAccount: reg.bank_account || '',
    amount: reg.amount ?? '',
    paymentRemarks: reg.remarks || '',
    transactionId: reg.transaction_id || '',
    transactionDate: reg.transaction_date || '',
    approvalStatus: approved ? 'Approved' : 'Unapproved',
    status: approved ? 'Approved' : 'Unapproved',
    photoPath: m.photo_path || '',
    photoUrl: ''
  };
};

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
  const showToast = (message, type = 'success') => {
    notify(message, type);
  };

  // Master datasets, all from the server
  const [particularsMaster, setParticularsMaster] = useState([]);
  const [unapprovedMembers, setUnapprovedMembers] = useState([]);
  const [registeredMembers, setRegisteredMembers] = useState([]);
  const [unapprovedRenewals, setUnapprovedRenewals] = useState([]);
  const [membershipTypes, setMembershipTypes] = useState([]);
  const [existingReceipts, setExistingReceipts] = useState([]);
  const [paymentModeConfigs, setPaymentModeConfigs] = useState([]);
  const [locations, setLocations] = useState({ states: [], districts: [], taluks: [], postalCodes: [] });
  const [saving, setSaving] = useState(false);

  const lookupLocationByPin = (pin) => findLocationByPin(locations.postalCodes, pin);

  // Which members already have a receipt linked (decided by the server's receipt links)
  const assignedMemberIds = useMemo(
    () => new Set(existingReceipts.filter((r) => r.memberId != null).map((r) => String(r.memberId))),
    [existingReceipts]
  );
  const isMemberReceiptAssigned = (m) => Boolean(m) && assignedMemberIds.has(String(m.id));
  const findMatchingReceiptForMember = (m) =>
    m ? existingReceipts.find((r) => String(r.memberId) === String(m.id)) || null : null;

  // Active particulars come from the Particulars master
  const activeParticulars = useMemo(() => {
    return particularsMaster.filter((p) => (p.status || 'Active') === 'Active');
  }, [particularsMaster]);

  // Payment modes: Cash plus the active modes / bank accounts from Masters -> Payment Mode Setup
  const activePaymentModes = useMemo(() => {
    const labels = paymentModeConfigs
      .filter((c) => (c.status || 'Active') === 'Active')
      .map((c) => formatPaymentModeLabel(c))
      .filter(Boolean);
    return ['Cash', ...labels.filter((l) => l.trim().toLowerCase() !== 'cash')]
      .filter((l, i, all) => all.indexOf(l) === i);
  }, [paymentModeConfigs]);

  // Explicit Entry Source State: 'normal' | 'unapproved-assignment' | 'membership-assignment'
  const [entrySource, setEntrySource] = useState(() => {
    if (location.state?.source === 'membership') {
      return 'membership-assignment';
    }
    if (
      location.state?.source === 'unapproved' ||
      location.state?.isAssignmentFlow ||
      location.state?.mode === 'assign' ||
      location.state?.selectedMember
    ) {
      return 'unapproved-assignment';
    }
    return 'normal';
  });

  // Selected Member State & Lookup State
  const [selectedMember, setSelectedMember] = useState(null);
  const [memberProfile, setMemberProfile] = useState(null); // renewal date + payment history of the chosen approved member
  const [lookupMembershipNo, setLookupMembershipNo] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [matchedExistingReceipt, setMatchedExistingReceipt] = useState(null);

  // Search and pagination state for Right-Side Membership List Table
  const [rightSearchQuery, setRightSearchQuery] = useState('');
  const [rightPage, setRightPage] = useState(1);
  const [rightPageSize, setRightPageSize] = useState(10);

  // Search and pagination state for Bottom Unassigned Members Table
  const [unapprovedSearchQuery, setUnapprovedSearchQuery] = useState('');
  const [unapprovedPage, setUnapprovedPage] = useState(1);
  const [unapprovedPageSize, setUnapprovedPageSize] = useState(10);

  // Renewals due (server)
  const [renewalSearchQuery, setRenewalSearchQuery] = useState('');

  // View Member Details Modal State
  const [viewingMember, setViewingMember] = useState(null);

  // Form State
  const emptyForm = {
    receiptNumber: '', // Strictly MANUAL entry
    receiptDate: '', // Strictly MANUAL entry
    name: '',
    panNo: '', // Strictly MANUAL entry
    membershipNo: '',
    mobile: '',
    membershipType: '',
    membershipTypeId: '',
    particulars: '',
    donationSubType: '',
    othersDescription: '',
    amount: '',
    paymentMode: 'Cash',
    bankAccount: '',
    transactionId: '',
    transactionDate: '',
    paymentReceivedDetails: '',
    description: ''
  };
  const [formData, setFormData] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});

  // The default particular is Membership when it exists, otherwise the first active one
  const defaultParticular = useMemo(() => {
    return activeParticulars.some((p) => p.name === 'Membership') ? 'Membership' : activeParticulars[0]?.name || '';
  }, [activeParticulars]);

  useEffect(() => {
    if (!defaultParticular) return;
    if (!activeParticulars.some((p) => p.name === formData.particulars)) {
      setFormData((prev) => ({ ...prev, particulars: defaultParticular }));
    }
  }, [defaultParticular]);

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

  // ----------------------------------------------------
  // LOAD EVERYTHING FROM THE SERVER
  // ----------------------------------------------------
  const reloadData = async () => {
    const fail = (what) => (error) => {
      console.error(`Failed to load ${what}.`, error);
      showToast(apiErrorMessage(error, `Failed to load ${what} from the server.`), 'error');
    };
    const loc = await loadLocations().catch((e) => {
      fail('locations')(e);
      return { states: [], districts: [], taluks: [], postalCodes: [] };
    });
    setLocations(loc);
    await Promise.all([
      loadParticulars().then(setParticularsMaster).catch(fail('particulars')),
      loadMembershipTypes().then(setMembershipTypes).catch(fail('membership types')),
      loadPaymentModeConfigs().then(setPaymentModeConfigs).catch(fail('payment modes')),
      loadReceipts({ limit: 1000 }).then(setExistingReceipts).catch(fail('receipts')),
      loadRenewals().then(setUnapprovedRenewals).catch(fail('renewals')),
      loadMembers({ approval_status: 'UNAPPROVED', limit: 1000 })
        .then((rows) => setUnapprovedMembers(rows.map((m) => toEntryMember(m, loc))))
        .catch(fail('unapproved members')),
      loadMembers({ approval_status: 'APPROVED', limit: 1000 })
        .then((rows) => setRegisteredMembers(rows.map((m) => toEntryMember(m, loc))))
        .catch(fail('members'))
    ]);
  };

  useEffect(() => {
    reloadData();
  }, []);

  // A member handed over from another screen (Unapproved Members / Membership List)
  useEffect(() => {
    const id = location.state?.selectedMember?.id;
    if (!id || locations.districts.length === 0) return;
    api
      .get(`/members/${id}`)
      .then(({ data }) => {
        const mem = toEntryMember(data, locations);
        setEntrySource(location.state?.source === 'membership' ? 'membership-assignment' : 'unapproved-assignment');
        setLookupMembershipNo(mem.registrationNumber || mem.membershipNumber || mem.id || '');
        applyMemberToForm(mem);
      })
      .catch((error) => showToast(apiErrorMessage(error, 'Could not load that member.'), 'error'));
  }, [location.state, locations.districts.length]);

  // Member photos are protected files: fetch them as images when a member is shown
  const loadPhotoFor = (member, apply) => {
    if (!member?.photoPath || member.photoUrl) return;
    api
      .get('/system/files', { params: { path: member.photoPath }, responseType: 'blob' })
      .then((res) => apply(URL.createObjectURL(res.data)))
      .catch(() => {});
  };
  useEffect(() => {
    loadPhotoFor(selectedMember, (url) => setSelectedMember((prev) => (prev && prev.id === selectedMember.id ? { ...prev, photoUrl: url } : prev)));
  }, [selectedMember?.id, selectedMember?.photoPath]);

  // For an approved member, load the renewal date and the last payment from the server
  useEffect(() => {
    setMemberProfile(null);
    if (entrySource !== 'membership-assignment' || !selectedMember?.id) return undefined;
    let cancelled = false;
    api
      .get(`/members/${selectedMember.id}/profile`)
      .then(({ data }) => { if (!cancelled) setMemberProfile(data); })
      .catch((error) => {
        if (!cancelled) showToast(apiErrorMessage(error, 'Could not load the payment history.'), 'error');
      });
    return () => { cancelled = true; };
  }, [entrySource, selectedMember?.id]);
  useEffect(() => {
    loadPhotoFor(viewingMember, (url) => setViewingMember((prev) => (prev && prev.id === viewingMember.id ? { ...prev, photoUrl: url } : prev)));
  }, [viewingMember?.id, viewingMember?.photoPath]);

  // ----------------------------------------------------
  // ENRICHED SELECTED MEMBER DETAILS FOR RIGHT PANEL PROFILE CARD
  // ----------------------------------------------------
  const enrichedMember = useMemo(() => {
    if (!selectedMember) return null;
    const m = selectedMember;
    const dash = (v) => (v === undefined || v === null || v === '' ? '—' : v);
    return {
      ...m,
      name: dash(m.fullName || m.name),
      membershipNumber: dash(m.membershipNumber),
      mobile: dash(m.mobile),
      email: dash(m.email),
      altPhone: dash(m.phone),
      status: m.status || 'Unapproved',
      gotra: dash(m.gothra),
      bloodGroup: dash(m.bloodGroup),
      address: dash(m.address),
      postTaluk: [m.locality, m.talukName].filter(Boolean).join(' / ') || '—',
      districtState: [m.districtName, m.stateName].filter(Boolean).join(', ') || '—',
      pinCode: dash(m.postalCode),
      labelPoint: '—',
      category: dash(m.membershipTypeCategory),
      profession: dash(m.employment),
      nativeDetails: dash(m.nativePlace),
      magazineRemarks: '—'
    };
  }, [selectedMember]);

  // ----------------------------------------------------
  // POPULATE FORM FROM SELECTED MEMBER
  // ----------------------------------------------------
  const applyMemberToForm = (member) => {
    setSelectedMember(member);
    const memNo = member.membershipNumber || member.registrationNumber || member.id || '';
    const memType = member.membershipType || member.membershipTypeCategory || '';

    // Receipt Number, Receipt Date, and PAN must strictly remain EMPTY per business requirement
    setMatchedExistingReceipt(null);
    setFormData((prev) => ({
      ...prev,
      receiptNumber: '', // Strictly MANUAL entry
      receiptDate: '', // Strictly MANUAL entry
      panNo: '', // Strictly MANUAL entry (never auto-fill even if present)
      name: member.fullName || member.name || '',
      membershipNo: memNo,
      mobile: member.mobile || '',
      membershipType: memType,
      membershipTypeId: member.membershipTypeId || '',
      particulars: defaultParticular || prev.particulars,
      donationSubType: '',
      othersDescription: '',
      amount: member.amount !== '' && member.amount !== undefined ? String(member.amount) : prev.amount || '',
      paymentMode: member.paymentMode || prev.paymentMode || 'Cash',
      bankAccount: member.bankAccount || '',
      transactionId: member.transactionId || '',
      transactionDate: member.transactionDate || '',
      paymentReceivedDetails: member.bankAccount ? `Bank: ${member.bankAccount}` : member.paymentRemarks || `Membership payment for #${memNo}`,
      description: member.paymentRemarks || `Membership registration receipt for ${member.fullName || member.name}`
    }));
    setFormErrors({});

    // the membership type and its price live on the member's membership record
    if (member.id) {
      api
        .get(`/members/${member.id}/profile`)
        .then(({ data }) => {
          const ms = (data?.memberships || [])[0];
          if (!ms) return;
          setSelectedMember((prev) => (prev && prev.id === member.id ? { ...prev, membershipType: ms.type_name_en || '' } : prev));
          setFormData((prev) => ({
            ...prev,
            membershipType: ms.type_name_en || prev.membershipType,
            membershipTypeId: ms.membership_type_id || prev.membershipTypeId,
            amount: prev.amount || (ms.current_price ? String(ms.current_price) : '')
          }));
        })
        .catch(() => {});
    }
  };

  // ----------------------------------------------------
  // CLEAR AUTO-POPULATED MEMBER FIELDS
  // ----------------------------------------------------
  const clearAutoPopulatedMemberFields = () => {
    setSelectedMember(null);
    setMatchedExistingReceipt(null);
    setLookupError('');
    setFormData((prev) => ({
      ...prev,
      name: '',
      panNo: '',
      membershipNo: '',
      mobile: '',
      membershipType: '',
      membershipTypeId: '',
      paymentReceivedDetails: (prev.paymentReceivedDetails || '').startsWith('Membership payment for') ? '' : prev.paymentReceivedDetails,
      description: (prev.description || '').startsWith('Membership registration receipt for') ? '' : prev.description
    }));
  };

  // ----------------------------------------------------
  // MEMBERSHIP NUMBER LOOKUP LOGIC (over the members loaded from the server)
  // ----------------------------------------------------
  const findMemberByQuery = (query) => {
    const clean = String(query || '').trim().toLowerCase();
    if (!clean) return null;
    const same = (v) => v !== undefined && v !== null && String(v).trim().toLowerCase() === clean;
    return (
      registeredMembers.find((m) => same(m.membershipNumber)) ||
      registeredMembers.find((m) => same(m.registrationNumber) || same(m.id)) ||
      unapprovedMembers.find((m) => same(m.registrationNumber) || same(m.id) || same(m.membershipNumber)) ||
      null
    );
  };

  // ----------------------------------------------------
  // UNASSIGN / CLEAR / SWITCH MEMBER HANDLER
  // ----------------------------------------------------
  const handleResetMember = () => {
    setEntrySource('normal');
    setLookupMembershipNo('');
    clearAutoPopulatedMemberFields();
    showToast('Member unassigned. Switched to direct receipt entry mode.');
  };

  // "ASSIGN TO RECEIPT" FROM BOTTOM UNAPPROVED MEMBERS TABLE (FLOW 1)
  const handleAssignFromUnapproved = (member) => {
    setEntrySource('unapproved-assignment');
    const memNo = member.registrationNumber || member.membershipNumber || member.id || '';
    setLookupMembershipNo(memNo);
    applyMemberToForm(member);
    setLookupError('');
    showToast(`Assigned unapproved member "${member.fullName || member.name}" to Receipt.`);
  };

  // "ASSIGN TO RECEIPT" FROM RIGHT-SIDE MEMBERSHIP LIST TABLE (FLOW 2)
  const handleAssignFromMembership = (member) => {
    setEntrySource('membership-assignment');
    const memNo = member.membershipNumber || member.registrationNumber || member.id || '';
    setLookupMembershipNo(memNo);
    applyMemberToForm(member);
    setLookupError('');
    showToast(`Assigned membership record "${member.fullName || member.name}" to Receipt.`);
  };

  // A renewal due: load that member from the server and assign it (renewal payment)
  const handleAssignRenewal = async (renewal) => {
    try {
      const { data } = await api.get(`/members/${renewal.member_id || renewal.id}`);
      const mem = { ...toEntryMember(data, locations), isRenewal: true };
      setEntrySource('membership-assignment');
      setLookupMembershipNo(mem.membershipNumber || mem.registrationNumber || mem.id || '');
      applyMemberToForm(mem);
      setLookupError('');
      showToast(`Assigned renewal for "${mem.fullName}" to Receipt.`);
    } catch (error) {
      showToast(apiErrorMessage(error, 'Could not load that member.'), 'error');
    }
  };

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

  // Payment Mode Change
  const handlePaymentModeChange = (e) => {
    const selectedMode = e.target.value;
    const isCash = selectedMode.trim().toLowerCase() === 'cash';

    setFormData((prev) => ({
      ...prev,
      paymentMode: selectedMode,
      bankAccount: isCash ? '' : selectedMode,
      transactionId: isCash ? '' : prev.transactionId
    }));

    if (formErrors.paymentMode || formErrors.transactionId) {
      setFormErrors((prev) => ({
        ...prev,
        paymentMode: '',
        transactionId: ''
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
    } else if (name === 'membershipNo') {
      setFormData((prev) => ({ ...prev, membershipNo: value }));
      setLookupMembershipNo(value);
      const clean = String(value || '').trim();
      if (!clean) {
        clearAutoPopulatedMemberFields();
      } else {
        const found = findMemberByQuery(clean);
        if (found) {
          setSelectedMember(found);
          setLookupError('');
        }
      }
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
    } else if (formData.receiptNumber.trim().length > 50) {
      errors.receiptNumber = 'Receipt No. can be at most 50 characters.';
    } else {
      const existingMatch = existingReceipts.find(
        (r) => r.receiptNumber && r.receiptNumber.toLowerCase().trim() === formData.receiptNumber.toLowerCase().trim()
      );
      if (existingMatch) {
        errors.receiptNumber = 'This Receipt Number already exists. Please enter a unique Receipt No.';
      }
    }

    // 2. Receipt Date (Mandatory)
    if (!formData.receiptDate) {
      errors.receiptDate = 'Receipt Date is mandatory. Enter it as DD-MM-YYYY.';
    } else if (formData.receiptDate > getTodayISODate()) {
      errors.receiptDate = 'Receipt Date cannot be in the future.';
    } else if (formData.receiptDate < '2000-01-01') {
      errors.receiptDate = 'Receipt Date looks wrong. Please check the year.';
    }

    // 3. Name (Mandatory)
    if (!formData.name.trim()) {
      errors.name = 'Applicant / Payee Name is mandatory.';
    } else if (formData.name.trim().length < 2) {
      errors.name = 'Name must be at least 2 characters.';
    } else if (formData.name.trim().length > 200) {
      errors.name = 'Name can be at most 200 characters.';
    } else if (!/[A-Za-z\u0C80-\u0CFF\u0D00-\u0D7F]/.test(formData.name)) {
      errors.name = 'Name must contain letters.';
    }

    // 4. Particulars (Mandatory, must exist in the Particulars master)
    if (!formData.particulars || !activeParticulars.some((p) => p.name === formData.particulars)) {
      errors.particulars =
        activeParticulars.length === 0
          ? 'No particulars are set up yet. Add them in Masters → Particulars Master.'
          : 'Particulars selection is mandatory.';
    }

    // 5. If Donation: Donation Type is mandatory if active sub-types exist
    if (formData.particulars === 'Donation' && hasActiveSubTypes && !formData.donationSubType) {
      errors.donationSubType = 'Please select a Donation Type.';
    }

    // 6. If Others: Description is mandatory
    if (formData.particulars === 'Others' && !formData.othersDescription.trim()) {
      errors.othersDescription = 'Please specify the description for Others.';
    }

    // 7. Amount (Mandatory, positive integer)
    if (!formData.amount || Number(formData.amount) <= 0) {
      errors.amount = 'Please enter a valid amount greater than 0.';
    } else if (!/^\d+(\.\d{1,2})?$/.test(String(formData.amount).trim())) {
      errors.amount = 'Amount can have at most 2 decimal places.';
    } else if (Number(formData.amount) > 9999999999.99) {
      errors.amount = 'Amount is too large.';
    }

    // 8. Payment Mode
    if (!formData.paymentMode) {
      errors.paymentMode = 'Payment Mode is mandatory.';
    } else {
      const isCash = formData.paymentMode.trim().toLowerCase() === 'cash';
      if (!isCash && !formData.transactionId.trim()) {
        errors.transactionId = `Transaction ID is mandatory for ${formData.paymentMode}.`;
      } else if (!isCash && formData.transactionId.trim().length < 4) {
        errors.transactionId = 'Transaction ID looks too short. Please check it.';
      } else if (formData.transactionId.trim().length > 150) {
        errors.transactionId = 'Transaction ID can be at most 150 characters.';
      }
    }

    // 9. Mobile (If entered, validate 10 digits)
    if (formData.mobile && !/^\d{10}$/.test(formData.mobile)) {
      errors.mobile = 'Mobile number must be exactly 10 digits.';
    } else if (formData.mobile && !/^[6-9]/.test(formData.mobile)) {
      errors.mobile = 'Mobile number must start with 6, 7, 8 or 9.';
    }

    // 10. PAN (If entered, validate standard format)
    if (formData.panNo && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(formData.panNo)) {
      errors.panNo = 'Enter a valid 10-character PAN (e.g. ABCDE1234F).';
    }

    // 11. Membership No Validation (Only if no member is selected and membershipNo is manually entered)
    if (!selectedMember && formData.membershipNo.trim()) {
      const lookedUp = findMemberByQuery(formData.membershipNo);
      if (!lookedUp) {
        errors.membershipNo = `Membership Number / ID "${formData.membershipNo}" does not exist.`;
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ----------------------------------------------------
  // SUBMIT & SAVE RECEIPT (a server call; route depends on the entry source)
  // ----------------------------------------------------
  const handleSaveReceipt = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      showToast('Please correct the validation errors before saving.', 'error');
      return;
    }

    const isAssignmentFlow = entrySource === 'unapproved-assignment' || entrySource === 'membership-assignment';

    let targetMember = selectedMember;
    if (!targetMember && isAssignmentFlow && formData.membershipNo.trim()) {
      targetMember = findMemberByQuery(formData.membershipNo);
    }

    const isCash = String(formData.paymentMode || '').trim().toLowerCase() === 'cash';
    const linked = isAssignmentFlow && targetMember ? targetMember : null;

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
      bankAccount: isCash ? '' : formData.bankAccount || formData.paymentMode,
      transactionId: isCash ? '' : formData.transactionId.trim(),
      transactionDate: formData.transactionDate || '',
      paymentReceivedDetails: formData.paymentReceivedDetails.trim(),
      description: formData.description.trim(),
      // a payment for someone who already holds a membership number is a renewal
      isRenewal: Boolean(linked && (linked.isRenewal || (linked.membershipNumber && formData.particulars === 'Membership')))
    };

    setSaving(true);
    try {
      const { data } = await api.post('/receipts/', receiptToApiPayload(payload, linked));
      const receiptNo = data?.receipt_number || payload.receiptNumber;
      const memberDisplayName = linked ? linked.fullName || linked.name : formData.name;

      // Route Navigation strictly based on entrySource
      if (entrySource === 'unapproved-assignment') {
        showToast(`Receipt #${receiptNo} successfully linked to ${memberDisplayName}'s unapproved profile!`, 'success');
        navigate('/dashboard/membership/unapproved');
      } else if (entrySource === 'membership-assignment') {
        showToast(`Receipt #${receiptNo} successfully linked to member "${memberDisplayName}"!`, 'success');
        handleClearForm();
        await reloadData();
      } else {
        showToast(`Receipt #${receiptNo} saved successfully! Navigating to Receipt Tracking...`, 'success');
        navigate('/dashboard/receipts/tracking');
      }
    } catch (error) {
      console.error('Failed to save receipt.', error);
      showToast(apiErrorMessage(error, 'Failed to save the receipt. Please try again.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Reset Form
  const handleClearForm = () => {
    setEntrySource('normal');
    setSelectedMember(null);
    setLookupMembershipNo('');
    setLookupError('');
    setFormData({ ...emptyForm, particulars: defaultParticular });
    setFormErrors({});
  };

  // ----------------------------------------------------
  // RIGHT-SIDE MEMBERSHIP LIST FILTER & PAGINATION
  // ----------------------------------------------------
  const filteredRightMembers = useMemo(() => {
    if (!rightSearchQuery.trim()) return registeredMembers;
    const q = rightSearchQuery.toLowerCase().trim();
    return registeredMembers.filter((m) => {
      const memNo = String(m.membershipNumber || '').toLowerCase();
      const regNo = String(m.registrationNumber || m.id || '').toLowerCase();
      const name = String(m.fullName || m.name || '').toLowerCase();
      const contact = String(m.contactNumber || m.mobile || m.mobileNumber || m.phone || '').toLowerCase();
      const district = String(m.districtName || m.district || '').toLowerCase();
      const location = String(m.locality || m.talukName || m.taluk || m.place || m.addressLine || m.address || '').toLowerCase();

      return (
        memNo.includes(q) ||
        regNo.includes(q) ||
        name.includes(q) ||
        contact.includes(q) ||
        district.includes(q) ||
        location.includes(q)
      );
    });
  }, [registeredMembers, rightSearchQuery]);

  const totalRightMembers = filteredRightMembers.length;
  const totalRightPages = Math.max(1, Math.ceil(totalRightMembers / rightPageSize));
  const paginatedRightMembers = useMemo(() => {
    const start = (rightPage - 1) * rightPageSize;
    return filteredRightMembers.slice(start, start + rightPageSize);
  }, [filteredRightMembers, rightPage, rightPageSize]);

  // ----------------------------------------------------
  // BOTTOM UNAPPROVED MEMBERS (ONLY UNASSIGNED) FILTER & PAGINATION
  // ----------------------------------------------------
  const bottomUnassignedMembers = useMemo(() => {
    return unapprovedMembers.filter((m) => !isMemberReceiptAssigned(m));
  }, [unapprovedMembers]);

  const filteredBottomMembers = useMemo(() => {
    if (!unapprovedSearchQuery.trim()) return bottomUnassignedMembers;
    const q = unapprovedSearchQuery.toLowerCase().trim();
    return bottomUnassignedMembers.filter((m) => {
      const regNo = String(m.registrationNumber || m.id || '').toLowerCase();
      const name = String(m.fullName || m.name || '').toLowerCase();
      const contact = String(m.contactNumber || m.mobile || m.mobileNumber || m.phone || '').toLowerCase();
      const mType = String(m.membershipType || m.membershipTypeCategory || '').toLowerCase();
      const district = String(m.districtName || m.district || '').toLowerCase();
      const location = String(m.locality || m.talukName || m.taluk || m.place || m.addressLine || m.address || '').toLowerCase();

      return (
        regNo.includes(q) ||
        name.includes(q) ||
        contact.includes(q) ||
        mType.includes(q) ||
        district.includes(q) ||
        location.includes(q)
      );
    });
  }, [bottomUnassignedMembers, unapprovedSearchQuery]);

  const totalBottomMembers = filteredBottomMembers.length;
  const totalBottomPages = Math.max(1, Math.ceil(totalBottomMembers / unapprovedPageSize));
  const paginatedBottomMembers = useMemo(() => {
    const start = (unapprovedPage - 1) * unapprovedPageSize;
    return filteredBottomMembers.slice(start, start + unapprovedPageSize);
  }, [filteredBottomMembers, unapprovedPage, unapprovedPageSize]);

  // ----------------------------------------------------
  // RENEWALS DUE (server)
  // ----------------------------------------------------
  const filteredRenewals = useMemo(() => {
    const q = renewalSearchQuery.trim().toLowerCase();
    if (!q) return unapprovedRenewals;
    return unapprovedRenewals.filter(
      (r) =>
        String(r.registrationNumber ?? '').toLowerCase().includes(q) ||
        String(r.name || '').toLowerCase().includes(q) ||
        String(r.membershipNumber ?? '').toLowerCase().includes(q) ||
        String(r.membershipType || '').toLowerCase().includes(q) ||
        String(r.contactNumber || '').includes(q)
    );
  }, [unapprovedRenewals, renewalSearchQuery]);


  return (
    <PermissionGate required="receipts.entry.read">
    <div className="space-y-6 pb-16 font-sans">

      {/* View Member Profile Details Modal */}
      <Modal isOpen={Boolean(viewingMember)} onClose={() => setViewingMember(null)}>
        {viewingMember && (() => {
          const matchedReceipt = findMatchingReceiptForMember(viewingMember);
          const receiptNo = matchedReceipt?.receiptNumber || viewingMember.assignedReceiptNumber || viewingMember.receiptNumber || viewingMember.transactionId || '—';
          const receiptDate = matchedReceipt?.receiptDate ? formatDate(matchedReceipt.receiptDate) : (viewingMember.receiptDate ? formatDate(viewingMember.receiptDate) : (viewingMember.transactionDate ? formatDate(viewingMember.transactionDate) : '—'));
          const amountVal = matchedReceipt?.amount !== undefined ? matchedReceipt.amount : (viewingMember.amount !== undefined ? viewingMember.amount : '—');
          const paymentDesc = matchedReceipt?.paymentMode ? `${matchedReceipt.paymentMode}${matchedReceipt.description ? ` - ${matchedReceipt.description}` : ''}` : (viewingMember.paymentMode ? `${viewingMember.paymentMode}${viewingMember.paymentRemarks ? ` ${viewingMember.paymentRemarks}` : ''}` : (viewingMember.description || '—'));
          const regDateStr = viewingMember.registrationDate || viewingMember.createdDate || viewingMember.createdAt;
          const formattedRegDate = regDateStr ? (formatDateTime(regDateStr) || formatDate(regDateStr)) : '—';
          const dobStr = viewingMember.birthDate || viewingMember.dob || viewingMember.dateOfBirth;
          const formattedDob = dobStr ? formatDate(dobStr) : '—';
          const expDateStr = viewingMember.expiryDate;
          const formattedExpDate = expDateStr ? formatDate(expDateStr) : '—';

          return (
            <div
              className="bg-white rounded-xl max-w-4xl w-full shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between bg-[#E53935] px-4 py-2.5 text-white">
                <div className="flex items-center gap-3">
                  <h3 className="font-bold text-base text-white tracking-wide">
                    Profile Details
                  </h3>
                  
                </div>
                <button
                  type="button"
                  onClick={() => setViewingMember(null)}
                  className="text-white hover:text-white/80 transition-colors p-1 rounded cursor-pointer"
                  title="Close"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>

              {/* Body Content */}
              <div className="p-5 sm:p-6 overflow-y-auto max-h-[75vh]">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">

                  {/* Column 1: Profile Photo */}
                  <div className="md:col-span-3 flex flex-col items-center">
                    <div className="relative w-full max-w-[200px] aspect-[3/4] bg-stone-100 rounded-lg overflow-hidden border border-stone-200 shadow-sm flex items-center justify-center">
                      {viewingMember.photoUrl || viewingMember.photo || viewingMember.image || viewingMember.avatar ? (
                        <img
                          src={viewingMember.photoUrl || viewingMember.photo || viewingMember.image || viewingMember.avatar}
                          alt={viewingMember.fullName || viewingMember.name || 'Member Photo'}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-amber-50 to-stone-200 text-stone-400">
                          <User className="w-16 h-16 text-stone-400/80 mb-2" />
                          <span className="text-[11px] font-medium text-stone-500">No Photo</span>
                        </div>
                      )}
                      {/* Watermark Overlay */}
                      <div className="absolute bottom-2 inset-x-0 text-center pointer-events-none">
                        <span className="text-white/80 font-serif text-xs italic tracking-wider drop-shadow-md px-2 py-0.5 rounded bg-black/20">
                          Havyaka Mangalya
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Column 2: BASIC INFORMATION */}
                  <div className="md:col-span-5 space-y-2 text-xs sm:text-[13px] text-stone-800">
                    <h4 className="text-sm font-bold text-[#E65100] uppercase tracking-wide pb-1 border-b border-stone-200 mb-3">
                      BASIC INFORMATION
                    </h4>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-stone-900 shrink-0">Name:</span>
                      <span className="text-stone-800 font-semibold">{viewingMember.fullName || viewingMember.name || '—'}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-stone-900 shrink-0">Registration Number:</span>
                      <span className="text-stone-800 font-mono">{viewingMember.registrationNumber || viewingMember.id || '—'}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-stone-900 shrink-0">Registration Date:</span>
                      <span className="text-stone-800 font-mono">{formattedRegDate}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-stone-900 shrink-0">Membership Number:</span>
                      <span className="text-stone-800 font-mono">{viewingMember.membershipNumber || viewingMember.registrationNumber || '—'}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-stone-900 shrink-0">Membership Name:</span>
                      <span className="text-stone-800">{viewingMember.membershipName || viewingMember.fullName || viewingMember.name || '—'}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-stone-900 shrink-0">Mobile:</span>
                      <span className="text-stone-800 font-mono">{viewingMember.contactNumber || viewingMember.mobile || viewingMember.phone || '—'}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-stone-900 shrink-0">Father Name:</span>
                      <span className="text-stone-800">{viewingMember.fatherHusbandName || viewingMember.fatherName || viewingMember.guardianName || '—'}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-stone-900 shrink-0">Gender:</span>
                      <span className="text-stone-800">{viewingMember.gender || '—'}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-stone-900 shrink-0">Date Of Birth:</span>
                      <span className="text-stone-800 font-mono">{formattedDob}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-stone-900 shrink-0">Height:</span>
                      <span className="text-stone-800">{viewingMember.height || '—'}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-stone-900 shrink-0">Expiry Date:</span>
                      <span className="text-stone-800 font-mono">{formattedExpDate}</span>
                    </div>
                  </div>

                  {/* Column 3: PAYMENT INFORMATION & RECIEPT INFORMATION */}
                  <div className="md:col-span-4 space-y-6 text-xs sm:text-[13px]">

                    {/* Payment Information */}
                    <div className="space-y-2">
                      <h4 className="text-sm font-bold text-[#E65100] uppercase tracking-wide pb-1 border-b border-stone-200 mb-3">
                        PAYMENT INFORMATION
                      </h4>

                      <div className="flex items-baseline gap-1.5 leading-snug">
                        <span className="font-bold text-stone-900 shrink-0">Cash Receipt/Cheque/DD No:</span>
                        <span className="text-[#EA4335] font-bold font-mono">{receiptNo}</span>
                      </div>

                      <div className="flex items-baseline gap-1.5 leading-snug">
                        <span className="font-bold text-stone-900 shrink-0">Date:</span>
                        <span className="text-[#EA4335] font-bold font-mono">{receiptDate}</span>
                      </div>

                      <div className="flex items-baseline gap-1.5 leading-snug">
                        <span className="font-bold text-stone-900 shrink-0">Cash Amount:</span>
                        <span className="text-[#EA4335] font-bold font-mono">{amountVal}</span>
                      </div>

                      <div className="flex items-baseline gap-1.5 leading-snug">
                        <span className="font-bold text-stone-900 shrink-0">Payment Description:</span>
                        <span className="text-[#EA4335] font-bold">{paymentDesc}</span>
                      </div>
                    </div>

                    {/* Receipt Information */}
                    <div className="space-y-2">
                      <h4 className="text-sm font-bold text-[#E65100] uppercase tracking-wide pb-1 border-b border-stone-200 mb-3">
                        RECIEPT INFORMATION
                      </h4>

                      <div className="flex items-baseline gap-1.5 leading-snug">
                        <span className="font-bold text-stone-900 shrink-0">Cash Receipt Number:</span>
                        <span className="text-[#EA4335] font-bold font-mono">{receiptNo}</span>
                      </div>

                      <div className="flex items-baseline gap-1.5 leading-snug">
                        <span className="font-bold text-stone-900 shrink-0">Cash Date:</span>
                        <span className="text-[#EA4335] font-bold font-mono">{receiptDate}</span>
                      </div>

                      <div className="flex items-baseline gap-1.5 leading-snug">
                        <span className="font-bold text-stone-900 shrink-0">Cash Amount:</span>
                        <span className="text-[#EA4335] font-bold font-mono">{amountVal}</span>
                      </div>

                      <div className="flex items-baseline gap-1.5 leading-snug">
                        <span className="font-bold text-stone-900 shrink-0">Payment Description:</span>
                        <span className="text-[#EA4335] font-bold">{matchedReceipt?.description || viewingMember.paymentRemarks || viewingMember.description || '-'}</span>
                      </div>
                    </div>

                  </div>

                </div>
              </div>

              {/* Read-only footer */}
              <div className="p-4 border-t border-stone-200 bg-white flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setViewingMember(null)}
                  className="px-5 py-2 bg-white hover:bg-stone-50 border border-stone-300 text-stone-700 text-xs sm:text-sm font-semibold rounded-lg transition-all cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>


      {/* ------------------------------------------------------------ */}
      {/* PAGE HEADER                                    */}
      {/* ------------------------------------------------------------ */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#180200] tracking-tight">
              Receipt Entry
            </h1>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* MAIN TWO-COLUMN SPLIT VIEW: FORM ON LEFT, MEMBER LIST / DETAILS ON RIGHT */}
      {/* ------------------------------------------------------------ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">

        {/* ------------------------------------------------------------ */}
        {/* LEFT COLUMN: RECEIPT ENTRY FORM (5 cols)                     */}
        {/* ------------------------------------------------------------ */}
        <div className="col-span-12 lg:col-span-5">
          <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_16px_-4px_rgba(24,2,0,0.06)] overflow-hidden">

            {/* Form Card Header */}
            <div className="bg-[#FAF7F2] border-b border-[#E8DFD8] px-4 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-bold text-[#180200]">
                    Create New Receipt
                  </h2>
                </div>
              </div>
            </div>

            {/* Form Fields */}
            <form onSubmit={handleSaveReceipt} className="p-4 sm:p-5 space-y-3.5">

              {/* FLOW 2 MEMBERSHIP DETAILS SECTION INSIDE FORM (When selected from Right Membership List) */}
              {entrySource === 'membership-assignment' && selectedMember && (
                <div className="p-3.5 bg-amber-50/80 rounded-xl border border-amber-200/80 space-y-2 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <User className="w-4 h-4 text-[#510601] shrink-0" />
                      <span className="text-xs font-bold text-[#180200] truncate">
                        Assigned Member: {selectedMember.fullName || selectedMember.name}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#510601]/10 text-[#510601] shrink-0">
                        #{selectedMember.membershipNumber || selectedMember.registrationNumber || selectedMember.id}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleResetMember}
                      className="px-2 py-0.5 text-[11px] font-semibold text-[#510601] hover:bg-white rounded border border-[#E8DFD8] transition-colors cursor-pointer shrink-0 ml-2"
                      title="Clear member from form"
                    >
                      Unassign
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-[#863221]">
                    <div>
                      <span className="font-semibold text-[#863221]/70 block">Contact:</span>
                      <span className="text-[#180200] font-mono">{selectedMember.mobile || selectedMember.contactNumber || '—'}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-[#863221]/70 block">Type:</span>
                      <span className="text-[#180200]">{selectedMember.membershipType || selectedMember.membershipTypeCategory || 'Standard'}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-[#863221]/70 block">District:</span>
                      <span className="text-[#180200]">{selectedMember.districtName || selectedMember.district || '—'}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3">

                {/* Row 1: Receipt No & Receipt Date */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* 1. Receipt No (Manual Entry) */}
                  <div>
                    <label className="block text-xs font-bold text-[#180200] mb-1">
                      Receipt No. <span className="text-[#ED4636]">*</span>
                    </label>
                    <input
                      type="text"
                      name="receiptNumber"
                      value={formData.receiptNumber}
                      onChange={handleInputChange}

                      className={`w-full px-3 py-2 rounded-xl text-xs sm:text-sm font-mono font-bold text-[#180200] focus:outline-none focus:bg-white transition-colors ${formErrors.receiptNumber
                        ? 'bg-red-50/30 border border-[#ED4636] ring-1 ring-[#ED4636]/30'
                        : 'bg-[#FAF7F2] border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                        }`}
                    />
                    {formErrors.receiptNumber && (
                      <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        {formErrors.receiptNumber}
                      </p>
                    )}
                  </div>

                  {/* 2. Receipt Date */}
                  <div>
                    <label className="block text-xs font-bold text-[#180200] mb-1">
                      Receipt Date <span className="text-[#ED4636]">*</span>
                    </label>
                    <DateInput
                      name="receiptDate"
                      value={formData.receiptDate}
                      onChange={handleInputChange}
                      className={`w-full px-3 py-2 bg-[#FAF7F2] border rounded-xl text-xs sm:text-sm text-[#180200] focus:outline-none focus:bg-white transition-colors ${formErrors.receiptDate
                        ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30'
                        : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                        }`}
                    />
                    {formErrors.receiptDate && (
                      <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        {formErrors.receiptDate}
                      </p>
                    )}
                  </div>
                </div>

                {/* Row 2: Payee Name & Mobile */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* 3. Name */}
                  <div>
                    <label className="block text-xs font-bold text-[#180200] mb-1">
                      Payee Name <span className="text-[#ED4636]">*</span>
                    </label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleInputChange}

                      className={`w-full px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold text-[#180200] focus:outline-none focus:bg-white transition-colors ${formErrors.name
                        ? 'bg-red-50/30 border border-[#ED4636] ring-1 ring-[#ED4636]/30'
                        : 'bg-[#FAF7F2] border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                        }`}
                    />
                    {formErrors.name && (
                      <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        {formErrors.name}
                      </p>
                    )}
                  </div>

                  {/* 4. Mobile */}
                  <div>
                    <label className="block text-xs font-bold text-[#180200] mb-1">
                      Mobile
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#863221]/70">
                        +91
                      </span>
                      <input
                        type="tel"
                        name="mobile"
                        value={formData.mobile}
                        onChange={handleInputChange}
                        maxLength={10}

                        className="w-full pl-10 pr-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] focus:bg-white rounded-xl text-xs sm:text-sm font-mono text-[#180200] placeholder-[#863221]/30 focus:outline-none transition-colors"
                      />
                    </div>
                    {formErrors.mobile && (
                      <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        {formErrors.mobile}
                      </p>
                    )}
                  </div>
                </div>

                {/* Row 3: Membership No, PAN, Particulars */}
                {formData.particulars === 'Donation' ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Membership No */}
                      <div>
                        <label className="block text-xs font-bold text-[#180200] mb-1">
                          Membership No.
                        </label>
                        <input
                          type="text"
                          name="membershipNo"
                          value={formData.membershipNo}
                          onChange={handleInputChange}

                          className="w-full px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] focus:bg-white rounded-xl text-xs sm:text-sm font-mono text-[#180200] placeholder-[#863221]/30 focus:outline-none transition-colors"
                        />
                      </div>

                      {/* PAN */}
                      <div>
                        <label className="block text-xs font-bold text-[#180200] mb-1">
                          PAN
                        </label>
                        <input
                          type="text"
                          name="panNo"
                          value={formData.panNo}
                          onChange={handleInputChange}
                          maxLength={10}

                          className="w-full px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] focus:bg-white rounded-xl text-xs sm:text-sm font-mono uppercase text-[#180200] placeholder-[#863221]/30 focus:outline-none transition-colors"
                        />
                        {formErrors.panNo && (
                          <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            {formErrors.panNo}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Particulars */}
                      <div>
                        <label className="block text-xs font-bold text-[#180200] mb-1">
                          Particulars <span className="text-[#ED4636]">*</span>
                        </label>
                        <select
                          name="particulars"
                          value={formData.particulars}
                          onChange={handleParticularsChange}
                          className={`w-full px-3 py-2 bg-[#FAF7F2] border rounded-xl text-xs sm:text-sm font-semibold text-[#180200] focus:outline-none focus:bg-white cursor-pointer transition-colors ${formErrors.particulars
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
                          <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            {formErrors.particulars}
                          </p>
                        )}
                      </div>

                      {/* Donation Type */}
                      <div>
                        <label className="block text-xs font-bold text-[#180200] mb-1">
                          Donation Type <span className="text-[#ED4636]">*</span>
                        </label>
                        <select
                          name="donationSubType"
                          value={formData.donationSubType}
                          onChange={handleInputChange}
                          className={`w-full px-3 py-2 bg-[#FAF7F2] border rounded-xl text-xs sm:text-sm font-semibold text-[#180200] focus:outline-none cursor-pointer transition-colors ${formErrors.donationSubType
                            ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30'
                            : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                            }`}
                        >
                          <option value="">Select Type</option>
                          {activeSubTypes.map((st) => (
                            <option key={st.id || st.name} value={st.name}>
                              {st.name}
                            </option>
                          ))}
                        </select>
                        {formErrors.donationSubType && (
                          <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            {formErrors.donationSubType}
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Membership No */}
                    <div>
                      <label className="block text-xs font-bold text-[#180200] mb-1">
                        Membership No.
                      </label>
                      <input
                        type="text"
                        name="membershipNo"
                        value={formData.membershipNo}
                        onChange={handleInputChange}

                        className="w-full px-2.5 py-2 bg-[#FAF7F2] border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] focus:bg-white rounded-xl text-xs sm:text-sm font-mono text-[#180200] placeholder-[#863221]/30 focus:outline-none transition-colors"
                      />
                    </div>

                    {/* PAN */}
                    <div>
                      <label className="block text-xs font-bold text-[#180200] mb-1">
                        PAN
                      </label>
                      <input
                        type="text"
                        name="panNo"
                        value={formData.panNo}
                        onChange={handleInputChange}
                        maxLength={10}

                        className="w-full px-2.5 py-2 bg-[#FAF7F2] border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] focus:bg-white rounded-xl text-xs sm:text-sm font-mono uppercase text-[#180200] placeholder-[#863221]/30 focus:outline-none transition-colors"
                      />
                      {formErrors.panNo && (
                        <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          {formErrors.panNo}
                        </p>
                      )}
                    </div>

                    {/* Particulars */}
                    <div>
                      <label className="block text-xs font-bold text-[#180200] mb-1">
                        Particulars <span className="text-[#ED4636]">*</span>
                      </label>
                      <select
                        name="particulars"
                        value={formData.particulars}
                        onChange={handleParticularsChange}
                        className={`w-full px-2 py-2 bg-[#FAF7F2] border rounded-xl text-xs sm:text-sm font-semibold text-[#180200] focus:outline-none focus:bg-white cursor-pointer transition-colors ${formErrors.particulars
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
                        <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          {formErrors.particulars}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Conditional Row for Non-Donation Sub-Types or Others Description */}
                {formData.particulars !== 'Donation' && hasActiveSubTypes ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-[#180200] mb-1">
                        {`${formData.particulars} Sub-Type`} <span className="text-[#ED4636]">*</span>
                      </label>
                      <select
                        name="donationSubType"
                        value={formData.donationSubType}
                        onChange={handleInputChange}
                        className={`w-full px-3 py-2 bg-[#FAF7F2] border rounded-xl text-xs sm:text-sm font-semibold text-[#180200] focus:outline-none cursor-pointer transition-colors ${formErrors.donationSubType
                          ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30'
                          : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                          }`}
                      >
                        <option value="">{`Select ${formData.particulars} Sub-Type`}</option>
                        {activeSubTypes.map((st) => (
                          <option key={st.id || st.name} value={st.name}>
                            {st.name}
                          </option>
                        ))}
                      </select>
                      {formErrors.donationSubType && (
                        <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          {formErrors.donationSubType}
                        </p>
                      )}
                    </div>
                  </div>
                ) : formData.particulars === 'Others' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-[#180200] mb-1">
                        Others Description <span className="text-[#ED4636]">*</span>
                      </label>
                      <input
                        type="text"
                        name="othersDescription"
                        value={formData.othersDescription}
                        onChange={handleInputChange}

                        className={`w-full px-3 py-2 rounded-xl text-xs sm:text-sm text-[#180200] focus:outline-none transition-colors ${formErrors.othersDescription
                          ? 'bg-[#FAF7F2] border border-[#ED4636] ring-1 ring-[#ED4636]/30'
                          : 'bg-[#FAF7F2] border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                          }`}
                      />
                      {formErrors.othersDescription && (
                        <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          {formErrors.othersDescription}
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* Row 4: Amount & Payment Mode */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* 9. Amount */}
                  <div>
                    <label className="block text-xs font-bold text-[#180200] mb-1">
                      Amount <span className="text-[#ED4636]">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs sm:text-sm font-bold text-[#863221]/70">
                        ₹
                      </span>
                      <input
                        type="text"
                        name="amount"
                        value={formData.amount}
                        onChange={handleInputChange}

                        className={`w-full pl-7 pr-3 py-2 border rounded-xl text-xs sm:text-sm font-mono font-bold text-[#180200] focus:outline-none focus:bg-white transition-colors ${formErrors.amount
                          ? 'bg-red-50/20 border-[#ED4636] ring-1 ring-[#ED4636]/30'
                          : 'bg-[#FAF7F2] border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                          }`}
                      />
                    </div>
                    {formErrors.amount && (
                      <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        {formErrors.amount}
                      </p>
                    )}
                    {formData.amount && Number(formData.amount) > 0 && (
                      <p className="text-[10px] text-[#863221]/80 italic mt-1 truncate" title={numberToWords(formData.amount)}>
                        {numberToWords(formData.amount)}
                      </p>
                    )}
                  </div>

                  {/* 10. Payment Mode */}
                  <div>
                    <label className="block text-xs font-bold text-[#180200] mb-1">
                      Payment Mode <span className="text-[#ED4636]">*</span>
                    </label>
                    <select
                      name="paymentMode"
                      value={formData.paymentMode}
                      onChange={handlePaymentModeChange}
                      className={`w-full px-3 py-2 bg-[#FAF7F2] border rounded-xl text-xs sm:text-sm font-semibold text-[#180200] focus:outline-none focus:bg-white cursor-pointer transition-colors ${formErrors.paymentMode
                        ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30'
                        : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                        }`}
                    >
                      <option value="">Select Mode</option>
                      {activePaymentModes.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                    {formErrors.paymentMode && (
                      <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        {formErrors.paymentMode}
                      </p>
                    )}
                  </div>
                </div>

                {/* Row 5: Transaction ID & Transaction Date */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* 11. Transaction Id */}
                  <div>
                    <label className="block text-xs font-bold text-[#180200] mb-1">
                      Transaction Id {formData.paymentMode && formData.paymentMode.toLowerCase() !== 'cash' && <span className="text-[#ED4636]">*</span>}
                    </label>
                    <input
                      type="text"
                      name="transactionId"
                      value={formData.transactionId}
                      onChange={handleInputChange}
                      disabled={!formData.paymentMode || formData.paymentMode.toLowerCase() === 'cash'}
                      className={`w-full px-3 py-2 rounded-xl text-xs sm:text-sm font-mono text-[#180200] focus:outline-none focus:bg-white transition-colors ${!formData.paymentMode || formData.paymentMode.toLowerCase() === 'cash'
                        ? 'bg-[#FAF7F2]/50 text-stone-400 cursor-not-allowed border border-[#E8DFD8]/80'
                        : formErrors.transactionId
                          ? 'bg-[#FAF7F2] border border-[#ED4636] ring-1 ring-[#ED4636]/30'
                          : 'bg-[#FAF7F2] border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                        }`}
                    />
                    {formErrors.transactionId && (
                      <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        {formErrors.transactionId}
                      </p>
                    )}
                  </div>

                  {/* 12. Transaction Date */}
                  <div>
                    <label className="block text-xs font-bold text-[#180200] mb-1">
                      Transaction Date
                    </label>
                    <DateInput
                      name="transactionDate"
                      value={formData.transactionDate}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] focus:bg-white rounded-xl text-xs sm:text-sm text-[#180200] focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                {/* Row 6: Payment Received Details */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] mb-1">
                    Payment Received Details
                  </label>
                  <input
                    type="text"
                    name="paymentReceivedDetails"
                    value={formData.paymentReceivedDetails}
                    onChange={handleInputChange}

                    className="w-full px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] focus:bg-white rounded-xl text-xs sm:text-sm text-[#180200] placeholder-[#863221]/30 focus:outline-none transition-colors"
                  />
                </div>

                {/* Row 7: Description */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] mb-1">
                    Description
                  </label>
                  <textarea
                    rows={2}
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}

                    className="w-full px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] focus:bg-white rounded-xl text-xs sm:text-sm text-[#180200] placeholder-[#863221]/30 focus:outline-none transition-colors resize-y"
                  />
                </div>

              </div>

              {/* Action Buttons (Clear & Save) */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#E8DFD8]">
                <button
                  type="button"
                  onClick={handleClearForm}
                  className="px-4 py-2 rounded-xl border border-[#E8DFD8] hover:border-[#863221] bg-white text-[#863221] text-xs sm:text-sm font-semibold hover:bg-[#FAF7F2] transition-colors cursor-pointer inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>

                <button
                  type="submit"
                  disabled={saving || !hasPermission('receipts.entry.write')}
                  title={!hasPermission('receipts.entry.write') ? 'Requires receipts.entry.write permission' : undefined}
                  className="disabled:opacity-50 px-5 py-2 rounded-xl bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs sm:text-sm font-bold shadow-sm hover:shadow transition-all cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save</span>
                </button>
              </div>

            </form>
          </div>
        </div>

        {/* ------------------------------------------------------------ */}
        {/* RIGHT COLUMN: CONDITIONAL ACCORDING TO ENTRY SOURCE          */}
        {/* - Flow 1 (unapproved-assignment): Show Member Details Panel  */}
        {/* - Flow 2 (membership-assignment) & Flow 3 (normal): Show Membership List Table */}
        {/* ------------------------------------------------------------ */}
        <div className="col-span-12 lg:col-span-7 w-full space-y-4">

          {(entrySource === 'unapproved-assignment' || entrySource === 'membership-assignment') && selectedMember ? (
            /* ========================================================== */
            /* FLOW 1 STATE: MEMBER DETAILS PANEL (UNAPPROVED ASSIGNMENT)*/
            /* ========================================================== */
            <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_16px_-4px_rgba(24,2,0,0.06)] overflow-hidden animate-in fade-in duration-200">
              {/* Header */}
              <div className="bg-[#FAF7F2] border-b border-[#E8DFD8] px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601] shrink-0">
                    <User className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm sm:text-base font-bold text-[#180200] truncate">
                      Member Details
                    </h2>
                    <p className="text-xs text-[#863221] font-mono truncate">
                      #{selectedMember.membershipNumber || selectedMember.registrationNumber || selectedMember.id} — {selectedMember.fullName || selectedMember.name}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleResetMember}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FAF7F2] hover:bg-white text-[#510601] hover:text-[#180200] text-xs font-bold rounded-xl border border-[#E8DFD8] hover:border-[#510601] transition-all cursor-pointer"
                    title="Unassign member and switch back to normal view"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-[#863221]" />
                    <span>{entrySource === 'membership-assignment' ? 'Change member' : 'Unassign'}</span>
                  </button>
                </div>
              </div>

              {/* Profile Details Content */}
              <div className="p-5 sm:p-6 space-y-5 text-xs sm:text-sm">

                {/* Section 1: Profile Details */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-[#1D4ED8] tracking-wide uppercase flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5 text-[#1D4ED8]" />
                    <span>Profile Details:</span>
                  </h4>
                  <div className="bg-[#FAF7F2] p-3.5 rounded-xl border border-[#E8DFD8] grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    {entrySource === 'unapproved-assignment' && (
                      <>
                        <div>
                          <span className="text-[#863221] font-semibold block">Registration Number:</span>
                          <strong className="font-mono text-[#510601]">{selectedMember.registrationNumber || selectedMember.id || '—'}</strong>
                        </div>
                        <div>
                          <span className="text-[#863221] font-semibold block">Registration Date:</span>
                          <strong className="text-[#180200] font-mono">{formatDate(selectedMember.registrationDate || selectedMember.createdDate)}</strong>
                        </div>
                      </>
                    )}
                    <div>
                      <span className="text-[#863221] font-semibold block">Membership Number:</span>
                      <strong className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 inline-block mt-0.5 font-mono">
                        {selectedMember.membershipNumber ? selectedMember.membershipNumber : 'Not Assigned'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[#863221] font-semibold block">Membership Type:</span>
                      <strong className="text-[#510601]">{selectedMember.membershipType || selectedMember.membershipTypeCategory || '—'}</strong>
                    </div>
                    {entrySource === 'unapproved-assignment' ? (
                      <div>
                        <span className="text-[#863221] font-semibold block">Registration Source:</span>
                        <span className="font-medium text-[#180200]">{selectedMember.registrationSource || selectedMember.registrationType || 'Offline'}</span>
                      </div>
                    ) : (
                      <div>
                        <span className="text-[#863221] font-semibold block">Member Status:</span>
                        <span className="font-medium text-[#180200]">{selectedMember.status || 'Active'}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section 2: Basic Information */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-[#1D4ED8] tracking-wide uppercase flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-[#1D4ED8]" />
                    <span>Basic Information:</span>
                  </h4>
                  <div className="bg-white p-3.5 rounded-xl border border-[#E8DFD8] space-y-2.5 text-xs text-[#180200]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2.5 border-b border-[#E8DFD8]">
                      <div>
                        <span className="text-[#863221] font-semibold block">Name:</span>
                        <strong className="text-sm text-[#180200]">{selectedMember.fullName || selectedMember.name || '—'} {selectedMember.gender ? `(${selectedMember.gender})` : ''}</strong>
                      </div>
                      <div>
                        <span className="text-[#863221] font-semibold block">Father / Husband Name:</span>
                        <strong className="text-[#180200]">{selectedMember.fatherHusbandName || '—'}</strong>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2.5 border-b border-[#E8DFD8]">
                      <div>
                        <span className="text-[#863221] font-semibold block">Date of Birth & Age:</span>
                        <span className="text-[#180200]">{formatDate(selectedMember.birthDate)} {selectedMember.age ? `(Age: ${selectedMember.age})` : ''}</span>
                      </div>
                      <div>
                        <span className="text-[#863221] font-semibold block">Mobile / Contact Number:</span>
                        <strong className="font-mono text-[#180200]">{selectedMember.mobile || selectedMember.mobileNumber || selectedMember.contactNumber || '—'}</strong>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <span className="text-[#863221] font-semibold block">Gothra:</span>
                        <span className="text-[#180200] font-medium">{selectedMember.gothra || selectedMember.gotra || '—'}</span>
                      </div>
                      <div>
                        <span className="text-[#863221] font-semibold block">Blood Group:</span>
                        <strong className="text-[#510601]">{selectedMember.bloodGroup || '—'}</strong>
                      </div>
                      <div>
                        <span className="text-[#863221] font-semibold block">Aadhar Number:</span>
                        <span className="font-mono text-[#180200]">{selectedMember.aadharNumber || selectedMember.aadharNo || '—'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 3: Address & Location */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-[#1D4ED8] tracking-wide uppercase flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#1D4ED8]" />
                    <span>Address Details:</span>
                  </h4>
                  <div className="bg-[#FAF7F2] p-3.5 rounded-xl border border-[#E8DFD8] text-xs space-y-1.5">
                    <div>
                      <span className="text-[#863221] font-semibold block">Full Address:</span>
                      <p className="text-[#180200] mt-0.5 leading-relaxed">
                        {enrichedMember?.address || '—'}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1.5 border-t border-[#E8DFD8]">
                      <div>
                        <span className="text-[#863221] font-semibold block">Taluk / Locality:</span>
                        <span className="text-[#180200]">{enrichedMember?.postTaluk || '—'}</span>
                      </div>
                      <div>
                        <span className="text-[#863221] font-semibold block">District, State & PIN:</span>
                        <span className="text-[#180200]">{enrichedMember?.districtState} — {enrichedMember?.pinCode}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Approved member: renewal date and last payment */}
                {entrySource === 'membership-assignment' && (() => {
                  const ms = memberProfile?.memberships?.[0];
                  const receipts = (memberProfile?.financial?.receipts || []).filter((r) => r.payment_status !== 'CANCELLED');
                  const last = receipts[0];
                  return (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-[#1D4ED8] tracking-wide uppercase flex items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5 text-[#1D4ED8]" />
                        <span>Renewal &amp; Payments:</span>
                      </h4>
                      {!memberProfile ? (
                        <div className="bg-white p-3.5 rounded-xl border border-[#E8DFD8] text-xs text-[#863221]">Loading...</div>
                      ) : (
                        <div className="bg-white p-3.5 rounded-xl border border-[#E8DFD8] grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                          <div>
                            <span className="text-[#863221] font-semibold block">Valid Till / Renewal Due:</span>
                            <strong className="text-[#180200] font-mono">{formatDate(ms?.expires_at, 'Lifetime / not set')}</strong>
                          </div>
                          <div>
                            <span className="text-[#863221] font-semibold block">Membership Status:</span>
                            <strong className="text-[#180200]">{ms?.status || '—'}</strong>
                          </div>
                          <div>
                            <span className="text-[#863221] font-semibold block">Receipts So Far:</span>
                            <strong className="text-[#180200]">{receipts.length}</strong>
                          </div>
                          <div className="sm:col-span-3 pt-2 border-t border-[#E8DFD8]">
                            <span className="text-[#863221] font-semibold block">Last Payment:</span>
                            {last ? (
                              <span className="text-[#180200]">
                                <strong className="font-mono">{last.receipt_number}</strong>
                                {' · '}{formatDate(last.receipt_date)}
                                {' · '}<strong className="font-mono text-[#3D705C]">₹{Number(last.net_amount || 0).toLocaleString('en-IN')}</strong>
                              </span>
                            ) : (
                              <span className="text-[#863221]">No receipts recorded for this member yet.</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Section 4: Payment / Registration Remarks */}
                {entrySource === 'unapproved-assignment' && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-[#1D4ED8] tracking-wide uppercase flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-[#1D4ED8]" />
                    <span>Payment / Registration Info:</span>
                  </h4>
                  <div className="bg-white p-3.5 rounded-xl border border-[#E8DFD8] grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-[#863221] font-semibold block">Registration Amount:</span>
                      <strong className="font-mono text-[#3D705C] text-sm">
                        ₹{Number(selectedMember.amount || 0).toLocaleString('en-IN')}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[#863221] font-semibold block">Payment Mode:</span>
                      <strong className="text-[#180200]">{selectedMember.paymentMode || 'Cash'}</strong>
                    </div>
                    <div>
                      <span className="text-[#863221] font-semibold block">Receipt Status:</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${isMemberReceiptAssigned(selectedMember) ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
                        ● {isMemberReceiptAssigned(selectedMember) ? 'Assigned' : 'Unassigned'}
                      </span>
                    </div>
                  </div>
                </div>

                )}
              </div>
            </div>
          ) : (
            /* ========================================================== */
            /* FLOW 2 & FLOW 3 STATE: RIGHT-SIDE MEMBERSHIP LIST TABLE   */
            /* ========================================================== */
            <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_16px_-4px_rgba(24,2,0,0.06)] overflow-hidden">
              {/* Header */}
              <div className="bg-[#FAF7F2] border-b border-[#E8DFD8] px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#510601] text-white flex items-center justify-center font-bold text-sm shadow-sm shrink-0">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-[#180200]">
                      Membership List
                    </h2>
                    <p className="text-xs text-[#863221]">
                      Search and select an existing member to auto-fill into receipt form
                    </p>
                  </div>
                </div>

                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[#510601]/10 text-[#510601] border border-[#510601]/20 shrink-0">
                  {totalRightMembers} Members
                </span>
              </div>

              {/* Search Box */}
              <div className="p-3.5 sm:p-4 border-b border-[#E8DFD8] bg-[#FAF7F2]/40">
                <div className="relative w-full">
                  <Search className="w-4 h-4 text-[#863221]/60 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={rightSearchQuery}
                    onChange={(e) => {
                      setRightSearchQuery(e.target.value);
                      setRightPage(1);
                    }}

                    className="w-full pl-9 pr-9 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs sm:text-sm text-[#180200] placeholder-[#863221]/40 focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] transition-colors"
                  />
                  {rightSearchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setRightSearchQuery('');
                        setRightPage(1);
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 p-1 cursor-pointer"
                      title="Clear search"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Membership List Table */}
              <div className="overflow-x-auto min-h-[300px]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#E8DFD8] bg-[#FAF7F2] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
                      <th className="py-3 px-3.5 whitespace-nowrap">Membership No. & Name</th>
                      <th className="py-3 px-3.5 whitespace-nowrap">Contact Number</th>
                      <th className="py-3 px-3.5 whitespace-nowrap">District / Location</th>
                      <th className="py-3 px-3.5 text-right whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8DFD8]">
                    {paginatedRightMembers.length === 0 ? (
                      <tr>
                        <td colSpan="4" className="py-12 text-center text-[#863221]">
                          <div className="w-10 h-10 rounded-2xl bg-[#510601]/5 text-[#510601] flex items-center justify-center mx-auto mb-2 border border-[#510601]/10">
                            <Users className="w-5 h-5 opacity-60" />
                          </div>
                          <p className="font-semibold text-sm text-[#180200]">No members found</p>
                          <p className="text-xs text-[#863221] mt-0.5">
                            {rightSearchQuery ? 'Try adjusting your search criteria.' : 'No members registered yet in the Membership List.'}
                          </p>
                        </td>
                      </tr>
                    ) : (
                      paginatedRightMembers.map((member) => {
                        const pinLookup = member.postalCode ? lookupLocationByPin(member.postalCode) : null;
                        const districtText = member.districtName || member.district || (pinLookup?.found ? pinLookup.districtName : '') || '—';
                        const locParts = [
                          member.locality || member.talukName || member.taluk || member.place || (pinLookup?.found ? pinLookup.talukName : ''),
                          member.postalCode || member.pinCode ? `(${member.postalCode || member.pinCode})` : ''
                        ].filter(Boolean).join(' ');

                        return (
                          <tr
                            key={member.id || member.registrationNumber || member.membershipNumber}
                            className="transition-colors hover:bg-[#FAF7F2]/60"
                          >
                            {/* 1. Membership No. & Name */}
                            <td className="py-3 px-3.5">
                              <div className="flex items-center gap-2">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#510601]/10 text-[#510601] border border-[#510601]/20 shrink-0">
                                  #{member.membershipNumber || member.registrationNumber || member.id || '—'}
                                </span>
                                <span className="font-bold text-[#180200] text-xs sm:text-sm whitespace-nowrap">
                                  {member.fullName || member.name}
                                </span>
                              </div>
                              <div className="text-[11px] text-[#863221] mt-0.5 truncate max-w-[200px]">
                                {member.membershipType || member.membershipTypeCategory || 'Standard'} {member.gothra || member.gotra ? `• Gotra: ${member.gothra || member.gotra}` : ''}
                              </div>
                            </td>

                            {/* 2. Contact Number */}
                            <td className="py-3 px-3.5 whitespace-nowrap">
                              <div className="flex items-center gap-1.5 font-mono font-medium text-xs text-[#180200]">
                                <Phone className="w-3 h-3 text-[#863221]/70 shrink-0" />
                                <span>{member.contactNumber || member.mobile || member.mobileNumber || member.phone || '—'}</span>
                              </div>
                            </td>

                            {/* 3. District / Location */}
                            <td className="py-3 px-3.5 text-xs text-[#863221]">
                              <div className="font-bold text-[#180200] text-xs whitespace-nowrap">{districtText}</div>
                              {locParts && (
                                <div className="text-[11px] text-[#863221]/80 mt-0.5 truncate max-w-[180px]">
                                  {locParts}
                                </div>
                              )}
                            </td>

                            {/* 4. Actions: Single "Assign to Receipt" Button */}
                            <td className="py-3 px-3.5 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleAssignFromMembership(member)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer bg-[#FAF7F2] hover:bg-[#F1E7DE] text-[#510601] border-[#E8DFD8]"
                                title="Assign this member's details into the receipt form"
                              >
                                <FileText className="w-3.5 h-3.5 shrink-0" />
                                <span>Assign to Receipt</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Footer */}
              {totalRightMembers > 0 && (
                <div className="p-3.5 bg-[#FAF7F2]/40 border-t border-[#E8DFD8] text-xs text-[#863221] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span>Showing</span>
                    <span className="font-bold text-[#180200]">
                      {Math.min((rightPage - 1) * rightPageSize + 1, totalRightMembers)}
                    </span>
                    <span>to</span>
                    <span className="font-bold text-[#180200]">
                      {Math.min(rightPage * rightPageSize, totalRightMembers)}
                    </span>
                    <span>of</span>
                    <span className="font-bold text-[#180200]">{totalRightMembers}</span>
                    <span>members</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span>Rows:</span>
                      <select
                        value={rightPageSize}
                        onChange={(e) => {
                          setRightPageSize(Number(e.target.value));
                          setRightPage(1);
                        }}
                        className="bg-white border border-[#E8DFD8] text-[#180200] text-xs rounded-lg px-2 py-1 font-semibold focus:outline-none focus:border-[#510601]"
                      >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setRightPage((p) => Math.max(1, p - 1))}
                        disabled={rightPage <= 1}
                        className="p-1 rounded-lg border border-[#E8DFD8] bg-white text-[#863221] hover:bg-[#FAF7F2] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        title="Previous Page"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="px-2 font-semibold text-xs text-[#180200]">
                        {rightPage} / {totalRightPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setRightPage((p) => Math.min(totalRightPages, p + 1))}
                        disabled={rightPage >= totalRightPages}
                        className="p-1 rounded-lg border border-[#E8DFD8] bg-white text-[#863221] hover:bg-[#FAF7F2] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        title="Next Page"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

      </div>

      {/* ============================================================ */}
      {/* BOTTOM SECTION: UNAPPROVED MEMBERS TABLE (ONLY UNASSIGNED)   */}
      {/* Visible in 'normal' and 'unapproved-assignment' modes;       */}
      {/* Hidden only in 'membership-assignment' mode                   */}
      {/* ============================================================ */}
      {entrySource !== 'membership-assignment' && (
        <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_16px_-4px_rgba(24,2,0,0.06)] overflow-hidden">
          {/* Table Header */}
          <div className="bg-[#FAF7F2] border-b border-[#E8DFD8] px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-[#180200]">
                  Unapproved Members
                </h3>
                <p className="text-xs text-[#863221]">
                  Unassigned members awaiting receipt assignment
                </p>
              </div>
            </div>

            <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200 self-start sm:self-auto">
              {totalBottomMembers} Unassigned Members
            </span>
          </div>

          {/* Search Filter Bar */}
          <div className="p-4 border-b border-[#E8DFD8] bg-[#FAF7F2]/40">
            <div className="relative w-full max-w-md">
              <Search className="w-4 h-4 text-[#863221]/60 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={unapprovedSearchQuery}
                onChange={(e) => {
                  setUnapprovedSearchQuery(e.target.value);
                  setUnapprovedPage(1);
                }}

                className="w-full pl-9 pr-9 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs sm:text-sm text-[#180200] placeholder-[#863221]/40 focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] transition-colors"
              />
              {unapprovedSearchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setUnapprovedSearchQuery('');
                    setUnapprovedPage(1);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 p-1 cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Table Content */}
          <div className="overflow-x-auto min-h-[200px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E8DFD8] bg-[#FAF7F2] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
                  <th className="py-3.5 px-4 whitespace-nowrap">Applicant Name & Reg No.</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Contact Number</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">District / Location</th>
                  <th className="py-3.5 px-4 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {paginatedBottomMembers.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="py-12 text-center text-[#863221]">
                      <div className="w-12 h-12 rounded-2xl bg-[#510601]/5 text-[#510601] flex items-center justify-center mx-auto mb-2 border border-[#510601]/10">
                        <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                      </div>
                      <p className="font-bold text-sm text-[#180200]">No unassigned members</p>
                      <p className="text-xs text-[#863221] mt-0.5">
                        {unapprovedSearchQuery
                          ? 'No unassigned members matched your search criteria.'
                          : 'All unapproved members have been assigned receipts, or no new registrations are awaiting assignment.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  paginatedBottomMembers.map((member) => {
                    const pinLookup = member.postalCode ? lookupLocationByPin(member.postalCode) : null;
                    const districtText = member.districtName || member.district || (pinLookup?.found ? pinLookup.districtName : '') || '—';
                    const locParts = [
                      member.locality || member.talukName || member.taluk || member.place || (pinLookup?.found ? pinLookup.talukName : ''),
                      member.postalCode || member.pinCode ? `(${member.postalCode || member.pinCode})` : ''
                    ].filter(Boolean).join(' ');

                    return (
                      <tr
                        key={member.id || member.registrationNumber}
                        className="transition-colors hover:bg-[#FAF7F2]/60"
                      >
                        {/* 1. Applicant Name & Reg No */}
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-[#180200] text-xs sm:text-sm">
                            {member.fullName || member.name}
                          </div>
                          <div className="font-mono text-[11px] text-[#510601] mt-0.5">
                            Reg No: #{member.registrationNumber || member.id || '—'}
                          </div>
                        </td>

                        {/* 2. Contact Number */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 font-mono text-xs text-[#180200]">
                            <Phone className="w-3.5 h-3.5 text-[#863221]/70 shrink-0" />
                            <span>{member.contactNumber || member.mobile || member.mobileNumber || member.phone || '—'}</span>
                          </div>
                        </td>

                        {/* 3. District / Location */}
                        <td className="py-3.5 px-4 text-xs text-[#863221]">
                          <div className="font-semibold text-[#180200]">{districtText}</div>
                          {locParts && (
                            <div className="text-[11px] text-[#863221]/80 mt-0.5 truncate max-w-[200px]">
                              {locParts}
                            </div>
                          )}
                        </td>

                        {/* 4. Actions: Assign to Receipt & View */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleAssignFromUnapproved(member)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer bg-[#FAF7F2] hover:bg-[#F1E7DE] text-[#510601] border-[#E8DFD8]"
                              title="Assign to Receipt"
                            >
                              <FileText className="w-3.5 h-3.5 shrink-0" />
                              <span>Assign to Receipt</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setViewingMember(member)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#510601] bg-[#FAF7F2] border border-[#E8DFD8] rounded-lg hover:bg-[#F1E7DE] transition-colors cursor-pointer"
                              title="View full applicant registration profile"
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

          {/* Bottom Pagination */}
          {totalBottomMembers > 0 && (
            <div className="p-4 border-t border-[#E8DFD8] bg-[#FAF7F2]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#863221]">
              <div className="flex items-center gap-1.5">
                <span>Showing</span>
                <span className="font-bold text-[#180200]">
                  {Math.min((unapprovedPage - 1) * unapprovedPageSize + 1, totalBottomMembers)}
                </span>
                <span>to</span>
                <span className="font-bold text-[#180200]">
                  {Math.min(unapprovedPage * unapprovedPageSize, totalBottomMembers)}
                </span>
                <span>of</span>
                <span className="font-bold text-[#180200]">{totalBottomMembers}</span>
                <span>unassigned applications</span>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span>Rows:</span>
                  <select
                    value={unapprovedPageSize}
                    onChange={(e) => {
                      setUnapprovedPageSize(Number(e.target.value));
                      setUnapprovedPage(1);
                    }}
                    className="bg-white border border-[#E8DFD8] text-[#180200] text-xs rounded-lg px-2 py-1 font-semibold focus:outline-none focus:border-[#510601]"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setUnapprovedPage((p) => Math.max(1, p - 1))}
                    disabled={unapprovedPage <= 1}
                    className="p-1 rounded-lg border border-[#E8DFD8] bg-white text-[#863221] hover:bg-[#FAF7F2] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    title="Previous Page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-2 font-semibold text-xs text-[#180200]">
                    {unapprovedPage} / {totalBottomPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setUnapprovedPage((p) => Math.min(totalBottomPages, p + 1))}
                    disabled={unapprovedPage >= totalBottomPages}
                    className="p-1 rounded-lg border border-[#E8DFD8] bg-white text-[#863221] hover:bg-[#FAF7F2] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    title="Next Page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}


      {/* ==================================================== */}
      {/* RENEWALS DUE (from the server)                        */}
      {/* ==================================================== */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm overflow-hidden">
        <div className="p-4 border-b border-[#E8DFD8] bg-[#FAF7F2]/60 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#180200]">Renewals due</h3>
            <p className="text-[11px] text-[#863221]">Members whose membership needs a renewal payment.</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-[#863221]/60 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={renewalSearchQuery}
              onChange={(e) => setRenewalSearchQuery(e.target.value)}

              className="w-full pl-8 pr-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs focus:outline-none focus:border-[#510601]"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-3.5">Reg / Member No.</th>
                <th className="py-3 px-3.5">Name</th>
                <th className="py-3 px-3.5">Membership No.</th>
                <th className="py-3 px-3.5">Membership Type</th>
                <th className="py-3 px-3.5">Contact</th>
                <th className="py-3 px-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8]">
              {filteredRenewals.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[#863221]/70">
                    No renewals are due.
                  </td>
                </tr>
              ) : (
                filteredRenewals.map((r) => (
                  <tr key={r.id} className="hover:bg-[#FAF7F2]/40">
                    <td className="py-3 px-3.5 font-mono text-[#510601]">{r.registrationNumber || '—'}</td>
                    <td className="py-3 px-3.5 font-bold text-[#180200]">{r.name || '—'}</td>
                    <td className="py-3 px-3.5 font-mono">{r.membershipNumber || '—'}</td>
                    <td className="py-3 px-3.5">{r.membershipType || '—'}</td>
                    <td className="py-3 px-3.5 font-mono">{r.contactNumber || '—'}</td>
                    <td className="py-3 px-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleAssignRenewal(r)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer bg-[#FAF7F2] hover:bg-[#F1E7DE] text-[#510601] border-[#E8DFD8]"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Assign to Receipt</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </PermissionGate>
  );
}
