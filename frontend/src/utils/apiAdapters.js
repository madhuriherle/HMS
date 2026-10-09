import api from '../api';

const titleCase = (value) => {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const fullNameFromMember = (member) => {
  const name = [member.first_name_en, member.middle_name_en, member.last_name_en]
    .filter(Boolean)
    .join(' ')
    .trim();
  return name || member.full_name_kn || member.name || '';
};

export const unwrapList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const ageFromIso = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) years -= 1;
  return years >= 0 ? String(years) : '';
};

export const normalizeMember = (member) => {
  const fullName = fullNameFromMember(member);
  const address = [member.address_line1, member.address_line2, member.locality]
    .filter(Boolean)
    .join(', ');

  return {
    ...member,
    id: member.id,
    membershipNumber: firstDefined(member.member_code, member.membership_number, member.membershipNumber, member.id),
    fullName,
    name: fullName,
    membershipName: fullName,
    addressLine: address || member.address || '',
    address: address || member.address || '',
    phone: firstDefined(member.alternate_mobile, member.phone, ''),
    mobile: firstDefined(member.mobile, member.mobileNumber, ''),
    mobileNumber: firstDefined(member.mobile, member.mobileNumber, ''),
    email: member.email || '',
    stateId: firstDefined(member.state_id, member.stateId, ''),
    districtId: firstDefined(member.district_id, member.districtId, ''),
    talukId: firstDefined(member.taluk_id, member.talukId, ''),
    pincodeId: firstDefined(member.pincode_id, member.pincodeId, ''),
    postalCode: firstDefined(member.postalCode, member.pincode, ''),
    post: member.post || '',
    city: member.city || '',
    area: member.area || '',
    place: member.place || '',
    grama: member.grama || '',
    village: member.village || '',
    labelPoint: firstDefined(member.label_point, member.labelPoint, ''),
    category: member.category || 'General',
    profession: firstDefined(member.occupation, member.profession, ''),
    company: member.company || '',
    website: member.website || '',
    gothra: firstDefined(member.gotra_text, member.gothra, ''),
    bloodGroup: firstDefined(member.blood_group, member.bloodGroup, ''),
    birthDate: firstDefined(member.date_of_birth, member.birthDate, ''),
    status: titleCase(firstDefined(member.member_status, member.status, 'Active')),
    approvalStatus: firstDefined(member.approval_status, member.approvalStatus, ''),
    registrationStatus: firstDefined(member.registration_status, member.registrationStatus, ''),
    remarks: member.remarks || '',
    magazineRemarks: firstDefined(member.address_remarks, member.magazineRemarks, ''),
    nativeDetails: firstDefined(member.native_place_text, member.nativeDetails, ''),
    // details captured on the Register New Member form
    nameTitle: member.name_title || '',
    fatherHusbandName: member.father_husband_name || '',
    aadharNumber: member.aadhaar_number || '',
    whatsappNumber: member.whatsapp_number
      ? `${member.whatsapp_country_code || member.mobile_country_code || '+91'} ${member.whatsapp_number}`
      : '',
    qualification: member.qualification_text || '',
    employment: member.occupation || '',
    nativePlaceText: member.native_place_text || '',
    appliedOnBehalfOf: member.applied_on_behalf_of || '',
    magazineNeededLabel: member.magazine_needed === true ? 'Yes' : member.magazine_needed === false ? 'No' : '',
    membershipTypeCategory: member.membership_type_category || '',
    referredBy: [member.referred_by_number, member.referred_by_name].filter(Boolean).join(' - '),
    familyMembership: [member.family_membership_number, member.family_membership_name].filter(Boolean).join(' - '),
    registrationPayment: member.registration_payment || null,
    photoPath: member.photo_path || '',
    age: ageFromIso(member.date_of_birth),
  };
};

export const memberToApiPayload = (formData) => {
  const parts = formData.name.trim().split(/\s+/);
  return {
    first_name_en: parts[0] || formData.name.trim(),
    middle_name_en: parts.length > 2 ? parts.slice(1, -1).join(' ') : null,
    last_name_en: parts.length > 1 ? parts[parts.length - 1] : null,
    mobile: formData.mobile.trim() || null,
    alternate_mobile: formData.phone.trim() || null,
    email: formData.email.trim() || null,
    address_line1: formData.address.trim() || null,
    country: formData.country || 'India',
    city: formData.city.trim() || null,
    post: formData.post.trim() || null,
    area: formData.area.trim() || null,
    place: formData.place.trim() || null,
    grama: formData.grama.trim() || null,
    village: formData.village.trim() || null,
    label_point: formData.labelPoint.trim() || null,
    category: formData.category || null,
    occupation: formData.profession.trim() || null,
    company: formData.company.trim() || null,
    website: formData.website.trim() || null,
    gotra_text: formData.gothra || null,
    blood_group: formData.bloodGroup || null,
    date_of_birth: formData.birthDate || null,
    remarks: formData.remarks.trim() || null,
    address_remarks: formData.magazineRemarks.trim() || null,
    native_place_text: formData.nativeDetails.trim() || null,
    registration_source: 'OFFLINE',
    state_id: Number(formData.stateId) || null,
    district_id: Number(formData.districtId) || null,
    taluk_id: Number(formData.talukId) || null,
    pincode_id: Number(formData.pincodeId) || null,
  };
};

const receiptTypeToApi = (value) => {
  const clean = String(value || '').toLowerCase();
  if (clean.includes('membership')) return 'MEMBERSHIP';
  if (clean.includes('scholarship')) return 'SCHOLARSHIP';
  if (clean.includes('donation')) return 'DONATION';
  if (clean.includes('magazine')) return 'MAGAZINE';
  if (clean.includes('event')) return 'EVENT';
  return 'OTHER';
};

const receiptTypeFromApi = (value) => titleCase(value || 'MEMBERSHIP');

const paymentModeToApi = (value, bankAccount = '') => {
  const clean = String(value || '').toLowerCase();
  if (clean.includes('cash')) return 'CASH';
  if (clean.includes('cheque')) return 'CHEQUE';
  if (clean.includes('upi')) return 'UPI';
  if (clean.includes('card')) return 'CARD';
  if (clean.includes('online') || clean.includes('net') || clean.includes('bank')) return 'NETBANKING';
  // a payment mode named after a bank account (e.g. "SBI") is a bank transfer
  return bankAccount ? 'NETBANKING' : 'OTHER';
};

const paymentModeFromApi = (value) => titleCase(value || 'OTHER');

export const normalizeReceipt = (receipt) => ({
  ...receipt,
  id: receipt.id,
  receiptNumber: firstDefined(receipt.receipt_number, receipt.receiptNumber, ''),
  receiptDate: firstDefined(receipt.receipt_date, receipt.receiptDate, ''),
  name: firstDefined(receipt.member_name, receipt.payee_name, receipt.payer_name, receipt.name, ''),
  panNo: firstDefined(receipt.pan_no, receipt.panNo, ''),
  membershipNo: firstDefined(receipt.membership_number, receipt.member_code, receipt.membershipNo, ''),
  memberId: firstDefined(receipt.member_id, receipt.memberId, null),
  mobile: firstDefined(receipt.mobile, ''),
  particulars: receiptTypeFromApi(firstDefined(receipt.receipt_type, receipt.particulars, 'MEMBERSHIP')),
  amount: Number(firstDefined(receipt.amount, receipt.net_amount, receipt.gross_amount, 0)),
  paymentMode: paymentModeFromApi(firstDefined(receipt.payment_mode, receipt.paymentMode, 'OTHER')),
  bankName: firstDefined(receipt.bankName, receipt.bank_account, ''),
  bankAccount: firstDefined(receipt.bankAccount, receipt.bank_account, ''),
  transactionId: firstDefined(receipt.transaction_reference, receipt.cheque_number, receipt.transactionId, ''),
  transactionDate: firstDefined(receipt.transaction_date, receipt.cheque_date, receipt.transactionDate, ''),
  description: firstDefined(receipt.notes, receipt.description, ''),
  status: firstDefined(receipt.payment_status, receipt.status, ''),
});

export const receiptToApiPayload = (formData, selectedMember = null) => {
  const amount = Number(formData.amount || 0);
  const allocationMemberId = Number(selectedMember?.memberId || selectedMember?.member_id || selectedMember?.id);
  return {
    receipt_number: formData.receiptNumber.trim() || null,
    receipt_date: formData.receiptDate,
    receipt_type: receiptTypeToApi(formData.particulars),
    payer_name: formData.name.trim() || null,
    payment_mode: paymentModeToApi(formData.paymentMode, formData.bankAccount),
    transaction_reference: formData.transactionId.trim() || null,
    bank_account: (formData.bankAccount || '').trim() || null,
    transaction_date: formData.transactionDate || null,
    gross_amount: amount,
    discount_amount: 0,
    net_amount: amount,
    source: 'OFFLINE',
    is_renewal: Boolean(formData.isRenewal),
    notes: (formData.description || '').trim() || (formData.paymentReceivedDetails || '').trim() || null,
    items: [
      {
        item_type: receiptTypeToApi(formData.particulars),
        description: formData.donationSubType || formData.othersDescription || formData.particulars,
        amount,
      },
    ],
    allocations: allocationMemberId
      ? [{ member_id: allocationMemberId, allocated_amount: amount }]
      : [],
  };
};

export const fetchMembers = async (params = {}) => {
  const { data } = await api.get('/members/', { params: { limit: 5000, ...params } });
  return unwrapList(data).map(normalizeMember);
};

export const fetchReceipts = async (params = {}) => {
  const { data } = await api.get('/receipts/tracking', { params: { limit: 5000, ...params } });
  return unwrapList(data).map(normalizeReceipt);
};
