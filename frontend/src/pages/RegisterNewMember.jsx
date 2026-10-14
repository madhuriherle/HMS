import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation, useParams } from 'react-router-dom';
import {
  User,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
  Phone,
  Calendar,
  Building,
  MapPin,
  Save,
  ArrowLeft,
  Tag,
  Plus,
  Trash2,
  Search,
  Users,
  Heart
} from 'lucide-react';
import api from '../api';
import { notify } from '../utils/notify';
import { apiErrorMessage } from '../utils/apiError';
import {
  loadLocations,
  findLocationByPin,
  loadMembershipTypes,
  loadGothras,
  loadQualifications,
  loadPaymentModeConfigs
} from '../utils/serverData';
import { validateInternationalPhone, maxPhoneDigits } from '../utils/phoneValidation';
import useLists, { useCountryCodes } from '../hooks/useLists';
import { toISODate } from '../utils/dateUtils';
import DateInput from '../components/DateInput';
import CountryCodeSelect from '../components/CountryCodeSelect';
import PermissionGate from '../components/PermissionGate';
import SearchableFormSelect from '../components/SearchableFormSelect';
import useAuth from '../hooks/useAuth';
import useRules, { hasDigits } from '../hooks/useRules';
import { formatMoney } from '../utils/money';

const DEFAULT_CATEGORY = 'Only Havyaka Mahasabha Membership';

const titleCase = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1).toLowerCase() : '');

// Kannada name / address inputs are switched off for now (the data fields and the server still support them):
// set to true to show them again.
const SHOW_KANNADA_FIELDS = false;

export default function RegisterNewMember() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const { hasPermission } = useAuth();
  // formats, limits and fixed lists come from the server (GET /meta/rules); null until loaded
  const rules = useRules();
  const lists = useLists(); // child relations, YES/NO, country codes (GET /meta/lists)
  const COUNTRY_CODES = useCountryCodes();
  const BLOOD_GROUPS = rules?.blood_groups || [];
  const BEHALF_OPTIONS = rules?.applied_on_behalf_of || [];
  const NAME_TITLES = rules?.name_titles || [];
  const CATEGORY_OPTIONS = rules?.membership_type_categories || [];
  const minAge = rules?.member?.min_age ?? 0;

  // Mode: add (/register), edit (/edit/:id), view (/view/:id)
  const isEditMode = location.pathname.includes('/edit');
  const isViewMode = !isEditMode && location.pathname.includes('/view');

  const returnPath =
    location.state?.returnPath ||
    (location.state?.from === 'receipt-entry' ? '/dashboard/receipts/entry' : '/dashboard/membership/list');

  // ----------------------------------------------------
  // MASTER DATA (all from the server)
  // ----------------------------------------------------
  const [membershipTypes, setMembershipTypes] = useState([]);
  const [locations, setLocations] = useState({ states: [], districts: [], taluks: [], postalCodes: [] });
  const [gothras, setGothras] = useState([]);
  const [qualifications, setQualifications] = useState([]);
  const [paymentModes, setPaymentModes] = useState([]);
  const [mastersReady, setMastersReady] = useState(false);
  const postalCodes = locations.postalCodes;

  // Toast feedback
  const showToast = (message, type = 'success') => {
    notify(message, type);
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadMembershipTypes(),
      loadLocations(),
      loadGothras(),
      loadQualifications(),
      loadPaymentModeConfigs()
    ])
      .then(([types, loc, goth, quals, modes]) => {
        if (cancelled) return;
        setMembershipTypes(types);
        setLocations(loc);
        setGothras(goth);
        setQualifications(quals);
        setPaymentModes([...new Set(modes.filter((m) => m.status === 'Active').map((m) => m.paymentMode))]);
        setMastersReady(true);
      })
      .catch((error) => {
        console.error('Failed to load master data.', error);
        showToast(apiErrorMessage(error, 'Failed to load master data from the server.'), 'error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Search the server's PIN directory (already loaded) for the autocomplete
  const searchPostalLocations = (query, limit = 20) => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    return postalCodes
      .filter((p) => String(p.postalCode).startsWith(q) || String(p.area || '').toLowerCase().includes(q))
      .slice(0, limit);
  };

  // The member being viewed / edited (read from the server)
  const [targetMember, setTargetMember] = useState(null);
  const [loadingMember, setLoadingMember] = useState(Boolean(params.id));
  const [photoFile, setPhotoFile] = useState(null);

  // Form tab: 'membershipDetails' | 'paymentInfo'
  const [activeFormSection, setActiveFormSection] = useState('membershipDetails');
  const fileInputRef = useRef(null);
  const pinWrapperRef = useRef(null);
  const [saving, setSaving] = useState(false);

  // Active membership types available for new registrations
  const activeMembershipTypes = useMemo(() => {
    return membershipTypes.filter((mt) => mt.status === 'Active');
  }, [membershipTypes]);

  const initialFormState = {
    membershipTypeCategory: DEFAULT_CATEGORY,
    membershipTypeId: '',
    membershipType: '',
    photoUrl: '',
    nameTitle: 'SRI.',
    name: '',
    nameKn: '',
    fatherHusbandName: '',
    fatherName: '',
    fatherMembershipNo: '',
    motherName: '',
    motherMembershipNo: '',
    isMarried: 'NO',
    spouseName: '',
    spouseMembershipNo: '',
    hasChildren: 'NO',
    children: [],
    mobileCountryCode: '+91',
    mobileCountryIso: 'IN',
    mobile: '',
    whatsappCountryCode: '+91',
    whatsappCountryIso: 'IN',
    whatsappNumber: '',
    birthDate: '',
    age: '',
    gothra: '',
    gender: 'Male',
    bloodGroup: '',
    aadharNumber: '',
    address: '',
    addressKn: '',
    postalCode: '',
    locality: '',
    localityKn: '',
    taluk: '',
    district: '',
    state: '',
    nativePlace: '',
    appliedOnBehalfOf: 'Self',
    qualification: '',
    employment: '',
    magazineNeeded: 'YES',
    magazineDeliveryChoice: 'COMMUNICATION',
    magazineDeliveryAddress: '',
    magazineKind: 'PHYSICAL',
    magazineEmail: '',
    referredMembershipNo: '',
    referredMembershipName: '',
    familyMembershipNo: '',
    familyMembershipName: '',
    paymentMode: '',
    bankAccount: '',
    amount: '',
    receiptDate: new Date().toISOString().split('T')[0],
    transactionId: '',
    transactionDate: '',
    paymentRemarks: ''
  };

  const [formData, setFormData] = useState(initialFormState);
  const [formErrors, setFormErrors] = useState({});
  const [isWhatsAppSameAsMobile, setIsWhatsAppSameAsMobile] = useState(false);

  // PIN code autocomplete suggestions
  const [pinSuggestions, setPinSuggestions] = useState([]);
  // the locality last filled in from a PIN code, so it can be cleared again when the PIN changes (a typed one is kept)
  const autoLocality = useRef('');
  const [isPinSuggestionsOpen, setIsPinSuggestionsOpen] = useState(false);

  // Click outside listener for PIN suggestion dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pinWrapperRef.current && !pinWrapperRef.current.contains(e.target)) {
        setIsPinSuggestionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // New registration: default to the first active membership type and its price
  useEffect(() => {
    if (!isViewMode && !isEditMode && activeMembershipTypes.length > 0 && !formData.membershipTypeId) {
      const first = activeMembershipTypes[0];
      setFormData((prev) => ({
        ...prev,
        membershipTypeId: first.id,
        membershipType: first.name,
        amount: prev.amount || String(first.currentPrice || '')
      }));
    }
  }, [activeMembershipTypes, isViewMode, isEditMode]);

  // New registration: default payment mode to the first active one
  useEffect(() => {
    if (!isViewMode && !isEditMode && paymentModes.length > 0 && !formData.paymentMode) {
      setFormData((prev) => ({ ...prev, paymentMode: paymentModes[0] }));
    }
  }, [paymentModes, isViewMode, isEditMode]);

  // View / edit: read the member from the server once the masters are in
  useEffect(() => {
    if (!params.id || !mastersReady) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [{ data: m }, profile] = await Promise.all([
          api.get(`/members/${params.id}`),
          api.get(`/members/${params.id}/profile`).then((r) => r.data).catch(() => null)
        ]);
        if (cancelled) return;

        const nameOf = (list, id) => list.find((x) => String(x.id) === String(id))?.name || '';
        const pin = locations.postalCodes.find((p) => String(p.id) === String(m.pincode_id));
        const membership = (profile?.memberships || [])[0];
        const type = membershipTypes.find((t) => String(t.id) === String(membership?.membership_type_id));
        const reg = m.registration_payment || {};
        const dial = m.mobile_country_code || '+91';
        const waDial = m.whatsapp_country_code || dial;
        const gender = titleCase(m.gender) || 'Male';

        // the photo is a protected file: fetch it as an image
        let photoUrl = '';
        if (m.photo_path) {
          try {
            const blob = await api.get('/system/files', { params: { path: m.photo_path }, responseType: 'blob' });
            photoUrl = URL.createObjectURL(blob.data);
          } catch (_) {
            photoUrl = '';
          }
        }

        const approved = String(m.approval_status).toUpperCase() === 'APPROVED';
        setTargetMember({
          id: m.id,
          fullName: [m.name_title, m.first_name_en, m.middle_name_en, m.last_name_en].filter(Boolean).join(' '),
          registrationNumber: String(m.id),
          membershipNumber: m.membership_number || m.member_code || membership?.membership_number || '',
          approvalStatus: approved ? 'Approved' : 'Unapproved',
          status: approved ? 'Approved' : 'Unapproved',
          assignedReceiptNumber: ''
        });
        setIsWhatsAppSameAsMobile(Boolean(m.whatsapp_number) && m.whatsapp_number === m.mobile);
        setFormData({
          membershipTypeCategory: m.membership_type_category || DEFAULT_CATEGORY,
          membershipTypeId: type ? type.id : '',
          membershipType: type ? type.name : '',
          photoUrl,
          nameTitle: m.name_title || (gender === 'Female' ? 'MS.' : 'SRI.'),
          name: [m.first_name_en, m.middle_name_en, m.last_name_en].filter(Boolean).join(' '),
          nameKn: m.full_name_kn || '',
          fatherHusbandName: m.father_name || m.father_husband_name || '',
          fatherName: m.father_name || m.father_husband_name || '',
          fatherMembershipNo: m.father_membership_number || '',
          motherName: m.mother_name || '',
          motherMembershipNo: m.mother_membership_number || '',
          isMarried: m.is_married ? 'YES' : 'NO',
          spouseName: m.spouse_name || '',
          spouseMembershipNo: m.spouse_membership_number || '',
          hasChildren: m.has_children ? 'YES' : (Array.isArray(m.children_details) && m.children_details.length > 0 ? 'YES' : 'NO'),
          children: Array.isArray(m.children_details)
            ? m.children_details.map((c) => ({
                name: c.name || '',
                gender: c.gender || 'Male',
                membershipNo: c.membership_number || '',
                dob: c.dob || ''
              }))
            : [],
          mobileCountryCode: dial,
          mobileCountryIso: COUNTRY_CODES.find((c) => c.dialCode === dial)?.code || 'IN',
          mobile: m.mobile || '',
          whatsappCountryCode: waDial,
          whatsappCountryIso: COUNTRY_CODES.find((c) => c.dialCode === waDial)?.code || 'IN',
          whatsappNumber: m.whatsapp_number || '',
          birthDate: m.date_of_birth || '',
          age: m.date_of_birth ? calculateAge(m.date_of_birth) : '',
          gothra: m.gotra_text || '',
          gender,
          bloodGroup: m.blood_group || '',
          aadharNumber: m.aadhaar_number || '',
          address: m.address_line1 || '',
          addressKn: m.address_line1_kn || '',
          postalCode: pin?.postalCode || '',
          locality: m.locality || m.post || pin?.area || '',
          localityKn: m.locality_kn || '',
          taluk: nameOf(locations.taluks, m.taluk_id),
          district: nameOf(locations.districts, m.district_id),
          state: nameOf(locations.states, m.state_id),
          nativePlace: m.native_place_text || '',
          appliedOnBehalfOf: m.applied_on_behalf_of || 'Self',
          qualification: m.qualification_text || '',
          employment: m.occupation || '',
          magazineNeeded: m.magazine_needed === false ? 'NO' : 'YES',
          magazineDeliveryChoice: m.magazine_delivery_address ? 'DIFFERENT' : 'COMMUNICATION',
          magazineDeliveryAddress: m.magazine_delivery_address || '',
          magazineKind: m.magazine_kind || 'PHYSICAL',
          magazineEmail: m.magazine_email || '',
          referredMembershipNo: m.referred_by_number || '',
          referredMembershipName: m.referred_by_name || '',
          familyMembershipNo: m.family_membership_number || '',
          familyMembershipName: m.family_membership_name || '',
          paymentMode: reg.payment_mode || '',
          bankAccount: reg.bank_account || '',
          amount: reg.amount !== undefined && reg.amount !== null ? String(reg.amount) : '',
          receiptDate: reg.receipt_date || new Date().toISOString().split('T')[0],
          transactionId: reg.transaction_id || '',
          transactionDate: reg.transaction_date || '',
          paymentRemarks: reg.remarks || ''
        });
      } catch (error) {
        console.error('Failed to load the member.', error);
        showToast(apiErrorMessage(error, 'Failed to load the member from the server.'), 'error');
      } finally {
        if (!cancelled) setLoadingMember(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id, mastersReady]);

  // Maximum allowed Date of Birth (must be at least 18 years old dynamically)
  const maxAllowedDobDate = useMemo(() => {
    const today = new Date();
    const maxDate = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
    const y = maxDate.getFullYear();
    const m = String(maxDate.getMonth() + 1).padStart(2, '0');
    const d = String(maxDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  // Safe and robust parser for complete Date of Birth (YYYY-MM-DD or DD-MM-YYYY)
  const parseDobToDate = (dob) => {
    if (!dob) return null;
    if (dob instanceof Date && !isNaN(dob.getTime())) return dob;
    if (typeof dob !== 'string') return null;
    const trimmed = dob.trim();
    if (!trimmed) return null;

    // Strict YYYY-MM-DD (e.g. standard HTML5 date input format)
    const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymdMatch) {
      const y = parseInt(ymdMatch[1], 10);
      const m = parseInt(ymdMatch[2], 10) - 1;
      const d = parseInt(ymdMatch[3], 10);
      const dateObj = new Date(y, m, d);
      if (dateObj.getFullYear() === y && dateObj.getMonth() === m && dateObj.getDate() === d) {
        return dateObj;
      }
      return null;
    }

    // Strict DD-MM-YYYY or DD/MM/YYYY
    const dmyMatch = trimmed.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (dmyMatch) {
      const d = parseInt(dmyMatch[1], 10);
      const m = parseInt(dmyMatch[2], 10) - 1;
      const y = parseInt(dmyMatch[3], 10);
      const dateObj = new Date(y, m, d);
      if (dateObj.getFullYear() === y && dateObj.getMonth() === m && dateObj.getDate() === d) {
        return dateObj;
      }
      return null;
    }

    return null;
  };

  // Helper to compute exact age from a complete and valid Date of Birth
  const calculateAge = (dob, referenceDate = new Date()) => {
    const birthDate = parseDobToDate(dob);
    if (!birthDate) return '';

    const today = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    if (isNaN(today.getTime())) return '';

    let years = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      years--;
    }

    if (years < 0) return '';
    return String(years);
  };

  const handleDobChange = (e) => {
    const dob = e.target.value;
    const parsedDate = parseDobToDate(dob);
    const ageStr = calculateAge(dob);
    const numAge = parseInt(ageStr, 10);

    setFormData((prev) => ({ ...prev, birthDate: dob, age: ageStr }));

    if (!dob) {
      setFormErrors((prev) => ({ ...prev, birthDate: '' }));
      return;
    }

    if (!parsedDate) {
      setFormErrors((prev) => ({ ...prev, birthDate: 'Please enter a valid Date of Birth' }));
      return;
    }

    const now = new Date();
    if (parsedDate > now) {
      setFormErrors((prev) => ({ ...prev, birthDate: 'Date of Birth cannot be in the future' }));
      return;
    }

    if (isNaN(numAge) || numAge < minAge) {
      setFormErrors((prev) => ({ ...prev, birthDate: `Member must be at least ${minAge} years old.` }));
      return;
    }

    if (formErrors.birthDate) {
      setFormErrors((prev) => ({ ...prev, birthDate: '' }));
    }
  };

  const handleTitleChange = (title) => {
    setFormData((prev) => {
      let gender = prev.gender;
      if (title === 'SRI.') {
        gender = 'Male';
      } else if (title === 'MS.') {
        gender = 'Female';
      }
      return { ...prev, nameTitle: title, gender };
    });
  };

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        showToast('Please choose an image file (JPG or PNG).', 'error');
        return;
      }
      setPhotoFile(file);
      setFormData((prev) => ({ ...prev, photoUrl: URL.createObjectURL(file) }));
    }
  };

  // The amount is the price of the membership type chosen in step 1, so it is not typed here (a type with
  // no price, such as an honorary one, still lets the amount be entered). The receipt date of a new registration is today.
  const chosenType = membershipTypes.find((mt) => String(mt.id) === String(formData.membershipTypeId));
  const amountIsFixed = !isViewMode && Number(chosenType?.currentPrice) > 0;

  const handleMembershipTypeSelect = (typeId) => {
    const tObj = membershipTypes.find((mt) => String(mt.id) === String(typeId));
    setFormData((prev) => ({
      ...prev,
      membershipTypeId: tObj ? tObj.id : '',
      membershipType: tObj ? tObj.name : '',
      amount: tObj ? String(tObj.currentPrice || '') : prev.amount
    }));
    if (formErrors.membershipTypeId) {
      setFormErrors((prev) => ({ ...prev, membershipTypeId: '' }));
    }
  };

  const handleMobileCountryChange = ({ dialCode, countryIso }) => {
    setFormData((prev) => ({
      ...prev,
      mobileCountryCode: dialCode,
      mobileCountryIso: countryIso,
      ...(isWhatsAppSameAsMobile ? { whatsappCountryCode: dialCode, whatsappCountryIso: countryIso } : {})
    }));
    if (formErrors.mobile) {
      setFormErrors((prev) => ({ ...prev, mobile: '' }));
    }
  };

  const handleWhatsAppCountryChange = ({ dialCode, countryIso }) => {
    setFormData((prev) => ({
      ...prev,
      whatsappCountryCode: dialCode,
      whatsappCountryIso: countryIso
    }));
    if (formErrors.whatsappNumber) {
      setFormErrors((prev) => ({ ...prev, whatsappNumber: '' }));
    }
  };

  // Is this person already on file? (same mobile, or same name + date of birth)
  const [dupInfo, setDupInfo] = useState({ same_mobile: [], similar: [] });
  useEffect(() => {
    if (isViewMode) return undefined;
    const digits = String(formData.mobile || '').replace(/\D/g, '');
    const nameParts = String(formData.name || '').trim().split(/\s+/).filter(Boolean);
    const dobIso = toISODate(formData.birthDate) || '';
    const canCheck = digits.length >= 10 || (nameParts.length > 0 && dobIso);
    if (!canCheck) {
      setDupInfo({ same_mobile: [], similar: [] });
      return undefined;
    }
    const timer = setTimeout(() => {
      api
        .get('/members/duplicate-check', {
          params: {
            mobile: digits.length >= 10 ? digits : undefined,
            first_name: nameParts[0] || undefined,
            last_name: nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined,
            dob: dobIso || undefined,
            exclude_id: params.id ? Number(params.id) : undefined
          }
        })
        .then(({ data }) => setDupInfo(data))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [formData.mobile, formData.name, formData.birthDate]);

  const handleMobileChange = (val) => {
    // Strip duplicate country dial digits if user pasted with dial code
    let cleanVal = val.replace(/[^\d]/g, '');
    const dialDigits = (formData.mobileCountryCode || '').replace(/\D/g, '');
    if (dialDigits && cleanVal.startsWith(dialDigits) && cleanVal.length > dialDigits.length + 5) {
      cleanVal = cleanVal.slice(dialDigits.length);
    }
    cleanVal = cleanVal.slice(0, maxPhoneDigits(formData.mobileCountryIso || 'IN'));

    setFormData((prev) => ({
      ...prev,
      mobile: cleanVal,
      ...(isWhatsAppSameAsMobile ? { whatsappNumber: cleanVal } : {})
    }));
    if (formErrors.mobile) setFormErrors((prev) => ({ ...prev, mobile: '' }));
    if (isWhatsAppSameAsMobile && formErrors.whatsappNumber) {
      setFormErrors((prev) => ({ ...prev, whatsappNumber: '' }));
    }
  };

  // Tell the user straight away (on leaving the field) when a number is not valid for the chosen country.
  const checkPhoneField = (field) => {
    const isMobile = field === 'mobile';
    const number = isMobile ? formData.mobile : formData.whatsappNumber;
    if (!number || !String(number).trim()) return; // blank: the submit check decides (mobile is required)
    const result = validateInternationalPhone(
      number,
      (isMobile ? formData.mobileCountryIso : formData.whatsappCountryIso) || 'IN',
      (isMobile ? formData.mobileCountryCode : formData.whatsappCountryCode) || '+91'
    );
    setFormErrors((prev) => ({ ...prev, [field]: result.isValid ? '' : result.errorMsg }));
  };

  const handleWhatsAppChange = (val) => {
    let cleanVal = val.replace(/[^\d]/g, '');
    const dialDigits = (formData.whatsappCountryCode || '').replace(/\D/g, '');
    if (dialDigits && cleanVal.startsWith(dialDigits) && cleanVal.length > dialDigits.length + 5) {
      cleanVal = cleanVal.slice(dialDigits.length);
    }
    cleanVal = cleanVal.slice(0, maxPhoneDigits(formData.whatsappCountryIso || 'IN'));

    setFormData((prev) => ({
      ...prev,
      whatsappNumber: cleanVal
    }));
    if (formErrors.whatsappNumber) setFormErrors((prev) => ({ ...prev, whatsappNumber: '' }));
  };

  const handleWhatsAppSameAsMobileToggle = (checked) => {
    setIsWhatsAppSameAsMobile(checked);
    setFormData((prev) => ({
      ...prev,
      whatsappCountryCode: checked ? prev.mobileCountryCode : prev.whatsappCountryCode,
      whatsappCountryIso: checked ? prev.mobileCountryIso : prev.whatsappCountryIso,
      whatsappNumber: checked ? prev.mobile : ''
    }));
    if (formErrors.whatsappNumber) {
      setFormErrors((prev) => ({ ...prev, whatsappNumber: '' }));
    }
  };

  const handlePinChange = async (val) => {
    const cleanVal = val.replace(/\D/g, '').slice(0, 6);
    // a PIN that is being changed or cleared no longer describes the places filled in from the old one
    setFormData((prev) => {
      if (cleanVal.length === 6 || prev.postalCode === cleanVal) return { ...prev, postalCode: cleanVal };
      const keepLocality = prev.locality && prev.locality !== autoLocality.current;
      return {
        ...prev,
        postalCode: cleanVal,
        locality: keepLocality ? prev.locality : '',
        taluk: '',
        district: '',
        state: ''
      };
    });
    if (formErrors.postalCode) setFormErrors((prev) => ({ ...prev, postalCode: '' }));

    if (cleanVal.length >= 2) {
      const results = searchPostalLocations(cleanVal, 20);
      setPinSuggestions(results);
      setIsPinSuggestionsOpen(results.length > 0);
    } else {
      setPinSuggestions([]);
      setIsPinSuggestionsOpen(false);
    }

    if (cleanVal.length === 6) {
      // 1. Try local data first
      const matchInfo = findLocationByPin(postalCodes, cleanVal);
      if (matchInfo.found) {
        const wasAuto = autoLocality.current;
        autoLocality.current = matchInfo.area || '';
        setFormData((prev) => ({
          ...prev,
          locality: prev.locality && prev.locality !== wasAuto ? prev.locality : matchInfo.area || '',
          taluk: matchInfo.talukName || '',
          district: matchInfo.districtName || '',
          state: matchInfo.stateName || ''
        }));
      } else {
        // 2. If not found locally, use free public API
        try {
          // looked up by the server, so the browser does not depend on the public postal service
          const res = await api.get(`/meta/pincode/${cleanVal}`);
          if (res.data) {
            const data = res.data;
            if (data.found) {
              const postOffice = { Name: data.area, Block: data.taluk, District: data.district, State: data.state };
              const wasAuto = autoLocality.current;
              autoLocality.current = postOffice.Name || '';
              setFormData((prev) => ({
                ...prev,
                locality: prev.locality && prev.locality !== wasAuto ? prev.locality : postOffice.Name || '',
                taluk: postOffice.Block || '',
                district: postOffice.District || '',
                state: postOffice.State || ''
              }));
            }
          }
        } catch (err) {
          console.error("Failed to fetch pin code details from API", err);
        }
      }
    }
  };

  const handleSelectPostalSuggestion = (item) => {
    autoLocality.current = item.area || '';
    setFormData((prev) => ({
      ...prev,
      postalCode: item.postalCode,
      locality: item.area || '',
      taluk: item.talukName || '',
      district: item.districtName || '',
      state: item.stateName || ''
    }));
    setPinSuggestions([]);
    setIsPinSuggestionsOpen(false);
    if (formErrors.postalCode) setFormErrors((prev) => ({ ...prev, postalCode: '' }));
  };

  const validateForm = () => {
    const errors = {};
    const cleanName = formData.name.trim();
    const cleanFather = (formData.fatherName || formData.fatherHusbandName || '').trim();
    const cleanAadhar = formData.aadharNumber.trim();
    const cleanAddress = formData.address.trim();
    const cleanPin = formData.postalCode.trim();

    if (!formData.membershipTypeId) {
      errors.membershipTypeId = 'Please select a Havyaka Membership Type';
    }

    if (!cleanName) {
      errors.name = 'New Member Name is required';
    }

    // International Mobile Validation
    const mobileValidation = validateInternationalPhone(
      formData.mobile,
      formData.mobileCountryIso || 'IN',
      formData.mobileCountryCode || '+91'
    );
    if (!mobileValidation.isValid) {
      errors.mobile = mobileValidation.errorMsg;
    }

    // International WhatsApp Validation (optional unless non-empty)
    if (formData.whatsappNumber && formData.whatsappNumber.trim()) {
      const whatsappValidation = validateInternationalPhone(
        formData.whatsappNumber,
        formData.whatsappCountryIso || 'IN',
        formData.whatsappCountryCode || '+91'
      );
      if (!whatsappValidation.isValid) {
        errors.whatsappNumber = whatsappValidation.errorMsg;
      }
    }

    if (!formData.birthDate) {
      errors.birthDate = 'Date of Birth is required';
    } else {
      const parsedDob = parseDobToDate(formData.birthDate);
      if (!parsedDob) {
        errors.birthDate = 'Please enter a valid Date of Birth';
      } else {
        const now = new Date();
        if (parsedDob > now) {
          errors.birthDate = 'Date of Birth cannot be in the future';
        } else {
          const exactAge = parseInt(calculateAge(formData.birthDate), 10);
          if (isNaN(exactAge) || exactAge < minAge) {
            errors.birthDate = `Member must be at least ${minAge} years old.`;
          }
        }
      }
    }

    // Aadhaar and PIN are optional for now; when typed they must still be the right length
    if (cleanAadhar && !hasDigits(cleanAadhar, rules?.aadhaar?.digits)) {
      errors.aadharNumber = `Aadhar must be a ${rules?.aadhaar?.digits}-digit number`;
    }

    if (!cleanAddress) {
      errors.address = 'Communication Address is required';
    }

    if (cleanPin && !hasDigits(cleanPin, rules?.pincode?.digits)) {
      errors.postalCode = `PIN Code must be ${rules?.pincode?.digits} numeric digits`;
    }

    if (formData.magazineNeeded === 'YES' && formData.magazineKind !== 'PHYSICAL') {
      const mail = (formData.magazineEmail || '').trim();
      if (!mail) errors.magazineEmail = 'An e-copy needs an email address';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) errors.magazineEmail = 'Please enter a valid email address';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Moving to the Payment tab (Next button or the tab header) needs step 1 to be complete
  const goToPaymentStep = () => {
    if (isViewMode || validateForm()) {
      setActiveFormSection('paymentInfo');
      return;
    }
    showToast('Please fill the required fields marked with * before moving to Payment Information.', 'error');
    // bring the first missing field into view once its error message has rendered
    window.setTimeout(() => {
      const firstError = document.querySelector('p.text-red-600');
      if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  // ----------------------------------------------------
  // FAMILY LOOKUP & CHILDREN HANDLERS
  // ----------------------------------------------------
  const [memberLookupState, setMemberLookupState] = useState({});

  const performMemberLookup = async (fieldKey, number) => {
    const clean = (number || '').trim();
    if (!clean || clean.length < 3) return;
    setMemberLookupState((prev) => ({ ...prev, [fieldKey]: { loading: true } }));
    try {
      const res = await api.get('/members/lookup', { params: { number: clean } });
      if (res.data?.found && res.data?.member) {
        const m = res.data.member;
        setMemberLookupState((prev) => ({
          ...prev,
          [fieldKey]: { loading: false, verified: true, name: m.name, memberCode: m.member_code || m.membership_number }
        }));
        if (fieldKey === 'father' && !formData.fatherName) {
          setFormData((prev) => ({ ...prev, fatherName: m.name, fatherHusbandName: m.name }));
        } else if (fieldKey === 'mother' && !formData.motherName) {
          setFormData((prev) => ({ ...prev, motherName: m.name }));
        } else if (fieldKey === 'spouse' && !formData.spouseName) {
          setFormData((prev) => ({ ...prev, spouseName: m.name }));
        }
      } else {
        setMemberLookupState((prev) => ({
          ...prev,
          [fieldKey]: { loading: false, verified: false, error: 'No member found' }
        }));
      }
    } catch {
      setMemberLookupState((prev) => ({
        ...prev,
        [fieldKey]: { loading: false, verified: false, error: 'Lookup failed' }
      }));
    }
  };

  const handleAddChild = () => {
    setFormData((prev) => ({
      ...prev,
      hasChildren: 'YES',
      children: [...(prev.children || []), { name: '', gender: 'Male', membershipNo: '', dob: '' }]
    }));
  };

  const handleRemoveChild = (index) => {
    setFormData((prev) => {
      const filtered = (prev.children || []).filter((_, i) => i !== index);
      return {
        ...prev,
        children: filtered,
        hasChildren: filtered.length > 0 ? prev.hasChildren : 'NO'
      };
    });
  };

  const handleChildChange = (index, key, val) => {
    setFormData((prev) => {
      const updated = [...(prev.children || [])];
      updated[index] = { ...updated[index], [key]: val };
      return { ...prev, children: updated };
    });
  };

  // ----------------------------------------------------
  // SAVE (server calls)
  // ----------------------------------------------------
  const buildPayload = () => {
    const parts = formData.name.trim().split(/\s+/);
    const pinRow = locations.postalCodes.find(
      (p) => p.postalCode === formData.postalCode && (!formData.locality || p.area === formData.locality)
    ) || locations.postalCodes.find((p) => p.postalCode === formData.postalCode);
    return {
      name_title: formData.nameTitle || null,
      first_name_en: parts[0],
      middle_name_en: parts.length > 2 ? parts.slice(1, -1).join(' ') : null,
      last_name_en: parts.length > 1 ? parts[parts.length - 1] : null,
      full_name_kn: (formData.nameKn || '').trim() || null,
      father_husband_name: (formData.fatherName || formData.spouseName || formData.fatherHusbandName || '').trim() || null,
      father_name: (formData.fatherName || formData.fatherHusbandName || '').trim() || null,
      father_membership_number: (formData.fatherMembershipNo || '').trim() || null,
      mother_name: (formData.motherName || '').trim() || null,
      mother_membership_number: (formData.motherMembershipNo || '').trim() || null,
      is_married: formData.isMarried === 'YES',
      spouse_name: formData.isMarried === 'YES' ? (formData.spouseName || '').trim() || null : null,
      spouse_membership_number: formData.isMarried === 'YES' ? (formData.spouseMembershipNo || '').trim() || null : null,
      has_children: formData.hasChildren === 'YES',
      children_details: formData.hasChildren === 'YES' && Array.isArray(formData.children)
        ? formData.children
            .filter((c) => c && c.name && c.name.trim())
            .map((c) => ({
              name: c.name.trim(),
              gender: c.gender || 'Male',
              membership_number: (c.membershipNo || '').trim() || null,
              dob: toISODate(c.dob) || null
            }))
        : [],
      mobile: formData.mobile.trim(),
      mobile_country_code: formData.mobileCountryCode,
      whatsapp_number: (formData.whatsappNumber || '').trim() || null,
      whatsapp_country_code: formData.whatsappNumber ? formData.whatsappCountryCode : null,
      date_of_birth: toISODate(formData.birthDate) || null,
      gender: String(formData.gender || '').toUpperCase() || null,
      blood_group: formData.bloodGroup || null,
      aadhaar_number: formData.aadharNumber.replace(/\s/g, ''),
      gotra_text: formData.gothra || null,
      qualification_text: formData.qualification || null,
      occupation: formData.employment.trim() || null,
      native_place_text: formData.nativePlace.trim() || null,
      address_line1: formData.address.trim(),
      address_line1_kn: (formData.addressKn || '').trim() || null,
      locality: (formData.locality || '').trim() || null,
      locality_kn: (formData.localityKn || '').trim() || null,
      post: (formData.locality || '').trim() || null,
      state_id: pinRow?.stateId || null,
      district_id: pinRow?.districtId || null,
      taluk_id: pinRow?.talukId || null,
      pincode_id: pinRow?.id || null,
      applied_on_behalf_of: formData.appliedOnBehalfOf || null,
      magazine_needed: formData.magazineNeeded === 'YES',
      magazine_kind: formData.magazineNeeded === 'YES' ? formData.magazineKind || 'PHYSICAL' : null,
      magazine_email: formData.magazineNeeded === 'YES' && formData.magazineKind !== 'PHYSICAL' ? (formData.magazineEmail || '').trim() || null : null,
      magazine_delivery_address: formData.magazineNeeded === 'YES' && formData.magazineKind !== 'EMAIL' && formData.magazineDeliveryChoice === 'DIFFERENT' ? (formData.magazineDeliveryAddress || '').trim() || null : null,
      membership_type_category: formData.membershipTypeCategory || null,
      ...(isEditMode && formData.membershipTypeId ? { membership_type_id: Number(formData.membershipTypeId) } : {}),
      referred_by_number: formData.referredMembershipNo.trim() || null,
      referred_by_name: formData.referredMembershipName.trim() || null,
      family_membership_number: formData.familyMembershipNo.trim() || null,
      family_membership_name: formData.familyMembershipName.trim() || null,
      registration_payment: {
        payment_mode: formData.paymentMode || null,
        bank_account: formData.bankAccount.trim() || null,
        amount: formData.amount ? Number(formData.amount) : null,
        receipt_date: toISODate(formData.receiptDate) || null,
        transaction_id: formData.transactionId.trim() || null,
        transaction_date: toISODate(formData.transactionDate) || null,
        remarks: formData.paymentRemarks.trim() || null
      },
      // where the record came from is set once, when it is created; editing never changes it
      ...(isEditMode ? {} : { registration_source: 'OFFLINE' })
    };
  };

  const handleSaveMember = async (e) => {
    e.preventDefault();
    // Enter inside a field submits the form even when the Save buttons are hidden
    if (!hasPermission(isEditMode ? 'members.list.write' : 'members.register.write')) {
      showToast('You do not have permission to save members.', 'error');
      return;
    }
    if (!validateForm()) {
      showToast('Please fix the required fields marked with *.', 'error');
      setActiveFormSection('membershipDetails');
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();
      if (isEditMode && params.id) {
        const { data } = await api.put(`/members/${params.id}`, payload);
        if (photoFile) {
          const form = new FormData();
          form.append('file', photoFile);
          await api.post(`/members/${params.id}/photo`, form);
        }
        showToast(
          data?.approval_request_id || data?.status === 'PENDING'
            ? 'Update submitted for approval.'
            : `Member "${formData.name.trim()}" updated successfully.`
        );
        navigate(returnPath);
        return;
      }

      const { data } = await api.post('/members/', payload);
      if (data?.approval_request_id || data?.status === 'PENDING') {
        showToast('Registration submitted for approval.');
        navigate('/dashboard/membership/unapproved');
        return;
      }
      // the chosen membership type, then the photo
      if (formData.membershipTypeId) {
        await api.post(`/members/${data.id}/memberships`, { membership_type_id: Number(formData.membershipTypeId) });
      }
      if (photoFile) {
        const form = new FormData();
        form.append('file', photoFile);
        await api.post(`/members/${data.id}/photo`, form);
      }
      showToast(`Member "${formData.name.trim()}" registered and added to Unapproved Members.`);
      navigate('/dashboard/membership/unapproved');
    } catch (error) {
      console.error('Failed to save the member.', error);
      showToast(apiErrorMessage(error, 'Failed to save the member.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PermissionGate required={isViewMode ? 'members.list.read' : isEditMode ? 'members.list.write' : 'members.register.write'}>
    <div className="max-w-[1240px] mx-auto space-y-6">
      {/* ---------------------------------------------------- */}
      {/* BREADCRUMB & HEADER                                  */}
      {/* ---------------------------------------------------- */}
      <div>
        <div className="flex items-center justify-between gap-4 w-full">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#180200] tracking-tight flex items-center gap-3">
              <span>{isViewMode ? 'View Member Details' : isEditMode ? 'Edit Member Details' : 'Register New Member'}</span>
              {(isViewMode || isEditMode) && targetMember?.registrationNumber && (
                <span className="font-mono text-sm font-bold bg-[#FAF7F2] text-[#510601] px-3 py-1 rounded-xl border border-[#E8DFD8]" title="Record ID">
                  ID: {targetMember.registrationNumber}
                </span>
              )}
              {(isViewMode || isEditMode) && targetMember?.membershipNumber && targetMember.membershipNumber !== 'Not Assigned' && targetMember.approvalStatus === 'Approved' && (
                <span className="font-mono text-sm font-bold bg-emerald-50 text-emerald-800 px-3 py-1 rounded-xl border border-emerald-200" title="Membership Number">
                  {targetMember.membershipNumber}
                </span>
              )}
            </h1>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------- */}
      {/* FORM CARD CONTAINER                                  */}
      {/* ---------------------------------------------------- */}
      <div className="w-full bg-white rounded-2xl border border-[#E8DFD8] shadow-sm overflow-hidden">
        {/* Form Top Bar with Tabs */}
        <div className="px-6 sm:px-8 pt-6 sm:pt-7 pb-3 border-b border-[#E8DFD8]">
          <div className="flex items-center justify-between pb-3 border-b-2 border-[#8C1801]">
            <h2 className="text-base sm:text-lg font-bold text-[#180200]">
              {isViewMode
                ? `Membership Details: ${formData.name || targetMember?.fullName || 'Member Record'}`
                : isEditMode
                ? `Edit Membership: ${formData.name || targetMember?.fullName || 'Member Record'}`
                : 'New Membership Form'}
            </h2>
            <span className="text-xs sm:text-sm text-[#863221] font-medium">
              {isViewMode ? (
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                  targetMember?.status === 'Unapproved' || targetMember?.approvalStatus === 'Unapproved'
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}>
                  {targetMember?.status === 'Unapproved' || targetMember?.approvalStatus === 'Unapproved' ? 'Unapproved' : (targetMember?.status || targetMember?.approvalStatus || 'Active Member')}
                </span>
              ) : (
                '* Required fields'
              )}
            </span>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 mt-4">
            <button
              type="button"
              onClick={() => setActiveFormSection('membershipDetails')}
              className={`px-6 py-2.5 text-xs sm:text-sm font-bold rounded-t-lg border-t border-x transition-all cursor-pointer ${activeFormSection === 'membershipDetails'
                ? 'bg-[#510601] text-white border-[#510601] shadow-xs'
                : 'bg-[#FAF7F2] text-[#510601] border-[#E8DFD8] hover:bg-white'
                }`}
            >
              Membership Details
            </button>
            <button
              type="button"
              onClick={goToPaymentStep}
              className={`px-6 py-2.5 text-xs sm:text-sm font-bold rounded-t-lg border-t border-x transition-all cursor-pointer ${activeFormSection === 'paymentInfo'
                ? 'bg-[#510601] text-white border-[#510601] shadow-xs'
                : 'bg-[#FAF7F2] text-[#510601] border-[#E8DFD8] hover:bg-white'
                }`}
            >
              Payment Information
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSaveMember}>
          <div className="px-6 sm:px-8 py-6 sm:py-7 space-y-6">
            {/* TAB 1: MEMBERSHIP DETAILS */}
            {activeFormSection === 'membershipDetails' && (
              <div className="space-y-6">
                <fieldset disabled={isViewMode} className="space-y-6 disabled:opacity-95">
                {/* Top Row: Membership Type & Select Havyaka Membership Type */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Membership Type:
                    </label>
                    <select
                      value={formData.membershipTypeCategory}
                      onChange={(e) =>
                        setFormData({ ...formData, membershipTypeCategory: e.target.value })
                      }
                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 transition-all cursor-pointer shadow-2xs"
                    >
                      {CATEGORY_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>

                  </div>

                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Select Havyaka Membership Type: <span className="text-red-600">*</span>
                    </label>
                    <select
                      value={formData.membershipTypeId}
                      onChange={(e) => handleMembershipTypeSelect(e.target.value)}
                      className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 transition-all cursor-pointer shadow-2xs ${formErrors.membershipTypeId ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#DFD5CC] hover:border-[#8C1801]/60'
                        }`}
                    >
                      <option value="">Select a Havyaka membership type</option>
                      {activeMembershipTypes.map((mt) => (
                        <option key={mt.id} value={mt.id}>
                          {mt.name} ({formatMoney(mt.currentPrice ?? mt.price ?? mt.fee)})
                        </option>
                      ))}
                    </select>
                    {formErrors.membershipTypeId && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.membershipTypeId}</p>
                    )}
                  </div>
                </div>

                {/* Red separator bar */}
                <div className="border-b border-[#8C1801]/30 my-2" />

                {/* Photo upload + Basic Details */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                  {/* Left: Passport Size Photo Upload */}
                  <div className="md:col-span-3 flex flex-col items-center justify-center p-1">
                    <div className="w-32 sm:w-36 h-40 sm:h-44 border-2 border-dashed border-[#DFD5CC] bg-[#FAF7F2] flex flex-col items-center justify-center relative overflow-hidden rounded-lg shadow-2xs hover:border-[#8C1801]/50 transition-colors">
                      {formData.photoUrl ? (
                        <img
                          src={formData.photoUrl}
                          alt="Member Photo"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-[#863221]/60 flex flex-col items-center justify-center p-3 text-center">
                          <User className="w-10 h-10 stroke-[1.2] text-[#863221]/50" />
                          <span className="text-[10px] text-[#863221]/70 mt-1.5 font-semibold">Passport Photo</span>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-2.5 py-1.5 px-4 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-md text-center shadow-xs transition-colors cursor-pointer inline-flex items-center justify-center"
                    >
                      Select Image
                    </button>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleImageSelect}
                      accept="image/*"
                      className="hidden"
                    />
                  </div>

                  {/* Right: Member Name, Father/Husband Name, Mobile, WhatsApp, DOB, Age */}
                  <div className="md:col-span-9 grid grid-cols-1 sm:grid-cols-2 gap-5">
                    {/* New Member Name */}
                    <div>
                      <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                        New Member Name: <span className="text-red-600">*</span>
                      </label>
                      <div className="flex gap-2">
                        <div className="w-24 shrink-0">
                          <select
                            value={formData.nameTitle}
                            onChange={(e) => handleTitleChange(e.target.value)}
                            className="w-full px-2.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm font-bold text-[#510601] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 cursor-pointer shadow-2xs transition-all"
                          >
                            {NAME_TITLES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex-1 min-w-0">
                          <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => {
                              setFormData({ ...formData, name: e.target.value });
                              if (formErrors.name) setFormErrors({ ...formErrors, name: '' });
                            }}

                            className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${formErrors.name ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#DFD5CC] hover:border-[#8C1801]/60'
                              }`}
                          />
                        </div>
                      </div>
                      {formErrors.name && (
                        <p className="text-[11px] text-red-600 mt-1">{formErrors.name}</p>
                      )}
                    </div>

                    {/* Name (Kannada) */}
                    {SHOW_KANNADA_FIELDS && (
                    <div>
                      <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                        Name (Kannada):
                      </label>
                      <input
                        type="text"
                        placeholder="ಹೆಸರು (Kannada)"
                        value={formData.nameKn}
                        onChange={(e) => setFormData({ ...formData, nameKn: e.target.value })}
                        className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                      />
                    </div>
                    )}

                    {/* Father Name */}
                    <div>
                      <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                        Father's Name:
                      </label>
                      <input
                        type="text"
                        placeholder="Father's Full Name"
                        value={formData.fatherName || formData.fatherHusbandName}
                        onChange={(e) => {
                          const val = e.target.value;
                          setFormData({ ...formData, fatherName: val, fatherHusbandName: val });
                          if (formErrors.fatherName || formErrors.fatherHusbandName)
                            setFormErrors({ ...formErrors, fatherName: '', fatherHusbandName: '' });
                        }}
                        className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${
                          (formErrors.fatherName || formErrors.fatherHusbandName) ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#DFD5CC] hover:border-[#8C1801]/60'
                        }`}
                      />
                      {(formErrors.fatherName || formErrors.fatherHusbandName) && (
                        <p className="text-[11px] text-red-600 mt-1">
                          {formErrors.fatherName || formErrors.fatherHusbandName}
                        </p>
                      )}
                    </div>

                    {/* Mobile / Phone Number */}
                    <div>
                      <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                        Mobile / Phone Number: <span className="text-red-600">*</span>
                      </label>
                      <div className="flex gap-2">
                        <div className="w-28 shrink-0">
                          <CountryCodeSelect
                            value={formData.mobileCountryCode}
                            countryIso={formData.mobileCountryIso}
                            onChange={handleMobileCountryChange}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <input
                            type="tel"
                            value={formData.mobile}
                            onChange={(e) => handleMobileChange(e.target.value)}
                            onBlur={() => checkPhoneField('mobile')}

                            className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${formErrors.mobile ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#DFD5CC] hover:border-[#8C1801]/60'
                              }`}
                          />
                        </div>
                      </div>
                      {formErrors.mobile && (
                        <p className="text-[11px] text-red-600 mt-1">{formErrors.mobile}</p>
                      )}
                      {[...dupInfo.same_mobile.map((d) => ({ ...d, why: 'has this mobile number' })),
                        ...dupInfo.similar.map((d) => ({ ...d, why: 'has the same name and date of birth' }))].map((d) => (
                        <div key={`${d.id}${d.why}`} className="mt-1.5 flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-800">
                          <span>
                            {d.name} {(d.membership_number || d.member_code) ? `(${d.membership_number || d.member_code})` : '(applicant)'} already {d.why}.
                          </span>
                          <a
                            href={`/dashboard/membership/profile/${d.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="underline text-[#510601]"
                          >
                            View profile
                          </a>
                        </div>
                      ))}
                    </div>

                    {/* WhatsApp Number */}
                    <div>
                      <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                        WhatsApp Number:
                      </label>
                      <div className="flex gap-2">
                        <div className="w-28 shrink-0">
                          <CountryCodeSelect
                            value={formData.whatsappCountryCode}
                            countryIso={formData.whatsappCountryIso}
                            onChange={handleWhatsAppCountryChange}
                            disabled={isWhatsAppSameAsMobile}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <input
                            type="tel"
                            value={formData.whatsappNumber}
                            onChange={(e) => handleWhatsAppChange(e.target.value)}
                            onBlur={() => checkPhoneField('whatsappNumber')}

                            readOnly={isWhatsAppSameAsMobile}
                            className={`w-full px-3.5 py-2.5 border rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${isWhatsAppSameAsMobile
                              ? 'bg-stone-100 text-stone-500 border-[#DFD5CC] cursor-not-allowed'
                              : 'bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border-[#DFD5CC] hover:border-[#8C1801]/60'
                              } ${formErrors.whatsappNumber ? 'border-red-500 ring-2 ring-red-500/20' : ''}`}
                          />
                        </div>
                      </div>
                      {formErrors.whatsappNumber && (
                        <p className="text-[11px] text-red-600 mt-1">{formErrors.whatsappNumber}</p>
                      )}
                      <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isWhatsAppSameAsMobile}
                          onChange={(e) => handleWhatsAppSameAsMobileToggle(e.target.checked)}
                          className="w-4 h-4 rounded text-[#510601] focus:ring-[#510601] border-[#DFD5CC] accent-[#510601] cursor-pointer"
                        />
                        <span className="text-xs text-[#3D140C] font-medium">
                          WhatsApp number is same as mobile/phone number
                        </span>
                      </label>
                    </div>

                    {/* Date of Birth */}
                    <div>
                      <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                        Date of Birth: <span className="text-red-600">*</span>
                      </label>
                      <DateInput
                        disabled={isViewMode}
                        max={maxAllowedDobDate}
                        value={formData.birthDate}
                        onChange={handleDobChange}
                        name="birthDate"
                        className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${formErrors.birthDate ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#DFD5CC] hover:border-[#8C1801]/60'
                          }`}
                      />
                      {formErrors.birthDate && (
                        <p className="text-[11px] text-red-600 mt-1 font-medium">{formErrors.birthDate}</p>
                      )}
                    </div>

                    {/* Age */}
                    <div>
                      <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">Age:</label>
                      <input
                        type="text"
                        readOnly
                        value={formData.age}

                        className="w-full px-3.5 py-2.5 bg-[#F5EFEB] border border-[#DFD5CC] rounded-lg text-sm font-semibold text-[#510601] placeholder:text-[#9E8B7F] placeholder:font-normal focus:outline-none cursor-default shadow-2xs transition-all"
                      />
                    </div>
                  </div>
                </div>

                {/* 2-Column Grid Fields: Community, Identity & Address Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2 border-t border-[#DFD5CC]">
                  {/* Gothra */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Gothra:
                    </label>
                    <select
                      value={formData.gothra}
                      onChange={(e) => {
                        setFormData({ ...formData, gothra: e.target.value });
                        if (formErrors.gothra) setFormErrors({ ...formErrors, gothra: '' });
                      }}
                      className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all cursor-pointer ${formErrors.gothra ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#DFD5CC] hover:border-[#8C1801]/60'
                        }`}
                    >
                      <option value="">Select Gotra</option>
                      {gothras.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                    {formErrors.gothra && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.gothra}</p>
                    )}
                  </div>

                  {/* Gender */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Gender:
                    </label>
                    <select
                      value={formData.gender}
                      onChange={(e) => {
                        setFormData({ ...formData, gender: e.target.value });
                        if (formErrors.gender) setFormErrors({ ...formErrors, gender: '' });
                      }}
                      className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all cursor-pointer ${formErrors.gender ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#DFD5CC] hover:border-[#8C1801]/60'
                        }`}
                    >
                      <option value="">Select Gender</option>
                      {(rules?.genders || []).map((g) => {
                        const label = g.charAt(0) + g.slice(1).toLowerCase();
                        return <option key={g} value={label}>{label}</option>;
                      })}
                    </select>
                    {formErrors.gender && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.gender}</p>
                    )}
                  </div>

                  {/* Blood Group */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Blood Group:
                    </label>
                    <select
                      value={formData.bloodGroup}
                      onChange={(e) => setFormData({ ...formData, bloodGroup: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all cursor-pointer"
                    >
                      <option value="">Select Blood Group</option>
                      {BLOOD_GROUPS.map((bg) => (
                        <option key={bg} value={bg}>
                          {bg}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Aadhar Number */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Aadhar Number:
                    </label>
                    <input
                      type="text"
                      maxLength={12}
                      value={formData.aadharNumber}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        setFormData({ ...formData, aadharNumber: val });
                        if (formErrors.aadharNumber)
                          setFormErrors({ ...formErrors, aadharNumber: '' });
                      }}

                      className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${formErrors.aadharNumber ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#DFD5CC] hover:border-[#8C1801]/60'
                        }`}
                    />
                    {formErrors.aadharNumber && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.aadharNumber}</p>
                    )}
                  </div>

                  {/* Communication Address */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Communication Address: <span className="text-red-600">*</span>
                    </label>
                    <textarea
                      rows={2}
                      value={formData.address}
                      onChange={(e) => {
                        setFormData({ ...formData, address: e.target.value });
                        if (formErrors.address) setFormErrors({ ...formErrors, address: '' });
                      }}

                      className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${formErrors.address ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#DFD5CC] hover:border-[#8C1801]/60'
                        }`}
                    />
                    {formErrors.address && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.address}</p>
                    )}
                  </div>

                  {/* Communication Address (Kannada) */}
                  {SHOW_KANNADA_FIELDS && (
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Communication Address (Kannada):
                    </label>
                    <textarea
                      rows={2}
                      placeholder="ವಿಳಾಸ (Kannada)"
                      value={formData.addressKn}
                      onChange={(e) => setFormData({ ...formData, addressKn: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                    />
                  </div>
                  )}

                  {/* Pin Code with Autocomplete */}
                  <div className="relative" ref={pinWrapperRef}>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Pin Code:
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        maxLength={6}
                        value={formData.postalCode}
                        onChange={(e) => handlePinChange(e.target.value)}
                        onFocus={() => {
                          if (formData.postalCode && formData.postalCode.length >= 2) {
                            const results = searchPostalLocations(formData.postalCode, 20);
                            setPinSuggestions(results);
                            setIsPinSuggestionsOpen(results.length > 0);
                          }
                        }}

                        className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm font-mono text-[#180200] placeholder:text-[#9E8B7F] placeholder:font-sans focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${
                          formErrors.postalCode ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#DFD5CC] hover:border-[#8C1801]/60'
                        }`}
                      />
                    </div>
                    {formErrors.postalCode && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.postalCode}</p>
                    )}

                    {/* Autocomplete Suggestions Dropdown */}
                    {isPinSuggestionsOpen && pinSuggestions.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-[#DFD5CC] rounded-xl shadow-xl z-50 max-h-60 overflow-y-auto divide-y divide-stone-100">
                        {pinSuggestions.map((item, idx) => (
                          <button
                            key={`${item.postalCode}-${item.area}-${idx}`}
                            type="button"
                            onClick={() => handleSelectPostalSuggestion(item)}
                            className="w-full px-3.5 py-2.5 text-left hover:bg-[#FAF7F2] transition-colors flex items-center justify-between group cursor-pointer"
                          >
                            <div className="min-w-0 pr-2">
                              <span className="font-semibold text-sm text-[#180200] group-hover:text-[#510601]">
                                {item.area} — {item.postalCode}
                              </span>
                              <div className="text-xs text-stone-500 truncate">
                                Taluk: <span className="font-medium text-stone-700">{item.talukName || '—'}</span> &bull; District: <span className="font-medium text-stone-700">{item.districtName || '—'}</span>
                              </div>
                            </div>
                            <span className="shrink-0 text-xs font-mono font-bold text-[#8C1801] bg-[#FAF7F2] px-2 py-0.5 rounded border border-[#DFD5CC]">
                              {item.postalCode}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Post Office / Locality */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Post Office / Locality:
                    </label>
                    <input
                      type="text"
                      value={formData.locality}
                      onChange={(e) => setFormData({ ...formData, locality: e.target.value })}

                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                    />
                    {(formData.taluk || formData.district) && (
                      <p className="text-xs text-stone-600 mt-1 flex items-center gap-1.5 font-medium">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                        Taluk: <span className="text-[#510601] font-semibold">{formData.taluk || '—'}</span> &bull; District: <span className="text-[#510601] font-semibold">{formData.district || '—'}</span>
                      </p>
                    )}
                  </div>

                  {/* Post Office / Locality (Kannada) */}
                  {SHOW_KANNADA_FIELDS && (
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Post Office / Locality (Kannada):
                    </label>
                    <input
                      type="text"
                      placeholder="ಸ್ಥಳ (Kannada)"
                      value={formData.localityKn}
                      onChange={(e) => setFormData({ ...formData, localityKn: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                    />
                  </div>
                  )}

                  {/* Native Place */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Native Place:
                    </label>
                    <input
                      type="text"
                      value={formData.nativePlace}
                      onChange={(e) => setFormData({ ...formData, nativePlace: e.target.value })}

                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                    />
                  </div>

                  {/* Applying this Membership on behalf of */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Applying this Membership on behalf of:
                    </label>
                    <select
                      value={formData.appliedOnBehalfOf}
                      onChange={(e) => {
                        setFormData({ ...formData, appliedOnBehalfOf: e.target.value });
                        if (formErrors.appliedOnBehalfOf)
                          setFormErrors({ ...formErrors, appliedOnBehalfOf: '' });
                      }}
                      className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all cursor-pointer ${formErrors.appliedOnBehalfOf ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#DFD5CC] hover:border-[#8C1801]/60'
                        }`}
                    >
                      {BEHALF_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                    {formErrors.appliedOnBehalfOf && (
                      <p className="text-[11px] text-red-600 mt-1">
                        {formErrors.appliedOnBehalfOf}
                      </p>
                    )}
                  </div>

                  {/* Qualification */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Qualification:
                    </label>
                    <SearchableFormSelect
                      value={formData.qualification}
                      onChange={(val) => {
                        setFormData({ ...formData, qualification: val });
                        if (formErrors.qualification)
                          setFormErrors({ ...formErrors, qualification: '' });
                      }}
                      options={qualifications}


                      hasError={Boolean(formErrors.qualification)}
                      maxHeightClass="max-h-52"
                    />
                    {formErrors.qualification && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.qualification}</p>
                    )}
                  </div>

                  {/* Employment */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Employment:
                    </label>
                    <input
                      type="text"
                      value={formData.employment}
                      onChange={(e) => setFormData({ ...formData, employment: e.target.value })}

                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                    />
                  </div>

                  {/* Magazine Needed */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Do you need Havyaka Magazine Every month?
                    </label>
                    <select
                      value={formData.magazineNeeded}
                      onChange={(e) => {
                        setFormData({ ...formData, magazineNeeded: e.target.value });
                        if (formErrors.magazineNeeded)
                          setFormErrors({ ...formErrors, magazineNeeded: '' });
                      }}
                      className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all cursor-pointer ${formErrors.magazineNeeded ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#DFD5CC] hover:border-[#8C1801]/60'
                        }`}
                    >
                      <option value="">Select YES/NO</option>
                      {(lists?.yes_no || []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                    </select>
                    {formErrors.magazineNeeded && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.magazineNeeded}</p>
                    )}
                  </div>

                  {/* How the member wants the magazine (shown when YES) */}
                  {formData.magazineNeeded === 'YES' && (
                    <div className="md:col-span-2 bg-[#FAF7F2] p-4 rounded-xl border border-[#E8DFD8] space-y-3">
                      <label className="block text-xs font-bold text-[#510601] uppercase tracking-wider">
                        How do you want the magazine?
                      </label>
                      <div className="flex flex-wrap gap-5 text-xs font-semibold text-[#863221]">
                        {[
                          ['PHYSICAL', 'Physical copy (posted)'],
                          ['EMAIL', 'E-copy (by email)'],
                          ['BOTH', 'Both']
                        ].map(([code, label]) => (
                          <label key={code} className="inline-flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="radio"
                              name="magazineKind"
                              value={code}
                              checked={formData.magazineKind === code}
                              onChange={() => setFormData({ ...formData, magazineKind: code })}
                              className="w-4 h-4 text-[#510601] focus:ring-[#510601] accent-[#510601] cursor-pointer"
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                      {formData.magazineKind !== 'PHYSICAL' && (
                        <div className="pt-1">
                          <label className="block text-xs text-[#863221] mb-1 font-semibold">E-copy Email Address *</label>
                          <input
                            type="email"
                            value={formData.magazineEmail || ''}
                            onChange={(e) => {
                              setFormData({ ...formData, magazineEmail: e.target.value });
                              if (formErrors.magazineEmail) setFormErrors({ ...formErrors, magazineEmail: '' });
                            }}
                            placeholder="name@example.com"
                            className={`w-full px-3.5 py-2 bg-white border rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] ${formErrors.magazineEmail ? 'border-red-500' : 'border-[#DFD5CC]'}`}
                          />
                          {formErrors.magazineEmail && <p className="text-[11px] text-red-600 mt-1">{formErrors.magazineEmail}</p>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Magazine Delivery Address (shown when YES and a posted copy is wanted) */}
                  {formData.magazineNeeded === 'YES' && formData.magazineKind !== 'EMAIL' && (
                    <div className="md:col-span-2 bg-[#FAF7F2] p-4 rounded-xl border border-[#E8DFD8] space-y-3">
                      <label className="block text-xs font-bold text-[#510601] uppercase tracking-wider">
                        Magazine Delivery Destination
                      </label>
                      <div className="flex flex-wrap gap-5 text-xs font-semibold text-[#863221]">
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="radio"
                            name="magazineDeliveryChoice"
                            value="COMMUNICATION"
                            checked={formData.magazineDeliveryChoice !== 'DIFFERENT'}
                            onChange={() => setFormData({ ...formData, magazineDeliveryChoice: 'COMMUNICATION' })}
                            className="w-4 h-4 text-[#510601] focus:ring-[#510601] accent-[#510601] cursor-pointer"
                          />
                          <span>Deliver to Communication Address</span>
                        </label>
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="radio"
                            name="magazineDeliveryChoice"
                            value="DIFFERENT"
                            checked={formData.magazineDeliveryChoice === 'DIFFERENT'}
                            onChange={() => setFormData({ ...formData, magazineDeliveryChoice: 'DIFFERENT' })}
                            className="w-4 h-4 text-[#510601] focus:ring-[#510601] accent-[#510601] cursor-pointer"
                          />
                          <span>Deliver to a Different Address</span>
                        </label>
                      </div>
                      {formData.magazineDeliveryChoice === 'DIFFERENT' && (
                        <div className="pt-1">
                          <textarea
                            rows={2}
                            value={formData.magazineDeliveryAddress || ''}
                            onChange={(e) => setFormData({ ...formData, magazineDeliveryAddress: e.target.value })}
                            placeholder="Enter delivery address (House/Door No, Street, Locality, City/Taluk, District, PIN code)..."
                            className="w-full px-3.5 py-2 bg-white border border-[#DFD5CC] rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ═══════════════════════════════════════════════════════ */}
                {/* Section: Family & Relationship Details */}
                {/* ═══════════════════════════════════════════════════════ */}
                <div className="pt-4 border-t border-[#DFD5CC] space-y-5">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#8C1801]" />
                    <h3 className="text-sm font-bold text-[#8C1801]">
                      Family & Relationship Details
                    </h3>
                  </div>

                  {/* 1. Parents Details */}
                  <div className="bg-[#FAF7F2] p-4 rounded-xl border border-[#E8DFD8] space-y-4">
                    <h4 className="text-xs font-bold text-[#510601] uppercase tracking-wider flex items-center gap-1.5">
                      <span>Parents Details</span>
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {/* Father's Info */}
                      <div className="space-y-3 bg-white p-3.5 rounded-lg border border-[#DFD5CC]">
                        <div>
                          <label className="block text-xs text-[#3D140C] mb-1 font-semibold">
                            Father's Name:
                          </label>
                          <input
                            type="text"
                            placeholder="Father's Full Name"
                            value={formData.fatherName || formData.fatherHusbandName}
                            onChange={(e) => {
                              const v = e.target.value;
                              setFormData({ ...formData, fatherName: v, fatherHusbandName: v });
                              if (formErrors.fatherName || formErrors.fatherHusbandName) {
                                setFormErrors({ ...formErrors, fatherName: '', fatherHusbandName: '' });
                              }
                            }}
                            className={`w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${
                              (formErrors.fatherName || formErrors.fatherHusbandName) ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#DFD5CC]'
                            }`}
                          />
                          {(formErrors.fatherName || formErrors.fatherHusbandName) && (
                            <p className="text-[11px] text-red-600 mt-1">{formErrors.fatherName || formErrors.fatherHusbandName}</p>
                          )}
                        </div>

                        <div>
                          <label className="block text-xs text-[#3D140C] mb-1 font-semibold">
                            Father's Membership Number (if any):
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="e.g. HMS-00123"
                              value={formData.fatherMembershipNo}
                              onChange={(e) => setFormData({ ...formData, fatherMembershipNo: e.target.value })}
                              className="flex-1 px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                            />
                            <button
                              type="button"
                              onClick={() => performMemberLookup('father', formData.fatherMembershipNo)}
                              disabled={!formData.fatherMembershipNo || memberLookupState.father?.loading}
                              className="px-3 py-2 bg-[#510601] hover:bg-[#8C1801] disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <Search className="w-3.5 h-3.5" />
                              <span>{memberLookupState.father?.loading ? '...' : 'Verify'}</span>
                            </button>
                          </div>
                          {memberLookupState.father?.verified && (
                            <p className="text-xs text-emerald-700 mt-1 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Verified: {memberLookupState.father.name}
                            </p>
                          )}
                          {memberLookupState.father?.error && (
                            <p className="text-xs text-amber-700 mt-1 font-medium flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5" /> {memberLookupState.father.error}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Mother's Info */}
                      <div className="space-y-3 bg-white p-3.5 rounded-lg border border-[#DFD5CC]">
                        <div>
                          <label className="block text-xs text-[#3D140C] mb-1 font-semibold">
                            Mother's Name:
                          </label>
                          <input
                            type="text"
                            placeholder="Mother's Full Name"
                            value={formData.motherName}
                            onChange={(e) => setFormData({ ...formData, motherName: e.target.value })}
                            className="w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                          />
                        </div>

                        <div>
                          <label className="block text-xs text-[#3D140C] mb-1 font-semibold">
                            Mother's Membership Number (if any):
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="e.g. HMS-00124"
                              value={formData.motherMembershipNo}
                              onChange={(e) => setFormData({ ...formData, motherMembershipNo: e.target.value })}
                              className="flex-1 px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                            />
                            <button
                              type="button"
                              onClick={() => performMemberLookup('mother', formData.motherMembershipNo)}
                              disabled={!formData.motherMembershipNo || memberLookupState.mother?.loading}
                              className="px-3 py-2 bg-[#510601] hover:bg-[#8C1801] disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <Search className="w-3.5 h-3.5" />
                              <span>{memberLookupState.mother?.loading ? '...' : 'Verify'}</span>
                            </button>
                          </div>
                          {memberLookupState.mother?.verified && (
                            <p className="text-xs text-emerald-700 mt-1 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Verified: {memberLookupState.mother.name}
                            </p>
                          )}
                          {memberLookupState.mother?.error && (
                            <p className="text-xs text-amber-700 mt-1 font-medium flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5" /> {memberLookupState.mother.error}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 2. Marital Status & Spouse Details */}
                  <div className="bg-[#FAF7F2] p-4 rounded-xl border border-[#E8DFD8] space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-bold text-[#510601] uppercase tracking-wider flex items-center gap-1.5">
                          <Heart className="w-3.5 h-3.5 text-[#8C1801]" />
                          <span>Marital Status & Spouse</span>
                        </h4>
                        <p className="text-xs text-stone-600 mt-0.5">Are you married?</p>
                      </div>

                      <div className="inline-flex rounded-lg border border-[#DFD5CC] bg-white p-0.5 shadow-2xs">
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, isMarried: 'NO' })}
                          className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                            formData.isMarried !== 'YES'
                              ? 'bg-[#510601] text-white shadow-xs'
                              : 'text-stone-700 hover:text-[#510601]'
                          }`}
                        >
                          No
                        </button>
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, isMarried: 'YES' })}
                          className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                            formData.isMarried === 'YES'
                              ? 'bg-[#510601] text-white shadow-xs'
                              : 'text-stone-700 hover:text-[#510601]'
                          }`}
                        >
                          Yes
                        </button>
                      </div>
                    </div>

                    {formData.isMarried === 'YES' && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-3 border-t border-[#DFD5CC] bg-white p-3.5 rounded-lg border">
                        <div>
                          <label className="block text-xs text-[#3D140C] mb-1 font-semibold">
                            Spouse Name:
                          </label>
                          <input
                            type="text"
                            placeholder="Spouse's Full Name"
                            value={formData.spouseName}
                            onChange={(e) => {
                              setFormData({ ...formData, spouseName: e.target.value });
                              if (formErrors.spouseName) setFormErrors({ ...formErrors, spouseName: '' });
                            }}
                            className={`w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${
                              formErrors.spouseName ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#DFD5CC]'
                            }`}
                          />
                          {formErrors.spouseName && (
                            <p className="text-[11px] text-red-600 mt-1">{formErrors.spouseName}</p>
                          )}
                        </div>

                        <div>
                          <label className="block text-xs text-[#3D140C] mb-1 font-semibold">
                            Spouse Membership Number (if any):
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="e.g. HMS-00125"
                              value={formData.spouseMembershipNo}
                              onChange={(e) => setFormData({ ...formData, spouseMembershipNo: e.target.value })}
                              className="flex-1 px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                            />
                            <button
                              type="button"
                              onClick={() => performMemberLookup('spouse', formData.spouseMembershipNo)}
                              disabled={!formData.spouseMembershipNo || memberLookupState.spouse?.loading}
                              className="px-3 py-2 bg-[#510601] hover:bg-[#8C1801] disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <Search className="w-3.5 h-3.5" />
                              <span>{memberLookupState.spouse?.loading ? '...' : 'Verify'}</span>
                            </button>
                          </div>
                          {memberLookupState.spouse?.verified && (
                            <p className="text-xs text-emerald-700 mt-1 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Verified: {memberLookupState.spouse.name}
                            </p>
                          )}
                          {memberLookupState.spouse?.error && (
                            <p className="text-xs text-amber-700 mt-1 font-medium flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5" /> {memberLookupState.spouse.error}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 3. Children Details */}
                  <div className="bg-[#FAF7F2] p-4 rounded-xl border border-[#E8DFD8] space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-bold text-[#510601] uppercase tracking-wider flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-[#8C1801]" />
                          <span>Children Details</span>
                        </h4>
                        <p className="text-xs text-stone-600 mt-0.5">Do you have children?</p>
                      </div>

                      <div className="inline-flex rounded-lg border border-[#DFD5CC] bg-white p-0.5 shadow-2xs">
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, hasChildren: 'NO' })}
                          className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                            formData.hasChildren !== 'YES'
                              ? 'bg-[#510601] text-white shadow-xs'
                              : 'text-stone-700 hover:text-[#510601]'
                          }`}
                        >
                          No
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFormData((prev) => ({
                              ...prev,
                              hasChildren: 'YES',
                              children: prev.children && prev.children.length > 0
                                ? prev.children
                                : [{ name: '', gender: 'Male', membershipNo: '', dob: '' }]
                            }));
                          }}
                          className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                            formData.hasChildren === 'YES'
                              ? 'bg-[#510601] text-white shadow-xs'
                              : 'text-stone-700 hover:text-[#510601]'
                          }`}
                        >
                          Yes
                        </button>
                      </div>
                    </div>

                    {formData.hasChildren === 'YES' && (
                      <div className="space-y-3 pt-3 border-t border-[#DFD5CC]">
                        {formData.children && formData.children.length > 0 ? (
                          <div className="space-y-2.5">
                            {formData.children.map((child, index) => (
                              <div
                                key={index}
                                className="bg-white p-3 rounded-lg border border-[#DFD5CC] grid grid-cols-1 sm:grid-cols-12 gap-3 items-center shadow-2xs"
                              >
                                <div className="sm:col-span-1 text-xs font-bold text-[#8C1801] flex items-center justify-center">
                                  #{index + 1}
                                </div>
                                <div className="sm:col-span-4">
                                  <input
                                    type="text"
                                    placeholder="Child Full Name *"
                                    value={child.name}
                                    onChange={(e) => handleChildChange(index, 'name', e.target.value)}
                                    className="w-full px-3 py-1.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] rounded-lg text-xs text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]/20"
                                  />
                                </div>
                                <div className="sm:col-span-3">
                                  <select
                                    value={child.gender || 'Male'}
                                    onChange={(e) => handleChildChange(index, 'gender', e.target.value)}
                                    className="w-full px-3 py-1.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] rounded-lg text-xs text-[#180200] focus:outline-none focus:border-[#510601] cursor-pointer"
                                  >
                                    {(lists?.child_relations || []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                                  </select>
                                </div>
                                <div className="sm:col-span-3">
                                  <input
                                    type="text"
                                    placeholder="Member No. (if any)"
                                    value={child.membershipNo}
                                    onChange={(e) => handleChildChange(index, 'membershipNo', e.target.value)}
                                    className="w-full px-3 py-1.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] rounded-lg text-xs text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]/20"
                                  />
                                </div>
                                <div className="sm:col-span-1 flex justify-center">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveChild(index)}
                                    title="Remove child"
                                    className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="bg-white p-4 rounded-lg border border-dashed border-[#DFD5CC] text-center text-xs text-stone-500">
                            No children added yet. Click "+ Add Child" below.
                          </div>
                        )}

                        <div>
                          <button
                            type="button"
                            onClick={handleAddChild}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white hover:bg-[#FAF7F2] text-[#510601] border border-[#510601]/30 hover:border-[#510601] text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-2xs"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add Child</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section: Membership Referred By */}
                <div className="pt-3 border-t border-[#DFD5CC]">
                  <h3 className="text-sm font-bold text-[#8C1801] mb-2">
                    Membership Referred By:
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className="flex items-center gap-1.5 text-sm text-[#3D140C] mb-1.5 font-semibold">
                        <span>Membership Number:</span>
                        <span
                          className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[#FFC107] text-[#180200] text-[9px] font-bold cursor-pointer"
                          title="Referral membership number"
                        >
                          i
                        </span>
                      </label>
                      <input
                        type="text"
                        value={formData.referredMembershipNo}
                        onChange={(e) =>
                          setFormData({ ...formData, referredMembershipNo: e.target.value })
                        }

                        className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                      />
                    </div>

                    <div>
                      <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                        Membership Name:
                      </label>
                      <input
                        type="text"
                        value={formData.referredMembershipName}
                        onChange={(e) =>
                          setFormData({ ...formData, referredMembershipName: e.target.value })
                        }

                        className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                      />
                    </div>
                  </div>
                </div>

                {/* Section: Mahasabha Membership Details in Family */}
                <div className="pt-3 border-t border-[#DFD5CC]">
                  <h3 className="text-sm font-bold text-[#8C1801] mb-2">
                    Mahasabha Membership Details in Family:
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className="flex items-center gap-1.5 text-sm text-[#3D140C] mb-1.5 font-semibold">
                        <span>Membership Number:</span>
                        <span
                          className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[#FFC107] text-[#180200] text-[9px] font-bold cursor-pointer"
                          title="Family member membership number"
                        >
                          i
                        </span>
                      </label>
                      <input
                        type="text"
                        value={formData.familyMembershipNo}
                        onChange={(e) =>
                          setFormData({ ...formData, familyMembershipNo: e.target.value })
                        }

                        className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                      />
                    </div>

                    <div>
                      <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                        Membership Name:
                      </label>
                      <input
                        type="text"
                        value={formData.familyMembershipName}
                        onChange={(e) =>
                          setFormData({ ...formData, familyMembershipName: e.target.value })
                        }

                        className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                      />
                    </div>
                  </div>
                </div>
                </fieldset>

                {/* Next / Save buttons on Tab 1 */}
                <div className="flex items-center justify-between pt-5 border-t border-[#DFD5CC]">
                  <button
                    type="button"
                    onClick={() => navigate(returnPath)}
                    className="px-5 py-2.5 border border-[#DFD5CC] hover:border-[#8C1801]/50 text-[#510601] bg-white hover:bg-[#FAF7F2] text-sm font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>{isViewMode ? 'Back' : 'Cancel'}</span>
                  </button>
                  <div className="flex items-center gap-3">
                    {isEditMode && hasPermission('members.list.write') && (
                      <button
                        type="submit"
                        className="px-5 py-2.5 bg-[#510601] hover:bg-[#8C1801] text-white font-bold text-sm rounded-lg shadow-sm transition-colors cursor-pointer inline-flex items-center gap-1.5"
                      >
                        <Save className="w-4 h-4" />
                        <span>Update Member</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={goToPaymentStep}
                      className="px-6 py-2.5 bg-[#510601] hover:bg-[#8C1801] text-white font-bold text-sm rounded-lg shadow-sm transition-colors cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <span>Next: Payment Information</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: PAYMENT INFORMATION */}
            {activeFormSection === 'paymentInfo' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Payment Mode */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Payment Mode: {!isViewMode && <span className="text-red-600">*</span>}
                    </label>
                    <select
                      disabled={isViewMode}
                      value={formData.paymentMode}
                      onChange={(e) => setFormData({ ...formData, paymentMode: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all cursor-pointer disabled:opacity-90 disabled:cursor-not-allowed"
                    >
                      {paymentModes.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Bank Account / Name */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Bank Account / Name:
                    </label>
                    <input
                      type="text"
                      disabled={isViewMode}
                      value={formData.bankAccount}
                      onChange={(e) => setFormData({ ...formData, bankAccount: e.target.value })}

                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all disabled:opacity-90 disabled:cursor-not-allowed"
                    />
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Amount (Rs.): {!isViewMode && <span className="text-red-600">*</span>}
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      disabled={isViewMode}
                      readOnly={amountIsFixed}
                      title={amountIsFixed ? 'Taken from the membership type chosen in step 1' : undefined}
                      value={formData.amount}
                      onChange={(e) => {
                        if (amountIsFixed) return;
                        const val = e.target.value.replace(/[^\d.]/g, '');
                        setFormData({ ...formData, amount: val });
                      }}
                      onWheel={(e) => e.target.blur()}

                      className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm font-semibold text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all disabled:opacity-90 disabled:cursor-not-allowed ${amountIsFixed ? 'cursor-not-allowed opacity-90' : ''}`}
                    />
                  </div>

                  {/* Receipt Date */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Receipt Date: {!isViewMode && <span className="text-red-600">*</span>}
                    </label>
                    <DateInput
                      disabled={isViewMode || !isEditMode}
                      value={formData.receiptDate}
                      onChange={(e) => setFormData({ ...formData, receiptDate: e.target.value })}
                      name="receiptDate"
                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all disabled:opacity-90 disabled:cursor-not-allowed"
                    />
                  </div>

                  {/* Transaction ID / Cheque No */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Transaction ID / Cheque No.:
                    </label>
                    <input
                      type="text"
                      disabled={isViewMode}
                      value={formData.transactionId}
                      onChange={(e) =>
                        setFormData({ ...formData, transactionId: e.target.value })
                      }

                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all disabled:opacity-90 disabled:cursor-not-allowed"
                    />
                  </div>

                  {/* Transaction Date */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Transaction Date:
                    </label>
                    <DateInput
                      disabled={isViewMode}
                      value={formData.transactionDate}
                      onChange={(e) =>
                        setFormData({ ...formData, transactionDate: e.target.value })
                      }
                      name="transactionDate"
                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all disabled:opacity-90 disabled:cursor-not-allowed"
                    />
                  </div>

                  {/* Receipt Number (if assigned or in view mode) */}
                  {(isViewMode || targetMember?.assignedReceiptNumber || targetMember?.receiptNumber) && (
                    <div className="md:col-span-2">
                      <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                        Receipt Number:
                      </label>
                      <input
                        type="text"
                        disabled
                        value={targetMember?.assignedReceiptNumber || targetMember?.receiptNumber || 'Not Assigned'}
                        className="w-full px-3.5 py-2.5 bg-[#FAF7F2] border border-[#DFD5CC] rounded-lg text-sm font-mono font-bold text-[#510601] shadow-2xs cursor-default"
                      />
                    </div>
                  )}

                  {/* Payment Remarks */}
                  <div className="md:col-span-2">
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Payment Received Details / Remarks:
                    </label>
                    <textarea
                      rows={2}
                      disabled={isViewMode}
                      value={formData.paymentRemarks}
                      onChange={(e) =>
                        setFormData({ ...formData, paymentRemarks: e.target.value })
                      }

                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all disabled:opacity-90 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* Footer buttons on tab 2 */}
                <div className="flex items-center justify-between pt-5 border-t border-[#DFD5CC]">
                  <button
                    type="button"
                    onClick={() => setActiveFormSection('membershipDetails')}
                    className="px-5 py-2.5 border border-[#DFD5CC] text-[#3D140C] hover:bg-[#FAF7F2] text-xs sm:text-sm font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Previous</span>
                  </button>
                  <div className="flex items-center gap-3">
                    {isViewMode ? (
                      <button
                        type="button"
                        onClick={() => navigate(returnPath)}
                        className="px-5 py-2.5 border border-[#DFD5CC] text-[#3D140C] hover:bg-[#FAF7F2] text-xs sm:text-sm font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer inline-flex items-center gap-1.5"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        <span>Back</span>
                      </button>
                    ) : (
                      hasPermission(isEditMode ? 'members.list.write' : 'members.register.write') && (
                        <button
                          type="submit"
                          disabled={saving}
                          className="disabled:opacity-50 px-6 py-2.5 bg-[#510601] hover:bg-[#8C1801] text-white font-bold text-xs sm:text-sm rounded-lg shadow-sm transition-colors cursor-pointer inline-flex items-center gap-1.5"
                        >
                          <Save className="w-4 h-4" />
                          <span>{isEditMode ? 'Update Member' : 'Register Member'}</span>
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
    </PermissionGate>
  );
}
