// Master Data for Bank Details / Bank Accounts (Payment Modes)

export const initialBankDetails = [
  {
    id: 'BANK-01',
    paymentMode: 'KBL 1075',
    bankName: 'Karnataka Bank',
    branch: 'Malleswaram',
    ifscCode: 'KARB0000107',
    accountNumber: '010750010001075',
    status: 'Active',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'BANK-02',
    paymentMode: 'KBL 1541',
    bankName: 'Karnataka Bank',
    branch: 'Jayanagar',
    ifscCode: 'KARB0000154',
    accountNumber: '015410010001541',
    status: 'Active',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'BANK-03',
    paymentMode: 'SBI',
    bankName: 'State Bank of India',
    branch: 'Kumbashi',
    ifscCode: 'SBIN0040123',
    accountNumber: '30891234567',
    status: 'Active',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'BANK-04',
    paymentMode: 'CANARA BANK',
    bankName: 'Canara Bank',
    branch: 'Bangalore Main',
    ifscCode: 'CNRB0000567',
    accountNumber: '0567101012345',
    status: 'Active',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
];

export const BANK_PAYMENT_MODE_OPTIONS = [
  'KBL 1075',
  'KBL 1541',
  'SBI',
  'CANARA BANK'
];
