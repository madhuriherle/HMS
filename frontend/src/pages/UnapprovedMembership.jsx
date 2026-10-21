import React, { useState, useMemo, useEffect, useRef } from 'react';
import useSort from '../hooks/useSort';
import Pager from '../components/Pager';
import SortTh from '../components/SortTh';
import { useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
import DateInput from '../components/DateInput';
import {
  User,
  Search,
  Eye,
  CheckCircle2,
  X,
  AlertCircle,
  MapPin,
  Phone,
  Check,
  RefreshCw,
  FileText,
  Link2,
  Loader2,
  ArrowRight,
  XCircle,
  LayoutGrid,
  List,
  Download,
  RotateCcw,
} from 'lucide-react';
import api from '../api';
import { formatDate } from '../utils/dateUtils';
import MemberApplicationDetails from '../components/MemberApplicationDetails';
import { askReason } from '../utils/dialogs';
import { notify } from '../utils/notify';
import { loadUnapprovedPage, loadMembershipTypes, loadLocations } from '../utils/serverData';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import useSwalConfirm from '../hooks/useSwalConfirm';
import { formatMoney } from '../utils/money';

import ModalFooter from '../components/ModalFooter';
import ReceiptViewModal from '../components/ReceiptViewModal';
import { fetchReceiptRow } from '../utils/apiAdapters';
// ----------------------------------------------------
// A receipt carries no member link of its own: one entered before the member existed only holds what
// the clerk wrote on it — the payer name, the mobile, and the number typed into the Membership No.
// box (often the applicant's own id, since an applicant has no membership number yet). These helpers
// only rank and label such receipts; mapping always stays a human click.
// ----------------------------------------------------


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
  const [, setLoadingPage] = useState(true);
  const [membershipTypes, setMembershipTypes] = useState([]);
  const [states, setStates] = useState([]);
  const [districts, setDistricts] = useState([]);

  const { sort, toggle: toggleSort, params: sortParams } = useSort();
  const requestSeq = useRef(0);
  // Disagree puts an applicant under Rejected; Re-open brings them back. The meeting PDF logs who was on it.
  const [statusFilter, setStatusFilter] = useState('UNAPPROVED'); // UNAPPROVED | REJECTED
  const [exportFilter, setExportFilter] = useState('ALL'); // ALL | EXPORTED | NOT_EXPORTED
  const [exportedOn, setExportedOn] = useState(''); // a day: only those on the PDF exported that day
  const [exporting, setExporting] = useState(false);
  const meetingParams = () => {
    const extra = { approval_status: statusFilter };
    if (exportedOn) extra.exported_on = exportedOn;
    else if (exportFilter === 'EXPORTED') extra.exported = true;
    else if (exportFilter === 'NOT_EXPORTED') extra.exported = false;
    return extra;
  };
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
      Object.assign(params, meetingParams());
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
  const [toastMessage] = useState(null);
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
  const filterKey = [debouncedSearch, typeFilter, stateFilter, districtFilter, receiptStatusFilter, statusFilter, exportFilter, exportedOn, sort.by, sort.dir].join('|');
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
  const [assignMatchOnly, setAssignMatchOnly] = useState(true);
  const [assignShowAll, setAssignShowAll] = useState(false); // off: only receipts with a Membership line (the only ones that can pay for a membership)
  const [assignPage, setAssignPage] = useState(1);
  const [assignPageSize, setAssignPageSize] = useState(10);
  const [assignView, setAssignView] = useState('cards'); // table | cards (cards by default)
  const [mappingReceiptId, setMappingReceiptId] = useState(null);
  const [receiptView, setReceiptView] = useState(null); // { member, receipt }: the receipt already assigned to an applicant
  // the same receipt popup as Receipt Tracking: the receipt is read in full (with its particulars) before it opens
  const openAssignedReceipt = async (m) => {
    let full = null;
    try {
      full = await fetchReceiptRow({ id: m.receipt?.id, number: m.assignedReceiptNumber, memberId: m.id });
    } catch (_) {
      full = null;
    }
    setReceiptView({ member: m, receipt: full || m.receipt });
  };
  const [replacingReceipt, setReplacingReceipt] = useState(null); // the assigned receipt the picked one will replace
  useEffect(() => { if (!assigningMember) setReplacingReceipt(null); }, [assigningMember]);
  // the API behind Map enforces receipts.write; the sibling Bulk Mapping screen uses the page privilege,
  // so either one is enough to press it
  const canMapReceipts = hasPermission('receipts.bulk_mapping.write') || hasPermission('receipts.write');
  const canEnterReceipt = hasPermission('receipts.entry.write') || hasPermission('receipts.write'); // making a new receipt is Receipt Entry's privilege, not mapping's
  // what a receipt was for: the first line, and +N when there are more
  const assignItemsText = (c) => {
    const lines = c.items || [];
    if (lines.length === 0) return String(c.receipt_type || '').replace(/_/g, ' ') || '—';
    const sub = lines[0].sub_type || lines[0].detail;
    const first = sub && sub !== lines[0].particular ? `${lines[0].particular} › ${sub}` : lines[0].particular;
    return lines.length > 1 ? `${first} +${lines.length - 1}` : first;
  };
  const assignButton = (c) => (
    <button
      type="button"
      onClick={() => handleMapReceipt(c)}
      disabled={!canMapReceipts || mappingReceiptId === c.receipt_id}
      className={`btn-act btn-act-ok ${canMapReceipts ? '' : 'opacity-40 cursor-not-allowed'}`}
      title={canMapReceipts ? `Assign receipt ${c.receipt_number}` : 'Requires the receipts write privilege'}
    >
      {mappingReceiptId === c.receipt_id ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <Link2 className="w-3.5 h-3.5 shrink-0" />}
      <span>Assign</span>
    </button>
  );
  const canChangeReceipt = canMapReceipts && hasPermission('receipts.delete'); // un-mapping the old one needs delete

  // Districts for dropdown filter
  const filterDistricts = useMemo(() => {
    if (stateFilter === 'ALL') return districts;
    const st = states.find((s) => s.name.toLowerCase() === stateFilter.toLowerCase());
    return st ? districts.filter((d) => d.stateId === st.id) : districts;
  }, [districts, states, stateFilter]);

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
    setStatusFilter('UNAPPROVED');
    setExportFilter('ALL');
    setExportedOn('');
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
          ...(assignMatchOnly ? { likely_only: true } : {}),
          ...(!assignShowAll ? { membership_only: true } : {}),
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
    setAssignMatchOnly(true); // the likely matches first; All shows the rest
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
        let note = `Receipt ${candidate.receipt_number} mapped to ${who}. Approval is no longer blocked.`;
        let tone = 'success';
        if (replacingReceipt) {
          // the new receipt is mapped first, so the applicant is never left without one; now un-map the old one
          try {
            const { data: allocs } = await api.get(`/receipts/${replacingReceipt.id}/allocations`);
            const old = (Array.isArray(allocs) ? allocs : allocs?.data || []).find((a) => Number(a.member_id) === Number(assigningMember.id));
            if (old) await api.delete(`/receipts/${replacingReceipt.id}/allocations/${old.id}`);
            note = `Receipt ${replacingReceipt.receiptNumber} replaced by ${candidate.receipt_number} for ${who}.`;
          } catch (err) {
            tone = 'error';
            note = `Receipt ${candidate.receipt_number} is mapped, but the old receipt ${replacingReceipt.receiptNumber} could not be un-mapped: ${err.response?.data?.detail || 'try again from Receipt Tracking'}.`;
          }
        }
        showToast(note, tone);
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
  useEffect(() => { setAssignPage(1); }, [assignDebounced, assignFrom, assignTo, assignMatchOnly, assignShowAll, assignPageSize]);
  useEffect(() => {
    loadAssignCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assigningMember?.id, assignPage, assignPageSize, assignDebounced, assignFrom, assignTo, assignMatchOnly, assignShowAll]);

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

  // Disagree = the meeting said no: the applicant moves under Rejected (the server records the reason and frees the receipt)
  const handleReject = async (member) => {
    const reason = await askReason({
      title: `Disagree on ${member.fullName || member.name}?`,
      text: 'The application moves to Rejected. Its receipt goes back to Unassigned. It can be re-opened later.',
      confirmText: 'Yes, disagree',
      danger: true
    });
    if (!reason) return;
    try {
      await api.put(`/members/${member.id}/reject`, null, { params: { reason } });
      showToast(`Application of ${member.fullName || member.name} rejected.`);
      if (viewingMember) setViewingMember(null);
      await reloadData();
    } catch (error) {
      showToast(error.response?.data?.detail || 'Error rejecting the application', 'error');
    }
  };

  // Re-open = a rejected applicant goes back to Unapproved, to be assigned a receipt and decided on again
  const handleReopen = async (member) => {
    const reason = await askReason({
      title: `Re-open ${member.fullName || member.name}?`,
      text: 'The application goes back to Unapproved Membership.',
      confirmText: 'Yes, re-open'
    });
    if (!reason) return;
    try {
      await api.put(`/members/${member.id}/reopen`, null, { params: { reason } });
      showToast(`Application of ${member.fullName || member.name} re-opened.`);
      await reloadData();
    } catch (error) {
      showToast(error.response?.data?.detail || 'Error re-opening the application', 'error');
    }
  };

  // The PDF for the meeting: every applicant the current search and filters give (not only this page). The server
  // logs each one with today's date, which the Exported filter then uses.
  const handleExportPdf = async () => {
    if (exporting || total === 0) return;
    setExporting(true);
    try {
      const base = { limit: 200, ...sortParams };
      if (debouncedSearch.trim()) base.search = debouncedSearch.trim();
      if (typeFilter !== 'ALL') {
        const type = membershipTypes.find((mt) => mt.name.toLowerCase() === typeFilter.toLowerCase());
        if (type) base.membership_type_id = type.id;
      }
      if (stateFilter !== 'ALL') {
        const st = states.find((x) => x.name.toLowerCase() === stateFilter.toLowerCase());
        if (st) base.state_id = st.id;
      }
      if (districtFilter !== 'ALL') {
        const d = districts.find((x) => x.name.toLowerCase() === districtFilter.toLowerCase());
        if (d) base.district_id = d.id;
      }
      if (receiptStatusFilter === 'Assigned') base.receipt_assigned = true;
      if (receiptStatusFilter === 'Pending') base.receipt_assigned = false;
      Object.assign(base, meetingParams());
      const ids = [];
      for (let page = 1; page <= pages; page += 1) {
        const result = await loadUnapprovedPage({ ...base, page });
        result.rows.forEach((m) => ids.push(m.id));
        if (result.rows.length === 0) break;
      }
      const { data, headers } = await api.post('/members/meeting-export', { member_ids: ids }, { responseType: 'blob', params: { reason: 'Meeting PDF exported' } });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `meeting-list-${headers['x-export-date'] || new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(`${ids.length} applicant${ids.length === 1 ? '' : 's'} exported for the meeting.`);
      await reloadData();
    } catch (error) {
      showToast(error.response?.data?.detail || 'Could not export the meeting list.', 'error');
    } finally {
      setExporting(false);
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
      title: 'Agree to the membership?',
      text: `Agree to ${d.fullName || d.name} (${d.membershipType})? The member is approved and moves to the Membership List.`,
      confirmText: 'Yes, agree',
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
        title={assignedOnly ? 'Assigned for Approval' : 'Unapproved Membership'}
        searchQuery={searchQuery}
        onSearchChange={(val) => {
          setSearchQuery(val);
          setCurrentPage(1);
        }}
        activeFiltersCount={
          (statusFilter !== 'UNAPPROVED' ? 1 : 0) +
          (exportFilter !== 'ALL' || exportedOn ? 1 : 0) +
          (typeFilter !== 'ALL' ? 1 : 0) +
          (stateFilter !== 'ALL' ? 1 : 0) +
          (districtFilter !== 'ALL' ? 1 : 0) +
          (receiptStatusFilter !== 'ALL' ? 1 : 0)
        }
        onResetFilters={handleClearFilters}
        rightSlot={
          (
            <div className="flex items-center gap-2 flex-wrap">
              {statusFilter === 'UNAPPROVED' && (
                <button
                  type="button"
                  onClick={handleExportPdf}
                  disabled={exporting || total === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E8DFD8] hover:border-[#510601] text-[#510601] text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Download the listed applicants as a PDF for the meeting; they are marked as exported today"
                >
                  {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  <span>Export PDF</span>
                </button>
              )}
              <span className="text-xs font-bold text-[#510601] bg-[#FAF7F2] px-2.5 py-1.5 rounded-lg border border-[#E8DFD8]">
                {selectedIds.size} selected
              </span>
              {selectedIds.size > 0 && (
                hasPermission('members.unapproved.write') && (
                  <button
                    type="button"
                    onClick={handleBulkApprove}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#510601] hover:bg-[#863221] text-white text-xs font-bold rounded-xl transition-all shadow-sm cursor-pointer disabled:opacity-40"
                    title="Agree to the selected applicants"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Agree Selected</span>
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
        {/* 0. Pending or Rejected (the Assigned queue only holds applicants still to be decided) */}
        {!assignedOnly && <FilterSelect
          value={statusFilter}
          onChange={(val) => {
            setStatusFilter(val);
            setSelectedIds(new Set());
            setCurrentPage(1);
          }}
          options={[
            { value: 'UNAPPROVED', label: 'Awaiting decision' },
            { value: 'REJECTED', label: 'Rejected' }
          ]}
          widthClass="w-full sm:w-44"
        />}

        {/* Meeting PDF: only the applicants that were on an exported PDF, or on the one exported on a given day */}
        {statusFilter === 'UNAPPROVED' && <FilterSelect
          value={exportFilter}
          onChange={(val) => {
            setExportFilter(val);
            if (val !== 'EXPORTED') setExportedOn('');
            setCurrentPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All (exported or not)' },
            { value: 'EXPORTED', label: 'Only exported' },
            { value: 'NOT_EXPORTED', label: 'Not exported yet' }
          ]}
          widthClass="w-full sm:w-48"
        />}
        {statusFilter === 'UNAPPROVED' && exportFilter === 'EXPORTED' && (
          <div className="w-full sm:w-40">
            <DateInput
              value={exportedOn}
              onChange={(e) => { setExportedOn(e.target.value); setCurrentPage(1); }}
              placeholder="Exported on"
              className="w-full h-9 px-3 text-xs bg-white border border-[#E8DFD8] rounded-xl focus:outline-none focus:border-[#510601]"
            />
          </div>
        )}

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
                      <p className="font-semibold text-sm text-[#180200]">
                        {statusFilter === 'REJECTED' ? 'No rejected applications' : 'No unapproved memberships'}
                      </p>
                      <p className="text-xs text-[#863221] mt-1">
                        {statusFilter === 'REJECTED'
                          ? 'Applicants the meeting disagreed on show here, and can be re-opened.'
                          : 'All online registrations have been reviewed and approved.'}
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
                            disabled={!isAssigned || statusFilter !== 'UNAPPROVED'}
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
                        {m.last_exported_on && (
                          <div className="text-[10px] text-[#863221] mt-0.5" title="The latest meeting PDF this applicant was on">
                            On meeting PDF · {formatDate(m.last_exported_on)}
                          </div>
                        )}
                        {statusFilter === 'REJECTED' && m.rejection && (
                          <div className="text-[10px] text-[#9B2C2C] mt-0.5 max-w-[240px]">
                            Rejected{m.rejection.on ? ` ${formatDate(m.rejection.on)}` : ''}: {m.rejection.reason}
                          </div>
                        )}
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
                          {statusFilter === 'UNAPPROVED' && <button
                            type="button"
                            onClick={() => (isAssigned && m.receipt ? openAssignedReceipt(m) : openAssignReceipt(m))}
                            className="btn-act"
                            title={
                              isAssigned
                                ? `View receipt ${m.assignedReceiptNumber}`
                                : 'List the receipts already entered and map one to this applicant'
                            }
                          >
                            <FileText className="w-3.5 h-3.5 shrink-0" />
                            <span>{isAssigned ? 'Receipt' : 'Assign Receipt'}</span>
                          </button>}

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
                          {statusFilter === 'UNAPPROVED' && hasPermission('members.list.write') && (
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
                          {statusFilter === 'UNAPPROVED' && hasPermission('members.unapproved.write') && (
                            <button
                              type="button"
                              onClick={() => handleInitiateApprove(m)}
                              className={`btn-act btn-act-ok ${isAssigned ? '' : 'opacity-40 cursor-not-allowed'}`}
                              title={
                                !hasPermission('members.unapproved.write')
                                  ? 'Requires members.unapproved.write permission'
                                  : isAssigned
                                    ? 'Agree: approve the membership and move it to the Membership List'
                                    : 'Requires Receipt to be Assigned first'
                              }
                            >
                              <Check className="w-3.5 h-3.5 shrink-0" />
                              <span>Agree</span>
                            </button>
                          )}

                          {/* 4. Reject Action */}
                          {statusFilter === 'UNAPPROVED' && hasPermission('members.unapproved.write') && (
                            <button
                              type="button"
                              onClick={() => handleReject(m)}
                              className="btn-act btn-act-danger"
                              title={'Disagree: reject this application'}
                            >
                              <XCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>Disagree</span>
                            </button>
                          )}

                          {/* 5. Re-open a rejected application */}
                          {statusFilter === 'REJECTED' && hasPermission('members.unapproved.write') && (
                            <button
                              type="button"
                              onClick={() => handleReopen(m)}
                              className="btn-act"
                              title="Put this application back under Unapproved Membership"
                            >
                              <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                              <span>Re-open</span>
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
      <ReceiptViewModal
        receipt={receiptView?.receipt || null}
        onClose={() => setReceiptView(null)}
        onChange={
          canChangeReceipt
            ? () => {
                const { member, receipt } = receiptView;
                setReceiptView(null);
                setReplacingReceipt(receipt);
                openAssignReceipt(member);
              }
            : null
        }
        changeTitle="Pick another receipt for this applicant; the current one is un-mapped"
      />

      {assigningMember && (
        <Modal
          isOpen
          onClose={() => setAssigningMember(null)}
          title={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="truncate">Assign a receipt to {assigningMember.fullName || assigningMember.name}</span>
              <span className="text-[11px] font-mono font-normal text-[#863221]">
                ID {assigningMember.id}{assigningMember.mobile ? ` · ${assigningMember.mobile}` : ''}
              </span>
              <span className={`chip ${replacingReceipt || assigningMember.receiptStatus === 'Assigned' ? 'chip-on' : 'chip-warn'}`}>
                {replacingReceipt ? `Replacing receipt ${replacingReceipt.receiptNumber}` : assigningMember.receiptStatus === 'Assigned' ? `Receipt ${assigningMember.assignedReceiptNumber}` : 'Not assigned'}
              </span>
            </span>
          }
          maxWidthClass="max-w-6xl"
          heightClass="h-[90vh]"
          footer={<ModalFooter kind="view" onCancel={() => setAssigningMember(null)} />}
        >
          <div className="p-5 flex flex-col gap-4 flex-1 min-h-0">
            {/* Search and filters: one line, every control the same height */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-[230px] shrink-0">
                <Search className="w-4 h-4 text-[#863221] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={assignSearch}
                  onChange={(e) => setAssignSearch(e.target.value)}
                  placeholder="Receipt no., payer, mobile"
                  disabled={!!assignError}
                  className="w-full h-9 pl-9 pr-3 text-xs bg-white border border-[#E8DFD8] rounded-xl focus:outline-none focus:border-[#510601] disabled:bg-[#FAF7F2]"
                />
              </div>
              <div className="w-[122px] shrink-0">
                <DateInput value={assignFrom} onChange={(e) => setAssignFrom(e.target.value)} placeholder="From date"
                  className="w-full h-9 px-3 text-xs bg-white border border-[#E8DFD8] rounded-xl focus:outline-none focus:border-[#510601]" />
              </div>
              <div className="w-[122px] shrink-0">
                <DateInput value={assignTo} onChange={(e) => setAssignTo(e.target.value)} placeholder="To date"
                  className="w-full h-9 px-3 text-xs bg-white border border-[#E8DFD8] rounded-xl focus:outline-none focus:border-[#510601]" />
              </div>
              <div className="inline-flex items-center h-9 rounded-xl border border-[#E8DFD8] bg-white p-0.5 text-xs font-bold shrink-0">
                <button type="button" onClick={() => setAssignMatchOnly(true)}
                  className={`h-full px-3 rounded-lg cursor-pointer ${assignMatchOnly ? 'bg-[#510601] text-white' : 'text-[#863221]'}`}>Likely matches</button>
                <button type="button" onClick={() => setAssignMatchOnly(false)}
                  className={`h-full px-3 rounded-lg cursor-pointer ${!assignMatchOnly ? 'bg-[#510601] text-white' : 'text-[#863221]'}`}>All</button>
              </div>
              <label className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-[#863221] border border-[#E8DFD8] bg-white rounded-xl cursor-pointer select-none shrink-0" title="Receipts with no Membership line cannot pay for a membership, so they are hidden">
                <input type="checkbox" checked={assignShowAll} onChange={(e) => setAssignShowAll(e.target.checked)} className="w-4 h-4 accent-[#510601] cursor-pointer" />
                <span>Show all receipts</span>
              </label>
              <div className="inline-flex items-center h-9 rounded-xl border border-[#E8DFD8] bg-white p-0.5 shrink-0">
                <button type="button" title="Cards" onClick={() => setAssignView('cards')}
                  className={`h-full px-2 rounded-lg cursor-pointer ${assignView === 'cards' ? 'bg-[#510601] text-white' : 'text-[#863221]'}`}><LayoutGrid className="w-4 h-4" /></button>
                <button type="button" title="Table" onClick={() => setAssignView('table')}
                  className={`h-full px-2 rounded-lg cursor-pointer ${assignView === 'table' ? 'bg-[#510601] text-white' : 'text-[#863221]'}`}><List className="w-4 h-4" /></button>
              </div>
              <button type="button" onClick={loadAssignCandidates} title="Reload"
                className="h-9 w-9 flex items-center justify-center bg-white border border-[#E8DFD8] hover:border-[#510601] text-[#863221] hover:text-[#510601] rounded-xl cursor-pointer shrink-0">
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
                  {!(assignDebounced.trim() || assignFrom || assignTo || assignMatchOnly) ? 'No receipt is waiting for a member' : assignMatchOnly && !(assignDebounced.trim() || assignFrom || assignTo) ? 'No receipt looks like this applicant’s' : 'No receipt matches these filters'}
                </p>
                {assignMatchOnly && (
                  <button type="button" onClick={() => setAssignMatchOnly(false)} className="mt-2 px-3 py-1.5 text-xs font-bold text-[#510601] border border-[#510601] rounded-lg hover:bg-[#FAF7F2] cursor-pointer">
                    Show all waiting receipts
                  </button>
                )}
              </div>
            ) : assignView === 'table' ? (
              <div className="border border-[#E8DFD8] rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-[#FAF7F2] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-2 px-3">Receipt No.</th>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Payer</th>
                      {assignShowAll && <th className="py-2 px-3">Particulars</th>}
                      <th className="py-2 px-3 text-right">Amount</th>
                      <th className="py-2 px-3 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8DFD8]">
                    {assignPageRows.map((c) => (
                      <tr key={c.receipt_id} className="bg-white hover:bg-[#FAF7F2] transition-colors">
                        <td className="py-1.5 px-3 whitespace-nowrap">
                          <span className="font-mono font-bold text-[#510601]">{c.receipt_number}</span>
                          {c.likely_score > 0 && <span className="chip chip-on ml-2">likely</span>}
                        </td>
                        <td className="py-1.5 px-3 text-[#180200] whitespace-nowrap">{formatDate(c.receipt_date)}</td>
                        <td className="py-1.5 px-3 text-[#180200]">
                          {c.payer_name || '—'}
                          {c.payer_mobile ? <span className="ml-2 font-mono text-[10px] text-[#863221]">{c.payer_mobile}</span> : null}
                        </td>
                        {assignShowAll && <td className="py-1.5 px-3 text-[#180200]">{assignItemsText(c)}</td>}
                        <td className="py-1.5 px-3 text-right font-bold text-[#180200] whitespace-nowrap">{formatMoney(c.net_amount)}</td>
                        <td className="py-1.5 px-3 text-right">{assignButton(c)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {assignPageRows.map((c) => (
                  <div key={c.receipt_id} className={`rounded-xl border p-2.5 bg-white flex flex-col gap-1 min-w-0 ${c.likely_score > 0 ? 'border-[#3D705C]/50' : 'border-[#E8DFD8]'}`}>
                    {/* the name first and bold; the receipt number, date, mobile and amount below it, light */}
                    <div className="text-sm font-bold text-[#180200] truncate" title={c.payer_name || ''}>{c.payer_name || '—'}</div>
                    <div className="flex items-start justify-between gap-2 text-xs text-[#7D7068]">
                      <span className="font-mono">{c.receipt_number} · {formatDate(c.receipt_date)}</span>
                      <span className="font-mono whitespace-nowrap">{formatMoney(c.net_amount)}</span>
                    </div>
                    {c.payer_mobile ? <div className="text-[11px] font-mono text-[#7D7068]">{c.payer_mobile}</div> : null}
                    {c.payer_pan ? <div className="text-[10px] font-mono text-[#7D7068]">PAN {c.payer_pan}</div> : null}
                    {assignShowAll && <div className="text-[11px] text-[#7D7068] truncate" title={assignItemsText(c)}>{assignItemsText(c)}</div>}
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-[#863221]">{c.likely_score > 0 ? 'likely match' : ''}</span>
                      {assignButton(c)}
                    </div>
                  </div>
                ))}
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
            {canEnterReceipt && (
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
            )}
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
