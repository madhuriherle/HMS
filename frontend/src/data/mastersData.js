export const MEMBERSHIP_TYPES = [
  { id: 'MT-03', name: 'Mahapalaka', fee: 10000 },
  { id: 'MT-02', name: 'Mahaposhaka', fee: 2000 },
  { id: 'MT-01', name: 'Poshaka', fee: 1000 },
  { id: 'MT-04', name: 'Sahasadasyatva', fee: 5000 }
];

export const MEMBERSHIP_NAMES_MASTER = [
  { id: 'MNM-01', code: 'MP', membershipName: 'Mahapalaka', defaultAmount: 10000 },
  { id: 'MNM-02', code: 'MPH', membershipName: 'Mahaposhaka', defaultAmount: 2000 },
  { id: 'MNM-03', code: 'PO', membershipName: 'Poshaka', defaultAmount: 1000 },
  { id: 'MNM-04', code: 'SD', membershipName: 'Sahasadasyatva', defaultAmount: 5000 }
];

export const GOTHRA_MASTER = [
  'GENERAL',
  'Vishwamitra',
  'Vashistha',
  'Kashyapa',
  'Bharadwaja',
  'Gautama',
  'Jamadagni',
  'Atri',
  'Haritsa',
  'Angirasa',
  'Kaundinya',
  'Koushika',
  'Agastya',
  'Shrivatsa',
  'Shandilya',
  'Mudgala',
  'Gargya',
  'Kapila'
];

export const RECEIPT_TYPES = [
  { id: 'RT-01', name: 'Receipt for Membership', requiresMembershipFee: true },
  { id: 'RT-02', name: 'Receipt for Donation', requiresMembershipFee: false },
  { id: 'RT-03', name: 'Receipt for Scholarship', requiresMembershipFee: false }
];

export const PAYMENT_MODES = [
  'SBI',
  'KBL 1075',
  'Cash',
  'Cheque',
  'UPI / Online Transfer'
];


