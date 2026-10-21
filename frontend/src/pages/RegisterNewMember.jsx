import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import {
  User,
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
  Save,
  Plus,
  Trash2,
  Search,
  Users,
  Heart,
  Printer,
} from 'lucide-react';
import api from '../api';
import { notify } from '../utils/notify';
import { apiErrorMessage } from '../utils/apiError';
import {
  searchPostalCodes,
  lookupPin,
  loadMembershipTypes,
  loadGothras,
  loadQualifications,
  loadPaymentModeConfigs,
} from '../utils/serverData';
import { validateInternationalPhone, maxPhoneDigits } from '../utils/phoneValidation';
import useLists, { useCountryCodes } from '../hooks/useLists';
import { toISODate } from '../utils/dateUtils';
import DateInput from '../components/DateInput';
import CountryCodeSelect from '../components/CountryCodeSelect';
import PermissionGate from '../components/PermissionGate';
import PageTitle from '../components/PageTitle';
import OptionPicker from '../components/OptionPicker';
import useAuth from '../hooks/useAuth';
import useRules, { hasDigits } from '../hooks/useRules';
import { memberName } from '../utils/memberName';

const DEFAULT_CATEGORY = 'Only Havyaka Mahasabha Membership';

const titleCase = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1).toLowerCase() : '');

// Kannada name / address inputs are switched off for now (the data fields and the server still support them):
// set to true to show them again.
const SHOW_KANNADA_FIELDS = false;

// The different postal address for the magazine is typed on its own fields; it is saved as one text:
// the street lines, then place / taluk / district, then state - PIN.
const composeMagazineAddress = (f) =>
  [
    (f.magLine || '').trim(),
    [f.magLocality, f.magTaluk, f.magDistrict].map((x) => (x || '').trim()).filter(Boolean).join(', '),
    [(f.magState || '').trim(), (f.magPin || '').trim()].filter(Boolean).join(' - '),
  ].filter(Boolean).join('\n');

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
  const BEHALF_OPTIONS = (rules?.applied_on_behalf_of && rules.applied_on_behalf_of.length)
    ? rules.applied_on_behalf_of
    : ['Self', 'Father', 'Mother', 'Husband', 'Wife', 'Son', 'Daughter', 'Brother', 'Sister', 'Grandson', 'Granddaughter', 'Family', 'Relative', 'Others'];
  const NAME_TITLES = (rules?.name_titles && rules.name_titles.length > 2)
    ? rules.name_titles
    : ['SRI.', 'SMT.', 'KUMARI', 'DR.', 'PROF.', 'PANDIT', 'MS.'];
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
  const [sharedOpen, setSharedOpen] = useState(false);
  const [membershipTypes, setMembershipTypes] = useState([]);
  const [gothras, setGothras] = useState([]);
  const [qualifications, setQualifications] = useState([]);
  const [paymentModes, setPaymentModes] = useState([]);
  const [mastersReady, setMastersReady] = useState(false);

  // Toast feedback
  const showToast = (message, type = 'success') => {
    notify(message, type);
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadMembershipTypes(),
      loadGothras(),
      loadQualifications(),
      loadPaymentModeConfigs()
    ])
      .then(([types, goth, quals, modes]) => {
        if (cancelled) return;
        setMembershipTypes(types);
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

  // The PIN autocomplete asks the server (the PINs that begin with what is typed); the 15,000-row table is never downloaded
  const pinSearchSeq = useRef(0);
  const searchPostalLocations = async (query, limit = 20) => {
    const q = String(query || '').trim();
    if (!q) return [];
    const seq = (pinSearchSeq.current += 1);
    try {
      const found = await searchPostalCodes({ pincode_starts: q }, limit);
      return seq === pinSearchSeq.current ? found : null; // null: a newer keystroke is already being answered
    } catch {
      return [];
    }
  };

  // The member being viewed / edited (read from the server)
  const [targetMember, setTargetMember] = useState(null);
  const [, setLoadingMember] = useState(Boolean(params.id));
  const [photoFile, setPhotoFile] = useState(null);

  // Form tab: 'membershipDetails' | 'paymentInfo'
  const [] = useState('membershipDetails');
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
    behalfOtherText: '',
    qualification: '',
    employment: '',
    magazineNeeded: 'YES',
    magazineDeliveryChoice: 'COMMUNICATION',
    magazineDeliveryAddress: '',
    // the different postal address is filled in on its own fields, like the communication address
    magLine: '', magPin: '', magLocality: '', magTaluk: '', magDistrict: '', magState: '',
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

        const pin = { postalCode: m.pincode || '', area: m.post_office_name || '' }; // the server sends the place with the member
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
          fullName: memberName(m, true),
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
          name: memberName(m),
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
          taluk: m.taluk_name || '',
          district: m.district_name || '',
          state: m.state_name || '',
          nativePlace: m.native_place_text || '',
          appliedOnBehalfOf: !m.applied_on_behalf_of ? 'Self' : BEHALF_OPTIONS.includes(m.applied_on_behalf_of) ? m.applied_on_behalf_of : 'Others',
          behalfOtherText: m.applied_on_behalf_of && !BEHALF_OPTIONS.includes(m.applied_on_behalf_of) ? m.applied_on_behalf_of : '',
          qualification: m.qualification_text || '',
          employment: m.occupation || '',
          magazineNeeded: m.magazine_needed === false ? 'NO' : 'YES',
          magazineDeliveryChoice: 'COMMUNICATION',
          magazineDeliveryAddress: m.magazine_delivery_address || '',
          magLine: m.magazine_delivery_address || '', // a saved address is one text: it shows whole in the first box
          magazineKind: m.magazine_kind === 'EMAIL' ? 'EMAIL' : 'PHYSICAL',
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

  // the PIN of the different postal address fills its own place, taluk, district and state

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
      const results = await searchPostalLocations(cleanVal, 20);
      if (results) {
        setPinSuggestions(results);
        setIsPinSuggestionsOpen(results.length > 0);
      }
    } else {
      setPinSuggestions([]);
      setIsPinSuggestionsOpen(false);
    }

    if (cleanVal.length === 6) {
      // 1. Try local data first
      const matchInfo = await lookupPin(cleanVal).catch(() => ({ found: false }));
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
    const cleanAadhar = formData.aadharNumber.trim();
    const cleanAddress = formData.address.trim();
    const cleanPin = formData.postalCode.trim();

    if (!cleanName) {
      errors.name = 'Member Name is required';
    }

    // a magazine posted to a different address needs that address
    if (formData.magazineNeeded === 'YES' && formData.magazineKind !== 'EMAIL' && formData.magazineDeliveryChoice === 'DIFFERENT' && !formData.magLine.trim()) {
      errors.magLine = 'Enter the postal address the magazine should be sent to.';
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

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Moving to the Payment tab (Next button or the tab header) needs step 1 to be complete

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
  const buildPayload = (pinRows = []) => {
    const parts = formData.name.trim().split(/\s+/);
    const pinRow = pinRows.find(
      (p) => p.postalCode === formData.postalCode && (!formData.locality || p.area === formData.locality)
    ) || pinRows.find((p) => p.postalCode === formData.postalCode);
    return {
      name_title: formData.nameTitle || null,
      full_name_en: formData.name.trim().split(/\s+/).join(' '),
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
      applied_on_behalf_of: formData.appliedOnBehalfOf === 'Others' ? (formData.behalfOtherText || '').trim() || 'Others' : formData.appliedOnBehalfOf || null,
      magazine_needed: formData.magazineNeeded === 'YES',
      magazine_kind: formData.magazineNeeded === 'YES' ? formData.magazineKind || 'PHYSICAL' : null,
      magazine_delivery_address: formData.magazineNeeded === 'YES' && formData.magazineKind !== 'EMAIL' && formData.magazineDeliveryChoice === 'DIFFERENT' ? composeMagazineAddress(formData) || null : null,
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
      return;
    }

    setSaving(true);
    try {
      // the rows for this PIN come from the server, to find the post office's id
      const pinRows = formData.postalCode ? await searchPostalCodes({ pincode_starts: formData.postalCode }, 100) : [];
      const payload = buildPayload(pinRows);
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

  const previewAddress = useMemo(() => {
    const isDifferent =
      formData.magazineNeeded === 'YES' &&
      formData.magazineKind !== 'EMAIL' &&
      formData.magazineDeliveryChoice === 'DIFFERENT';
    // a different delivery address has its own fields, so none of the communication address is mixed in
    if (isDifferent) {
      const structured = formData.magLocality || formData.magTaluk || formData.magDistrict || formData.magState || formData.magPin;
      return { line: formData.magLine, locality: formData.magLocality, taluk: formData.magTaluk, district: formData.magDistrict, state: formData.magState, pin: formData.magPin, custom: !structured && Boolean(formData.magLine) };
    }
    const addressLine = formData.address || '';
    return {
      line: addressLine,
      locality: formData.locality || '',
      taluk: formData.taluk || '',
      district: formData.district || '',
      state: formData.state || 'Karnataka',
      pin: formData.postalCode || ''
    };
  }, [
    formData.magazineNeeded,
    formData.magazineKind,
    formData.magazineDeliveryChoice,
    formData.magLine, formData.magPin, formData.magLocality, formData.magTaluk, formData.magDistrict, formData.magState,
    formData.address,
    formData.locality,
    formData.taluk,
    formData.district,
    formData.state,
    formData.postalCode
  ]);

  const isLabelReady = Boolean(
    formData.name?.trim() &&
    formData.address?.trim() &&
    formData.postalCode?.trim() &&
    formData.mobile?.trim()
  );

  return (
    <PermissionGate required={isViewMode ? 'members.list.read' : isEditMode ? 'members.list.write' : 'members.register.write'}>
    <div className="max-w-[1440px] mx-auto space-y-6">
      <div className="space-y-6">
        {/* Left Column: Member Registration Form */}
        <div className="space-y-6">
          <div className="w-full bg-white rounded-2xl border border-[#E8DFD8] shadow-sm overflow-hidden">
            {/* Dynamic Page Title in Top Header Bar */}
            <PageTitle>
              {isViewMode ? 'View Member Details' : isEditMode ? 'Edit Member Details' : 'Register New Member'}
            </PageTitle>

            {/* Header strip: only when viewing / editing a member (their ID, membership number and status). A new registration has none, so the form starts at Personal Details. */}
            {(isViewMode || isEditMode) && (
            <div className="px-6 sm:px-8 py-3.5 border-b border-[#E8DFD8] bg-[#FAF7F2]/40">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {(isViewMode || isEditMode) && targetMember?.registrationNumber && (
                    <span className="font-mono text-xs sm:text-sm font-bold bg-white text-[#510601] px-3 py-1 rounded-xl border border-[#E8DFD8] shadow-2xs" title="Record ID">
                      ID: {targetMember.registrationNumber}
                    </span>
                  )}
                  {(isViewMode || isEditMode) && targetMember?.membershipNumber && targetMember.membershipNumber !== 'Not Assigned' && targetMember.approvalStatus === 'Approved' && (
                    <span className="font-mono text-xs sm:text-sm font-bold bg-emerald-50 text-emerald-800 px-3 py-1 rounded-xl border border-emerald-200" title="Membership Number">
                      {targetMember.membershipNumber}
                    </span>
                  )}
                </div>
                <div className="text-xs sm:text-sm text-[#863221] font-medium shrink-0 ml-auto">
                  {isViewMode && (
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                      targetMember?.status === 'Unapproved' || targetMember?.approvalStatus === 'Unapproved'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}>
                      {targetMember?.status === 'Unapproved' || targetMember?.approvalStatus === 'Unapproved' ? 'Unapproved' : (targetMember?.status || targetMember?.approvalStatus || 'Active Member')}
                    </span>
                  )}
                </div>
              </div>
            </div>
            )}

            {/* Form Body */}
            <form onSubmit={handleSaveMember}>
              <div className="px-6 sm:px-8 py-6 space-y-6">
                <fieldset disabled={isViewMode} className="space-y-4 disabled:opacity-95">
                  <div className="pb-2 border-b border-[#E8DFD8]"><h3 className="text-sm font-bold text-[#8C1801] uppercase tracking-wider">Personal Details</h3></div>

                  {/* Photo upload + Basic Details */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                  {/* Left: Passport Size Photo Upload */}
                  <div className="md:col-span-2 flex flex-col items-center justify-start">
                    <div className="w-24 h-28 border-2 border-dashed border-[#E8DFD8] bg-[#FAF7F2] flex flex-col items-center justify-center relative overflow-hidden rounded-lg shadow-2xs hover:border-[#8C1801]/50 transition-colors">
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
                      className="mt-2 py-1 px-3 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-md text-center shadow-xs transition-colors cursor-pointer inline-flex items-center justify-center"
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

                  {/* Right: Member Name, DOB, Age in single line, Mobile, Relationship, WhatsApp, Father Name */}
                  <div className="md:col-span-10 space-y-4">
                    {/* Row 1: Name (Title + Full Name), DOB, and Age in a SINGLE LINE */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-x-4 gap-y-5 items-start">
                      {/* Member Name */}
                      <div className="sm:col-span-5">
                        <label className="block text-xs sm:text-sm text-[#3D140C] mb-1 font-semibold">
                          Member Name: <span className="text-red-600">*</span>
                        </label>
                        <div className="flex gap-1.5">
                          <div className="w-24 shrink-0">
                            <select
                              value={formData.nameTitle}
                              onChange={(e) => handleTitleChange(e.target.value)}
                              className="w-full px-2 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] hover:border-[#8C1801]/60 rounded-lg text-xs sm:text-sm font-bold text-[#510601] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 cursor-pointer shadow-2xs transition-all"
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
                              placeholder="Full Name"
                              value={formData.name}
                              onChange={(e) => {
                                setFormData({ ...formData, name: e.target.value });
                                if (formErrors.name) setFormErrors({ ...formErrors, name: '' });
                              }}
                              className={`w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-xs sm:text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${
                                formErrors.name ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#E8DFD8] hover:border-[#8C1801]/60'
                              }`}
                            />
                          </div>
                        </div>
                        {formErrors.name && (
                          <p className="text-[11px] text-red-600 mt-1">{formErrors.name}</p>
                        )}
                      </div>

                      {/* Date of Birth */}
                      <div className="sm:col-span-3">
                        <label className="block text-xs sm:text-sm text-[#3D140C] mb-1 font-semibold">
                          Date of Birth: <span className="text-red-600">*</span>
                        </label>
                        <DateInput
                          disabled={isViewMode}
                          max={maxAllowedDobDate}
                          value={formData.birthDate}
                          onChange={handleDobChange}
                          name="birthDate"
                          className={`w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-xs sm:text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${
                            formErrors.birthDate ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#E8DFD8] hover:border-[#8C1801]/60'
                          }`}
                        />
                        {formErrors.birthDate && (
                          <p className="text-[11px] text-red-600 mt-1 font-medium">{formErrors.birthDate}</p>
                        )}
                      </div>

                      {/* Age (worked out from the Date of Birth) */}
                      <div className="sm:col-span-2">
                        <label className="block text-xs sm:text-sm text-[#3D140C] mb-1 font-semibold">Age:</label>
                        <input
                          type="text"
                          readOnly
                          tabIndex={-1}
                          value={formData.birthDate ? calculateAge(formData.birthDate) : ''}
                          placeholder="-"
                          title="Worked out from the Date of Birth"
                          className="w-full px-3 py-2 bg-[#F3EEE8] border border-[#E8DFD8] rounded-lg text-xs sm:text-sm font-semibold text-[#510601] focus:outline-none shadow-2xs cursor-default"
                        />
                      </div>
                    </div>

                    {/* Row 2: Mobile Number & Relationship & WhatsApp */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-x-4 gap-y-5 items-start">
                      {/* Mobile Number */}
                      <div className="sm:col-span-4">
                        <label className="block text-xs sm:text-sm text-[#3D140C] mb-1 font-semibold">
                          Mobile Number: <span className="text-red-600">*</span>
                        </label>
                        <div className="flex gap-1.5">
                          <div className="w-24 shrink-0">
                            <CountryCodeSelect
                              value={formData.mobileCountryCode}
                              countryIso={formData.mobileCountryIso}
                              onChange={handleMobileCountryChange}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <input
                              type="tel"
                              placeholder="Mobile Number"
                              value={formData.mobile}
                              onChange={(e) => handleMobileChange(e.target.value)}
                              onBlur={() => checkPhoneField('mobile')}
                              className={`w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-xs sm:text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${
                                formErrors.mobile ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#E8DFD8] hover:border-[#8C1801]/60'
                              }`}
                            />
                          </div>
                        </div>
                        {formErrors.mobile && (
                          <p className="text-[11px] text-red-600 mt-1">{formErrors.mobile}</p>
                        )}
                        {/* Shared family mobile: who already uses it (never blocks) */}
                        {dupInfo.same_mobile.length > 0 && (
                          <div className="mt-2 text-[11px] text-stone-600">
                            <p className="mb-0.5 font-semibold text-[#863221]">Also used by:</p>
                            <ul className="divide-y divide-[#E8DFD8] border-y border-[#E8DFD8]">
                              {(sharedOpen ? dupInfo.same_mobile : dupInfo.same_mobile.slice(0, 3)).map((d) => (
                                <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1">
                                  <a
                                    href={`/dashboard/membership/profile/${d.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-bold text-[#510601] hover:underline"
                                  >
                                    {d.name || 'Unnamed'}
                                  </a>
                                  <span className="font-mono font-semibold text-[#180200]">{d.membership_number || `ID ${d.id}`}</span>
                                  {d.relation && <span>· {d.relation}</span>}
                                  {d.district && <span>· {d.district}</span>}
                                  <span className={String(d.approval_status).toUpperCase() === 'APPROVED' ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                                    · {String(d.approval_status).toUpperCase() === 'APPROVED' ? 'Active' : 'Unapproved'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            {!sharedOpen && dupInfo.same_mobile.length > 3 && (
                              <button type="button" onClick={() => setSharedOpen(true)} className="mt-0.5 font-semibold text-[#510601] hover:underline cursor-pointer">
                                +{dupInfo.same_mobile.length - 3} more
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Membership Belongs To / Relationship */}
                      <div className="sm:col-span-4">
                        <label className="block text-xs sm:text-sm text-[#3D140C] mb-1 font-semibold truncate" title="Membership Belongs To / Relationship">
                          Belongs To / Relation:
                        </label>
                        {/* the relation and, for Others, its text box sit side by side so the row never grows taller */}
                        <div className="flex gap-1.5">
                        <select
                          value={formData.appliedOnBehalfOf}
                          onChange={(e) => {
                            setFormData({ ...formData, appliedOnBehalfOf: e.target.value });
                            if (formErrors.appliedOnBehalfOf) setFormErrors({ ...formErrors, appliedOnBehalfOf: '' });
                          }}
                          className={`${formData.appliedOnBehalfOf === 'Others' ? 'w-28 shrink-0' : 'w-full'} px-2.5 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] hover:border-[#8C1801]/60 rounded-lg text-xs sm:text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all cursor-pointer`}
                        >
                          {BEHALF_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                        {formData.appliedOnBehalfOf === 'Others' && (
                          <input
                            type="text"
                            maxLength={30}
                            value={formData.behalfOtherText}
                            onChange={(e) => setFormData({ ...formData, behalfOtherText: e.target.value })}
                            className="flex-1 min-w-0 px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] hover:border-[#8C1801]/60 rounded-lg text-xs sm:text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                          />
                        )}
                        </div>
                      </div>

                      {/* WhatsApp Number */}
                      <div className="sm:col-span-4">
                        <label className="block text-xs sm:text-sm text-[#3D140C] mb-1 font-semibold">
                          WhatsApp Number:
                        </label>
                        <div className="flex gap-1.5">
                          <div className="w-24 shrink-0">
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
                              placeholder="WhatsApp"
                              value={formData.whatsappNumber}
                              onChange={(e) => handleWhatsAppChange(e.target.value)}
                              onBlur={() => checkPhoneField('whatsappNumber')}
                              readOnly={isWhatsAppSameAsMobile}
                              className={`w-full px-3 py-2 border rounded-lg text-xs sm:text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${
                                isWhatsAppSameAsMobile
                                  ? 'bg-stone-100 text-stone-500 border-[#E8DFD8] cursor-not-allowed'
                                  : 'bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border-[#E8DFD8] hover:border-[#8C1801]/60'
                              } ${formErrors.whatsappNumber ? 'border-red-500 ring-2 ring-red-500/20' : ''}`}
                            />
                          </div>
                        </div>
                        <label className="flex items-center gap-1.5 mt-1 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={isWhatsAppSameAsMobile}
                            onChange={(e) => handleWhatsAppSameAsMobileToggle(e.target.checked)}
                            className="w-3.5 h-3.5 rounded text-[#510601] focus:ring-[#510601] border-[#E8DFD8] accent-[#510601] cursor-pointer"
                          />
                          <span className="text-[11px] text-[#3D140C] font-medium">
                            Same as mobile
                          </span>
                        </label>
                      </div>
                    </div>

                    {/* Kannada name (hidden for now) */}
                    {SHOW_KANNADA_FIELDS && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5 items-start">
                      {SHOW_KANNADA_FIELDS && (
                        <div>
                          <label className="block text-xs sm:text-sm text-[#3D140C] mb-1 font-semibold">
                            Name (Kannada):
                          </label>
                          <input
                            type="text"
                            placeholder="ಹೆಸರು (Kannada)"
                            value={formData.nameKn}
                            onChange={(e) => setFormData({ ...formData, nameKn: e.target.value })}
                            className="w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] hover:border-[#8C1801]/60 rounded-lg text-xs sm:text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                          />
                        </div>
                      )}
                    </div>
                    )}
                  </div>
                </div>

                {/* Community & identity: four across */}
                <div className="pt-4 border-t border-[#E8DFD8] space-y-3">
                  <div className="pb-2 border-b border-[#E8DFD8]"><h3 className="text-sm font-bold text-[#8C1801] uppercase tracking-wider">Community & Identity</h3></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                  {/* Gothra */}
                  <div>
                    <label className="block text-xs sm:text-sm text-[#3D140C] mb-1 font-semibold">
                      Gothra:
                    </label>
                    <select
                      value={formData.gothra}
                      onChange={(e) => {
                        setFormData({ ...formData, gothra: e.target.value });
                        if (formErrors.gothra) setFormErrors({ ...formErrors, gothra: '' });
                      }}
                      className={`w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-xs sm:text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all cursor-pointer ${
                        formErrors.gothra ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#E8DFD8] hover:border-[#8C1801]/60'
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
                    <label className="block text-xs sm:text-sm text-[#3D140C] mb-1 font-semibold">
                      Gender:
                    </label>
                    <select
                      value={formData.gender}
                      onChange={(e) => {
                        const g = e.target.value;
                        const t = formData.nameTitle;
                        // keep the title in step with the gender, but leave DR. / PROF. / PANDIT alone
                        const nameTitle = g === 'Female' && t === 'SRI.' ? 'MS.'
                          : g === 'Male' && ['MS.', 'SMT.', 'KUMARI'].includes(t) ? 'SRI.' : t;
                        setFormData({ ...formData, gender: g, nameTitle });
                        if (formErrors.gender) setFormErrors({ ...formErrors, gender: '' });
                      }}
                      className={`w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-xs sm:text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all cursor-pointer ${
                        formErrors.gender ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#E8DFD8] hover:border-[#8C1801]/60'
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
                    <label className="block text-xs sm:text-sm text-[#3D140C] mb-1 font-semibold">
                      Blood Group:
                    </label>
                    <select
                      value={formData.bloodGroup}
                      onChange={(e) => setFormData({ ...formData, bloodGroup: e.target.value })}
                      className="w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] hover:border-[#8C1801]/60 rounded-lg text-xs sm:text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all cursor-pointer"
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
                    <label className="block text-xs sm:text-sm text-[#3D140C] mb-1 font-semibold">
                      Aadhar Number:
                    </label>
                    <input
                      type="text"
                      maxLength={12}
                      value={formData.aadharNumber}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        setFormData({ ...formData, aadharNumber: val });
                        if (formErrors.aadharNumber) setFormErrors({ ...formErrors, aadharNumber: '' });
                      }}
                      className={`w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-xs sm:text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${
                        formErrors.aadharNumber ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#E8DFD8] hover:border-[#8C1801]/60'
                      }`}
                    />
                    {formErrors.aadharNumber && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.aadharNumber}</p>
                    )}
                  </div>

                </div>
                </div>

                {/* Address & work */}
                <div className="pt-4 border-t border-[#E8DFD8] space-y-3">
                  <div className="pb-2 border-b border-[#E8DFD8]"><h3 className="text-sm font-bold text-[#8C1801] uppercase tracking-wider">Address & Work</h3></div>
                {/* the fields take two thirds, the sticker preview one third */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
                <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-5">
                  {/* Communication Address */}
                  <div className="col-span-full">
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Communication Address: <span className="text-red-600">*</span>
                    </label>
                    <textarea
                      rows={3}
                      value={formData.address}
                      onChange={(e) => {
                        setFormData({ ...formData, address: e.target.value });
                        if (formErrors.address) setFormErrors({ ...formErrors, address: '' });
                      }}

                      className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${formErrors.address ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#E8DFD8] hover:border-[#8C1801]/60'
                        }`}
                    />
                    {formErrors.address && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.address}</p>
                    )}
                  </div>

                  {/* Communication Address (Kannada) */}
                  {SHOW_KANNADA_FIELDS && (
                  <div className="col-span-full">
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Communication Address (Kannada):
                    </label>
                    <textarea
                      rows={2}
                      placeholder="ವಿಳಾಸ (Kannada)"
                      value={formData.addressKn}
                      onChange={(e) => setFormData({ ...formData, addressKn: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
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
                            searchPostalLocations(formData.postalCode, 20).then((results) => {
                              if (!results) return;
                              setPinSuggestions(results);
                              setIsPinSuggestionsOpen(results.length > 0);
                            });
                          }
                        }}

                        className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm font-mono text-[#180200] placeholder:text-[#9E8B7F] placeholder:font-sans focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${
                          formErrors.postalCode ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#E8DFD8] hover:border-[#8C1801]/60'
                        }`}
                      />
                    </div>
                    {formErrors.postalCode && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.postalCode}</p>
                    )}

                    {/* Autocomplete Suggestions Dropdown */}
                    {isPinSuggestionsOpen && pinSuggestions.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-[#E8DFD8] rounded-xl shadow-xl z-50 max-h-60 overflow-y-auto divide-y divide-stone-100">
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
                            <span className="shrink-0 text-xs font-mono font-bold text-[#8C1801] bg-[#FAF7F2] px-2 py-0.5 rounded border border-[#E8DFD8]">
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

                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                    />
                    {(formData.taluk || formData.district) && (
                      <p className="text-xs text-stone-600 mt-1 flex items-center gap-1.5 font-medium">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                        Taluk: <span className="text-[#510601] font-semibold">{formData.taluk || '—'}</span> &bull; District: <span className="text-[#510601] font-semibold">{formData.district || '—'}</span>
                      </p>
                    )}
                  </div>

                  {/* Native Place */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Native Place:
                    </label>
                    <input
                      type="text"
                      value={formData.nativePlace}
                      onChange={(e) => setFormData({ ...formData, nativePlace: e.target.value })}

                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                    />
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
                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                    />
                  </div>
                  )}

                  {/* Qualification */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Qualification:
                    </label>
                    <OptionPicker
                      value={formData.qualification}
                      onChange={(val) => {
                        setFormData({ ...formData, qualification: val });
                        if (formErrors.qualification)
                          setFormErrors({ ...formErrors, qualification: '' });
                      }}
                      options={qualifications}
                      title="Select Qualification"
                      placeholder="Select qualification"
                      hasError={Boolean(formErrors.qualification)}
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
                      placeholder="Occupation / Profession"
                      value={formData.employment}
                      onChange={(e) => setFormData({ ...formData, employment: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] hover:border-[#8C1801]/60 rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                    />
                  </div>

                </div>
                <aside className="lg:col-span-1 lg:sticky lg:top-4">
            <div className="bg-white rounded-xl border border-[#E8DFD8] p-4">
              {/* Card Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[#E8DFD8]">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-[#510601] text-white rounded-lg shadow-xs">
                    <Printer className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-[#180200]">Postal Label Preview</h2>
                    <p className="text-[11px] text-stone-500">As it prints on the sticker</p>
                  </div>
                </div>
                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                  isLabelReady
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}>
                  {isLabelReady ? 'Ready for Dispatch' : 'Awaiting Details'}
                </span>
              </div>

              {/* The sticker as it prints: membership number, name in bold, address (the sticker sheet's own format) */}
              <div
                className="mt-4 rounded-md border border-stone-300 bg-white px-5 py-4 min-h-[170px] text-black"
                style={{ fontFamily: '"Times New Roman", Times, serif' }}
              >
                <div className="text-[13px] leading-tight">
                  {targetMember?.membershipNumber && targetMember.membershipNumber !== 'Not Assigned'
                    ? targetMember.membershipNumber
                    : <span className="italic text-stone-400">Membership no. is given on approval</span>}
                </div>
                <div className="mt-1 font-bold text-[14px] uppercase leading-tight">
                  {[formData.nameTitle, formData.name?.trim()].filter(Boolean).join(' ') || <span className="font-normal normal-case italic text-stone-400">Name</span>}
                </div>
                <div className="mt-1 text-[14px] leading-snug whitespace-pre-line">
                  {previewAddress.line || <span className="italic text-stone-400">Door no., street / cross, locality</span>}
                  {!previewAddress.custom && (
                    <>
                      <br />
                      {[previewAddress.locality, previewAddress.taluk, previewAddress.district].filter(Boolean).join(', ') || <span className="italic text-stone-400">Post office / taluk, district</span>}
                      <br />
                      {previewAddress.state || ''}{previewAddress.state ? ' - ' : ''}<span className="font-semibold">{previewAddress.pin || <span className="italic font-normal text-stone-400">Pin code</span>}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
                </aside>
                </div>
                </div>

                {/* Magazine subscription */}
                  <div className="bg-[#FAF7F2] p-5 sm:p-6 rounded-xl border border-[#E8DFD8] space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-[#510601] flex items-center gap-2">
                          <span>Havyaka Magazine Subscription</span>
                        </h3>
                        <p className="text-xs text-stone-600 mt-0.5">
                          Do you need Havyaka Magazine Every month?
                        </p>
                      </div>
                      <div className="inline-flex rounded-lg border border-[#E8DFD8] bg-white p-0.5 shadow-2xs">
                        <button
                          type="button"
                          onClick={() => {
                            setFormData((prev) => ({ ...prev, magazineNeeded: 'NO' }));
                            if (formErrors.magazineNeeded) setFormErrors({ ...formErrors, magazineNeeded: '' });
                          }}
                          className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                            formData.magazineNeeded !== 'YES'
                              ? 'bg-[#510601] text-white shadow-xs'
                              : 'text-stone-700 hover:text-[#510601]'
                          }`}
                        >
                          No
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFormData((prev) => ({ ...prev, magazineNeeded: 'YES' }));
                            if (formErrors.magazineNeeded) setFormErrors({ ...formErrors, magazineNeeded: '' });
                          }}
                          className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                            formData.magazineNeeded === 'YES'
                              ? 'bg-[#510601] text-white shadow-xs'
                              : 'text-stone-700 hover:text-[#510601]'
                          }`}
                        >
                          Yes
                        </button>
                      </div>
                    </div>

                    {formData.magazineNeeded === 'YES' && (
                      <div className="space-y-4 pt-3 border-t border-[#E8DFD8]/80 bg-white p-4 rounded-lg border border-[#E8DFD8]">
                        {/* Magazine Edition Options */}
                        <div>
                          <label className="block text-xs font-bold text-[#510601] uppercase tracking-wider mb-2">
                            Select Magazine Edition:
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {[
                              ['PHYSICAL', 'Physical Copy'],
                              ['EMAIL', 'E-Magazine']
                            ].map(([code, title]) => (
                              <label
                                key={code}
                                className={`flex flex-col p-3 rounded-lg border cursor-pointer transition-all ${
                                  formData.magazineKind === code
                                    ? 'border-[#510601] bg-[#FAF7F2] ring-1 ring-[#510601]/20 shadow-2xs'
                                    : 'border-[#E8DFD8] hover:border-[#8C1801]/40 bg-white'
                                }`}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <input
                                    type="radio"
                                    name="magazineKind"
                                    value={code}
                                    checked={formData.magazineKind === code}
                                    onChange={() => setFormData({ ...formData, magazineKind: code })}
                                    className="w-4 h-4 text-[#510601] focus:ring-[#510601] accent-[#510601] cursor-pointer"
                                  />
                                  <span className="text-xs font-bold text-[#180200]">{title}</span>
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* A posted magazine always goes to the communication address; there is no other delivery address to choose */}
                      </div>
                    )}
                  </div>

                {/* ═══════════════════════════════════════════════════════ */}
                {/* Section: Family & Relationship Details */}
                {/* ═══════════════════════════════════════════════════════ */}
                <div className="pt-4 border-t border-[#E8DFD8] space-y-5">
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
                      <div className="space-y-3 bg-white p-3.5 rounded-lg border border-[#E8DFD8]">
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
                              (formErrors.fatherName || formErrors.fatherHusbandName) ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#E8DFD8]'
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
                              value={formData.fatherMembershipNo}
                              onChange={(e) => setFormData({ ...formData, fatherMembershipNo: e.target.value })}
                              className="flex-1 px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
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
                      <div className="space-y-3 bg-white p-3.5 rounded-lg border border-[#E8DFD8]">
                        <div>
                          <label className="block text-xs text-[#3D140C] mb-1 font-semibold">
                            Mother's Name:
                          </label>
                          <input
                            type="text"
                            placeholder="Mother's Full Name"
                            value={formData.motherName}
                            onChange={(e) => setFormData({ ...formData, motherName: e.target.value })}
                            className="w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                          />
                        </div>

                        <div>
                          <label className="block text-xs text-[#3D140C] mb-1 font-semibold">
                            Mother's Membership Number (if any):
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={formData.motherMembershipNo}
                              onChange={(e) => setFormData({ ...formData, motherMembershipNo: e.target.value })}
                              className="flex-1 px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
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

                      <div className="inline-flex rounded-lg border border-[#E8DFD8] bg-white p-0.5 shadow-2xs">
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
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-3 border-t border-[#E8DFD8] bg-white p-3.5 rounded-lg border">
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
                              formErrors.spouseName ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#E8DFD8]'
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
                              value={formData.spouseMembershipNo}
                              onChange={(e) => setFormData({ ...formData, spouseMembershipNo: e.target.value })}
                              className="flex-1 px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
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

                  {/* 3. Children Details (Only shown if Married) */}
                  {formData.isMarried === 'YES' && (
                    <div className="bg-[#FAF7F2] p-4 rounded-xl border border-[#E8DFD8] space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 className="text-xs font-bold text-[#510601] uppercase tracking-wider flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-[#8C1801]" />
                            <span>Children Details</span>
                          </h4>
                          <p className="text-xs text-stone-600 mt-0.5">Do you have children?</p>
                        </div>

                        <div className="inline-flex rounded-lg border border-[#E8DFD8] bg-white p-0.5 shadow-2xs">
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
                        <div className="space-y-3 pt-3 border-t border-[#E8DFD8]">
                          {formData.children && formData.children.length > 0 ? (
                            <div className="space-y-2.5">
                              {formData.children.map((child, index) => (
                                <div
                                  key={index}
                                  className="bg-white p-3 rounded-lg border border-[#E8DFD8] grid grid-cols-1 sm:grid-cols-12 gap-3 items-center shadow-2xs"
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
                                      className="w-full px-3 py-1.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] rounded-lg text-xs text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]/20"
                                    />
                                  </div>
                                  <div className="sm:col-span-3">
                                    <select
                                      value={child.gender || 'Male'}
                                      onChange={(e) => handleChildChange(index, 'gender', e.target.value)}
                                      className="w-full px-3 py-1.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] rounded-lg text-xs text-[#180200] focus:outline-none focus:border-[#510601] cursor-pointer"
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
                                      className="w-full px-3 py-1.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] rounded-lg text-xs text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]/20"
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
                            <div className="bg-white p-4 rounded-lg border border-dashed border-[#E8DFD8] text-center text-xs text-stone-500">
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
                  )}
                </div>

                  </fieldset>

                  {/* Form Footer Action Buttons */}
                  <div className="flex items-center justify-between pt-5 border-t border-[#E8DFD8]">
                    <button
                      type="button"
                      onClick={() => navigate(returnPath)}
                      className="px-5 py-2.5 border border-[#E8DFD8] hover:border-[#8C1801]/50 text-[#510601] bg-white hover:bg-[#FAF7F2] text-xs sm:text-sm font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>{isViewMode ? 'Back' : 'Cancel'}</span>
                    </button>
                    <div className="flex items-center gap-3">
                      {isViewMode ? null : (
                        hasPermission(isEditMode ? 'members.list.write' : 'members.register.write') && (
                          <button
                            type="submit"
                            disabled={saving}
                            className="disabled:opacity-50 px-6 py-2.5 bg-[#510601] hover:bg-[#8C1801] text-white font-bold text-xs sm:text-sm rounded-lg shadow-sm transition-colors cursor-pointer inline-flex items-center gap-1.5"
                          >
                            <Save className="w-4 h-4" />
                            <span>{saving ? 'Saving...' : isEditMode ? 'Update Member' : 'Register Member'}</span>
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </div>

        </div>
      </div>
    </PermissionGate>
  );
}
