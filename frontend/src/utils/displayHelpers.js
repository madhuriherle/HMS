// Pure display helpers. They work only on data passed in from the server;
// nothing here reads or writes browser storage.

export const formatPaymentModeLabel = (config) => {
  if (!config) return '';
  if (
    config.paymentType === 'Offline' ||
    config.paymentMode === 'Cash' ||
    !config.bankAccount ||
    config.bankAccount === 'Not Applicable' ||
    config.bankAccount === 'NA' ||
    config.bankAccount === '—'
  ) {
    return config.paymentMode || '';
  }
  return config.bankAccount;
};

export const isReceiptUnmapped = (receipt) => {
  if (!receipt) return false;
  // a receipt is assigned when the server has linked it to a member
  return !(receipt.memberId || (receipt.membershipNo && String(receipt.membershipNo).trim() !== ''));
};

// Cumulative membership calculation: which membership type the amount paid has
// reached, from the member's receipts and the membership types loaded from the server.
export const calculateMemberMembershipStatus = (
  memberOrIdentifier,
  receipts = [],
  membershipTypes = []
) => {
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
