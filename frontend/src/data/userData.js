export const initialUsers = [
  {
    id: 1,
    name: 'Admin User',
    fullName: 'Admin User',
    username: 'admin',
    password: 'Admin@123',
    email: 'admin@hmsmma.com',
    mobile: '9876543210',
    mobile_country_code: '+91',
    role_id: 1, // Super Admin
    roleId: 1,
    status: true,
    isCurrentAdmin: true,
    createdAt: '2025-01-01',
    lastLogin: '2026-09-30 09:45 AM'
  },
  {
    id: 2,
    name: 'Ramesh Bhat',
    fullName: 'Ramesh Bhat',
    username: 'membership.manager',
    password: 'Manager@123',
    email: 'manager@hmsmma.com',
    mobile: '9876543211',
    mobile_country_code: '+91',
    role_id: 3, // Membership Manager
    roleId: 3,
    status: true,
    isCurrentAdmin: false,
    createdAt: '2025-01-10',
    lastLogin: '2026-09-29 04:15 PM'
  },
  {
    id: 3,
    name: 'Sujatha Hegde',
    fullName: 'Sujatha Hegde',
    username: 'approver.hegde',
    password: 'Approver@123',
    email: 'approver@hmsmma.com',
    mobile: '9876543215',
    mobile_country_code: '+91',
    role_id: 4, // Membership Approver
    roleId: 4,
    status: true,
    isCurrentAdmin: false,
    createdAt: '2025-01-20',
    lastLogin: '2026-09-28 11:20 AM'
  },
  {
    id: 4,
    name: 'Ganesh Sharma',
    fullName: 'Ganesh Sharma',
    username: 'data.entry',
    password: 'DataEntry@123',
    email: 'dataentry@hmsmma.com',
    mobile: '9876543212',
    mobile_country_code: '+91',
    role_id: 5, // Data Entry Operator
    roleId: 5,
    status: true,
    isCurrentAdmin: false,
    createdAt: '2025-02-01',
    lastLogin: '2026-09-30 08:30 AM'
  },
  {
    id: 5,
    name: 'Kavya Shastri',
    fullName: 'Kavya Shastri',
    username: 'support.admin',
    password: 'Support@123',
    email: 'support@hmsmma.com',
    mobile: '9876543214',
    mobile_country_code: '+91',
    role_id: 2, // Admin
    roleId: 2,
    status: true,
    isCurrentAdmin: false,
    createdAt: '2025-02-10',
    lastLogin: '2026-09-27 02:10 PM'
  },
  {
    id: 6,
    name: 'Narayana Upadhyaya',
    fullName: 'Narayana Upadhyaya',
    username: 'viewer',
    password: 'Viewer@123',
    email: 'viewer@hmsmma.com',
    mobile: '9876543213',
    mobile_country_code: '+91',
    role_id: 6, // Viewer
    roleId: 6,
    status: false,
    isCurrentAdmin: false,
    createdAt: '2025-02-15',
    lastLogin: '2026-03-10 10:00 AM'
  }
];
