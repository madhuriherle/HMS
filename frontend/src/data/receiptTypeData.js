// Master Data for Particulars and Sub-Types

export const initialParticulars = [
  {
    id: 1,
    name: 'Membership',
    status: 'Active',
    subTypes: []
  },
  {
    id: 2,
    name: 'Scholarship',
    status: 'Active',
    subTypes: []
  },
  {
    id: 3,
    name: 'Donation',
    status: 'Active',
    subTypes: [
      {
        id: 301,
        name: 'Tritiya Vishwa Havyaka Samelana Donation',
        status: 'Active'
      },
      {
        id: 302,
        name: 'Vidya Prothsaha Nidhi',
        status: 'Active'
      },
      {
        id: 303,
        name: 'Building Fund',
        status: 'Active'
      },
      {
        id: 304,
        name: 'Aartha Sahaya Nidhi',
        status: 'Active'
      },
      {
        id: 305,
        name: 'Vaidihika Nidhi',
        status: 'Active'
      },
      {
        id: 306,
        name: 'General Donation',
        status: 'Active'
      }
    ]
  },
  {
    id: 4,
    name: 'Hostel Payment',
    status: 'Active',
    subTypes: []
  },
  {
    id: 5,
    name: 'Function Deposit',
    status: 'Active',
    subTypes: []
  },
  {
    id: 6,
    name: 'Cultural Events',
    status: 'Active',
    subTypes: []
  },
  {
    id: 7,
    name: 'Others',
    status: 'Active',
    subTypes: []
  }
];

// Alias for backward compatibility
export const initialReceiptTypes = initialParticulars;
