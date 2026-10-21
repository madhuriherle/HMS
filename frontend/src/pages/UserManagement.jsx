import React, { useState, useMemo, useEffect, useRef } from 'react';
import useSort from '../hooks/useSort';
import SortTh from '../components/SortTh';
import Modal from '../components/Modal';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
import {
  Users,
  UserPlus,
  Search,
  Pencil,
  Trash2,
  Eye,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  X,
  AlertCircle,
  Mail,
  Phone,
  Shield,
  Key,
  Lock,
  EyeOff,
  User,
  Check,
} from 'lucide-react';
import api from '../api';
import { formatDate, formatDateTime } from '../utils/dateUtils';
import { notify } from '../utils/notify';
import useAuth from '../hooks/useAuth';
import useRules, { matchesPattern, mobileProblem, passwordProblem } from '../hooks/useRules';
import useSwalConfirm from '../hooks/useSwalConfirm';
import PermissionGate from '../components/PermissionGate';

import ModalFooter from '../components/ModalFooter';
export default function UserManagement() {
  const { myRank, hasPermission } = useAuth();
  const rules = useRules(); // formats and limits from the server
  // Roles weaker than mine, or my own rank can be assigned — mirrors the backend rule.
  const sameRankOk = (rank) => rank >= myRank;
  const availableRoles = roles => roles.filter(r => r.code !== 'MEMBER' && r.name?.toLowerCase() !== 'member' && sameRankOk(r.rank_level ?? 99));
  const getUserRank = (user) => {
    const direct = user?.role_rank_level;
    if (direct != null) return Number(direct);
    const roleObj = roles.find(r => r.id === (user?.role_id ?? user?.roleId) || String(r.id) === String(user?.role_id ?? user?.roleId));
    return roleObj?.rank_level ?? null;
  };
  // A user stronger than me is protected: never editable/deletable from this screen.
  const canManageUser = (user) => {
    const r = getUserRank(user);
    return r == null || sameRankOk(r);
  };
  // Master state
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [allPrivileges] = useState([]);
  const [, setLoading] = useState(true);

  const { sort, toggle: toggleSort, params: sortParams } = useSort();
  const firstLoad = useRef(true);
  const readUsers = async () => {
    const usersResponse = await api.get('/users/', { params: { limit: 200, ...sortParams } });
    const rawUserRows = Array.isArray(usersResponse.data)
      ? usersResponse.data
      : (usersResponse.data?.data || usersResponse.data?.items || []);
    return rawUserRows.filter(
      (u) => u.user_type !== 'MEMBER' && !u.member_id && u.role_name !== 'Member'
    );
  };

  // --- Fetch API Data on Mount ---
  useEffect(() => {
    const fetchMasterData = async () => {
      try {
        setLoading(true);
        setUsers(await readUsers());

        const rolesResponse = await api.get('/users/roles', { params: { limit: 200, assignable: true } });
        const rawRoleRows = Array.isArray(rolesResponse.data)
          ? rolesResponse.data
          : (rolesResponse.data?.data || rolesResponse.data?.items || []);
        const roleRows = rawRoleRows.filter(
          (r) => r.code !== 'MEMBER' && r.name?.toLowerCase() !== 'member'
        );
        setRoles(roleRows);
      } catch (error) {
        console.error("API Fetch Error:", error); showToast(error.response?.data?.detail || 'Could not load data from the server.', 'error');
      } finally {
        setLoading(false);
      }
    };
    fetchMasterData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the users are read again when the sort changes (the default is newest first)
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return; }
    readUsers().then(setUsers).catch((error) => showToast(error.response?.data?.detail || 'Could not load the users.', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort.by, sort.dir]);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Add / Edit Modal State
  const [isAddEditOpen, setIsAddEditOpen] = useState(false);
  const [modalMode, setModalMode] = useState('add'); // 'add' | 'edit'
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    fullName: '',
    username: '',
    email: '',
    mobile: '',
    password: '',
    confirmPassword: '',
    roleId: '',
    status: 'Active'
  });
  const [formErrors, setFormErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // View User Details Modal State
  const [viewingUser, setViewingUser] = useState(null);

  // Delete User Confirmation State
  const [deleteTargetUser, setDeleteTargetUser] = useState(null);

  // Status Toggle Confirmation State
  const [statusDialog, setStatusDialog] = useState(null); // { user, newStatus }

  // Toast / Feedback Modal State
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (message, type = 'success') => {
    notify(message, type);
  };

  // Helper to resolve role object from roleId
  const getRoleById = (roleId) => {
    if (roleId === undefined || roleId === null || roleId === '') return null;
    return roles.find(r => r.id === roleId || r.id === Number(roleId) || String(r.id) === String(roleId)) || null;
  };

  // Role currently picked in the Add / Edit form (drives the privileges preview box)
  const selectedFormRole = getRoleById(formData.roleId);

  // Helper for active status check (supports boolean and string)
  const isUserActive = (user) => {
    if (!user) return false;
    return typeof user.status === 'boolean' ? user.status : user.status === 'Active';
  };

  // ----------------------------------------------------
  // SUMMARY METRICS
  // ----------------------------------------------------

  // ----------------------------------------------------
  // SEARCH & FILTERING
  // ----------------------------------------------------
  const handleClearFilters = () => {
    setSearchQuery('');
    setRoleFilter('ALL');
    setStatusFilter('ALL');
    setCurrentPage(1);
  };

  const hasActiveFilters = searchQuery !== '' || roleFilter !== 'ALL' || statusFilter !== 'ALL';

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const q = searchQuery.toLowerCase().trim();
      const uName = user.name || user.fullName || '';
      const matchSearch =
        !q ||
        uName.toLowerCase().includes(q) ||
        (user.username && user.username.toLowerCase().includes(q)) ||
        (user.email && user.email.toLowerCase().includes(q)) ||
        (user.mobile && user.mobile.includes(q));

      const userRoleId = user.role_id ?? user.roleId;
      const matchRole =
        roleFilter === 'ALL' ||
        userRoleId === Number(roleFilter) ||
        String(userRoleId) === String(roleFilter);

      const active = isUserActive(user);
      const matchStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'Active' && active) ||
        (statusFilter === 'Inactive' && !active) ||
        (statusFilter === 'true' && active) ||
        (statusFilter === 'false' && !active);

      return matchSearch && matchRole && matchStatus;
    });
  }, [users, searchQuery, roleFilter, statusFilter]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredUsers.length / pageSize) || 1;
  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredUsers.slice(start, start + pageSize);
  }, [filteredUsers, currentPage, pageSize]);

  // ----------------------------------------------------
  // ADD / EDIT USER FORM LOGIC
  // ----------------------------------------------------
  const openAddModal = () => {
    setModalMode('add');
    setEditingUser(null);
    const firstRole = availableRoles(roles)[0];
    setFormData({
      fullName: '',
      username: '',
      email: '',
      mobile: '',
      password: '',
      confirmPassword: '',
      roleId: firstRole?.id ? Number(firstRole.id) : '',
      status: true
    });
    setFormErrors({});
    setShowPassword(false);
    setShowConfirmPassword(false);
    setIsAddEditOpen(true);
  };

  const openEditModal = (user) => {
    if (!canManageUser(user)) {
      showToast('You cannot edit this user.', 'error');
      return;
    }
    setModalMode('edit');
    setEditingUser(user);
    const userRoleId = user.role_id ?? user.roleId;
    setFormData({
      fullName: user.name || user.fullName || '',
      username: user.username,
      email: user.email || '',
      mobile: user.mobile || '',
      password: '',
      confirmPassword: '',
      roleId: userRoleId ? Number(userRoleId) : '',
      status: isUserActive(user)
    });
    setFormErrors({});
    setShowPassword(false);
    setShowConfirmPassword(false);
    setIsAddEditOpen(true);
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    if (name === 'mobile') {
      const cleaned = value.replace(/\D/g, '').slice(0, rules?.mobile?.max_digits ?? 15);
      setFormData(prev => ({ ...prev, mobile: cleaned }));
    } else if (name === 'username') {
      const cleaned = value.replace(/[^a-zA-Z0-9._]/g, '').toLowerCase();
      setFormData(prev => ({ ...prev, username: cleaned }));
    } else if (name === 'roleId' || name === 'role_id') {
      const numVal = value !== '' ? Number(value) : '';
      setFormData(prev => ({ ...prev, roleId: numVal }));
    } else if (name === 'status') {
      const boolVal = value === 'true' || value === true || value === 'Active';
      setFormData(prev => ({ ...prev, status: boolVal }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }

    if (formErrors[name]) {
      setFormErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validateUserForm = () => {
    const errors = {};
    const fullName = formData.fullName?.trim();
    const username = formData.username?.trim();
    const email = formData.email?.trim();
    const mobile = formData.mobile?.trim();

    if (!fullName) {
      errors.fullName = 'Full Name is required';
    }

    if (!username) {
      errors.username = 'Username is required';
    } else if (rules && username.length < rules.username.min_length) {
      errors.username = `Username must be at least ${rules.username.min_length} characters`;
    } else if (rules && !matchesPattern(username, rules.username.pattern)) {
      errors.username = 'Username can only contain letters, numbers, dots and underscores';
    } else {
      const isDuplicateUsername = users.some(
        u => (u.id !== editingUser?.id && String(u.id) !== String(editingUser?.id)) &&
          u.username.toLowerCase() === username.toLowerCase()
      );
      if (isDuplicateUsername) {
        errors.username = 'This username is already taken. Please choose another.';
      }
    }

    // email and mobile are optional; when given they must be valid and not already used
    if (email && !matchesPattern(email, rules?.email?.pattern)) {
      errors.email = 'Please enter a valid email address';
    } else if (email) {
      const isDuplicateEmail = users.some(
        u => (u.id !== editingUser?.id && String(u.id) !== String(editingUser?.id)) &&
          (u.email || '').toLowerCase() === email.toLowerCase()
      );
      if (isDuplicateEmail) {
        errors.email = 'A user with this email address already exists.';
      }
    }

    if (mobile && mobileProblem(rules, mobile)) {
      errors.mobile = mobileProblem(rules, mobile);
    }

    if (formData.roleId === '' || formData.roleId === undefined || formData.roleId === null) {
      errors.roleId = 'Please select a Role';
    }

    if (modalMode === 'add') {
      if (!formData.password) {
        errors.password = 'Password is required';
      } else if (passwordProblem(rules, formData.password)) {
        errors.password = passwordProblem(rules, formData.password);
      }

      if (!formData.confirmPassword) {
        errors.confirmPassword = 'Confirm Password is required';
      } else if (formData.password !== formData.confirmPassword) {
        errors.confirmPassword = 'Passwords do not match';
      }
    } else {
      // Edit mode: password is optional (only validated if entered)
      if (formData.password) {
        if (passwordProblem(rules, formData.password)) {
          errors.password = passwordProblem(rules, formData.password);
        }
        if (formData.password !== formData.confirmPassword) {
          errors.confirmPassword = 'Passwords do not match';
        }
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveUser = async (e) => {
    e.preventDefault();
    if (!validateUserForm()) return;

    try {
      const payload = {
        name: formData.fullName.trim(),
        username: formData.username.trim(),
        email: formData.email.trim() || null,
        mobile: formData.mobile.trim() || null,
        mobile_country_code: '+91',
        role_id: Number(formData.roleId),
        status: typeof formData.status === 'boolean' ? formData.status : (formData.status === 'Active' || formData.status === 'true')
      };
      if (formData.password) {
        payload.password = formData.password;
      }

      if (modalMode === 'add') {
        const res = await api.post('/users/', payload);
        setUsers(prev => [res.data, ...prev]);
        showToast('User created successfully.');
      } else {
        const res = await api.put(`/users/${editingUser.id}`, payload);
        setUsers(prev => prev.map(u => (u.id === editingUser.id || String(u.id) === String(editingUser.id)) ? res.data : u));
        showToast('User updated successfully.');
      }
      setIsAddEditOpen(false);
      setFormData({ fullName: '', username: '', email: '', mobile: '', roleId: '', status: 'Active', password: '', confirmPassword: '' });
    } catch (err) {
      showToast(err?.response?.data?.detail || 'Error saving user', 'error');
    }
  };

  const promptToggleStatus = (user) => {
    if (user.isCurrentAdmin || user.username === 'admin' || user.id === 1) {
      showToast('This account cannot be deactivated.', 'error');
      return;
    }
    if (!canManageUser(user)) {
      showToast('You cannot change this user.', 'error');
      return;
    }
    const active = isUserActive(user);
    setStatusDialog({
      user,
      newStatus: !active
    });
  };

  const handleConfirmStatusToggle = async () => {
    if (!statusDialog) return;
    const { user, newStatus } = statusDialog;

    try {
      const res = await api.put(`/users/${user.id}`, { status: newStatus }, { params: { reason: 'Status changed via UI' } });
      const updated = res.data?.id ? res.data : { ...user, status: newStatus };
      setUsers(prev => prev.map(u => (u.id === user.id || String(u.id) === String(user.id)) ? updated : u));

      if (viewingUser && (viewingUser.id === user.id || String(viewingUser.id) === String(user.id))) {
        setViewingUser(updated);
      }

      showToast('User status updated successfully.');
    } catch (err) {
      const detail = err?.response?.data?.detail;
      showToast(typeof detail === 'string' ? detail : 'Error updating user status', 'error');
    }
    setStatusDialog(null);
  };

  // ----------------------------------------------------
  // DELETE USER LOGIC
  // ----------------------------------------------------
  const confirmDeleteUser = async () => {
    if (!deleteTargetUser) return;
    if (deleteTargetUser.isCurrentAdmin || deleteTargetUser.username === 'admin') return;
    if (!canManageUser(deleteTargetUser)) {
      showToast('You cannot delete this user.', 'error');
      setDeleteTargetUser(null);
      return;
    }
    const target = deleteTargetUser;

    try {
      const res = await api.delete(`/users/${target.id}`, { params: { reason: 'Deleted via UI' } });
      if (res.data?.approval_request_id || res.data?.status === 'PENDING') {
        showToast('User deletion submitted for approval.');
      } else {
        setUsers(prev => prev.filter(u => u.id !== target.id && String(u.id) !== String(target.id)));
        showToast(`User "${target.name || target.fullName}" deleted successfully.`);
      }
    } catch (err) {
      const detail = err?.response?.data?.detail;
      showToast(typeof detail === 'string' ? detail : 'Error deleting user', 'error');
    }
    setDeleteTargetUser(null);
  };

  useSwalConfirm(
    deleteTargetUser,
    () => setDeleteTargetUser(null),
    (d) => {
      const name = d.name || d.fullName;
      if (d.isCurrentAdmin || d.username === 'admin') {
        return {
          title: 'Cannot delete user',
          text: `${name} is the active main account and cannot be deleted.`,
          confirmText: 'OK',
          info: true,
        };
      }
      return {
        title: 'Delete user?',
        text: `Are you sure you want to delete user ${name} (${d.username})? This action cannot be undone.`,
        confirmText: 'Yes, delete',
        danger: true,
      };
    },
    async () => {
      const d = deleteTargetUser;
      if (d.isCurrentAdmin || d.username === 'admin') return;
      await confirmDeleteUser();
    }
  );

  useSwalConfirm(
    statusDialog,
    () => setStatusDialog(null),
    (d) => {
      const name = d.user?.name || d.user?.fullName || d.user?.username;
      return {
        title: `${d.newStatus === 'Inactive' ? 'Deactivate' : 'Activate'} user?`,
        text: d.newStatus === 'Inactive'
          ? `Deactivate ${name}? Deactivated users will not be able to log in.`
          : `Activate ${name}? The user will be permitted to log in.`,
        confirmText: d.newStatus === 'Inactive' ? 'Yes, deactivate' : 'Yes, activate',
        danger: d.newStatus === 'Inactive',
      };
    },
    handleConfirmStatusToggle
  );

  return (
    <PermissionGate required="users.management.read">
    <div className="space-y-6">

      {/* Centered Success / Feedback Toast Popup Modal */}
      <Modal
        isOpen={Boolean(toastMessage)}
        onClose={() => setToastMessage(null)}
      >
        {toastMessage && (
          <div
            className="bg-white rounded-2xl max-w-sm w-full border border-[#E8DFD8] shadow-2xl p-6 text-center animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3.5 ${toastMessage.type === 'error' ? 'bg-red-100 text-[#ED4636]' : 'bg-[#3D705C]/10 text-[#3D705C]'
              }`}>
              {toastMessage.type === 'error' ? (
                <AlertCircle className="w-7 h-7" />
              ) : (
                <CheckCircle2 className="w-7 h-7" />
              )}
            </div>

            <h3 className="text-lg font-bold text-[#180200]">
              {toastMessage.type === 'error' ? 'Notice' : 'Success'}
            </h3>
            <p className="text-xs text-[#863221] mt-1.5 leading-relaxed font-medium">
              {toastMessage.message}
            </p>

            <div className="mt-5">
              <button
                type="button"
                onClick={() => setToastMessage(null)}
                className="w-full py-2.5 px-4 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs font-semibold rounded-xl shadow-sm transition-colors cursor-pointer"
              >
                Continue
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Header, Search & Filters */}
      <SearchFilterBar
        title="User Management"
        searchQuery={searchQuery}
        onSearchChange={(val) => {
          setSearchQuery(val);
          setCurrentPage(1);
        }}
        activeFiltersCount={
          (roleFilter !== 'ALL' ? 1 : 0) +
          (statusFilter !== 'ALL' ? 1 : 0)
        }
        onResetFilters={handleClearFilters}
        rightSlot={
          hasPermission('users.management.write') && (
            <button
              onClick={openAddModal}
              title={'Add User'}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs sm:text-sm font-semibold rounded-xl shadow-2xs hover:shadow transition-all cursor-pointer shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add User</span>
            </button>
          )
        }
      >
        {/* Role Filter */}
        <FilterSelect
          value={roleFilter}
          onChange={(val) => {
            setRoleFilter(val);
            setCurrentPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All Roles' },
            ...availableRoles(roles).map((r) => ({
              value: r.id,
              label: r.name
            }))
          ]}
          widthClass="w-full sm:w-48"
        />

        {/* Status Filter */}
        <FilterSelect
          value={statusFilter}
          onChange={(val) => {
            setStatusFilter(val);
            setCurrentPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All Status' },
            { value: 'Active', label: 'Active' },
            { value: 'Inactive', label: 'Inactive' }
          ]}
          widthClass="w-full sm:w-40"
        />
      </SearchFilterBar>

      {/* Main Content Card: Table */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">

        {/* Users Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[840px]">
            <thead>
              <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-semibold text-[#863221] uppercase tracking-wider">
                <SortTh label="User" field="name" sort={sort} onSort={toggleSort} className="px-6 py-3.5" />
                <th className="px-6 py-3.5">Email</th>
                <th className="px-6 py-3.5">Mobile</th>
                <th className="px-6 py-3.5">Role</th>
                <SortTh label="Status" field="status" sort={sort} onSort={toggleSort} className="px-6 py-3.5" />
                <th className="px-6 py-3.5">Last Seen</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8] text-sm">
              {paginatedUsers.length > 0 ? (
                paginatedUsers.map((user) => {
                  const userRoleId = user.role_id ?? user.roleId;
                  const roleObj = getRoleById(userRoleId);
                  const displayName = user.name || user.fullName || '';
                  const isActive = isUserActive(user);
                  const rowRank = user.role_rank_level ?? roleObj?.rank_level;
                  const isRankLocked = rowRank != null && !sameRankOk(rowRank);
                  const isRowLocked = (user.isCurrentAdmin || user.username === 'admin' || user.id === 1) || isRankLocked;

                  return (
                    <tr key={user.id} className="hover:bg-[#FAF7F2]/50 transition-colors group">
                      {/* User Name & Avatar */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div>
                            <p className="font-bold text-[#180200] leading-tight flex items-center gap-1.5">
                              <span>{displayName}</span>
                              {user.isCurrentAdmin && (
                                <span className="text-[10px] font-semibold text-[#863221]/70">
                                  You
                                </span>
                              )}
                            </p>
                            <span className="text-[11px] text-[#863221]/60 font-mono">ID {user.id}</span>
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td className="px-6 py-4 text-xs text-[#180200]/90">
                        {user.email}
                      </td>

                      {/* Mobile */}
                      <td className="px-6 py-4 font-mono text-xs text-[#180200]/90">
                        {user.mobile ? `${user.mobile_country_code || '+91'} ${user.mobile}` : '—'}
                      </td>

                      {/* Role */}
                      <td className="px-6 py-4">
                        <span className="text-xs font-semibold text-[#510601]">{roleObj ? roleObj.name : (user.role_name || 'Unassigned')}</span>
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          disabled={isRowLocked || !hasPermission('users.management.write')}
                          onClick={() => !isRowLocked && promptToggleStatus(user)}
                          className={`text-xs font-semibold ${isRowLocked
                              ? 'text-[#3D705C] cursor-not-allowed opacity-80'
                              : isActive
                                ? 'chip chip-on cursor-pointer'
                                : 'chip chip-off cursor-pointer'
                            }`}
                          title={
                            !hasPermission('users.management.write')
                              ? 'You need the users.management.write permission'
                              : user.isCurrentAdmin || user.username === 'admin' || user.id === 1
                                ? 'This account is permanently Active'
                                : isRankLocked
                                  ? 'You cannot change this user'
                                  : (isActive ? 'Click to deactivate user' : 'Click to activate user')
                          }
                        >
                          {isActive ? 'Active' : 'Inactive'}
                        </button>
                      </td>

                      {/* Last Login */}
                      <td className="px-6 py-4 text-xs text-[#863221]/80 font-medium">
                        {formatDateTime(user.last_login_at ?? user.lastLogin, 'Never', false)}
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            onClick={() => setViewingUser(user)}
                            className="btn-act"
                            title="View User Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View</span>
                          </button>
                          {hasPermission('users.management.write') && (
                            <button
                              disabled={isRankLocked}
                              onClick={() => !isRankLocked && openEditModal(user)}
                              className={`btn-act ${isRankLocked ? 'opacity-40 cursor-not-allowed' : ''}`}
                              title={!hasPermission('users.management.write') ? 'You need the users.management.write permission' : isRankLocked ? 'You cannot change this user' : 'Edit User'}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>Edit</span>
                            </button>
                          )}
                          {!isRankLocked && !(user.isCurrentAdmin || user.username === 'admin' || user.id === 1) && (
                            hasPermission('users.management.delete') && (
                              <button
                                disabled={isRankLocked}
                                onClick={() => setDeleteTargetUser(user)}
                                className="btn-act btn-act-danger"
                                title={'Delete User'}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Delete</span>
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-[#863221]">
                    <div className="w-12 h-12 rounded-full bg-[#FAF7F2] text-[#863221]/60 flex items-center justify-center mx-auto mb-3">
                      <Users className="w-6 h-6" />
                    </div>
                    <p className="font-semibold text-sm text-[#180200]">
                      {hasActiveFilters ? 'No users match your search' : 'No users found'}
                    </p>
                    <p className="text-xs text-[#863221]/70 mt-1 max-w-sm mx-auto">
                      {hasActiveFilters
                        ? "Try changing your search keywords or filter criteria."
                        : "No user accounts have been created yet. Click below to register the first system user."}
                    </p>
                    <div className="mt-4 flex justify-center gap-2">
                      {hasActiveFilters ? (
                        <button
                          onClick={handleClearFilters}
                          className="px-4 py-2 bg-white border border-[#E8DFD8] hover:border-[#510601] text-xs font-semibold rounded-xl text-[#510601] transition-colors cursor-pointer"
                        >
                          Clear Filters
                        </button>
                      ) : (
                        hasPermission('users.management.write') && (
                          <button
                            onClick={openAddModal}

                            className="px-4 py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                          >
                            Add User
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Section */}
        <div className="px-4 sm:px-6 py-4 border-t border-[#E8DFD8] bg-[#FAF7F2] flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-xs text-[#863221] font-medium">
            <span>
              Showing {filteredUsers.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, filteredUsers.length)} of {filteredUsers.length} entries
            </span>
            <span className="text-[#863221]/40">•</span>
            <div className="flex items-center gap-1.5">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                className="bg-white border border-[#E8DFD8] rounded-lg px-2 py-1 text-xs text-[#180200] focus:outline-none focus:border-[#510601]"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg border border-[#E8DFD8] bg-white text-[#863221] hover:border-[#510601] hover:text-[#510601] disabled:opacity-40 disabled:hover:border-[#E8DFD8] disabled:hover:text-[#863221] transition-all cursor-pointer disabled:cursor-not-allowed"
              title="Previous Page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
              .map((pageNum, idx, arr) => {
                const prevPageNum = arr[idx - 1];
                const showEllipsis = prevPageNum && pageNum - prevPageNum > 1;

                return (
                  <React.Fragment key={pageNum}>
                    {showEllipsis && <span className="px-1 text-xs text-[#863221]/50">...</span>}
                    <button
                      onClick={() => setCurrentPage(pageNum)}
                      className={`min-w-[32px] h-8 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${currentPage === pageNum
                          ? 'bg-[#510601] text-white shadow-sm'
                          : 'bg-white border border-[#E8DFD8] text-[#863221] hover:border-[#510601] hover:text-[#510601]'
                        }`}
                    >
                      {pageNum}
                    </button>
                  </React.Fragment>
                );
              })}

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="p-1.5 rounded-lg border border-[#E8DFD8] bg-white text-[#863221] hover:border-[#510601] hover:text-[#510601] disabled:opacity-40 disabled:hover:border-[#E8DFD8] disabled:hover:text-[#863221] transition-all cursor-pointer disabled:cursor-not-allowed"
              title="Next Page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

      </div>

      {/* ============================================================ */}
      {/* ADD / EDIT USER MODAL                                        */}
      {/* ============================================================ */}
      <Modal
        isOpen={isAddEditOpen}
        onClose={() => setIsAddEditOpen(false)}
      >
        <div
          className="bg-white rounded-2xl max-w-4xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[92vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                <UserPlus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#180200]">
                  {modalMode === 'add' ? 'Add User' : 'Edit User'}
                </h3>
              </div>
            </div>
            <button
              onClick={() => setIsAddEditOpen(false)}
              className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable Form */}
          <form onSubmit={handleSaveUser} className="p-6 overflow-y-auto space-y-5">

            {/* SECTION 1: Basic Information */}
            <div>
              <h4 className="text-xs font-bold text-[#180200] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-[#863221]" />
                <span>Basic Information</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Full Name */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                    Full Name <span className="text-[#ED4636]">*</span>
                  </label>
                  <input
                    type="text"
                    name="fullName"
                    value={formData.fullName}
                    onChange={handleFormChange}
                    className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${formErrors.fullName
                        ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                        : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                      }`}
                  />
                  {formErrors.fullName && (
                    <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {formErrors.fullName}
                    </p>
                  )}
                </div>

                {/* Username */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                    Username <span className="text-[#ED4636]">*</span>
                  </label>
                  <input
                    type="text"
                    name="username"
                    value={formData.username}
                    onChange={handleFormChange}
                    disabled={modalMode === 'edit'}
                    className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-mono font-semibold text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed ${formErrors.username
                        ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                        : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                      }`}
                  />
                  {formErrors.username && (
                    <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {formErrors.username}
                    </p>
                  )}
                  {modalMode === 'edit' && (
                    <span className="text-[11px] text-[#863221]/60 mt-1 block">Username cannot be changed after creation</span>
                  )}
                </div>

                {/* Email */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#863221]/50" />
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleFormChange}
                      className={`w-full pl-10 pr-3.5 py-2.5 bg-white border rounded-xl text-sm text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${formErrors.email
                          ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                          : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                        }`}
                    />
                  </div>
                  {formErrors.email && (
                    <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {formErrors.email}
                    </p>
                  )}
                </div>

                {/* Mobile Number */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                    Mobile Number
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#863221]/50" />
                    <input
                      type="text"
                      name="mobile"
                      value={formData.mobile}
                      onChange={handleFormChange}
                      maxLength={10}
                      className={`w-full pl-10 pr-3.5 py-2.5 bg-white border rounded-xl text-sm font-mono text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${formErrors.mobile
                          ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                          : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                        }`}
                    />
                  </div>
                  {formErrors.mobile && (
                    <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {formErrors.mobile}
                    </p>
                  )}
                </div>
              </div>

              {/* Password Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                {/* Password */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                    {modalMode === 'add' ? (
                      <>Password <span className="text-[#ED4636]">*</span></>
                    ) : (
                      <>Reset Password <span className="text-gray-400 font-normal">(Leave blank to keep current)</span></>
                    )}
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#863221]/50" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      value={formData.password}
                      onChange={handleFormChange}
                      className={`w-full pl-10 pr-10 py-2.5 bg-white border rounded-xl text-sm text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${formErrors.password
                          ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                          : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                        }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#863221]/50 hover:text-[#510601] focus:outline-none"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {formErrors.password && (
                    <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {formErrors.password}
                    </p>
                  )}
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                    {modalMode === 'add' ? (
                      <>Confirm Password <span className="text-[#ED4636]">*</span></>
                    ) : (
                      <>Confirm New Password</>
                    )}
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#863221]/50" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      name="confirmPassword"
                      value={formData.confirmPassword}
                      onChange={handleFormChange}
                      className={`w-full pl-10 pr-10 py-2.5 bg-white border rounded-xl text-sm text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${formErrors.confirmPassword
                          ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                          : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                        }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#863221]/50 hover:text-[#510601] focus:outline-none"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {formErrors.confirmPassword && (
                    <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {formErrors.confirmPassword}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* SECTION 2: Role & Access */}
            <div className="pt-4 border-t border-[#E8DFD8]">
              <h4 className="text-xs font-bold text-[#180200] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-[#863221]" />
                <span>Role & Access</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Role Dropdown */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                    Assigned Role <span className="text-[#ED4636]">*</span>
                  </label>
                  <select
                    name="roleId"
                    value={formData.roleId}
                    onChange={handleFormChange}
                    className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm text-[#180200] focus:outline-none transition-colors cursor-pointer ${formErrors.roleId
                        ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                        : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                      }`}
                  >
                    <option value="">-- Select Role --</option>
                    {availableRoles(roles).map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  {formErrors.roleId && (
                    <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {formErrors.roleId}
                    </p>
                  )}
                </div>

                {/* Status Dropdown */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                    Account Status <span className="text-[#ED4636]">*</span>
                  </label>
                  <select
                    name="status"
                    value={formData.status === true || formData.status === 'Active' ? 'Active' : 'Inactive'}
                    onChange={handleFormChange}
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] cursor-pointer"
                  >
                    <option value="Active">Active (Permitted to log in)</option>
                    <option value="Inactive">Inactive (Access suspended)</option>
                  </select>
                </div>
              </div>

              {/* Dynamic Role Privileges Preview Box */}
              {selectedFormRole && (
                <div className="mt-4 p-4 bg-[#FAF7F2] rounded-xl border border-[#E8DFD8] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Key className="w-4 h-4 text-[#510601]" />
                      <span className="text-xs font-bold text-[#180200]">
                        {selectedFormRole.name} Privileges
                      </span>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-[#510601]/10 text-[#510601]">
                      {selectedFormRole.is_all_access ? 'All privileges' : `${(selectedFormRole.permission_codes || selectedFormRole.privileges || []).length} Privileges Granted`}
                    </span>
                  </div>

                  <p className="text-xs text-[#863221]/80 leading-relaxed">
                    {selectedFormRole.description}
                  </p>

                  {/* Accessible modules summary chips */}
                  <div className="pt-2 border-t border-[#E8DFD8]/80">
                    <span className="text-[10px] font-bold text-[#863221] uppercase tracking-wider block mb-1.5">
                      Module Coverage
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedFormRole.is_all_access && (
                        <span className="px-2 py-0.5 bg-white border border-[#E8DFD8] rounded-md text-[10px] font-medium text-[#180200]">Every module</span>
                      )}
                      {!selectedFormRole.is_all_access && allPrivileges.map(mod => {
                        const rolePrivs = selectedFormRole.permission_codes || selectedFormRole.privileges || [];
                        const hasPrivs = mod.privileges.some(p =>
                          rolePrivs.includes(p.id)
                        );
                        if (!hasPrivs) return null;

                        const countInMod = mod.privileges.filter(p =>
                          rolePrivs.includes(p.id)
                        ).length;

                        return (
                          <span
                            key={mod.module}
                            className="px-2 py-0.5 bg-white border border-[#E8DFD8] rounded-md text-[10px] font-medium text-[#180200] flex items-center gap-1"
                          >
                            <Check className="w-2.5 h-2.5 text-[#3D705C]" />
                            <span>{mod.module}</span>
                            <span className="text-[#863221]/60 font-mono">({countInMod}/{mod.privileges.length})</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <ModalFooter kind={modalMode === 'add' ? 'add' : 'edit'} onCancel={() => setIsAddEditOpen(false)} inForm />

          </form>
        </div>
      </Modal>

      {/* ============================================================ */}
      {/* VIEW USER DETAILS MODAL                                      */}
      {/* ============================================================ */}
      <Modal
        isOpen={Boolean(viewingUser)}
        onClose={() => setViewingUser(null)}
      >
        {viewingUser && (
          <div
            className="bg-white rounded-2xl max-w-3xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#180200]">User Details</h3>
                  <p className="text-xs text-[#863221]">Account ID: {viewingUser.id}</p>
                </div>
              </div>
              <button
                onClick={() => setViewingUser(null)}
                className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-6 space-y-4 text-sm">

              {/* User Overview Box */}
              <div className="bg-[#FAF7F2]/60 rounded-xl p-4 border border-[#E8DFD8] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-[#510601] text-white flex items-center justify-center text-sm font-bold shadow-xs">
                    {(viewingUser.name || viewingUser.fullName || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h4 className="font-bold text-base text-[#180200]">{viewingUser.name || viewingUser.fullName}</h4>
                    <p className="text-xs font-mono text-[#863221]">{viewingUser.username}</p>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${isUserActive(viewingUser)
                    ? 'bg-[#3D705C]/10 text-[#3D705C] border border-[#3D705C]/20'
                    : 'bg-gray-100 text-gray-600 border border-gray-200'
                  }`}>
                  {isUserActive(viewingUser) ? 'Active' : 'Inactive'}
                </span>
              </div>

              {/* Account Details Grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-[#863221] font-semibold uppercase">Email Address</p>
                  <p className="text-[#180200] font-medium mt-0.5">{viewingUser.email || '—'}</p>
                </div>

                <div>
                  <p className="text-[#863221] font-semibold uppercase">Mobile Number</p>
                  <p className="text-[#180200] font-mono font-medium mt-0.5">
                    {viewingUser.mobile ? `${viewingUser.mobile_country_code || '+91'} ${viewingUser.mobile}` : '—'}
                  </p>
                </div>

                <div>
                  <p className="text-[#863221] font-semibold uppercase">Created Date</p>
                  <p className="text-[#180200] font-medium mt-0.5">{formatDate(viewingUser.created_at ?? viewingUser.createdAt)}</p>
                </div>

                <div>
                  <p className="text-[#863221] font-semibold uppercase">Last Login</p>
                  <p className="text-[#180200] font-medium mt-0.5">{formatDateTime(viewingUser.last_login_at ?? viewingUser.lastLogin, 'Never', false)}</p>
                </div>
              </div>

              {/* Role & Access Info */}
              {(() => {
                // the role list holds only roles you may assign, so the Super Admin's own role is not in it:
                // fall back to what the user row says
                const userRole = getRoleById(viewingUser.role_id ?? viewingUser.roleId);
                const roleName = userRole?.name || viewingUser.role_name;
                const roleRank = userRole?.rank_level ?? viewingUser.role_rank_level;
                // the roles list carries permission_codes (the privilege codes the role holds)
                const roleCodes = userRole?.permission_codes || userRole?.privileges || [];
                const fullAccess = Boolean(userRole?.is_all_access) || (!userRole && roleRank === 0);
                return (
                  <div className="p-3.5 bg-[#FAF7F2] rounded-xl border border-[#E8DFD8] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#180200] flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-[#510601]" />
                        Assigned Role: {roleName || 'Unassigned'}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 bg-[#510601]/10 text-[#510601] rounded-full">
                        {fullAccess ? 'All privileges' : `${roleCodes.length} Privileges`}
                      </span>
                    </div>

                    <p className="text-xs text-[#863221]/80">
                      {userRole?.description}
                    </p>

                    <div className="pt-2 border-t border-[#E8DFD8]/80">
                      <span className="text-[10px] font-bold text-[#863221] uppercase tracking-wider block mb-1">
                        Accessible Modules
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {fullAccess && (
                          <span className="px-2 py-0.5 bg-white border border-[#E8DFD8] rounded text-[10px] text-[#180200] font-medium">
                            Every module
                          </span>
                        )}
                        {allPrivileges.map(mod => {
                          const hasPrivs = !fullAccess && mod.privileges.some(p =>
                            roleCodes.includes(p.id)
                          );
                          if (!hasPrivs) return null;

                          return (
                            <span
                              key={mod.module}
                              className="px-2 py-0.5 bg-white border border-[#E8DFD8] rounded text-[10px] text-[#180200] font-medium"
                            >
                              {mod.module}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Read-only footer */}
              <ModalFooter kind="view" onCancel={() => setViewingUser(null)} inForm />

            </div>
          </div>
        )}
      </Modal>

    </div>
    </PermissionGate>
  );
}
