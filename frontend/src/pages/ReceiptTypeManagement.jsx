import FilterToggle from '../components/FilterToggle';
import React, { useState, useMemo, useEffect } from 'react';
import Modal from '../components/Modal';
import {
  FileText,
  Plus,
  Search,
  Pencil,
  Trash2,
  ChevronRight,
  ChevronDown,
  GripVertical,
  ChevronLeft,
  CheckCircle2,
  X,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Layers,
} from 'lucide-react';
import api from '../api';
import { notify } from '../utils/notify';
import useAuth from '../hooks/useAuth';
import useSwalConfirm from '../hooks/useSwalConfirm';
import PermissionGate from '../components/PermissionGate';

import ModalFooter from '../components/ModalFooter';
export default function ReceiptTypeManagement() {
  const { hasPermission } = useAuth();

  // Master state
  const [receiptTypes, setReceiptTypes] = useState([]);
  const [serviceTypes, setServiceTypes] = useState([]);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Expandable row state (expanded receipt type IDs)
  const [expandedRows, setExpandedRows] = useState({}); // groups start closed; a click opens one

  // Modal States - Particular (Add/Edit)
  const [isTypeModalOpen, setIsTypeModalOpen] = useState(false);
  const [typeModalMode, setTypeModalMode] = useState('add'); // 'add' | 'edit'
  const [editingType, setEditingType] = useState(null);
  const [typeFormData, setTypeFormData] = useState({
    name: '',
    serviceTypeId: '',
    status: 'Active',
    subTypes: []
  });
  const [typeFormErrors, setTypeFormErrors] = useState({});

  // Modal States - Sub-Type (Add/Edit)
  const [isSubTypeModalOpen, setIsSubTypeModalOpen] = useState(false);
  const [subTypeModalMode, setSubTypeModalMode] = useState('add'); // 'add' | 'edit'
  const [parentTypeForSubType, setParentTypeForSubType] = useState(null);
  const [editingSubType, setEditingSubType] = useState(null);
  const [subTypeFormData, setSubTypeFormData] = useState({
    name: '',
    status: 'Active'
  });
  const [subTypeFormErrors, setSubTypeFormErrors] = useState({});

  // Delete Confirmation Modal State
  // { targetType: 'receiptType' | 'subType', item, parentType }
  const [deletingItem, setDeletingItem] = useState(null);

  // Status Toggle Confirmation Dialog State
  // { targetType: 'receiptType' | 'subType', item, parentType, newStatus }
  const [statusDialog, setStatusDialog] = useState(null);

  // Toast / Feedback Modal State
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (message, type = 'success') => {
    notify(message, type);
  };


  const canReorder = hasPermission('masters.particulars.write') && !searchQuery;

  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  const dropType = async (targetId) => {
    const fromId = dragId;
    setDragId(null);
    setOverId(null);
    if (fromId == null || fromId === targetId) return;
    const ids = receiptTypes.map((t) => t.id).filter((id) => id !== fromId);
    const at = ids.indexOf(targetId);
    if (at < 0) return;
    ids.splice(at, 0, fromId);
    try {
      await api.put('/masters/particulars-order', { ids }, { params: { reason: 'Reordered particulars' } });
      await fetchReceiptTypes();
    } catch (error) {
      showToast(error.response?.data?.detail || 'Could not save the new order.', 'error');
    }
  };

  const fetchReceiptTypes = async () => {
    api.get('/masters/service-types?limit=200').then(({ data }) => setServiceTypes(data?.data || [])).catch(() => {});
    try {
      const res = await api.get('/masters/particulars?limit=2000');
      const allItems = res.data?.data || [];
      const parents = allItems.filter(i => !i.parent_id);
      
      const mapped = parents.map(p => {
        const subs = allItems.filter(i => i.parent_id === p.id).map(s => ({
          id: s.id,
          name: s.name_en,
          status: s.status ? 'Active' : 'Inactive'
        }));
        return {
          id: p.id,
          name: p.name_en,
          serviceTypeId: p.service_type_id ?? '',
          paysForMembership: Boolean(p.pays_for_membership),
          needsDescription: Boolean(p.needs_description),
          status: p.status ? 'Active' : 'Inactive',
          subTypes: subs
        };
      });
      setReceiptTypes(mapped);
    } catch (err) {
      console.error(err); showToast(err.response?.data?.detail || 'Could not load data from the server.', 'error');
    }
  };

  useEffect(() => {
    fetchReceiptTypes();
  }, []);



  // Toggle row expansion
  const toggleRowExpansion = (typeId) => {
    setExpandedRows(prev => ({
      ...prev,
      [typeId]: !prev[typeId]
    }));
  };

  // ----------------------------------------------------
  // SEARCH & FILTERING
  // ----------------------------------------------------
  const handleClearFilters = () => {
    setSearchQuery('');
    setStatusFilter('ALL');
    setCurrentPage(1);
  };

  const hasActiveFilters = searchQuery !== '' || statusFilter !== 'ALL';
  const [filtersOpen, setFiltersOpen] = useState(false); // the filters show only when the filter icon is clicked

  const filteredData = useMemo(() => {
    return receiptTypes.filter((item) => {
      const q = searchQuery.toLowerCase().trim();
      const matchTypeSearch = !q || (item.name && item.name.toLowerCase().includes(q));
      const matchSubTypeSearch = !q || (item.subTypes && item.subTypes.some(st => st.name.toLowerCase().includes(q)));
      const matchSearch = matchTypeSearch || matchSubTypeSearch;

      const matchStatus = statusFilter === 'ALL' || item.status === statusFilter;

      return matchSearch && matchStatus;
    });
  }, [receiptTypes, searchQuery, statusFilter]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredData.length / pageSize) || 1;
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, currentPage, pageSize]);

  // ----------------------------------------------------
  // PARTICULAR ADD / EDIT HANDLERS
  // ----------------------------------------------------
  const openAddTypeModal = () => {
    setTypeModalMode('add');
    setEditingType(null);
    setTypeFormData({
      name: '',
      serviceTypeId: '',
      paysForMembership: false,
      needsDescription: false,
      status: 'Active',
      subTypes: []
    });
    setTypeFormErrors({});
    setIsTypeModalOpen(true);
  };

  const openEditTypeModal = (type) => {
    setTypeModalMode('edit');
    setEditingType(type);
    setTypeFormData({
      name: type.name || '',
      serviceTypeId: type.serviceTypeId ?? '',
      paysForMembership: Boolean(type.paysForMembership),
      needsDescription: Boolean(type.needsDescription),
      status: type.status || 'Active',
      subTypes: type.subTypes ? [...type.subTypes] : []
    });
    setTypeFormErrors({});
    setIsTypeModalOpen(true);
  };

  const handleTypeFormChange = (e) => {
    const { name, value } = e.target;
    setTypeFormData(prev => ({ ...prev, [name]: value }));
    if (typeFormErrors[name]) {
      setTypeFormErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validateTypeForm = () => {
    const errors = {};
    const trimmedName = (typeFormData.name || '').trim();

    if (!trimmedName) {
      errors.name = 'Particular name is required';
    } else {
      // Check for duplicate names (excluding current editing item)
      const isDuplicate = receiptTypes.some(rt => {
        if (editingType && rt.id === editingType.id) return false;
        return rt.name.toLowerCase().trim() === trimmedName.toLowerCase();
      });

      if (isDuplicate) {
        errors.name = 'A Particular with this name already exists';
      }
    }

    setTypeFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveType = async (e) => {
    e.preventDefault();
    if (!validateTypeForm()) return;

    const trimmedName = typeFormData.name.trim();
    const isActive = typeFormData.status === 'Active';
    const serviceTypeId = typeFormData.serviceTypeId ? Number(typeFormData.serviceTypeId) : null;

    try {
      if (typeModalMode === 'add') {
        await api.post('/masters/particulars', {
          name_en: trimmedName,
          service_type_id: serviceTypeId,
          pays_for_membership: Boolean(typeFormData.paysForMembership),
          needs_description: Boolean(typeFormData.needsDescription),
          status: isActive
        });
        showToast(`Particular "${trimmedName}" created successfully.`);
      } else {
        await api.put(`/masters/particulars/${editingType.id}`, {
          name_en: trimmedName,
          service_type_id: serviceTypeId,
          pays_for_membership: Boolean(typeFormData.paysForMembership),
          needs_description: Boolean(typeFormData.needsDescription),
          status: isActive
        });
        showToast(`Particular "${trimmedName}" updated successfully.`);
      }
      setIsTypeModalOpen(false);
      fetchReceiptTypes();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error saving particular', 'error');
    }
  };

  // ----------------------------------------------------
  // SUB-TYPE ADD / EDIT HANDLERS
  // ----------------------------------------------------
  const openAddSubTypeModal = (parentType) => {
    setParentTypeForSubType(parentType);
    setSubTypeModalMode('add');
    setEditingSubType(null);
    setSubTypeFormData({
      name: '',
      status: 'Active'
    });
    setSubTypeFormErrors({});
    setIsSubTypeModalOpen(true);
  };

  const openEditSubTypeModal = (parentType, subType) => {
    setParentTypeForSubType(parentType);
    setSubTypeModalMode('edit');
    setEditingSubType(subType);
    setSubTypeFormData({
      name: subType.name || '',
      status: subType.status || 'Active'
    });
    setSubTypeFormErrors({});
    setIsSubTypeModalOpen(true);
  };

  const handleSubTypeFormChange = (e) => {
    const { name, value } = e.target;
    setSubTypeFormData(prev => ({ ...prev, [name]: value }));
    if (subTypeFormErrors[name]) {
      setSubTypeFormErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validateSubTypeForm = () => {
    const errors = {};
    const trimmedName = (subTypeFormData.name || '').trim();

    if (!trimmedName) {
      errors.name = 'Sub-Type name is required';
    } else if (parentTypeForSubType) {
      // Check for duplicate sub-type names within the same parent type
      const currentSubTypes = parentTypeForSubType.subTypes || [];
      const isDuplicate = currentSubTypes.some(st => {
        if (editingSubType && st.id === editingSubType.id) return false;
        return st.name.toLowerCase().trim() === trimmedName.toLowerCase();
      });

      if (isDuplicate) {
        errors.name = `A Sub-Type with this name already exists under ${parentTypeForSubType.name}`;
      }
    }

    setSubTypeFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveSubType = async (e) => {
    e.preventDefault();
    if (!validateSubTypeForm()) return;

    const trimmedName = subTypeFormData.name.trim();
    const parent = parentTypeForSubType;
    const isActive = subTypeFormData.status === 'Active';

    try {
      let data;
      if (subTypeModalMode === 'add') {
        ({ data } = await api.post('/masters/particulars', {
          name_en: trimmedName,
          parent_id: parent.id,
          status: isActive
        }));
      } else {
        ({ data } = await api.put(`/masters/particulars/${editingSubType.id}`, {
          name_en: trimmedName,
          status: isActive
        }));
      }
      setExpandedRows((prev) => ({ ...prev, [parent.id]: true }));
      showToast(
        isPendingApproval(data)
          ? `Sub-Type "${trimmedName}" submitted for approval.`
          : subTypeModalMode === 'add'
            ? `Sub-Type "${trimmedName}" added under ${parent.name}.`
            : `Sub-Type "${trimmedName}" updated successfully.`
      );
      setIsSubTypeModalOpen(false);
      await fetchReceiptTypes();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error saving sub-type', 'error');
    }
  };

  // ----------------------------------------------------
  // STATUS TOGGLE HANDLERS (PARTICULAR & SUB-TYPE)
  // ----------------------------------------------------
  const promptToggleTypeStatus = (type) => {
    const newStatus = type.status === 'Active' ? 'Inactive' : 'Active';
    setStatusDialog({
      targetType: 'receiptType',
      item: type,
      parentType: null,
      newStatus
    });
  };

  const promptToggleSubTypeStatus = (parentType, subType) => {
    const newStatus = subType.status === 'Active' ? 'Inactive' : 'Active';
    setStatusDialog({
      targetType: 'subType',
      item: subType,
      parentType,
      newStatus
    });
  };

  const isPendingApproval = (data) => Boolean(data && (data.approval_request_id || data.status === 'PENDING'));

  const handleConfirmStatusToggle = async () => {
    if (!statusDialog) return;
    const { targetType, item, newStatus } = statusDialog;
    const kind = targetType === 'subType' ? 'Sub-Type' : 'Particular';
    try {
      const { data } = await api.put(`/masters/particulars/${item.id}`, { status: newStatus === 'Active' }, { params: { reason: 'Status changed via UI' } });
      showToast(
        isPendingApproval(data)
          ? `Status change for ${kind} "${item.name}" submitted for approval.`
          : `${kind} "${item.name}" set to ${newStatus}.`
      );
      await fetchReceiptTypes();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error updating status', 'error');
    }
    setStatusDialog(null);
  };

  // ----------------------------------------------------
  // DELETE HANDLERS (PARTICULAR & SUB-TYPE)
  // ----------------------------------------------------
  const promptDeleteType = (type) => {
    setDeletingItem({
      targetType: 'receiptType',
      item: type,
      parentType: null
    });
  };

  const promptDeleteSubType = (parentType, subType) => {
    setDeletingItem({
      targetType: 'subType',
      item: subType,
      parentType
    });
  };

  const handleConfirmDelete = async () => {
    if (!deletingItem) return;
    const { targetType, item, parentType } = deletingItem;
    const kind = targetType === 'subType' ? 'Sub-Type' : 'Particular';
    try {
      const { data } = await api.delete(`/masters/particulars/${item.id}`, { params: { reason: 'Deleted via UI' } });
      showToast(
        isPendingApproval(data)
          ? `Delete request for ${kind} "${item.name}" submitted for approval.`
          : targetType === 'subType' && parentType
            ? `Sub-Type "${item.name}" removed from ${parentType.name}.`
            : `Particular "${item.name}" deleted.`
      );
      await fetchReceiptTypes();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error deleting', 'error');
    }
    setDeletingItem(null);
  };

  useSwalConfirm(
    statusDialog,
    () => setStatusDialog(null),
    (d) => ({
      title: `${d.newStatus === 'Inactive' ? 'Deactivate' : 'Activate'} ${d.targetType === 'receiptType' ? 'particular' : 'sub-type'}?`,
      text: `Are you sure you want to mark ${d.item.name} as ${d.newStatus}?`,
      confirmText: d.newStatus === 'Inactive' ? 'Yes, deactivate' : 'Yes, activate',
      danger: d.newStatus === 'Inactive',
    }),
    handleConfirmStatusToggle
  );

  return (
    <PermissionGate required="masters.particulars.read">
    <div className="space-y-6">

      {/* ============================================================ */}
      {/* TOAST NOTIFICATION                                           */}
      {/* ============================================================ */}
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
            <h3 className="text-base font-bold text-[#180200]">
              {toastMessage.type === 'error' ? 'Notice' : 'Success'}
            </h3>
            <p className="text-xs text-[#863221] mt-1.5 leading-relaxed">
              {toastMessage.message}
            </p>
            <button
              onClick={() => setToastMessage(null)}
              className="mt-5 w-full py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              Continue
            </button>
          </div>
        )}
      </Modal>

      {/* Action Bar */}
      <div className="flex items-center justify-end gap-2 -mb-2">
        <FilterToggle open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} count={statusFilter !== 'ALL' ? 1 : 0} />
        {/* The Recently deleted button is hidden (the RecentlyDeleted component is kept to bring it back):
        {hasPermission('masters.particulars.delete') && <RecentlyDeleted kind="particulars" label="particulars" onRestored={fetchReceiptTypes} />}
        */}
        {hasPermission('masters.particulars.write') && (
          <button
            onClick={openAddTypeModal}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm hover:shadow transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Particular</span>
          </button>
        )}
      </div>

      {/* Search and Filters Toolbar Card */}
      {filtersOpen && (
<div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">

            {/* Search Input */}
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
            <div className="flex items-center gap-2.5 flex-wrap">
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
      )}

      {/* Particulars Master Table Card */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-semibold text-[#863221] uppercase tracking-wider">
                <th className="px-5 py-3.5">Particular</th>
                <th className="px-5 py-3.5">Sub-Types</th>
                <th className="px-5 py-3.5 text-center">Status</th>
                <th className="px-5 py-3.5 text-right min-w-[220px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8] text-sm">
              {paginatedData.length > 0 ? (
                paginatedData.map((type, index) => {
                  const hasSubTypes = type.subTypes && type.subTypes.length > 0;
                  const isExpanded = Boolean(expandedRows[type.id]);
                  const isActive = type.status === 'Active';
                  const activeSubTypesCount = hasSubTypes ? type.subTypes.filter(s => s.status === 'Active').length : 0;

                  return (
                    <React.Fragment key={type.id}>
                      {/* Parent Particular Row */}
                      <tr
                        className={`hover:bg-[#FAF7F2]/60 transition-colors group ${isExpanded ? 'bg-[#FAF7F2]/30' : ''} ${dragId === type.id ? 'opacity-40' : ''} ${overId === type.id && dragId !== type.id ? 'border-t-2 border-t-[#510601]' : ''}`}
                        draggable={canReorder}
                        onDragStart={() => canReorder && setDragId(type.id)}
                        onDragOver={(e) => {
                          if (dragId != null) {
                            e.preventDefault();
                            setOverId(type.id);
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          dropType(type.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverId(null);
                        }}
                      >

                        {/* Particular Name + Expand Chevron if sub-types exist */}
                        <td className="px-5 py-4 font-bold text-[#180200]">
                          <div className="flex items-center gap-2.5">
                            {hasSubTypes ? (
                              <button
                                type="button"
                                onClick={() => toggleRowExpansion(type.id)}
                                className="p-1 rounded-md text-[#863221] hover:bg-[#510601]/10 transition-colors cursor-pointer"
                                title={isExpanded ? "Collapse sub-types" : "Expand sub-types"}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-[#510601]" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-[#863221]" />
                                )}
                              </button>
                            ) : (
                              <div className="w-6 h-4" />
                            )}
                            {canReorder && (
                              <GripVertical className="w-4 h-4 text-[#863221]/50 cursor-grab shrink-0" title="Drag to change the order" />
                            )}
                            <span className="text-sm text-[#180200]">{type.name}</span>
                            {type.paysForMembership && (
                              <span className="ml-2 px-1.5 py-0.5 rounded-full bg-[#3D705C]/10 border border-[#3D705C]/30 text-[10px] font-semibold text-[#3D705C]" title="Counts toward a member's membership credit">
                                pays for membership
                              </span>
                            )}
                            {serviceTypes.find((s) => String(s.id) === String(type.serviceTypeId)) && (
                              <span
                                className="ml-2 px-1.5 py-0.5 rounded-full bg-[#510601]/10 border border-[#510601]/20 text-[10px] font-semibold text-[#510601]"
                                title="Service this particular is counted under"
                              >
                                {serviceTypes.find((s) => String(s.id) === String(type.serviceTypeId)).name_en}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Sub-Types Summary Pill */}
                        <td className="px-5 py-4">
                          {hasSubTypes ? (
                            <button
                              type="button"
                              onClick={() => toggleRowExpansion(type.id)}
                              className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-full text-xs font-medium cursor-pointer transition-colors"
                              title="Click to view/hide sub-types"
                            >
                              <Layers className="w-3.5 h-3.5 text-amber-700" />
                              <span>
                                {type.subTypes.length} {type.subTypes.length === 1 ? 'Sub-Type' : 'Sub-Types'} ({activeSubTypesCount} Active)
                              </span>
                            </button>
                          ) : (
                            <span className="text-xs text-[#863221]/50 italic">
                              No Sub-Types
                            </span>
                          )}
                        </td>

                        {/* Status (Active / Inactive Toggle) */}
                        <td className="px-5 py-4 text-center">
                          <button
                            type="button"
                            disabled={!hasPermission('masters.particulars.write')}
                            onClick={() => promptToggleTypeStatus(type)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${isActive
                              ? 'bg-[#3D705C]/10 text-[#3D705C] hover:bg-[#3D705C]/20 border border-[#3D705C]/20'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200'
                              }`}
                            title={!hasPermission('masters.particulars.write') ? 'Requires masters.particulars.write permission' : `Click to set as ${isActive ? 'Inactive' : 'Active'}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-[#3D705C]' : 'bg-gray-400'}`} />
                            <span>{type.status}</span>
                          </button>
                        </td>

                        {/* Action Buttons */}
                        <td className="px-5 py-4 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">

                            {/* Add Sub-Type Button */}
                            {hasPermission('masters.particulars.write') && (
                              <button
                                onClick={() => openAddSubTypeModal(type)}
                                title={`Add Sub-Type under ${type.name}`}
                                className="btn-act"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Sub-Type</span>
                              </button>
                            )}

                            {/* Edit Button */}
                            {hasPermission('masters.particulars.write') && (
                              <button
                                onClick={() => openEditTypeModal(type)}
                                className="btn-act"
                                title={'Edit Particular'}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                <span>Edit</span>
                              </button>
                            )}

                            {/* Delete Button */}
                            {hasPermission('masters.particulars.delete') && (
                              <button
                                onClick={() => promptDeleteType(type)}
                                className="btn-act btn-act-danger"
                                title={'Delete Particular'}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Delete</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Sub-Types Tree View */}
                      {isExpanded && hasSubTypes && (
                        <tr className="bg-[#FAF7F2]/40 border-b border-[#E8DFD8]">
                          <td colSpan="4" className="p-0">
                            <div className="py-3 px-6 sm:px-12 bg-[#FAF7F2]/60 border-y border-[#E8DFD8]/70">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 text-xs font-bold text-[#863221] uppercase tracking-wider">
                                  <Layers className="w-4 h-4 text-[#510601]" />
                                  <span>Sub-Types under {type.name}</span>
                                </div>
                                {hasPermission('masters.particulars.write') && (
                                  <button
                                    type="button"
                                    onClick={() => openAddSubTypeModal(type)}

                                    className="text-xs font-semibold text-[#510601] hover:text-[#8C1801] inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                    <span>Add New Sub-Type</span>
                                  </button>
                                )}
                              </div>

                              <div className="border border-[#E8DFD8] rounded-xl overflow-hidden bg-white shadow-2xs">
                                <table className="w-full text-left text-xs border-collapse">
                                  <thead>
                                    <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[11px] font-semibold text-[#863221] uppercase tracking-wider">
                                      <th className="px-4 py-2.5">Sub-Type Name</th>
                                      <th className="px-4 py-2.5 text-center">Status</th>
                                      <th className="px-4 py-2.5 text-right min-w-[140px]">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[#E8DFD8]">
                                    {type.subTypes.map((sub, sIdx) => {
                                      const isSubActive = sub.status === 'Active';
                                      return (
                                        <tr key={sub.id || sIdx} className="hover:bg-[#FAF7F2]/50 transition-colors">

                                          {/* Sub-Type Name */}
                                          <td className="px-4 py-3 font-semibold text-[#180200]">
                                            <span>{sub.name}</span>
                                          </td>

                                          {/* Sub-Type Status Toggle */}
                                          <td className="px-4 py-3 text-center">
                                            <button
                                              type="button"
                                              disabled={!hasPermission('masters.particulars.write')}
                                              onClick={() => promptToggleSubTypeStatus(type, sub)}
                                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold transition-all cursor-pointer ${isSubActive
                                                ? 'bg-[#3D705C]/10 text-[#3D705C] hover:bg-[#3D705C]/20 border border-[#3D705C]/20'
                                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200'
                                                }`}
                                              title={!hasPermission('masters.particulars.write') ? 'Requires masters.particulars.write permission' : 'Click to toggle status'}
                                            >
                                              <span className={`w-1.5 h-1.5 rounded-full ${isSubActive ? 'bg-[#3D705C]' : 'bg-gray-400'}`} />
                                              <span>{sub.status}</span>
                                            </button>
                                          </td>

                                          {/* Sub-Type Actions */}
                                          <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-1.5">
                                              {hasPermission('masters.particulars.write') && (
                                                <button
                                                  type="button"
                                                  onClick={() => openEditSubTypeModal(type, sub)}
                                                  className="btn-act"
                                                  title={'Edit Sub-Type'}
                                                >
                                                  <Pencil className="w-3.5 h-3.5" />
                                                  <span>Edit</span>
                                                </button>
                                              )}
                                              {hasPermission('masters.particulars.delete') && (
                                                <button
                                                  type="button"
                                                  onClick={() => promptDeleteSubType(type, sub)}
                                                  className="btn-act btn-act-danger"
                                                  title={'Delete Sub-Type'}
                                                >
                                                  <Trash2 className="w-3.5 h-3.5" />
                                                  <span>Delete</span>
                                                </button>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="4" className="px-6 py-12 text-center text-[#863221]">
                    <div className="w-12 h-12 rounded-full bg-[#FAF7F2] text-[#863221]/60 flex items-center justify-center mx-auto mb-3">
                      <FileText className="w-6 h-6" />
                    </div>
                    <p className="font-semibold text-sm text-[#180200]">No particulars found</p>
                    <p className="text-xs text-[#863221]/70 mt-1 max-w-sm mx-auto">
                      {hasActiveFilters
                        ? "Try changing your search or filter criteria."
                        : "No particulars configured yet. Click below to add your first one."}
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
                        hasPermission('masters.particulars.write') && (
                          <button
                            onClick={openAddTypeModal}

                            className="px-4 py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                          >
                            Add Particular
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
              Showing {filteredData.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, filteredData.length)} of {filteredData.length} entries
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
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="p-2 border border-[#E8DFD8] rounded-xl text-[#863221] hover:bg-white hover:text-[#510601] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`min-w-[32px] h-8 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${currentPage === pageNum
                    ? 'bg-[#510601] text-white shadow-sm'
                    : 'bg-white border border-[#E8DFD8] text-[#863221] hover:border-[#510601] hover:text-[#510601]'
                    }`}
                >
                  {pageNum}
                </button>
              ))}
            </div>

            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="p-2 border border-[#E8DFD8] rounded-xl text-[#863221] hover:bg-white hover:text-[#510601] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

      </div>

      {/* ============================================================ */}
      {/* ADD / EDIT PARTICULAR MODAL                                   */}
      {/* ============================================================ */}
      <Modal
        isOpen={isTypeModalOpen}
        onClose={() => setIsTypeModalOpen(false)}
      >
        <div
          className="bg-white rounded-2xl max-w-2xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#180200]">
                  {typeModalMode === 'add' ? 'Add Particular' : 'Edit Particular'}
                </h3>
              </div>
            </div>
            <button
              onClick={() => setIsTypeModalOpen(false)}
              className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSaveType} className="p-6 space-y-4">

            {/* Particular Name */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Particular Name <span className="text-[#ED4636]">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={typeFormData.name}
                onChange={handleTypeFormChange}
                className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-medium text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${typeFormErrors.name
                  ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                  : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                  }`}
              />
              {typeFormErrors.name && (
                <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {typeFormErrors.name}
                </p>
              )}
            </div>

            {/* Service (optional) */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Service
              </label>
              <select
                name="serviceTypeId"
                value={typeFormData.serviceTypeId}
                onChange={handleTypeFormChange}
                className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm font-medium text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
              >
                <option value="">No service</option>
                {serviceTypes.map((s) => (
                  <option key={s.id} value={s.id}>{s.name_en}</option>
                ))}
              </select>
              <p className="text-[11px] text-[#863221]/70 mt-1">
                Optional. Ties this particular to a service (Temple, Mangalya, Hall...) so it is counted on the member profile under Services.
              </p>
            </div>

            {/* What this particular means (set on the main particular; its sub types follow it) */}
            <div className="space-y-2.5 rounded-xl border border-[#E8DFD8] bg-[#FAF7F2]/60 p-3.5">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(typeFormData.paysForMembership)}
                  onChange={(e) => setTypeFormData((prev) => ({ ...prev, paysForMembership: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-[#510601] cursor-pointer"
                />
                <span>
                  <span className="block text-xs font-bold text-[#180200]">Pays for membership</span>
                  <span className="block text-[11px] text-[#863221]/80">The money paid on this particular (and its sub types) counts toward a member's membership credit and type.</span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(typeFormData.needsDescription)}
                  onChange={(e) => setTypeFormData((prev) => ({ ...prev, needsDescription: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-[#510601] cursor-pointer"
                />
                <span>
                  <span className="block text-xs font-bold text-[#180200]">Needs a description</span>
                  <span className="block text-[11px] text-[#863221]/80">Receipt Entry asks what the money is for (a sub type, when this particular has sub types, counts as that description).</span>
                </span>
              </label>
            </div>

            {/* Status Radio */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Status <span className="text-[#ED4636]">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border cursor-pointer font-semibold text-xs transition-all ${typeFormData.status === 'Active'
                  ? 'border-[#3D705C] bg-[#3D705C]/10 text-[#3D705C] ring-1 ring-[#3D705C]'
                  : 'border-[#E8DFD8] bg-white text-gray-700 hover:bg-gray-50'
                  }`}>
                  <input
                    type="radio"
                    name="status"
                    value="Active"
                    checked={typeFormData.status === 'Active'}
                    onChange={handleTypeFormChange}
                    className="hidden"
                  />
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Active</span>
                </label>

                <label className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border cursor-pointer font-semibold text-xs transition-all ${typeFormData.status === 'Inactive'
                  ? 'border-[#ED4636] bg-[#ED4636]/10 text-[#ED4636] ring-1 ring-[#ED4636]'
                  : 'border-[#E8DFD8] bg-white text-gray-700 hover:bg-gray-50'
                  }`}>
                  <input
                    type="radio"
                    name="status"
                    value="Inactive"
                    checked={typeFormData.status === 'Inactive'}
                    onChange={handleTypeFormChange}
                    className="hidden"
                  />
                  <AlertCircle className="w-4 h-4" />
                  <span>Inactive</span>
                </label>
              </div>
            </div>

            {/* Modal Actions */}
            <ModalFooter kind={typeModalMode === 'add' ? 'add' : 'edit'} onCancel={() => setIsTypeModalOpen(false)} inForm />

          </form>
        </div>
      </Modal>

      {/* ============================================================ */}
      {/* ADD / EDIT SUB-TYPE MODAL                                     */}
      {/* ============================================================ */}
      <Modal
        isOpen={isSubTypeModalOpen}
        onClose={() => setIsSubTypeModalOpen(false)}
      >
        <div
          className="bg-white rounded-2xl max-w-2xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#180200]">
                  {subTypeModalMode === 'add' ? 'Add Sub-Type' : 'Edit Sub-Type'}
                </h3>
              </div>
            </div>
            <button
              onClick={() => setIsSubTypeModalOpen(false)}
              className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSaveSubType} className="p-6 space-y-4">

            {/* Sub-Type Name */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Sub-Type Name <span className="text-[#ED4636]">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={subTypeFormData.name}
                onChange={handleSubTypeFormChange}
                className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-medium text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${subTypeFormErrors.name
                  ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                  : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                  }`}
              />
              {subTypeFormErrors.name && (
                <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {subTypeFormErrors.name}
                </p>
              )}
            </div>

            {/* Status Radio */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Status <span className="text-[#ED4636]">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border cursor-pointer font-semibold text-xs transition-all ${subTypeFormData.status === 'Active'
                  ? 'border-[#3D705C] bg-[#3D705C]/10 text-[#3D705C] ring-1 ring-[#3D705C]'
                  : 'border-[#E8DFD8] bg-white text-gray-700 hover:bg-gray-50'
                  }`}>
                  <input
                    type="radio"
                    name="status"
                    value="Active"
                    checked={subTypeFormData.status === 'Active'}
                    onChange={handleSubTypeFormChange}
                    className="hidden"
                  />
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Active</span>
                </label>

                <label className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border cursor-pointer font-semibold text-xs transition-all ${subTypeFormData.status === 'Inactive'
                  ? 'border-[#ED4636] bg-[#ED4636]/10 text-[#ED4636] ring-1 ring-[#ED4636]'
                  : 'border-[#E8DFD8] bg-white text-gray-700 hover:bg-gray-50'
                  }`}>
                  <input
                    type="radio"
                    name="status"
                    value="Inactive"
                    checked={subTypeFormData.status === 'Inactive'}
                    onChange={handleSubTypeFormChange}
                    className="hidden"
                  />
                  <AlertCircle className="w-4 h-4" />
                  <span>Inactive</span>
                </label>
              </div>
            </div>

            {/* Modal Actions */}
            <ModalFooter kind={subTypeModalMode === 'add' ? 'add' : 'edit'} onCancel={() => setIsSubTypeModalOpen(false)} inForm />

          </form>
        </div>
      </Modal>

      

      {/* ============================================================ */}
      {/* DELETE CONFIRMATION DIALOG                                   */}
      {/* ============================================================ */}
      <Modal
        isOpen={Boolean(deletingItem)}
        onClose={() => setDeletingItem(null)}
      >
        {deletingItem && (
          <div
            className="bg-white rounded-2xl max-w-sm w-full border border-[#E8DFD8] shadow-2xl p-6 text-center overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-full bg-red-100 text-[#ED4636] flex items-center justify-center mx-auto mb-3.5">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <h3 className="text-base font-bold text-[#180200]">
              Delete {deletingItem.targetType === 'subType' ? 'Sub-Type' : 'Particular'}?
            </h3>
            <p className="text-xs text-[#863221] mt-1.5 leading-relaxed">
              Are you sure you want to delete <strong className="text-[#180200]">{deletingItem.item.name}</strong>?
              {deletingItem.targetType === 'receiptType' && deletingItem.item.subTypes?.length > 0
                ? ` Its ${deletingItem.item.subTypes.length} sub-type(s) will be deleted too.`
                : ' Historical receipts are preserved.'}
            </p>

            <ModalFooter
              kind="delete"
              onCancel={() => setDeletingItem(null)}
              onSubmit={handleConfirmDelete}
              disabled={!hasPermission('masters.particulars.delete')}
              title={!hasPermission('masters.particulars.delete') ? 'Requires masters.particulars.delete permission' : undefined}
              inForm
            />
          </div>
        )}
      </Modal>

    </div>
    </PermissionGate>
  );
}
