// Definitive privilege matrix grouped by functional modules
export const allPrivileges = [
  {
    id: 'mod_dashboard',
    module: 'Dashboard',
    description: 'Overview of system metrics, member statistics, and activity',
    privileges: [
      { id: 'dashboard_view', name: 'View Dashboard', description: 'Access dashboard metrics and summary cards' }
    ]
  },
  {
    id: 'mod_masters',
    module: 'Masters',
    description: 'Master data configuration for geographic hierarchy and membership types',
    privileges: [
      { id: 'masters_states_view', name: 'View States', description: 'View states master directory' },
      { id: 'masters_states_edit', name: 'Create/Edit States', description: 'Add new states and update state records' },
      { id: 'masters_states_delete', name: 'Delete States', description: 'Remove or deactivate state records' },
      { id: 'masters_districts_view', name: 'View Districts', description: 'View districts master directory' },
      { id: 'masters_districts_edit', name: 'Create/Edit Districts', description: 'Add and modify district records' },
      { id: 'masters_districts_delete', name: 'Delete Districts', description: 'Remove or deactivate district records' },
      { id: 'masters_taluks_view', name: 'View Taluks', description: 'View taluks master directory' },
      { id: 'masters_taluks_edit', name: 'Create/Edit Taluks', description: 'Add and modify taluk records' },
      { id: 'masters_taluks_delete', name: 'Delete Taluks', description: 'Remove or deactivate taluk records' },
      { id: 'masters_postal_view', name: 'View Postal Codes', description: 'View postal codes and PIN mappings' },
      { id: 'masters_postal_edit', name: 'Create/Edit Postal Codes', description: 'Add and update individual postal codes' },
      { id: 'masters_postal_delete', name: 'Delete Postal Codes', description: 'Delete postal code mappings' },
      { id: 'masters_postal_import', name: 'Import Postal Codes', description: 'Bulk CSV import for postal codes' },
      { id: 'masters_membershiptypes_view', name: 'View Membership Types', description: 'View membership categories and active pricing' },
      { id: 'masters_membershiptypes_edit', name: 'Create/Edit Membership Types', description: 'Create and update membership tier definitions' },
      { id: 'masters_membershiptypes_price_edit', name: 'Manage Membership Prices', description: 'Revise membership prices and effective dates' },
      { id: 'masters_membershiptypes_price_history', name: 'View Price History', description: 'Access chronological pricing audit log' }
    ]
  },
  {
    id: 'mod_membership',
    module: 'Membership',
    description: 'End-to-end member lifecycle, applications, verifications, and approvals',
    privileges: [
      { id: 'members_view', name: 'View Members', description: 'View member directory and member lists' },
      { id: 'members_create', name: 'Create Members', description: 'Register new membership applications' },
      { id: 'members_edit', name: 'Edit Members', description: 'Modify member personal and contact details' },
      { id: 'members_delete', name: 'Delete Members', description: 'Archive or remove member records' },
      { id: 'members_approve', name: 'Approve Members', description: 'Review and approve pending membership applications' },
      { id: 'members_activate', name: 'Activate Members', description: 'Activate or restore membership status' },
      { id: 'members_registration_manage', name: 'Manage Membership Registration', description: 'Process registrations and issue receipts' },
      { id: 'members_profile_view', name: 'View Member Profile', description: 'Access detailed member profiles and family details' },
      { id: 'members_service_utilization_view', name: 'View Service Utilization', description: 'Track benefits and services used by members' }
    ]
  },
  {
    id: 'mod_users',
    module: 'Users',
    description: 'System user accounts, administrator access, and role configurations',
    privileges: [
      { id: 'users_view', name: 'View Users', description: 'View user accounts and administrator directory' },
      { id: 'users_create', name: 'Create Users', description: 'Register new system users and assign initial roles' },
      { id: 'users_edit', name: 'Edit Users', description: 'Update user profiles and role assignments' },
      { id: 'users_deactivate', name: 'Deactivate Users', description: 'Enable or disable user access to the system' },
      { id: 'roles_view', name: 'View Roles', description: 'View defined user roles and privilege matrices' },
      { id: 'roles_create', name: 'Create Roles', description: 'Define new custom system roles' },
      { id: 'roles_edit', name: 'Edit Roles', description: 'Modify role names and descriptions' },
      { id: 'roles_delete', name: 'Delete Roles', description: 'Remove unused roles from the system' },
      { id: 'roles_privileges_configure', name: 'Configure Privileges', description: 'Grant or revoke permissions for any role' }
    ]
  },
  {
    id: 'mod_reports',
    module: 'Reports',
    description: 'Analytics, statistical summaries, and data export facilities',
    privileges: [
      { id: 'reports_view', name: 'View Reports', description: 'Access demographic, membership, and financial reports' },
      { id: 'reports_export', name: 'Export Reports', description: 'Download reports as Excel, PDF, or CSV' }
    ]
  },
  {
    id: 'mod_system',
    module: 'System',
    description: 'System auditing, security logs, and configuration monitoring',
    privileges: [
      { id: 'system_audit_logs_view', name: 'View Audit Logs', description: 'Inspect timestamped administrative action history' }
    ]
  }
];

// Helper array of all privilege IDs for quick master select all
export const allPrivilegeIds = allPrivileges.flatMap(group => group.privileges.map(p => p.id));

// Initial mock roles
export const initialRoles = [
  {
    id: 1,
    name: 'Super Admin',
    code: 'super_admin',
    description: 'Full unrestricted system access across all modules, configuration, and audit logs.',
    rank_level: 1,
    is_all_access: true,
    usersCount: 2,
    status: true,
    createdAt: '2025-01-01',
    updatedAt: '2026-09-30',
    isSystem: true,
    permission_codes: [...allPrivilegeIds],
    privileges: [...allPrivilegeIds]
  },
  {
    id: 2,
    name: 'Admin',
    code: 'admin',
    description: 'General administrative control for masters, user management, and memberships without system audit changes.',
    rank_level: 10,
    is_all_access: false,
    usersCount: 5,
    status: true,
    createdAt: '2025-01-05',
    updatedAt: '2026-09-15',
    isSystem: false,
    permission_codes: [
      'dashboard_view',
      'masters_states_view', 'masters_states_edit', 'masters_districts_view', 'masters_districts_edit',
      'masters_taluks_view', 'masters_taluks_edit', 'masters_postal_view', 'masters_postal_edit', 'masters_postal_import',
      'masters_membershiptypes_view', 'masters_membershiptypes_edit', 'masters_membershiptypes_price_edit', 'masters_membershiptypes_price_history',
      'members_view', 'members_create', 'members_edit', 'members_approve', 'members_activate', 'members_registration_manage', 'members_profile_view', 'members_service_utilization_view',
      'users_view', 'users_create', 'users_edit', 'roles_view',
      'reports_view', 'reports_export'
    ],
    privileges: [
      'dashboard_view',
      'masters_states_view', 'masters_states_edit', 'masters_districts_view', 'masters_districts_edit',
      'masters_taluks_view', 'masters_taluks_edit', 'masters_postal_view', 'masters_postal_edit', 'masters_postal_import',
      'masters_membershiptypes_view', 'masters_membershiptypes_edit', 'masters_membershiptypes_price_edit', 'masters_membershiptypes_price_history',
      'members_view', 'members_create', 'members_edit', 'members_approve', 'members_activate', 'members_registration_manage', 'members_profile_view', 'members_service_utilization_view',
      'users_view', 'users_create', 'users_edit', 'roles_view',
      'reports_view', 'reports_export'
    ]
  },
  {
    id: 3,
    name: 'Membership Manager',
    code: 'membership_manager',
    description: 'Manages member registration, profiles, fee revisions, and service utilization monitoring.',
    rank_level: 20,
    is_all_access: false,
    usersCount: 8,
    status: true,
    createdAt: '2025-01-10',
    updatedAt: '2026-08-20',
    isSystem: false,
    permission_codes: [
      'dashboard_view',
      'masters_states_view', 'masters_districts_view', 'masters_taluks_view', 'masters_postal_view', 'masters_membershiptypes_view', 'masters_membershiptypes_price_history',
      'members_view', 'members_create', 'members_edit', 'members_activate', 'members_registration_manage', 'members_profile_view', 'members_service_utilization_view',
      'reports_view', 'reports_export'
    ],
    privileges: [
      'dashboard_view',
      'masters_states_view', 'masters_districts_view', 'masters_taluks_view', 'masters_postal_view', 'masters_membershiptypes_view', 'masters_membershiptypes_price_history',
      'members_view', 'members_create', 'members_edit', 'members_activate', 'members_registration_manage', 'members_profile_view', 'members_service_utilization_view',
      'reports_view', 'reports_export'
    ]
  },
  {
    id: 4,
    name: 'Membership Approver',
    code: 'membership_approver',
    description: 'Authorized executive to review and officially approve incoming membership applications.',
    rank_level: 30,
    is_all_access: false,
    usersCount: 4,
    status: true,
    createdAt: '2025-01-15',
    updatedAt: '2026-07-12',
    isSystem: false,
    permission_codes: [
      'dashboard_view',
      'masters_membershiptypes_view',
      'members_view', 'members_approve', 'members_activate', 'members_profile_view',
      'reports_view'
    ],
    privileges: [
      'dashboard_view',
      'masters_membershiptypes_view',
      'members_view', 'members_approve', 'members_activate', 'members_profile_view',
      'reports_view'
    ]
  },
  {
    id: 5,
    name: 'Data Entry Operator',
    code: 'data_entry_operator',
    description: 'Responsible for inputting applicant information and uploading postal code master records.',
    rank_level: 40,
    is_all_access: false,
    usersCount: 12,
    status: true,
    createdAt: '2025-02-01',
    updatedAt: '2026-09-01',
    isSystem: false,
    permission_codes: [
      'dashboard_view',
      'masters_states_view', 'masters_districts_view', 'masters_taluks_view', 'masters_postal_view', 'masters_postal_edit', 'masters_postal_import',
      'members_view', 'members_create', 'members_profile_view'
    ],
    privileges: [
      'dashboard_view',
      'masters_states_view', 'masters_districts_view', 'masters_taluks_view', 'masters_postal_view', 'masters_postal_edit', 'masters_postal_import',
      'members_view', 'members_create', 'members_profile_view'
    ]
  },
  {
    id: 6,
    name: 'Viewer',
    code: 'viewer',
    description: 'Read-only access to dashboard statistics, member lists, and demographic reports.',
    rank_level: 99,
    is_all_access: false,
    usersCount: 3,
    status: false,
    createdAt: '2025-02-15',
    updatedAt: '2026-03-10',
    isSystem: false,
    permission_codes: [
      'dashboard_view',
      'masters_states_view', 'masters_districts_view', 'masters_taluks_view', 'masters_postal_view', 'masters_membershiptypes_view',
      'members_view', 'members_profile_view',
      'reports_view'
    ],
    privileges: [
      'dashboard_view',
      'masters_states_view', 'masters_districts_view', 'masters_taluks_view', 'masters_postal_view', 'masters_membershiptypes_view',
      'members_view', 'members_profile_view',
      'reports_view'
    ]
  }
];

// Permission Verification Utility Function
export const hasPrivilege = (user, requiredCode) => {
  if (!user) return false;
  // Super admins with all access bypass checks
  if (
    user.is_all_access ||
    user.role?.is_all_access ||
    user.role?.isSystem ||
    user.role?.rank_level === 1 ||
    user.rank_level === 1
  ) return true;

  const permissions = user.permission_codes || user.privileges || [];
  return permissions.includes(requiredCode) || permissions.includes('*');
};
