import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import ParticularPicker, { lineKey as particularLineKey } from '../components/ParticularPicker';
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
  Search,
  Eye,
  FileText,
  MapPin,
  Phone,
  Plus,
  Trash2,
} from 'lucide-react';
import Modal from '../components/Modal';
import PermissionGate from '../components/PermissionGate';
import PageTitle from '../components/PageTitle';
import DateInput from '../components/DateInput';
import useAuth from '../hooks/useAuth';
import api from '../api';
import { UnapprovedPopup } from './MemberProfile';
import { notify } from '../utils/notify';
import { apiErrorMessage } from '../utils/apiError';
import { confirmYesNo } from '../utils/dialogs';
import { formatDate, formatDateTime, getTodayISODate } from '../utils/dateUtils';
import { receiptToApiPayload, fetchMemberPage } from '../utils/apiAdapters';
import { formatPaymentModeLabel } from '../utils/displayHelpers';
import {
  loadParticulars,
  loadMembershipTypes,
  loadPaymentModeConfigs,
  loadLocations,
} from '../utils/serverData';
import useRules, { matchesPattern, mobileProblem } from '../hooks/useRules';
import { formatMoney } from '../utils/money';

import ModalFooter from '../components/ModalFooter';
import { memberName } from '../utils/memberName';
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

// What to show for a member's number: the real membership number (given on approval), else their application ID.

const toEntryMember = (m, loc) => {
  const pin = { postalCode: m.pincode || '', area: m.post_office_name || '' }; // the server sends the place with the member
  const reg = m.registration_payment || {};
  const fullName = memberName(m, true);
  const approved = String(m.approval_status).toUpperCase() === 'APPROVED';
  const districtName = m.district_name || '';
  const stateName = m.state_name || '';
  const talukName = m.taluk_name || '';
  const created = m.created_at ? String(m.created_at) : '';
  return {
    id: m.id,
    registrationNumber: String(m.id),
    membershipNumber: m.membership_number || '',
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

// "Other" / "Others" particular (free-text description unless it has sub-types)

export default function ReceiptEntry() {
  const rules = useRules(); // formats and limits from the server
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  // /receipts/edit/:id reuses this screen to correct a saved receipt (and to assign / unassign its member)
  const { id: editParam } = useParams();
  const editId = editParam ? Number(editParam) : null;
  const isEdit = Boolean(editId);
  const [editOriginal, setEditOriginal] = useState(null); // { receipt, allocation } as loaded from the server
  const [dataReady, setDataReady] = useState(false);
  const showToast = (message, type = 'success') => {
    notify(message, type);
  };

  // Master datasets, all from the server
  const [particularsMaster, setParticularsMaster] = useState([]);
  // the two member lists on the right and at the bottom are read from the server one page at a time (rule 10.6)
  const [registeredMembers, setRegisteredMembers] = useState([]); // the page of the Membership List
  const [rightTotal, setRightTotal] = useState(0);
  const [rightPages, setRightPages] = useState(1);
  const [unapprovedMembers, setUnapprovedMembers] = useState([]); // the page of unassigned applicants
  const [bottomTotal, setBottomTotal] = useState(0);
  const [bottomPages, setBottomPages] = useState(1);
  const [listsVersion, setListsVersion] = useState(0); // bumped to read both lists again
  const [rightLoading, setRightLoading] = useState(false);
  const [bottomLoading, setBottomLoading] = useState(false);
  const [selectedMemberReceipts, setSelectedMemberReceipts] = useState([]); // receipts of the member picked
  const [, setMembershipTypes] = useState([]);
  const [paymentModeConfigs, setPaymentModeConfigs] = useState([]);
  const [locations, setLocations] = useState({ states: [], districts: [], taluks: [], postalCodes: [] });
  const [saving, setSaving] = useState(false);
  const saveMode = useRef('new'); // Save stays on this screen, ready for the next receipt

  const lookupLocationByPin = () => ({ found: false }); // members arrive with their place already; no PIN list is needed here

  // Whether the picked member already has a receipt linked (the server's receipt links, read for that one member)
  const findMatchingReceiptForMember = (m) =>
    m && selectedMember && String(m.id) === String(selectedMember.id) ? selectedMemberReceipts[0] || null : null;

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
  const [, setLookupMembershipNo] = useState('');
  const [numberCheck, setNumberCheck] = useState(null); // is the typed receipt number free in its financial year?
  const [, setLookupError] = useState('');
  // "who is this membership number?" answer from the server, shown under the Membership No. box
  const [numberLookup, setNumberLookup] = useState({ status: 'idle', number: '', matches: [] });
  const lookupSeq = useRef(0);
  const [, setMatchedExistingReceipt] = useState(null);

  // Search and pagination state for Right-Side Membership List Table
  const [rightSearchQuery, setRightSearchQuery] = useState('');
  const [typingOrder, setTypingOrder] = useState([]); // the three look-up boxes, most recently typed last
  const [rightSearchOpen, setRightSearchOpen] = useState(false);
  const [rightPage, setRightPage] = useState(1);
  const [rightPageSize, setRightPageSize] = useState(10);

  // Search and pagination state for Bottom Unassigned Members Table
  const [unapprovedSearchQuery, setUnapprovedSearchQuery] = useState('');
  const [unapprovedSearchOpen, setUnapprovedSearchOpen] = useState(false);
  const [viewApplicant, setViewApplicant] = useState(null); // the applicant shown in the read-only popup
  const [unapprovedPage, setUnapprovedPage] = useState(1);
  const [unapprovedPageSize, setUnapprovedPageSize] = useState(10);

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
    description: '',
    isCancelled: false,
    periodFromDate: '',
    periodToDate: '',
    periodFromTime: '',
    periodToTime: ''
  };
  const [formData, setFormData] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});

  // No particular is chosen by default: the person picks one (a new or reset form starts with none)

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
  // "Others" with no sub-types listed keeps a free-text description beside the amount
  const showDescription = Boolean(currentParticularObj?.needsDescription) && !hasActiveSubTypes;

  // More particulars on the same receipt (the paper receipt has many lines)
  const [extraLines, setExtraLines] = useState([]);
  const emptyLine = () => ({ key: Math.random().toString(36).slice(2), particular: '', subType: '', description: '', amount: '' });
  const subIdOf = (particular, subName) => (particular?.subTypes || []).find((st) => st.name === subName)?.id || null; // a sub type is saved by id
  const needsDescriptionFor = (name) => Boolean(particularObj(name)?.needsDescription); // the particular's own tick, not its name
  const particularObj = (name) =>
    particularsMaster.find((p) => (p.name || '').toLowerCase().trim() === (name || '').toLowerCase().trim());
  const activeSubTypesOf = (name) => (particularObj(name)?.subTypes || []).filter((st) => (st.status || 'Active') === 'Active');
  const updateExtraLine = (key, patch) => {
    setExtraLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setFormErrors((prev) => ({ ...prev, extraLines: '' }));
  };
  const handleAddLine = () => {
    if (!formData.particulars) {
      setFormErrors((prev) => ({ ...prev, particulars: 'Please select a particular for the first item.' }));
      return;
    }
    if (!formData.amount || Number(formData.amount) <= 0) {
      setFormErrors((prev) => ({ ...prev, amount: 'Please enter an amount for the first item before adding another.' }));
      return;
    }
    for (const [i, l] of extraLines.entries()) {
      const n = i + 2;
      if (!l.particular) {
        setFormErrors((prev) => ({ ...prev, extraLines: `Line ${n}: please select a particular before adding another item.` }));
        return;
      }
      if (!(Number(l.amount) > 0)) {
        setFormErrors((prev) => ({ ...prev, extraLines: `Line ${n}: please enter an amount before adding another item.` }));
        return;
      }
    }
    setExtraLines((prev) => [...prev, emptyLine()]);
    setFormErrors((prev) => ({ ...prev, extraLines: '' }));
  };
  const receiptTotal = useMemo(
    () => (Number(formData.amount) || 0) + extraLines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0),
    [formData.amount, extraLines]
  );

  // ----------------------------------------------------
  // LOAD EVERYTHING FROM THE SERVER
  // ----------------------------------------------------
  const reloadData = async () => {
    const fail = (what) => (error) => {
      console.error(`Failed to load ${what}.`, error);
      showToast(apiErrorMessage(error, `Failed to load ${what} from the server.`), 'error');
    };
    const loc = await loadLocations({ postalCodes: false }).catch((e) => {
      fail('locations')(e);
      return { states: [], districts: [], taluks: [], postalCodes: [] };
    });
    setLocations(loc);
    await Promise.all([
      loadParticulars().then(setParticularsMaster).catch(fail('particulars')),
      loadMembershipTypes().then(setMembershipTypes).catch(fail('membership types')),
      loadPaymentModeConfigs().then(setPaymentModeConfigs).catch(fail('payment modes')),
    ]);
    setListsVersion((v) => v + 1); // read the two member lists again
  };

  useEffect(() => {
    reloadData().finally(() => setDataReady(true));
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
        setLookupMembershipNo(mem.membershipNumber || '');
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
    // the Membership No. box holds the real membership number only (given on approval); the member id (MID) is
    // not a membership number, so an unapproved member leaves it blank and is linked by id
    const memNo = member.membershipNumber || member.membership_number || '';
    const memType = member.membershipType || member.membershipTypeCategory || '';

    // Only who is paying is filled in: name, membership no. and mobile. The PAN is never filled in (it is typed for
    // each receipt; carrying one over from an earlier receipt put a wrong PAN on later ones). The particulars, amount, payment mode and the rest are what THIS
    // payment is for (a member may give a different donation each time), so they are left to the person
    // entering the receipt. The receipt number and date are never taken from the member.
    setMatchedExistingReceipt(null);
    setSelectedMemberReceipts([]);
    if (member.id != null) {
      api
        .get('/receipts/tracking', { params: { member_ids: member.id, limit: 50 } })
        .then(({ data }) => {
          const rows = data?.data || [];
          setSelectedMemberReceipts(rows);
        })
        .catch(() => {});
    }
    setFormData((prev) => ({
      ...prev,
      panNo: '',
      name: member.fullName || member.name || '',
      membershipNo: memNo,
      mobile: member.mobile || '',
      membershipType: memType,
      membershipTypeId: member.membershipTypeId || ''
    }));
    setFormErrors({});

    // the membership type and its price live on the member's membership record
    if (member.id) {
      api
        .get(`/members/${member.id}/profile`)
        .then(({ data }) => {
          const ms = (data?.memberships || [])[0];
          const realMemNo = ms?.membership_number || data?.personal?.membership_number || '';
          if (realMemNo) {
            setLookupMembershipNo((prev) => prev || realMemNo);
            setFormData((prev) => ({
              ...prev,
              membershipNo: prev.membershipNo || realMemNo,
              membershipType: ms?.type_name_en || prev.membershipType,
              membershipTypeId: ms?.membership_type_id || prev.membershipTypeId
            }));
            setSelectedMember((prev) => (prev && prev.id === member.id ? {
              ...prev,
              membershipNumber: prev.membershipNumber || realMemNo,
              membershipType: ms?.type_name_en || prev.membershipType
            } : prev));
          } else if (ms) {
            setSelectedMember((prev) => (prev && prev.id === member.id ? { ...prev, membershipType: ms.type_name_en || '' } : prev));
            setFormData((prev) => ({
              ...prev,
              membershipType: ms.type_name_en || prev.membershipType,
              membershipTypeId: ms.membership_type_id || prev.membershipTypeId
            }));
          }
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
  // RECEIPT NUMBER / DATE DEFAULTS (financial year 2026-27/0001 series)
  // ----------------------------------------------------
  const [financialYear, setFinancialYear] = useState('');
  const numberTouched = useRef(false); // true once the user typed their own number
  const defaultsSeq = useRef(0);

  // Fetches the default date (last receipt entered, else today) and the next number for a date's financial year.
  // As the receipt number (or its date, which decides the financial year) changes, ask the server whether the
  // number is free, instead of finding out only on save.
  useEffect(() => {
    const number = String(formData.receiptNumber || '').trim();
    const date = formData.receiptDate;
    if (!number || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      setNumberCheck(null);
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(() => {
      api
        .get('/receipts/number-check', { params: { number, date, ...(editId ? { exclude_id: editId } : {}) } })
        .then(({ data }) => alive && setNumberCheck(data))
        .catch(() => alive && setNumberCheck(null));
    }, 450);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [formData.receiptNumber, formData.receiptDate, editId]);

  const loadReceiptDefaults = (date, { keepNumber = false, keepDate = false } = {}) => {
    const seq = (defaultsSeq.current += 1);
    api
      .get('/receipts/next-number', { params: date ? { date } : {} })
      .then(({ data }) => {
        if (seq !== defaultsSeq.current) return;
        setFinancialYear(data.financial_year || '');
        setFormData((prev) => ({
          ...prev,
          receiptDate: keepDate ? prev.receiptDate : data.receipt_date || prev.receiptDate,
          receiptNumber: keepNumber ? prev.receiptNumber : data.receipt_number || prev.receiptNumber,
        }));
      })
      .catch(() => {
        /* the field stays editable; the server still validates on save */
      });
  };

  useEffect(() => {
    if (!isEdit) loadReceiptDefaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------------------------------
  // EDIT MODE: load the saved receipt into this same form
  // ----------------------------------------------------
  useEffect(() => {
    if (!isEdit || !dataReady) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/receipts/tracking', { params: { receipt_id: editId, limit: 1 } });
        const raw = (data?.data || [])[0];
        if (!raw) throw new Error('Receipt not found.');
        if (raw.receipt_status === 'CANCELLED' || raw.payment_status === 'CANCELLED') {
          showToast('Cancelled receipts cannot be edited.', 'error');
          navigate('/dashboard/receipts/tracking');
          return;
        }
        const subsOf = (name) => (particularObj(name)?.subTypes || []).filter((st) => (st.status || 'Active') === 'Active');
        const toLine = (it) => {
          const name = it.particular || '';
          const subs = subsOf(name);
          // the sub type is saved by id (sub_type); an old line that was never matched has it only as description text
          const legacy = it.description && it.description !== name ? it.description : '';
          const picked = it.sub_type || (subs.some((st) => st.name === legacy) ? legacy : '');
          return {
            particular: name,
            subType: picked,
            description: needsDescriptionFor(name) && !subs.length && !it.sub_type ? legacy : '',
            amount: String(it.amount ?? ''),
          };
        };
        const lines = (raw.items || []).map(toLine);
        const first = lines[0] || { particular: titleCase(raw.receipt_type), subType: '', description: '', amount: String(raw.amount ?? '') };
        const mode = raw.bank_account && activePaymentModes.includes(raw.bank_account)
          ? raw.bank_account
          : titleCase(raw.payment_mode);
        const isCash = mode.trim().toLowerCase() === 'cash';
        const detail = {
          receiptNumber: raw.receipt_number || '',
          receiptDate: raw.receipt_date || '',
          name: raw.payer_name || '',
          panNo: raw.payer_pan || '',
          membershipNo: raw.payer_membership_no || '',
          mobile: raw.payer_mobile || '',
          particulars: first.particular,
          donationSubType: first.subType,
          othersDescription: first.description,
          amount: first.amount,
          paymentMode: mode,
          bankAccount: isCash ? '' : raw.bank_account || mode,
          transactionId: raw.transaction_reference || raw.cheque_number || '',
          transactionDate: raw.transaction_date || '',
          description: raw.notes || '',
          periodFromDate: raw.period_from_date || '',
          periodToDate: raw.period_to_date || '',
          periodFromTime: raw.period_from_time || '',
          periodToTime: raw.period_to_time || '',
        };
        if (cancelled) return;
        setFormData((prev) => ({ ...prev, ...detail }));
        setExtraLines(lines.slice(1).map((l) => ({ ...emptyLine(), ...l })));

        // the member this receipt is assigned to (if any)
        let allocation = null;
        if (raw.member_id) {
          const { data: allocs } = await api.get(`/receipts/${editId}/allocations`);
          allocation = (allocs || []).find((a) => a.member_id) || null;
          const { data: m } = await api.get(`/members/${raw.member_id}`);
          if (cancelled) return;
          const mem = toEntryMember(m, locations);
          setEntrySource(m.approval_status === 'APPROVED' ? 'membership-assignment' : 'unapproved-assignment');
          setSelectedMember(mem);
          setLookupMembershipNo(mem.membershipNumber || '');
        }
        setEditOriginal({ receipt: raw, allocation });
      } catch (error) {
        if (!cancelled) {
          showToast(apiErrorMessage(error, 'Could not load that receipt.'), 'error');
          navigate('/dashboard/receipts/tracking');
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, editId, dataReady]);

  // ----------------------------------------------------
  // MEMBERSHIP NUMBER LOOKUP LOGIC (over the members loaded from the server)
  // ----------------------------------------------------
  useEffect(() => {
    const number = String(formData.membershipNo || '').trim();
    if (entrySource !== 'normal' || number.length < 3) {
      setNumberLookup({ status: 'idle', number, matches: [] });
      return undefined;
    }
    setNumberLookup({ status: 'loading', number, matches: [] });
    const seq = (lookupSeq.current += 1);
    const timer = setTimeout(() => {
      api
        .get('/receipts/member-lookup', { params: { number } })
        .then(({ data }) => {
          if (seq === lookupSeq.current) setNumberLookup({ status: 'done', number, exact: data?.exact !== false, matches: data?.matches || [] });
        })
        .catch(() => {
          if (seq === lookupSeq.current) setNumberLookup({ status: 'error', number, matches: [] });
        });
    }, 450);
    return () => clearTimeout(timer);
  }, [formData.membershipNo, entrySource]);

  // a membership number only (the member id and the registration number are not membership numbers): the server finds it
  const findMemberByQuery = async (query) => {
    const clean = String(query || '').trim();
    if (!clean) return null;
    try {
      const { data } = await api.get('/members/lookup', { params: { number: clean } });
      const found = data?.member;
      return found ? { id: found.id, memberId: found.id, fullName: found.name, name: found.name, membershipNumber: found.membership_number || found.member_code || '' } : null;
    } catch {
      return null;
    }
  };

  // ----------------------------------------------------
  // UNASSIGN / CLEAR / SWITCH MEMBER HANDLER
  // ----------------------------------------------------
  const handleResetMember = () => {
    setEntrySource('normal');
    setLookupMembershipNo('');
    clearAutoPopulatedMemberFields();
  };

  // "Use this member" on the lookup card: link the receipt to the member / applicant that was found

  // "ASSIGN TO RECEIPT" FROM BOTTOM UNAPPROVED MEMBERS TABLE (FLOW 1)
  const handleAssignFromUnapproved = (member) => {
    setEntrySource('unapproved-assignment');
    const memNo = member.membershipNumber || member.membership_number || '';
    setLookupMembershipNo(memNo);
    applyMemberToForm(member);
    setLookupError('');
  };

  // "ASSIGN TO RECEIPT" FROM RIGHT-SIDE MEMBERSHIP LIST TABLE (FLOW 2)
  const handleAssignFromMembership = (member) => {
    setEntrySource('membership-assignment');
    const memNo = member.membershipNumber || member.membership_number || '';
    setLookupMembershipNo(memNo);
    applyMemberToForm(member);
    setLookupError('');
  };

  // The particular + sub-type picker (first line)
  const handleParticularsChange = ({ particular: selectedParticular, subType }) => {
    setFormData((prev) => ({
      ...prev,
      particulars: selectedParticular,
      donationSubType: subType || '',
      othersDescription: needsDescriptionFor(selectedParticular) && selectedParticular === prev.particulars ? prev.othersDescription : ''
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
    if (name === 'name' || name === 'mobile' || name === 'membershipNo') {
      setTypingOrder((prev) => [...prev.filter((k) => k !== name), name]);
    }

    if (name === 'amount') {
      const cleaned = value.replace(/\D/g, '');
      setFormData((prev) => ({ ...prev, amount: cleaned }));
    } else if (name === 'panNo') {
      setFormData((prev) => ({ ...prev, panNo: value.toUpperCase() }));
    } else if (name === 'mobile') {
      const cleaned = value.replace(/\D/g, '').slice(0, 10);
      setFormData((prev) => ({ ...prev, mobile: cleaned }));
    } else if (name === 'receiptNumber') {
      numberTouched.current = true;
      setFormData((prev) => ({ ...prev, receiptNumber: value }));
    } else if (name === 'receiptDate') {
      setFormData((prev) => ({ ...prev, receiptDate: value }));
      if (value && value > getTodayISODate()) {
        setFormErrors((prev) => ({ ...prev, receiptDate: 'Receipt Date cannot be in the future.' }));
      } else {
        setFormErrors((prev) => ({ ...prev, receiptDate: '' }));
      }
      // a different financial year has its own series: re-suggest unless the user typed a number
      if (value && value.length === 10 && value <= getTodayISODate()) {
        loadReceiptDefaults(value, { keepNumber: numberTouched.current, keepDate: true });
      }
    } else if (name === 'transactionDate') {
      setFormData((prev) => ({ ...prev, transactionDate: value }));
      if (value && value > getTodayISODate()) {
        setFormErrors((prev) => ({ ...prev, transactionDate: 'Transaction Date cannot be in the future.' }));
      } else {
        setFormErrors((prev) => ({ ...prev, transactionDate: '' }));
      }
    } else if (name === 'membershipNo') {
      setFormData((prev) => ({ ...prev, membershipNo: value }));
      setLookupMembershipNo(value);
      const clean = String(value || '').trim();
      if (!clean) {
        clearAutoPopulatedMemberFields();
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
  // the Membership No. message goes away as soon as the number is changed or the member is assigned
  useEffect(() => {
    setFormErrors((prev) => (prev.membershipNo ? { ...prev, membershipNo: '' } : prev));
  }, [formData.membershipNo, selectedMember]);

  const validateForm = () => {
    const errors = {};

    // 1. Receipt No. (Mandatory & Unique Manual Entry)
    if (!formData.receiptNumber.trim()) {
      errors.receiptNumber = 'Receipt No. is mandatory.';
    } else if (formData.receiptNumber.trim().length > 50) {
      errors.receiptNumber = 'Receipt No. can be at most 50 characters.';
    } else {
    }


    // 2. Receipt Date (Mandatory)
    if (!formData.receiptDate) {
      errors.receiptDate = 'Receipt Date is mandatory. Enter it as DD-MM-YYYY.';
    } else if (formData.receiptDate > getTodayISODate()) {
      errors.receiptDate = 'Receipt Date cannot be in the future.';
    } else if (formData.receiptDate < '2000-01-01') {
      errors.receiptDate = 'Receipt Date looks wrong. Please check the year.';
    }

    // A cancelled (spoiled) paper receipt only needs its number and date.
    if (formData.isCancelled) {
      setFormErrors(errors);
      return Object.keys(errors).length === 0;
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

    // 5. A particular with active sub-types needs one picked (Donation: "Donation Type")
    if (hasActiveSubTypes && !formData.donationSubType) {
      errors.donationSubType =
        formData.particulars === 'Donation' ? 'Please select a Donation Type.' : `Please select the ${formData.particulars} sub-type.`;
    }

    // 6. Others without sub-types: a description is mandatory
    if (Boolean(currentParticularObj?.needsDescription) && !hasActiveSubTypes && !formData.othersDescription.trim()) {
      errors.othersDescription = 'Please specify the description for Others.';
    }

    // 7. Amount (Mandatory, positive integer)
    if (!formData.amount || Number(formData.amount) <= 0) {
      errors.amount = 'Please enter a valid amount greater than 0.';
    } else if (!/^\d+(\.\d{1,2})?$/.test(String(formData.amount).trim())) {
      errors.amount = 'Amount can have at most 2 decimal places.';
    } else if (rules && Number(formData.amount) > rules.amount.max) {
      errors.amount = 'Amount is too large.';
    }

    // 8. Payment Mode
    if (!formData.paymentMode) {
      errors.paymentMode = 'Payment Mode is mandatory.';
    } else {
      // Transaction Id / Date are optional for every payment mode (only the length and future date are checked).
      if (formData.transactionId.trim().length > 150) {
        errors.transactionId = 'Transaction ID can be at most 150 characters.';
      }
      if (formData.transactionDate && formData.transactionDate > getTodayISODate()) {
        errors.transactionDate = 'Transaction Date cannot be in the future.';
      }
    }

    // 9. Mobile (If entered, validate 10 digits)
    if (formData.mobile && mobileProblem(rules, formData.mobile)) {
      errors.mobile = mobileProblem(rules, formData.mobile);
    }

    // Extra particular lines: each needs a particular, an amount, its sub-type / description, and no duplicate line
    const lineKey = (particular, subType) => `${(particular || '').trim().toLowerCase()}::${(subType || '').trim().toLowerCase()}`;
    const seen = new Map();
    seen.set(lineKey(formData.particulars, formData.donationSubType), 1);

    for (const [i, l] of extraLines.entries()) {
      const n = i + 2;
      if (!l.particular || !activeParticulars.some((p) => p.name === l.particular)) {
        errors.extraLines = `Line ${n}: choose a particular.`;
        break;
      }
      if (!(Number(l.amount) > 0)) {
        errors.extraLines = `Line ${n}: enter an amount greater than 0.`;
        break;
      }
      if (activeSubTypesOf(l.particular).length > 0 && !l.subType) {
        errors.extraLines = `Line ${n}: choose the ${l.particular} sub-type.`;
        break;
      }
      if (needsDescriptionFor(l.particular) && activeSubTypesOf(l.particular).length === 0 && !l.description.trim()) {
        errors.extraLines = `Line ${n}: describe the Others amount.`;
        break;
      }
      const k = lineKey(l.particular, l.subType);
      if (seen.has(k)) {
        const firstLine = seen.get(k);
        const nameDisplay = l.subType ? `${l.particular} (${l.subType})` : l.particular;
        errors.extraLines = `Line ${n}: "${nameDisplay}" is already added on Line ${firstLine}. Please combine the amounts into one line.`;
        break;
      }
      seen.set(k, n);
    }

    // 10. PAN (If entered, validate standard format)

    if (formData.panNo && !matchesPattern(formData.panNo, rules?.pan?.pattern)) {
      errors.panNo = 'Enter a valid 10-character PAN (e.g. ABCDE1234F).';
    }

    // 11. Membership No Validation (Only if no member is selected and membershipNo is manually entered)
    if (!selectedMember && formData.membershipNo.trim()) {
      const typed = formData.membershipNo.trim();
      const answered = numberLookup.status === 'done' && numberLookup.number === typed;
      // An unknown number is fine: the receipt is saved unassigned and mapped to a member later.
      if (answered && numberLookup.exact && numberLookup.matches.length > 0) {
        errors.membershipNo = `This number belongs to ${numberLookup.matches[0].name}. Click Assign on that member in the Membership List, or clear the box.`;
      }
    }

    const { periodFromDate: pd1, periodToDate: pd2, periodFromTime: pt1, periodToTime: pt2 } = formData;
    if (pd1 && pd2 && pd2 < pd1) {
      errors.period = 'Period: To Date cannot be before From Date.';
    } else if (pd1 === pd2 && pt1 && pt2 && pt2 < pt1) {
      errors.period = 'Period: To Time cannot be before From Time.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ----------------------------------------------------
  // SUBMIT & SAVE RECEIPT (a server call; route depends on the entry source)
  // ----------------------------------------------------
  const handleSaveReceipt = async (e) => {
    e.preventDefault();
    // Enter inside a field submits the form even when the Save buttons are hidden
    if (!hasPermission(isEdit ? 'receipts.tracking.write' : 'receipts.entry.write')) {
      showToast('You do not have permission to save receipts.', 'error');
      return;
    }

    if (!validateForm()) {
      showToast('Please correct the validation errors before saving.', 'error');
      // take the person to the first field that is in error, so they can see what to fix
      setTimeout(() => document.querySelector('form p[class*="text-[#ED4636]"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
      return;
    }

    if (isEdit) {
      await handleSaveEdit();
      return;
    }

    if (formData.isCancelled) {
      setSaving(true);
      try {
        // everything entered is kept on the cancelled receipt (it is only never mapped to a member)
        const entered = [
          { particular: formData.particulars, particularId: currentParticularObj?.id || null, subParticularId: subIdOf(currentParticularObj, formData.donationSubType), detail: currentParticularObj?.needsDescription && !formData.donationSubType ? formData.othersDescription.trim() : '', amount: Number(formData.amount) },
          ...extraLines.map((l) => ({ particular: l.particular, particularId: particularObj(l.particular)?.id || null, subParticularId: subIdOf(particularObj(l.particular), l.subType), detail: needsDescriptionFor(l.particular) && !l.subType ? l.description.trim() : '', amount: Number(l.amount) })),
        ].filter((l) => l.particular && Number.isFinite(l.amount) && l.amount > 0);
        const isCashCancelled = String(formData.paymentMode || '').trim().toLowerCase() === 'cash';
        const body = receiptToApiPayload({
          receiptNumber: formData.receiptNumber.trim(),
          receiptDate: formData.receiptDate,
          name: formData.name.trim(),
          panNo: formData.panNo.trim(),
          membershipNo: formData.membershipNo.trim(),
          mobile: formData.mobile.trim(),
          particulars: formData.particulars,
          lines: entered,
          paymentMode: formData.paymentMode,
          bankAccount: isCashCancelled ? '' : formData.bankAccount || formData.paymentMode,
          transactionId: isCashCancelled ? '' : formData.transactionId.trim(),
          transactionDate: formData.transactionDate || '',
          paymentReceivedDetails: formData.paymentReceivedDetails.trim(),
          description: formData.description.trim(),
          periodFromDate: formData.periodFromDate,
          periodToDate: formData.periodToDate,
          periodFromTime: formData.periodFromTime,
          periodToTime: formData.periodToTime,
          isCancelled: true,
        }, null);
        if (!entered.length) {
          body.items = [];
          body.gross_amount = 0;
          body.net_amount = 0;
        }
        body.allocations = [];
        const { data } = await api.post('/receipts/', body);
        showToast(`Receipt ${data?.receipt_number || formData.receiptNumber.trim()} saved as Cancelled.`, 'success');
        const keepDate = formData.receiptDate;
        handleClearForm();
        setFormData((prev) => ({ ...prev, receiptDate: keepDate }));
        loadReceiptDefaults(keepDate, { keepDate: true });
        await reloadData();
      } catch (error) {
        if (error.response?.status === 409 && /Receipt number/i.test(error.response?.data?.detail || '')) {
          setFormErrors((prev) => ({ ...prev, receiptNumber: error.response.data.detail }));
        }
        showToast(apiErrorMessage(error, 'Failed to save the cancelled receipt.'), 'error');
      } finally {
        setSaving(false);
      }
      return;
    }


    let targetMember = selectedMember;
    if (!targetMember && formData.membershipNo.trim()) {
      targetMember = await findMemberByQuery(formData.membershipNo);
    }

    const isCash = String(formData.paymentMode || '').trim().toLowerCase() === 'cash';
    const linked = targetMember || null;

    const payload = {
      receiptNumber: formData.receiptNumber.trim(),
      receiptDate: formData.receiptDate,
      name: formData.name.trim(),
      panNo: formData.panNo.trim(),
      membershipNo: formData.membershipNo.trim(),
      mobile: formData.mobile.trim(),
      particulars: formData.particulars,
      donationSubType: hasActiveSubTypes ? formData.donationSubType : '',
      othersDescription: Boolean(currentParticularObj?.needsDescription) && !hasActiveSubTypes ? formData.othersDescription.trim() : '',
      amount: receiptTotal,
      lines: [
        {
          particular: formData.particulars,
          particularId: currentParticularObj?.id || null,
          subParticularId: subIdOf(currentParticularObj, formData.donationSubType),
          // only a description someone typed (a particular ticked "needs a description"); a sub type is saved by id
          detail: currentParticularObj?.needsDescription && !formData.donationSubType ? formData.othersDescription.trim() : '',
          amount: Number(formData.amount),
        },
        ...extraLines.map((l) => ({
          particular: l.particular,
          particularId: particularObj(l.particular)?.id || null,
          subParticularId: subIdOf(particularObj(l.particular), l.subType),
          detail: needsDescriptionFor(l.particular) && !l.subType ? l.description.trim() : '',
          amount: Number(l.amount),
        })),
      ],
      paymentMode: formData.paymentMode,
      bankAccount: isCash ? '' : formData.bankAccount || formData.paymentMode,
      transactionId: isCash ? '' : formData.transactionId.trim(),
      transactionDate: formData.transactionDate || '',
      paymentReceivedDetails: formData.paymentReceivedDetails.trim(),
      description: formData.description.trim(),
      periodFromDate: formData.periodFromDate,
      periodToDate: formData.periodToDate,
      periodFromTime: formData.periodFromTime,
      periodToTime: formData.periodToTime,
      // a payment for someone who already holds a membership number is a renewal
      isRenewal: Boolean(linked && (linked.isRenewal || (linked.membershipNumber && [formData.particulars, ...extraLines.map((l) => l.particular)].some((name) => particularObj(name)?.paysForMembership))))
    };

    setSaving(true);
    try {
      // Same payee + amount + date already on file? Ask before saving a likely repeat.
      try {
        const { data: dup } = await api.get('/receipts/duplicate-check', {
          params: { payer_name: payload.name, net_amount: receiptTotal, date: payload.receiptDate }
        });
        if (dup?.matches?.length) {
          const ok = await confirmYesNo({
            title: 'Looks like a repeat',
            text: `Receipt ${dup.matches.map((m) => m.receipt_number).join(', ')} already has the same name, amount and date. Save this one too?`,
            confirmText: 'Yes, save anyway',
            danger: true
          });
          if (!ok) {
            setSaving(false);
            return;
          }
        }
      } catch (_) {
        /* the check is only a helper; the server still validates on save */
      }
      const { data } = await api.post('/receipts/', receiptToApiPayload(payload, linked));
      const receiptNo = data?.receipt_number || payload.receiptNumber;
      const memberDisplayName = linked ? linked.fullName || linked.name : formData.name;

      // Route Navigation strictly based on entrySource
      if (entrySource === 'unapproved-assignment') {
        showToast(`Receipt ${receiptNo} successfully linked to ${memberDisplayName}'s unapproved profile!`, 'success');
        // go back to the Unapproved Members page only when the role can open it; otherwise stay and start a new receipt
        if (hasPermission('members.unapproved.read')) navigate('/dashboard/membership/unapproved');
        else handleClearForm();
      } else if (entrySource === 'membership-assignment') {
        showToast(`Receipt ${receiptNo} successfully linked to member "${memberDisplayName}"!`, 'success');
        handleClearForm();
        await reloadData();
      } else if (saveMode.current === 'new') {
        showToast(`Receipt ${receiptNo} saved. Ready for the next one.`, 'success');
        // keep the date and payment details for the next receipt of the batch
        const keep = { receiptDate: formData.receiptDate, paymentMode: formData.paymentMode, bankAccount: formData.bankAccount };
        handleClearForm();
        setFormData((prev) => ({ ...prev, ...keep }));
        loadReceiptDefaults(keep.receiptDate, { keepDate: true });
        await reloadData();
      } else {
        showToast(`Receipt ${receiptNo} saved successfully! Navigating to Receipt Tracking...`, 'success');
        navigate('/dashboard/receipts/tracking');
      }
    } catch (error) {
      console.error('Failed to save receipt.', error);
      if (error.response?.status === 409 && /Receipt number/i.test(error.response?.data?.detail || '')) {
        setFormErrors((prev) => ({ ...prev, receiptNumber: error.response.data.detail }));
      }

      showToast(apiErrorMessage(error, 'Failed to save the receipt. Please try again.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Edit mode: save the corrections, then add / move / remove the member link if it changed
  const handleSaveEdit = async () => {
    const isCash = String(formData.paymentMode || '').trim().toLowerCase() === 'cash';
    const linked = selectedMember || null;
    const payload = {
      receiptNumber: formData.receiptNumber.trim(),
      receiptDate: formData.receiptDate,
      name: formData.name.trim(),
      panNo: formData.panNo.trim(),
      membershipNo: formData.membershipNo.trim(),
      mobile: formData.mobile.trim(),
      particulars: formData.particulars,
      amount: receiptTotal,
      lines: [
        {
          particular: formData.particulars,
          particularId: currentParticularObj?.id || null,
          subParticularId: subIdOf(currentParticularObj, formData.donationSubType),
          // only a description someone typed (a particular ticked "needs a description"); a sub type is saved by id
          detail: currentParticularObj?.needsDescription && !formData.donationSubType ? formData.othersDescription.trim() : '',
          amount: Number(formData.amount),
        },
        ...extraLines.map((l) => ({
          particular: l.particular,
          particularId: particularObj(l.particular)?.id || null,
          subParticularId: subIdOf(particularObj(l.particular), l.subType),
          detail: needsDescriptionFor(l.particular) && !l.subType ? l.description.trim() : '',
          amount: Number(l.amount),
        })),
      ],
      paymentMode: formData.paymentMode,
      bankAccount: isCash ? '' : formData.bankAccount || formData.paymentMode,
      transactionId: isCash ? '' : formData.transactionId.trim(),
      transactionDate: formData.transactionDate || '',
      description: formData.description.trim(),
      periodFromDate: formData.periodFromDate,
      periodToDate: formData.periodToDate,
      periodFromTime: formData.periodFromTime,
      periodToTime: formData.periodToTime,
    };
    setSaving(true);
    try {
      const body = receiptToApiPayload(payload, linked);
      const allocated = body.allocations?.[0]?.allocated_amount;
      delete body.allocations;
      delete body.is_renewal; // editing never changes these
      delete body.is_cancelled;
      delete body.source;
      await api.put(`/receipts/${editId}`, body);

      const old = editOriginal?.allocation;
      const newMemberId = linked ? Number(linked.memberId || linked.member_id || linked.id) : null;
      if (old && Number(old.member_id) !== newMemberId) {
        await api.delete(`/receipts/${editId}/allocations/${old.id}`);
      }
      if (newMemberId && (!old || Number(old.member_id) !== newMemberId)) {
        await api.post(`/receipts/${editId}/allocate`, { member_id: newMemberId, allocated_amount: allocated });
      }
      showToast(`Receipt ${payload.receiptNumber} updated.`, 'success');
      navigate('/dashboard/receipts/tracking');
    } catch (error) {
      if (error.response?.status === 409 && /Receipt number/i.test(error.response?.data?.detail || '')) {
        setFormErrors((prev) => ({ ...prev, receiptNumber: error.response.data.detail }));
      }
      showToast(apiErrorMessage(error, 'Failed to update the receipt.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Reset Form (New Entry Mode)
  const handleClearForm = () => {
    setEntrySource('normal');
    setSelectedMember(null);
    setLookupMembershipNo('');
    setLookupError('');
    setFormData({ ...emptyForm });
    setFormErrors({});
    numberTouched.current = false;
    setExtraLines([]);
    loadReceiptDefaults();
  };

  // Reset Form (Edit Mode: restores original loaded receipt values)
  const handleResetEdit = () => {
    if (!editOriginal?.receipt) return;
    const raw = editOriginal.receipt;
    const subsOf = (name) => (particularObj(name)?.subTypes || []).filter((st) => (st.status || 'Active') === 'Active');
    const toLine = (it) => {
      const name = it.particular || '';
      const subs = subsOf(name);
      // the sub type is saved by id (sub_type); an old line that was never matched has it only as description text
      const legacy = it.description && it.description !== name ? it.description : '';
      const picked = it.sub_type || (subs.some((st) => st.name === legacy) ? legacy : '');
      return {
        particular: name,
        subType: picked,
        description: needsDescriptionFor(name) && !subs.length && !it.sub_type ? legacy : '',
        amount: String(it.amount ?? ''),
      };
    };
    const lines = (raw.items || []).map(toLine);
    const first = lines[0] || { particular: titleCase(raw.receipt_type), subType: '', description: '', amount: String(raw.amount ?? '') };
    const mode = raw.bank_account && activePaymentModes.includes(raw.bank_account)
      ? raw.bank_account
      : titleCase(raw.payment_mode);
    const isCash = mode.trim().toLowerCase() === 'cash';
    const detail = {
      receiptNumber: raw.receipt_number || '',
      receiptDate: raw.receipt_date || '',
      name: raw.payer_name || '',
      panNo: raw.payer_pan || '',
      membershipNo: raw.payer_membership_no || '',
      mobile: raw.payer_mobile || '',
      particulars: first.particular,
      donationSubType: first.subType,
      othersDescription: first.description,
      amount: first.amount,
      paymentMode: mode,
      bankAccount: isCash ? '' : raw.bank_account || mode,
      transactionId: raw.transaction_reference || raw.cheque_number || '',
      transactionDate: raw.transaction_date || '',
      description: raw.notes || '',
      periodFromDate: raw.period_from_date || '',
      periodToDate: raw.period_to_date || '',
      periodFromTime: raw.period_from_time || '',
      periodToTime: raw.period_to_time || '',
    };
    setFormData((prev) => ({ ...prev, ...detail }));
    setExtraLines(lines.slice(1).map((l) => ({ ...emptyLine(), ...l })));
    setFormErrors({});
    showToast('Receipt details restored to original values.', 'info');
  };

  // ----------------------------------------------------
  // RIGHT-SIDE MEMBERSHIP LIST FILTER & PAGINATION
  // ----------------------------------------------------
  // what is typed in the Payee Name, Mobile and Membership No. boxes narrows the list, as you type
  const typingFree = entrySource === 'normal';
  // only the box typed in last (that still has enough typed) filters the list; the others are ignored for it
  const numberText = String(formData.membershipNo || '').trim().toLowerCase();
  const nameText = String(formData.name || '').trim().toLowerCase();
  const mobileText = String(formData.mobile || '');
  // Payee Name and Mobile searching is switched off for now (only the Membership No. narrows the list); to bring it back,
  // use  name: nameText.length >= 2, mobile: mobileText.length >= 3
  const usable = { membershipNo: numberText.length >= 1, name: false /* nameText.length >= 2 */, mobile: false /* mobileText.length >= 3 */ };
  const activeBox = typingFree ? [...typingOrder].reverse().find((k) => usable[k]) : undefined;
  const typedNumber = activeBox === 'membershipNo' ? numberText : '';
  const typedName = activeBox === 'name' ? nameText : '';
  const typedMobile = activeBox === 'mobile' ? mobileText : '';
  // the box typed in last decides the Membership List; the search icon above it is used when no box does
  const rightTerm = (typedNumber || typedName || typedMobile || rightSearchQuery).trim();
  const rightIsNumber = Boolean(typedNumber); // the Membership No. box matches a membership number exactly; the search icon searches everything
  const [debouncedRightTerm, setDebouncedRightTerm] = useState('');
  const [debouncedRightIsNumber, setDebouncedRightIsNumber] = useState(false);
  const [debouncedBottomTerm, setDebouncedBottomTerm] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedRightTerm(rightTerm); setDebouncedRightIsNumber(rightIsNumber); }, 350);
    return () => clearTimeout(timer);
  }, [rightTerm, rightIsNumber]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedBottomTerm(unapprovedSearchQuery.trim()), 350);
    return () => clearTimeout(timer);
  }, [unapprovedSearchQuery]);
  useEffect(() => { setRightPage(1); }, [debouncedRightTerm, rightPageSize]);
  useEffect(() => { setUnapprovedPage(1); }, [debouncedBottomTerm, unapprovedPageSize]);

  const rightSeq = useRef(0);
  useEffect(() => {
    if (!locations.districts.length && !dataReady) return;
    const seq = (rightSeq.current += 1);
    setRightLoading(true);
    fetchMemberPage({ approval_status: 'APPROVED', page: rightPage, limit: rightPageSize, ...(debouncedRightTerm ? (debouncedRightIsNumber ? { membership_no: debouncedRightTerm } : { search: debouncedRightTerm }) : {}) })
      .then((res) => {
        if (seq !== rightSeq.current) return;
        setRegisteredMembers(res.rows.map((m) => toEntryMember(m, locations)));
        setRightTotal(res.total);
        setRightPages(Math.max(1, res.pages));
      })
      .catch((error) => showToast(apiErrorMessage(error, 'Failed to load the Membership List from the server.'), 'error'))
      .finally(() => {
        if (seq === rightSeq.current) setRightLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedRightTerm, debouncedRightIsNumber, rightPage, rightPageSize, listsVersion, dataReady]);

  const bottomSeq = useRef(0);
  useEffect(() => {
    if (!locations.districts.length && !dataReady) return;
    const seq = (bottomSeq.current += 1);
    setBottomLoading(true);
    fetchMemberPage({ approval_status: 'UNAPPROVED', receipt_assigned: false, page: unapprovedPage, limit: unapprovedPageSize, ...(debouncedBottomTerm ? { search: debouncedBottomTerm } : {}) })
      .then((res) => {
        if (seq !== bottomSeq.current) return;
        setUnapprovedMembers(res.rows.map((m) => toEntryMember(m, locations)));
        setBottomTotal(res.total);
        setBottomPages(Math.max(1, res.pages));
      })
      .catch((error) => showToast(apiErrorMessage(error, 'Failed to load the unassigned members from the server.'), 'error'))
      .finally(() => {
        if (seq === bottomSeq.current) setBottomLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedBottomTerm, unapprovedPage, unapprovedPageSize, listsVersion, dataReady]);

  const filteredRightMembers = registeredMembers; // the server already searched and paged them
  const totalRightMembers = rightTotal;
  const totalRightPages = rightPages;
  const paginatedRightMembers = registeredMembers;
  const totalBottomMembers = bottomTotal;
  const totalBottomPages = bottomPages;
  const paginatedBottomMembers = unapprovedMembers;

  return (
    <PermissionGate required={isEdit ? 'receipts.tracking.write' : 'receipts.entry.read'}>
    <div className="space-y-6 pb-16 font-sans">

      {/* Member Profile is viewed on dedicated full-screen page /dashboard/membership/profile/:id */}
      {viewApplicant && (
        <UnapprovedPopup
          id={viewApplicant.id}
          s={{ id: viewApplicant.id, approval_status: 'UNAPPROVED', member_code: viewApplicant.membershipNumber || '' }}
          name={viewApplicant.name || viewApplicant.fullName || ''}
          onClose={() => setViewApplicant(null)}
        />
      )}
      {false && viewingMember && (() => {
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
                    <div className="relative w-full max-w-[200px] aspect-[3/4] bg-[#FAF7F2] rounded-lg overflow-hidden border border-[#E8DFD8] shadow-sm flex items-center justify-center">
                      {viewingMember.photoUrl || viewingMember.photo || viewingMember.image || viewingMember.avatar ? (
                        <img
                          src={viewingMember.photoUrl || viewingMember.photo || viewingMember.image || viewingMember.avatar}
                          alt={viewingMember.fullName || viewingMember.name || 'Member Photo'}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-amber-50 to-stone-200 text-[#863221]/50">
                          <User className="w-16 h-16 text-[#863221]/50 mb-2" />
                          <span className="text-[11px] font-medium text-[#863221]/70">No Photo</span>
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
                  <div className="md:col-span-5 space-y-2 text-xs sm:text-[13px] text-[#180200]">
                    <h4 className="text-sm font-bold text-[#863221] uppercase tracking-wide pb-1 border-b border-[#E8DFD8] mb-3">
                      BASIC INFORMATION
                    </h4>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-[#863221] shrink-0">Name:</span>
                      <span className="text-[#180200] font-semibold">{viewingMember.fullName || viewingMember.name || '—'}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-[#863221] shrink-0">Registration Number:</span>
                      <span className="text-[#180200] font-mono">{viewingMember.registrationNumber || viewingMember.id || '—'}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-[#863221] shrink-0">Registration Date:</span>
                      <span className="text-[#180200] font-mono">{formattedRegDate}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-[#863221] shrink-0">Membership Number:</span>
                      <span className="text-[#180200] font-mono">{viewingMember.membershipNumber || 'Not assigned'}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-[#863221] shrink-0">Membership Name:</span>
                      <span className="text-[#180200]">{viewingMember.membershipName || viewingMember.fullName || viewingMember.name || '—'}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-[#863221] shrink-0">Mobile:</span>
                      <span className="text-[#180200] font-mono">{viewingMember.contactNumber || viewingMember.mobile || viewingMember.phone || '—'}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-[#863221] shrink-0">Father Name:</span>
                      <span className="text-[#180200]">{viewingMember.fatherHusbandName || viewingMember.fatherName || viewingMember.guardianName || '—'}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-[#863221] shrink-0">Gender:</span>
                      <span className="text-[#180200]">{viewingMember.gender || '—'}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-[#863221] shrink-0">Date Of Birth:</span>
                      <span className="text-[#180200] font-mono">{formattedDob}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-[#863221] shrink-0">Height:</span>
                      <span className="text-[#180200]">{viewingMember.height || '—'}</span>
                    </div>

                    <div className="flex items-baseline gap-1.5 leading-snug">
                      <span className="font-bold text-[#863221] shrink-0">Expiry Date:</span>
                      <span className="text-[#180200] font-mono">{formattedExpDate}</span>
                    </div>
                  </div>

                  {/* Column 3: PAYMENT INFORMATION & RECIEPT INFORMATION */}
                  <div className="md:col-span-4 space-y-6 text-xs sm:text-[13px]">

                    {/* Payment Information */}
                    <div className="space-y-2">
                      <h4 className="text-sm font-bold text-[#863221] uppercase tracking-wide pb-1 border-b border-[#E8DFD8] mb-3">
                        PAYMENT INFORMATION
                      </h4>

                      <div className="flex items-baseline gap-1.5 leading-snug">
                        <span className="font-bold text-[#863221] shrink-0">Cash Receipt/Cheque/DD No:</span>
                        <span className="text-[#EA4335] font-bold font-mono">{receiptNo}</span>
                      </div>

                      <div className="flex items-baseline gap-1.5 leading-snug">
                        <span className="font-bold text-[#863221] shrink-0">Date:</span>
                        <span className="text-[#EA4335] font-bold font-mono">{receiptDate}</span>
                      </div>

                      <div className="flex items-baseline gap-1.5 leading-snug">
                        <span className="font-bold text-[#863221] shrink-0">Cash Amount:</span>
                        <span className="text-[#EA4335] font-bold font-mono">{amountVal}</span>
                      </div>

                      <div className="flex items-baseline gap-1.5 leading-snug">
                        <span className="font-bold text-[#863221] shrink-0">Payment Description:</span>
                        <span className="text-[#EA4335] font-bold">{paymentDesc}</span>
                      </div>
                    </div>

                    {/* Receipt Information */}
                    <div className="space-y-2">
                      <h4 className="text-sm font-bold text-[#863221] uppercase tracking-wide pb-1 border-b border-[#E8DFD8] mb-3">
                        RECIEPT INFORMATION
                      </h4>

                      <div className="flex items-baseline gap-1.5 leading-snug">
                        <span className="font-bold text-[#863221] shrink-0">Cash Receipt Number:</span>
                        <span className="text-[#EA4335] font-bold font-mono">{receiptNo}</span>
                      </div>

                      <div className="flex items-baseline gap-1.5 leading-snug">
                        <span className="font-bold text-[#863221] shrink-0">Cash Date:</span>
                        <span className="text-[#EA4335] font-bold font-mono">{receiptDate}</span>
                      </div>

                      <div className="flex items-baseline gap-1.5 leading-snug">
                        <span className="font-bold text-[#863221] shrink-0">Cash Amount:</span>
                        <span className="text-[#EA4335] font-bold font-mono">{amountVal}</span>
                      </div>

                      <div className="flex items-baseline gap-1.5 leading-snug">
                        <span className="font-bold text-[#863221] shrink-0">Payment Description:</span>
                        <span className="text-[#EA4335] font-bold">{matchedReceipt?.description || viewingMember.paymentRemarks || viewingMember.description || '-'}</span>
                      </div>
                    </div>

                  </div>

                </div>
              </div>

              {/* Read-only footer */}
              <ModalFooter kind="view" onCancel={() => setViewingMember(null)} inForm />
            </div>
          );
        })()}


      {/* ------------------------------------------------------------ */}
      {/* PAGE HEADER                                    */}
      {/* ------------------------------------------------------------ */}
      {/* the title sits in the top bar, so the form starts at the top of the page */}
      <PageTitle>
        <h1 className="truncate text-lg sm:text-xl font-bold text-[#180200] tracking-tight">
          {isEdit ? `Edit Receipt${formData.receiptNumber ? ` ${formData.receiptNumber}` : ''}` : 'Receipt Entry'}
        </h1>
      </PageTitle>

      {/* ------------------------------------------------------------ */}
      {/* MAIN TWO-COLUMN SPLIT VIEW: FORM ON LEFT, MEMBER LIST / DETAILS ON RIGHT */}
      {/* ------------------------------------------------------------ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">

        {/* ------------------------------------------------------------ */}
        {/* LEFT COLUMN: RECEIPT ENTRY FORM (6 cols, 50%)                */}
        {/* ------------------------------------------------------------ */}
        <div className="col-span-12 lg:col-span-6">
          <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_16px_-4px_rgba(24,2,0,0.06)] overflow-hidden">

            {/* Form Fields */}
            <form
              onSubmit={handleSaveReceipt}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                  e.preventDefault();
                  saveMode.current = 'new';
                  e.currentTarget.requestSubmit();
                  return;
                }
                const t = e.target;
                if (e.key === 'Enter' && t.tagName === 'INPUT' && t.type !== 'submit' && t.type !== 'checkbox') {
                  e.preventDefault();
                  const fields = [...e.currentTarget.querySelectorAll('input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])')];
                  const next = fields[fields.indexOf(t) + 1];
                  if (next) next.focus();
                }
              }}
              className="p-4 sm:p-5 space-y-3.5"
            >

              {/* the assigned member's details show in the Member Details panel on the right (same as for an unapproved applicant) */}

              <div className="space-y-3">

                {/* Row 1: Receipt No & Receipt Date */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* 1. Receipt No (Manual Entry) */}
                  <div>
                    <label className="block text-xs font-bold text-[#180200] mb-1">
                      Receipt No. <span className="text-[#ED4636]">*</span>
                      {financialYear && <span className="ml-1 font-normal text-[#863221]">(FY {financialYear})</span>}
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
                    {!formErrors.receiptNumber && numberCheck && numberCheck.number === String(formData.receiptNumber || '').trim() && (
                      numberCheck.available ? (
                        // an available number in the usual format shows nothing; only a problem is shown
                        numberCheck.matches_format ? null : (
                          <p className="text-[11px] text-amber-700 mt-1 font-medium">
                            Available, but not like the usual format (for example {numberCheck.example}). You can still save it.
                          </p>
                        )
                      ) : (
                        <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          {numberCheck.existing?.in_recycle_bin ? (
                            <>{numberCheck.number} belongs to a deleted receipt in the Recycle Bin (FY {numberCheck.financial_year}). Restore it or delete it permanently first.</>
                          ) : (
                            <>
                              {numberCheck.number} already exists in FY {numberCheck.financial_year}
                              {numberCheck.existing?.payer_name ? ` (${numberCheck.existing.payer_name}` : ''}
                              {numberCheck.existing?.receipt_date ? `, ${formatDate(numberCheck.existing.receipt_date)})` : numberCheck.existing?.payer_name ? ')' : ''}
                            </>
                          )}
                        </p>
                      )
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
                      max={getTodayISODate()}
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

                {/* Row 3: Membership No */}
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

                      className={`w-full px-3 py-2 bg-[#FAF7F2] border focus:ring-1 focus:bg-white rounded-xl text-xs sm:text-sm font-mono text-[#180200] placeholder-[#863221]/30 focus:outline-none transition-colors ${formErrors.membershipNo
                        ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 focus:border-[#ED4636] focus:ring-[#ED4636]'
                        : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-[#510601]'}`}
                    />
                    {formErrors.membershipNo && (
                      <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-start gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                        {formErrors.membershipNo}
                      </p>
                    )}
                  </div>
                  {/* what the typing found: a short note in the free half of this row */}
                  {(typedNumber || typedName || typedMobile) && (
                    <div className={`self-end rounded-xl border px-3 py-2 text-xs min-h-[38px] flex items-center ${totalRightMembers === 1 ? 'border-emerald-300 bg-emerald-50' : 'border-[#E8DFD8] bg-[#FAF7F2]'}`}>
                      {totalRightMembers === 0 ? (
                        <span className="text-[#863221]">No member matches. This will be saved as a non-member receipt.</span>
                      ) : totalRightMembers === 1 ? (
                        (() => {
                          const m = filteredRightMembers[0];
                          return (
                            <div className="flex w-full items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate font-bold text-emerald-900">{m.fullName || m.name} <span className="font-mono font-semibold text-emerald-800">{m.membershipNumber || ''}</span></p>
                                <p className="truncate text-[11px] text-emerald-800">{[m.membershipType, m.districtName || m.district, m.mobile].filter(Boolean).join(' · ')}</p>
                              </div>
                              <button type="button" onClick={() => handleAssignFromMembership(m)} className="shrink-0 rounded-lg border border-emerald-600 bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 cursor-pointer">Assign</button>
                            </div>
                          );
                        })()
                      ) : (
                        <span className="text-[#863221]"><b className="text-[#180200]">{totalRightMembers}</b> members match. Pick one from the Membership List.</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Row 4: Particulars (with sub-type), Amount & Multi-Line Items */}
                <div className="space-y-3">
                  <div className="relative grid grid-cols-12 gap-3 items-end">
                    {/* Particulars + Sub-Type in one picker */}
                    <div className={`col-span-12 ${showDescription ? 'sm:col-span-5' : 'sm:col-span-7'}`}>
                      <label className="block text-xs font-bold text-[#180200] mb-1">
                        Particulars <span className="text-[#ED4636]">*</span>
                      </label>
                      <ParticularPicker
                        particulars={activeParticulars}
                        particular={formData.particulars}
                        subType={formData.donationSubType}
                        onChange={handleParticularsChange}
                        spread
                        taken={extraLines.filter((x) => x.particular).map((x) => particularLineKey(x.particular, x.subType))}
                        hasError={Boolean(formErrors.particulars || formErrors.donationSubType)}
                      />
                      {(formErrors.particulars || formErrors.donationSubType) && (
                        <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          {formErrors.particulars || formErrors.donationSubType}
                        </p>
                      )}
                    </div>

                    {/* Description (Others without sub-types) */}
                    {showDescription && (
                      <div className="col-span-12 sm:col-span-4">
                        <label className="block text-xs font-bold text-[#180200] mb-1">
                          Description <span className="text-[#ED4636]">*</span>
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
                    )}

                    {/* Amount */}
                    <div className={`col-span-12 ${showDescription ? 'sm:col-span-2' : 'sm:col-span-4'}`}>
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
                    </div>

                    {/* Add another item: a plus at the right end of the first line */}
                    <div className="col-span-12 sm:col-span-1 flex items-center justify-end pb-0.5">
                      <button
                        type="button"
                        onClick={handleAddLine}
                        title="Add another item"
                        aria-label="Add another item"
                        className="p-2 rounded-xl text-[#510601] bg-[#FAF1EE] border border-[#E8DFD8] hover:bg-[#510601] hover:text-white transition-colors cursor-pointer shadow-sm"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Extra Lines if any */}
                  {extraLines.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-dashed border-[#E8DFD8]">
                      {extraLines.map((l, index) => {
                        const subs = activeSubTypesOf(l.particular);
                        const needsDescription = needsDescriptionFor(l.particular) && subs.length === 0;
                        return (
                          <div key={l.key} className="relative grid grid-cols-12 gap-3 items-end">
                            <div className={`col-span-12 ${needsDescription ? 'sm:col-span-5' : 'sm:col-span-7'}`}>
                              <ParticularPicker
                                particulars={activeParticulars}
                                particular={l.particular}
                                subType={l.subType}
                                spread
                                taken={[
                                  ...(formData.particulars ? [particularLineKey(formData.particulars, formData.donationSubType)] : []),
                                  ...extraLines.filter((x) => x.key !== l.key && x.particular).map((x) => particularLineKey(x.particular, x.subType))
                                ]}
                                onChange={({ particular, subType }) =>
                                  updateExtraLine(l.key, { particular, subType, description: particular === l.particular ? l.description : '' })
                                }
                              />
                            </div>
                            {needsDescription && (
                              <div className="col-span-12 sm:col-span-4">
                                <input
                                  type="text"
                                  placeholder="Description"
                                  value={l.description}
                                  onChange={(e) => updateExtraLine(l.key, { description: e.target.value })}
                                  className="w-full px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs sm:text-sm text-[#180200] focus:outline-none focus:bg-white focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
                                />
                              </div>
                            )}
                            <div className={`col-span-9 ${needsDescription ? 'sm:col-span-2' : 'sm:col-span-4'}`}>
                              <div className="relative">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-[#863221]/70">₹</span>
                                <input
                                  type="text"
                                  value={l.amount}
                                  onChange={(e) => updateExtraLine(l.key, { amount: e.target.value.replace(/\D/g, '') })}
                                  className="w-full pl-7 pr-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs sm:text-sm font-mono font-bold text-[#180200] focus:outline-none focus:bg-white focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
                                />
                              </div>
                            </div>
                            <div className="col-span-3 sm:col-span-1 flex items-center justify-end pb-1">
                              <button
                                type="button"
                                title="Remove this line"
                                onClick={() => setExtraLines((prev) => prev.filter((x) => x.key !== l.key))}
                                className="p-2 rounded-lg text-[#ED4636] hover:bg-red-50 cursor-pointer transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {extraLines.length > 0 && (
                    <p className="text-right text-[11px] font-semibold text-[#863221]">
                      {extraLines.length + 1} items total
                    </p>
                  )}

                  {formErrors.extraLines && (
                    <p className="text-[11px] text-[#ED4636] font-medium flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      {formErrors.extraLines}
                    </p>
                  )}
                </div>

                {/* Row 5: Payment Mode, Transaction ID & Transaction Date */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Payment Mode */}
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

                  {/* Transaction Id */}
                  <div>
                    <label className="block text-xs font-bold text-[#180200] mb-1">
                      Transaction Id
                    </label>
                    <input
                      type="text"
                      name="transactionId"
                      value={formData.transactionId}
                      onChange={handleInputChange}
                      disabled={!formData.paymentMode || formData.paymentMode.toLowerCase() === 'cash'}
                      
                      className={`w-full px-3 py-2 rounded-xl text-xs sm:text-sm font-mono text-[#180200] focus:outline-none focus:bg-white transition-colors ${!formData.paymentMode || formData.paymentMode.toLowerCase() === 'cash'
                        ? 'bg-[#FAF7F2]/50 text-[#863221]/50 cursor-not-allowed border border-[#E8DFD8]/80'
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

                  {/* Transaction Date */}
                  <div>
                    <label className="block text-xs font-bold text-[#180200] mb-1">
                      Transaction Date
                    </label>
                    <DateInput
                      name="transactionDate"
                      value={formData.transactionDate}
                      max={getTodayISODate()}
                      onChange={handleInputChange}
                      className={`w-full px-3 py-2 bg-[#FAF7F2] border rounded-xl text-xs sm:text-sm text-[#180200] focus:outline-none focus:bg-white transition-colors ${formErrors.transactionDate
                        ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30'
                        : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                        }`}
                    />
                    {formErrors.transactionDate && (
                      <p className="text-[11px] text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        {formErrors.transactionDate}
                      </p>
                    )}
                  </div>
                </div>

                {/* Row 6: PAN & Payment Received Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* PAN */}
                  <div>
                    <label className="block text-xs font-bold text-[#180200] mb-1">
                      PAN <span className="font-normal text-[#863221]/70">(optional)</span>
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
                </div>

                {/* Row 7: Description & Grand Total Amount */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-stretch">
                  <div className="flex flex-col">
                    <label className="block text-xs font-bold text-[#180200] mb-1">
                      Description
                    </label>
                    <textarea
                      rows={3}
                      name="description"
                      value={formData.description}
                      onChange={handleInputChange}
                      className="w-full flex-1 min-h-[96px] px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] focus:bg-white rounded-xl text-xs sm:text-sm text-[#180200] placeholder-[#863221]/30 focus:outline-none transition-colors resize-y"
                    />
                  </div>

                  {/* Grand total card: starts level with the Description box (an invisible label takes the label's height) */}
                  <div className="flex flex-col">
                  <span className="block text-xs font-bold mb-1 invisible select-none" aria-hidden="true">Total</span>
                  <div className="flex-1 min-h-[96px] bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl px-3 py-2 flex flex-col justify-center items-center text-center">
                    <div className="text-[10px] sm:text-xs font-bold text-[#510601] uppercase tracking-wider mb-1">
                      GRAND TOTAL AMOUNT
                    </div>
                    <div className="text-xl sm:text-2xl font-extrabold text-[#180200] font-mono tracking-tight">
                      {formatMoney(receiptTotal)}
                    </div>
                    <div className="text-[11px] font-medium text-[#863221] italic mt-1 truncate max-w-full" title={receiptTotal > 0 ? numberToWords(receiptTotal) : 'Zero Rupees Only'}>
                      {receiptTotal > 0 ? numberToWords(receiptTotal) : 'Zero Rupees Only'}
                    </div>
                  </div>
                  </div>
                </div>

                {/* Row 8: Period (optional) - From Date, To Date, From Time, To Time */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    ['periodFromDate', 'From Date', 'date'],
                    ['periodToDate', 'To Date', 'date'],
                    ['periodFromTime', 'From Time', 'time'],
                    ['periodToTime', 'To Time', 'time']
                  ].map(([name, label, type]) => (
                    <div key={name}>
                      <label className="block text-xs font-bold text-[#180200] mb-1">{label}</label>
                      <input
                        type={type}
                        name={name}
                        value={formData[name]}
                        min={name === 'periodToDate' && formData.periodFromDate ? formData.periodFromDate : undefined}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] focus:bg-white rounded-xl text-xs sm:text-sm text-[#180200] focus:outline-none transition-colors"
                      />
                    </div>
                  ))}
                  {formErrors.period && <p className="col-span-full text-[11px] text-red-600">{formErrors.period}</p>}
                </div>

              </div>

              {/* Action Buttons (Reset, Save & Close, Save & New) */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-[#E8DFD8]">
                {!isEdit ? (
                  <label className="flex items-center gap-2 text-xs font-semibold text-[#863221] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={formData.isCancelled}
                      onChange={(e) => setFormData((prev) => ({ ...prev, isCancelled: e.target.checked }))}
                      className="w-4 h-4 accent-[#510601] cursor-pointer"
                    />
                    Cancelled Receipt
                  </label>
                ) : <div />}

                <div className="flex items-center gap-2">
                  {isEdit ? (
                    <>
                      {/* Reset icon only (no text) */}
                      <button
                        type="button"
                        onClick={handleResetEdit}
                        title="Reset to original receipt details"
                        aria-label="Reset changes"
                        className="p-2 sm:px-2.5 sm:py-2 rounded-xl border border-[#E8DFD8] hover:border-[#863221] bg-white text-[#863221] hover:bg-[#FAF7F2] transition-colors cursor-pointer inline-flex items-center justify-center shadow-2xs"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>

                      {/* Cancel button */}
                      <button
                        type="button"
                        onClick={() => navigate('/dashboard/receipts/tracking')}
                        className="px-3.5 py-2 rounded-xl border border-[#E8DFD8] hover:border-[#863221] bg-white text-[#863221] text-xs sm:text-sm font-semibold hover:bg-[#FAF7F2] transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-2xs"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Cancel</span>
                      </button>

                      {/* Update button */}
                      {hasPermission('receipts.tracking.write') && (
                        <button
                          type="submit"
                          onClick={() => { saveMode.current = 'close'; }}
                          disabled={saving || !editOriginal}
                          className="disabled:opacity-50 px-5 py-2 rounded-xl bg-[#510601] hover:bg-[#680801] text-white text-xs sm:text-sm font-bold shadow-2xs hover:shadow transition-all cursor-pointer inline-flex items-center gap-1.5"
                        >
                          <Save className="w-3.5 h-3.5 text-white" />
                          <span>Update</span>
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      {/* Reset icon only (no text) */}
                      <button
                        type="button"
                        onClick={handleClearForm}
                        title="Reset the form"
                        aria-label="Reset the form"
                        className="p-2 sm:px-2.5 sm:py-2 rounded-xl border border-[#E8DFD8] hover:border-[#863221] bg-white text-[#863221] hover:bg-[#FAF7F2] transition-colors cursor-pointer inline-flex items-center justify-center shadow-2xs"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>

                      {hasPermission('receipts.entry.write') && (
                        <>
                          <button
                            type="submit"
                            onClick={() => { saveMode.current = 'close'; }}
                            disabled={saving}
                            className="disabled:opacity-50 px-3.5 py-2 rounded-xl bg-white hover:bg-[#FAF7F2] border border-[#E8DFD8] text-[#180200] text-xs sm:text-sm font-semibold transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-2xs"
                          >
                            <Save className="w-3.5 h-3.5 text-[#863221]" />
                            <span>Save & Close</span>
                          </button>

                          <button
                            type="submit"
                            onClick={() => { saveMode.current = 'new'; }}
                            disabled={saving}
                            className="disabled:opacity-50 px-4 py-2 rounded-xl bg-[#510601] hover:bg-[#680801] text-white text-xs sm:text-sm font-bold shadow-2xs hover:shadow transition-all cursor-pointer inline-flex items-center gap-1.5"
                          >
                            <Save className="w-3.5 h-3.5 text-white" />
                            <span>Save & New</span>
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>

            </form>
          </div>
        </div>

        {/* ------------------------------------------------------------ */}
        {/* RIGHT COLUMN: CONDITIONAL ACCORDING TO ENTRY SOURCE (6 cols, 50%) */}
        {/* - Flow 1 (unapproved-assignment): Show Member Details Panel  */}
        {/* - Flow 2 (membership-assignment) & Flow 3 (normal): Show Membership List Table */}
        {/* ------------------------------------------------------------ */}
        <div className="col-span-12 lg:col-span-6 w-full space-y-4">

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
                      {selectedMember.fullName || selectedMember.name}
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
                  <div className="bg-[#FAF7F2] p-3.5 rounded-xl border border-[#E8DFD8] text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <span className="text-[#863221] font-semibold block">Full Address:</span>
                        <p className="text-[#180200] mt-0.5 leading-relaxed break-words">
                          {enrichedMember?.address || '—'}
                        </p>
                      </div>
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

              </div>
            </div>
          ) : (
            /* ========================================================== */
            /* FLOW 2 & FLOW 3 STATE: RIGHT-SIDE MEMBERSHIP LIST TABLE   */
            /* ========================================================== */
            <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_16px_-4px_rgba(24,2,0,0.06)] overflow-hidden">
              {/* Header */}
              <div className="bg-[#FAF7F2] border-b border-[#E8DFD8] px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="w-9 h-9 rounded-xl bg-[#510601] text-white flex items-center justify-center font-bold text-sm shadow-sm shrink-0">
                    <Users className="w-4 h-4" />
                  </div>
                  {!rightSearchOpen && (
                    <h2 className="text-sm sm:text-base font-bold text-[#180200]">
                      Membership List
                    </h2>
                  )}
                </div>

                {rightSearchOpen ? (
                  <div className="relative flex-1 min-w-0">
                    <Search className="w-4 h-4 text-[#863221]/60 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      autoFocus
                      value={rightSearchQuery}
                      onChange={(e) => {
                        setRightSearchQuery(e.target.value);
                        setRightPage(1);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setRightSearchQuery('');
                          setRightPage(1);
                          setRightSearchOpen(false);
                        }
                      }}
                      className="w-full pl-9 pr-9 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs sm:text-sm text-[#180200] placeholder-[#863221]/40 focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setRightSearchQuery('');
                        setRightPage(1);
                        setRightSearchOpen(false);
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#863221]/50 hover:text-[#863221] p-1 cursor-pointer"
                      title="Close search"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setRightSearchOpen(true)}
                      className="w-8 h-8 rounded-xl bg-white border border-[#E8DFD8] text-[#863221] hover:bg-[#FAF7F2] flex items-center justify-center cursor-pointer"
                      title="Search"
                    >
                      <Search className="w-4 h-4" />
                    </button>
                    {/* refresh the list: clears right search and unconstrains the list to show all members without clearing form inputs */}
                    <button
                      type="button"
                      disabled={rightLoading}
                      onClick={() => {
                        setRightSearchQuery('');
                        setTypingOrder([]);
                        setDebouncedRightTerm('');
                        setRightPage(1);
                        setListsVersion((v) => v + 1);
                        showToast('Membership list refreshed', 'info');
                      }}
                      className="w-8 h-8 rounded-xl bg-white border border-[#E8DFD8] text-[#863221] hover:bg-[#FAF7F2] disabled:opacity-50 flex items-center justify-center cursor-pointer transition-colors"
                      title="Refresh the Membership List"
                      aria-label="Refresh the Membership List"
                    >
                      <RotateCcw className={`w-4 h-4 ${rightLoading ? 'animate-spin' : ''}`} />
                    </button>
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[#510601]/10 text-[#510601] border border-[#510601]/20 shrink-0">
                      {totalRightMembers} Members
                    </span>
                  </div>
                )}
              </div>

              {/* Membership Cards Directory */}
              <div className={`p-3 sm:p-4 space-y-2.5 max-h-[540px] min-h-[460px] overflow-y-auto custom-scrollbar bg-[#FAF7F2]/30 transition-opacity ${rightLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                {paginatedRightMembers.length === 0 ? (
                  <div className="py-12 text-center text-[#863221]">
                    <div className="w-10 h-10 rounded-2xl bg-[#510601]/5 text-[#510601] flex items-center justify-center mx-auto mb-2 border border-[#510601]/10">
                      <Users className="w-5 h-5 opacity-60" />
                    </div>
                    <p className="font-semibold text-sm text-[#180200]">No members found</p>
                    <p className="text-xs text-[#863221] mt-0.5">
                      {rightSearchQuery ? 'Try adjusting your search criteria.' : (typedNumber || typedName || typedMobile) ? 'No member matches what is typed. You can still save this as a non-member receipt.' : 'No members registered yet in the Membership List.'}
                    </p>
                  </div>
                ) : (
                  paginatedRightMembers.map((member) => {
                    const pinLookup = member.postalCode ? lookupLocationByPin(member.postalCode) : null;
                    const districtText = member.districtName || member.district || (pinLookup?.found ? pinLookup.districtName : '') || '';
                    const locParts = [
                      member.locality || member.talukName || member.taluk || member.place || (pinLookup?.found ? pinLookup.talukName : ''),
                      districtText,
                      member.postalCode || member.pinCode ? `(${member.postalCode || member.pinCode})` : ''
                    ].filter(Boolean).join(', ');

                    const shortCode = member.membershipNumber
                      ? `${String(member.membershipNumber).split('-').pop()}`
                      : `ID ${member.registrationNumber || member.id || '—'}`;
                    const mobile = member.contactNumber || member.mobile || member.phone || '';
                    const isAssigned = selectedMember && (
                      String(member.id) === String(selectedMember.id) ||
                      (member.membershipNumber && member.membershipNumber === selectedMember.membershipNumber)
                    );

                    return (
                      <div
                        key={member.id || member.registrationNumber || member.membershipNumber}
                        className={`p-3 sm:p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                          isAssigned
                            ? 'bg-amber-50/70 border-amber-300 ring-1 ring-amber-300'
                            : rightTotal === 1 && debouncedRightTerm
                            ? 'bg-emerald-50 border-emerald-400 ring-1 ring-emerald-300'
                            : 'bg-white border-[#E8DFD8] hover:border-[#510601]/40 hover:bg-[#FAF7F2]/40'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="text-xs sm:text-sm font-mono font-bold text-[#510601] pr-3 border-r border-[#E8DFD8] shrink-0"
                            title={member.membershipNumber ? `Membership ${member.membershipNumber}` : `App ID ${member.registrationNumber || member.id}`}
                          >
                            {shortCode}
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-xs sm:text-sm font-bold text-[#180200] truncate">
                              {member.fullName || member.name}
                            </h4>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#863221]/80 mt-0.5">
                              {mobile && (
                                <span className="inline-flex items-center gap-1 font-mono">
                                  <Phone className="w-3 h-3 text-[#863221]/60 shrink-0" />
                                  <span>{mobile}</span>
                                </span>
                              )}
                              {mobile && locParts && <span className="text-[#863221]/30">|</span>}
                              {locParts && (
                                <span className="inline-flex items-center gap-1 truncate max-w-[200px] sm:max-w-[240px]" title={locParts}>
                                  <MapPin className="w-3 h-3 text-[#863221]/60 shrink-0" />
                                  <span className="truncate">{locParts}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleAssignFromMembership(member)}
                          className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                            isAssigned
                              ? 'bg-[#510601] text-white border border-[#510601]'
                              : 'border border-[#510601]/30 text-[#510601] hover:bg-[#510601] hover:text-white'
                          }`}
                          title="Assign this member's details into the receipt form"
                        >
                          {isAssigned ? 'Assigned' : 'Assign'}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Pagination Footer */}
              {totalRightMembers > 0 && (
                <div className="p-3.5 bg-[#FAF7F2] border-t border-[#E8DFD8] text-xs text-[#863221] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
          <div className="bg-[#FAF7F2] border-b border-[#E8DFD8] px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-[#180200]">
                  Unapproved Members
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              {unapprovedSearchOpen ? (
                <div className="relative flex items-center">
                  <Search className="w-4 h-4 text-[#863221]/60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Search unapproved members..."
                    value={unapprovedSearchQuery}
                    onChange={(e) => {
                      setUnapprovedSearchQuery(e.target.value);
                      setUnapprovedPage(1);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setUnapprovedSearchQuery('');
                        setUnapprovedPage(1);
                        setUnapprovedSearchOpen(false);
                      }
                    }}
                    className="w-48 sm:w-64 pl-9 pr-8 py-1.5 bg-white border border-[#E8DFD8] rounded-xl text-xs sm:text-sm text-[#180200] placeholder-[#863221]/40 focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setUnapprovedSearchQuery('');
                      setUnapprovedPage(1);
                      setUnapprovedSearchOpen(false);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#863221]/50 hover:text-[#863221] p-0.5 cursor-pointer"
                    title="Close search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setUnapprovedSearchOpen(true)}
                  className="w-8 h-8 rounded-xl bg-white border border-[#E8DFD8] text-[#863221] hover:bg-[#FAF7F2] flex items-center justify-center cursor-pointer transition-colors"
                  title="Search unapproved members"
                >
                  <Search className="w-4 h-4" />
                </button>
              )}

              <button
                type="button"
                disabled={bottomLoading}
                onClick={() => {
                  setUnapprovedSearchQuery('');
                  setDebouncedBottomTerm('');
                  setUnapprovedPage(1);
                  setListsVersion((v) => v + 1);
                  showToast('Unassigned members refreshed', 'info');
                }}
                className="w-8 h-8 rounded-xl bg-white border border-[#E8DFD8] text-[#863221] hover:bg-[#FAF7F2] disabled:opacity-50 flex items-center justify-center cursor-pointer transition-colors"
                title="Refresh Unapproved Members"
                aria-label="Refresh Unapproved Members"
              >
                <RotateCcw className={`w-4 h-4 ${bottomLoading ? 'animate-spin' : ''}`} />
              </button>

              <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200 shrink-0">
                {totalBottomMembers} Unassigned Members
              </span>
            </div>
          </div>

          {/* Table Content */}
          <div className={`overflow-x-auto min-h-[200px] transition-opacity ${bottomLoading ? 'opacity-50 pointer-events-none' : ''}`}>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E8DFD8] bg-[#FAF7F2] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
                  <th className="py-3.5 px-4 whitespace-nowrap">Applicant</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Contact</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Location</th>
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
                            ID: {member.registrationNumber || member.id || '—'}
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
                            {hasPermission('receipts.entry.write') && (
                              <button
                                type="button"
                                onClick={() => handleAssignFromUnapproved(member)}
                                className="btn-act"
                                title="Assign to Receipt"
                              >
                                <FileText className="w-3.5 h-3.5 shrink-0" />
                                <span>Assign to Receipt</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => setViewApplicant(member)}
                              className="btn-act"
                              title="View the details entered on this application"
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
            <div className="p-4 border-t border-[#E8DFD8] bg-[#FAF7F2] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#863221]">
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
    </div>
    </PermissionGate>
  );
}
