import React, { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
import {
  UserCheck,
  User,
  Search,
  Eye,
  CheckCircle2,
  X,
  AlertCircle,
  AlertTriangle,
  MapPin,
  Phone,
  Mail,
  Calendar,
  Layers,
  Check,
  Filter,
  RefreshCw,
  Award,
  Clock,
  FileText,
  Link as LinkIcon,
  ChevronRight,
  ChevronLeft,
  ShieldAlert,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import {
  getStoredUnapprovedMembers,
  saveStoredUnapprovedMembers,
  getStoredMembers,
  saveStoredMembers,
  getStoredMembershipTypes,
  getStoredStates,
  getStoredDistricts
} from '../utils/receiptStore';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';

export default function UnapprovedMembership() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  // ----------------------------------------------------
  // DATA STORES
  // ----------------------------------------------------
  const [unapprovedMembers, setUnapprovedMembers] = useState(getStoredUnapprovedMembers());
  const [membershipTypes] = useState(getStoredMembershipTypes());
  const [states] = useState(getStoredStates());
  const [districts] = useState(getStoredDistricts());

  useEffect(() => {
    setUnapprovedMembers(getStoredUnapprovedMembers());
  }, []);

  const persistUnapproved = (updated) => {
    setUnapprovedMembers(updated);
    saveStoredUnapprovedMembers(updated);
  };

  // Toast feedback
  const [toastMessage, setToastMessage] = useState(null);
  const showToast = (message, type = 'success') => {
    setToastMessage({ message, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // ----------------------------------------------------
  // SEARCH & FILTER STATE
  // ----------------------------------------------------
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [stateFilter, setStateFilter] = useState('ALL');
  const [districtFilter, setDistrictFilter] = useState('ALL');
  const [receiptStatusFilter, setReceiptStatusFilter] = useState('ALL');

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Row Selection
  const [selectedIds, setSelectedIds] = useState(new Set());

  // ----------------------------------------------------
  // MODAL STATES
  // ----------------------------------------------------
  // 1. View Details Modal
  const [viewingMember, setViewingMember] = useState(null);

  // 2. Approve Confirmation Modal
  const [approveDialog, setApproveDialog] = useState(null); // Member object to approve

  // 3. Receipt Validation Block Alert Modal
  const [validationBlockDialog, setValidationBlockDialog] = useState(null); // Member object blocked

  // Districts for dropdown filter
  const filterDistricts = useMemo(() => {
    if (stateFilter === 'ALL') return districts;
    const st = states.find((s) => s.name.toLowerCase() === stateFilter.toLowerCase());
    return st ? districts.filter((d) => d.stateId === st.id) : districts;
  }, [districts, states, stateFilter]);

  // ----------------------------------------------------
  // FILTERING LOGIC
  // ----------------------------------------------------
  const filteredList = useMemo(() => {
    return unapprovedMembers.filter((m) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const name = (m.fullName || m.name || '').toLowerCase();
        const mob = (m.mobile || m.mobileNumber || '').toLowerCase();
        const em = (m.email || '').toLowerCase();
        const dist = (m.districtName || '').toLowerCase();
        const id = (m.id || '').toLowerCase();

        if (
          !name.includes(q) &&
          !mob.includes(q) &&
          !em.includes(q) &&
          !dist.includes(q) &&
          !id.includes(q)
        ) {
          return false;
        }
      }

      // Membership Type Filter
      if (typeFilter !== 'ALL') {
        const mType = (m.membershipType || '').toLowerCase();
        if (mType !== typeFilter.toLowerCase()) return false;
      }

      // State Filter
      if (stateFilter !== 'ALL') {
        if ((m.stateName || '').toLowerCase() !== stateFilter.toLowerCase()) return false;
      }

      // District Filter
      if (districtFilter !== 'ALL') {
        if ((m.districtName || '').toLowerCase() !== districtFilter.toLowerCase()) return false;
      }

      // Receipt Status Filter
      if (receiptStatusFilter !== 'ALL') {
        if ((m.receiptStatus || 'Pending') !== receiptStatusFilter) return false;
      }

      return true;
    });
  }, [
    unapprovedMembers,
    searchQuery,
    typeFilter,
    stateFilter,
    districtFilter,
    receiptStatusFilter
  ]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredList.length / pageSize));
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredList.slice(start, start + pageSize);
  }, [filteredList, currentPage, pageSize]);

  // Checkbox helpers
  const isAllPaginatedSelected = useMemo(() => {
    if (paginatedList.length === 0) return false;
    return paginatedList.every((m) => selectedIds.has(m.id));
  }, [paginatedList, selectedIds]);

  const handleToggleSelectAll = () => {
    const next = new Set(selectedIds);
    if (isAllPaginatedSelected) {
      paginatedList.forEach((m) => next.delete(m.id));
    } else {
      paginatedList.forEach((m) => next.add(m.id));
    }
    setSelectedIds(next);
  };

  const handleToggleSelectRow = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setTypeFilter('ALL');
    setStateFilter('ALL');
    setDistrictFilter('ALL');
    setReceiptStatusFilter('ALL');
    setCurrentPage(1);
  };

  // ----------------------------------------------------
  // SIMULATION HANDLER: TOGGLE RECEIPT STATUS
  // (Provides easy testing for receipt module connectivity)
  // ----------------------------------------------------
  const handleToggleReceiptMappingSimulation = (memberId) => {
    const updated = unapprovedMembers.map((m) => {
      if (m.id === memberId) {
        const isAssigned = m.receiptStatus === 'Assigned';
        const nextReceiptStatus = isAssigned ? 'Pending' : 'Assigned';
        const nextReceiptNo = isAssigned ? '' : `REC-${Math.floor(1000 + Math.random() * 9000)}`;

        return {
          ...m,
          receiptStatus: nextReceiptStatus,
          assignedReceiptNumber: nextReceiptNo
        };
      }
      return m;
    });

    persistUnapproved(updated);

    const target = updated.find((m) => m.id === memberId);
    if (target?.receiptStatus === 'Assigned') {
      showToast(
        `Receipt assigned for ${target.fullName} (${target.assignedReceiptNumber}). Ready for approval!`,
        'success'
      );
    } else {
      showToast(`Receipt status reset to Pending for ${target?.fullName}.`, 'info');
    }

    if (viewingMember && viewingMember.id === memberId) {
      setViewingMember(target);
    }
  };

  // ----------------------------------------------------
  // APPROVAL TRIGGER & VALIDATION
  // ----------------------------------------------------
  const handleInitiateApprove = (member) => {
    // 1. RECEIPT VALIDATION: Must have Receipt Status = Assigned
    const isReceiptAssigned = member.receiptStatus === 'Assigned';

    if (!isReceiptAssigned) {
      // BLOCK APPROVAL with required message
      setValidationBlockDialog(member);
      return;
    }

    // 2. Open Approval Confirmation Dialog
    setApproveDialog(member);
  };

  const handleConfirmApproval = () => {
    if (!approveDialog) return;
    const memberToApprove = approveDialog;

    // Load existing approved members
    const existingMembers = getStoredMembers();

    // Generate next sequential permanent membership number
    const maxNum = existingMembers.reduce((max, m) => {
      const num = parseInt(m.membershipNumber, 10);
      return !isNaN(num) && num > max ? num : max;
    }, 110);
    const nextMembershipNumber = (maxNum + 1).toString();

    // Construct approved member record preserving all existing data
    const approvedMemberRecord = {
      ...memberToApprove,
      membershipNumber: nextMembershipNumber,
      approvalStatus: 'Approved',
      status: 'Active',
      createdDate: memberToApprove.registrationDate || new Date().toISOString().split('T')[0],
      approvedDate: new Date().toISOString().split('T')[0],
      assignedReceiptNumber: memberToApprove.assignedReceiptNumber || 'REC-ONLINE'
    };

    // 1. Add to existing permanent Membership List
    const updatedApprovedMembers = [approvedMemberRecord, ...existingMembers];
    saveStoredMembers(updatedApprovedMembers);

    // 2. Remove from Unapproved Membership List
    const updatedUnapprovedList = unapprovedMembers.filter((m) => m.id !== memberToApprove.id);
    persistUnapproved(updatedUnapprovedList);

    // 3. Remove from selections
    if (selectedIds.has(memberToApprove.id)) {
      const next = new Set(selectedIds);
      next.delete(memberToApprove.id);
      setSelectedIds(next);
    }

    showToast(
      `Membership for ${approvedMemberRecord.fullName} approved successfully! Moved to Membership List (#${approvedMemberRecord.membershipNumber}).`,
      'success'
    );

    setApproveDialog(null);
    if (viewingMember) setViewingMember(null);
  };

  // Metric counts
  const countTotal = unapprovedMembers.length;
  const countPendingReceipt = unapprovedMembers.filter((m) => m.receiptStatus === 'Pending').length;
  const countAssigned = unapprovedMembers.filter((m) => m.receiptStatus === 'Assigned').length;

  return (
    <PermissionGate required="members.approvals.read">
    <div className="space-y-6">
      {/* ---------------------------------------------------- */}
      {/* HEADER, SEARCH & FILTERS SECTION                     */}
      {/* ---------------------------------------------------- */}
      <SearchFilterBar
        breadcrumb={
          <nav className="flex items-center gap-2 text-sm text-[#863221] font-medium mb-1">
            <Link to="/dashboard" className="hover:text-[#510601] transition-colors">
              Dashboard
            </Link>
            <ChevronRight className="w-4 h-4 text-[#863221]/50" />
            <span className="text-[#863221]">Membership</span>
            <ChevronRight className="w-4 h-4 text-[#863221]/50" />
            <span className="text-[#180200] font-semibold">Unapproved Membership</span>
          </nav>
        }
        title={<h1 className="text-2xl font-bold text-[#180200] tracking-tight">Unapproved Membership</h1>}
        searchQuery={searchQuery}
        onSearchChange={(val) => {
          setSearchQuery(val);
          setCurrentPage(1);
        }}
        searchPlaceholder="Search..."
        activeFiltersCount={
          (typeFilter !== 'ALL' ? 1 : 0) +
          (stateFilter !== 'ALL' ? 1 : 0) +
          (districtFilter !== 'ALL' ? 1 : 0) +
          (receiptStatusFilter !== 'ALL' ? 1 : 0)
        }
        onResetFilters={handleClearFilters}
        rightSlot={
          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 rounded-xl bg-white border border-[#E8DFD8] text-xs font-semibold text-[#863221] shadow-2xs flex items-center gap-1.5 shrink-0">
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              <span>{countTotal} Online</span>
            </span>
            <span className="px-3 py-1.5 rounded-xl bg-[#FAF7F2] border border-[#510601]/20 text-xs font-bold text-[#510601] shadow-2xs flex items-center gap-1.5 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#3D705C]" />
              <span>{countAssigned} Ready</span>
            </span>
          </div>
        }
      >
        {/* 1. Membership Type */}
        <FilterSelect
          value={typeFilter}
          onChange={(val) => {
            setTypeFilter(val);
            setCurrentPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All Membership Types' },
            ...membershipTypes.map((mt) => ({ value: mt.name, label: mt.name }))
          ]}
          widthClass="w-full sm:w-48"
        />

        {/* 2. Receipt Status */}
        <FilterSelect
          value={receiptStatusFilter}
          onChange={(val) => {
            setReceiptStatusFilter(val);
            setCurrentPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All Receipt Status' },
            { value: 'Pending', label: 'Pending' },
            { value: 'Assigned', label: 'Assigned' }
          ]}
          widthClass="w-full sm:w-40"
        />

        {/* 3. State */}
        <FilterSelect
          value={stateFilter}
          onChange={(val) => {
            setStateFilter(val);
            setDistrictFilter('ALL');
            setCurrentPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All States' },
            ...states.map((s) => ({ value: s.name, label: s.name }))
          ]}
          widthClass="w-full sm:w-44"
        />

        {/* 4. District */}
        <FilterSelect
          value={districtFilter}
          onChange={(val) => {
            setDistrictFilter(val);
            setCurrentPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All Districts' },
            ...filterDistricts.map((d) => ({ value: d.name, label: d.name }))
          ]}
          widthClass="w-full sm:w-48"
        />
      </SearchFilterBar>

      {/* ---------------------------------------------------- */}
      {/* UNAPPROVED MEMBERSHIP TABLE                          */}
      {/* ---------------------------------------------------- */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={isAllPaginatedSelected}
                    onChange={handleToggleSelectAll}
                    className="w-4 h-4 rounded border-[#E8DFD8] text-[#510601] focus:ring-[#510601] cursor-pointer accent-[#510601]"
                    title="Select All on page"
                  />
                </th>
                <th className="py-3 px-4">Online Applicant</th>
                <th className="py-3 px-4">Contact Details</th>
                <th className="py-3 px-4">Membership Type</th>
                <th className="py-3 px-4">State & District</th>
                <th className="py-3 px-4">Reg Date</th>
                <th className="py-3 px-4 text-center">Receipt Status</th>
                <th className="py-3 px-4 text-right min-w-[220px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8]">
              {paginatedList.length === 0 ? (
                <tr>
                  <td colSpan="8" className="py-12 text-center text-[#863221]">
                    <div className="flex flex-col items-center justify-center">
                      <CheckCircle2 className="w-8 h-8 text-[#3D705C]/50 mb-2" />
                      <p className="font-semibold text-sm text-[#180200]">No unapproved memberships</p>
                      <p className="text-xs text-[#863221] mt-1">
                        All online registrations have been reviewed and approved.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedList.map((m) => {
                  const isSelected = selectedIds.has(m.id);
                  const isAssigned = m.receiptStatus === 'Assigned';

                  return (
                    <tr
                      key={m.id}
                      className={`transition-colors ${isSelected ? 'bg-[#FAF7F2]/80' : 'hover:bg-[#FAF7F2]/40'
                        }`}
                    >
                      {/* Checkbox */}
                      <td className="py-3.5 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectRow(m.id)}
                          className="w-4 h-4 rounded border-[#E8DFD8] text-[#510601] focus:ring-[#510601] cursor-pointer accent-[#510601]"
                        />
                      </td>

                      {/* Name & Source */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#180200] text-sm">{m.fullName || m.name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                            {m.registrationSource || 'Online'}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#863221] mt-0.5 font-mono">
                          ID: {m.id}
                        </div>
                      </td>

                      {/* Contact Info */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5 font-mono font-medium text-xs text-[#180200]">
                          <Phone className="w-3 h-3 text-[#863221]/70 shrink-0" />
                          <span>{m.mobile || m.mobileNumber || '—'}</span>
                        </div>
                        {m.email && (
                          <div className="flex items-center gap-1.5 text-[11px] text-[#863221] mt-0.5 truncate max-w-[160px]">
                            <Mail className="w-3 h-3 text-[#863221]/70 shrink-0" />
                            <span className="truncate">{m.email}</span>
                          </div>
                        )}
                      </td>

                      {/* Membership Type */}
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#510601]/10 text-[#510601] border border-[#510601]/20">
                          <Award className="w-3.5 h-3.5" />
                          <span>{m.membershipType || 'Standard'}</span>
                        </span>
                      </td>

                      {/* State & District */}
                      <td className="py-3.5 px-4 text-[#863221]">
                        <div className="font-medium text-[#180200] text-xs">
                          {m.districtName || '—'}
                        </div>
                        <div className="text-[11px] text-[#863221]/80 mt-0.5">
                          {m.stateName || 'Karnataka'}
                        </div>
                      </td>

                      {/* Registration Date */}
                      <td className="py-3.5 px-4 font-mono text-xs text-[#180200]">
                        {m.registrationDate || '—'}
                      </td>

                      {/* Receipt Status Badge */}
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${isAssigned
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${isAssigned ? 'bg-emerald-600' : 'bg-amber-500'
                              }`}
                          />
                          <span>{m.receiptStatus || 'Pending'}</span>
                        </span>
                        {m.assignedReceiptNumber && (
                          <div className="text-[10px] font-mono text-[#510601] font-bold mt-0.5">
                            #{m.assignedReceiptNumber}
                          </div>
                        )}
                      </td>

                      {/* Actions: Assign to Receipt, View & Approve */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2 flex-wrap sm:flex-nowrap">
                          {/* 1. Assign to Receipt Action */}
                          <button
                            type="button"
                            onClick={() => navigate('/dashboard/receipts/entry', { state: { selectedMember: m } })}
                            className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 h-8 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer shrink-0 ${
                              isAssigned
                                ? 'bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300'
                                : 'bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white hover:shadow'
                            }`}
                            title={isAssigned ? `Receipt #${m.assignedReceiptNumber} assigned. Click to view or create another receipt.` : 'Open Receipt Entry and assign receipt to this applicant'}
                          >
                            <FileText className="w-3.5 h-3.5 shrink-0" />
                            <span>{isAssigned ? 'Assigned' : 'Assign to Receipt'}</span>
                          </button>

                          {/* 2. View Action */}
                          <button
                            type="button"
                            onClick={() => setViewingMember(m)}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 h-8 bg-white hover:bg-[#FAF7F2] text-[#510601] hover:text-[#180200] text-xs font-bold rounded-xl border border-[#E8DFD8] hover:border-[#510601] shadow-sm transition-all cursor-pointer shrink-0"
                            title="View Full Application"
                          >
                            <Eye className="w-3.5 h-3.5 shrink-0 text-[#863221]" />
                            <span>View</span>
                          </button>

                          {/* 3. Approve Action */}
                          <button
                            type="button"
                            onClick={() => handleInitiateApprove(m)}
                            disabled={!hasPermission('approvals.write')}
                            className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 h-8 text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${isAssigned
                              ? 'bg-[#3D705C] hover:bg-[#2e5646] text-white hover:shadow-md'
                              : 'bg-stone-100 hover:bg-stone-200 text-stone-500 border border-stone-200'
                              }`}
                            title={
                              !hasPermission('approvals.write')
                                ? 'Requires approvals.write permission'
                                : isAssigned
                                  ? 'Approve membership and transfer to Membership List'
                                  : 'Requires Receipt to be Assigned first'
                            }
                          >
                            <Check className="w-3.5 h-3.5 shrink-0" />
                            <span>Approve</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Section */}
        {filteredList.length > 0 && (
          <div className="p-4 border-t border-[#E8DFD8] bg-[#FAF7F2]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#863221]">
            <div className="flex items-center gap-2">
              <span>Showing</span>
              <span className="font-bold text-[#180200]">
                {Math.min((currentPage - 1) * pageSize + 1, filteredList.length)}
              </span>
              <span>to</span>
              <span className="font-bold text-[#180200]">
                {Math.min(currentPage * pageSize, filteredList.length)}
              </span>
              <span>of</span>
              <span className="font-bold text-[#180200]">{filteredList.length}</span>
              <span>unapproved applications</span>
            </div>

            <div className="flex items-center gap-4 self-end sm:self-auto">
              <div className="flex items-center gap-1.5">
                <span>Rows per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="py-1 px-2 text-xs bg-white border border-[#E8DFD8] rounded focus:outline-none focus:border-[#510601]"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="p-1.5 rounded-lg bg-white border border-[#E8DFD8] disabled:opacity-40 hover:bg-[#FAF7F2] transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-2 font-bold text-[#180200]">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="p-1.5 rounded-lg bg-white border border-[#E8DFD8] disabled:opacity-40 hover:bg-[#FAF7F2] transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================================================== */}
      {/* MODAL 1: VIEW UNAPPROVED MEMBER DETAILS MODAL        */}
      {/* ==================================================== */}
      <Modal isOpen={Boolean(viewingMember)} onClose={() => setViewingMember(null)}>
        {viewingMember && (
          <div
            className="bg-white rounded-2xl max-w-2xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2]">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-[#510601] text-white flex items-center justify-center font-bold text-base">
                  {(viewingMember.fullName || viewingMember.name || 'U').charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-[#180200]">
                      {viewingMember.fullName || viewingMember.name}
                    </h3>
                    <span className="font-mono text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200 font-bold">
                      {viewingMember.registrationSource || 'Online'}
                    </span>
                  </div>
                  <p className="text-xs text-[#863221]">
                    Application ID: <span className="font-mono">{viewingMember.id}</span> • Registered on {viewingMember.registrationDate || '—'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingMember(null)}
                className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto text-xs text-[#180200]">
              {/* Receipt Status Banner */}
              <div className="bg-[#FAF7F2] p-3.5 rounded-xl border border-[#E8DFD8] flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221] block">Receipt Assignment Status</span>
                  <span
                    className={`inline-block mt-1 px-2.5 py-0.5 rounded text-xs font-bold ${viewingMember.receiptStatus === 'Assigned'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                  >
                    {viewingMember.receiptStatus || 'Pending'}
                  </span>
                </div>
                {viewingMember.assignedReceiptNumber && (
                  <div className="text-right">
                    <span className="text-[10px] uppercase font-bold text-[#863221] block">Assigned Receipt</span>
                    <span className="font-mono font-bold text-xs text-[#510601]">
                      #{viewingMember.assignedReceiptNumber}
                    </span>
                  </div>
                )}
              </div>

              {/* Section 1: Personal Details */}
              <div className="bg-white rounded-xl p-4 border border-[#E8DFD8] space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#510601] uppercase tracking-wider">
                  <User className="w-4 h-4" />
                  <span>Personal / Basic Information</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Mobile</span>
                    <p className="font-mono font-bold text-sm text-[#510601] mt-0.5">
                      {viewingMember.mobile || viewingMember.mobileNumber || '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Phone (Alt)</span>
                    <p className="font-mono mt-0.5">{viewingMember.phone || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Email</span>
                    <p className="font-medium mt-0.5">{viewingMember.email || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Gotra</span>
                    <p className="font-bold mt-0.5">{viewingMember.gothra || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Blood Group</span>
                    <p className="font-bold mt-0.5">{viewingMember.bloodGroup || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Date of Birth</span>
                    <p className="font-medium mt-0.5">{viewingMember.birthDate || '—'}</p>
                  </div>
                </div>
              </div>

              {/* Section 2: Address & Location */}
              <div className="bg-white rounded-xl p-4 border border-[#E8DFD8] space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#510601] uppercase tracking-wider">
                  <MapPin className="w-4 h-4" />
                  <span>Address & Geographical Location</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="sm:col-span-2">
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Street Address</span>
                    <p className="font-medium mt-0.5">{viewingMember.addressLine || viewingMember.address || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">District & State</span>
                    <p className="font-medium mt-0.5">
                      {viewingMember.districtName || '—'}, {viewingMember.stateName || 'Karnataka'}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Post / Taluk</span>
                    <p className="font-medium mt-0.5">{viewingMember.talukName || viewingMember.post || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">PIN Code</span>
                    <p className="font-mono font-bold text-sm text-[#510601] mt-0.5">
                      {viewingMember.postalCode || '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Label Point / Hub</span>
                    <p className="font-medium mt-0.5">{viewingMember.labelPoint || 'Primary Hub'}</p>
                  </div>
                </div>
              </div>

              {/* Section 3: Membership Details */}
              <div className="bg-[#FAF7F2]/60 rounded-xl p-4 border border-[#E8DFD8] grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Membership Type</span>
                  <p className="font-bold text-[#510601] mt-0.5">{viewingMember.membershipType || 'Standard'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Category</span>
                  <p className="font-medium mt-0.5">{viewingMember.category || 'Individual'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Profession & Company</span>
                  <p className="font-medium mt-0.5">
                    {viewingMember.profession ? `${viewingMember.profession}` : '—'}
                    {viewingMember.company ? ` (${viewingMember.company})` : ''}
                  </p>
                </div>
                <div className="sm:col-span-3">
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Magazine Remarks</span>
                  <p className="font-medium mt-0.5">{viewingMember.magazineRemarks || 'None'}</p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-[#E8DFD8] bg-[#FAF7F2]">
              <button
                type="button"
                onClick={() => handleToggleReceiptMappingSimulation(viewingMember.id)}
                className="text-xs font-semibold text-[#510601] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>
                  {viewingMember.receiptStatus === 'Assigned'
                    ? 'Reset to Pending (Demo)'
                    : 'Simulate Receipt Assigned (Demo)'}
                </span>
              </button>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setViewingMember(null)}
                  className="py-2.5 px-4 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const m = viewingMember;
                    setViewingMember(null);
                    handleInitiateApprove(m);
                  }}
                  disabled={!hasPermission('approvals.write')}
                  title={!hasPermission('approvals.write') ? 'Requires approvals.write permission' : undefined}
                  className="py-2.5 px-5 bg-[#510601] hover:bg-[#863221] text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Approve Membership</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ==================================================== */}
      {/* MODAL 2: RECEIPT VALIDATION BLOCK ALERT MODAL        */}
      {/* ==================================================== */}
      <Modal isOpen={Boolean(validationBlockDialog)} onClose={() => setValidationBlockDialog(null)}>
        {validationBlockDialog && (
          <div
            className="bg-white rounded-2xl max-w-md w-full border border-[#E8DFD8] shadow-2xl p-6 text-center animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-3.5">
              <ShieldAlert className="w-7 h-7" />
            </div>

            <h3 className="text-lg font-bold text-[#180200]">Receipt Assignment Required</h3>

            <div className="mt-3 p-3 bg-amber-50 rounded-xl border border-amber-200 text-left space-y-1.5">
              <p className="text-xs font-bold text-amber-950">
                This membership cannot be approved until an official receipt is assigned.
              </p>
              <p className="text-[11px] text-amber-800">
                Applicant: <strong>{validationBlockDialog.fullName}</strong>
                <br />
                Receipt Status: <span className="font-semibold text-red-600">{validationBlockDialog.receiptStatus || 'Pending'}</span>
              </p>
            </div>

            <p className="text-xs text-[#863221] mt-3 leading-relaxed">
              According to the HMS membership workflow, all online registrations must have an official receipt assigned before final approval into the permanent Membership List.
            </p>

            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setValidationBlockDialog(null)}
                className="w-full py-2.5 px-4 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Understood / Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = validationBlockDialog.id;
                  setValidationBlockDialog(null);
                  handleToggleReceiptMappingSimulation(id);
                }}
                className="w-full py-2.5 px-4 bg-[#510601] hover:bg-[#863221] text-white text-xs font-bold rounded-xl shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Simulate Receipt Assignment</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ==================================================== */}
      {/* MODAL 3: APPROVAL CONFIRMATION DIALOG                */}
      {/* ==================================================== */}
      <Modal isOpen={Boolean(approveDialog)} onClose={() => setApproveDialog(null)}>
        {approveDialog && (
          <div
            className="bg-white rounded-2xl max-w-md w-full border border-[#E8DFD8] shadow-2xl p-6 text-center animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-3.5">
              <CheckCircle2 className="w-7 h-7" />
            </div>

            <h3 className="text-lg font-bold text-[#180200]">Approve Membership</h3>
            <p className="text-sm font-semibold text-[#510601] mt-2">
              Are you sure you want to approve this membership?
            </p>

            <div className="mt-3 p-3.5 bg-[#FAF7F2] rounded-xl border border-[#E8DFD8] text-xs text-left space-y-1">
              <div>
                <span className="text-[#863221]">Member Name: </span>
                <strong className="text-[#180200]">{approveDialog.fullName || approveDialog.name}</strong>
              </div>
              <div>
                <span className="text-[#863221]">Membership Type: </span>
                <strong className="text-[#510601]">{approveDialog.membershipType}</strong>
              </div>
              <div>
                <span className="text-[#863221]">Assigned Receipt: </span>
                <span className="font-mono font-bold text-emerald-700">
                  {approveDialog.assignedReceiptNumber || 'Assigned & Mapped'}
                </span>
              </div>
              <div className="pt-2 border-t border-[#E8DFD8] text-[11px] text-[#863221]">
                ✓ Member will be removed from Unapproved Membership and moved into the <strong>Membership List</strong>.
              </div>
            </div>

            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setApproveDialog(null)}
                className="w-full py-2.5 px-4 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmApproval}
                disabled={!hasPermission('approvals.write')}
                title={!hasPermission('approvals.write') ? 'Requires approvals.write permission' : undefined}
                className="w-full py-2.5 px-4 bg-[#3D705C] hover:bg-[#2F5747] text-white text-xs font-bold rounded-xl shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Approve</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ==================================================== */}
      {/* FLOATING TOAST NOTIFICATION                          */}
      {/* ==================================================== */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-fade-in-up">
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border text-sm font-medium ${toastMessage.type === 'error'
              ? 'bg-red-50 text-red-800 border-red-200'
              : toastMessage.type === 'info'
                ? 'bg-amber-50 text-amber-900 border-amber-200'
                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
              }`}
          >
            {toastMessage.type === 'error' ? (
              <AlertCircle className="w-5 h-5 text-red-600" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            )}
            <span>{toastMessage.message}</span>
          </div>
        </div>
      )}
    </div>
    </PermissionGate>
  );
}
