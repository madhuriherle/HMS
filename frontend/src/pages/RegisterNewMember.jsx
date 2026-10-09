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
  Tag
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
import { validateInternationalPhone } from '../utils/phoneValidation';
import { COUNTRY_CODES } from '../utils/countryCodes';
import { toISODate } from '../utils/dateUtils';
import DateInput from '../components/DateInput';
import CountryCodeSelect from '../components/CountryCodeSelect';
import PermissionGate from '../components/PermissionGate';
import SearchableFormSelect from '../components/SearchableFormSelect';
import useAuth from '../hooks/useAuth';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const BEHALF_OPTIONS = ['Self', 'Family', 'Father', 'Mother', 'Son', 'Daughter', 'Spouse', 'Relative', 'Others'];
const NAME_TITLES = ['SRI.', 'MS.'];
const DEFAULT_CATEGORY = 'Only Havyaka Mahasabha Membership';

const titleCase = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1).toLowerCase() : '');

export default function RegisterNewMember() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const { hasPermission } = useAuth();

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
    fatherHusbandName: '',
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
    postalCode: '',
    locality: '',
    taluk: '',
    district: '',
    state: '',
    nativePlace: '',
    appliedOnBehalfOf: 'Self',
    qualification: '',
    employment: '',
    magazineNeeded: 'YES',
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
          registrationNumber: `REG-${new Date(m.created_at || Date.now()).getFullYear()}-${String(m.id).padStart(4, '0')}`,
          membershipNumber: m.member_code || membership?.membership_number || '',
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
          fatherHusbandName: m.father_husband_name || '',
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
          postalCode: pin?.postalCode || '',
          locality: m.locality || m.post || pin?.area || '',
          taluk: nameOf(locations.taluks, m.taluk_id),
          district: nameOf(locations.districts, m.district_id),
          state: nameOf(locations.states, m.state_id),
          nativePlace: m.native_place_text || '',
          appliedOnBehalfOf: m.applied_on_behalf_of || 'Self',
          qualification: m.qualification_text || '',
          employment: m.occupation || '',
          magazineNeeded: m.magazine_needed === false ? 'NO' : 'YES',
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

    if (isNaN(numAge) || numAge < 18) {
      setFormErrors((prev) => ({ ...prev, birthDate: 'Member must be at least 18 years old.' }));
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

  const handleMobileChange = (val) => {
    // Strip duplicate country dial digits if user pasted with dial code
    let cleanVal = val.replace(/[^\d]/g, '');
    const dialDigits = (formData.mobileCountryCode || '').replace(/\D/g, '');
    if (dialDigits && cleanVal.startsWith(dialDigits) && cleanVal.length > dialDigits.length + 5) {
      cleanVal = cleanVal.slice(dialDigits.length);
    }

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

  const handleWhatsAppChange = (val) => {
    let cleanVal = val.replace(/[^\d]/g, '');
    const dialDigits = (formData.whatsappCountryCode || '').replace(/\D/g, '');
    if (dialDigits && cleanVal.startsWith(dialDigits) && cleanVal.length > dialDigits.length + 5) {
      cleanVal = cleanVal.slice(dialDigits.length);
    }

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
    setFormData((prev) => ({
      ...prev,
      postalCode: cleanVal
    }));
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
        setFormData((prev) => ({
          ...prev,
          locality: prev.locality || matchInfo.area || '',
          taluk: matchInfo.talukName || '',
          district: matchInfo.districtName || '',
          state: matchInfo.stateName || ''
        }));
      } else {
        // 2. If not found locally, use free public API
        try {
          const res = await fetch(`https://api.postalpincode.in/pincode/${cleanVal}`);
          if (res.ok) {
            const data = await res.json();
            if (data && data[0] && data[0].Status === 'Success') {
              const postOffice = data[0].PostOffice[0];
              setFormData((prev) => ({
                ...prev,
                locality: prev.locality || postOffice.Name || '',
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
    const cleanFather = formData.fatherHusbandName.trim();
    const cleanAadhar = formData.aadharNumber.trim();
    const cleanAddress = formData.address.trim();
    const cleanPin = formData.postalCode.trim();

    if (!formData.membershipTypeId) {
      errors.membershipTypeId = 'Please select a Havyaka Membership Type';
    }

    if (!cleanName) {
      errors.name = 'New Member Name is required';
    }

    if (!cleanFather) {
      errors.fatherHusbandName = 'Father / Husband Name is required';
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
          if (isNaN(exactAge) || exactAge < 18) {
            errors.birthDate = 'Member must be at least 18 years old.';
          }
        }
      }
    }

    if (!formData.gothra) {
      errors.gothra = 'Please select Gotra';
    }

    if (!formData.gender) {
      errors.gender = 'Please select Gender';
    }

    if (!cleanAadhar) {
      errors.aadharNumber = 'Aadhar Number is required';
    } else if (!/^\d{12}$/.test(cleanAadhar.replace(/\s/g, ''))) {
      errors.aadharNumber = 'Aadhar must be a 12-digit number';
    }

    if (!cleanAddress) {
      errors.address = 'Communication Address is required';
    }

    if (!cleanPin) {
      errors.postalCode = 'PIN Code is required';
    } else if (!/^\d{6}$/.test(cleanPin)) {
      errors.postalCode = 'PIN Code must be 6 numeric digits';
    }

    if (!formData.appliedOnBehalfOf) {
      errors.appliedOnBehalfOf = 'Please select applying behalf';
    }

    if (!formData.qualification) {
      errors.qualification = 'Please select Qualification';
    }

    if (!formData.magazineNeeded) {
      errors.magazineNeeded = 'Please select YES/NO for Magazine';
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
      father_husband_name: formData.fatherHusbandName.trim(),
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
      locality: (formData.locality || '').trim() || null,
      post: (formData.locality || '').trim() || null,
      state_id: pinRow?.stateId || null,
      district_id: pinRow?.districtId || null,
      taluk_id: pinRow?.talukId || null,
      pincode_id: pinRow?.id || null,
      applied_on_behalf_of: formData.appliedOnBehalfOf || null,
      magazine_needed: formData.magazineNeeded === 'YES',
      membership_type_category: formData.membershipTypeCategory || null,
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
      registration_source: 'OFFLINE'
    };
  };

  const handleSaveMember = async (e) => {
    e.preventDefault();
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
    <PermissionGate required={isViewMode ? 'members.read' : 'members.write'}>
    <div className="max-w-[1240px] mx-auto space-y-6">
      {/* ---------------------------------------------------- */}
      {/* BREADCRUMB & HEADER                                  */}
      {/* ---------------------------------------------------- */}
      <div>
        <nav className="flex items-center gap-2 text-sm text-[#863221] font-medium mb-2">
          <Link to="/dashboard" className="hover:text-[#510601] transition-colors">
            Dashboard
          </Link>
          <ChevronRight className="w-4 h-4 text-[#863221]/50" />
          {returnPath.includes('receipt') ? (
            <>
              <Link to="/dashboard/receipts/entry" className="hover:text-[#510601] transition-colors">
                Receipt Entry
              </Link>
              <ChevronRight className="w-4 h-4 text-[#863221]/50" />
              <span className="text-[#180200] font-semibold">View Member Details</span>
            </>
          ) : (
            <>
              <Link to="/dashboard/membership/list" className="hover:text-[#510601] transition-colors">
                Membership
              </Link>
              <ChevronRight className="w-4 h-4 text-[#863221]/50" />
              <span className="text-[#180200] font-semibold">
                {isViewMode ? 'View Member Details' : isEditMode ? 'Edit Member Details' : 'Register New Member'}
              </span>
            </>
          )}
        </nav>
        <div className="flex items-center justify-between gap-4 w-full">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#180200] tracking-tight flex items-center gap-3">
              <span>{isViewMode ? 'View Member Details' : isEditMode ? 'Edit Member Details' : 'Register New Member'}</span>
              {(isViewMode || isEditMode) && targetMember?.registrationNumber && (
                <span className="font-mono text-sm font-bold bg-[#FAF7F2] text-[#510601] px-3 py-1 rounded-xl border border-[#E8DFD8]" title="Registration Number">
                  {targetMember.registrationNumber}
                </span>
              )}
              {(isViewMode || isEditMode) && targetMember?.membershipNumber && targetMember.membershipNumber !== 'Not Assigned' && targetMember.approvalStatus === 'Approved' && (
                <span className="font-mono text-sm font-bold bg-emerald-50 text-emerald-800 px-3 py-1 rounded-xl border border-emerald-200" title="Membership Number">
                  #{targetMember.membershipNumber}
                </span>
              )}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => navigate(returnPath)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-[#FAF7F2] text-[#510601] border border-[#E8DFD8] text-xs sm:text-sm font-semibold rounded-xl transition-all shadow-xs cursor-pointer shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{returnPath.includes('receipt') ? 'Back to Receipt Entry' : returnPath.includes('unapproved') ? 'Back to Unapproved Members' : 'Back to Membership List'}</span>
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------- */}
      {/* FORM CARD CONTAINER                                  */}
      {/* ---------------------------------------------------- */}
      <div className="w-full bg-white rounded-2xl border border-[#E8DFD8] shadow-sm overflow-hidden">
        {/* Form Top Bar with Tabs */}
        <div className="px-6 sm:px-8 pt-6 sm:pt-7 pb-3 border-b border-[#E8DFD8]">
          <div className="flex items-center justify-between pb-3 border-b-2 border-[#8C1801]">
            <h2 className="text-xl sm:text-2xl font-bold text-[#180200]">
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
                      <option value="Only Havyaka Mahasabha Membership">
                        Only Havyaka Mahasabha Membership
                      </option>
                      <option value="Havyaka Mahasabha Membership & Mangalya Registration">
                        Havyaka Mahasabha Membership & Mangalya Registration
                      </option>
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
                          {mt.name} (Rs. {mt.currentPrice?.toLocaleString('en-IN') || mt.price || mt.fee})
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

                    {/* Father / Husband Name */}
                    <div>
                      <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                        Father / Husband Name: <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.fatherHusbandName}
                        onChange={(e) => {
                          setFormData({ ...formData, fatherHusbandName: e.target.value });
                          if (formErrors.fatherHusbandName)
                            setFormErrors({ ...formErrors, fatherHusbandName: '' });
                        }}

                        className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${formErrors.fatherHusbandName ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#DFD5CC] hover:border-[#8C1801]/60'
                          }`}
                      />
                      {formErrors.fatherHusbandName && (
                        <p className="text-[11px] text-red-600 mt-1">
                          {formErrors.fatherHusbandName}
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

                            className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all ${formErrors.mobile ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#DFD5CC] hover:border-[#8C1801]/60'
                              }`}
                          />
                        </div>
                      </div>
                      {formErrors.mobile && (
                        <p className="text-[11px] text-red-600 mt-1">{formErrors.mobile}</p>
                      )}
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
                      Gothra: <span className="text-red-600">*</span>
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
                      Gender: <span className="text-red-600">*</span>
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
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
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
                      Aadhar Number: <span className="text-red-600">*</span>
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

                  {/* Pin Code with Autocomplete */}
                  <div className="relative" ref={pinWrapperRef}>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Pin Code: <span className="text-red-600">*</span>
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
                      Applying this Membership on behalf of: <span className="text-red-600">*</span>
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
                      Qualification: <span className="text-red-600">*</span>
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
                      Do you need Havyaka Magazine Every month? <span className="text-red-600">*</span>
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
                      <option value="YES">YES</option>
                      <option value="NO">NO</option>
                    </select>
                    {formErrors.magazineNeeded && (
                      <p className="text-[11px] text-red-600 mt-1">{formErrors.magazineNeeded}</p>
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
                    {isEditMode && (
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
                      value={formData.amount}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^\d.]/g, '');
                        setFormData({ ...formData, amount: val });
                      }}
                      onWheel={(e) => e.target.blur()}

                      className="w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#DFD5CC] hover:border-[#8C1801]/60 rounded-lg text-sm font-semibold text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all disabled:opacity-90 disabled:cursor-not-allowed"
                    />
                  </div>

                  {/* Receipt Date */}
                  <div>
                    <label className="block text-sm text-[#3D140C] mb-1.5 font-semibold">
                      Receipt Date: {!isViewMode && <span className="text-red-600">*</span>}
                    </label>
                    <DateInput
                      disabled={isViewMode}
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
                      <button
                        type="submit"
                        disabled={saving || !hasPermission('members.write')}
                        title={!hasPermission('members.write') ? 'Requires members.write permission' : undefined}
                        className="disabled:opacity-50 px-6 py-2.5 bg-[#510601] hover:bg-[#8C1801] text-white font-bold text-xs sm:text-sm rounded-lg shadow-sm transition-colors cursor-pointer inline-flex items-center gap-1.5"
                      >
                        <Save className="w-4 h-4" />
                        <span>{isEditMode ? 'Update Member' : 'Register Member'}</span>
                      </button>
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
