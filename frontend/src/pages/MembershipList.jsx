import React, { useState, useMemo, useEffect, useRef } from 'react';
import useSort from '../hooks/useSort';
import SortTh from '../components/SortTh';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
import {
  Plus,
  Upload,
  Pencil,
  Trash2,
  Eye,
  Printer,
  CheckCircle2,
  X,
  AlertCircle,
  MapPin,
  Filter,
  RotateCcw,
  CheckSquare,
} from 'lucide-react';
import { loadLocations, loadMembershipTypes, loadGothras } from '../utils/serverData';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import useSwalConfirm from '../hooks/useSwalConfirm';
import api from '../api';
import { notify } from '../utils/notify';
import Pager from '../components/Pager';
import { fetchMemberPage, normalizeMember } from '../utils/apiAdapters';
import useRules from '../hooks/useRules';

import ModalFooter from '../components/ModalFooter';


export default function MembershipList() {
  const rules = useRules(); // formats and limits from the server
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  // ----------------------------------------------------
  // MASTER STORES
  // ----------------------------------------------------
  const [members, setMembers] = useState([]); // ONE page of members (at most 200), the rest stays on the server
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loadingPage, setLoadingPage] = useState(true);
  const [membershipTypes, setMembershipTypes] = useState([]);
  const [states, setStates] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [taluks, setTaluks] = useState([]);
  const [, setGothras] = useState([]);

  const { sort, toggle: toggleSort, params: sortParams } = useSort();
  const requestSeq = useRef(0);
  // what the server is asked for: the page, the search, the filters and the sort. They run on every member in the
  // database; this screen only holds the page it shows (rule 10.6).
  const loadMembers = async () => {
    const seq = (requestSeq.current += 1);
    setLoadingPage(true);
    try {
      const params = { approval_status: 'APPROVED', page: currentPage, limit: pageSize, ...sortParams };
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      if (typeFilter === 'None' || typeFilter === 'Not Yet Reached') {
        params.no_membership_type = true;
      } else if (typeFilter !== 'ALL') {
        const type = membershipTypes.find((mt) => mt.name === typeFilter);
        if (type) params.membership_type_id = type.id;
      }
      if (statusFilter !== 'ALL') params.is_active = statusFilter === 'Active';
      if (mobileFilter !== 'ALL') params.mobile_status = mobileFilter;
      if (stateFilter !== 'ALL') {
        const st = states.find((x) => x.name.toLowerCase() === stateFilter.toLowerCase());
        if (st) params.state_id = st.id;
      }
      if (districtFilter !== 'ALL') {
        const d = districts.find((x) => x.name.toLowerCase() === districtFilter.toLowerCase());
        if (d) params.district_id = d.id;
      }
      const result = await fetchMemberPage(params);
      if (seq !== requestSeq.current) return; // a newer request is on its way
      setMembers(result.rows);
      setTotal(result.total);
      setPages(Math.max(1, result.pages));
      if (currentPage > Math.max(1, result.pages)) setCurrentPage(Math.max(1, result.pages));
    } catch (error) {
      if (seq !== requestSeq.current) return;
      console.error('Failed to load members.', error);
      showToast(error.response?.data?.detail || 'Failed to load members from the server.', 'error');
    } finally {
      if (seq === requestSeq.current) setLoadingPage(false);
    }
  };

  const loadMasters = async () => {
    try {
      const [loc, types, goth] = await Promise.all([
        loadLocations(),
        loadMembershipTypes(),
        loadGothras()
      ]);
      setStates(loc.states);
      setDistricts(loc.districts);
      setTaluks(loc.taluks);
      setMembershipTypes(types);
      setGothras(goth);
    } catch (error) {
      console.error('Failed to load master data.', error);
      showToast(error.response?.data?.detail || 'Failed to load master data from the server.', 'error');
    }
  };

  // Everything is read from the server on mount
  useEffect(() => {
    loadMasters();
  }, []);



  // Toast feedback
  const [toastMessage] = useState(null);
  const showToast = (message, type = 'success') => {
    notify(message, type);
  };

  // ----------------------------------------------------
  // SEARCH, FILTER & PAGINATION STATE
  // ----------------------------------------------------
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [stateFilter, setStateFilter] = useState('ALL');
  const [districtFilter, setDistrictFilter] = useState('ALL');
  const [mobileFilter, setMobileFilter] = useState('ALL'); // ALL | MISSING | INVALID

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // the page is read again whenever the page, the search, a filter or the sort changes (default: newest first)
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const filterKey = [debouncedSearch, typeFilter, statusFilter, stateFilter, districtFilter, mobileFilter, sort.by, sort.dir].join('|');
  const mastersReady = membershipTypes.length > 0 || states.length > 0;
  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, currentPage, pageSize, mastersReady]);
  useEffect(() => {
    setCurrentPage(1);
  }, [filterKey, pageSize]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Row Selection (Set of Selected Members)
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set());
  const selectionMode = true; // the checkboxes are always showing, so there is no Select / Done button

  // ----------------------------------------------------
  // MODAL STATES
  // ----------------------------------------------------
  // 1. Add / Edit Member Modal
  const [] = useState(false);

  // Form tab inside Add/Edit modal: 'personal' | 'location' | 'membership' | 'additional'


  const [] = useState({});

  // 3. Status Change Confirmation Modal
  const [statusDialog, setStatusDialog] = useState(null); // { member, nextStatus }

  // 4. Delete Confirmation Modal
  const [deleteDialog, setDeleteDialog] = useState(null); // member
  const [, setDeleteReason] = useState('');

  // 5. Label Preview Modal
  const [isLabelPreviewOpen, setIsLabelPreviewOpen] = useState(false);
  const printContainerRef = useRef(null);

  // Active membership types available for new registrations

  // Filtered districts for Add/Edit Form based on selected State

  // Filtered taluks for Add/Edit Form based on selected District

  // Districts for table filter dropdown based on table state filter

  // Districts for table filter dropdown based on table state filter
  const tableFilterDistricts = useMemo(() => {
    if (stateFilter === 'ALL') return districts;
    const st = states.find((s) => s.name.toLowerCase() === stateFilter.toLowerCase());
    return st ? districts.filter((d) => d.stateId === st.id) : districts;
  }, [districts, states, stateFilter]);

  const paginatedMembers = members; // the server already searched, filtered, sorted and paged them

  // Exactly one result for the current search/filters -> show that member in the green card on the left
  const activeFilterCount =
    (typeFilter !== 'ALL' ? 1 : 0) +
    (statusFilter !== 'ALL' ? 1 : 0) +
    (stateFilter !== 'ALL' ? 1 : 0) +
    (districtFilter !== 'ALL' ? 1 : 0) +
    (mobileFilter !== 'ALL' ? 1 : 0);
  const singleMatchMember =
    !loadingPage && total === 1 && paginatedMembers.length === 1 && (debouncedSearch.trim() || activeFilterCount > 0)
      ? paginatedMembers[0]
      : null;
  const singleMatchPlace = singleMatchMember
    ? (singleMatchMember.city ||
        singleMatchMember.place ||
        districts.find((d) => d.id === singleMatchMember.districtId)?.name ||
        '')
    : '';

  // Checkbox selection helpers
  const isAllPaginatedSelected = useMemo(() => {
    if (paginatedMembers.length === 0) return false;
    return paginatedMembers.every((m) => selectedMemberIds.has(m.id));
  }, [paginatedMembers, selectedMemberIds]);

  const selectedCache = useRef(new Map()); // id -> member row, so a ticked member from another page still prints
  const handleToggleSelectAll = () => {
    const next = new Set(selectedMemberIds);
    if (isAllPaginatedSelected) {
      paginatedMembers.forEach((m) => next.delete(m.id));
    } else {
      paginatedMembers.forEach((m) => { next.add(m.id); selectedCache.current.set(m.id, m); });
    }
    setSelectedMemberIds(next);
  };

  const handleToggleSelectRow = (id) => {
    const next = new Set(selectedMemberIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      const row = members.find((m) => m.id === id);
      if (row) selectedCache.current.set(id, row);
    }
    setSelectedMemberIds(next);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setTypeFilter('ALL');
    setStatusFilter('ALL');
    setStateFilter('ALL');
    setDistrictFilter('ALL');
    setMobileFilter('ALL');
    setCurrentPage(1);
  };

  // ----------------------------------------------------
  // PIN LOOKUP HELPER (LOCATION SETUP INTEGRATION)
  // ----------------------------------------------------

  // ----------------------------------------------------
  // ADD / EDIT FORM HANDLERS
  // ----------------------------------------------------
  const handleOpenAddModal = () => {
    navigate('/dashboard/membership/register');
  };


  const handleOpenEditModal = (member) => {
    navigate(`/dashboard/membership/edit/${member.id}`);
  };



  // ----------------------------------------------------
  // STATUS & DELETE HANDLERS
  // ----------------------------------------------------
  // ----------------------------------------------------
  // MEMBER PROFILE ACTIONS (server calls): membership type, photo
  // ----------------------------------------------------


  const handleConfirmStatusToggle = async () => {
    if (!statusDialog) return;
    const { member, nextStatus } = statusDialog;
    try {
      const { data } = await api.put(`/members/${member.id}`, {
        member_status: nextStatus === 'Active' ? 'ACTIVE' : 'INACTIVE',
      }, { params: { reason: 'Status changed via UI' } });
      const updatedMember = normalizeMember(data);
      setMembers((prev) => prev.map((m) => (m.id === member.id ? updatedMember : m)));
      showToast(`Member "${member.fullName || member.name}" set to ${nextStatus}.`);
      setStatusDialog(null);
    } catch (error) {
      console.error('Failed to update member status.', error);
      showToast(error.response?.data?.detail || 'Failed to update member status through API.', 'error');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteDialog) return;
    const reason = 'Deleted via UI';
    try {
      const { data } = await api.delete(`/members/${deleteDialog.id}`, { params: { reason } });
      if (data?.status === 'PENDING') {
        showToast(data.message || 'Delete request submitted for approval.');
        setDeleteDialog(null);
        setDeleteReason('');
        return;
      }
      loadMembers();
    } catch (error) {
      console.error('Failed to delete member.', error);
      showToast(error.response?.data?.detail || 'Failed to delete member through API.', 'error');
      return;
    }

    // Remove from selection if selected
    if (selectedMemberIds.has(deleteDialog.id)) {
      const next = new Set(selectedMemberIds);
      next.delete(deleteDialog.id);
      setSelectedMemberIds(next);
    }

    showToast('Delete request sent successfully.');
    setDeleteDialog(null);
    setDeleteReason('');
  };

  useSwalConfirm(
    statusDialog,
    () => setStatusDialog(null),
    ({ member, nextStatus }) => ({
      title: `${nextStatus === 'Inactive' ? 'Deactivate' : 'Activate'} member?`,
      text: `Are you sure you want to mark ${member.fullName || member.name} as ${nextStatus}?`,
      confirmText: nextStatus === 'Inactive' ? 'Yes, deactivate' : 'Yes, activate',
      danger: nextStatus === 'Inactive',
    }),
    handleConfirmStatusToggle
  );

  useSwalConfirm(
    deleteDialog,
    () => setDeleteDialog(null),
    (m) => ({
      title: 'Delete membership?',
      text: `Are you sure you want to delete ${m.fullName || m.name}${m.membershipNumber ? ` (${m.membershipNumber})` : ''}?`,
      confirmText: 'Yes, delete',
      danger: true,
    }),
    handleConfirmDelete
  );

  // ----------------------------------------------------
  // LABEL PREVIEW ITEMS & PRINT TRIGGER
  // ----------------------------------------------------
  const selectedMembersForLabels = useMemo(() => {
    return [...selectedMemberIds].map((id) => selectedCache.current.get(id)).filter(Boolean);
  }, [selectedMemberIds]);

  const handleTriggerPrint = () => {
    window.print();
  };

  return (
    <PermissionGate required="members.list.read">
    <div className="space-y-6">
      {/* ---------------------------------------------------- */}
      {/* HEADER, SEARCH & FILTERS SECTION                     */}
      {/* ---------------------------------------------------- */}
      <SearchFilterBar
        title="Membership List"
        searchQuery={searchQuery}
        onSearchChange={(val) => {
          setSearchQuery(val);
          setCurrentPage(1);
        }}
        activeFiltersCount={
          (typeFilter !== 'ALL' ? 1 : 0) +
          (statusFilter !== 'ALL' ? 1 : 0) +
          (stateFilter !== 'ALL' ? 1 : 0) +
          (districtFilter !== 'ALL' ? 1 : 0) +
          (mobileFilter !== 'ALL' ? 1 : 0)
        }
        onResetFilters={handleClearFilters}
        rightSlot={
          <>
            {/* Select / Done button hidden: the checkboxes always show (kept here to bring back)
            <button
              type="button"
              onClick={() => {
                setSelectionMode((on) => !on);
                setSelectedMemberIds(new Set());
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-bold rounded-xl border transition-colors cursor-pointer shrink-0 ${
                selectionMode ? 'text-white bg-[#510601] border-[#510601]' : 'bg-white border-[#E8DFD8] text-[#863221] hover:bg-[#FAF7F2]'
              }`}
              title="Select members to print address labels"
            >
              <CheckSquare className="w-4 h-4" />
              <span>{selectionMode ? 'Done' : 'Select'}</span>
            </button>
            */}
            {selectedMemberIds.size > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setIsLabelPreviewOpen(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white border border-[#510601] text-[#510601] text-xs sm:text-sm font-bold rounded-xl hover:bg-[#FAF7F2] transition-colors cursor-pointer shrink-0"
                  title="Preview and print address labels for the selected members"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Labels ({selectedMemberIds.size})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMemberIds(new Set())}
                  className="flex items-center justify-center w-9 h-9 bg-white border border-[#E8DFD8] text-[#863221] rounded-xl hover:bg-[#FAF7F2] hover:text-[#510601] transition-colors cursor-pointer shrink-0"
                  title="Clear selection"
                >
                  <X className="w-4 h-4" />
                </button>
              </>
            )}
            {/* Import Members button hidden: the Member Import page has its own menu entry (kept here to bring back)
            {(hasPermission('members.register.write') || hasPermission('members.write')) && (
              <Link
                to="/dashboard/membership/import"
                className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-[#510601] text-[#510601] hover:bg-[#510601]/5 text-xs sm:text-sm font-bold rounded-xl transition-all shadow-xs cursor-pointer shrink-0"
                title="Import live members in bulk via CSV"
              >
                <Upload className="w-4 h-4" />
                <span>Import Members</span>
              </Link>
            )}
            */}
            {hasPermission('members.list.write') && (
              <button
                type="button"
                onClick={handleOpenAddModal}

                className="flex items-center gap-1.5 px-4 py-2 bg-[#510601] hover:bg-[#863221] text-white text-xs sm:text-sm font-bold rounded-xl transition-all shadow-sm cursor-pointer hover:shadow-md shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                <span>Add Membership</span>
              </button>
            )}
          </>
        }
      >
        {/* 1. Membership Type Filter */}
        <FilterSelect
          value={typeFilter}
          onChange={(val) => {
            setTypeFilter(val);
            setCurrentPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All Membership Types' },
            ...membershipTypes.map((mt) => ({ value: mt.name, label: mt.name })),
            { value: 'None', label: 'None / Not Yet Reached' }
          ]}
          widthClass="w-full sm:w-56"
        />

        {/* 2. Status Filter */}
        <FilterSelect
          value={statusFilter}
          onChange={(val) => {
            setStatusFilter(val);
            setCurrentPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All Status' },
            { value: 'Active', label: 'Active' },
            { value: 'Inactive', label: 'Inactive' }
          ]}
          widthClass="w-full sm:w-36"
        />

        {/* 3. State Filter */}
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

        {/* 4. District Filter */}
        <FilterSelect
          value={districtFilter}
          onChange={(val) => {
            setDistrictFilter(val);
            setCurrentPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All Districts' },
            ...tableFilterDistricts.map((d) => ({ value: d.name, label: d.name }))
          ]}
          widthClass="w-full sm:w-48"
        />

        {/* 5. Mobile filter: two tick boxes, shown directly (no dropdown) - no number, or a number from the old register that was unusable */}
        {[['MISSING', 'No mobile number'], ['INVALID', 'Invalid number (to correct)']].map(([val, label]) => (
          <label key={val} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#180200] cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={mobileFilter === val}
              onChange={(e) => {
                setMobileFilter(e.target.checked ? val : 'ALL');
                setCurrentPage(1);
              }}
              className="w-4 h-4 accent-[#510601] cursor-pointer"
            />
            {label}
          </label>
        ))}

        {/* Single reset / clear icon for search + filters */}
        <button
          type="button"
          onClick={handleClearFilters}
          className="flex items-center justify-center w-9 h-9 bg-white border border-[#E8DFD8] text-[#863221] rounded-xl hover:bg-red-50 hover:text-[#ED4636] hover:border-red-200 transition-colors cursor-pointer shrink-0 shadow-2xs"
          title="Clear search & filters"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </SearchFilterBar>

      {/* ---------------------------------------------------- */}
      {/* SINGLE MATCH (LEFT, GREEN) + MEMBERSHIP TABLE        */}
      {/* ---------------------------------------------------- */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {singleMatchMember && (
          <aside className="w-full lg:w-80 shrink-0 bg-white rounded-2xl border-2 border-green-300 shadow-md overflow-hidden">
            <div className="bg-green-600 px-4 py-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-white" />
              <span className="text-xs font-bold uppercase tracking-wider text-white">Exactly 1 Member Found</span>
            </div>
            <div className="p-4 space-y-3 bg-green-50">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-green-600">Membership No.</p>
                <p className="font-mono font-bold text-lg text-green-800">
                  {singleMatchMember.membershipNumber || '—'}
                </p>
              </div>
              <div className="border-t border-green-200 pt-3">
                <p className="text-sm font-bold text-green-900">
                  {singleMatchMember.nameTitle ? `${singleMatchMember.nameTitle} ` : ''}
                  {singleMatchMember.fullName || singleMatchMember.name}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-green-700">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  {singleMatchPlace || '—'}
                  {singleMatchMember.mobile || singleMatchMember.mobileNumber ? (
                    <>
                      <span className="text-green-400">·</span>
                      <span className="font-mono">{singleMatchMember.mobile || singleMatchMember.mobileNumber}</span>
                    </>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate(`/dashboard/membership/profile/${singleMatchMember.id}`)}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>View Profile</span>
              </button>
            </div>
          </aside>
        )}

        <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm overflow-hidden flex-1 min-w-0 w-full">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
              <tr>
                {selectionMode && <th className="py-3 px-4 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={isAllPaginatedSelected}
                    onChange={handleToggleSelectAll}
                    className="w-4 h-4 rounded border-[#E8DFD8] text-[#510601] focus:ring-[#510601] cursor-pointer accent-[#510601]"
                    title="Select All on page"
                  />
                </th>}
                <SortTh label="Member No." field="member_code" sort={sort} onSort={toggleSort} className="py-3 px-4" />
                <SortTh label="Name" field="name" sort={sort} onSort={toggleSort} className="py-3 px-4" />
                <SortTh label="Contact" field="mobile" sort={sort} onSort={toggleSort} className="py-3 px-4" />
                <th className="py-3 px-4">Address</th>
                <th className="py-3 px-4">Type</th>
                <SortTh label="Status" field="member_status" sort={sort} onSort={toggleSort} className="py-3 px-4 text-center" />
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8]">
              {loadingPage && paginatedMembers.length === 0 ? (
                <tr><td colSpan={9} className="py-12 text-center text-sm text-[#863221]">Loading members…</td></tr>
              ) : paginatedMembers.length === 0 ? (
                <tr>
                  <td colSpan="9" className="py-12 text-center text-[#863221]">
                    <div className="flex flex-col items-center justify-center">
                      <AlertCircle className="w-8 h-8 text-[#863221]/40 mb-2" />
                      <p className="font-semibold text-sm text-[#180200]">No members found</p>
                      <p className="text-xs text-[#863221] mt-1">
                        Try adjusting your search criteria or register a new member.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedMembers.map((m) => {
                  const isSelected = selectedMemberIds.has(m.id);
                  const displayStatus = m.status === 'Approved' ? 'Active' : m.status || 'Active';

                  return (
                    <tr
                      key={m.id}
                      className={`transition-colors ${isSelected ? 'bg-[#FAF7F2]' : 'bg-white hover:bg-[#FAF7F2]'
                        }`}
                    >
                      {/* Checkbox */}
                      {selectionMode && <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectRow(m.id)}
                          className="w-4 h-4 rounded border-[#E8DFD8] text-[#510601] focus:ring-[#510601] cursor-pointer accent-[#510601]"
                        />
                      </td>}

                      {/* Membership No. */}
                      <td className="py-3 px-4 font-mono font-bold text-xs text-[#510601] whitespace-nowrap">
                        {m.membershipNumber ? `${m.membershipNumber}` : '—'}
                      </td>

                      {/* Name */}
                      <td className="py-3 px-4 font-bold text-[#180200] text-sm">
                        {m.fullName || m.name}
                      </td>

                      {/* Contact Info (Mobile & Email) */}
                      <td className="py-3 px-4">
                        <div className="font-mono font-medium text-xs text-[#180200]">{m.mobile || m.mobileNumber || '—'}</div>
                        {!(m.mobile || m.mobileNumber) && m.mobileRaw && (
                          <div className="text-[11px] font-mono text-[#ED4636]" title="The number in the old register could not be used. Edit the member to correct it.">
                            Invalid: {m.mobileRaw}
                          </div>
                        )}
                      </td>

                      {/* Address: the street lines, then taluk / district, then state - PIN (all from the list call) */}
                      <td className="py-3 px-4 align-top">
                        {(() => {
                          const street = m.addressLine || m.address || '';
                          const place = [m.talukName, m.districtName].filter(Boolean).join(', ');
                          const pin = [m.stateName, m.postalCode].filter(Boolean).join(' - ');
                          const whole = [street, place, pin].filter(Boolean).join(', ');
                          return whole ? (
                            <div className="max-w-[280px] text-xs text-[#180200] leading-snug" title={whole}>
                              {street && <div className="line-clamp-2">{street}</div>}
                              {(place || pin) && <div className="text-[11px] text-[#863221]">{[place, pin].filter(Boolean).join(' · ')}</div>}
                            </div>
                          ) : <span className="text-xs text-[#863221]/60">—</span>;
                        })()}
                      </td>

                      {/* Membership Type, from the server */}
                      <td className="py-3 px-4">
                        <span className="text-xs font-semibold text-[#510601]">{m.membershipType || '—'}</span>
                      </td>

                      {/* Status Toggle Button */}
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            setStatusDialog({
                              member: m,
                              nextStatus: displayStatus === 'Active' ? 'Inactive' : 'Active'
                            })
                          }
                          className={`chip ${displayStatus === 'Active' ? 'chip-on' : 'chip-off'}`}
                          title={`Click to ${displayStatus === 'Active' ? 'deactivate' : 'activate'}`}
                        >
                          <span>{displayStatus}</span>
                        </button>
                      </td>

                      {/* Action Buttons: View, Edit, Delete */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => navigate(`/dashboard/membership/profile/${m.id}`)}
                            className="btn-act"
                            title="View Member Profile"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View</span>
                          </button>
                          {hasPermission('members.list.write') && (
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(m)}
                              className="btn-act"
                              title={'Edit Member'}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>Edit</span>
                            </button>
                          )}
                          {hasPermission('members.list.delete') && (
                            <button
                              type="button"
                              onClick={() => { setDeleteReason(''); setDeleteDialog(m); }}
                              className="btn-act btn-act-danger"
                              title={'Delete Member'}
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
      </div>

      {/* View Member Profile is handled on dedicated full-screen page /dashboard/membership/profile/:id */}

      {/* ==================================================== */}
      {/* MODAL 3: LABEL PREVIEW & PRINT INTERFACE             */}
      {/* ==================================================== */}
      <Modal isOpen={isLabelPreviewOpen} onClose={() => setIsLabelPreviewOpen(false)}>
        <div
          className="bg-white rounded-2xl max-w-4xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl print:hidden no-print">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                <Printer className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#180200]">
                  Print-Oriented Address Label Preview
                </h3>
                <p className="text-xs text-[#863221]">
                  {selectedMembersForLabels.length} address label{selectedMembersForLabels.length !== 1 ? 's' : ''} ready for printing.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsLabelPreviewOpen(false)}
              className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Printable Label Grid Container */}
          <div className="flex-1 overflow-y-auto p-6 bg-stone-100/60 print:bg-white print:p-0" ref={printContainerRef}>
            {/* Top Print Notice */}
            <div className="mb-4 flex items-center gap-2.5 bg-amber-50 p-3 rounded-xl border border-amber-200 text-xs text-amber-900 print:hidden no-print">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-700" />
              <span>
                A4 sticker sheet, 3 columns x 7 rows: membership number, name and address on each label.
              </span>
            </div>

            {/* Labels Grid: 3 across, no gaps (the sheet's own stickers) */}
            <div className="label-sheet grid grid-cols-1 md:grid-cols-3 gap-0 print:grid-cols-3 print:gap-0">
              {selectedMembersForLabels.map((m) => (
                <div
                  key={m.id}
                  className="printable-label-card border border-stone-200 bg-white px-3 py-2.5 relative"
                  style={{ minHeight: '42.4mm' }}
                >
                  <div className="leading-tight text-black">
                    <div className="text-[12px] mb-0.5">{m.membershipNumber || ''}</div>
                    <div className="font-bold text-[12px] mb-0.5 uppercase">{m.fullName || m.name}</div>
                    <div className="text-[13px] leading-snug">
                      {m.addressLine || m.address || ''}
                      <br />
                      {[m.talukName || m.post, m.districtName].filter(Boolean).join(', ')}
                      <br />
                      {m.stateName}{m.stateName ? ' - ' : ''}<span className="font-semibold">{m.postalCode || ''}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Modal Footer */}
          <ModalFooter
            kind="confirm"
            cancelLabel="Close"
            submitLabel="Print Labels"
            onCancel={() => setIsLabelPreviewOpen(false)}
            onSubmit={handleTriggerPrint}
            className="print:hidden no-print"
            left={<span className="text-xs text-[#863221]">Showing {selectedMembersForLabels.length} printable label cards</span>}
          />
        </div>
      </Modal>

      {/* ==================================================== */}
      {/* FLOATING TOAST NOTIFICATION                          */}
      {/* ==================================================== */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-fade-in-up">
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border text-sm font-medium ${toastMessage.type === 'error'
              ? 'bg-red-50 text-red-800 border-red-200'
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
