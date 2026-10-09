import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
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
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  SlidersHorizontal
} from 'lucide-react';
import api from '../api';
import { notify } from '../utils/notify';
import { formatPaymentModeLabel } from '../utils/displayHelpers';
import { loadReceipts } from '../utils/serverData';
import useAuth from '../hooks/useAuth';
import PermissionGate from '../components/PermissionGate';

export default function BankDetailsManagement() {
  const { hasPermission } = useAuth();

  // Master state
  const [paymentConfigs, setPaymentConfigs] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [banks, setBanks] = useState([]);

  // Dropdown options and bank details come from the Bank master / existing payment modes
  const AVAILABLE_BANK_ACCOUNTS = useMemo(() => [...new Set(banks.map((b) => b.name_en))], [banks]);
  const BANK_DETAILS_LOOKUP = useMemo(() => {
    const map = {};
    banks.forEach((b) => {
      if (!map[b.name_en]) {
        map[b.name_en] = { branch: b.branch_name || '', ifscCode: b.ifsc_code || '', accountNumber: b.account_number || '' };
      }
    });
    return map;
  }, [banks]);
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
  const [copiedId, setCopiedId] = useState(null);

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
  const [blockedDialog, setBlockedDialog] = useState(null); // payment mode that receipts still use

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
      console.error(err);
    }
  };

  useEffect(() => {
    fetchConfigs();
    loadReceipts({ limit: 25000 })
      .then(setReceipts)
      .catch((error) => showToast(error.response?.data?.detail || 'Failed to load receipts from the server.', 'error'));
  }, []);



  // Receipts count per payment mode label
  const usageCountMap = useMemo(() => {
    const map = {};
    receipts.forEach((r) => {
      const mode = (r.paymentMode || '').trim();
      if (mode) {
        map[mode] = (map[mode] || 0) + 1;
      }
    });
    return map;
  }, [receipts]);

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

  const handleCopyText = (id, text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    showToast('Copied to clipboard.');
  };

  // ----------------------------------------------------
  // ADD / EDIT MODAL HANDLERS
  // ----------------------------------------------------
  const openAddModal = () => {
    setModalMode('add');
    setEditingItem(null);
    const defaultBank = AVAILABLE_BANK_ACCOUNTS[0] || '';
    const lookup = BANK_DETAILS_LOOKUP[defaultBank] || {};
    setFormData({
      paymentMode: AVAILABLE_PAYMENT_MODES[0] || '__CUSTOM__',
      customPaymentMode: '',
      paymentType: 'Online',
      bankAccount: defaultBank,
      customBankAccount: '',
      branch: lookup.branch || '',
      ifscCode: lookup.ifscCode || '',
      accountNumber: lookup.accountNumber || '',
      status: 'Active'
    });
    setFormErrors({});
    setIsAddEditOpen(true);
  };

  const openEditModal = (config) => {
    setModalMode('edit');
    setEditingItem(config);
    const isCustomMode = !AVAILABLE_PAYMENT_MODES.includes(config.paymentMode);
    const isCustomBank = config.bankAccount && !AVAILABLE_BANK_ACCOUNTS.includes(config.bankAccount);
    const lookup = BANK_DETAILS_LOOKUP[config.bankAccount] || {};

    setFormData({
      paymentMode: isCustomMode ? '__CUSTOM__' : config.paymentMode,
      customPaymentMode: isCustomMode ? config.paymentMode : '',
      paymentType: config.paymentType || (config.paymentMode === 'Cash' ? 'Offline' : 'Online'),
      bankAccount: isCustomBank ? '__CUSTOM__' : (config.bankAccount || (config.paymentMode === 'Cash' ? '' : (AVAILABLE_BANK_ACCOUNTS[0] || ''))),
      customBankAccount: isCustomBank ? config.bankAccount : '',
      branch: config.branch || lookup.branch || '',
      ifscCode: config.ifscCode || lookup.ifscCode || '',
      accountNumber: config.accountNumber || lookup.accountNumber || '',
      status: config.status || 'Active'
    });
    setFormErrors({});
    setIsAddEditOpen(true);
  };

  const handlePaymentModeChange = (e) => {
    const val = e.target.value;
    let autoType = 'Online';
    let autoBank = formData.bankAccount;

    if (val === 'Cash' || val === 'Cheque' || val === 'DD') {
      autoType = 'Offline';
      autoBank = '';
    } else {
      autoType = 'Online';
      if (!autoBank) {
        autoBank = AVAILABLE_BANK_ACCOUNTS[0] || '';
      }
    }

    const lookup = BANK_DETAILS_LOOKUP[autoBank] || {};

    setFormData((prev) => ({
      ...prev,
      paymentMode: val,
      paymentType: autoType,
      bankAccount: autoBank,
      branch: autoType === 'Offline' ? '' : (prev.branch || lookup.branch || ''),
      ifscCode: autoType === 'Offline' ? '' : (prev.ifscCode || lookup.ifscCode || ''),
      accountNumber: autoType === 'Offline' ? '' : (prev.accountNumber || lookup.accountNumber || '')
    }));

    if (formErrors.paymentMode) {
      setFormErrors((prev) => ({ ...prev, paymentMode: '' }));
    }
  };

  const handleBankAccountChange = (e) => {
    const val = e.target.value;
    const lookup = BANK_DETAILS_LOOKUP[val] || {};

    setFormData((prev) => ({
      ...prev,
      bankAccount: val,
      branch: lookup.branch || prev.branch || '',
      ifscCode: lookup.ifscCode || prev.ifscCode || '',
      accountNumber: lookup.accountNumber || prev.accountNumber || ''
    }));

    if (formErrors.bankAccount) {
      setFormErrors((prev) => ({ ...prev, bankAccount: '' }));
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    let finalValue = value;
    if (name === 'ifscCode') {
      finalValue = value.toUpperCase();
    }
    setFormData((prev) => ({ ...prev, [name]: finalValue }));
    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: '' }));
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
      if (!formData.branch?.trim()) {
        errors.branch = 'Branch name is mandatory.';
      }
      if (!formData.ifscCode?.trim()) {
        errors.ifscCode = 'IFSC Code is mandatory.';
      }
      if (!formData.accountNumber?.trim()) {
        errors.accountNumber = 'Account Number is mandatory.';
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
        // Same bank + same account (blank counts as blank) is one bank, so saving never makes a duplicate
        const norm = (v) => String(v || '').trim().toLowerCase();
        let bank = banks.find(
          (b) => norm(b.name_en) === norm(effectiveBank) && norm(b.account_number) === norm(formData.accountNumber)
        );
        
        if (!bank) {
          const bankCode = effectiveBank.substring(0,3).toUpperCase() + Date.now().toString().slice(-4);
          const newBankRes = await api.post('/masters/banks', {
            code: bankCode,
            name_en: effectiveBank,
            account_number: formData.accountNumber.trim(),
            branch_name: formData.branch.trim(),
            ifsc_code: formData.ifscCode.trim().toUpperCase()
          });
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

  // How many receipts were recorded with this payment mode / bank account
  const getModeUsageCount = (cfg) => {
    const bank = (cfg.bankAccount || '').trim().toLowerCase();
    const mode = (cfg.paymentMode || '').trim().toLowerCase();
    const label = formatPaymentModeLabel(cfg).trim().toLowerCase();
    return receipts.filter((r) => {
      const rBank = (r.bankName || r.bankAccount || '').trim().toLowerCase();
      const rMode = (r.paymentMode || '').trim().toLowerCase();
      return bank ? rBank === bank : rMode === mode || rMode === label;
    }).length;
  };

  const handleDeleteClick = (cfg) => {
    if (getModeUsageCount(cfg) > 0) setBlockedDialog(cfg);
    else setDeleteDialog(cfg);
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

  return (
    <PermissionGate required="masters.read">
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

      {/* Breadcrumbs & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E8DFD8] pb-5">
        <div>
<div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#180200] tracking-tight">
              Payment Mode Configuration
            </h1>
          </div>
        </div>

        {/* Action Button: Add Payment Mode */}
        <button
          onClick={openAddModal}
          id="btn-add-payment-mode"
          disabled={!hasPermission('masters.write')}
          title={!hasPermission('masters.write') ? 'Requires masters.write permission' : undefined}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#510601] hover:bg-[#3D0400] active:bg-[#200200] text-white text-sm font-bold rounded-xl shadow-sm hover:shadow transition-all duration-200 cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Payment Mode</span>
        </button>
      </div>

      {/* Search & Filter Card */}
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
                        <div className="text-[10px] text-[#863221]/80 mt-0.5">
                          Used in {getModeUsageCount(config)} receipt{getModeUsageCount(config) === 1 ? '' : 's'}
                        </div>
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
                          disabled={!hasPermission('masters.write')}
                          onClick={() => handleToggleStatusClick(config)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-all cursor-pointer ${isActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                            }`}
                          title={!hasPermission('masters.write') ? 'Requires masters.write permission' : `Click to change status to ${isActive ? 'Inactive' : 'Active'}`}
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
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                            title="View Configuration Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View</span>
                          </button>

                          {/* Edit Button */}
                          <button
                            type="button"
                            onClick={() => openEditModal(config)}
                            disabled={!hasPermission('masters.write')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            title={!hasPermission('masters.write') ? 'Requires masters.write permission' : 'Edit Payment Mode'}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>

                          {/* Delete Button */}
                          <button
                            type="button"
                            onClick={() => handleDeleteClick(config)}
                            disabled={!hasPermission('masters.delete')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            title={!hasPermission('masters.delete') ? 'Requires masters.delete permission' : 'Delete Payment Mode'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
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
                        <button
                          onClick={openAddModal}
                          disabled={!hasPermission('masters.write')}
                          title={!hasPermission('masters.write') ? 'Requires masters.write permission' : undefined}
                          className="px-4 py-2 bg-[#510601] text-white text-xs font-bold rounded-xl hover:bg-[#3D0400] transition-colors"
                        >
                          + Add First Payment Mode
                        </button>
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
          <div className="p-4 border-t border-[#E8DFD8] bg-[#FAF7F2]/30 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#863221]">
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
          <div className="px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-between shrink-0">
            <div>
              <h3 className="text-lg font-bold text-[#180200] font-serif">
                {modalMode === 'add' ? 'Add Payment Mode' : 'Edit Payment Mode'}
              </h3>
              <p className="text-xs text-[#863221]">
                {modalMode === 'add'
                  ? 'Configure a payment mode option for receipt collections.'
                  : `Modify settings for "${formatPaymentModeLabel(editingItem)}".`}
              </p>
            </div>
            <button
              onClick={() => setIsAddEditOpen(false)}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Modal Form */}
          <form onSubmit={handleSaveForm} className="p-6 space-y-4 overflow-y-auto">
            {/* Field: Payment Mode * */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Payment Mode <span className="text-[#ED4636]">*</span>
              </label>
              <select
                name="paymentMode"
                value={formData.paymentMode}
                onChange={handlePaymentModeChange}
                className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm font-semibold text-[#180200] focus:outline-none cursor-pointer"
              >
                {AVAILABLE_PAYMENT_MODES.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
                <option value="__CUSTOM__">+ Other / Custom Payment Mode</option>
              </select>

              {formData.paymentMode === '__CUSTOM__' && (
                <div className="mt-2">
                  <input
                    type="text"
                    name="customPaymentMode"
                    value={formData.customPaymentMode}
                    onChange={handleInputChange}
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm text-[#180200] placeholder-[#863221]/40 focus:outline-none uppercase"
                  />
                </div>
              )}

              {formErrors.paymentMode && (
                <p className="mt-1 text-xs text-red-600 flex items-center gap-1 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{formErrors.paymentMode}</span>
                </p>
              )}
            </div>

            {/* Field: Bank Account (Conditional) */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Bank Account{' '}
                {formData.paymentMode !== 'Cash' && formData.paymentMode !== 'Cheque' && formData.paymentMode !== 'DD' ? (
                  <span className="text-[#ED4636]">*</span>
                ) : (
                  <span className="text-gray-400 font-normal lowercase">(not applicable)</span>
                )}
              </label>

              {formData.paymentMode === 'Cash' || formData.paymentMode === 'Cheque' || formData.paymentMode === 'DD' ? (
                <div className="px-3.5 py-2.5 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-sm text-[#863221] italic flex items-center justify-between">
                  <span>Not Applicable for {formData.paymentMode}</span>
                  <span className="text-xs font-semibold px-2 py-0.5 bg-white border border-[#E8DFD8] rounded text-[#510601]">
                    NA
                  </span>
                </div>
              ) : (
                <>
                  <select
                    name="bankAccount"
                    value={formData.bankAccount}
                    onChange={handleBankAccountChange}
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm font-semibold text-[#180200] focus:outline-none cursor-pointer"
                  >
                    {AVAILABLE_BANK_ACCOUNTS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                    <option value="__CUSTOM__">+ Other / Custom Bank Account</option>
                  </select>

                  {formData.bankAccount === '__CUSTOM__' && (
                    <div className="mt-2">
                      <input
                        type="text"
                        name="customBankAccount"
                        value={formData.customBankAccount}
                        onChange={handleInputChange}
                        className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm text-[#180200] placeholder-[#863221]/40 focus:outline-none uppercase"
                      />
                    </div>
                  )}

                  {formErrors.bankAccount && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1 font-medium">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{formErrors.bankAccount}</span>
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Online Bank Details: Branch, IFSC Code, Account Number */}
            {formData.paymentMode !== 'Cash' && formData.paymentMode !== 'Cheque' && formData.paymentMode !== 'DD' && (
              <div className="space-y-4 pt-1 border-t border-[#E8DFD8]/60">
                {/* Branch */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                    Branch <span className="text-[#ED4636]">*</span>
                  </label>
                  <input
                    type="text"
                    name="branch"
                    value={formData.branch || ''}
                    onChange={handleInputChange}
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm text-[#180200] placeholder-[#863221]/40 focus:outline-none"
                  />
                  {formErrors.branch && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1 font-medium">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{formErrors.branch}</span>
                    </p>
                  )}
                </div>

                {/* IFSC Code */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                    IFSC Code <span className="text-[#ED4636]">*</span>
                  </label>
                  <input
                    type="text"
                    name="ifscCode"
                    value={formData.ifscCode || ''}
                    onChange={handleInputChange}
                    maxLength={11}
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm font-mono uppercase text-[#180200] placeholder-[#863221]/40 focus:outline-none"
                  />
                  {formErrors.ifscCode && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1 font-medium">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{formErrors.ifscCode}</span>
                    </p>
                  )}
                </div>

                {/* Account Number */}
                <div>
                  <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                    Account Number <span className="text-[#ED4636]">*</span>
                  </label>
                  <input
                    type="text"
                    name="accountNumber"
                    value={formData.accountNumber || ''}
                    onChange={handleInputChange}
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm font-mono text-[#180200] placeholder-[#863221]/40 focus:outline-none"
                  />
                  {formErrors.accountNumber && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1 font-medium">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{formErrors.accountNumber}</span>
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Live Preview Box (Styled exactly like the clean input/select field above it) */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Receipt Form Display Preview
              </label>
              <div className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm font-semibold text-[#180200] shadow-2xs">
                {previewLabel}
              </div>
            </div>

            {/* Field: Status */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Status
              </label>
              <select
                name="status"
                value={formData.status}
                onChange={handleInputChange}
                className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm font-semibold text-[#180200] focus:outline-none cursor-pointer"
              >
                <option value="Active">Active (Available in Receipt dropdown)</option>
                <option value="Inactive">Inactive (Disabled for new receipts)</option>
              </select>
            </div>

            {/* Modal Buttons */}
            <div className="px-6 py-4 border-t border-[#E8DFD8] flex items-center justify-end gap-2.5 shrink-0 bg-[#FAF7F2] -mx-6 -mb-6 mt-6 rounded-b-2xl">
              <button
                type="button"
                onClick={() => setIsAddEditOpen(false)}
                className="px-4 py-2.5 border border-[#E8DFD8] hover:bg-[#FAF7F2] text-sm font-semibold text-[#863221] rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 bg-[#510601] hover:bg-[#3D0400] text-white text-sm font-bold rounded-xl shadow-sm hover:shadow transition-all duration-200 cursor-pointer"
              >
                {modalMode === 'add' ? 'Save Payment Mode' : 'Save Changes'}
              </button>
            </div>
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
        {viewingItem && (
          <div className="bg-white rounded-2xl shadow-xl border border-[#E8DFD8] w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-[#180200] font-serif">
                  Payment Mode Details
                </h3>
                <p className="text-xs text-[#863221]">
                  Read-only record overview
                </p>
              </div>
              <button
                onClick={() => setViewingItem(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Details */}
            <div className="p-6 space-y-4">
              <div className="bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl p-4 flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-[#863221] uppercase tracking-wider block">
                    Payment Mode
                  </span>
                  <span className="text-lg font-black text-[#180200]">
                    {viewingItem.paymentMode}
                  </span>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${(viewingItem.status || 'Active') === 'Active'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-gray-100 text-gray-600 border-gray-200'
                    }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${(viewingItem.status || 'Active') === 'Active'
                      ? 'bg-emerald-500'
                      : 'bg-gray-400'
                      }`}
                  />
                  <span>{viewingItem.status || 'Active'}</span>
                </span>
              </div>

              {viewingItem.paymentMode !== 'Cash' && viewingItem.paymentMode !== 'Cheque' && viewingItem.paymentMode !== 'DD' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-white border border-[#E8DFD8] rounded-xl">
                      <span className="text-[10px] font-bold text-[#863221] uppercase tracking-wider block mb-0.5">
                        Bank Identifier
                      </span>
                      <span className="text-sm font-mono font-bold text-[#180200] block mt-0.5">
                        {viewingItem.bankAccount || '-'}
                      </span>
                    </div>

                    <div className="p-3 bg-white border border-[#E8DFD8] rounded-xl">
                      <span className="text-[10px] font-bold text-[#863221] uppercase tracking-wider block mb-0.5">
                        Branch
                      </span>
                      <span className="text-sm font-semibold text-[#180200] block mt-0.5">
                        {viewingItem.branch || (BANK_DETAILS_LOOKUP[viewingItem.bankAccount]?.branch) || '-'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-white border border-[#E8DFD8] rounded-xl">
                      <span className="text-[10px] font-bold text-[#863221] uppercase tracking-wider block mb-0.5">
                        IFSC Code
                      </span>
                      <span className="text-sm font-mono font-bold text-[#180200] block mt-0.5">
                        {viewingItem.ifscCode || (BANK_DETAILS_LOOKUP[viewingItem.bankAccount]?.ifscCode) || '-'}
                      </span>
                    </div>

                    <div className="p-3 bg-white border border-[#E8DFD8] rounded-xl">
                      <span className="text-[10px] font-bold text-[#863221] uppercase tracking-wider block mb-0.5">
                        Account Number
                      </span>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-xs font-mono font-bold text-[#180200] truncate">
                          {viewingItem.accountNumber || (BANK_DETAILS_LOOKUP[viewingItem.bankAccount]?.accountNumber) || '-'}
                        </span>
                        {(viewingItem.accountNumber || BANK_DETAILS_LOOKUP[viewingItem.bankAccount]?.accountNumber) && (
                          <button
                            type="button"
                            onClick={() => handleCopyText(viewingItem.id, viewingItem.accountNumber || BANK_DETAILS_LOOKUP[viewingItem.bankAccount]?.accountNumber)}
                            className="p-1 text-[#863221] hover:text-[#510601] hover:bg-[#FAF7F2] rounded transition-colors shrink-0 ml-1"
                            title="Copy Account Number"
                          >
                            {copiedId === viewingItem.id ? (
                              <Check className="w-3.5 h-3.5 text-green-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}

              <div className="p-3 bg-white border border-[#E8DFD8] rounded-xl">
                <span className="text-[10px] font-bold text-[#863221] uppercase tracking-wider block mb-0.5">
                  Receipt Form Option Label
                </span>
                <span className="text-base font-bold text-[#510601] block">
                  {formatPaymentModeLabel(viewingItem)}
                </span>
              </div>
            </div>

            {/* Read-only footer */}
            <div className="px-6 py-4 border-t border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-end gap-2.5">
              <button
                onClick={() => setViewingItem(null)}
                className="px-4 py-2 border border-[#E8DFD8] text-xs font-semibold text-[#863221] hover:bg-white rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ====================================================================== */}
      {/* MODAL 3: STATUS TOGGLE CONFIRMATION */}
      {/* ====================================================================== */}
      <Modal
        isOpen={!!statusDialog}
        onClose={() => setStatusDialog(null)}
        className="p-4"
      >
        {statusDialog && (
          <div className="bg-white rounded-2xl shadow-xl border border-[#E8DFD8] w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 text-center">
              <div
                className={`w-12 h-12 rounded-full mx-auto flex items-center justify-center mb-3 ${statusDialog.newStatus === 'Active'
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'bg-amber-50 text-amber-600'
                  }`}
              >
                {statusDialog.newStatus === 'Active' ? (
                  <CheckCircle2 className="w-6 h-6" />
                ) : (
                  <AlertTriangle className="w-6 h-6" />
                )}
              </div>
              <h4 className="text-base font-bold text-[#180200] font-serif mb-1">
                Change Status to {statusDialog.newStatus}?
              </h4>
              <p className="text-xs text-[#863221] leading-relaxed">
                {statusDialog.newStatus === 'Inactive'
                  ? `Setting "${formatPaymentModeLabel(statusDialog.item)}" to Inactive will hide it from the Payment Mode dropdown for new receipts. All existing historical receipts with this mode remain intact.`
                  : `Setting "${formatPaymentModeLabel(statusDialog.item)}" to Active will make it immediately available for selection in new receipts.`}
              </p>
            </div>
            <div className="p-4 border-t border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => setStatusDialog(null)}
                className="px-4 py-2 border border-[#E8DFD8] text-xs font-semibold text-[#863221] hover:bg-white rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!hasPermission('masters.write')}
                title={!hasPermission('masters.write') ? 'Requires masters.write permission' : undefined}
                onClick={confirmStatusToggle}
                className={`px-5 py-2 text-xs font-bold text-white rounded-xl shadow-sm transition-colors cursor-pointer ${statusDialog.newStatus === 'Active'
                  ? 'bg-emerald-700 hover:bg-emerald-800'
                  : 'bg-[#510601] hover:bg-[#3D0400]'
                  }`}
              >
                Confirm {statusDialog.newStatus}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Cannot delete: receipts still use this mode */}
      <Modal isOpen={!!blockedDialog} onClose={() => setBlockedDialog(null)} className="p-4">
        {blockedDialog && (
          <div className="bg-white rounded-2xl shadow-xl border border-[#E8DFD8] w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 text-center">
              <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center mb-3 bg-amber-50 text-amber-600">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h4 className="text-base font-bold text-[#180200] font-serif mb-1">Cannot Delete Payment Mode</h4>
              <p className="text-xs text-[#863221] leading-relaxed">
                {`"${formatPaymentModeLabel(blockedDialog)}" is used by ${getModeUsageCount(blockedDialog)} receipt(s). Deactivate it instead: it disappears from Receipt Entry and the recorded receipts stay unchanged.`}
              </p>
            </div>
            <div className="p-4 border-t border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => setBlockedDialog(null)}
                className="px-4 py-2 border border-[#E8DFD8] text-xs font-semibold text-[#863221] hover:bg-white rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!hasPermission('masters.write') || (blockedDialog.status || 'Active') !== 'Active'}
                onClick={() => {
                  const cfg = blockedDialog;
                  setBlockedDialog(null);
                  setStatusDialog({ item: cfg, newStatus: 'Inactive' });
                }}
                className="px-5 py-2 text-xs font-bold text-white rounded-xl shadow-sm transition-colors cursor-pointer bg-[#510601] hover:bg-[#3D0400] disabled:opacity-40"
              >
                Deactivate Instead
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirmation */}
      <Modal isOpen={!!deleteDialog} onClose={() => setDeleteDialog(null)} className="p-4">
        {deleteDialog && (
          <div className="bg-white rounded-2xl shadow-xl border border-[#E8DFD8] w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 text-center">
              <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center mb-3 bg-red-50 text-[#ED4636]">
                <Trash2 className="w-6 h-6" />
              </div>
              <h4 className="text-base font-bold text-[#180200] font-serif mb-1">Delete Payment Mode?</h4>
              <p className="text-xs text-[#863221] leading-relaxed">
                {`"${formatPaymentModeLabel(deleteDialog)}" will be removed from the Payment Mode dropdown. Receipts already recorded with it are not changed.`}
              </p>
            </div>
            <div className="p-4 border-t border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteDialog(null)}
                className="px-4 py-2 border border-[#E8DFD8] text-xs font-semibold text-[#863221] hover:bg-white rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!hasPermission('masters.delete')}
                onClick={confirmDelete}
                className="px-5 py-2 text-xs font-bold text-white rounded-xl shadow-sm transition-colors cursor-pointer bg-[#ED4636] hover:bg-[#C93324] disabled:opacity-40"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
    </PermissionGate>
  );
}
