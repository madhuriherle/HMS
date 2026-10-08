import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
import {
  Layers,
  Plus,
  Edit3,
  Trash2,
  Lock,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  X
} from 'lucide-react';
import api from '../api';
import useAuth from '../hooks/useAuth';

const emptyForm = {
  code: '',
  name_en: '',
  name_kn: '',
  description: '',
  route: '',
  icon: '',
  parent_id: '',
  opens_module_id: '',
  display_order: 0,
  min_rank_level: '',
  status: true
};

export default function ModulesManagement() {
  const { myRank } = useAuth();
  const isRank1 = myRank === 1;

  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);

  const [isAddEditOpen, setIsAddEditOpen] = useState(false);
  const [modalMode, setModalMode] = useState('add');
  const [editingModule, setEditingModule] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (message, type = 'success') => {
    setToastMessage({ message, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const errDetail = (err, fallback) => {
    const d = err?.response?.data?.detail;
    return typeof d === 'string' ? d : fallback;
  };

  const fetchModules = async () => {
    try {
      setLoading(true);
      const res = await api.get('/users/modules', { params: { limit: 500 } });
      const rows = Array.isArray(res.data)
        ? res.data
        : (res.data?.data || res.data?.items || []);
      setModules(rows);
    } catch (err) {
      showToast(errDetail(err, 'Error fetching modules'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isRank1) fetchModules();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRank1]);

  const hasActiveFilters = searchQuery.trim() !== '' || statusFilter !== 'ALL';

  const filteredModules = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return modules.filter((m) => {
      const matchSearch =
        !q ||
        (m.name_en || '').toLowerCase().includes(q) ||
        (m.code || '').toLowerCase().includes(q) ||
        (m.route || '').toLowerCase().includes(q) ||
        (m.description || '').toLowerCase().includes(q);
      const matchStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'Active' && m.status) ||
        (statusFilter === 'Inactive' && !m.status);
      return matchSearch && matchStatus;
    });
  }, [modules, searchQuery, statusFilter]);

  const totalPages = Math.ceil(filteredModules.length / pageSize) || 1;
  const paginatedModules = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredModules.slice(start, start + pageSize);
  }, [filteredModules, currentPage, pageSize]);

  const parentName = (id) => {
    if (id == null) return null;
    const p = modules.find((m) => m.id === id || String(m.id) === String(id));
    return p ? p.name_en : null;
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setStatusFilter('ALL');
    setCurrentPage(1);
  };

  // ----------------------------------------------------
  // ADD / EDIT
  // ----------------------------------------------------
  const openAddModal = () => {
    setModalMode('add');
    setEditingModule(null);
    setFormData({ ...emptyForm });
    setFormErrors({});
    setIsAddEditOpen(true);
  };

  const openEditModal = (m) => {
    setModalMode('edit');
    setEditingModule(m);
    setFormData({
      code: m.code || '',
      name_en: m.name_en || '',
      name_kn: m.name_kn || '',
      description: m.description || '',
      route: m.route || '',
      icon: m.icon || '',
      parent_id: m.parent_id ?? '',
      opens_module_id: m.opens_module_id ?? '',
      display_order: m.display_order ?? 0,
      min_rank_level: m.min_rank_level ?? '',
      status: Boolean(m.status)
    });
    setFormErrors({});
    setIsAddEditOpen(true);
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    if (name === 'status') {
      setFormData((prev) => ({ ...prev, status: value === 'true' }));
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = () => {
    const errors = {};
    const code = (formData.code || '').trim();
    const name = (formData.name_en || '').trim();

    if (!name) errors.name_en = 'Module name is required';
    if (modalMode === 'add') {
      if (!code) {
        errors.code = 'Module code is required';
      } else if (/\s/.test(code)) {
        errors.code = 'Code cannot contain spaces';
      } else {
        const dup = modules.some((m) => (m.code || '').toLowerCase() === code.toLowerCase());
        if (dup) errors.code = 'A module with this code already exists';
      }
    }

    const order = Number(formData.display_order);
    if (!Number.isInteger(order) || order < 0) {
      errors.display_order = 'Display order must be a whole number of 0 or more';
    }

    if (formData.min_rank_level !== '' && formData.min_rank_level != null) {
      const rank = Number(formData.min_rank_level);
      if (!Number.isInteger(rank) || rank < 1) {
        errors.min_rank_level = 'Rank gate must be a whole number of 1 or more (leave empty for none)';
      }
    }

    const parentId = formData.parent_id === '' ? null : Number(formData.parent_id);
    if (parentId != null && editingModule && parentId === editingModule.id) {
      errors.parent_id = 'A module cannot be its own parent';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const buildPayload = () => {
    const payload = {
      name_en: formData.name_en.trim(),
      name_kn: (formData.name_kn || '').trim() || null,
      description: (formData.description || '').trim() || null,
      route: (formData.route || '').trim() || null,
      icon: (formData.icon || '').trim() || null,
      parent_id: formData.parent_id === '' ? null : Number(formData.parent_id),
      opens_module_id: formData.opens_module_id === '' ? null : Number(formData.opens_module_id),
      display_order: Number(formData.display_order),
      min_rank_level:
        formData.min_rank_level === '' || formData.min_rank_level == null
          ? null
          : Number(formData.min_rank_level),
      status: Boolean(formData.status)
    };
    if (modalMode === 'add') {
      payload.code = (formData.code || '').trim();
    }
    return payload;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setSaving(true);
    try {
      if (modalMode === 'add') {
        await api.post('/users/modules', buildPayload());
        showToast('Module created successfully.');
      } else {
        await api.put(`/users/modules/${editingModule.id}`, buildPayload());
        showToast('Module updated successfully.');
      }
      setIsAddEditOpen(false);
      setFormData(emptyForm);
      await fetchModules();
    } catch (err) {
      showToast(errDetail(err, 'Error saving module'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // ----------------------------------------------------
  // STATUS TOGGLE
  // ----------------------------------------------------
  const handleToggleStatus = async (m) => {
    try {
      const res = await api.put(`/users/modules/${m.id}`, { status: !m.status });
      const updated = res.data?.id ? res.data : { ...m, status: !m.status };
      setModules((prev) => prev.map((x) => (x.id === m.id || String(x.id) === String(m.id)) ? updated : x));
      showToast(`Module "${m.name_en}" is now ${!m.status ? 'Active' : 'Inactive'}.`);
    } catch (err) {
      showToast(errDetail(err, 'Error updating module status'), 'error');
    }
  };

  // ----------------------------------------------------
  // DELETE
  // ----------------------------------------------------
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await api.delete(`/users/modules/${target.id}`);
      setModules((prev) => prev.filter((m) => m.id !== target.id && String(m.id) !== String(target.id)));
      showToast(`Module "${target.name_en}" deleted successfully.`);
    } catch (err) {
      showToast(errDetail(err, 'Error deleting module'), 'error');
    }
    setDeleteTarget(null);
  };

  // ----------------------------------------------------
  // RENDER
  // ----------------------------------------------------
  if (!isRank1) {
    return (
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] p-12 text-center">
        <div className="w-14 h-14 rounded-full bg-[#FFC107]/15 text-[#863221] flex items-center justify-center mx-auto mb-4">
          <Lock className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-bold text-[#180200]">Module Master is Rank-1 Only</h2>
        <p className="text-xs text-[#863221] mt-2 max-w-md mx-auto leading-relaxed">
          The module catalogue controls menu visibility, privileges and rank gates across the system.
          It can only be managed by the Super Admin role (Rank 1). Your rank is {myRank}.
        </p>
        <Link
          to="/dashboard"
          className="inline-block mt-5 px-5 py-2.5 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast */}
      <Modal isOpen={Boolean(toastMessage)} onClose={() => setToastMessage(null)}>
        {toastMessage && (
          <div
            className="bg-white rounded-2xl max-w-sm w-full border border-[#E8DFD8] shadow-2xl p-6 text-center animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3.5 ${toastMessage.type === 'error' ? 'bg-red-100 text-[#ED4636]' : 'bg-[#3D705C]/10 text-[#3D705C]'}`}>
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
        breadcrumb={
          <nav className="flex items-center gap-1.5 text-xs text-[#863221] font-medium mb-1">
            <Link to="/dashboard" className="hover:text-[#510601] transition-colors">Dashboard</Link>
            <ChevronRight className="w-3.5 h-3.5 text-[#863221]/50" />
            <span>System</span>
            <ChevronRight className="w-3.5 h-3.5 text-[#863221]/50" />
            <span className="text-[#510601] font-semibold">Modules</span>
          </nav>
        }
        title="Module Master"
        searchQuery={searchQuery}
        onSearchChange={(val) => { setSearchQuery(val); setCurrentPage(1); }}
        searchPlaceholder="Search modules by name, code or route..."
        activeFiltersCount={hasActiveFilters ? 1 : 0}
        onResetFilters={handleClearFilters}
        rightSlot={
          <button
            type="button"
            onClick={openAddModal}
            className="px-4 py-2.5 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs font-semibold rounded-xl shadow-sm hover:shadow transition-all cursor-pointer flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Add Module</span>
          </button>
        }
      >
        <FilterSelect
          value={statusFilter}
          onChange={(val) => { setStatusFilter(val); setCurrentPage(1); }}
          options={[
            { value: 'ALL', label: 'All Status' },
            { value: 'Active', label: 'Active' },
            { value: 'Inactive', label: 'Inactive' }
          ]}
          widthClass="w-full sm:w-40"
        />
        <button
          type="button"
          onClick={fetchModules}
          className="px-3.5 py-2 text-xs font-semibold text-[#510601] hover:bg-[#FAF7F2] rounded-xl border border-[#E8DFD8] transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer"
          title="Refresh from server"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </SearchFilterBar>

      {/* Modules Table */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-semibold text-[#863221] uppercase tracking-wider">
                <th className="px-6 py-3.5">Module</th>
                <th className="px-6 py-3.5">Parent</th>
                <th className="px-6 py-3.5">Route</th>
                <th className="px-6 py-3.5 text-center">Order</th>
                <th className="px-6 py-3.5 text-center">Rank Gate</th>
                <th className="px-6 py-3.5 text-center">Privileges</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8] text-sm">
              {!loading && paginatedModules.length > 0 ? (
                paginatedModules.map((m) => (
                  <tr key={m.id} className="hover:bg-[#FAF7F2]/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-[#510601]/10 text-[#510601] border border-[#510601]/20 flex items-center justify-center shrink-0">
                          <Layers className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="font-bold text-[#180200] leading-tight">{m.name_en}</p>
                          <span className="text-[11px] text-[#863221]/70 font-mono">{m.code}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-[#180200]/80">
                      {parentName(m.parent_id) || <span className="text-stone-400">— Root —</span>}
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-[#863221]">
                      {m.route || '—'}
                    </td>
                    <td className="px-6 py-4 text-center text-xs font-semibold text-[#180200]">
                      {m.display_order ?? 0}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {m.min_rank_level != null ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 bg-[#FFC107]/15 border border-[#FFC107]/40 text-[#863221] text-[10px] font-bold rounded-md"
                          title={`Roles ranked worse than ${m.min_rank_level} cannot access this module`}
                        >
                          Rank {m.min_rank_level}+
                        </span>
                      ) : (
                        <span className="text-xs text-stone-400">Any</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center px-2.5 py-1 bg-[#FAF7F2] border border-[#E8DFD8] rounded-lg text-xs font-semibold text-[#180200]">
                        {m.permission_count ?? 0}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => handleToggleStatus(m)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold transition-all ${
                          m.status
                            ? 'bg-[#3D705C]/10 text-[#3D705C] border border-[#3D705C]/20 hover:bg-[#3D705C]/20 cursor-pointer hover:opacity-80 active:scale-95'
                            : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200 cursor-pointer hover:opacity-80 active:scale-95'
                        }`}
                        title={m.status ? 'Click to disable module' : 'Click to enable module'}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${m.status ? 'bg-[#3D705C]' : 'bg-gray-400'}`} />
                        {m.status ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEditModal(m)}
                          className="p-1.5 text-[#863221] hover:text-[#510601] hover:bg-[#FAF7F2] rounded-lg border border-transparent hover:border-[#E8DFD8] transition-all cursor-pointer"
                          title="Edit Module"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(m)}
                          className="p-1.5 text-[#863221] hover:text-[#ED4636] hover:bg-red-50 rounded-lg border border-transparent hover:border-red-100 transition-all cursor-pointer"
                          title="Delete Module"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : loading ? (
                <tr>
                  <td colSpan="8" className="px-6 py-12 text-center text-[#863221] text-sm font-medium">
                    Loading modules...
                  </td>
                </tr>
              ) : (
                <tr>
                  <td colSpan="8" className="px-6 py-12 text-center text-[#863221]">
                    <div className="w-12 h-12 rounded-full bg-[#FAF7F2] text-[#863221]/60 flex items-center justify-center mx-auto mb-3">
                      <Layers className="w-6 h-6" />
                    </div>
                    <p className="font-semibold text-sm text-[#180200]">
                      {hasActiveFilters ? 'No modules match your search' : 'No modules found'}
                    </p>
                    <p className="text-xs text-[#863221]/70 mt-1 max-w-sm mx-auto">
                      {hasActiveFilters
                        ? 'Try changing your search or filter criteria.'
                        : 'The module catalogue is empty. Add the first module to begin building the menu tree.'}
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
                          className="px-4 py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                        >
                          Add Module
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filteredModules.length > 0 && (
          <div className="flex items-center justify-between px-6 py-3.5 border-t border-[#E8DFD8] bg-[#FAF7F2]/50">
            <span className="text-xs text-[#863221] font-medium">
              Showing {Math.min((currentPage - 1) * pageSize + 1, filteredModules.length)}–
              {Math.min(currentPage * pageSize, filteredModules.length)} of {filteredModules.length} modules
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 text-xs font-semibold text-[#510601] bg-white border border-[#E8DFD8] rounded-lg hover:border-[#510601] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              <span className="px-2.5 text-xs font-semibold text-[#180200]">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 text-xs font-semibold text-[#510601] bg-white border border-[#E8DFD8] rounded-lg hover:border-[#510601] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ADD / EDIT MODAL */}
      <Modal isOpen={isAddEditOpen} onClose={() => setIsAddEditOpen(false)}>
        <div
          className="bg-white rounded-2xl max-w-2xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2]">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#180200]">
                  {modalMode === 'add' ? 'Add Module' : 'Edit Module'}
                </h3>
                <p className="text-xs text-[#863221]">
                  {modalMode === 'add'
                    ? 'Define a new entry in the module catalogue.'
                    : 'Update module details, ranking gate and menu behaviour.'}
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

          <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Module Code {modalMode === 'add' && <span className="text-[#ED4636]">*</span>}
                </label>
                <input
                  type="text"
                  name="code"
                  value={formData.code}
                  onChange={handleFormChange}
                  disabled={modalMode === 'edit'}
                  placeholder="e.g. MEMBERSHIP"
                  className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-semibold text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors disabled:bg-gray-50 disabled:text-[#863221]/60 ${formErrors.code
                    ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                    : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                    }`}
                />
                {modalMode === 'edit' && (
                  <p className="text-[10px] text-[#863221]/70 mt-1">Code is immutable — permissions reference it.</p>
                )}
                {formErrors.code && (
                  <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {formErrors.code}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Module Name (EN) <span className="text-[#ED4636]">*</span>
                </label>
                <input
                  type="text"
                  name="name_en"
                  value={formData.name_en}
                  onChange={handleFormChange}
                  placeholder="e.g. Membership"
                  className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-semibold text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${formErrors.name_en
                    ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                    : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                    }`}
                />
                {formErrors.name_en && (
                  <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {formErrors.name_en}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Module Name (KN)
                </label>
                <input
                  type="text"
                  name="name_kn"
                  value={formData.name_kn}
                  onChange={handleFormChange}
                  placeholder="ಕನ್ನಡ ಹೆಸರು"
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm text-[#180200] placeholder-[#863221]/40 focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Route
                </label>
                <input
                  type="text"
                  name="route"
                  value={formData.route}
                  onChange={handleFormChange}
                  placeholder="e.g. /dashboard/membership/list"
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm font-mono text-[#180200] placeholder-[#863221]/40 focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Parent Module
                </label>
                <select
                  name="parent_id"
                  value={formData.parent_id}
                  onChange={handleFormChange}
                  className={`w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] cursor-pointer ${formErrors.parent_id ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30' : ''}`}
                >
                  <option value="">— Root level —</option>
                  {modules
                    .filter((m) => !editingModule || (m.id !== editingModule.id && String(m.id) !== String(editingModule.id)))
                    .map((m) => (
                      <option key={m.id} value={m.id}>{m.name_en} ({m.code})</option>
                    ))}
                </select>
                {formErrors.parent_id && (
                  <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {formErrors.parent_id}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Opens Module
                </label>
                <select
                  name="opens_module_id"
                  value={formData.opens_module_id}
                  onChange={handleFormChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] cursor-pointer"
                >
                  <option value="">— None —</option>
                  {modules
                    .filter((m) => !editingModule || (m.id !== editingModule.id && String(m.id) !== String(editingModule.id)))
                    .map((m) => (
                      <option key={m.id} value={m.id}>{m.name_en} ({m.code})</option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Display Order
                </label>
                <input
                  type="number"
                  name="display_order"
                  min="0"
                  value={formData.display_order}
                  onChange={handleFormChange}
                  className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-semibold text-[#180200] focus:outline-none transition-colors ${formErrors.display_order
                    ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                    : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                    }`}
                />
                {formErrors.display_order && (
                  <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {formErrors.display_order}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Rank Gate (min_rank_level)
                </label>
                <input
                  type="number"
                  name="min_rank_level"
                  min="1"
                  value={formData.min_rank_level}
                  onChange={handleFormChange}
                  placeholder="Empty = no rank gate"
                  className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-semibold text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${formErrors.min_rank_level
                    ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                    : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                    }`}
                />
                <p className="text-[10px] text-[#863221]/70 mt-1">
                  Roles ranked worse than this number will not see the module.
                </p>
                {formErrors.min_rank_level && (
                  <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {formErrors.min_rank_level}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Icon Name
                </label>
                <input
                  type="text"
                  name="icon"
                  value={formData.icon}
                  onChange={handleFormChange}
                  placeholder="e.g. Users"
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm text-[#180200] placeholder-[#863221]/40 focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Status
                </label>
                <select
                  name="status"
                  value={formData.status ? 'true' : 'false'}
                  onChange={handleFormChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] cursor-pointer"
                >
                  <option value="true">Active (visible in menu)</option>
                  <option value="false">Inactive (hidden)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Description
              </label>
              <textarea
                name="description"
                rows={2}
                value={formData.description}
                onChange={handleFormChange}
                placeholder="What this module covers..."
                className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] placeholder-[#863221]/40 focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] transition-colors resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#E8DFD8]">
              <button
                type="button"
                onClick={() => setIsAddEditOpen(false)}
                className="px-4 py-2.5 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs font-semibold rounded-xl shadow-sm hover:shadow transition-all cursor-pointer disabled:opacity-60"
              >
                {saving ? 'Saving...' : modalMode === 'add' ? 'Create Module' : 'Update Module'}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* DELETE CONFIRM MODAL */}
      <Modal isOpen={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        {deleteTarget && (
          <div
            className="bg-white rounded-2xl max-w-md w-full border border-[#E8DFD8] shadow-2xl p-6 text-center animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-full bg-red-100 text-[#ED4636] flex items-center justify-center mx-auto mb-3.5">
              <Trash2 className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-[#180200]">Delete Module?</h3>
            <p className="text-xs text-[#863221] mt-2 leading-relaxed">
              You are about to remove <span className="font-bold text-[#180200]">{deleteTarget.name_en}</span> ({deleteTarget.code}).
              Modules with submodules or assigned privileges cannot be deleted.
            </p>
            <div className="flex gap-3 mt-5">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 px-4 border border-[#E8DFD8] text-[#863221] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="flex-1 py-2.5 px-4 bg-[#ED4636] hover:bg-[#c93a2c] text-white text-xs font-semibold rounded-xl shadow-sm transition-colors cursor-pointer"
              >
                Delete Module
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
