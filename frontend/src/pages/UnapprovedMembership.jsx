import React, { useState, useMemo, useEffect, useRef } from 'react';
import useSort from '../hooks/useSort';
import Pager from '../components/Pager';
import SortTh from '../components/SortTh';
import { Link, useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
import DateInput from '../components/DateInput';
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
  Link2,
  Loader2,
  ChevronRight,
  ChevronLeft,
  ShieldAlert,
  Sparkles,
  ArrowRight,
  XCircle,
  CheckSquare,
  LayoutGrid,
  List
} from 'lucide-react';
import api from '../api';
import { formatDate } from '../utils/dateUtils';
import MemberApplicationDetails from '../components/MemberApplicationDetails';
import { askReason } from '../utils/dialogs';
import { notify } from '../utils/notify';
import {
  loadUnapprovedPage,
  loadMembershipTypes,
  loadLocations
} from '../utils/serverData';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import useSwalConfirm from '../hooks/useSwalConfirm';
import { formatMoney } from '../utils/money';

import ModalFooter from '../components/ModalFooter';
// ----------------------------------------------------
// A receipt carries no member link of its own: one entered before the member existed only holds what
// the clerk wrote on it — the payer name, the mobile, and the number typed into the Membership No.
// box (often the applicant's own id, since an applicant has no membership number yet). These helpers
// only rank and label such receipts; mapping always stays a human click.
// ----------------------------------------------------
const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');
const flatText = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const receiptMatchScore = (candidate, member) => {
  if (!candidate || !member) return 0;
  let score = 0;
  const memberMobile = digitsOnly(member.mobile || member.mobileNumber);
  if (memberMobile && digitsOnly(candidate.payer_mobile) === memberMobile) score += 4;
  if (flatText(candidate.payer_membership_no) === String(member.id)) score += 3;
  const memberNumber = flatText(member.membershipNumber);
  if (memberNumber && flatText(candidate.payer_membership_no) === memberNumber) score += 3;
  const memberName = flatText(member.fullName || member.name);
  if (memberName && flatText(candidate.payer_name) === memberName) score += 2;
  return score;
};

// assignedOnly: the final-approval queue (members whose receipt is already assigned)
export default function UnapprovedMembership({ assignedOnly = false }) {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  // ----------------------------------------------------
  // DATA STORES
  // ----------------------------------------------------
  const [unapprovedMembers, setUnapprovedMembers] = useState([]); // ONE page (at most 200), the rest stays on the server
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [counts, setCounts] = useState({ with_receipt: 0, without_receipt: 0 });
  const [loadingPage, setLoadingPage] = useState(true);
  const [membershipTypes, setMembershipTypes] = useState([]);
  const [states, setStates] = useState([]);
  const [districts, setDistricts] = useState([]);

  const { sort, toggle: toggleSort, params: sortParams } = useSort();
  const requestSeq = useRef(0);
  // what the server is asked for: the page, the search, the filters and the sort. They run on every applicant in the
  // database; this screen only holds the page it shows (rule 10.6).
  const loadPage = async () => {
    const seq = (requestSeq.current += 1);
    setLoadingPage(true);
    try {
      const params = { page: currentPage, limit: pageSize, ...sortParams };
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      if (typeFilter !== 'ALL') {
        const type = membershipTypes.find((mt) => mt.name.toLowerCase() === typeFilter.toLowerCase());
        if (type) params.membership_type_id = type.id;
      }
      if (stateFilter !== 'ALL') {
        const st = states.find((x) => x.name.toLowerCase() === stateFilter.toLowerCase());
        if (st) params.state_id = st.id;
      }
      if (districtFilter !== 'ALL') {
        const d = districts.find((x) => x.name.toLowerCase() === districtFilter.toLowerCase());
        if (d) params.district_id = d.id;
      }
      if (receiptStatusFilter === 'Assigned') params.receipt_assigned = true;
      if (receiptStatusFilter === 'Pending') params.receipt_assigned = false;
      const result = await loadUnapprovedPage(params);
      if (seq !== requestSeq.current) return; // a newer request is on its way
      setUnapprovedMembers(result.rows);
      setTotal(result.total);
      setPages(Math.max(1, result.pages));
      if (result.summary) setCounts(result.summary);
      if (currentPage > Math.max(1, result.pages)) setCurrentPage(Math.max(1, result.pages));
    } catch (error) {
      if (seq !== requestSeq.current) return;
      console.error('Failed to load unapproved members.', error);
      showToast(error.response?.data?.detail || 'Failed to load unapproved members from the server.', 'error');
    } finally {
      if (seq === requestSeq.current) setLoadingPage(false);
    }
  };
  const reloadData = loadPage; // after an action the same page is read again

  const loadMasters = async () => {
    const fail = (what) => (error) => {
      console.error(`Failed to load ${what}.`, error);
      showToast(error.response?.data?.detail || `Failed to load ${what} from the server.`, 'error');
    };
    await Promise.all([
      loadMembershipTypes().then(setMembershipTypes).catch(fail('membership types')),
      loadLocations({ postalCodes: false })
        .then((loc) => {
          setStates(loc.states);
          setDistricts(loc.districts);
        })
        .catch(fail('locations'))
    ]);
  };

  useEffect(() => {
    loadMasters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState(null);
  const showToast = (message, type = 'success') => {
    notify(message, type);
  };

  // ----------------------------------------------------
  // SEARCH & FILTER STATE
  // ----------------------------------------------------
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [stateFilter, setStateFilter] = useState('ALL');
  const [districtFilter, setDistrictFilter] = useState('ALL');
  const [receiptStatusFilter, setReceiptStatusFilter] = useState(assignedOnly ? 'Assigned' : 'ALL');

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // the page is read again whenever the page, the search, a filter or the sort changes (default: newest first)
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const filterKey = [debouncedSearch, typeFilter, stateFilter, districtFilter, receiptStatusFilter, sort.by, sort.dir].join('|');
  const mastersReady = membershipTypes.length > 0 || states.length > 0;
  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, currentPage, pageSize, mastersReady]);
  useEffect(() => {
    setCurrentPage(1);
  }, [filterKey, pageSize]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Row Selection
  const selectionMode = true; // the checkboxes are always showing
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

  // 4. Assign Receipt Modal: map a receipt entered earlier to this applicant
  const [assigningMember, setAssigningMember] = useState(null); // the applicant being mapped
  const [assignCandidates, setAssignCandidates] = useState([]); // receipts still waiting for a member
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [assignSearch, setAssignSearch] = useState('');
  const [assignFrom, setAssignFrom] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [assignMin, setAssignMin] = useState('');
  const [assignMax, setAssignMax] = useState('');
  const [assignMatchOnly, setAssignMatchOnly] = useState(false);
  const [assignPage, setAssignPage] = useState(1);
  const [assignPageSize, setAssignPageSize] = useState(10);
  const [assignView, setAssignView] = useState('table'); // table | cards
  const [mappingReceiptId, setMappingReceiptId] = useState(null);
  // the API behind Map enforces receipts.write; the sibling Bulk Mapping screen uses the page privilege,
  // so either one is enough to press it
  const canMapReceipts = hasPermission('receipts.bulk_mapping.write') || hasPermission('receipts.write');

  // Districts for dropdown filter
  const filterDistricts = useMemo(() => {
    if (stateFilter === 'ALL') return districts;
    const st = states.find((s) => s.name.toLowerCase() === stateFilter.toLowerCase());
    return st ? districts.filter((d) => d.stateId === st.id) : districts;
  }, [districts, states, stateFilter]);

  const filteredList = unapprovedMembers; // the server already searched, filtered, sorted and paged them
  const paginatedList = unapprovedMembers;

  // Checkbox helpers
  // only an applicant whose receipt is assigned can be approved, so only those can be ticked
  const approvableList = useMemo(() => paginatedList.filter((m) => m.receiptStatus === 'Assigned'), [paginatedList]);
  const isAllPaginatedSelected = useMemo(() => {
    if (approvableList.length === 0) return false;
    return approvableList.every((m) => selectedIds.has(m.id));
  }, [approvableList, selectedIds]);

  const selectedCache = useRef(new Map()); // id -> applicant row, so a ticked applicant from another page still approves
  const handleToggleSelectAll = () => {
    const next = new Set(selectedIds);
    if (isAllPaginatedSelected) {
      approvableList.forEach((m) => next.delete(m.id));
    } else {
      approvableList.forEach((m) => { next.add(m.id); selectedCache.current.set(m.id, m); });
    }
    setSelectedIds(next);
  };

  const handleToggleSelectRow = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      const row = unapprovedMembers.find((m) => m.id === id);
      if (row) selectedCache.current.set(id, row);
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
  // A receipt is mapped to the applicant on the Receipt Entry screen
  // ----------------------------------------------------
  const goToReceiptEntry = (member) => {
    navigate('/dashboard/receipts/entry', { state: { selectedMember: member } });
  };

  // ----------------------------------------------------
  // ASSIGN A RECEIPT THAT WAS ENTERED EARLIER
  // The receipt is often entered before the member exists (a walk-in payer with a typed number), so the
  // money sits in the register with no member. "Assign Receipt" therefore lists every receipt still
  // waiting for a member and maps the picked one to this applicant, instead of opening the entry form
  // again (which would book a second receipt for money that is already recorded).
  // ----------------------------------------------------
  const [assignTotal, setAssignTotal] = useState(0);
  const [assignPages, setAssignPages] = useState(1);
  const assignSeq = useRef(0);
  const [assignDebounced, setAssignDebounced] = useState('');
  const loadAssignCandidates = async () => {
    if (!assigningMember) return;
    const seq = (assignSeq.current += 1);
    setAssignLoading(true);
    setAssignError('');
    try {
      const { data } = await api.get('/receipts/unassigned-candidates', {
        params: {
          page: assignPage, limit: assignPageSize, applicant_id: assigningMember.id,
          ...(assignDebounced.trim() ? { search: assignDebounced.trim() } : {}),
          ...(assignFrom ? { from_date: assignFrom } : {}),
          ...(assignTo ? { to_date: assignTo } : {}),
          ...(assignMin !== '' ? { min_amount: assignMin } : {}),
          ...(assignMax !== '' ? { max_amount: assignMax } : {}),
          ...(assignMatchOnly ? { likely_only: true } : {}),
        },
      });
      if (seq !== assignSeq.current) return;
      setAssignCandidates(data?.candidates || []);
      setAssignTotal(data?.total || 0);
      setAssignPages(Math.max(1, data?.pages || 1));
    } catch (error) {
      if (seq !== assignSeq.current) return;
      setAssignCandidates([]);
      setAssignError(
        error.response?.status === 403
          ? 'You need the Receipts read privilege to see the receipts waiting for a member.'
          : error.response?.data?.detail || 'Could not load the receipts waiting for a member.'
      );
    } finally {
      if (seq === assignSeq.current) setAssignLoading(false);
    }
  };

  const openAssignReceipt = (member) => {
    setAssigningMember(member);
    setAssignSearch('');
    setAssignFrom('');
    setAssignTo('');
    setAssignMin('');
    setAssignMax('');
    setAssignMatchOnly(false);
    setAssignPage(1);
  };

  const handleMapReceipt = async (candidate) => {
    if (!assigningMember) return;
    const who = assigningMember.fullName || assigningMember.name;
    setMappingReceiptId(candidate.receipt_id);
    try {
      const { data } = await api.post('/receipts/bulk-allocate', {
        allocations: [
          {
            receipt_id: candidate.receipt_id,
            member_id: assigningMember.id,
            allocated_amount: candidate.net_amount,
          },
        ],
      });
      if (data?.failed_count) {
        showToast(data.failed?.[0]?.reason || 'That receipt could not be mapped.', 'error');
      } else {
        showToast(`Receipt ${candidate.receipt_number} mapped to ${who}. Approval is no longer blocked.`, 'success');
        setAssigningMember(null);
      }
      await reloadData();
    } catch (error) {
      showToast(error.response?.data?.detail || 'Error mapping the receipt', 'error');
    } finally {
      setMappingReceiptId(null);
    }
  };

  // Every parked receipt, filtered by what the clerk types and ranked: one that carries this applicant's
  // mobile / id / name comes first and is labelled, but none is ever mapped without a click.
  const assignRows = assignCandidates; // the server filtered, ranked (likeliest first) and paged them
  const assignTotalPages = assignPages;
  const assignPageRows = assignCandidates;
  useEffect(() => {
    const timer = setTimeout(() => setAssignDebounced(assignSearch), 350);
    return () => clearTimeout(timer);
  }, [assignSearch]);
  useEffect(() => { setAssignPage(1); }, [assignDebounced, assignFrom, assignTo, assignMin, assignMax, assignMatchOnly, assignPageSize]);
  useEffect(() => {
    loadAssignCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assigningMember?.id, assignPage, assignPageSize, assignDebounced, assignFrom, assignTo, assignMin, assignMax, assignMatchOnly]);

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

  // Reject = remove the application (the server records the reason)
  const handleReject = async (member) => {
    const reason = await askReason({
      title: `Reject ${member.fullName || member.name}?`,
      text: 'The application is removed from the unapproved list.',
      confirmText: 'Yes, reject',
      danger: true
    });
    if (!reason) return;
    try {
      const { data } = await api.delete(`/members/${member.id}`, { params: { reason, mode: 'SOFT' } });
      showToast(
        data?.status === 'PENDING'
          ? `Rejection of ${member.fullName || member.name} submitted for approval.`
          : `Application of ${member.fullName || member.name} rejected.`
      );
      if (viewingMember) setViewingMember(null);
      await reloadData();
    } catch (error) {
      showToast(error.response?.data?.detail || 'Error rejecting the application', 'error');
    }
  };

  const handleConfirmApproval = async () => {
    if (!approveDialog) return;
    const memberToApprove = approveDialog;
    try {
      const { data } = await api.put(`/members/${memberToApprove.id}/approve`, null, { params: { reason: 'Approved via UI' } });
      if (selectedIds.has(memberToApprove.id)) {
        const next = new Set(selectedIds);
        next.delete(memberToApprove.id);
        setSelectedIds(next);
      }
      showToast(
        `Membership for ${memberToApprove.fullName} approved successfully! Moved to Membership List${data?.member_code ? ` (${data.member_code})` : ''}.`,
        'success'
      );
      if (viewingMember) setViewingMember(null);
      await reloadData();
    } catch (error) {
      showToast(error.response?.data?.detail || 'Error approving membership', 'error');
    }
    setApproveDialog(null);
  };

  // Bulk Approval for selected items in selection mode
  const handleBulkApprove = async () => {
    const selectedMembers = [...selectedIds].map((id) => selectedCache.current.get(id)).filter(Boolean);
    if (selectedMembers.length === 0) return;

    const unassigned = selectedMembers.filter((m) => m.receiptStatus !== 'Assigned');
    if (unassigned.length > 0) {
      showToast(
        `${unassigned.length} selected applicant(s) do not have a receipt assigned yet. Only applicants with assigned receipts can be approved.`,
        'error'
      );
      return;
    }

    let approvedCount = 0;
    for (const m of selectedMembers) {
      try {
        await api.put(`/members/${m.id}/approve`, null, { params: { reason: 'Bulk approved via UI' } });
        approvedCount++;
      } catch (err) {
        console.error(`Failed to approve member ${m.id}`, err);
      }
    }
    showToast(`Successfully approved ${approvedCount} member(s)!`, 'success');
    setSelectedIds(new Set());
    await reloadData();
  };

  // Metric counts
  const countTotal = counts.with_receipt + counts.without_receipt;
  const countPendingReceipt = counts.without_receipt;
  const countAssigned = counts.with_receipt;

  useSwalConfirm(
    validationBlockDialog,
    () => setValidationBlockDialog(null),
    (d) => ({
      title: 'Receipt assignment required',
      text: `${d.fullName} cannot be approved until an official receipt is assigned (receipt status: ${d.receiptStatus || 'Pending'}).`,
      confirmText: 'Assign a receipt',
    }),
    () => openAssignReceipt(validationBlockDialog)
  );

  useSwalConfirm(
    approveDialog,
    () => setApproveDialog(null),
    (d) => ({
      title: 'Approve membership?',
      text: `Approve ${d.fullName || d.name} (${d.membershipType})? The member moves to the Membership List.`,
      confirmText: 'Yes, approve',
    }),
    handleConfirmApproval
  );

  return (
    <PermissionGate required="members.unapproved.read">
    <div className="space-y-6">
      {/* ---------------------------------------------------- */}
      {/* HEADER, SEARCH & FILTERS SECTION                     */}
      {/* ---------------------------------------------------- */}
      <SearchFilterBar
        
        title={<h1 className="text-xl sm:text-2xl font-bold text-[#180200] tracking-tight">{assignedOnly ? 'Assigned for Approval' : 'Unapproved Membership'}</h1>}
        searchQuery={searchQuery}
        onSearchChange={(val) => {
          setSearchQuery(val);
          setCurrentPage(1);
        }}
        activeFiltersCount={
          (typeFilter !== 'ALL' ? 1 : 0) +
          (stateFilter !== 'ALL' ? 1 : 0) +
          (districtFilter !== 'ALL' ? 1 : 0) +
          (receiptStatusFilter !== 'ALL' ? 1 : 0)
        }
        onResetFilters={handleClearFilters}
        rightSlot={
          (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-[#510601] bg-[#FAF7F2] px-2.5 py-1.5 rounded-lg border border-[#E8DFD8]">
                {selectedIds.size} selected
              </span>
              {selectedIds.size > 0 && (
                hasPermission('members.unapproved.write') && (
                  <button
                    type="button"
                    onClick={handleBulkApprove}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#510601] hover:bg-[#863221] text-white text-xs font-bold rounded-xl transition-all shadow-sm cursor-pointer disabled:opacity-40"
                    title="Approve selected members"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Approve Selected</span>
                  </button>
                )
              )}
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="flex items-center gap-1 px-3 py-1.5 bg-white border border-[#E8DFD8] text-[#863221] hover:text-[#180200] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                  title="Untick everything"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              )}
            </div>
          )
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

        {/* 2. Receipt Status (the Assigned queue is already limited to assigned receipts) */}
        {!assignedOnly && <FilterSelect
          value={receiptStatusFilter}
          onChange={(val) => {
            setReceiptStatusFilter(val);
            setCurrentPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All Receipt Status' },
            { value: 'Pending', label: 'Unassigned' },
            { value: 'Assigned', label: 'Assigned' }
          ]}
          widthClass="w-full sm:w-40"
        />}

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
                {selectionMode && (
                  <th className="py-3 px-4 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={isAllPaginatedSelected}
                      disabled={approvableList.length === 0}
                      onChange={handleToggleSelectAll}
                      className="w-4 h-4 rounded border-[#E8DFD8] text-[#510601] focus:ring-[#510601] cursor-pointer accent-[#510601] disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Select every applicant on this page whose receipt is assigned"
                    />
                  </th>
                )}
                <SortTh label="Applicant" field="name" sort={sort} onSort={toggleSort} className="py-3 px-4" />
                <SortTh label="Contact" field="mobile" sort={sort} onSort={toggleSort} className="py-3 px-4" />
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4 text-center">Receipt</th>
                <th className="py-3 px-4 text-right min-w-[220px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8]">
              {paginatedList.length === 0 ? (
                <tr>
                  <td colSpan={selectionMode ? 6 : 5} className="py-12 text-center text-[#863221]">
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
                      className={`transition-colors ${isSelected ? 'bg-[#FAF7F2]' : 'bg-white hover:bg-[#FAF7F2]'
                        }`}
                    >
                      {/* Checkbox */}
                      {selectionMode && (
                        <td className="py-3.5 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!isAssigned}
                            title={isAssigned ? undefined : 'Assign a receipt first, then this applicant can be approved'}
                            onChange={() => handleToggleSelectRow(m.id)}
                            className="w-4 h-4 rounded border-[#E8DFD8] text-[#510601] focus:ring-[#510601] cursor-pointer accent-[#510601] disabled:opacity-30 disabled:cursor-not-allowed"
                          />
                        </td>
                      )}

                      {/* Name & Source */}
                      <td className="py-3.5 px-4">
                        <span className="font-bold text-[#180200] text-sm">{m.fullName || m.name}</span>
                        <div className="text-[11px] text-[#863221] mt-0.5 font-mono">
                          ID: {m.id} · {m.registrationSource || '—'}
                        </div>
                      </td>

                      {/* Contact Info */}
                      <td className="py-3.5 px-4">
                        <div className="font-mono font-medium text-xs text-[#180200]">{m.mobile || m.mobileNumber || '—'}</div>
                        {m.email && <div className="text-[11px] text-[#863221] mt-0.5 truncate max-w-[160px]">{m.email}</div>}
                      </td>

                      {/* Membership Type */}
                      <td className="py-3.5 px-4 text-xs font-semibold text-[#510601]">{m.membershipType || '—'}</td>

                      {/* Receipt Status Badge */}
                      <td className="py-3.5 px-4 text-center">
                        <span className={`chip ${isAssigned ? 'chip-on' : 'chip-warn'}`}>
                          {(m.receiptStatus || 'Pending') === 'Pending' ? 'Unassigned' : m.receiptStatus}
                        </span>
                        {m.assignedReceiptNumber && (
                          <div className="text-[10px] font-mono text-[#510601] font-bold mt-0.5">
                            {m.assignedReceiptNumber}
                          </div>
                        )}
                      </td>

                      {/* Actions: Assign to Receipt, View & Approve */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {/* 1. Assign to Receipt Action */}
                          <button
                            type="button"
                            onClick={() => openAssignReceipt(m)}
                            className="btn-act"
                            title={
                              isAssigned
                                ? `Receipt ${m.assignedReceiptNumber} is already mapped. Click to map another receipt entered earlier.`
                                : 'List the receipts already entered and map one to this applicant'
                            }
                          >
                            <FileText className="w-3.5 h-3.5 shrink-0" />
                            <span>{isAssigned ? 'Receipt' : 'Assign Receipt'}</span>
                          </button>

                          {/* 2. View Action */}
                          <button
                            type="button"
                            onClick={() => navigate(`/dashboard/membership/profile/${m.id}`)}
                            className="btn-act"
                            title="View Full Application"
                          >
                            <Eye className="w-3.5 h-3.5 shrink-0" />
                            <span>View</span>
                          </button>

                          {/* Edit is its own action, not part of View */}
                          {hasPermission('members.list.write') && (
                            <button
                              type="button"
                              onClick={() => navigate(`/dashboard/membership/edit/${m.id}`, { state: { returnPath: '/dashboard/membership/unapproved' } })}
                              className="btn-act"
                              title={'Edit Application'}
                            >
                              <span>Edit</span>
                            </button>
                          )}

                          {/* 3. Approve Action */}
                          {hasPermission('members.unapproved.write') && (
                            <button
                              type="button"
                              onClick={() => handleInitiateApprove(m)}
                              className={`btn-act btn-act-ok ${isAssigned ? '' : 'opacity-40 cursor-not-allowed'}`}
                              title={
                                !hasPermission('members.unapproved.write')
                                  ? 'Requires members.unapproved.write permission'
                                  : isAssigned
                                    ? 'Approve membership and transfer to Membership List'
                                    : 'Requires Receipt to be Assigned first'
                              }
                            >
                              <Check className="w-3.5 h-3.5 shrink-0" />
                              <span>Approve</span>
                            </button>
                          )}

                          {/* 4. Reject Action */}
                          {hasPermission('members.list.delete') && (
                            <button
                              type="button"
                              onClick={() => handleReject(m)}
                              className="btn-act btn-act-danger"
                              title={'Reject this application'}
                            >
                              <XCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>Reject</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Section: the server pages the list */}
        {total > 0 && (
          <div className="p-4 border-t border-[#E8DFD8] bg-[#FAF7F2]">
            <Pager page={currentPage} pages={pages} total={total} pageSize={pageSize} onPage={setCurrentPage} onPageSize={setPageSize} />
          </div>
        )}
      </div>

      {/* ---------------------------------------------------- */}
      {/* ASSIGN A RECEIPT: map a receipt that was entered BEFORE this member existed */}
      {/* ---------------------------------------------------- */}
      {assigningMember && (
        <Modal
          isOpen
          onClose={() => setAssigningMember(null)}
          title={`Assign a receipt to ${assigningMember.fullName || assigningMember.name}`}
          maxWidthClass="max-w-6xl"
          heightClass="h-[90vh]"
          footer={<ModalFooter kind="view" onCancel={() => setAssigningMember(null)} />}
        >
          <div className="p-5 flex flex-col gap-4 flex-1 min-h-0">
            {/* Who the money will be mapped to */}
            <div className="bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#180200]">{assigningMember.fullName || assigningMember.name}</div>
                <div className="text-[11px] text-[#863221] font-mono mt-0.5">
                  ID {assigningMember.id}
                  {assigningMember.mobile ? ` · ${assigningMember.mobile}` : ''}
                  {assigningMember.membershipType ? ` · ${assigningMember.membershipType}` : ''}
                </div>
              </div>
              <span className={`chip ${assigningMember.receiptStatus === 'Assigned' ? 'chip-on' : 'chip-warn'}`}>
                {assigningMember.receiptStatus === 'Assigned' ? `Receipt ${assigningMember.assignedReceiptNumber}` : 'No receipt yet'}
              </span>
            </div>

            {/* Search and filters */}
            <div className="flex flex-wrap items-end gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 text-[#863221] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={assignSearch}
                  onChange={(e) => setAssignSearch(e.target.value)}
                  placeholder="Receipt no., payer, mobile or amount"
                  disabled={!!assignError}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl focus:outline-none focus:border-[#510601] disabled:bg-[#FAF7F2]"
                />
              </div>
              <div className="w-[130px]">
                <DateInput value={assignFrom} onChange={(e) => setAssignFrom(e.target.value)} placeholder="From date"
                  className="w-full px-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl focus:outline-none focus:border-[#510601]" />
              </div>
              <div className="w-[130px]">
                <DateInput value={assignTo} onChange={(e) => setAssignTo(e.target.value)} placeholder="To date"
                  className="w-full px-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl focus:outline-none focus:border-[#510601]" />
              </div>
              <input type="number" min="0" value={assignMin} onChange={(e) => setAssignMin(e.target.value)} placeholder="Min ₹"
                className="w-[90px] px-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl focus:outline-none focus:border-[#510601]" />
              <input type="number" min="0" value={assignMax} onChange={(e) => setAssignMax(e.target.value)} placeholder="Max ₹"
                className="w-[90px] px-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl focus:outline-none focus:border-[#510601]" />
              <div className="inline-flex rounded-xl border border-[#E8DFD8] bg-white p-0.5 text-xs font-bold">
                <button type="button" onClick={() => setAssignMatchOnly(false)}
                  className={`px-3 py-1.5 rounded-lg cursor-pointer ${!assignMatchOnly ? 'bg-[#510601] text-white' : 'text-[#863221]'}`}>All</button>
                <button type="button" onClick={() => setAssignMatchOnly(true)}
                  className={`px-3 py-1.5 rounded-lg cursor-pointer ${assignMatchOnly ? 'bg-[#510601] text-white' : 'text-[#863221]'}`}>Likely matches</button>
              </div>
              <div className="inline-flex rounded-xl border border-[#E8DFD8] bg-white p-0.5">
                <button type="button" title="Table" onClick={() => setAssignView('table')}
                  className={`p-1.5 rounded-lg cursor-pointer ${assignView === 'table' ? 'bg-[#510601] text-white' : 'text-[#863221]'}`}><List className="w-4 h-4" /></button>
                <button type="button" title="Cards" onClick={() => setAssignView('cards')}
                  className={`p-1.5 rounded-lg cursor-pointer ${assignView === 'cards' ? 'bg-[#510601] text-white' : 'text-[#863221]'}`}><LayoutGrid className="w-4 h-4" /></button>
              </div>
              <button type="button" onClick={loadAssignCandidates} title="Reload"
                className="p-2 bg-white border border-[#E8DFD8] hover:border-[#510601] text-[#863221] hover:text-[#510601] rounded-xl cursor-pointer">
                <RefreshCw className={`w-3.5 h-3.5 ${assignLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* The receipts waiting for a member: the only part that scrolls */}
            <div className="flex-1 min-h-0 overflow-y-auto">
            {assignLoading ? (
              <div className="py-12 text-center text-sm text-[#863221]">Loading receipts…</div>
            ) : assignError ? (
              <div className="py-12 px-6 text-center text-sm text-[#863221]">{assignError}</div>
            ) : assignRows.length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle2 className="w-7 h-7 text-[#3D705C]/50 mx-auto mb-1.5" />
                <p className="font-semibold text-sm text-[#180200]">
                  {!(assignDebounced.trim() || assignFrom || assignTo || assignMin !== '' || assignMax !== '' || assignMatchOnly) ? 'No receipt is waiting for a member' : 'No receipt matches these filters'}
                </p>
              </div>
            ) : assignView === 'table' ? (
              <div className="border border-[#E8DFD8] rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-[#FAF7F2] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">Receipt No.</th>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3 text-right">Amount</th>
                      <th className="py-2.5 px-3">Payer</th>
                      <th className="py-2.5 px-3">No. on Receipt</th>
                      <th className="py-2.5 px-3 text-right">Map</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8DFD8]">
                    {assignPageRows.map((c) => {
                      const hinted = c.likely_score > 0;
                      return (
                        <tr key={c.receipt_id} className="bg-white hover:bg-[#FAF7F2] transition-colors">
                          <td className="py-2.5 px-3 align-top">
                            <div className="font-mono font-bold text-[#510601]">{c.receipt_number}</div>
                            {hinted && <span className="chip chip-on mt-1">likely match</span>}
                          </td>
                          <td className="py-2.5 px-3 align-top text-[#180200] whitespace-nowrap">{formatDate(c.receipt_date)}</td>
                          <td className="py-2.5 px-3 align-top text-right font-bold text-[#180200] whitespace-nowrap">{formatMoney(c.net_amount)}</td>
                          <td className="py-2.5 px-3 align-top text-[#180200]">
                            {c.payer_name || '—'}
                            {c.payer_mobile ? <div className="text-[10px] font-mono text-[#863221]">{c.payer_mobile}</div> : null}
                          </td>
                          <td className="py-2.5 px-3 align-top font-mono text-[#863221]">{c.payer_membership_no || '—'}</td>
                          <td className="py-2.5 px-3 align-top text-right">
                            <button
                              type="button"
                              onClick={() => handleMapReceipt(c)}
                              disabled={!canMapReceipts || mappingReceiptId === c.receipt_id}
                              className={`btn-act btn-act-ok ${canMapReceipts ? '' : 'opacity-40 cursor-not-allowed'}`}
                              title={canMapReceipts ? `Map receipt ${c.receipt_number}` : 'Requires the receipts write privilege'}
                            >
                              {mappingReceiptId === c.receipt_id ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <Link2 className="w-3.5 h-3.5 shrink-0" />}
                              <span>Map</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {assignPageRows.map((c) => {
                  const hinted = c.likely_score > 0;
                  return (
                    <div key={c.receipt_id} className={`rounded-xl border p-3 bg-white ${hinted ? 'border-[#3D705C]/50' : 'border-[#E8DFD8]'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-mono font-bold text-sm text-[#510601]">{c.receipt_number}</div>
                          <div className="text-[11px] text-[#863221]">{formatDate(c.receipt_date)}</div>
                        </div>
                        <div className="text-right font-bold text-sm text-[#180200]">{formatMoney(c.net_amount)}</div>
                      </div>
                      <div className="mt-2 text-xs text-[#180200]">
                        {c.payer_name || '—'}
                        {c.payer_mobile ? <span className="ml-2 font-mono text-[11px] text-[#863221]">{c.payer_mobile}</span> : null}
                      </div>
                      {c.payer_membership_no ? <div className="text-[11px] font-mono text-[#863221]">No. {c.payer_membership_no}</div> : null}
                      <div className="mt-2 flex items-center justify-between">
                        {hinted ? <span className="chip chip-on">likely match</span> : <span />}
                        <button
                          type="button"
                          onClick={() => handleMapReceipt(c)}
                          disabled={!canMapReceipts || mappingReceiptId === c.receipt_id}
                          className={`btn-act btn-act-ok ${canMapReceipts ? '' : 'opacity-40 cursor-not-allowed'}`}
                        >
                          {mappingReceiptId === c.receipt_id ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <Link2 className="w-3.5 h-3.5 shrink-0" />}
                          <span>Map</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            </div>

            {/* Pages */}
            {assignRows.length > 0 && !assignLoading && !assignError && (
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#863221]">
                <span>
                  Showing {(assignPage - 1) * assignPageSize + 1}–{Math.min(assignPage * assignPageSize, assignTotal)} of {assignTotal}
                </span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5">
                    <span>Rows</span>
                    <select value={assignPageSize} onChange={(e) => setAssignPageSize(Number(e.target.value))}
                      className="px-2 py-1 bg-white border border-[#E8DFD8] rounded-lg text-xs cursor-pointer">
                      {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <div className="flex items-center gap-1">
                    <button type="button" disabled={assignPage <= 1} onClick={() => setAssignPage((p) => p - 1)}
                      className="px-2 py-1 rounded-lg border border-[#E8DFD8] bg-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">‹</button>
                    {Array.from({ length: assignTotalPages }, (_, i) => i + 1)
                      .filter((n) => n === 1 || n === assignTotalPages || Math.abs(n - assignPage) <= 1)
                      .map((n, i, arr) => (
                        <React.Fragment key={n}>
                          {i > 0 && n - arr[i - 1] > 1 && <span className="px-1">…</span>}
                          <button type="button" onClick={() => setAssignPage(n)}
                            className={`min-w-[28px] px-2 py-1 rounded-lg border cursor-pointer ${n === assignPage ? 'bg-[#510601] text-white border-[#510601]' : 'bg-white border-[#E8DFD8]'}`}>{n}</button>
                        </React.Fragment>
                      ))}
                    <button type="button" disabled={assignPage >= assignTotalPages} onClick={() => setAssignPage((p) => p + 1)}
                      className="px-2 py-1 rounded-lg border border-[#E8DFD8] bg-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">›</button>
                  </div>
                </div>
              </div>
            )}

            {/* Not entered at all */}
            <div className="flex items-center justify-between gap-3 border-t border-[#E8DFD8] pt-3">
              <span className="text-xs font-semibold text-[#180200]">Receipt not entered yet?</span>
              <button
                type="button"
                onClick={() => {
                  const applicant = assigningMember;
                  setAssigningMember(null);
                  goToReceiptEntry(applicant);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-[#E8DFD8] hover:border-[#510601] text-[#863221] hover:text-[#510601] text-xs font-bold rounded-xl transition-all cursor-pointer shrink-0"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>Enter a new receipt</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* View Application is rendered on dedicated full-screen page /dashboard/membership/profile/:id */}
      {false && viewingMember && (
          <div
            className="bg-white rounded-2xl max-w-4xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
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
                      {viewingMember.registrationSource || '—'}
                    </span>
                  </div>
                  <p className="text-xs text-[#863221]">
                    Application ID: <span className="font-mono">{viewingMember.id}</span> • Registered on {formatDate(viewingMember.registrationDate)}
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
            <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs text-[#180200]">
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
                    {(viewingMember.receiptStatus || 'Pending') === 'Pending' ? 'Unassigned' : viewingMember.receiptStatus}
                  </span>
                </div>
                {viewingMember.assignedReceiptNumber && (
                  <div className="text-right">
                    <span className="text-[10px] uppercase font-bold text-[#863221] block">Assigned Receipt</span>
                    <span className="font-mono font-bold text-xs text-[#510601]">
                      {viewingMember.assignedReceiptNumber}
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
                    <p className="font-medium mt-0.5">{formatDate(viewingMember.birthDate)}</p>
                  </div>
                </div>
              </div>

              {/* New registration-form details */}
              <MemberApplicationDetails member={viewingMember} />

              {/* The receipt linked to this application */}
              {viewingMember.receipt && (
                <div className="bg-white rounded-xl p-4 border border-[#E8DFD8] space-y-3">
                  <div className="text-xs font-bold text-[#510601] uppercase tracking-wider">Receipt Information</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#863221]">Receipt Number</span>
                      <p className="font-mono font-bold mt-0.5">{viewingMember.receipt.receiptNumber || '—'}</p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#863221]">Receipt Date</span>
                      <p className="font-medium mt-0.5">{formatDate(viewingMember.receipt.receiptDate)}</p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#863221]">Amount</span>
                      <p className="font-mono font-bold mt-0.5">{formatMoney(viewingMember.receipt.amount || 0)}</p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#863221]">Payment Mode</span>
                      <p className="font-medium mt-0.5">{viewingMember.receipt.paymentMode || '—'}</p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#863221]">Bank Account</span>
                      <p className="font-medium mt-0.5">{viewingMember.receipt.bankName || '—'}</p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-[#863221]">Transaction ID</span>
                      <p className="font-mono mt-0.5">{viewingMember.receipt.transactionId || '—'}</p>
                    </div>
                  </div>
                </div>
              )}

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
                      {[viewingMember.districtName, viewingMember.stateName].filter(Boolean).join(', ') || '—'}
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
                  <p className="font-bold text-[#510601] mt-0.5">{viewingMember.membershipType || '—'}</p>
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

            {/* Read-only footer */}
            </div>
            <ModalFooter kind="view" onCancel={() => setViewingMember(null)} />
          </div>
      )}

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
