import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal';
import {
  FileText,
  Plus,
  Search,
  Edit3,
  Trash2,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  CheckCircle2,
  X,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Layers
} from 'lucide-react';
import api from '../api';
import useAuth from '../hooks/useAuth';
import PermissionGate from '../components/PermissionGate';

export default function ReceiptTypeManagement() {
  const { hasPermission } = useAuth();

  // Master state
  const [receiptTypes, setReceiptTypes] = useState([]);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Expandable row state (expanded receipt type IDs)
  const [expandedRows, setExpandedRows] = useState({ 3: true }); // Donation expanded by default

  // Modal States - Particular (Add/Edit)
  const [isTypeModalOpen, setIsTypeModalOpen] = useState(false);
  const [typeModalMode, setTypeModalMode] = useState('add'); // 'add' | 'edit'
  const [editingType, setEditingType] = useState(null);
  const [typeFormData, setTypeFormData] = useState({
    name: '',
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
    setToastMessage({ message, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };


  const fetchReceiptTypes = async () => {
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
          status: p.status ? 'Active' : 'Inactive',
          subTypes: subs
        };
      });
      setReceiptTypes(mapped);
    } catch (err) {
      console.error(err);
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

    try {
      if (typeModalMode === 'add') {
        const typeCode = trimmedName.substring(0,3).toUpperCase() + Date.now().toString().slice(-4);
        await api.post('/masters/particulars', {
          code: typeCode,
          name_en: trimmedName,
          status: isActive
        });
        showToast(`Particular "${trimmedName}" created successfully.`);
      } else {
        await api.put(`/masters/particulars/${editingType.id}`, {
          name_en: trimmedName,
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

  const handleSaveSubType = (e) => {
    e.preventDefault();
    if (!validateSubTypeForm()) return;

    const trimmedName = subTypeFormData.name.trim();
    const parentId = parentTypeForSubType.id;

    const updated = receiptTypes.map(rt => {
      if (rt.id === parentId) {
        const subTypes = rt.subTypes ? [...rt.subTypes] : [];
        if (subTypeModalMode === 'add') {
          const maxSubTypeId = subTypes.length > 0 ? Math.max(...subTypes.map(s => Number(s.id) || 0)) : parentId * 100;
          const nextSubId = maxSubTypeId + 1;
          const newSubType = {
            id: nextSubId,
            name: trimmedName,
            status: subTypeFormData.status
          };
          return {
            ...rt,
            subTypes: [...subTypes, newSubType]
          };
        } else {
          const updatedSubTypes = subTypes.map(st => {
            if (st.id === editingSubType.id) {
              return {
                ...st,
                name: trimmedName,
                status: subTypeFormData.status
              };
            }
            return st;
          });
          return {
            ...rt,
            subTypes: updatedSubTypes
          };
        }
      }
      return rt;
    });

    persistReceiptTypes(updated);
    // Ensure parent row is expanded so user sees the newly added/edited sub-type
    setExpandedRows(prev => ({ ...prev, [parentId]: true }));

    showToast(
      subTypeModalMode === 'add'
        ? `Sub-Type "${trimmedName}" added under ${parentTypeForSubType.name}.`
        : `Sub-Type "${trimmedName}" updated successfully.`
    );
    setIsSubTypeModalOpen(false);
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
      const { data } = await api.put(`/masters/particulars/${item.id}`, { status: newStatus === 'Active' });
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
      const { data } = await api.delete(`/masters/particulars/${item.id}`);
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

  return (
    <PermissionGate required="masters.read">
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

      {/* Breadcrumb & Header */}
      <div>
<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#180200] tracking-tight">
              Particulars Master
            </h1>
          </div>

          <button
            onClick={openAddTypeModal}
            disabled={!hasPermission('masters.write')}
            title={!hasPermission('masters.write') ? 'Requires masters.write permission' : undefined}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm hover:shadow transition-all cursor-pointer self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Add Particular</span>
          </button>
        </div>
      </div>

      {/* Search and Filters Toolbar Card */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">

            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#863221]/50" />
              <input
                type="text"
                placeholder="Search particular or sub-type..."
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

      {/* Particulars Master Table Card */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-semibold text-[#863221] uppercase tracking-wider">
                <th className="px-5 py-3.5 w-12 text-center"></th>
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
                      <tr className={`hover:bg-[#FAF7F2]/60 transition-colors group ${isExpanded ? 'bg-[#FAF7F2]/30' : ''}`}>

                        {/* Number Index */}
                        <td className="px-5 py-4 text-xs font-bold text-[#863221]/70 text-center">
                          {(currentPage - 1) * pageSize + index + 1}
                        </td>

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
                            <span className="text-sm text-[#180200]">{type.name}</span>
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
                            disabled={!hasPermission('masters.write')}
                            onClick={() => promptToggleTypeStatus(type)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${isActive
                              ? 'bg-[#3D705C]/10 text-[#3D705C] hover:bg-[#3D705C]/20 border border-[#3D705C]/20'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200'
                              }`}
                            title={!hasPermission('masters.write') ? 'Requires masters.write permission' : `Click to set as ${isActive ? 'Inactive' : 'Active'}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-[#3D705C]' : 'bg-gray-400'}`} />
                            <span>{type.status}</span>
                          </button>
                        </td>

                        {/* Action Buttons */}
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5 flex-nowrap">

                            {/* Add Sub-Type Button */}
                            <button
                              onClick={() => openAddSubTypeModal(type)}
                              disabled={!hasPermission('masters.write')}
                              title={!hasPermission('masters.write') ? 'Requires masters.write permission' : `Add Sub-Type under ${type.name}`}
                              className="px-2.5 py-1 text-[#510601] hover:text-white bg-[#510601]/10 hover:bg-[#510601] border border-[#510601]/20 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Sub-Type</span>
                            </button>

                            {/* Edit Button */}
                            <button
                              onClick={() => openEditTypeModal(type)}
                              disabled={!hasPermission('masters.write')}
                              className="px-2.5 py-1 text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer"
                              title={!hasPermission('masters.write') ? 'Requires masters.write permission' : 'Edit Particular'}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Edit</span>
                            </button>

                            {/* Delete Button */}
                            <button
                              onClick={() => promptDeleteType(type)}
                              disabled={!hasPermission('masters.delete')}
                              className="px-2.5 py-1 text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer"
                              title={!hasPermission('masters.delete') ? 'Requires masters.delete permission' : 'Delete Particular'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Sub-Types Tree View */}
                      {isExpanded && hasSubTypes && (
                        <tr className="bg-[#FAF7F2]/40 border-b border-[#E8DFD8]">
                          <td colSpan="5" className="p-0">
                            <div className="py-3 px-6 sm:px-12 bg-[#FAF7F2]/60 border-y border-[#E8DFD8]/70">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 text-xs font-bold text-[#863221] uppercase tracking-wider">
                                  <Layers className="w-4 h-4 text-[#510601]" />
                                  <span>Sub-Types under {type.name}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => openAddSubTypeModal(type)}
                                  disabled={!hasPermission('masters.write')}
                                  title={!hasPermission('masters.write') ? 'Requires masters.write permission' : undefined}
                                  className="text-xs font-semibold text-[#510601] hover:text-[#8C1801] inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Add New Sub-Type</span>
                                </button>
                              </div>

                              <div className="border border-[#E8DFD8] rounded-xl overflow-hidden bg-white shadow-2xs">
                                <table className="w-full text-left text-xs border-collapse">
                                  <thead>
                                    <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[11px] font-semibold text-[#863221] uppercase tracking-wider">
                                      <th className="px-4 py-2.5 w-12 text-center"></th>
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

                                          {/* Sub-Type Number */}
                                          <td className="px-4 py-3 text-center text-[#863221]/70 font-mono">
                                            {sIdx + 1}
                                          </td>

                                          {/* Sub-Type Name */}
                                          <td className="px-4 py-3 font-semibold text-[#180200]">
                                            <span>{sub.name}</span>
                                          </td>

                                          {/* Sub-Type Status Toggle */}
                                          <td className="px-4 py-3 text-center">
                                            <button
                                              type="button"
                                              disabled={!hasPermission('masters.write')}
                                              onClick={() => promptToggleSubTypeStatus(type, sub)}
                                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold transition-all cursor-pointer ${isSubActive
                                                ? 'bg-[#3D705C]/10 text-[#3D705C] hover:bg-[#3D705C]/20 border border-[#3D705C]/20'
                                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200'
                                                }`}
                                              title={!hasPermission('masters.write') ? 'Requires masters.write permission' : 'Click to toggle status'}
                                            >
                                              <span className={`w-1.5 h-1.5 rounded-full ${isSubActive ? 'bg-[#3D705C]' : 'bg-gray-400'}`} />
                                              <span>{sub.status}</span>
                                            </button>
                                          </td>

                                          {/* Sub-Type Actions */}
                                          <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-1.5">
                                              <button
                                                type="button"
                                                onClick={() => openEditSubTypeModal(type, sub)}
                                                disabled={!hasPermission('masters.write')}
                                                className="px-2 py-0.5 text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 cursor-pointer"
                                                title={!hasPermission('masters.write') ? 'Requires masters.write permission' : 'Edit Sub-Type'}
                                              >
                                                <Edit3 className="w-3 h-3" />
                                                <span>Edit</span>
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => promptDeleteSubType(type, sub)}
                                                disabled={!hasPermission('masters.delete')}
                                                className="px-2 py-0.5 text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 cursor-pointer"
                                                title={!hasPermission('masters.delete') ? 'Requires masters.delete permission' : 'Delete Sub-Type'}
                                              >
                                                <Trash2 className="w-3 h-3" />
                                                <span>Delete</span>
                                              </button>
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
                  <td colSpan="5" className="px-6 py-12 text-center text-[#863221]">
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
                        <button
                          onClick={openAddTypeModal}
                          disabled={!hasPermission('masters.write')}
                          title={!hasPermission('masters.write') ? 'Requires masters.write permission' : undefined}
                          className="px-4 py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                        >
                          Add Particular
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
          className="bg-white rounded-2xl max-w-md w-full border border-[#E8DFD8] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2]">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#180200]">
                  {typeModalMode === 'add' ? 'Add Particular' : 'Edit Particular'}
                </h3>
                <p className="text-xs text-[#863221]">
                  {typeModalMode === 'add' ? 'Create a new particular category.' : `Editing "${editingType?.name}"`}
                </p>
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
                placeholder="e.g. Donation, Cultural Events, Hostel Payment"
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
            <div className="pt-3 flex items-center justify-end gap-3 border-t border-[#E8DFD8]">
              <button
                type="button"
                onClick={() => setIsTypeModalOpen(false)}
                className="px-4 py-2.5 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs font-bold rounded-xl shadow-sm hover:shadow transition-all cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{typeModalMode === 'add' ? 'Create Particular' : 'Save Changes'}</span>
              </button>
            </div>

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
          className="bg-white rounded-2xl max-w-md w-full border border-[#E8DFD8] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2]">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#180200]">
                  {subTypeModalMode === 'add' ? 'Add Sub-Type' : 'Edit Sub-Type'}
                </h3>
                <p className="text-xs text-[#863221]">
                  Under Parent Category: <strong className="text-[#510601]">{parentTypeForSubType?.name}</strong>
                </p>
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
                placeholder="e.g. Building Fund, Vidya Prothsaha Nidhi"
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
            <div className="pt-3 flex items-center justify-end gap-3 border-t border-[#E8DFD8]">
              <button
                type="button"
                onClick={() => setIsSubTypeModalOpen(false)}
                className="px-4 py-2.5 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs font-bold rounded-xl shadow-sm hover:shadow transition-all cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{subTypeModalMode === 'add' ? 'Add Sub-Type' : 'Save Changes'}</span>
              </button>
            </div>

          </form>
        </div>
      </Modal>

      {/* ============================================================ */}
      {/* DELETE CONFIRMATION MODAL                                    */}
      {/* ============================================================ */}
      <Modal
        isOpen={Boolean(deletingItem)}
        onClose={() => setDeletingItem(null)}
      >
        {deletingItem && (
          <div
            className="bg-white rounded-2xl max-w-md w-full border border-[#E8DFD8] shadow-2xl p-6 text-center animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-full bg-red-100 text-[#ED4636] flex items-center justify-center mx-auto mb-3.5">
              <Trash2 className="w-7 h-7" />
            </div>

            <h3 className="text-lg font-bold text-[#180200]">
              Delete {deletingItem.targetType === 'receiptType' ? 'Particular' : 'Sub-Type'}?
            </h3>
            <p className="text-xs text-[#863221] mt-1.5 leading-relaxed">
              Are you sure you want to delete <strong className="text-[#180200]">{deletingItem.item.name}</strong>
              {deletingItem.targetType === 'subType' && deletingItem.parentType ? ` from ${deletingItem.parentType.name}` : ''}?
              {deletingItem.targetType === 'receiptType' && deletingItem.item.subTypes?.length > 0
                ? ' This will also remove all associated sub-types.'
                : ' This action cannot be undone.'}
            </p>

            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setDeletingItem(null)}
                className="w-full py-2.5 px-4 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!hasPermission('masters.delete')}
                title={!hasPermission('masters.delete') ? 'Requires masters.delete permission' : undefined}
                onClick={handleConfirmDelete}
                className="w-full py-2.5 px-4 bg-[#ED4636] hover:bg-[#C93324] text-white text-xs font-bold rounded-xl shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Confirm Delete</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ============================================================ */}
      {/* STATUS TOGGLE CONFIRMATION DIALOG                            */}
      {/* ============================================================ */}
      <Modal
        isOpen={Boolean(statusDialog)}
        onClose={() => setStatusDialog(null)}
      >
        {statusDialog && (
          <div
            className="bg-white rounded-2xl max-w-sm w-full border border-[#E8DFD8] shadow-2xl p-6 text-center animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3.5 ${statusDialog.newStatus === 'Inactive' ? 'bg-red-100 text-[#ED4636]' : 'bg-[#3D705C]/10 text-[#3D705C]'
              }`}>
              {statusDialog.newStatus === 'Inactive' ? (
                <AlertTriangle className="w-7 h-7" />
              ) : (
                <CheckCircle2 className="w-7 h-7" />
              )}
            </div>

            <h3 className="text-base font-bold text-[#180200]">
              {statusDialog.newStatus === 'Inactive' ? 'Deactivate' : 'Activate'} {statusDialog.targetType === 'receiptType' ? 'Particular' : 'Sub-Type'}?
            </h3>
            <p className="text-xs text-[#863221] mt-1.5 leading-relaxed">
              Are you sure you want to mark <strong className="text-[#180200]">{statusDialog.item.name}</strong> as <span className="font-bold">{statusDialog.newStatus}</span>?
              {statusDialog.newStatus === 'Inactive'
                ? ' Inactive particulars will no longer appear when creating new receipts, but historical receipts are preserved.'
                : ' Active particulars will be immediately available in the Receipt Entry form.'}
            </p>

            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setStatusDialog(null)}
                className="w-full py-2.5 px-4 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!hasPermission('masters.write')}
                title={!hasPermission('masters.write') ? 'Requires masters.write permission' : undefined}
                onClick={handleConfirmStatusToggle}
                className={`w-full py-2.5 px-4 text-white text-xs font-semibold rounded-xl shadow-sm transition-colors cursor-pointer ${statusDialog.newStatus === 'Inactive'
                  ? 'bg-[#ED4636] hover:bg-[#C93324]'
                  : 'bg-[#3D705C] hover:bg-[#2F5647]'
                  }`}
              >
                {statusDialog.newStatus === 'Inactive' ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        )}
      </Modal>

    </div>
    </PermissionGate>
  );
}
