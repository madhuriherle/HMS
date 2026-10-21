import FilterToggle from '../components/FilterToggle';
import React, { useState, useMemo, useEffect } from 'react';
import Modal from '../components/Modal';
import {
  Tag,
  Plus,
  Search,
  Pencil,
  Trash2,
  History,
  TrendingUp,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  X,
  AlertCircle,
  RefreshCw,
  FileText,
} from 'lucide-react';
import api from '../api';
import { formatDate as formatDateShared } from '../utils/dateUtils';
import DateInput from '../components/DateInput';

// 'Present' marks the open-ended current price; real dates are shown as DD-MM-YYYY
const formatDate = (v) => (v === 'Present' ? v : formatDateShared(v));
import { notify } from '../utils/notify';
import useAuth from '../hooks/useAuth';
import useSwalConfirm from '../hooks/useSwalConfirm';
import PermissionGate from '../components/PermissionGate';
import { formatMoney } from '../utils/money';


import ModalFooter from '../components/ModalFooter';
export default function MembershipTypeManagement() {
  const { hasPermission } = useAuth();

  // Master state
  const [membershipTypes, setMembershipTypes] = useState([]);


  const fetchMembershipTypes = async () => {
    try {
      const res = await api.get('/masters/membership-types?limit=1000');
      const mapped = (res.data?.data || []).map(m => ({
        id: m.id,
        name: m.name_en,
        code: m.code,
        currentPrice: m.current_price || 0,
        priceCount: m.price_count || 0,
        chartColor: m.chart_color || '',
        status: m.status ? 'Active' : 'Inactive',
        effectiveFrom: 'Present',
        priceHistory: [] // Can fetch lazily or in another call
      }));
      setMembershipTypes(mapped);
    } catch (err) {
      console.error(err);
      // alert('Failed to fetch membership types');
    }
  };

  useEffect(() => {
    fetchMembershipTypes();
  }, []);


  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modal States
  const [isAddEditOpen, setIsAddEditOpen] = useState(false);
  const [modalMode, setModalMode] = useState('add'); // 'add' | 'edit'
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    amount: '',
    chartColor: '',
    status: 'Active'
  });
  const [formErrors, setFormErrors] = useState({});

  // Delete Confirmation Modal State

  // Update Price Modal State
  const [isUpdatePriceOpen, setIsUpdatePriceOpen] = useState(false);
  const [priceTargetItem, setPriceTargetItem] = useState(null);
  const [priceFormData, setPriceFormData] = useState({
    newPrice: '',
    effectiveFrom: '',
    reason: ''
  });
  const [priceFormErrors, setPriceFormErrors] = useState({});

  // View Details Modal State
  const [viewingItem, setViewingItem] = useState(null);

  // Price History Modal State
  const [historyTargetItem, setHistoryTargetItem] = useState(null);

  // Status Toggle Confirmation Dialog State
  const [statusDialog, setStatusDialog] = useState(null); // { item, newStatus }

  // Toast / Feedback Modal State
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (message, type = 'success') => {
    notify(message, type);
  };



  // ----------------------------------------------------
  // SUMMARY METRICS
  // ----------------------------------------------------

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
    return membershipTypes.filter((item) => {
      const q = searchQuery.toLowerCase().trim();
      const matchSearch =
        !q ||
        (item.name && item.name.toLowerCase().includes(q)) ||
        String(item.currentPrice || '').includes(q);

      const matchStatus = statusFilter === 'ALL' || item.status === statusFilter;

      return matchSearch && matchStatus;
    });
  }, [membershipTypes, searchQuery, statusFilter]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredData.length / pageSize) || 1;
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, currentPage, pageSize]);

  // ----------------------------------------------------
  // ADD / EDIT FORM LOGIC
  // ----------------------------------------------------
  const openAddModal = () => {
    setModalMode('add');
    setEditingItem(null);
    setFormData({
      name: '',
      amount: '',
      chartColor: '',
      status: 'Active'
    });
    setFormErrors({});
    setIsAddEditOpen(true);
  };

  const openEditModal = (item) => {
    setModalMode('edit');
    setEditingItem(item);
    setFormData({
      name: item.name || '',
      amount: String(item.currentPrice || ''),
      chartColor: item.chartColor || '',
      status: item.status || 'Active'
    });
    setFormErrors({});
    setIsAddEditOpen(true);
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    if (name === 'amount') {
      const cleaned = value.replace(/\D/g, '');
      setFormData(prev => ({ ...prev, amount: cleaned }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }

    if (formErrors[name]) {
      setFormErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = () => {
    const errors = {};
    const name = formData.name?.trim();

    if (!name) {
      errors.name = 'Membership Type is required';
    } else {
      const isDuplicate = membershipTypes.some(
        m => m.id !== editingItem?.id && m.name?.toLowerCase() === name.toLowerCase()
      );
      if (isDuplicate) {
        errors.name = 'This membership type already exists.';
      }
    }

    const priceNum = Number(formData.amount);
    if (!formData.amount) {
      errors.amount = 'Amount in Rs. is required';
    } else if (isNaN(priceNum) || priceNum <= 0) {
      errors.amount = 'Amount must be greater than 0';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveMembershipType = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      const today = new Date().toISOString().split('T')[0];
      const amountVal = Number(formData.amount);
      const isActive = formData.status === 'Active';

      if (modalMode === 'add') {
        const res = await api.post('/masters/membership-types', {
          name_en: formData.name,
          chart_color: formData.chartColor || null,
          status: isActive
        });
        
        await api.post(`/masters/membership-types/${res.data.id}/prices`, {
          amount: amountVal,
          effective_from: today,
          change_reason: 'Initial price'
        });
        
        showToast(`Membership Type "${formData.name}" added successfully.`);
      } else {
        // the amount on this form is the type's price: a changed amount is a new price revision (kept in the history)
        let priceResult = null;
        if (Number.isFinite(amountVal) && amountVal !== Number(editingItem.currentPrice)) {
          priceResult = await api.post(`/masters/membership-types/${editingItem.id}/prices`, {
            amount: amountVal,
            effective_from: today,
            change_reason: 'Changed while editing the membership type'
          });
        }
        await api.put(`/masters/membership-types/${editingItem.id}`, {
          name_en: formData.name,
          chart_color: formData.chartColor || null,
          status: isActive
        });
        if (isPendingApproval(priceResult?.data)) {
          showToast(`Price change for "${formData.name}" submitted for approval.`);
          setIsAddEditOpen(false);
          fetchMembershipTypes();
          return;
        }
        
        showToast(`Membership Type "${formData.name}" updated successfully.`);
      }
      setIsAddEditOpen(false);
      fetchMembershipTypes();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error saving membership type', 'error');
    }
  };

  const isPendingApproval = (data) => Boolean(data && (data.approval_request_id || data.status === 'PENDING'));

  // ---- price history (read from the server) ----
  const handleOpenHistory = async (item) => {
    try {
      const res = await api.get(`/masters/membership-types/${item.id}/prices`, { params: { limit: 200 } });
      const priceHistory = (res.data?.data || []).map((p) => ({
        id: p.id,
        price: Number(p.amount),
        effectiveFrom: p.effective_from,
        effectiveTo: p.effective_to || 'Present',
        reason: p.change_reason || '',
        changedAt: (p.updated_at || p.created_at) ? String(p.updated_at || p.created_at).slice(0, 10) : ''
      }));
      setHistoryTargetItem({
        ...item,
        effectiveFrom: priceHistory[0]?.effectiveFrom || item.effectiveFrom,
        priceHistory
      });
    } catch (err) {
      showToast(err.response?.data?.detail || 'Failed to load the price history.', 'error');
    }
  };

  // ---- update price ----
  const openUpdatePriceModal = (item) => {
    setPriceTargetItem(item);
    setPriceFormData({
      newPrice: '',
      effectiveFrom: new Date().toISOString().split('T')[0],
      reason: ''
    });
    setPriceFormErrors({});
    setIsUpdatePriceOpen(true);
  };

  const handlePriceFormChange = (e) => {
    const { name, value } = e.target;
    setPriceFormData((prev) => ({
      ...prev,
      [name]: name === 'newPrice' ? value.replace(/[^\d.]/g, '') : value
    }));
    if (priceFormErrors[name]) {
      setPriceFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validatePriceForm = () => {
    const errors = {};
    const price = Number(priceFormData.newPrice);
    if (!priceFormData.newPrice || Number.isNaN(price) || price <= 0) {
      errors.newPrice = 'Enter a price greater than 0.';
    }
    if (!priceFormData.effectiveFrom) {
      errors.effectiveFrom = 'Effective date is required.';
    }
    setPriceFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ---- delete ----
  const handleConfirmDelete = async (item) => {
    try {
      const { data } = await api.delete(`/masters/membership-types/${item.id}`);
      showToast(
        isPendingApproval(data)
          ? `Delete request for "${item.name}" submitted for approval.`
          : `Membership Type "${item.name}" deleted.`
      );
      await fetchMembershipTypes();
    } catch (err) {
      if (!err.isCancelled) showToast(err.response?.data?.detail || 'Error deleting record', 'error');
    }
  };;

  const handleSavePriceUpdate = async (e) => {
    e.preventDefault();
    if (!validatePriceForm()) return;

    const target = priceTargetItem;
    try {
      const { data } = await api.post(`/masters/membership-types/${target.id}/prices`, {
        amount: Number(priceFormData.newPrice),
        effective_from: priceFormData.effectiveFrom,
        change_reason: priceFormData.reason?.trim() || 'Price revision'
      });
      showToast(
        isPendingApproval(data)
          ? `Price change for "${target.name}" submitted for approval.`
          : `Price for "${target.name}" updated to ${formatMoney(Number(priceFormData.newPrice))}.`
      );
      setIsUpdatePriceOpen(false);
      await fetchMembershipTypes();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error updating price', 'error');
    }
  };

  // ----------------------------------------------------
  // ACTIVATE / DEACTIVATE LOGIC
  // ----------------------------------------------------
  const promptToggleStatus = (item) => {
    setStatusDialog({
      item,
      newStatus: item.status === 'Active' ? 'Inactive' : 'Active'
    });
  };

  const handleConfirmStatusToggle = async () => {
    if (!statusDialog) return;
    const { item, newStatus } = statusDialog;
    try {
      const { data } = await api.put(`/masters/membership-types/${item.id}`, { status: newStatus === 'Active' }, { params: { reason: 'Status changed via UI' } });
      showToast(
        isPendingApproval(data)
          ? `Status change for "${item.name}" submitted for approval.`
          : `Membership Type "${item.name}" is now ${newStatus}.`
      );
      await fetchMembershipTypes();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error updating status', 'error');
    }
    setStatusDialog(null);
  };

  useSwalConfirm(
    statusDialog,
    () => setStatusDialog(null),
    (d) => ({
      title: `${d.newStatus === 'Inactive' ? 'Deactivate' : 'Activate'} membership type?`,
      text: d.newStatus === 'Inactive'
        ? `Deactivate ${d.item.name}? Inactive membership types will not be available for new registrations.`
        : `Activate ${d.item.name}? It will become available for member registrations.`,
      confirmText: d.newStatus === 'Inactive' ? 'Yes, deactivate' : 'Yes, activate',
      danger: d.newStatus === 'Inactive',
    }),
    handleConfirmStatusToggle
  );

  return (
    <PermissionGate required="masters.membership_types.read">
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

      {/* Action Bar */}
      <div className="flex items-center justify-end gap-2 -mb-2">
        <FilterToggle open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} count={statusFilter !== 'ALL' ? 1 : 0} />
        {/* The Recently deleted button is hidden (the RecentlyDeleted component is kept to bring it back):
        {hasPermission('masters.membership_types.delete') && <RecentlyDeleted kind="membership-types" label="membership types" onRestored={fetchMembershipTypes} />}
        */}
        {hasPermission('masters.membership_types.write') && (
          <button
            onClick={openAddModal}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm hover:shadow transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Membership Type</span>
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

      {/* Membership Types Table Card */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-semibold text-[#863221] uppercase tracking-wider">
                <th className="px-5 py-3.5 w-12"></th>
                <th className="px-5 py-3.5">Membership Type</th>
                <th className="px-5 py-3.5 text-right">Amount</th>
                <th className="px-5 py-3.5 text-center">Status</th>
                <th className="px-5 py-3.5 text-center">Price History</th>
                <th className="px-5 py-3.5 text-right min-w-[170px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8] text-sm">
              {paginatedData.length > 0 ? (
                paginatedData.map((item, index) => {
                  const historyCount = item.priceHistory?.length || item.priceCount || 1;
                  const revisionsCount = historyCount - 1;
                  const isActive = item.status === 'Active';

                  return (
                    <tr key={item.id} className="hover:bg-[#FAF7F2]/50 transition-colors group">
                      <td className="px-5 py-4 text-xs font-bold text-[#863221]/70">
                        {(currentPage - 1) * pageSize + index + 1}
                      </td>

                      {/* Type Name */}
                      <td className="px-5 py-4 font-bold text-[#180200]">
                        <span className="text-sm">{item.name}</span>
                      </td>

                      {/* Amount */}
                      <td className="px-5 py-4 font-mono font-bold text-[#510601] text-base text-right">
                        {formatMoney(item.currentPrice)}
                      </td>

                      {/* Status (Active / Inactive Toggle) */}
                      <td className="px-5 py-4 text-center">
                        <button
                          type="button"
                          disabled={!hasPermission('masters.membership_types.write')}
                          onClick={() => promptToggleStatus(item)}
                          className={`text-xs font-semibold cursor-pointer ${isActive
                            ? 'chip chip-on'
                            : 'chip chip-off'
                            }`}
                          title={!hasPermission('masters.membership_types.write') ? 'Requires masters.membership_types.write permission' : `Click to set as ${isActive ? 'Inactive' : 'Active'}`}
                        >
                          <span>{item.status}</span>
                        </button>
                      </td>

                      {/* Price History Badge */}
                      <td className="px-5 py-4 text-center">
                        <button
                          onClick={() => handleOpenHistory(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-[#FAF7F2] border border-[#E8DFD8] hover:border-[#510601] text-[#510601] rounded-full text-xs font-semibold shadow-2xs transition-all cursor-pointer"
                          title="View complete price history"
                        >
                          <History className="w-3 h-3 text-[#863221]" />
                          <span>
                            {revisionsCount > 0 ? `${revisionsCount} ${revisionsCount === 1 ? 'Rev' : 'Revs'}` : '1 Base'}
                          </span>
                        </button>
                      </td>

                      {/* Action Column: Edit, Delete */}
                      <td className="px-5 py-4 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {/* Edit Button */}
                          {hasPermission('masters.membership_types.write') && (
                            <button
                              onClick={() => openEditModal(item)}
                              className="btn-act"
                              title={'Edit Membership Type'}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>Edit</span>
                            </button>
                          )}

                          {/* Delete Button */}
                          {hasPermission('masters.membership_types.delete') && (
                            <button
                              onClick={() => handleConfirmDelete(item)}
                              className="btn-act btn-act-danger"
                              title={'Delete Membership Type'}
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
                  <td colSpan="6" className="px-6 py-12 text-center text-[#863221]">
                    <div className="w-12 h-12 rounded-full bg-[#FAF7F2] text-[#863221]/60 flex items-center justify-center mx-auto mb-3">
                      <Tag className="w-6 h-6" />
                    </div>
                    <p className="font-semibold text-sm text-[#180200]">No membership types found</p>
                    <p className="text-xs text-[#863221]/70 mt-1 max-w-sm mx-auto">
                      {hasActiveFilters
                        ? "Try changing your search or filter criteria."
                        : "No membership types registered yet. Click below to add your first one."}
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
                        hasPermission('masters.membership_types.write') && (
                          <button
                            onClick={openAddModal}

                            className="px-4 py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                          >
                            Add Membership Type
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
      {/* ADD / EDIT MEMBERSHIP TYPE MODAL                             */}
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
          <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                <Tag className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#180200]">
                  {modalMode === 'add' ? 'Add Membership Type' : 'Edit Membership Type'}
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

          {/* Form */}
          <form onSubmit={handleSaveMembershipType} className="p-6 space-y-4">

            {/* 1. Type (Text Box) */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Type <span className="text-[#ED4636]">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleFormChange}
                className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-medium text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${formErrors.name
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

            {/* 2. Amount (Text Box) */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Amount (Rs.) <span className="text-[#ED4636]">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-[#863221]/70">
                  ₹
                </span>
                <input
                  type="text"
                  name="amount"
                  value={formData.amount}
                  onChange={handleFormChange}
                  className={`w-full pl-8 pr-4 py-2.5 bg-white border rounded-xl text-sm font-mono font-bold text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${formErrors.amount
                    ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                    : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                    }`}
                />
              </div>
              {formErrors.amount && (
                <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {formErrors.amount}
                </p>
              )}
            </div>

            {/* 3. Status (Active/Inactive) */}
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Dashboard colour
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={formData.chartColor || '#863221'}
                  onChange={(e) => setFormData((prev) => ({ ...prev, chartColor: e.target.value }))}
                  className="h-10 w-14 rounded-lg border border-[#E8DFD8] bg-white cursor-pointer"
                />
                <span className="text-xs text-[#863221]">{formData.chartColor || 'Automatic'}</span>
                {formData.chartColor && (
                  <button type="button" onClick={() => setFormData((prev) => ({ ...prev, chartColor: '' }))} className="text-xs font-semibold text-[#8C1801] hover:underline">
                    Use automatic
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Status
              </label>
              <select
                name="status"
                value={formData.status}
                onChange={handleFormChange}
                className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm font-medium text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] cursor-pointer"
              >
                <option value="Active">Active (Available for registrations)</option>
                <option value="Inactive">Inactive (Disabled)</option>
              </select>
            </div>

            {/* Action Buttons */}
            <ModalFooter kind={modalMode === 'add' ? 'add' : 'edit'} onCancel={() => setIsAddEditOpen(false)} inForm />

          </form>
        </div>
      </Modal>

      

      {/* ============================================================ */}
      {/* UPDATE MEMBERSHIP PRICE MODAL                                */}
      {/* ============================================================ */}
      <Modal
        isOpen={isUpdatePriceOpen && Boolean(priceTargetItem)}
        onClose={() => setIsUpdatePriceOpen(false)}
      >
        {priceTargetItem && (
          <div
            className="bg-white rounded-2xl max-w-2xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#180200]">Update Membership Price</h3>
                  <p className="text-xs text-[#863221]">{priceTargetItem.name}</p>
                </div>
              </div>
              <button
                onClick={() => setIsUpdatePriceOpen(false)}
                className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSavePriceUpdate} className="p-6 space-y-4">

              {/* Current Active Price (Read-only banner) */}
              <div className="p-3.5 bg-[#FAF7F2] rounded-xl border border-[#E8DFD8] flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-semibold text-[#863221] uppercase">Current Active Price</p>
                  <p className="text-xl font-mono font-bold text-[#510601] mt-0.5">
                    {formatMoney(priceTargetItem.currentPrice)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-semibold text-[#863221] uppercase">Effective Since</p>
                  <p className="text-xs font-medium text-[#180200] mt-0.5">
                    {formatDate(priceTargetItem.effectiveFrom)}
                  </p>
                </div>
              </div>

              {/* New Price Field */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  New Price (INR) <span className="text-[#ED4636]">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-[#863221]/70">
                    ₹
                  </span>
                  <input
                    type="text"
                    name="newPrice"
                    value={priceFormData.newPrice}
                    onChange={handlePriceFormChange}
                    className={`w-full pl-8 pr-4 py-2.5 bg-white border rounded-xl text-sm font-mono font-bold text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${priceFormErrors.newPrice
                      ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                      : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                      }`}
                  />
                </div>
                {priceFormErrors.newPrice && (
                  <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {priceFormErrors.newPrice}
                  </p>
                )}
              </div>

              {/* Effective From Date */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Effective From <span className="text-[#ED4636]">*</span>
                </label>
                <DateInput
                  name="effectiveFrom"
                  value={priceFormData.effectiveFrom}
                  onChange={handlePriceFormChange}
                  className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm text-[#180200] focus:outline-none transition-colors ${priceFormErrors.effectiveFrom
                    ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                    : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                    }`}
                />
                {priceFormErrors.effectiveFrom && (
                  <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {priceFormErrors.effectiveFrom}
                  </p>
                )}
              </div>

              {/* Reason for Change */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Reason for Price Change <span className="text-gray-400 font-normal">(Optional)</span>
                </label>
                <textarea
                  name="reason"
                  rows={2}
                  value={priceFormData.reason}
                  onChange={handlePriceFormChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] placeholder-[#863221]/40 focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] transition-colors resize-none"
                />
              </div>

              {/* Actions */}
              <ModalFooter kind="edit" onCancel={() => setIsUpdatePriceOpen(false)} inForm />

            </form>
          </div>
        )}
      </Modal>

      {/* ============================================================ */}
      {/* PRICE HISTORY MODAL                                          */}
      {/* ============================================================ */}
      <Modal
        isOpen={Boolean(historyTargetItem)}
        onClose={() => setHistoryTargetItem(null)}
      >
        {historyTargetItem && (
          <div
            className="bg-white rounded-2xl max-w-4xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#180200]">
                    Price History – {historyTargetItem.name}
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setHistoryTargetItem(null)}
                className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="p-6 overflow-y-auto space-y-4">

              {/* Top Banner with Quick Action */}
              <div className="p-4 bg-[#FAF7F2] rounded-xl border border-[#E8DFD8] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-[11px] font-bold text-[#863221] uppercase tracking-wider">Current Active Price</span>
                  <p className="text-2xl font-mono font-bold text-[#510601] mt-0.5">
                    {formatMoney(historyTargetItem.currentPrice)}
                  </p>
                  <span className="text-xs text-[#863221]/80 mt-0.5 block">
                    Applicable from {formatDate(historyTargetItem.effectiveFrom)}
                  </span>
                </div>

                {hasPermission('masters.membership_types.write') && (
                  <button
                    type="button"

                    onClick={() => {
                      const item = historyTargetItem;
                      setHistoryTargetItem(null);
                      openUpdatePriceModal(item);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer self-start sm:self-auto"
                  >
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span>Update Price</span>
                  </button>
                )}
              </div>

              {/* Price History Table */}
              <div className="border border-[#E8DFD8] rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#863221] font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3 text-right">Price</th>
                      <th className="px-4 py-3">From</th>
                      <th className="px-4 py-3">To</th>
                      <th className="px-4 py-3">Changed On</th>
                      <th className="px-4 py-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8DFD8]">
                    {historyTargetItem.priceHistory && historyTargetItem.priceHistory.length > 0 ? (
                      historyTargetItem.priceHistory.map((ph, idx) => {
                        const isCurrent = idx === 0 && ph.effectiveTo === 'Present';
                        return (
                          <tr key={ph.id || idx} className={isCurrent ? 'bg-[#3D705C]/5' : 'hover:bg-[#FAF7F2]/40'}>
                            <td className="px-4 py-3 font-mono font-bold text-[#510601] text-right text-sm">
                              {formatMoney(ph.price)}
                            </td>
                            <td className="px-4 py-3 font-medium text-[#180200]">
                              {formatDate(ph.effectiveFrom)}
                            </td>
                            <td className="px-4 py-3">
                              {ph.effectiveTo === 'Present' ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#3D705C]/15 text-[#3D705C] border border-[#3D705C]/20">
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                  Present (Current)
                                </span>
                              ) : (
                                <span className="font-medium text-[#180200]/80">
                                  {formatDate(ph.effectiveTo)}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-[#863221]/80">
                              {formatDate(ph.changedAt)}
                            </td>
                            <td className="px-4 py-3 text-[#180200]/90 max-w-[260px] break-words" title={ph.reason}>
                              {ph.reason || '—'}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan="5" className="px-4 py-6 text-center text-[#863221]/70 italic">
                          No price history records available.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

            </div>

            {/* Footer */}
            <ModalFooter kind="view" onCancel={() => setHistoryTargetItem(null)} />
          </div>
        )}
      </Modal>

      {/* ============================================================ */}
      {/* VIEW DETAILS MODAL                                           */}
      {/* ============================================================ */}
      <Modal
        isOpen={Boolean(viewingItem)}
        onClose={() => setViewingItem(null)}
      >
        {viewingItem && (
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
                  <h3 className="text-base font-bold text-[#180200]">Membership Type Details</h3>
                  <p className="text-xs text-[#863221]">Tier ID: {viewingItem.id}</p>
                </div>
              </div>
              <button
                onClick={() => setViewingItem(null)}
                className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-6 space-y-4 text-sm">
              <div className="bg-[#FAF7F2]/60 rounded-xl p-4 border border-[#E8DFD8] flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-[#863221]">Current Active Price</p>
                  <p className="text-2xl font-mono font-bold text-[#510601] mt-0.5">
                    {formatMoney(viewingItem.currentPrice)}
                  </p>
                </div>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${viewingItem.status === 'Active'
                  ? 'bg-[#3D705C]/10 text-[#3D705C] border border-[#3D705C]/20'
                  : 'bg-gray-100 text-gray-600 border border-gray-200'
                  }`}>
                  {viewingItem.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <p className="text-xs text-[#863221] font-semibold uppercase">Membership Type</p>
                  <p className="text-base font-bold text-[#180200] mt-0.5">{viewingItem.name}</p>
                </div>

                <div>
                  <p className="text-xs text-[#863221] font-semibold uppercase">Effective From</p>
                  <p className="text-sm font-medium text-[#180200] mt-0.5">{formatDate(viewingItem.effectiveFrom)}</p>
                </div>

                <div>
                  <p className="text-xs text-[#863221] font-semibold uppercase">Created On</p>
                  <p className="text-sm font-medium text-[#180200] mt-0.5">{formatDate(viewingItem.createdAt)}</p>
                </div>

                <div>
                  <p className="text-xs text-[#863221] font-semibold uppercase">Last Updated</p>
                  <p className="text-sm font-medium text-[#180200] mt-0.5">{formatDate(viewingItem.updatedAt)}</p>
                </div>
              </div>

              {/* Read-only footer */}
              <ModalFooter kind="view" onCancel={() => setViewingItem(null)} inForm />

            </div>
          </div>
        )}
      </Modal>

    </div>
    </PermissionGate>
  );
}
