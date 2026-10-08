export const initialMembershipTypes = [
  {
    id: 'MT-01',
    name: 'Poshaka',
    currentPrice: 1000,
    onlineList: 'Yes',
    effectiveFrom: '2026-10-01',
    status: 'Active',
    createdAt: '2026-01-01',
    updatedAt: '2026-10-01',
    priceHistory: [
      {
        id: 'PH-01-2',
        membershipTypeId: 'MT-01',
        price: 1000,
        effectiveFrom: '2026-10-01',
        effectiveTo: 'Present',
        reason: 'Annual revision for new financial year',
        changedAt: '2026-10-01'
      },
      {
        id: 'PH-01-1',
        membershipTypeId: 'MT-01',
        price: 500,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-09-30',
        reason: 'Initial launch fee',
        changedAt: '2025-12-31'
      }
    ]
  },
  {
    id: 'MT-02',
    name: 'Mahaposhaka',
    currentPrice: 2000,
    onlineList: 'Yes',
    effectiveFrom: '2026-04-01',
    status: 'Active',
    createdAt: '2026-01-01',
    updatedAt: '2026-04-01',
    priceHistory: [
      {
        id: 'PH-02-2',
        membershipTypeId: 'MT-02',
        price: 2000,
        effectiveFrom: '2026-04-01',
        effectiveTo: 'Present',
        reason: 'Revised tier contribution fee',
        changedAt: '2026-04-01'
      },
      {
        id: 'PH-02-1',
        membershipTypeId: 'MT-02',
        price: 1000,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-03-31',
        reason: 'Initial launch fee',
        changedAt: '2025-12-31'
      }
    ]
  },
  {
    id: 'MT-03',
    name: 'Mahapalaka',
    currentPrice: 10000,
    onlineList: 'Yes',
    effectiveFrom: '2026-01-01',
    status: 'Active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    priceHistory: [
      {
        id: 'PH-03-1',
        membershipTypeId: 'MT-03',
        price: 10000,
        effectiveFrom: '2026-01-01',
        effectiveTo: 'Present',
        reason: 'Initial Mahapalaka membership fee',
        changedAt: '2025-12-31'
      }
    ]
  },
  {
    id: 'MT-04',
    name: 'Sahasadasyatva',
    currentPrice: 5000,
    onlineList: 'Yes',
    effectiveFrom: '2026-01-01',
    status: 'Active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    priceHistory: [
      {
        id: 'PH-04-1',
        membershipTypeId: 'MT-04',
        price: 5000,
        effectiveFrom: '2026-01-01',
        effectiveTo: 'Present',
        reason: 'Initial Sahasadasyatva membership fee',
        changedAt: '2025-12-31'
      }
    ]
  },
  {
    id: 'MT-05',
    name: 'Ajeeva',
    currentPrice: 10000,
    onlineList: 'Yes',
    effectiveFrom: '2026-01-01',
    status: 'Active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    priceHistory: [
      {
        id: 'PH-05-1',
        membershipTypeId: 'MT-05',
        price: 10000,
        effectiveFrom: '2026-01-01',
        effectiveTo: 'Present',
        reason: 'Initial Ajeeva (Life) membership fee',
        changedAt: '2025-12-31'
      }
    ]
  }
];
