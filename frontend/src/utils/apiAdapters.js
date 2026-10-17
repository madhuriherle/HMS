import api from '../api';
import { memberName } from './memberName';

const titleCase = (value) => {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const fullNameFromMember = (member) => {
  const name = memberName(member);
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
    membershipNumber: firstDefined(member.member_code, member.membership_number, member.membershipNumber, ''),
    fullName,
    name: fullName,
    membershipName: fullName,
    addressLine: address || member.address || '',
    address: address || member.address || '',
    phone: firstDefined(member.alternate_mobile, member.phone, ''),
    mobile: firstDefined(member.mobile, member.mobileNumber, ''),
    mobileRaw: member.mobile_raw || '',
    mobileNumber: firstDefined(member.mobile, member.mobileNumber, ''),
    email: member.email || '',
    stateId: firstDefined(member.state_id, member.stateId, ''),
    districtId: firstDefined(member.district_id, member.districtId, ''),
    talukId: firstDefined(member.taluk_id, member.talukId, ''),
    pincodeId: firstDefined(member.pincode_id, member.pincodeId, ''),
    postalCode: firstDefined(member.postalCode, member.pincode, ''),
    stateName: member.state_name || '',
    districtName: member.district_name || '',
    talukName: member.taluk_name || '',
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
    fatherHusbandName: member.father_name || member.father_husband_name || '',
    fatherName: member.father_name || member.father_husband_name || '',
    fatherMembershipNumber: member.father_membership_number || '',
    motherName: member.mother_name || '',
    motherMembershipNumber: member.mother_membership_number || '',
    isMarried: member.is_married,
    spouseName: member.spouse_name || '',
    spouseMembershipNumber: member.spouse_membership_number || '',
    hasChildren: member.has_children,
    childrenDetails: member.children_details || [],
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
    membershipType: member.membership_type || '',
    membershipTypeId: member.membership_type_id || '',
    referredBy: [member.referred_by_number, member.referred_by_name].filter(Boolean).join(' - '),
    familyMembership: [member.family_membership_number, member.family_membership_name].filter(Boolean).join(' - '),
    registrationPayment: member.registration_payment || null,
    photoPath: member.photo_path || '',
    age: ageFromIso(member.date_of_birth),
  };
};

export const memberToApiPayload = (formData, { isUpdate = false } = {}) => {
  const parts = formData.name.trim().split(/\s+/);
  return {
    full_name_en: formData.name.trim().split(/\s+/).join(' '),
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
    // where the record came from is set once, when it is created; editing never changes it
    ...(isUpdate ? {} : { registration_source: 'OFFLINE' }),
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
  panNo: firstDefined(receipt.payer_pan, receipt.pan_no, receipt.panNo, ''),
  membershipNo: firstDefined(receipt.membership_number, receipt.member_code, receipt.payer_membership_no, receipt.membershipNo, ''),
  memberId: firstDefined(receipt.member_id, receipt.memberId, null),
  mobile: firstDefined(receipt.payer_mobile, receipt.mobile, ''),
  // the particular named on the receipt's first line (imported receipts all carry the type OTHER), else the head type
  particulars: (receipt.items || [])[0]?.particular || receiptTypeFromApi(firstDefined(receipt.receipt_type, receipt.particulars, 'MEMBERSHIP')),
  amount: Number(firstDefined(receipt.amount, receipt.net_amount, receipt.gross_amount, 0)),
  // a mode named after a bank account ("CANARA BANK") is stored as NETBANKING plus the name: show the name
  paymentMode: (['NETBANKING', 'OTHER'].includes(String(receipt.payment_mode || '').toUpperCase()) && receipt.bank_account)
    ? receipt.bank_account
    : paymentModeFromApi(firstDefined(receipt.payment_mode, receipt.paymentMode, 'OTHER')),
  bankName: firstDefined(receipt.bankName, receipt.bank_account, ''),
  bankAccount: firstDefined(receipt.bankAccount, receipt.bank_account, ''),
  transactionId: firstDefined(receipt.transaction_reference, receipt.cheque_number, receipt.transactionId, ''),
  transactionDate: firstDefined(receipt.transaction_date, receipt.cheque_date, receipt.transactionDate, ''),
  description: firstDefined(receipt.notes, receipt.description, ''),
  receiptStatus: receipt.receipt_status || '',
  periodFromDate: receipt.period_from_date || '',
  periodToDate: receipt.period_to_date || '',
  periodFromTime: receipt.period_from_time || '',
  periodToTime: receipt.period_to_time || '',
  status: firstDefined(receipt.payment_status, receipt.status, ''),
  items: receipt.items || [],
  itemsCount: receipt.items_count || (receipt.items || []).length || 0,
});

export const receiptToApiPayload = (formData, selectedMember = null) => {
  // One receipt can carry many particular lines (hostel deposit + donation + ...).
  const lines = (formData.lines && formData.lines.length ? formData.lines : [{
    particular: formData.particulars,
    particularId: null,
    detail: formData.othersDescription || '',
    amount: formData.amount,
  }]).map((l) => ({ ...l, amount: Number(l.amount || 0), type: receiptTypeToApi(l.particular) }));
  const amount = lines.reduce((sum, l) => sum + l.amount, 0);
  // Only these count toward a member's credit; the rest (hostel, deposits...) must not be allocated as credit.
  const creditLines = lines.filter((l) => ['MEMBERSHIP', 'DONATION', 'SCHOLARSHIP'].includes(l.type));
  const allocatedAmount = creditLines.length ? creditLines.reduce((sum, l) => sum + l.amount, 0) : amount;
  const headType = (creditLines[0] || lines[0]).type;
  const allocationMemberId = Number(selectedMember?.memberId || selectedMember?.member_id || selectedMember?.id);
  const desc = (formData.description || '').trim();
  const paymentDetails = (formData.paymentReceivedDetails || '').trim();
  const baseNotes = [desc, paymentDetails ? `Payment details: ${paymentDetails}` : null].filter(Boolean).join(' | ');
  return {
    receipt_number: formData.receiptNumber.trim() || null,
    receipt_date: formData.receiptDate,
    receipt_type: headType,
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
    is_cancelled: Boolean(formData.isCancelled),
    payer_pan: (formData.panNo || '').trim() || null,
    payer_mobile: (formData.mobile || '').trim() || null,
    payer_membership_no: (formData.membershipNo || '').trim() || null,
    notes: baseNotes || null,
    period_from_date: formData.periodFromDate || null,
    period_to_date: formData.periodToDate || null,
    period_from_time: formData.periodFromTime || null,
    period_to_time: formData.periodToTime || null,
    items: lines.map((l) => ({
      item_type: l.type,
      particular_id: l.particularId || null,
      particular_name: l.particular || null,
      sub_particular_id: l.subParticularId || null,
      description: l.detail || null,
      amount: l.amount,
    })),
    allocations: allocationMemberId
      ? [{ member_id: allocationMemberId, allocated_amount: allocatedAmount }]
      : [],
  };
};

// One page of the member list (at most 200 rows): the rows and the whole filtered set's total.
export const fetchMemberPage = async (params = {}) => {
  const { data } = await api.get('/members/', { params: { limit: 25, ...params } });
  return { rows: unwrapList(data).map(normalizeMember), total: data?.total ?? 0, pages: data?.pages ?? 1, summary: data?.summary || null };
};

// One page of the label list (members who have paid, latest receipt first); each row has last_receipt_date.
export const fetchLabelPage = async (params = {}) => {
  const { data } = await api.get('/members/label-list', { params: { limit: 25, ...params } });
  return { rows: unwrapList(data).map(normalizeMember), total: data?.total ?? 0, pages: data?.pages ?? 1 };
};

// One receipt, in the same shape Receipt Tracking uses (with its particulars), found by its number: so every screen that
// opens a receipt shows the same popup with the same details.
export const fetchReceiptRow = async ({ id, number, memberId } = {}) => {
  const { rows } = await fetchReceiptPage({ search: number, ...(memberId ? { member_id: memberId } : {}), limit: 25 });
  return rows.find((r) => String(r.id) === String(id)) || rows.find((r) => r.receiptNumber === number) || null;
};

// One page of the receipt register (at most 200 rows): the rows, the whole filtered set's total and counts.
export const fetchReceiptPage = async (params = {}) => {
  const { data } = await api.get('/receipts/tracking', { params: { limit: 25, ...params } });
  return {
    rows: unwrapList(data).map(normalizeReceipt),
    total: data?.total ?? 0,
    pages: data?.pages ?? 1,
    summary: data?.summary || {},
  };
};
