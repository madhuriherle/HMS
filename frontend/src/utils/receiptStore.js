import { initialMembers } from '../data/membersData';
import { initialLabelList } from '../data/labelListData';
import { initialMembershipTypes } from '../data/membershipTypeData';
import { initialReceiptTypes, initialParticulars } from '../data/receiptTypeData';
import { PAYMENT_MODES, GOTHRA_MASTER } from '../data/mastersData';
import { initialUnapprovedMembers } from '../data/unapprovedMembersData';
import { initialStates, initialDistricts, initialTaluks } from '../data/locationData';
import { initialPostalCodes } from '../data/postalCodeData';
import { initialBankDetails, BANK_PAYMENT_MODE_OPTIONS } from '../data/bankDetailsData';
import {
  initialPaymentModeConfigs,
  AVAILABLE_PAYMENT_MODES,
  AVAILABLE_PAYMENT_TYPES,
  AVAILABLE_BANK_ACCOUNTS,
  formatPaymentModeLabel
} from '../data/paymentModeData';

export {
  ORGANISATION_TYPES,
  DEFAULT_ORGANISATION_SETTINGS,
  getStoredOrganisationSettings,
  saveStoredOrganisationSettings,
  getActiveOrganisationName
} from './organisationStore';

export {
  initialBankDetails,
  BANK_PAYMENT_MODE_OPTIONS,
  initialPaymentModeConfigs,
  AVAILABLE_PAYMENT_MODES,
  AVAILABLE_PAYMENT_TYPES,
  AVAILABLE_BANK_ACCOUNTS,
  formatPaymentModeLabel,
  initialParticulars
};

const STORAGE_KEYS = {
  RECEIPTS: 'hms_receipts_v3',
  MEMBERS: 'hms_members_v1',
  UNAPPROVED_MEMBERS: 'hms_unapproved_members_v2',
  LABEL_LIST: 'hms_label_list_v1',
  MEMBERSHIP_TYPES: 'hms_membership_types_v1',
  STATES: 'hms_states_v1',
  DISTRICTS: 'hms_districts_v1',
  TALUKS: 'hms_taluks_v1',
  POSTAL_CODES: 'hms_postal_codes_v1',
  RECEIPT_TYPES: 'hms_receipt_types_v2',
  PAYMENT_MODES: 'hms_payment_modes_v1',
  GOTHRAS: 'hms_gothras_v1',
  BANK_DETAILS: 'hms_bank_details_v1',
  PAYMENT_MODE_CONFIGS: 'hms_payment_mode_configs_v4',
  UNAPPROVED_RENEWALS: 'hms_unapproved_renewals_v2'
};

// ======================================================================
// SAMPLE DATA FOR UNAPPROVED RENEWAL PAYMENT LIST
// ======================================================================
export const initialUnapprovedRenewals = [
  {
    id: 'REN-12362',
    registrationNumber: '12362',
    name: 'SUMANTH HEGDE',
    gender: 'Male',
    membershipNumber: 'RECEIPT71602',
    membershipName: 'SUMANTH HEGDE',
    contactNumber: '9880875179',
    membershipType: 'Poshaka',
    amount: 1000,
    receiptStatus: 'Pending'
  },
  {
    id: 'REN-11976',
    registrationNumber: '11976',
    name: 'AKSHAY RAM BHAT',
    gender: 'Male',
    membershipNumber: '7420/PO/1000',
    membershipName: 'UDAYANARAYAN BHAT',
    contactNumber: '8971635160',
    membershipType: 'Poshaka',
    amount: 1000,
    receiptStatus: 'Pending'
  },
  {
    id: 'REN-12405',
    registrationNumber: '12405',
    name: 'MAHESHWARA BHAT',
    gender: 'Male',
    membershipNumber: '5120/PO/1000',
    membershipName: 'MAHESHWARA BHAT',
    contactNumber: '9448123901',
    membershipType: 'Poshaka',
    amount: 1000,
    receiptStatus: 'Pending'
  },
  {
    id: 'REN-12518',
    registrationNumber: '12518',
    name: 'RADHIKA HEGDE',
    gender: 'Female',
    membershipNumber: '6890/MA/2000',
    membershipName: 'RADHIKA HEGDE',
    contactNumber: '9740156822',
    membershipType: 'Mahaposhaka',
    amount: 2000,
    receiptStatus: 'Pending'
  }
];

export const getStoredUnapprovedRenewals = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.UNAPPROVED_RENEWALS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error('Failed to parse renewals from storage', e);
  }
  return initialUnapprovedRenewals;
};

export const saveStoredUnapprovedRenewals = (renewals) => {
  try {
    localStorage.setItem(STORAGE_KEYS.UNAPPROVED_RENEWALS, JSON.stringify(renewals));
  } catch (e) {
    console.error('Failed to save renewals to storage', e);
  }
};

// ======================================================================
// CONSTANTS FOR NEW RECEIPT ENTRY FLOW
// ======================================================================
export const PARTICULARS_OPTIONS = [
  'Membership',
  'Scholarship',
  'Donation',
  'Hostel Payment',
  'Function Deposit',
  'Cultural Events',
  'Others'
];

export const RECEIPT_PAYMENT_MODES = [
  'KBL 1075',
  'KBL1541',
  'SBI',
  'CANARA BANK'
];

export const BANKS_LIST = [
  'State Bank of India',
  'Karnataka Bank',
  'Canara Bank',
  'HDFC Bank',
  'ICICI Bank',
  'Union Bank of India',
  'Bank of Baroda',
  'Punjab National Bank',
  'Axis Bank',
  'Kotak Mahindra Bank',
  'Others'
];

// ======================================================================
// UNAPPROVED MEMBERS STORE
// ======================================================================
export const getStoredUnapprovedMembers = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.UNAPPROVED_MEMBERS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.error('Failed to parse unapproved members from storage', e);
  }
  return initialUnapprovedMembers;
};

export const saveStoredUnapprovedMembers = (members) => {
  try {
    localStorage.setItem(STORAGE_KEYS.UNAPPROVED_MEMBERS, JSON.stringify(members));
  } catch (e) {
    console.error('Failed to save unapproved members to storage', e);
  }
};

// ======================================================================
// RECEIPT STORE (FOR RECEIPT TRACKING & RECEIPT ENTRY FLOW)
// Total 5 Dummy Receipts (3 Assigned, 2 Unassigned)
// ======================================================================
export const initialReceipts = [
  {
    id: 'REC-123',
    receiptNumber: '123',
    receiptDate: '2026-10-06',
    name: 'Ananya Hegde',
    panNo: 'ABCDE5678G',
    membershipNo: 'MEM-2026-001',
    memberId: 'MEM-2026-001',
    mobile: '9876543210',
    particulars: 'Membership',
    othersDescription: '',
    paymentReceivedDetails: '',
    donationDetails: '',
    amount: 1000,
    paymentMode: 'Online',
    bankAccount: 'KBL 1075',
    bankName: 'KBL 1075',
    transactionId: 'UPI-TXN-9912401',
    transactionDate: '2026-10-06',
    description: 'Annual membership contribution',
    status: 'Assigned',
    isUnmapped: false,
    createdAt: '2026-10-06T10:00:00.000Z'
  },
  {
    id: 'REC-124',
    receiptNumber: '124',
    receiptDate: '2026-10-06',
    name: 'Nikhitha',
    panNo: 'ABCDE1234F',
    membershipNo: 'MEM-2026-002',
    memberId: 'MEM-2026-002',
    mobile: '9880875179',
    particulars: 'Donation',
    othersDescription: '',
    paymentReceivedDetails: '',
    donationDetails: 'Building Fund',
    amount: 5000,
    paymentMode: 'Online',
    bankAccount: 'KBL 1075',
    bankName: 'KBL 1075',
    transactionId: 'UPI-TXN-8849102',
    transactionDate: '2026-10-06',
    description: 'Building fund donation',
    status: 'Assigned',
    isUnmapped: false,
    createdAt: '2026-10-06T11:30:00.000Z'
  },
  {
    id: 'REC-125',
    receiptNumber: '125',
    receiptDate: '2026-10-07',
    name: '',
    panNo: '',
    membershipNo: '',
    memberId: null,
    mobile: '',
    particulars: 'Membership',
    othersDescription: '',
    paymentReceivedDetails: '',
    donationDetails: '',
    amount: 1000,
    paymentMode: 'Cash',
    bankAccount: '',
    bankName: '',
    transactionId: '',
    transactionDate: '',
    description: 'Counter cash collection — Unassigned offline receipt',
    status: 'Unassigned',
    isUnmapped: true,
    createdAt: '2026-10-07T09:15:00.000Z'
  },
  {
    id: 'REC-126',
    receiptNumber: '126',
    receiptDate: '2026-10-07',
    name: 'Ramesh Bhat',
    panNo: 'FGHIJ9012K',
    membershipNo: 'MEM-2026-003',
    memberId: 'MEM-2026-003',
    mobile: '9448123901',
    particulars: 'Membership',
    othersDescription: '',
    paymentReceivedDetails: '',
    donationDetails: '',
    amount: 1000,
    paymentMode: 'Offline',
    bankAccount: 'SBI',
    bankName: 'State Bank of India',
    transactionId: 'CHQ-448102',
    transactionDate: '2026-10-07',
    description: 'Offline membership payment cheque',
    status: 'Assigned',
    isUnmapped: false,
    createdAt: '2026-10-07T10:00:00.000Z'
  },
  {
    id: 'REC-127',
    receiptNumber: '127',
    receiptDate: '2026-10-07',
    name: '',
    panNo: '',
    membershipNo: '',
    memberId: null,
    mobile: '',
    particulars: 'Scholarship',
    othersDescription: '',
    paymentReceivedDetails: '',
    donationDetails: '',
    amount: 2500,
    paymentMode: 'Cash',
    bankAccount: '',
    bankName: '',
    transactionId: '',
    transactionDate: '',
    description: 'Direct endowment contribution — Unassigned',
    status: 'Unassigned',
    isUnmapped: true,
    createdAt: '2026-10-07T10:45:00.000Z'
  }
];

export const isReceiptUnmapped = (receipt) => {
  if (!receipt) return false;
  if (receipt.isUnmapped === true) return true;
  if (receipt.status === 'Unassigned' || receipt.status === 'Unmapped') return true;
  const hasMember = Boolean(receipt.memberId || (receipt.membershipNo && String(receipt.membershipNo).trim() !== ''));
  if (!hasMember) {
    const name = String(receipt.name || '').trim().toLowerCase();
    if (!name || name === 'unassigned' || name === 'unmapped' || name === 'unassigned / unmapped') {
      return true;
    }
  }
  return false;
};

export const getStoredReceipts = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.RECEIPTS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.error('Failed to parse receipts from storage', e);
  }
  return initialReceipts;
};

export const saveStoredReceipts = (receipts) => {
  try {
    localStorage.setItem(STORAGE_KEYS.RECEIPTS, JSON.stringify(receipts));
  } catch (e) {
    console.error('Failed to save receipts to storage', e);
  }
};

export const saveNewReceipt = (receiptData) => {
  const receipts = getStoredReceipts();
  const today = new Date().toISOString().split('T')[0];
  const newReceiptId = `REC-${Date.now()}`;

  const newReceipt = {
    id: newReceiptId,
    receiptNumber: String(receiptData.receiptNumber || '').trim(),
    receiptDate: receiptData.receiptDate || today,
    name: String(receiptData.name || '').trim(),
    panNo: String(receiptData.panNo || '').trim(),
    membershipNo: String(receiptData.membershipNo || '').trim(),
    mobile: String(receiptData.mobile || '').trim(),
    particulars: receiptData.particulars || 'Membership',
    donationSubType: receiptData.donationSubType || '',
    othersDescription: receiptData.othersDescription || '',
    donationDetails: receiptData.donationDetails || receiptData.donationSubType || receiptData.paymentReceivedDetails || '',
    paymentReceivedDetails: receiptData.paymentReceivedDetails || receiptData.donationDetails || receiptData.donationSubType || '',
    amount: Number(receiptData.amount) || 0,
    paymentMode: receiptData.paymentMode || 'Cash',
    bankAccount: receiptData.bankAccount || receiptData.bankName || '',
    bankName: receiptData.bankName || receiptData.bankAccount || '',
    transactionId: String(receiptData.transactionId || '').trim(),
    transactionDate: receiptData.transactionDate || '',
    description: String(receiptData.description || '').trim(),
    memberId: receiptData.memberId || null,
    membershipType: receiptData.membershipType || '',
    status: 'Assigned',
    mappingStatus: receiptData.mappingStatus || 'Unmapped', // Explicitly Unmapped by default
    createdAt: new Date().toISOString()
  };

  const updatedReceipts = [newReceipt, ...receipts];
  saveStoredReceipts(updatedReceipts);

  // If associated with an unapproved member, update member's receiptStatus to 'Assigned'
  if (receiptData.memberId) {
    const unapprovedMembers = getStoredUnapprovedMembers();
    const updatedUnapproved = unapprovedMembers.map((m) => {
      if (m.id === receiptData.memberId) {
        return {
          ...m,
          receiptStatus: 'Assigned',
          assignedReceiptNumber: newReceipt.receiptNumber,
          receiptId: newReceipt.id,
          receiptDate: newReceipt.receiptDate,
          // Explicitly keep unapproved and unmapped
          approvalStatus: 'Unapproved',
          mappingStatus: 'Unmapped'
        };
      }
      return m;
    });
    saveStoredUnapprovedMembers(updatedUnapproved);
  }

  return newReceipt;
};

export const updateStoredReceipt = (receiptId, updatedData) => {
  const receipts = getStoredReceipts();
  let updatedTarget = null;

  const updatedReceipts = receipts.map((r) => {
    if (r.id === receiptId || r.receiptNumber === receiptId) {
      updatedTarget = {
        ...r,
        ...updatedData,
        amount: Number(updatedData.amount !== undefined ? updatedData.amount : r.amount) || 0,
        updatedAt: new Date().toISOString()
      };
      return updatedTarget;
    }
    return r;
  });

  if (updatedTarget) {
    saveStoredReceipts(updatedReceipts);

    // If member linked and receiptNumber updated, sync unapproved member
    if (updatedTarget.memberId) {
      const unapprovedMembers = getStoredUnapprovedMembers();
      const updatedUnapproved = unapprovedMembers.map((m) => {
        if (m.id === updatedTarget.memberId) {
          return {
            ...m,
            assignedReceiptNumber: updatedTarget.receiptNumber,
            receiptId: updatedTarget.id
          };
        }
        return m;
      });
      saveStoredUnapprovedMembers(updatedUnapproved);
    }
  }

  return updatedTarget;
};

export const deleteStoredReceipt = (receiptId) => {
  const receipts = getStoredReceipts();
  const target = receipts.find((r) => r.id === receiptId || r.receiptNumber === receiptId);

  if (!target) return false;

  const updatedReceipts = receipts.filter((r) => r.id !== target.id && r.receiptNumber !== target.receiptNumber);
  saveStoredReceipts(updatedReceipts);

  // If linked to an unapproved member, reset that member's receiptStatus to 'Pending'
  if (target.memberId) {
    const unapprovedMembers = getStoredUnapprovedMembers();
    const updatedUnapproved = unapprovedMembers.map((m) => {
      if (m.id === target.memberId || m.assignedReceiptNumber === target.receiptNumber || m.receiptId === target.id) {
        return {
          ...m,
          receiptStatus: 'Pending',
          assignedReceiptNumber: '',
          receiptId: '',
          mappingStatus: 'Unmapped'
        };
      }
      return m;
    });
    saveStoredUnapprovedMembers(updatedUnapproved);
  }

  return true;
};

export const mapReceiptToMember = (receiptId, member) => {
  if (!member) return null;
  const receipts = getStoredReceipts();
  let mappedReceipt = null;

  const updatedReceipts = receipts.map((r) => {
    if (r.id === receiptId || r.receiptNumber === receiptId) {
      mappedReceipt = {
        ...r,
        memberId: member.id,
        name: member.fullName || member.name || r.name,
        membershipNo: member.membershipNumber || member.id || r.membershipNo || '',
        mobile: member.mobile || member.mobileNumber || r.mobile || '',
        membershipType: member.membershipType || r.membershipType || '',
        status: 'Assigned',
        isUnmapped: false,
        mappingStatus: 'Assigned',
        mappedAt: new Date().toISOString()
      };
      return mappedReceipt;
    }
    return r;
  });

  if (mappedReceipt) {
    saveStoredReceipts(updatedReceipts);

    // Update unapproved member record if this member is in unapproved list
    const unapprovedMembers = getStoredUnapprovedMembers();
    const updatedUnapproved = unapprovedMembers.map((m) => {
      if (m.id === member.id) {
        return {
          ...m,
          mappingStatus: 'Mapped',
          receiptStatus: 'Assigned',
          assignedReceiptNumber: mappedReceipt.receiptNumber,
          receiptId: mappedReceipt.id,
          receiptDate: mappedReceipt.receiptDate
          // Strictly keep approvalStatus: 'Unapproved'!
        };
      }
      return m;
    });
    saveStoredUnapprovedMembers(updatedUnapproved);
  }

  return mappedReceipt;
};

// ======================================================================
// MEMBERS STORE
// ======================================================================
export const getStoredMembers = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.MEMBERS);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error('Failed to parse members from storage', e);
  }
  return initialMembers;
};

export const saveStoredMembers = (members) => {
  try {
    localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(members));
  } catch (e) {
    console.error('Failed to save members to storage', e);
  }
};

// ======================================================================
// LABEL LIST STORE
// ======================================================================
export const getStoredLabelList = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.LABEL_LIST);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error('Failed to parse label list from storage', e);
  }
  return initialLabelList;
};

export const saveStoredLabelList = (list) => {
  try {
    localStorage.setItem(STORAGE_KEYS.LABEL_LIST, JSON.stringify(list));
  } catch (e) {
    console.error('Failed to save label list to storage', e);
  }
};

// ======================================================================
// MEMBERSHIP TYPES STORE
// ======================================================================
export const getStoredMembershipTypes = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.MEMBERSHIP_TYPES);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const removedNames = new Set(['patron', 'life member', 'donor']);
        const cleaned = parsed.filter(p => !removedNames.has((p.name || '').toLowerCase().trim()));
        const existingNames = new Set(cleaned.map(p => (p.name || '').toLowerCase().trim()));
        let hasChanges = cleaned.length !== parsed.length;
        const merged = [...cleaned];
        initialMembershipTypes.forEach(initType => {
          if (!existingNames.has((initType.name || '').toLowerCase().trim())) {
            merged.push(initType);
            hasChanges = true;
          }
        });
        if (hasChanges) {
          localStorage.setItem(STORAGE_KEYS.MEMBERSHIP_TYPES, JSON.stringify(merged));
        }
        return merged;
      }
    }
  } catch (e) {
    console.error('Failed to parse membership types from storage', e);
  }
  return initialMembershipTypes;
};

export const saveStoredMembershipTypes = (types) => {
  try {
    localStorage.setItem(STORAGE_KEYS.MEMBERSHIP_TYPES, JSON.stringify(types));
  } catch (e) {
    console.error('Failed to save membership types to storage', e);
  }
};

// ======================================================================
// CUMULATIVE MEMBERSHIP CALCULATION ENGINE
// Single Source of Truth: Masters -> Membership Types (getStoredMembershipTypes)
// ======================================================================
export const calculateMemberMembershipStatus = (
  memberOrIdentifier,
  customReceipts = null,
  customMembershipTypes = null
) => {
  const receipts = customReceipts || getStoredReceipts();
  const membershipTypes = customMembershipTypes || getStoredMembershipTypes();

  // Resolve member identifiers
  let memberId = null;
  let memberNo = null;
  let memberMobile = null;
  let memberName = null;
  let memberPan = null;
  let fallbackAmount = 0;

  if (typeof memberOrIdentifier === 'string') {
    memberId = memberOrIdentifier;
  } else if (memberOrIdentifier && typeof memberOrIdentifier === 'object') {
    memberId = memberOrIdentifier.id || null;
    memberNo =
      memberOrIdentifier.membershipNumber ||
      memberOrIdentifier.registrationNumber ||
      memberOrIdentifier.membershipNo ||
      null;
    memberMobile =
      memberOrIdentifier.mobile ||
      memberOrIdentifier.mobileNumber ||
      memberOrIdentifier.contactNumber ||
      memberOrIdentifier.phone ||
      null;
    memberName =
      memberOrIdentifier.fullName ||
      memberOrIdentifier.name ||
      memberOrIdentifier.membershipName ||
      null;
    memberPan = memberOrIdentifier.panNo || memberOrIdentifier.pan || null;
    fallbackAmount = Number(memberOrIdentifier.amount || memberOrIdentifier.paidAmount) || 0;
  }

  const normName = memberName ? memberName.trim().toLowerCase() : '';
  const normMobile = memberMobile ? String(memberMobile).trim().replace(/\D/g, '') : '';
  const normNo = memberNo ? String(memberNo).trim().toLowerCase() : '';
  const normId = memberId ? String(memberId).trim().toLowerCase() : '';

  // Find all individual receipts linked to this member
  const allMatchingReceipts = receipts.filter((r) => {
    // Direct Member ID match
    if (memberId && r.memberId && String(r.memberId).trim().toLowerCase() === normId) {
      return true;
    }

    // Membership Number / Reg Number match
    const rNo = String(r.membershipNo || '').trim().toLowerCase();
    if (rNo) {
      if (normNo && (rNo === normNo || normNo.includes(rNo) || rNo.includes(normNo))) return true;
      if (normId && rNo === normId) return true;
    }

    // Mobile Number match
    const rMobile = String(r.mobile || '').trim().replace(/\D/g, '');
    if (normMobile && rMobile && (normMobile === rMobile || normMobile.endsWith(rMobile) || rMobile.endsWith(normMobile))) {
      return true;
    }

    // Full Name match (exact normalized match)
    const rName = String(r.name || '').trim().toLowerCase();
    if (normName && rName && normName === rName) {
      return true;
    }

    return false;
  });

  // A. membershipReceipts (Particulars === 'Membership') -> Drives milestone logic
  const matchingReceipts = allMatchingReceipts.filter(
    (r) => String(r.particulars || '').trim().toLowerCase() === 'membership'
  );

  // B. otherReceipts (Particulars !== 'Membership') -> Donations, Hostel, Scholarship, etc.
  const otherReceipts = allMatchingReceipts.filter(
    (r) => String(r.particulars || '').trim().toLowerCase() !== 'membership'
  );

  // Calculate cumulative total paid from all individual membership receipts
  const receiptsTotal = matchingReceipts.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  // Calculate total other contributions (Donations, etc.)
  const totalOtherPaid = otherReceipts.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  // If there are recorded membership receipts, use their sum. Otherwise fallback to member's initial seed amount
  const totalMembershipPaid = matchingReceipts.length > 0 ? receiptsTotal : fallbackAmount;

  // Active Membership Types sorted ascending by configured milestone price
  const activeTypes = membershipTypes
    .filter((mt) => (mt.status || 'Active') === 'Active')
    .map((mt) => ({
      ...mt,
      milestonePrice: Number(
        mt.currentPrice !== undefined
          ? mt.currentPrice
          : mt.price !== undefined
          ? mt.price
          : mt.fee !== undefined
          ? mt.fee
          : 0
      )
    }))
    .sort((a, b) => a.milestonePrice - b.milestonePrice);

  let currentMembershipType = 'None';
  let currentMilestoneAmount = 0;
  let nextMilestoneType = null;
  let nextMilestoneAmount = null;
  let remainingAmount = 0;

  if (activeTypes.length > 0) {
    // Find all milestones reached (where milestonePrice <= totalMembershipPaid)
    const reachedTypes = activeTypes.filter((mt) => totalMembershipPaid >= mt.milestonePrice);

    if (reachedTypes.length > 0) {
      // Highest milestone reached
      const highestReached = reachedTypes[reachedTypes.length - 1];
      currentMembershipType = highestReached.name;
      currentMilestoneAmount = highestReached.milestonePrice;

      // Next higher milestone
      const higherTypes = activeTypes.filter((mt) => mt.milestonePrice > highestReached.milestonePrice);
      if (higherTypes.length > 0) {
        const nextType = higherTypes[0];
        nextMilestoneType = nextType.name;
        nextMilestoneAmount = nextType.milestonePrice;
        remainingAmount = Math.max(0, nextMilestoneAmount - totalMembershipPaid);
      } else {
        nextMilestoneType = null;
        nextMilestoneAmount = null;
        remainingAmount = 0;
      }
    } else {
      // Below the lowest configured milestone
      currentMembershipType = 'None';
      const lowestType = activeTypes[0];
      nextMilestoneType = lowestType.name;
      nextMilestoneAmount = lowestType.milestonePrice;
      remainingAmount = Math.max(0, nextMilestoneAmount - totalMembershipPaid);
    }
  }

  const isMilestoneReached = currentMembershipType !== 'None' && currentMembershipType !== 'Not Yet Reached';

  return {
    totalMembershipPaid,
    currentMembershipType,
    isMilestoneReached,
    currentMilestoneAmount,
    nextMilestoneType,
    nextMilestoneAmount,
    remainingAmount,
    receipts: matchingReceipts,
    membershipReceipts: matchingReceipts,
    receiptCount: matchingReceipts.length,
    otherReceipts,
    totalOtherPaid,
    allReceipts: allMatchingReceipts
  };
};

// ======================================================================
// LOCATION MASTERS STORE
// ======================================================================
export const getStoredStates = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.STATES);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Enforce Karnataka and Kerala strictly
        const allowed = parsed.filter(s => ['karnataka', 'kerala'].includes((s.name || '').toLowerCase().trim()));
        if (allowed.length > 0) return allowed;
      }
    }
  } catch (e) {
    console.error('Failed to parse states from storage', e);
  }
  return initialStates;
};

export const saveStoredStates = (states) => {
  try {
    localStorage.setItem(STORAGE_KEYS.STATES, JSON.stringify(states));
  } catch (e) {
    console.error('Failed to save states to storage', e);
  }
};

export const getStoredDistricts = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.DISTRICTS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.error('Failed to parse districts from storage', e);
  }
  return initialDistricts;
};

export const saveStoredDistricts = (districts) => {
  try {
    localStorage.setItem(STORAGE_KEYS.DISTRICTS, JSON.stringify(districts));
  } catch (e) {
    console.error('Failed to save districts to storage', e);
  }
};

export const getStoredTaluks = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.TALUKS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.error('Failed to parse taluks from storage', e);
  }
  return initialTaluks;
};

export const saveStoredTaluks = (taluks) => {
  try {
    localStorage.setItem(STORAGE_KEYS.TALUKS, JSON.stringify(taluks));
  } catch (e) {
    console.error('Failed to save taluks to storage', e);
  }
};

export const getStoredPostalCodes = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.POSTAL_CODES);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Ensure any new baseline postal directory records are available
        const existingKeys = new Set(parsed.map((p) => p.postalCode + '_' + (p.area || '')));
        const missing = initialPostalCodes.filter(
          (p) => !existingKeys.has(p.postalCode + '_' + (p.area || ''))
        );
        if (missing.length > 0) {
          const merged = [...parsed, ...missing];
          try {
            localStorage.setItem(STORAGE_KEYS.POSTAL_CODES, JSON.stringify(merged));
          } catch (_) {}
          return merged;
        }
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to parse postal codes from storage', e);
  }
  return initialPostalCodes;
};

export const saveStoredPostalCodes = (postalCodes) => {
  try {
    localStorage.setItem(STORAGE_KEYS.POSTAL_CODES, JSON.stringify(postalCodes));
  } catch (e) {
    console.error('Failed to save postal codes to storage', e);
  }
};

export const lookupLocationByPin = (pinCode) => {
  if (!pinCode || typeof pinCode !== 'string') return { found: false, matches: [] };
  const cleanPin = pinCode.trim();
  if (cleanPin.length !== 6 || !/^\d{6}$/.test(cleanPin)) {
    return { found: false, matches: [] };
  }

  const allPostalCodes = getStoredPostalCodes();
  const matches = allPostalCodes.filter(
    (item) => String(item.postalCode || '').trim() === cleanPin
  );

  if (matches.length === 0) {
    return { found: false, matches: [] };
  }

  const primaryMatch = matches.find((m) => m.status === 'Active' || m.status === 'Mapped') || matches[0];

  return {
    found: true,
    pinCode: primaryMatch.postalCode,
    area: primaryMatch.area,
    talukName: primaryMatch.talukName,
    talukId: primaryMatch.talukId,
    districtName: primaryMatch.districtName,
    districtId: primaryMatch.districtId,
    stateName: primaryMatch.stateName,
    stateId: primaryMatch.stateId,
    status: primaryMatch.status,
    allAreas: matches.map((m) => m.area),
    matches
  };
};

export const getStoredParticulars = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.RECEIPT_TYPES);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Merge missing default particulars if any
        const existingNames = new Set(parsed.map(p => (p.name || '').toLowerCase().trim()));
        let hasChanges = false;
        const merged = [...parsed];
        initialParticulars.forEach(initP => {
          if (!existingNames.has((initP.name || '').toLowerCase().trim())) {
            merged.push(initP);
            hasChanges = true;
          }
        });
        // Also check if Donation exists and ensure its default sub-types exist if none or empty
        const donationItem = merged.find(p => (p.name || '').toLowerCase().trim() === 'donation');
        if (donationItem) {
          const initDonation = initialParticulars.find(p => p.name === 'Donation');
          if (initDonation && (!donationItem.subTypes || donationItem.subTypes.length === 0)) {
            donationItem.subTypes = initDonation.subTypes;
            hasChanges = true;
          }
        }
        if (hasChanges) {
          try {
            localStorage.setItem(STORAGE_KEYS.RECEIPT_TYPES, JSON.stringify(merged));
          } catch (_) {}
        }
        return merged;
      }
    }
  } catch (e) {
    console.error('Failed to parse particulars from storage', e);
  }
  return initialParticulars;
};

export const saveStoredParticulars = (particulars) => {
  try {
    localStorage.setItem(STORAGE_KEYS.RECEIPT_TYPES, JSON.stringify(particulars));
  } catch (e) {
    console.error('Failed to save particulars to storage', e);
  }
};

// Aliases for backward compatibility
export const getStoredReceiptTypes = getStoredParticulars;
export const saveStoredReceiptTypes = saveStoredParticulars;

export const getActiveParticulars = () => {
  const all = getStoredParticulars();
  return all.filter(p => (p.status || 'Active') === 'Active');
};

export const getActiveParticularSubTypes = (particularName) => {
  if (!particularName) return [];
  const all = getStoredParticulars();
  const found = all.find(p => (p.name || '').toLowerCase().trim() === String(particularName).toLowerCase().trim());
  if (!found || !found.subTypes) return [];
  return found.subTypes.filter(st => (st.status || 'Active') === 'Active');
};

export const getStoredPaymentModes = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.PAYMENT_MODES);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error('Failed to parse payment modes from storage', e);
  }
  return PAYMENT_MODES;
};

export const saveStoredPaymentModes = (modes) => {
  try {
    localStorage.setItem(STORAGE_KEYS.PAYMENT_MODES, JSON.stringify(modes));
  } catch (e) {
    console.error('Failed to save payment modes to storage', e);
  }
};

export const getStoredGothras = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.GOTHRAS);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error('Failed to parse gothras from storage', e);
  }
  return GOTHRA_MASTER;
};

export const saveStoredGothras = (gothras) => {
  try {
    localStorage.setItem(STORAGE_KEYS.GOTHRAS, JSON.stringify(gothras));
  } catch (e) {
    console.error('Failed to save gothras to storage', e);
  }
};

export const addMemberToLabelQueue = (memberId) => {
  if (!memberId) return false;
  const currentList = getStoredLabelList();
  const alreadyExists = currentList.some((item) => item.memberId === memberId);
  if (!alreadyExists) {
    const today = new Date().toISOString().split('T')[0];
    const newItem = {
      id: `LBL-${String(Date.now()).slice(-4)}`,
      memberId,
      addedDate: today,
      addedBy: 'Admin User'
    };
    const updated = [newItem, ...currentList];
    saveStoredLabelList(updated);
    return true;
  }
  return false;
};

// ======================================================================
// PAYMENT MODE CONFIGURATION STORE
// ======================================================================
export const getStoredPaymentModeConfigs = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.PAYMENT_MODE_CONFIGS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Ensure baseline configs exist
        const existingKeys = new Set(
          parsed.map((c) =>
            `${(c.paymentMode || '').trim().toLowerCase()}_${(c.bankAccount || '').trim().toLowerCase()}`
          )
        );
        let hasChanges = false;
        const merged = [...parsed];

        initialPaymentModeConfigs.forEach((initCfg) => {
          const key = `${(initCfg.paymentMode || '').trim().toLowerCase()}_${(initCfg.bankAccount || '').trim().toLowerCase()}`;
          if (!existingKeys.has(key)) {
            merged.push(initCfg);
            hasChanges = true;
          }
        });

        if (hasChanges) {
          try {
            localStorage.setItem(STORAGE_KEYS.PAYMENT_MODE_CONFIGS, JSON.stringify(merged));
          } catch (_) {}
        }
        return merged;
      }
    }
  } catch (e) {
    console.error('Failed to parse payment mode configs from storage', e);
  }
  return initialPaymentModeConfigs;
};

export const saveStoredPaymentModeConfigs = (configs) => {
  try {
    localStorage.setItem(STORAGE_KEYS.PAYMENT_MODE_CONFIGS, JSON.stringify(configs));
  } catch (e) {
    console.error('Failed to save payment mode configs to storage', e);
  }
};

export const getActivePaymentModeConfigs = () => {
  const allConfigs = getStoredPaymentModeConfigs();
  return allConfigs.filter((c) => (c.status || 'Active') === 'Active');
};

export const getActivePaymentModes = () => {
  const activeConfigs = getActivePaymentModeConfigs();
  if (activeConfigs.length === 0) {
    return initialPaymentModeConfigs.map(formatPaymentModeLabel);
  }
  return activeConfigs.map(formatPaymentModeLabel);
};

export const getAllPaymentModes = () => {
  const allConfigs = getStoredPaymentModeConfigs();
  return allConfigs.map(formatPaymentModeLabel);
};

export const isPaymentModeOffline = (paymentModeLabel) => {
  if (!paymentModeLabel) return false;
  const str = String(paymentModeLabel).trim().toLowerCase();
  if (str === 'cash' || str.startsWith('cash') || str.startsWith('cheque') || str.startsWith('dd')) {
    return true;
  }
  const allConfigs = getStoredPaymentModeConfigs();
  const matched = allConfigs.find(
    (c) =>
      formatPaymentModeLabel(c).toLowerCase() === str ||
      (c.paymentMode || '').toLowerCase() === str
  );
  if (matched) {
    return (matched.paymentType || 'Offline') === 'Offline';
  }
  return false;
};

// Legacy Bank Details Fallbacks for backward compatibility
export const getStoredBankDetails = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.BANK_DETAILS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to parse bank details from storage', e);
  }
  return initialBankDetails;
};

export const saveStoredBankDetails = (bankDetails) => {
  try {
    localStorage.setItem(STORAGE_KEYS.BANK_DETAILS, JSON.stringify(bankDetails));
  } catch (e) {
    console.error('Failed to save bank details to storage', e);
  }
};

export const getActiveBankDetails = () => {
  const allBanks = getStoredBankDetails();
  return allBanks.filter((bank) => (bank.status || 'Active') === 'Active');
};


