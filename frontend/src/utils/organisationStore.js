import logoImg from '../assets/logo.png';

const STORAGE_KEY = 'hms_organisation_settings_v1';

export const ORGANISATION_TYPES = [
  'Non-Profit / Community Trust',
  'Society / Association',
  'Charitable Trust',
  'Religious / Cultural Institution',
  'Educational Trust',
  'General Organisation'
];

export const DEFAULT_ORGANISATION_SETTINGS = {
  profile: {
    organisationName: 'Shri Akhila Havyaka Mahasabha (R)',
    shortName: 'HMS',
    registrationNumber: 'REG-KAR-1943-0028',
    organisationType: 'Non-Profit / Community Trust',
    establishedYear: '1943',
    logo: logoImg,
    addressLine1: '#11, 8th Cross, Malleshwaram',
    addressLine2: 'Near Circle Maramma Temple',
    country: 'India',
    state: 'Karnataka',
    district: 'Bengaluru Urban',
    taluk: 'Malleshwaram',
    postalCode: '560003',
    website: 'https://www.havyakamahasabha.org',
    email: 'info@havyakamahasabha.org',
    phone: '080-23348899',
    mobile: '9845012345'
  },
  printHeaders: {
    showLogo: true,
    organisationName: 'Shri Akhila Havyaka Mahasabha (R)',
    headerLine1: 'Central Administrative Office & Cultural Centre',
    headerLine2: 'Malleshwaram, Bengaluru, Karnataka - 560003',
    address: '#11, 8th Cross, Malleshwaram, Bengaluru - 560003',
    phone: '+91 80 23348899 / 9845012345',
    email: 'receipts@havyakamahasabha.org',
    website: 'www.havyakamahasabha.org',
    footerText: 'Thank you for your generous contribution. This is a computer-generated receipt.'
  },
  notifications: {
    enableNotifications: true,
    showInAppNotifications: true,
    newMembershipRegistration: true,
    membershipApproval: true,
    membershipActivation: true,
    membershipTypeChange: true,
    membershipExpiry: true,
    receiptCreated: true,
    receiptMapped: true,
    receiptPaymentUpdate: true
  },
  contact: {
    displayContactInfo: true,
    primaryContactName: 'Shri Radhakrishna Bhat',
    designation: 'General Secretary',
    contactNumber: '9845012345',
    alternateContactNumber: '080-23348899',
    email: 'secretary@havyakamahasabha.org',
    alternateEmail: 'admin@havyakamahasabha.org',
    supportContactNumber: '9480112233',
    supportEmail: 'support@havyakamahasabha.org',
    officeAddress: '#11, 8th Cross, Malleshwaram, Bengaluru, Karnataka - 560003',
    workingDays: 'Monday - Saturday (Sunday Closed)',
    workingHours: '09:30 AM - 05:30 PM IST'
  }
};

/**
 * Retrieve saved organisation settings or fallback to defaults.
 */
export const getStoredOrganisationSettings = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        profile: { ...DEFAULT_ORGANISATION_SETTINGS.profile, ...(parsed.profile || {}) },
        printHeaders: { ...DEFAULT_ORGANISATION_SETTINGS.printHeaders, ...(parsed.printHeaders || {}) },
        notifications: { ...DEFAULT_ORGANISATION_SETTINGS.notifications, ...(parsed.notifications || {}) },
        contact: { ...DEFAULT_ORGANISATION_SETTINGS.contact, ...(parsed.contact || {}) }
      };
    }
  } catch (err) {
    console.error('Failed to read organisation settings from storage:', err);
  }
  return JSON.parse(JSON.stringify(DEFAULT_ORGANISATION_SETTINGS));
};

/**
 * Persist organisation settings in localStorage and dispatch sync event.
 */
export const saveStoredOrganisationSettings = (settings) => {
  try {
    const merged = {
      profile: { ...DEFAULT_ORGANISATION_SETTINGS.profile, ...(settings.profile || {}) },
      printHeaders: { ...DEFAULT_ORGANISATION_SETTINGS.printHeaders, ...(settings.printHeaders || {}) },
      notifications: { ...DEFAULT_ORGANISATION_SETTINGS.notifications, ...(settings.notifications || {}) },
      contact: { ...DEFAULT_ORGANISATION_SETTINGS.contact, ...(settings.contact || {}) }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent('hms_settings_updated', { detail: merged }));
    return true;
  } catch (err) {
    console.error('Failed to save organisation settings to storage:', err);
    return false;
  }
};

/**
 * Helper to get active organisation name for receipts / headers.
 */
export const getActiveOrganisationName = () => {
  const settings = getStoredOrganisationSettings();
  return settings.profile?.organisationName || DEFAULT_ORGANISATION_SETTINGS.profile.organisationName;
};
