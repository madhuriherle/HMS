import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { applyBulk, stateOf, toggleOne } from '../utils/privilegeSelection';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal';
import {
  Shield,
  ShieldCheck,
  Plus,
  Search,
  Pencil,
  Trash2,
  Eye,
  Power,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  X,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Users,
  Key,
  CheckSquare,
  Check,
  Minus,
  Square,
  Lock,
  Calendar,
  Layers,
  FileText,
  Clock
} from 'lucide-react';
import api from '../api';
import { formatDate } from '../utils/dateUtils';
import { notify } from '../utils/notify';
import useAuth from '../hooks/useAuth';
import PermissionGate from '../components/PermissionGate';

export default function RolesAndPrivileges() {
  // Master state
  const [roles, setRoles] = useState([]);
  
  const [allPrivileges, setAllPrivileges] = useState([]);
  const [allPrivilegeIds, setAllPrivilegeIds] = useState([]);
  const [privilegeRows, setPrivilegeRows] = useState([]); // module / sub-module rows for the privilege table
  const [disabledPrivilegeIds, setDisabledPrivilegeIds] = useState([]); // privileges of modules that are switched off (not built yet)

  const [loading, setLoading] = useState(true);

  const errDetail = (err, fallback) => {
    const d = err?.response?.data?.detail;
    return typeof d === 'string' ? d : fallback;
  };

  const isPendingApproval = (data) =>
    Boolean(data && (data.approval_request_id || data.status === 'PENDING'));

  // Signed-in user's own role rank (from /auth/me via Login). 1 = top, larger = weaker.
  const { myRank: myRankLevel, hasPermission } = useAuth();

  const normalizeRole = (r) => ({
    ...r,
    usersCount: r.user_count ?? r.usersCount ?? 0,
    rank_level: r.rank_level ?? 99,
    permission_codes: r.permission_codes || [],
    createdAt: r.created_at ? String(r.created_at).slice(0, 10) : (r.createdAt || ''),
    updatedAt: r.updated_at ? String(r.updated_at).slice(0, 10) : (r.updatedAt || ''),
  });

  const fetchRoles = async () => {
    const rolesRes = await api.get('/users/roles', { params: { limit: 500 } });
    const rows = Array.isArray(rolesRes.data)
      ? rolesRes.data
      : (rolesRes.data?.data || rolesRes.data?.items || []);
    setRoles(rows.map(normalizeRole));
  };

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        await fetchRoles();

        const privRes = await api.get('/users/modules/privilege-tree');
        let formattedGroups = [];
        let allIds = [];
        const matrixRows = [];
        const offIds = [];

        const traverse = (modList, path = "", depth = 0, parentOff = false) => {
           for (const mod of modList) {
              const off = parentOff || mod.status === false;
              const currentPath = path ? `${path} > ${mod.name}` : mod.name;
              // one table row per module: Read / Write / Delete cells, anything else goes to "Other"
              const cells = { read: null, write: null, delete: null };
              const other = [];
              for (const pr of mod.privileges || []) {
                const suffix = pr.code.startsWith(`${mod.code}.`) ? pr.code.slice(mod.code.length + 1) : null;
                if (suffix && Object.prototype.hasOwnProperty.call(cells, suffix)) cells[suffix] = { id: pr.code, name: pr.name, description: pr.description };
                else other.push({ id: pr.code, name: pr.name, description: pr.description });
              }
              if ((mod.privileges && mod.privileges.length > 0) || (mod.submodules && mod.submodules.length > 0)) {
                matrixRows.push({
                  code: mod.code, name: mod.name, depth, min_rank_level: mod.min_rank_level ?? null, disabled: off,
                  cells, other, hasChildren: Boolean(mod.submodules && mod.submodules.length > 0)
                });
              }
              if (off) {
                 offIds.push(...(mod.privileges || []).map(p => p.code));
              } else if (mod.privileges && mod.privileges.length > 0) {
                 const formattedPrivs = mod.privileges.map(p => ({
                    id: p.code, // using code as id for frontend
                    name: p.name,
                    description: p.description
                 }));
               formattedGroups.push({
                  module: currentPath,
                  min_rank_level: mod.min_rank_level ?? null,
                  privileges: formattedPrivs
               });
                 allIds.push(...formattedPrivs.map(p => p.id));
              }
              if (mod.submodules && mod.submodules.length > 0) {
                 traverse(mod.submodules, currentPath, depth + 1, off);
              }
           }
        };
        
        traverse(privRes.data);
        setAllPrivileges(formattedGroups);
        setAllPrivilegeIds(allIds);
        setPrivilegeRows(matrixRows);
        setDisabledPrivilegeIds(offIds);

      } catch (err) {
        console.error("Error fetching data", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Add / Edit Role Modal State
  const [isAddEditOpen, setIsAddEditOpen] = useState(false);
  const [modalMode, setModalMode] = useState('add'); // 'add' | 'edit'
  const [editingRole, setEditingRole] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    status: 'Active',
    rank_level: 99
  });
  const [formErrors, setFormErrors] = useState({});

  // Configure Privileges Modal State
  const [privilegeTargetRole, setPrivilegeTargetRole] = useState(null);
  const [selectedPrivileges, setSelectedPrivileges] = useState([]);
  const [approvalRequiredCodes, setApprovalRequiredCodes] = useState([]);
  const [privilegeSearch, setPrivilegeSearch] = useState('');
  const [savingPrivileges, setSavingPrivileges] = useState(false);

  // View Details Modal State
  const [viewingRole, setViewingRole] = useState(null);

  // Delete Confirmation State
  const [deleteTargetRole, setDeleteTargetRole] = useState(null);

  // Status Toggle Confirmation State
  const [statusDialog, setStatusDialog] = useState(null); // { role, newStatus }

  // Toast / Feedback Modal State
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (message, type = 'success') => {
    notify(message, type);
  };

  // ----------------------------------------------------
  // SYSTEM ROLE HELPER
  // ----------------------------------------------------
  // A system role is one the database flags as all-access (roles.is_all_access).
  const isSystemRole = (role) => Boolean(role?.is_all_access);

  // A role at or above your own rank is protected: viewable, never modifiable.
  const canManageRole = (role) =>
    Boolean(role) && !isSystemRole(role) && (role.rank_level ?? 99) > myRankLevel;

  // ----------------------------------------------------
  // SUMMARY METRICS
  // Helper for active status check (supports boolean and string)
  const isRoleActive = (role) => {
    if (!role) return false;
    return typeof role.status === 'boolean' ? role.status : role.status === 'Active';
  };

  // ----------------------------------------------------
  // SUMMARY METRICS
  // ----------------------------------------------------
  const summaryStats = useMemo(() => {
    const total = roles.length;
    const active = roles.filter(r => isRoleActive(r)).length;
    const inactive = roles.filter(r => !isRoleActive(r)).length;
    const totalAssignedUsers = roles.reduce((acc, r) => acc + (r.usersCount || 0), 0);
    return { total, active, inactive, totalAssignedUsers };
  }, [roles]);

  // ----------------------------------------------------
  // SEARCH & FILTERING
  // ----------------------------------------------------
  const handleClearFilters = () => {
    setSearchQuery('');
    setStatusFilter('ALL');
    setCurrentPage(1);
  };

  const hasActiveFilters = searchQuery !== '' || statusFilter !== 'ALL';

  const filteredRoles = useMemo(() => {
    return roles.filter((role) => {
      const q = searchQuery.toLowerCase().trim();
      const matchSearch =
        !q ||
        role.name.toLowerCase().includes(q) ||
        (role.code && role.code.toLowerCase().includes(q)) ||
        (role.description && role.description.toLowerCase().includes(q));

      const active = isRoleActive(role);
      const matchStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'Active' && active) ||
        (statusFilter === 'Inactive' && !active) ||
        (statusFilter === 'true' && active) ||
        (statusFilter === 'false' && !active);

      return matchSearch && matchStatus;
    });
  }, [roles, searchQuery, statusFilter]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredRoles.length / pageSize) || 1;
  const paginatedRoles = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRoles.slice(start, start + pageSize);
  }, [filteredRoles, currentPage, pageSize]);

  // ----------------------------------------------------
  // ADD / EDIT ROLE LOGIC
  // ----------------------------------------------------
  const openAddModal = () => {
    setModalMode('add');
    setEditingRole(null);
    setFormData({
      name: '',
      description: '',
      status: true,
      rank_level: 99
    });
    setFormErrors({});
    setIsAddEditOpen(true);
  };

  const openEditModal = (role) => {
    if (!canManageRole(role)) {
      showToast(
        isSystemRole(role) ? 'System roles cannot be edited.' : 'This role is at or above your rank and cannot be edited.',
        'error'
      );
      return;
    }
    setModalMode('edit');
    setEditingRole(role);
    setFormData({
      name: role.name,
      description: role.description || '',
      status: isRoleActive(role),
      rank_level: role.rank_level ?? 99
    });
    setFormErrors({});
    setIsAddEditOpen(true);
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    if (name === 'status') {
      const boolVal = value === 'true' || value === true || value === 'Active';
      setFormData(prev => ({ ...prev, status: boolVal }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
    if (formErrors[name]) {
      setFormErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validateRoleForm = () => {
    const errors = {};
    const name = formData.name?.trim();

    if (!name) {
      errors.name = 'Role Name is required';
    } else {
      const isDuplicate = roles.some(
        r => (r.id !== editingRole?.id && String(r.id) !== String(editingRole?.id)) &&
          r.name.toLowerCase() === name.toLowerCase()
      );
      if (isDuplicate) {
        errors.name = 'A role with this name already exists.';
      }
    }

    const rank = Number(formData.rank_level);
    if (!Number.isInteger(rank) || rank < 1) {
      errors.rank_level = 'Rank must be a whole number of 1 or more.';
    } else if (rank <= myRankLevel) {
      errors.rank_level = `Rank must be weaker (a higher number) than your own rank (${myRankLevel}).`;
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveRole = async (e) => {
    e.preventDefault();
    if (!validateRoleForm()) return;

    try {
      const statusActive = typeof formData.status === 'boolean'
        ? formData.status
        : (formData.status === 'Active' || formData.status === 'true');

      if (modalMode === 'add') {
        const slug = formData.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 16);
        const res = await api.post('/users/roles', {
          name: formData.name.trim(),
          code: `${slug || 'ROLE'}_${Date.now().toString().slice(-4)}`,
          description: formData.description.trim(),
          status: statusActive,
          rank_level: Number(formData.rank_level)
        });
        if (isPendingApproval(res.data)) {
          showToast('Role creation submitted for approval.');
        } else {
          showToast('Role created successfully.');
        }
      } else {
        const res = await api.put(`/users/roles/${editingRole.id}`, {
          name: formData.name.trim(),
          description: formData.description.trim(),
          status: statusActive,
          rank_level: Number(formData.rank_level)
        });
        if (isPendingApproval(res.data)) {
          showToast('Role update submitted for approval.');
        } else {
          showToast('Role updated successfully.');
        }
      }
      setIsAddEditOpen(false);
      setFormData({ name: '', description: '', status: 'Active', rank_level: 99 });
      await fetchRoles();
    } catch (err) {
      showToast(errDetail(err, 'Error saving role'), 'error');
    }
  };

  const promptToggleStatus = (role) => {
    if (!canManageRole(role)) {
      showToast(
        isSystemRole(role) ? 'System roles cannot be deactivated.' : 'This role is at or above your rank and cannot be changed.',
        'error'
      );
      return;
    }
    const active = isRoleActive(role);
    setStatusDialog({
      role,
      newStatus: !active
    });
  };

  const handleConfirmStatusToggle = async () => {
    if (!statusDialog || !canManageRole(statusDialog.role)) return;
    const { role, newStatus } = statusDialog;

    try {
      const res = await api.put(`/users/roles/${role.id}`, { status: newStatus }, { params: { reason: 'Status changed via UI' } });
      if (isPendingApproval(res.data)) {
        showToast('Status change submitted for approval.');
      } else {
        const updated = res.data?.id ? normalizeRole(res.data) : { ...role, status: newStatus };
        setRoles(prev => prev.map(r => (r.id === role.id || String(r.id) === String(role.id)) ? updated : r));
        if (viewingRole && (viewingRole.id === role.id || String(viewingRole.id) === String(role.id))) {
          setViewingRole(updated);
        }
        showToast(`Role "${role.name}" is now ${newStatus ? 'Active' : 'Inactive'}.`);
      }
    } catch (err) {
      showToast(errDetail(err, 'Error updating role status'), 'error');
    }
    setStatusDialog(null);
  };

  // ----------------------------------------------------
  // DELETE LOGIC (WITH USER COUNT RESTRICTION & SYSTEM ROLE PROTECTION)
  // ----------------------------------------------------
  const confirmDeleteRole = async () => {
    if (!deleteTargetRole || !canManageRole(deleteTargetRole) || (deleteTargetRole.usersCount || 0) > 0) return;
    const target = deleteTargetRole;

    try {
      const res = await api.delete(`/users/roles/${target.id}`, { params: { reason: 'Deleted via UI' } });
      if (isPendingApproval(res.data)) {
        showToast('Role deletion submitted for approval.');
      } else {
        setRoles(prev => prev.filter(r => r.id !== target.id && String(r.id) !== String(target.id)));
        showToast(`Role "${target.name}" deleted successfully.`);
      }
    } catch (err) {
      showToast(errDetail(err, 'Error deleting role'), 'error');
    }
    setDeleteTargetRole(null);
  };

  // ----------------------------------------------------
  // PRIVILEGE CONFIGURATION LOGIC
  // ----------------------------------------------------
  const openPrivilegeModal = async (role) => {
    setPrivilegeSearch('');
    setSelectedPrivileges(role.permission_codes || []);
    setApprovalRequiredCodes([]);
    setPrivilegeTargetRole(role);
    try {
      const res = await api.get(`/users/roles/${role.id}/permissions`);
      const rows = Array.isArray(res.data) ? res.data : [];
      setSelectedPrivileges(rows.map(p => p.code));
      setApprovalRequiredCodes(rows.filter(p => p.requires_approval).map(p => p.code));
    } catch (_) {
      // fall back to the codes already on the roles list
    }
  };

  // Selection rules (Write/Delete tick Read; clearing Read clears them) live in utils/privilegeSelection.js
  const handleTogglePrivilege = (id) => setSelectedPrivileges(prev => toggleOne(prev, id, allPrivilegeIds));

  // Tick or clear several privileges at once (a column, a row, a module, or everything)
  const applyPrivilegeBulk = (codes, on) => setSelectedPrivileges(prev => applyBulk(prev, codes, on, allPrivilegeIds));

  const handleToggleApprovalGate = (id) => {
    setApprovalRequiredCodes(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleToggleModulePrivileges = (ids) => {
    setSelectedPrivileges(prev => {
      const allSelected = ids.every(id => prev.includes(id));
      if (allSelected) return prev.filter(id => !ids.includes(id));
      return Array.from(new Set([...prev, ...ids]));
    });
  };

  const handleMasterToggleAll = () => {
    setSelectedPrivileges(prev =>
      prev.length === allPrivilegeIds.length ? [] : [...allPrivilegeIds]
    );
  };

  const filteredPrivilegeGroups = useMemo(() => {
    const q = privilegeSearch.toLowerCase().trim();
    if (!q) return allPrivileges;
    return allPrivileges
      .map(g => ({
        ...g,
        privileges: g.privileges.filter(p =>
          p.name.toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q)
        ),
      }))
      .filter(g => g.module.toLowerCase().includes(q) || g.privileges.length > 0);
  }, [allPrivileges, privilegeSearch]);

  const handleSavePrivileges = async () => {
    if (!privilegeTargetRole || savingPrivileges) return;
    if (!canManageRole(privilegeTargetRole)) {
      showToast('This role is at or above your rank; its privileges cannot be modified.', 'error');
      return;
    }
    const target = privilegeTargetRole;
    setSavingPrivileges(true);
    try {
      const keptInOffModules = (target.permission_codes || []).filter(id => disabledPrivilegeIds.includes(id));
      const codes = [...selectedPrivileges.filter(id => allPrivilegeIds.includes(id)), ...keptInOffModules];
      const approval = approvalRequiredCodes.filter(c => codes.includes(c));
      const res = await api.put(`/users/roles/${target.id}/permissions`, {
        permission_codes: codes,
        approval_required_codes: approval,
      });
      if (isPendingApproval(res.data)) {
        showToast('Privilege change submitted for approval.');
      } else {
        showToast(res.data?.message || 'Privileges saved successfully.');
      }
      setRoles(prev => prev.map(r =>
        (r.id === target.id || String(r.id) === String(target.id))
          ? { ...r, permission_codes: codes }
          : r
      ));
      setPrivilegeTargetRole(null);
    } catch (err) {
      showToast(errDetail(err, 'Error saving privileges'), 'error');
    } finally {
      setSavingPrivileges(false);
    }
  };

  return (
    <PermissionGate required="roles.read">
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

      {/* Breadcrumb & Header */}
      <div>
<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#180200] tracking-tight">
              User Roles & Privileges
            </h1>
          </div>

          <button
            onClick={openAddModal}
            disabled={!hasPermission('roles.write')}
            title={!hasPermission('roles.write') ? 'You need the roles.write permission' : 'Add Role'}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm hover:shadow transition-all cursor-pointer self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Add Role</span>
          </button>
        </div>
      </div>

      {/* Search & Filters Toolbar Card */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">

            {/* Search Field */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#863221]/50" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className="w-full pl-10 pr-9 py-2 bg-white border border-[#E8DFD8] rounded-xl text-sm text-[#180200] placeholder-[#863221]/40 focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] shadow-sm transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); setCurrentPage(1); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter Controls */}
            <div className="flex items-center gap-2.5">
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
                className="py-2 px-3.5 bg-white border border-[#E8DFD8] rounded-xl text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] shadow-sm cursor-pointer"
              >
                <option value="ALL">All Status</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>

              {hasActiveFilters && (
                <button
                  onClick={handleClearFilters}
                  className="px-3.5 py-2 text-xs font-semibold text-[#ED4636] hover:bg-red-50 rounded-xl border border-red-200 transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer"
                  title="Clear all filters"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Clear Filters</span>
                </button>
              )}
            </div>

          </div>
      </div>

      {/* Roles Table Card */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[520px]">
            <thead>
              <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-semibold text-[#863221] uppercase tracking-wider">
                <th className="px-6 py-3">Role Name</th>
                <th className="px-6 py-3">Users</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8] text-sm">
              {paginatedRoles.length > 0 ? (
                paginatedRoles.map((role) => {
                  const isSys = isSystemRole(role);
                  const isLocked = !canManageRole(role);
                  const isActive = isRoleActive(role);
                  const isDeleteDisabled = isLocked || (role.usersCount || 0) > 0;

                  return (
                    <tr key={role.id} className="hover:bg-[#FAF7F2]/50 transition-colors group">
                      <td className="px-6 py-3 font-bold text-[#180200]">
                        <div className="flex items-center gap-2">
                          <span>{role.name}</span>
                          {isSys && (
                            <span className="px-2 py-0.5 bg-[#FFC107]/20 text-[#863221] text-[10px] font-bold rounded-md">
                              System
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-3 text-xs font-semibold text-[#180200]">
                        {role.usersCount} {role.usersCount === 1 ? 'User' : 'Users'}
                      </td>
                      <td className="px-6 py-3">
                        <button
                          type="button"
                          disabled={isLocked || !hasPermission('roles.write')}
                          onClick={() => !isLocked && promptToggleStatus(role)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold transition-all ${
                            isLocked
                              ? 'bg-[#3D705C]/10 text-[#3D705C] cursor-not-allowed opacity-80'
                              : isActive
                                ? 'bg-[#3D705C]/10 text-[#3D705C] hover:bg-[#3D705C]/20 cursor-pointer hover:opacity-80 active:scale-95'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 cursor-pointer hover:opacity-80 active:scale-95'
                          }`}
                          title={!hasPermission('roles.write') ? 'You need the roles.write permission' : isSys ? 'System role is permanently Active' : isLocked ? 'Role is at or above your rank' : (isActive ? 'Click to deactivate role' : 'Click to activate role')}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-[#3D705C]' : 'bg-gray-400'}`} />
                          {isActive ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Privileges */}
                          <button
                            disabled={isSys}
                            onClick={() => !isSys && openPrivilegeModal(role)}
                            className={`p-2 rounded-lg transition-colors ${isSys ? 'text-gray-300 cursor-not-allowed opacity-40' : 'text-[#510601] hover:bg-[#F1E7DE] cursor-pointer'}`}
                            title={isSys ? 'System role privileges are permanent and cannot be modified' : 'Configure Privileges'}
                          >
                            <ShieldCheck className="w-4 h-4" />
                          </button>

                          {/* View details (rank, description, privileges, dates) */}
                          <button
                            onClick={() => setViewingRole(role)}
                            className="p-2 rounded-lg text-[#510601] hover:bg-[#F1E7DE] transition-colors cursor-pointer"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Edit */}
                          <button
                            disabled={isLocked || !hasPermission('roles.write')}
                            onClick={() => !isLocked && openEditModal(role)}
                            className={`p-2 rounded-lg transition-colors ${isLocked ? 'text-gray-300 cursor-not-allowed opacity-40' : 'text-amber-700 hover:bg-amber-50 cursor-pointer'}`}
                            title={!hasPermission('roles.write') ? 'You need the roles.write permission' : isSys ? 'System role cannot be edited' : isLocked ? 'Role is at or above your rank' : 'Edit Role'}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>

                          {/* Delete (only for deletable roles) */}
                          {!isDeleteDisabled && (
                            <button
                              disabled={isLocked || !hasPermission('roles.delete')}
                              onClick={() => setDeleteTargetRole(role)}
                              className="p-2 rounded-lg text-red-600 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              title={!hasPermission('roles.delete') ? 'You need the roles.delete permission' : 'Delete Role'}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="4" className="px-6 py-12 text-center text-[#863221]">
                    <div className="w-12 h-12 rounded-full bg-[#FAF7F2] text-[#863221]/60 flex items-center justify-center mx-auto mb-3">
                      <Shield className="w-6 h-6" />
                    </div>
                    <p className="font-semibold text-sm text-[#180200]">No user roles found</p>
                    <p className="text-xs text-[#863221]/70 mt-1 max-w-sm mx-auto">
                      {hasActiveFilters
                        ? "Try changing your search or filter criteria."
                        : "No roles defined yet. Click below to add your first user role."}
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
                        <button
                          onClick={openAddModal}
                          disabled={!hasPermission('roles.write')}
                          title={!hasPermission('roles.write') ? 'You need the roles.write permission' : undefined}
                          className="px-4 py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                        >
                          Add Role
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Section */}
        <div className="px-4 sm:px-6 py-4 border-t border-[#E8DFD8] bg-[#FAF7F2]/40 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-xs text-[#863221] font-medium">
            <span>
              Showing {filteredRoles.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, filteredRoles.length)} of {filteredRoles.length} entries
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
      {/* ADD / EDIT ROLE MODAL                                        */}
      {/* ============================================================ */}
      <Modal
        isOpen={isAddEditOpen}
        onClose={() => setIsAddEditOpen(false)}
      >
        <div
          className="bg-white rounded-2xl max-w-2xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2]">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#180200]">
                  {modalMode === 'add' ? 'Add User Role' : 'Edit User Role'}
                </h3>
                <p className="text-xs text-[#863221]">
                  {modalMode === 'add' ? 'Define a new role and establish privilege defaults.' : 'Update role title, description, and status.'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsAddEditOpen(false)}
              className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSaveRole} className="p-6 space-y-4">

            {/* Role Name */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Role Name <span className="text-[#ED4636]">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleFormChange}
                className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-semibold text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${formErrors.name
                  ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                  : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                  }`}
              />
              {formErrors.name && (
                <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {formErrors.name}
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Description
              </label>
              <textarea
                name="description"
                rows={3}
                value={formData.description}
                onChange={handleFormChange}
                className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] placeholder-[#863221]/40 focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] transition-colors resize-none"
              />
            </div>

            {/* Rank Level */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Rank Level <span className="text-[#ED4636]">*</span>
              </label>
              <input
                type="number"
                name="rank_level"
                min={myRankLevel + 1}
                value={formData.rank_level}
                onChange={handleFormChange}
                className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-semibold text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${formErrors.rank_level
                  ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                  : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                  }`}
              />
              <p className="text-[10px] text-[#863221]/70 mt-1">
                1 = highest authority, larger = weaker (default 99). Must be weaker than your own rank ({myRankLevel}).
              </p>
              {formErrors.rank_level && (
                <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {formErrors.rank_level}
                </p>
              )}
            </div>

            {/* Status */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Status
              </label>
              <select
                name="status"
                value={typeof formData.status === 'boolean' ? (formData.status ? 'Active' : 'Inactive') : formData.status}
                onChange={handleFormChange}
                className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] cursor-pointer"
              >
                <option value="Active">Active (Assignable to users)</option>
                <option value="Inactive">Inactive (Suspended)</option>
              </select>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E8DFD8] bg-[#FAF7F2] -mx-6 -mb-6 mt-6 rounded-b-2xl">
              <button
                type="button"
                onClick={() => setIsAddEditOpen(false)}
                className="px-4 py-2.5 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs font-semibold rounded-xl shadow-sm hover:shadow transition-all cursor-pointer"
              >
                {modalMode === 'add' ? 'Save Role' : 'Update Role'}
              </button>
            </div>

          </form>
        </div>
      </Modal>

      {/* ============================================================ */}
      {/* CONFIGURE PRIVILEGES MODAL                                   */}
      {/* ============================================================ */}
      {privilegeTargetRole && createPortal(
      <div className="fixed top-0 right-0 bottom-0 left-0 lg:left-64 z-40 bg-[#FAF7F2] flex flex-col overflow-hidden">
        {privilegeTargetRole && (() => {
          const isSysTarget = isSystemRole(privilegeTargetRole);
          const isProtectedTarget = !isSysTarget && (privilegeTargetRole.rank_level ?? 99) <= myRankLevel;
          const isReadOnly = isSysTarget || isProtectedTarget;
          return (
            <div
              className="bg-white w-full flex-1 min-h-0 flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2] shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                      <Key className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base sm:text-lg font-bold text-[#180200]">
                          Configure Privileges – {privilegeTargetRole.name}
                        </h3>
                        {isSysTarget && (
                          <span className="px-2 py-0.5 bg-[#FFC107]/20 border border-[#FFC107]/40 text-[#863221] text-[10px] font-bold rounded-md">
                            System Role (Read-Only)
                          </span>
                        )}
                        {isProtectedTarget && (
                          <span className="px-2 py-0.5 bg-[#FFC107]/20 border border-[#FFC107]/40 text-[#863221] text-[10px] font-bold rounded-md">
                            Rank-Protected (Read-Only)
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#863221]">
                        {isReadOnly
                          ? (isSysTarget
                            ? 'Super Admin / System roles maintain permanent full-access across all modules.'
                            : 'This role is at or above your rank, so its access levels can only be viewed.')
                          : null}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setPrivilegeTargetRole(null)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-[#E8DFD8] bg-white hover:bg-[#FAF7F2] text-[#510601] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Back to Roles</span>
                  </button>
                </div>

                {/* System Role Notice Banner */}
                {isSysTarget && (
                  <div className="mt-3 px-3.5 py-2 bg-[#FFC107]/15 border border-[#FFC107]/40 rounded-xl text-xs text-[#863221] flex items-center gap-2">
                    <Lock className="w-4 h-4 text-[#863221] shrink-0" />
                    <span className="font-semibold">System role privileges are permanent and cannot be modified.</span>
                  </div>
                )}

                {/* Rank-Protected Role Notice Banner */}
                {isProtectedTarget && (
                  <div className="mt-3 px-3.5 py-2 bg-[#FFC107]/15 border border-[#FFC107]/40 rounded-xl text-xs text-[#863221] flex items-center gap-2">
                    <Lock className="w-4 h-4 text-[#863221] shrink-0" />
                    <span className="font-semibold">System Protection: access levels for this role cannot be modified (rank {privilegeTargetRole.rank_level} ≤ your rank {myRankLevel}).</span>
                  </div>
                )}

                {/* Quick Filter & Master Toggle Toolbar */}
                <div className="mt-4 pt-3 border-t border-[#E8DFD8] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#863221]/50" />
                    <input
                      type="text"
                      value={privilegeSearch}
                      onChange={(e) => setPrivilegeSearch(e.target.value)}
                      className="w-full pl-9 pr-8 py-1.5 bg-white border border-[#E8DFD8] rounded-lg text-xs text-[#180200] placeholder-[#863221]/40 focus:outline-none focus:border-[#510601]"
                    />
                    {privilegeSearch && (
                      <button
                        onClick={() => setPrivilegeSearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-xs font-semibold text-[#863221]">
                      <span className="text-[#510601] font-bold">
                        {isReadOnly ? allPrivilegeIds.length : selectedPrivileges.filter(id => allPrivilegeIds.includes(id)).length}
                      </span> of {allPrivilegeIds.length} Assigned
                    </div>

                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={handleMasterToggleAll}
                        className="px-3 py-1.5 bg-white border border-[#E8DFD8] hover:border-[#510601] text-xs font-semibold text-[#510601] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                      >
                        {selectedPrivileges.length === allPrivilegeIds.length ? 'Deselect All' : 'Select All Privileges'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Scrollable Privilege Categories Grid */}
              <div className="p-6 flex-1 min-h-0 overflow-y-auto space-y-6">
                <div className="flex items-start gap-2 p-3 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-[11px] text-[#863221]">
                  <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    Tick <span className="font-bold text-[#180200]">Read</span>, <span className="font-bold text-[#180200]">Write</span> (add and edit) and <span className="font-bold text-[#180200]">Delete</span> for each module and page. A header row, the <span className="font-bold text-[#180200]">All</span> column and the box under each column title tick everything they cover; Write or Delete also ticks Read.
                    {' '}Next to a ticked Write or Delete, <span className="font-bold text-[#180200]">Direct</span> means the role&apos;s actions apply at once and <span className="font-bold text-[#180200]">Needs approval</span> means they wait in the Approvals queue until someone with <span className="font-bold text-[#180200]">Approve requests</span> accepts them. Modules marked <span className="font-bold text-[#180200]">Coming soon</span> are not built yet.
                  </p>
                </div>
                {(() => {
                  const targetRank = privilegeTargetRole.rank_level ?? 99;
                  const q = privilegeSearch.toLowerCase().trim();
                  const switchedOff = privilegeRows.filter((r) => r.disabled && r.depth === 0).length; // modules not built yet
                  const reachable = privilegeRows.filter((r) => !r.disabled && (r.min_rank_level == null || targetRank <= r.min_rank_level));
                  // a row matches the search by its own name or privilege names; a header row stays if a row below it matches
                  const rowMatches = (r) =>
                    !q || r.name.toLowerCase().includes(q)
                    || [r.cells.read, r.cells.write, r.cells.delete, ...r.other].some((c) => c && (c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)));
                  const rows = reachable.filter((r, i) => {
                    if (rowMatches(r)) return true;
                    for (let j = i + 1; j < reachable.length && reachable[j].depth > r.depth; j += 1) {
                      if (rowMatches(reachable[j])) return true;
                    }
                    return false;
                  });
                  if (rows.length === 0) {
                    return (
                      <div className="py-12 text-center text-[#863221]">
                        <p className="text-sm font-semibold">
                          {reachable.length === 0 ? 'No modules are reachable from this role\u2019s rank.' : `No privileges match "${privilegeSearch}"`}
                        </p>
                        {reachable.length > 0 && (
                          <button onClick={() => setPrivilegeSearch('')} className="text-xs text-[#510601] hover:underline mt-1 font-medium">
                            Clear Search
                          </button>
                        )}
                      </div>
                    );
                  }

                  // the rows a header row covers: itself and every working row indented below it
                  const subtreeOf = (idx) => {
                    const list = [rows[idx]];
                    for (let j = idx + 1; j < rows.length && rows[j].depth > rows[idx].depth; j += 1) list.push(rows[j]);
                    return list.filter((r) => !r.disabled);
                  };
                  const isOn = (id) => isReadOnly || selectedPrivileges.includes(id);
                  const colCodes = (list, col) => list.map((r) => r.cells[col]?.id).filter(Boolean);
                  const allCodes = (list) => list.flatMap((r) => [r.cells.read, r.cells.write, r.cells.delete, ...r.other]).filter(Boolean).map((c) => c.id);
                  const liveRows = rows.filter((r) => !r.disabled);

                  const Box = ({ state, onClick, label }) => (
                    <button
                      type="button"
                      disabled={isReadOnly}
                      onClick={onClick}
                      aria-label={label}
                      title={label}
                      className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                        state === 'all' ? 'bg-[#510601] border-[#510601] text-white'
                          : state === 'some' ? 'bg-[#510601]/15 border-[#510601]/50 text-[#510601]'
                            : 'bg-white border-[#D9CEC4] hover:border-[#510601]'
                      } ${isReadOnly ? 'opacity-60 cursor-default' : 'cursor-pointer'}`}
                    >
                      {state === 'all' && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                      {state === 'some' && <Minus className="w-3.5 h-3.5" strokeWidth={3} />}
                    </button>
                  );

                  // Direct / Needs approval: shown beside a ticked Write or Delete
                  const ApprovalChoice = ({ id }) => {
                    const needs = approvalRequiredCodes.includes(id);
                    return (
                      <button
                        type="button"
                        onClick={() => handleToggleApprovalGate(id)}
                        title={needs
                          ? 'Needs approval: this role\u2019s actions here wait in the Approvals queue. Click to let them apply directly.'
                          : 'Direct: this role\u2019s actions here apply at once. Click to make them need approval.'}
                        className={`px-2 py-0.5 rounded-full border text-[10px] font-bold whitespace-nowrap transition-colors ${
                          needs
                            ? 'bg-[#FFF1C9] border-[#F2B600] text-[#7A4A00]'
                            : 'bg-white border-[#E8DFD8] text-[#863221]/70 hover:border-[#863221]'
                        }`}
                      >
                        {needs ? 'Needs approval' : 'Direct'}
                      </button>
                    );
                  };

                  return (
                    <div className="bg-white rounded-xl border border-[#E8DFD8] overflow-x-auto">
                      <table className="w-full min-w-[820px] text-sm border-collapse">
                        <thead>
                          <tr className="bg-[#FAF7F2] text-[11px] font-bold uppercase tracking-wider text-[#863221] border-b border-[#E8DFD8]">
                            <th className="text-left px-4 py-3 w-[30%]">Module</th>
                            {['read', 'write', 'delete'].map((col) => {
                              const codes = colCodes(liveRows, col);
                              return (
                                <th key={col} className={`px-3 py-3 text-center ${col === 'read' ? 'w-[9%]' : 'w-[17%]'}`}>
                                  <div className="flex flex-col items-center gap-1.5">
                                    <span>{col}</span>
                                    {codes.length > 0 && (
                                      <Box
                                        state={stateOf(codes, isOn)}
                                        label={`Select all ${col} for every module`}
                                        onClick={() => applyPrivilegeBulk(codes, stateOf(codes, isOn) !== 'all')}
                                      />
                                    )}
                                  </div>
                                </th>
                              );
                            })}
                            <th className="px-3 py-3 text-left">Other</th>
                            <th className="px-3 py-3 w-[7%] text-center">All</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, idx) => {
                            const sub = subtreeOf(idx);
                            const rowAll = allCodes(sub);
                            const nameCell = (
                              <td className="px-4 py-2.5" style={{ paddingLeft: `${16 + r.depth * 22}px` }}>
                                <div className="flex items-center gap-2">
                                  {r.hasChildren ? <Layers className="w-4 h-4 text-[#863221] shrink-0" /> : <span className="w-1.5 h-1.5 rounded-full bg-[#C9BCB0] shrink-0" />}
                                  <span className={r.hasChildren ? 'text-xs font-bold uppercase tracking-wide text-[#180200]' : 'text-sm font-medium text-[#180200]'}>
                                    {r.name}
                                  </span>
                                  {r.min_rank_level != null && (
                                    <span className="px-1.5 py-0.5 bg-[#FFC107]/20 text-[#863221] text-[9px] font-bold rounded">Rank {r.min_rank_level}+</span>
                                  )}
                                  {r.disabled && (
                                    <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[10px] font-bold rounded-full">Coming soon</span>
                                  )}
                                </div>
                              </td>
                            );
                            if (r.disabled) {
                              return (
                                <tr key={r.code} className="border-b border-[#F0E8E0] bg-gray-50/60 opacity-70">
                                  {nameCell}
                                  <td colSpan={5} className="px-3 py-2.5 text-xs text-gray-400">Not available yet. This module is switched off until its screens are built.</td>
                                </tr>
                              );
                            }
                            const cellFor = (col) => {
                              // a header row's cell covers its whole subtree; a leaf row's cell is its own privilege
                              const codes = r.hasChildren ? colCodes(sub, col) : colCodes([r], col);
                              if (codes.length === 0) return <span className="text-[#D9CEC4]">–</span>;
                              const own = r.cells[col];
                              return (
                                <div className="inline-flex items-center gap-2">
                                  <Box
                                    state={stateOf(codes, isOn)}
                                    label={`${col} for ${r.name}${r.hasChildren ? ' and everything below it' : ''}`}
                                    onClick={() => {
                                      if (!r.hasChildren && own) handleTogglePrivilege(own.id);
                                      else applyPrivilegeBulk(codes, stateOf(codes, isOn) !== 'all');
                                    }}
                                  />
                                  {!isReadOnly && own && col !== 'read' && isOn(own.id) && <ApprovalChoice id={own.id} />}
                                </div>
                              );
                            };
                            return (
                              <tr
                                key={r.code}
                                className={`border-b border-[#F0E8E0] transition-colors ${r.hasChildren ? 'bg-[#FAF7F2]/70' : 'hover:bg-[#FAF7F2]/50'}`}
                              >
                                {nameCell}
                                <td className="px-3 py-2.5 text-center">{cellFor('read')}</td>
                                <td className="px-3 py-2.5 text-center">{cellFor('write')}</td>
                                <td className="px-3 py-2.5 text-center">{cellFor('delete')}</td>
                                <td className="px-3 py-2.5">
                                  {r.other.length === 0 ? <span className="text-[#D9CEC4]">–</span> : (
                                    <div className="flex flex-col gap-1">
                                      {r.other.map((o) => (
                                        <label key={o.id} className="inline-flex items-center gap-2 text-xs text-[#180200] cursor-pointer" title={o.description || o.id}>
                                          <Box state={stateOf([o.id], isOn)} label={o.name} onClick={() => handleTogglePrivilege(o.id)} />
                                          <span>{o.name}</span>
                                        </label>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  {rowAll.length === 0 ? <span className="text-[#D9CEC4]">–</span> : (
                                    <Box
                                      state={stateOf(rowAll, isOn)}
                                      label={`Everything for ${r.name}${r.hasChildren ? ' and the pages below it' : ''}`}
                                      onClick={() => applyPrivilegeBulk(rowAll, stateOf(rowAll, isOn) !== 'all')}
                                    />
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {switchedOff > 0 && (
                        <p className="px-4 py-3 text-[11px] text-[#863221]/80 border-t border-[#F0E8E0] bg-[#FAF7F2]/60">
                          {switchedOff} more modules (Magazine, Reports, Notifications and others) are switched off until they are built, so they are not listed here.
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-[#E8DFD8] bg-[#FAF7F2] shrink-0">
                <button
                  type="button"
                  onClick={() => setPrivilegeTargetRole(null)}
                  className="px-4 py-2 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  {isReadOnly ? 'Close' : 'Cancel'}
                </button>

                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={handleSavePrivileges}
                    disabled={savingPrivileges || !hasPermission('users.privileges.write')}
                    title={!hasPermission('users.privileges.write') ? 'You need the users.privileges.write permission' : 'Save Privileges'}
                    className="px-5 py-2 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs font-semibold rounded-xl shadow-sm hover:shadow transition-all cursor-pointer disabled:opacity-60"
                  >
                    {savingPrivileges ? 'Saving...' : 'Save Privileges'}
                  </button>
                )}
              </div>

            </div>
          );
        })()}
      </div>,
      document.body)}

      {/* ============================================================ */}
      {/* VIEW DETAILS MODAL                                           */}
      {/* ============================================================ */}
      <Modal
        isOpen={Boolean(viewingRole)}
        onClose={() => setViewingRole(null)}
      >
        {viewingRole && (
          <div
            className="bg-white rounded-2xl max-w-3xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#180200]">Role Details</h3>
                  <p className="text-xs text-[#863221]">ID: {viewingRole.id}</p>
                </div>
              </div>
              <button
                onClick={() => setViewingRole(null)}
                className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-6 space-y-4 text-sm">
              <div className="bg-[#FAF7F2]/60 rounded-xl p-4 border border-[#E8DFD8] flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-[#863221]">Role Name</p>
                  <p className="text-xl font-bold text-[#180200] mt-0.5">{viewingRole.name}</p>
                </div>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${isRoleActive(viewingRole)
                  ? 'bg-[#3D705C]/10 text-[#3D705C] border border-[#3D705C]/20'
                  : 'bg-gray-100 text-gray-600 border border-gray-200'
                  }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isRoleActive(viewingRole) ? 'bg-[#3D705C]' : 'bg-gray-400'}`} />
                  {isRoleActive(viewingRole) ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-xs text-[#863221] font-semibold uppercase">Description</p>
                  <p className="text-xs text-[#180200] mt-0.5 leading-relaxed bg-gray-50/50 p-2.5 rounded-lg border border-[#E8DFD8]">
                    {viewingRole.description || 'No description provided.'}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="p-3 bg-[#FAF7F2] rounded-xl border border-[#E8DFD8]">
                    <p className="text-[#863221] font-semibold uppercase">Rank</p>
                    <p className="text-base font-bold text-[#180200] mt-0.5">
                      {viewingRole.rank_level ?? 99}
                      {viewingRole.is_all_access && (
                        <span className="ml-1.5 text-[10px] font-bold text-[#3D705C]">All-Access</span>
                      )}
                    </p>
                  </div>

                  <div className="p-3 bg-[#FAF7F2] rounded-xl border border-[#E8DFD8]">
                    <p className="text-[#863221] font-semibold uppercase">Assigned Users</p>
                    <p className="text-base font-bold text-[#180200] mt-0.5">{viewingRole.user_count || 0} Users</p>
                  </div>

                  <div className="p-3 bg-[#FAF7F2] rounded-xl border border-[#E8DFD8]">
                    <p className="text-[#863221] font-semibold uppercase">Assigned Privileges</p>
                    <p className="text-base font-bold text-[#510601] mt-0.5">
                      {viewingRole.permission_codes ? viewingRole.permission_codes.length : 0} of {allPrivilegeIds.length}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs text-[#863221]">
                  <div>
                    <span className="font-semibold">Created Date:</span> {formatDate(viewingRole.createdAt)}
                  </div>
                  <div>
                    <span className="font-semibold">Last Updated:</span> {formatDate(viewingRole.updatedAt)}
                  </div>
                </div>
              </div>

              {/* Read-only footer */}
              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-[#E8DFD8]">
                <button
                  type="button"
                  onClick={() => setViewingRole(null)}
                  className="px-4 py-2 border border-[#E8DFD8] text-[#863221] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>

            </div>
          </div>
        )}
      </Modal>

      {/* ============================================================ */}
      {/* DELETE CONFIRMATION MODAL WITH PROTECTION                    */}
      {/* ============================================================ */}
      <Modal
        isOpen={Boolean(deleteTargetRole)}
        onClose={() => setDeleteTargetRole(null)}
      >
        {deleteTargetRole && (
          <div
            className="bg-white rounded-2xl max-w-sm w-full border border-[#E8DFD8] shadow-2xl p-6 text-center animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {deleteTargetRole.usersCount > 0 || isSystemRole(deleteTargetRole) ? (
              <>
                <div className="w-14 h-14 rounded-full bg-amber-100 text-[#EE6A00] flex items-center justify-center mx-auto mb-3.5">
                  <Lock className="w-7 h-7" />
                </div>

                <h3 className="text-lg font-bold text-[#180200]">
                  Cannot Delete Role
                </h3>
                <p className="text-xs text-[#863221] mt-2 leading-relaxed">
                  {(deleteTargetRole.isSystem || deleteTargetRole.is_all_access || deleteTargetRole.rank_level === 1) ? (
                    <>
                      <strong>{deleteTargetRole.name}</strong> is a core system role with all-access permissions and cannot be deleted.
                    </>
                  ) : (
                    <>
                      This role is currently assigned to <strong className="text-[#180200]">{deleteTargetRole.usersCount} users</strong> and cannot be deleted. Please reassign those users before deleting the role.
                    </>
                  )}
                </p>

                <div className="mt-6">
                  <button
                    type="button"
                    onClick={() => setDeleteTargetRole(null)}
                    className="w-full py-2.5 px-4 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl shadow-sm transition-colors cursor-pointer"
                  >
                    Understood
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-full bg-red-100 text-[#ED4636] flex items-center justify-center mx-auto mb-3.5">
                  <Trash2 className="w-7 h-7" />
                </div>

                <h3 className="text-lg font-bold text-[#180200]">
                  Delete Role?
                </h3>
                <p className="text-xs text-[#863221] mt-1.5 leading-relaxed">
                  Are you sure you want to delete role <strong className="text-[#180200]">{deleteTargetRole.name}</strong>? This action cannot be undone.
                </p>

                <div className="mt-6 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setDeleteTargetRole(null)}
                    className="w-full py-2.5 px-4 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDeleteRole}
                    className="w-full py-2.5 px-4 bg-[#ED4636] hover:bg-[#C93324] text-white text-xs font-semibold rounded-xl shadow-sm transition-colors cursor-pointer"
                  >
                    Delete Role
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* ============================================================ */}
      {/* ACTIVATE / DEACTIVATE CONFIRMATION MODAL                     */}
      {/* ============================================================ */}
      <Modal
        isOpen={Boolean(statusDialog)}
        onClose={() => setStatusDialog(null)}
      >
        {statusDialog && (() => {
          const isTargetDeactivate = statusDialog.newStatus === false || statusDialog.newStatus === 'Inactive';
          return (
            <div
              className="bg-white rounded-2xl max-w-sm w-full border border-[#E8DFD8] shadow-2xl p-6 text-center animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3.5 ${
                isTargetDeactivate ? 'bg-red-100 text-[#ED4636]' : 'bg-[#3D705C]/10 text-[#3D705C]'
              }`}>
                {isTargetDeactivate ? (
                  <AlertTriangle className="w-7 h-7" />
                ) : (
                  <CheckCircle2 className="w-7 h-7" />
                )}
              </div>

              <h3 className="text-lg font-bold text-[#180200]">
                {isTargetDeactivate ? 'Deactivate Role?' : 'Activate Role?'}
              </h3>
              <p className="text-xs text-[#863221] mt-1.5 leading-relaxed">
                {isTargetDeactivate ? (
                  <>
                    Are you sure you want to deactivate <strong className="text-[#180200]">{statusDialog.role.name}</strong>? Inactive roles cannot be assigned to new user accounts.
                  </>
                ) : (
                  <>
                    Are you sure you want to activate <strong className="text-[#180200]">{statusDialog.role.name}</strong>? It will become available for assignment to user accounts.
                  </>
                )}
              </p>

              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setStatusDialog(null)}
                  className="w-full py-2.5 px-4 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmStatusToggle}
                  className={`w-full py-2.5 px-4 text-white text-xs font-semibold rounded-xl shadow-sm transition-colors cursor-pointer ${
                    isTargetDeactivate
                      ? 'bg-[#ED4636] hover:bg-[#C93324]'
                      : 'bg-[#3D705C] hover:bg-[#2F5647]'
                  }`}
                >
                  {isTargetDeactivate ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

    </div>
    </PermissionGate>
  );
}
