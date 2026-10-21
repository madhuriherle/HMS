import FilterToggle from '../components/FilterToggle';
import React, { useState, useMemo, useEffect } from 'react';
import Modal from '../components/Modal';
import {
  Plus,
  Search,
  Pencil,
  Eye,
  Trash2,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  X,
  AlertCircle,
  RefreshCw,
  Check,
  SlidersHorizontal,
} from 'lucide-react';
import api from '../api';
import { notify } from '../utils/notify';
import { formatPaymentModeLabel } from '../utils/displayHelpers';
import useAuth from '../hooks/useAuth';
import useSwalConfirm from '../hooks/useSwalConfirm';
import PermissionGate from '../components/PermissionGate';

import ModalFooter from '../components/ModalFooter';
export default function BankDetailsManagement() {
  const { hasPermission } = useAuth();

  // Master state
  const [paymentConfigs, setPaymentConfigs] = useState([]);
  const [banks, setBanks] = useState([]);

  // Dropdown options and bank details come from the Bank master / existing payment modes
  const AVAILABLE_BANK_ACCOUNTS = useMemo(() => [...new Set(banks.map((b) => b.name_en))], [banks]);
  const AVAILABLE_PAYMENT_MODES = useMemo(
    () => [...new Set(paymentConfigs.map((c) => c.paymentMode).filter(Boolean))],
    [paymentConfigs]
  );

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'Active' | 'Inactive'

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Copied helper
  const [] = useState(null);

  // Modal States
  const [isAddEditOpen, setIsAddEditOpen] = useState(false);
  const [modalMode, setModalMode] = useState('add'); // 'add' | 'edit'
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({
    paymentMode: '',
    customPaymentMode: '',
    paymentType: 'Online',
    bankAccount: '',
    customBankAccount: '',
    branch: '',
    ifscCode: '',
    accountNumber: '',
    status: 'Active'
  });
  const [formErrors, setFormErrors] = useState({});

  // View Details Modal State
  const [viewingItem, setViewingItem] = useState(null);

  // Status Toggle Confirmation Dialog State
  const [statusDialog, setStatusDialog] = useState(null); // { item, newStatus }
  const [deleteDialog, setDeleteDialog] = useState(null); // payment mode to delete

  // Toast / Feedback State
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (message, type = 'success') => {
    notify(message, type);
  };


  const fetchConfigs = async () => {
    try {
      const [banksRes, modesRes] = await Promise.all([
        api.get('/masters/banks?limit=1000'),
        api.get('/masters/payment-modes?limit=1000')
      ]);
      const banks = banksRes.data?.data || [];
      setBanks(banks);
      const modes = Array.isArray(modesRes.data) ? modesRes.data : (modesRes.data?.data || []);
      const mapped = modes.map(m => {
        const bank = banks.find(b => b.id === m.bank_id);
        return {
          id: m.id,
          paymentMode: m.payment_mode,
          paymentType: m.payment_type,
          bankAccount: bank ? bank.name_en : '',
          branch: bank ? bank.branch_name : '',
          ifscCode: bank ? bank.ifsc_code : '',
          accountNumber: bank ? bank.account_number : '',
          status: m.status ? 'Active' : 'Inactive'
        };
      });
      setPaymentConfigs(mapped);
    } catch(err) {
      console.error(err); showToast(err.response?.data?.detail || 'Could not load data from the server.', 'error');
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);



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
    return paymentConfigs.filter((item) => {
      const q = searchQuery.toLowerCase().trim();
      const label = formatPaymentModeLabel(item).toLowerCase();
      const mode = (item.paymentMode || '').toLowerCase();
      const bank = (item.bankAccount || '').toLowerCase();
      const branch = (item.branch || '').toLowerCase();
      const ifsc = (item.ifscCode || '').toLowerCase();
      const acc = (item.accountNumber || '').toLowerCase();

      const matchSearch =
        !q ||
        label.includes(q) ||
        mode.includes(q) ||
        bank.includes(q) ||
        branch.includes(q) ||
        ifsc.includes(q) ||
        acc.includes(q);

      const matchStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'Active' && (item.status || 'Active') === 'Active') ||
        (statusFilter === 'Inactive' && item.status === 'Inactive');

      return matchSearch && matchStatus;
    });
  }, [paymentConfigs, searchQuery, statusFilter]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredData.length / pageSize) || 1;
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, currentPage, pageSize]);


  // ----------------------------------------------------
  // ADD / EDIT MODAL HANDLERS
  // ----------------------------------------------------
  const openAddModal = () => {
    setModalMode('add');
    setEditingItem(null);
    setFormData({
      paymentMode: '',
      customPaymentMode: '',
      paymentType: 'Online',
      bankAccount: '',
      customBankAccount: '',
      branch: '',
      ifscCode: '',
      accountNumber: '',
      status: 'Active'
    });
    setFormErrors({});
    setIsAddEditOpen(true);
  };

  const openEditModal = (config) => {
    setModalMode('edit');
    setEditingItem(config);
    setFormData({
      paymentMode: config.paymentMode || '',
      customPaymentMode: '',
      paymentType: config.paymentType || (config.paymentMode === 'Cash' ? 'Offline' : 'Online'),
      bankAccount: config.bankAccount || '',
      customBankAccount: '',
      branch: config.branch || '',
      ifscCode: config.ifscCode || '',
      accountNumber: config.accountNumber || '',
      status: config.status || 'Active'
    });
    setFormErrors({});
    setIsAddEditOpen(true);
  };

  const isOfflineMode = (mode) => ['cash', 'cheque', 'dd'].includes((mode || '').trim().toLowerCase());

  const handlePaymentModeChange = (e) => {
    const val = e.target.value;
    setFormData((prev) => ({
      ...prev,
      paymentMode: val,
      paymentType: isOfflineMode(val) ? 'Offline' : 'Online',
      bankAccount: isOfflineMode(val) ? '' : prev.bankAccount
    }));
    if (formErrors.paymentMode) {
      setFormErrors((prev) => ({ ...prev, paymentMode: '' }));
    }
  };

  const handleBankAccountChange = (e) => {
    setFormData((prev) => ({ ...prev, bankAccount: e.target.value }));
    if (formErrors.bankAccount) {
      setFormErrors((prev) => ({ ...prev, bankAccount: '' }));
    }
  };


  // Preview what the display label will be
  const previewLabel = useMemo(() => {
    const effectiveMode =
      formData.paymentMode === '__CUSTOM__'
        ? formData.customPaymentMode.trim()
        : formData.paymentMode;
    const isOffline = formData.paymentMode === 'Cash' || formData.paymentMode === 'Cheque' || formData.paymentMode === 'DD' || formData.paymentType === 'Offline';
    const effectiveBank = isOffline
      ? ''
      : formData.bankAccount === '__CUSTOM__'
        ? formData.customBankAccount.trim()
        : formData.bankAccount;

    if (!effectiveMode) return '—';
    if (isOffline || !effectiveBank) {
      return effectiveMode;
    }
    return effectiveBank;
  }, [formData]);

  const validateForm = () => {
    const errors = {};
    const effectiveMode =
      formData.paymentMode === '__CUSTOM__'
        ? formData.customPaymentMode.trim()
        : formData.paymentMode.trim();

    if (!effectiveMode) {
      errors.paymentMode = 'Payment Mode is mandatory.';
    }

    const isOffline = effectiveMode.toLowerCase() === 'cash' || effectiveMode.toLowerCase() === 'cheque' || effectiveMode.toLowerCase() === 'dd';
    const effectiveBank = isOffline
      ? ''
      : formData.bankAccount === '__CUSTOM__'
        ? formData.customBankAccount.trim()
        : (formData.bankAccount || '').trim();

    if (!isOffline) {
      if (!effectiveBank) {
        errors.bankAccount = 'Bank Account is mandatory for Online payment mode.';
      }
    }

    // Check duplicate configuration (same Payment Mode + Bank Account)
    const isDuplicate = paymentConfigs.some((cfg) => {
      if (editingItem && cfg.id === editingItem.id) return false;
      const cfgBank = (cfg.bankAccount || '').trim().toLowerCase();
      const currentBank = effectiveBank.toLowerCase();
      const cfgMode = (cfg.paymentMode || '').trim().toLowerCase();
      const currentMode = effectiveMode.toLowerCase();

      return cfgMode === currentMode && cfgBank === currentBank;
    });

    if (isDuplicate) {
      errors.paymentMode = `A configuration for "${previewLabel}" already exists.`;
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveForm = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    const effectiveMode =
      formData.paymentMode === '__CUSTOM__'
        ? formData.customPaymentMode.trim()
        : formData.paymentMode.trim();

    const isOffline = effectiveMode.toLowerCase() === 'cash' || effectiveMode.toLowerCase() === 'cheque' || effectiveMode.toLowerCase() === 'dd';
    const effectiveBank = isOffline
      ? ''
      : formData.bankAccount === '__CUSTOM__'
        ? formData.customBankAccount.trim()
        : (formData.bankAccount || '').trim();

    const paymentType = isOffline ? 'Offline' : 'Online';

    try {
      let finalBankId = null;
      if (!isOffline && effectiveBank) {
        const banksRes = await api.get('/masters/banks?limit=1000');
        const banks = banksRes.data?.data || [];
        const norm = (v) => String(v || '').trim().toLowerCase();
        let bank = banks.find((b) => norm(b.name_en) === norm(effectiveBank));

        if (!bank) {
          const newBankRes = await api.post('/masters/banks', { name_en: effectiveBank });
          finalBankId = newBankRes.data.id;
        } else {
          finalBankId = bank.id;
        }
      }

      const payload = {
        payment_mode: effectiveMode,
        payment_type: paymentType,
        bank_id: finalBankId,
        status: formData.status === 'Active'
      };

      if (modalMode === 'add') {
        await api.post('/masters/payment-modes', payload);
        showToast('Payment Mode added successfully.');
      } else {
        await api.put(`/masters/payment-modes/${editingItem.id}`, payload);
        showToast('Payment Mode updated successfully.');
      }
      
      setIsAddEditOpen(false);
      fetchConfigs();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error saving configuration', 'error');
    }
  };

  const isPendingApproval = (data) => Boolean(data && (data.approval_request_id || data.status === 'PENDING'));


  const handleDeleteClick = (cfg) => {
    setDeleteDialog(cfg); // the server warns (and offers "delete anyway") if receipts use it
  };

  const handleToggleStatusClick = (config) => {
    setStatusDialog({ item: config, newStatus: config.status === 'Active' ? 'Inactive' : 'Active' });
  };

  const confirmDelete = async () => {
    if (!deleteDialog) return;
    const label = formatPaymentModeLabel(deleteDialog);
    try {
      const { data } = await api.delete(`/masters/payment-modes/${deleteDialog.id}`);
      showToast(
        isPendingApproval(data)
          ? `Delete request for "${label}" submitted for approval.`
          : `"${label}" deleted. Existing receipts keep the mode they were recorded with.`
      );
      await fetchConfigs();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error deleting payment mode', 'error');
    }
    setDeleteDialog(null);
  };

  const confirmStatusToggle = async () => {
    if (!statusDialog) return;
    const { item, newStatus } = statusDialog;
    const label = formatPaymentModeLabel(item);
    try {
      const { data } = await api.put(`/masters/payment-modes/${item.id}`, { status: newStatus === 'Active' }, { params: { reason: 'Status changed via UI' } });
      showToast(
        isPendingApproval(data)
          ? `Status change for "${label}" submitted for approval.`
          : `"${label}" status changed to ${newStatus}.${newStatus === 'Inactive'
            ? ' It will no longer appear for new receipts, but existing historical receipts remain intact.'
            : ' It is now available for selection in new receipts.'
          }`
      );
      await fetchConfigs();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error updating status', 'error');
    }
    setStatusDialog(null);
  };

  useSwalConfirm(
    statusDialog,
    () => setStatusDialog(null),
    (d) => ({
      title: `${d.newStatus === 'Inactive' ? 'Deactivate' : 'Activate'} payment mode?`,
      text: `Are you sure you want to mark ${formatPaymentModeLabel(d.item)} as ${d.newStatus}?`,
      confirmText: d.newStatus === 'Inactive' ? 'Yes, deactivate' : 'Yes, activate',
      danger: d.newStatus === 'Inactive',
    }),
    confirmStatusToggle
  );

  useSwalConfirm(
    deleteDialog,
    () => setDeleteDialog(null),
    (d) => ({
      title: 'Delete payment mode?',
      text: `"${formatPaymentModeLabel(d)}" will be removed from the Payment Mode dropdown. Receipts already recorded with it are not changed.`,
      confirmText: 'Yes, delete',
      danger: true,
    }),
    confirmDelete
  );

  return (
    <PermissionGate required="masters.payment_modes.read">
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium ${toastMessage.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-[#FAF7F2] border-[#8C1801]/30 text-[#180200]'
              }`}
          >
            {toastMessage.type === 'error' ? (
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-[#3D705C] shrink-0" />
            )}
            <span>{toastMessage.message}</span>
            <button
              onClick={() => setToastMessage(null)}
              className="ml-2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Action row: the filter icon, and Add Payment Mode when this login may write */}
      <div className="flex items-center justify-end gap-2 -mb-2">
        <FilterToggle open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} count={statusFilter !== 'ALL' ? 1 : 0} />
        {hasPermission('masters.payment_modes.write') && (
          <button
            onClick={openAddModal}
            id="btn-add-payment-mode"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#510601] hover:bg-[#3D0400] active:bg-[#200200] text-white text-xs sm:text-sm font-bold rounded-xl shadow-sm hover:shadow transition-all duration-200 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Payment Mode</span>
          </button>
        )}
      </div>

      {/* Search & Filter Card */}
      {filtersOpen && (
<div className="bg-white border border-[#E8DFD8] rounded-2xl shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] p-4 sm:p-5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-[#863221]/60 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-9 pr-4 py-2 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-xs sm:text-sm text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-all shadow-2xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

                        {/* Status Filter */}
            <div className="flex items-center gap-2 shrink-0">
              <label className="text-xs font-bold text-[#863221] whitespace-nowrap">
                Status:
              </label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-3 py-2 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-xs font-semibold text-[#180200] focus:outline-none cursor-pointer"
              >
                <option value="ALL">All Status</option>
                <option value="Active">Active Only</option>
                <option value="Inactive">Inactive Only</option>
              </select>
            </div>

            {/* Clear Filter Button */}
            {hasActiveFilters && (
              <button
                onClick={handleClearFilters}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#863221] hover:text-[#510601] hover:bg-[#FAF7F2] rounded-xl border border-dashed border-[#E8DFD8] transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
                        </div>

          <div className="text-xs font-semibold text-[#863221] self-end sm:self-auto">
            Showing <span className="text-[#180200]">{filteredData.length}</span> payment modes
          </div>
      </div>
      )}

      {/* Main Table Card Container */}
      <div className="bg-white border border-[#E8DFD8] rounded-2xl shadow-sm overflow-hidden">
        {/* Configurations Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E8DFD8] bg-[#FAF7F2] text-[11px] font-bold text-[#863221] uppercase tracking-wider">
                <th className="py-3.5 px-4 sm:px-6">Payment Mode</th>
                <th className="py-3.5 px-4 sm:px-6">Receipt Dropdown Preview</th>
                <th className="py-3.5 px-4 sm:px-6 text-center">Status</th>
                <th className="py-3.5 px-4 sm:px-6 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8] text-xs sm:text-sm text-[#180200]">
              {paginatedData.length > 0 ? (
                paginatedData.map((config) => {
                  const isActive = (config.status || 'Active') === 'Active';
                  const displayLabel = formatPaymentModeLabel(config);

                  return (
                    <tr
                      key={config.id}
                      className="hover:bg-[#FAF7F2]/60 transition-colors group"
                    >
                      {/* Column: Payment Mode */}
                      <td className="py-4 px-4 sm:px-6">
                        <span className="font-black text-[#180200] text-sm font-serif">
                          {config.paymentMode}
                        </span>
                      </td>

                      {/* Column: Display in Receipts */}
                      <td className="py-4 px-4 sm:px-6">
                        <span className="inline-flex items-center gap-1.5 font-bold text-xs bg-[#FAF7F2] px-3 py-1.5 rounded-xl border border-[#E8DFD8] text-[#510601]">
                          {displayLabel}
                        </span>
                      </td>

                      {/* Column: Status */}
                      <td className="py-4 px-4 sm:px-6 text-center">
                        <button
                          type="button"
                          disabled={!hasPermission('masters.payment_modes.write')}
                          onClick={() => handleToggleStatusClick(config)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-all cursor-pointer ${isActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                            }`}
                          title={!hasPermission('masters.payment_modes.write') ? 'Requires masters.payment_modes.write permission' : `Click to change status to ${isActive ? 'Inactive' : 'Active'}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-gray-400'}`}
                          />
                          <span>{isActive ? 'Active' : 'Inactive'}</span>
                        </button>
                      </td>

                      {/* Column: Actions */}
                      <td className="py-4 px-4 sm:px-6 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* View Button */}
                          <button
                            type="button"
                            onClick={() => setViewingItem(config)}
                            className="btn-act"
                            title="View Configuration Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View</span>
                          </button>

                          {/* Edit Button */}
                          {hasPermission('masters.payment_modes.write') && (
                            <button
                              type="button"
                              onClick={() => openEditModal(config)}
                              className="btn-act"
                              title={'Edit Payment Mode'}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>Edit</span>
                            </button>
                          )}

                          {/* Delete Button */}
                          {hasPermission('masters.payment_modes.delete') && (
                            <button
                              type="button"
                              onClick={() => handleDeleteClick(config)}
                              className="btn-act btn-act-danger"
                              title={'Delete Payment Mode'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={4} className="py-12 px-6 text-center text-gray-500">
                    <div className="max-w-xs mx-auto flex flex-col items-center">
                      <div className="w-12 h-12 rounded-full bg-[#FAF7F2] border border-[#E8DFD8] flex items-center justify-center text-[#863221] mb-3">
                        <SlidersHorizontal className="w-6 h-6" />
                      </div>
                      <h4 className="text-sm font-bold text-[#180200] mb-1">
                        No Payment Modes Found
                      </h4>
                      <p className="text-xs text-[#863221]/70 mb-4">
                        {hasActiveFilters
                          ? 'No payment modes match your current search and filter criteria.'
                          : 'No payment modes have been configured yet.'}
                      </p>
                      {hasActiveFilters ? (
                        <button
                          onClick={handleClearFilters}
                          className="px-4 py-2 bg-white border border-[#E8DFD8] text-xs font-semibold text-[#510601] rounded-xl hover:bg-[#FAF7F2] transition-colors"
                        >
                          Clear Filters
                        </button>
                      ) : (
                        hasPermission('masters.payment_modes.write') && (
                          <button
                            onClick={openAddModal}

                            className="px-4 py-2 bg-[#510601] text-white text-xs font-bold rounded-xl hover:bg-[#3D0400] transition-colors"
                          >
                            + Add First Payment Mode
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

        {/* Pagination Footer */}
        {filteredData.length > 0 && (
          <div className="p-4 border-t border-[#E8DFD8] bg-[#FAF7F2] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#863221]">
            <div className="flex items-center gap-2">
              <span>Show</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-2 py-1 bg-white border border-[#E8DFD8] rounded-lg text-xs font-semibold text-[#180200] focus:outline-none"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
              <span>per page</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span>
                Page <span className="font-bold text-[#180200]">{currentPage}</span> of{' '}
                <span className="font-bold text-[#180200]">{totalPages}</span>
              </span>

              <div className="flex items-center gap-1 ml-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="p-1.5 rounded-lg border border-[#E8DFD8] bg-white text-[#180200] hover:bg-[#FAF7F2] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="p-1.5 rounded-lg border border-[#E8DFD8] bg-white text-[#180200] hover:bg-[#FAF7F2] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ====================================================================== */}
      {/* MODAL 1: ADD / EDIT PAYMENT MODE CONFIGURATION */}
      {/* ====================================================================== */}
      <Modal
        isOpen={isAddEditOpen}
        onClose={() => setIsAddEditOpen(false)}
        className="p-4"
      >
        <div className="bg-white rounded-2xl shadow-xl border border-[#E8DFD8] w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
          {/* Modal Header */}
          <div className="px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-between shrink-0">
            <div>
              <h3 className="text-lg font-bold text-[#180200] font-serif">
                {modalMode === 'add' ? 'Add Payment Mode' : 'Edit Payment Mode'}
              </h3>
            </div>
            <button
              onClick={() => setIsAddEditOpen(false)}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Modal Form */}
          <form onSubmit={handleSaveForm} className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* Field: Payment Mode */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Payment Mode <span className="text-[#ED4636]">*</span>
              </label>
              <input
                type="text"
                name="paymentMode"
                list="payment-mode-options"
                value={formData.paymentMode}
                onChange={handlePaymentModeChange}
                className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm text-[#180200] focus:outline-none"
              />
              <datalist id="payment-mode-options">
                {AVAILABLE_PAYMENT_MODES.map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
              {formErrors.paymentMode && (
                <p className="mt-1 text-xs text-red-600 flex items-center gap-1 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{formErrors.paymentMode}</span>
                </p>
              )}
            </div>

            {/* Field: Bank Account (not for Cash / Cheque / DD) */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Bank Account {!isOfflineMode(formData.paymentMode) && <span className="text-[#ED4636]">*</span>}
              </label>
              <input
                type="text"
                name="bankAccount"
                list="bank-account-options"
                value={formData.bankAccount}
                onChange={handleBankAccountChange}
                disabled={isOfflineMode(formData.paymentMode)}
                className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm text-[#180200] focus:outline-none disabled:bg-[#FAF7F2] disabled:cursor-not-allowed"
              />
              <datalist id="bank-account-options">
                {AVAILABLE_BANK_ACCOUNTS.map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
              {formErrors.bankAccount && (
                <p className="mt-1 text-xs text-red-600 flex items-center gap-1 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{formErrors.bankAccount}</span>
                </p>
              )}
            </div>

            {/* Modal Buttons */}
            </div>
            <ModalFooter kind={modalMode === 'add' ? 'add' : 'edit'} onCancel={() => setIsAddEditOpen(false)} />
          </form>
        </div>
      </Modal>

      {/* ====================================================================== */}
      {/* MODAL 2: VIEW PAYMENT MODE DETAILS (READ-ONLY) */}
      {/* ====================================================================== */}
      <Modal
        isOpen={!!viewingItem}
        onClose={() => setViewingItem(null)}
        className="p-4"
      >
        {viewingItem && (() => {
          const isBank = !['Cash', 'Cheque', 'DD'].includes(viewingItem.paymentMode);
          const rows = [
            ['Payment mode', viewingItem.paymentMode],
            ['Status', viewingItem.status || 'Active'],
            ...(isBank ? [['Bank account', viewingItem.bankAccount || '-']] : []),
            ['Shown on receipt as', formatPaymentModeLabel(viewingItem)],
          ];
          return (
            <div className="bg-white rounded-2xl shadow-xl border border-[#E8DFD8] w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
              <div className="px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-between">
                <h3 className="text-lg font-bold text-[#180200] font-serif">Payment Mode Details</h3>
                <button
                  type="button"
                  onClick={() => setViewingItem(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <dl className="divide-y divide-[#F0E8E2] text-sm px-6 py-2">
                {rows.map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-4 py-2.5">
                    <dt className="text-xs text-[#863221] shrink-0">{label}</dt>
                    <dd className="font-semibold text-[#180200] text-right break-all">{value}</dd>
                  </div>
                ))}
              </dl>
              <ModalFooter kind="view" onCancel={() => setViewingItem(null)} />
            </div>
          );
        })()}
      </Modal>
    </div>
    </PermissionGate>
  );
}
