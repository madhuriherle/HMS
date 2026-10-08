// Master Data for Payment Mode Configurations (Cash / Online)

export const initialPaymentModeConfigs = [
  {
    id: 'PM-01',
    paymentMode: 'Cash',
    paymentType: 'Offline',
    bankAccount: '',
    branch: '',
    ifscCode: '',
    accountNumber: '',
    status: 'Active',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'PM-02',
    paymentMode: 'Online',
    paymentType: 'Online',
    bankAccount: 'KBL 1075',
    branch: 'Malleswaram',
    ifscCode: 'KARB0000107',
    accountNumber: '010750010001075',
    status: 'Active',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'PM-03',
    paymentMode: 'Online',
    paymentType: 'Online',
    bankAccount: 'KBL 1541',
    branch: 'Jayanagar',
    ifscCode: 'KARB0000154',
    accountNumber: '015410010001541',
    status: 'Active',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'PM-04',
    paymentMode: 'Online',
    paymentType: 'Online',
    bankAccount: 'SBI',
    branch: 'Kumbashi',
    ifscCode: 'SBIN0040123',
    accountNumber: '30891234567',
    status: 'Active',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'PM-05',
    paymentMode: 'Online',
    paymentType: 'Online',
    bankAccount: 'CANARA BANK',
    branch: 'Bangalore Main',
    ifscCode: 'CNRB0000567',
    accountNumber: '0567101012345',
    status: 'Active',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
];

export const AVAILABLE_PAYMENT_MODES = [
  'Cash',
  'Online',
  'Cheque',
  'DD',
  'UPI',
  'NEFT'
];

export const AVAILABLE_PAYMENT_TYPES = [
  'Offline',
  'Online'
];

export const AVAILABLE_BANK_ACCOUNTS = [
  'KBL 1075',
  'KBL 1541',
  'SBI',
  'CANARA BANK'
];

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
    return config.paymentMode;
  }
  return config.bankAccount;
};
