// Organisation settings are stored on the server (GET/PUT /system/settings).
// Nothing is kept in the browser: this file only holds the form's empty shape
// and the mapping between the form and the API.

export const ORGANISATION_TYPES = [
  'Non-Profit / Community Trust',
  'Society / Association',
  'Charitable Trust',
  'Religious / Cultural Institution',
  'Educational Trust',
  'General Organisation'
];

export const EMPTY_ORGANISATION_SETTINGS = {
  profile: {
    organisationName: '', shortName: '', registrationNumber: '', organisationType: '',
    establishedYear: '', logo: null, logoPath: null, addressLine1: '', addressLine2: '',
    country: '', state: '', district: '', taluk: '', postalCode: '', website: '',
    email: '', phone: '', mobile: ''
  },
  printHeaders: {
    showLogo: false, organisationName: '', headerLine1: '', headerLine2: '', address: '',
    phone: '', email: '', website: '', footerText: '',
    presidentTitleEn: '', secretaryTitleEn: '', treasurerTitleEn: '',
    payModeCashEn: '', payModeChequeEn: '', payModeDdEn: '', payModeUpiEn: ''
  },
  notifications: {
    enableNotifications: false, showInAppNotifications: false, newMembershipRegistration: false,
    membershipApproval: false, membershipActivation: false, membershipTypeChange: false,
    membershipExpiry: false, receiptCreated: false, receiptMapped: false, receiptPaymentUpdate: false
  },
  contact: {
    displayContactInfo: false, primaryContactName: '', designation: '', contactNumber: '',
    alternateContactNumber: '', email: '', alternateEmail: '', supportContactNumber: '',
    supportEmail: '', officeAddress: '', workingDays: '', workingHours: ''
  }
};

const GROUPS = ['profile', 'printHeaders', 'notifications', 'contact'];

// Server response -> form. Columns win; `extra` holds the fields without a column.
export const settingsFromApi = (d = {}) => {
  const extra = d.extra || {};
  const out = {};
  GROUPS.forEach((g) => {
    out[g] = { ...EMPTY_ORGANISATION_SETTINGS[g], ...(extra[g] || {}) };
  });
  const set = (group, key, value) => {
    if (value !== undefined && value !== null) out[group][key] = value;
  };
  set('profile', 'organisationName', d.name_en);
  set('profile', 'registrationNumber', d.registration_no);
  set('profile', 'website', d.website);
  set('profile', 'addressLine1', d.address_en);
  out.profile.logoPath = d.logo_path || null;
  set('contact', 'email', d.email);
  set('contact', 'contactNumber', d.mobile);
  set('contact', 'alternateContactNumber', d.phone);
  set('printHeaders', 'showLogo', d.print_header_enabled);
  set('printHeaders', 'footerText', d.receipt_footer_note_en);
  set('printHeaders', 'presidentTitleEn', d.president_title_en);
  set('printHeaders', 'secretaryTitleEn', d.secretary_title_en);
  set('printHeaders', 'treasurerTitleEn', d.treasurer_title_en);
  set('printHeaders', 'payModeCashEn', d.pay_mode_cash_en);
  set('printHeaders', 'payModeChequeEn', d.pay_mode_cheque_en);
  set('printHeaders', 'payModeDdEn', d.pay_mode_dd_en);
  set('printHeaders', 'payModeUpiEn', d.pay_mode_upi_en);
  set('notifications', 'enableNotifications', d.notify_email_enabled);
  return out;
};

// Form -> server body (columns + the whole form as `extra`, minus the logo image).
export const settingsToApi = (s) => {
  const extra = {};
  GROUPS.forEach((g) => {
    extra[g] = { ...s[g] };
  });
  delete extra.profile.logo;
  delete extra.profile.logoPath;
  return {
    name_en: s.profile.organisationName,
    registration_no: s.profile.registrationNumber,
    website: s.profile.website,
    address_en: s.profile.addressLine1,
    email: s.contact.email,
    mobile: s.contact.contactNumber,
    phone: s.contact.alternateContactNumber,
    print_header_enabled: s.printHeaders.showLogo,
    receipt_footer_note_en: s.printHeaders.footerText,
    president_title_en: s.printHeaders.presidentTitleEn,
    secretary_title_en: s.printHeaders.secretaryTitleEn,
    treasurer_title_en: s.printHeaders.treasurerTitleEn,
    pay_mode_cash_en: s.printHeaders.payModeCashEn,
    pay_mode_cheque_en: s.printHeaders.payModeChequeEn,
    pay_mode_dd_en: s.printHeaders.payModeDdEn,
    pay_mode_upi_en: s.printHeaders.payModeUpiEn,
    notify_email_enabled: s.notifications.enableNotifications,
    extra
  };
};
