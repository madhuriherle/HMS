import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
import {
  UserCheck,
  User,
  Plus,
  Search,
  Edit3,
  Trash2,
  Eye,
  Printer,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  X,
  AlertCircle,
  AlertTriangle,
  Building,
  MapPin,
  Phone,
  Mail,
  Calendar,
  Layers,
  Check,
  Download,
  Filter,
  RefreshCw,
  Sparkles,
  Award,
  TrendingUp,
  Coins,
  Receipt
} from 'lucide-react';
import { calculateMemberMembershipStatus } from '../utils/displayHelpers';
import {
  loadLocations,
  loadMembershipTypes,
  loadReceipts,
  loadGothras,
  findLocationByPin
} from '../utils/serverData';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import api from '../api';
import MemberApplicationDetails from '../components/MemberApplicationDetails';
import { askForm } from '../utils/dialogs';
import { notify } from '../utils/notify';
import {
  fetchMembers,
  memberToApiPayload,
  normalizeMember,
} from '../utils/apiAdapters';

const toId = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? v : Number(v));

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const MEMBER_CATEGORIES = ['Individual', 'Family', 'Institutional', 'Senior Citizen', 'Corporate', 'General'];

export default function MembershipList() {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  // ----------------------------------------------------
  // MASTER STORES
  // ----------------------------------------------------
  const [members, setMembers] = useState([]);
  const [membershipTypes, setMembershipTypes] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [states, setStates] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [taluks, setTaluks] = useState([]);
  const [postalCodes, setPostalCodes] = useState([]);
  const [gothras, setGothras] = useState([]);

  const loadMembers = async () => {
    try {
      setMembers(await fetchMembers({ approval_status: 'APPROVED' }));
    } catch (error) {
      console.error('Failed to load members.', error);
      showToast(error.response?.data?.detail || 'Failed to load members from the server.', 'error');
    }
  };

  const loadMasters = async () => {
    try {
      const [loc, types, recs, goth] = await Promise.all([
        loadLocations(),
        loadMembershipTypes(),
        loadReceipts(),
        loadGothras()
      ]);
      setStates(loc.states);
      setDistricts(loc.districts);
      setTaluks(loc.taluks);
      setPostalCodes(loc.postalCodes);
      setMembershipTypes(types);
      setReceipts(recs);
      setGothras(goth);
    } catch (error) {
      console.error('Failed to load master data.', error);
      showToast(error.response?.data?.detail || 'Failed to load master data from the server.', 'error');
    }
  };

  // Everything is read from the server on mount
  useEffect(() => {
    loadMembers();
    loadMasters();
  }, []);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState(null);
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

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Row Selection (Set of Selected Members)
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set());

  // ----------------------------------------------------
  // MODAL STATES
  // ----------------------------------------------------
  // 1. Add / Edit Member Modal
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [formModalMode, setFormModalMode] = useState('add'); // 'add' | 'edit'
  const [editingMember, setEditingMember] = useState(null);

  // Form tab inside Add/Edit modal: 'personal' | 'location' | 'membership' | 'additional'
  const [activeFormSection, setActiveFormSection] = useState('personal');

  const initialFormState = {
    // Basic Details
    name: '',
    address: '',
    remarks: '',
    phone: '',
    mobile: '',
    email: '',

    // Location Details
    country: 'India',
    stateId: '',
    stateName: '',
    districtId: '',
    districtName: '',
    postalCode: '',
    post: '',
    city: '',
    area: '',
    place: '',
    grama: '',
    village: '',
    labelPoint: '',

    // Membership Details
    membershipTypeId: '',
    membershipType: '',
    category: 'Individual',
    profession: '',
    company: '',

    // Additional Member Details
    website: '',
    gothra: '',
    bloodGroup: 'O+',
    birthDate: '',
    status: 'Active',
    expireDate: '',
    magazineRemarks: '',
    nativeDetails: ''
  };

  const [formData, setFormData] = useState(initialFormState);
  const [formErrors, setFormErrors] = useState({});

  // 2. View Member Details Modal
  const [viewingMember, setViewingMember] = useState(null);
  const [activeViewTab, setActiveViewTab] = useState('profile');
  const [tabData, setTabData] = useState({ family: null, services: null, donations: null });
  const [isTabLoading, setIsTabLoading] = useState(false);

  useEffect(() => {
    if (viewingMember) {
      setActiveViewTab('profile');
      setTabData({ family: null, services: null, donations: null });
    }
  }, [viewingMember]);

  useEffect(() => {
    if (!viewingMember || activeViewTab === 'profile') return;
    
    if (!tabData[activeViewTab]) {
      setIsTabLoading(true);
      api.get(`/members/${viewingMember.id}/${activeViewTab}`)
        .then(res => {
          return res.data;
        })
        .then(data => {
          setTabData(prev => ({ ...prev, [activeViewTab]: data }));
          setIsTabLoading(false);
        })
        .catch(err => {
          console.error('Failed to load member ' + activeViewTab, err);
          setIsTabLoading(false);
          showToast(err.response?.data?.detail || 'Failed to load ' + activeViewTab + ' from the server.', 'error');
        });
    }
  }, [activeViewTab, viewingMember]);

  // 3. Status Change Confirmation Modal
  const [statusDialog, setStatusDialog] = useState(null); // { member, nextStatus }

  // 4. Delete Confirmation Modal
  const [deleteDialog, setDeleteDialog] = useState(null); // member
  const [deleteReason, setDeleteReason] = useState('');

  // 5. Label Preview Modal
  const [isLabelPreviewOpen, setIsLabelPreviewOpen] = useState(false);
  const printContainerRef = useRef(null);

  // Active membership types available for new registrations
  const activeMembershipTypes = useMemo(() => {
    return membershipTypes.filter((mt) => formModalMode === 'edit' || mt.status === 'Active');
  }, [membershipTypes, formModalMode]);

  // Filtered districts for Add/Edit Form based on selected State
  const formDistricts = useMemo(() => {
    return districts.filter((d) => d.stateId === formData.stateId && (formModalMode === 'edit' || d.status === 'Active'));
  }, [districts, formData.stateId, formModalMode]);

  // Filtered taluks for Add/Edit Form based on selected District
  const formTaluks = useMemo(() => {
    return taluks.filter((t) => t.districtId === formData.districtId && (formModalMode === 'edit' || t.status === 'Active'));
  }, [taluks, formData.districtId, formModalMode]);

  // Districts for table filter dropdown based on table state filter
  const tableFilterDistricts = useMemo(() => {
    if (stateFilter === 'ALL') return districts;
    const st = states.find((s) => s.name.toLowerCase() === stateFilter.toLowerCase());
    return st ? districts.filter((d) => d.stateId === st.id) : districts;
  }, [districts, states, stateFilter]);

  // ----------------------------------------------------
  // FILTERING LOGIC
  // ----------------------------------------------------
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const memberName = (m.fullName || m.name || '').toLowerCase();
        const memberNo = (m.membershipNumber || m.id || '').toLowerCase();
        const mobile = (m.mobile || m.mobileNumber || '').toLowerCase();
        const email = (m.email || '').toLowerCase();
        const city = (m.city || m.place || m.talukName || '').toLowerCase();
        const district = (m.districtName || '').toLowerCase();
        const pin = (m.postalCode || '').toLowerCase();

        if (
          !memberName.includes(q) &&
          !memberNo.includes(q) &&
          !mobile.includes(q) &&
          !email.includes(q) &&
          !city.includes(q) &&
          !district.includes(q) &&
          !pin.includes(q)
        ) {
          return false;
        }
      }

      // Membership Type Filter (Dynamically calculated based on cumulative membership receipts & Master)
      if (typeFilter !== 'ALL') {
        const memStatus = calculateMemberMembershipStatus(m, receipts, membershipTypes);
        const currentType = (memStatus.currentMembershipType || '').toLowerCase();
        if (typeFilter === 'None' || typeFilter === 'Not Yet Reached') {
          if (memStatus.isMilestoneReached) return false;
        } else {
          if (currentType !== typeFilter.toLowerCase()) return false;
        }
      }

      // Status Filter
      if (statusFilter !== 'ALL') {
        const normStatus = m.status === 'Approved' ? 'Active' : m.status;
        if (normStatus !== statusFilter) return false;
      }

      // State Filter
      if (stateFilter !== 'ALL') {
        if ((m.stateName || '').toLowerCase() !== stateFilter.toLowerCase()) return false;
      }

      // District Filter
      if (districtFilter !== 'ALL') {
        if ((m.districtName || '').toLowerCase() !== districtFilter.toLowerCase()) return false;
      }

      return true;
    });
  }, [members, searchQuery, typeFilter, statusFilter, stateFilter, districtFilter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / pageSize));
  const paginatedMembers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredMembers.slice(start, start + pageSize);
  }, [filteredMembers, currentPage, pageSize]);

  // Checkbox selection helpers
  const isAllPaginatedSelected = useMemo(() => {
    if (paginatedMembers.length === 0) return false;
    return paginatedMembers.every((m) => selectedMemberIds.has(m.id));
  }, [paginatedMembers, selectedMemberIds]);

  const handleToggleSelectAll = () => {
    const next = new Set(selectedMemberIds);
    if (isAllPaginatedSelected) {
      paginatedMembers.forEach((m) => next.delete(m.id));
    } else {
      paginatedMembers.forEach((m) => next.add(m.id));
    }
    setSelectedMemberIds(next);
  };

  const handleToggleSelectRow = (id) => {
    const next = new Set(selectedMemberIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedMemberIds(next);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setTypeFilter('ALL');
    setStatusFilter('ALL');
    setStateFilter('ALL');
    setDistrictFilter('ALL');
    setCurrentPage(1);
  };

  // ----------------------------------------------------
  // PIN LOOKUP HELPER (LOCATION SETUP INTEGRATION)
  // ----------------------------------------------------
  const handlePinCodeLookup = async (pin) => {
    if (!pin || pin.length !== 6 || !/^\d{6}$/.test(pin)) return;

    const lookup = findLocationByPin(postalCodes, pin);
    if (lookup.found) {
      // Cascading match against master states & districts
      const matchState = states.find(
        (s) => s.id === lookup.stateId || s.name.toLowerCase() === (lookup.stateName || '').toLowerCase()
      ) || states[0];

      const stateDistrictsList = districts.filter(
        (d) => d.stateId === (matchState ? matchState.id : lookup.stateId)
      );

      const matchDistrict = stateDistrictsList.find(
        (d) => d.id === lookup.districtId || d.name.toLowerCase() === (lookup.districtName || '').toLowerCase()
      ) || districts.find((d) => d.id === lookup.districtId || d.name.toLowerCase() === (lookup.districtName || '').toLowerCase());

      setFormData((prev) => ({
        ...prev,
        postalCode: pin,
        country: 'India',
        stateId: matchState ? matchState.id : (lookup.stateId || ''),
        stateName: matchState ? matchState.name : (lookup.stateName || ''),
        districtId: matchDistrict ? matchDistrict.id : (lookup.districtId || ''),
        districtName: matchDistrict ? matchDistrict.name : (lookup.districtName || ''),
        post: lookup.area || '',
        place: lookup.talukName || lookup.area || '',
        city: lookup.area || lookup.talukName || '',
        area: lookup.area || ''
      }));

      // Clear any prior PIN error
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next.postalCode;
        return next;
      });

      showToast(`Location auto-resolved: ${lookup.area}, ${lookup.talukName ? lookup.talukName + ', ' : ''}${lookup.districtName}, ${lookup.stateName}`);
    } else {
      try {
        const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data[0] && data[0].Status === 'Success') {
            const postOffice = data[0].PostOffice[0];
            setFormData((prev) => ({
              ...prev,
              postalCode: pin,
              country: 'India',
              stateName: postOffice.State || '',
              districtName: postOffice.District || '',
              post: postOffice.Name || '',
              place: postOffice.Block || '',
              city: postOffice.Name || '',
              area: postOffice.Name || ''
            }));
            setFormErrors((prev) => {
              const next = { ...prev };
              delete next.postalCode;
              return next;
            });
            showToast(`Location fetched from API: ${postOffice.Name}, ${postOffice.District}, ${postOffice.State}`);
            return;
          }
        }
      } catch (err) {
        console.error("API Fetch Error", err);
      }

      // Clear previously auto-populated location fields
      setFormData((prev) => ({
        ...prev,
        districtId: '',
        districtName: '',
        post: '',
        place: '',
        city: '',
        area: ''
      }));

      const errorMsg = 'PIN Code not found in Location Setup or API. Please verify the PIN Code.';
      setFormErrors((prev) => ({
        ...prev,
        postalCode: errorMsg
      }));
      showToast(errorMsg, 'error');
    }
  };

  // ----------------------------------------------------
  // ADD / EDIT FORM HANDLERS
  // ----------------------------------------------------
  const handleOpenAddModal = () => {
    navigate('/dashboard/membership/register');
  };


  const handleOpenEditModal = (member) => {
    navigate(`/dashboard/membership/edit/${member.id}`);
  };

  const validateForm = () => {
    const errors = {};
    const cleanName = formData.name.trim();
    const cleanMobile = formData.mobile.trim();
    const cleanAddress = formData.address.trim();

    if (!cleanName) {
      errors.name = 'Full Name is required';
    }

    if (!cleanMobile) {
      errors.mobile = 'Mobile number is required';
    } else if (!/^\d{10}$/.test(cleanMobile)) {
      errors.mobile = 'Mobile must be a valid 10-digit number';
    }

    if (!cleanAddress) {
      errors.address = 'Address is required';
    }

    if (!formData.membershipTypeId) {
      errors.membershipTypeId = 'Please select a Membership Type';
    }

    if (formData.postalCode && !/^\d{6}$/.test(formData.postalCode.trim())) {
      errors.postalCode = 'PIN Code must be 6 numeric digits';
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errors.email = 'Please enter a valid email address';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveMember = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      showToast('Please fix the validation errors in the form.', 'error');
      return;
    }

    if (formModalMode === 'add') {
      try {
        const { data } = await api.post('/members/', memberToApiPayload(formData));
        const newMember = normalizeMember(data);
        setMembers((prev) => [newMember, ...prev]);
        showToast(`Member "${newMember.fullName}" (#${newMember.membershipNumber}) registered successfully.`);
      } catch (error) {
        console.error('Failed to create member.', error);
        showToast(error.response?.data?.detail || 'Failed to register member through API.', 'error');
        return;
      }
    } else {
      try {
        const { data } = await api.put(`/members/${editingMember.id}`, memberToApiPayload(formData));
        const updatedMember = normalizeMember(data);
        setMembers((prev) => prev.map((m) => (m.id === editingMember.id ? updatedMember : m)));
        showToast(`Member "${formData.name}" updated successfully.`);
      } catch (error) {
        console.error('Failed to update member.', error);
        showToast(error.response?.data?.detail || 'Failed to update member through API.', 'error');
        return;
      }
    }

    setIsFormModalOpen(false);
  };

  // ----------------------------------------------------
  // STATUS & DELETE HANDLERS
  // ----------------------------------------------------
  // ----------------------------------------------------
  // MEMBER PROFILE ACTIONS (server calls): membership type, photo
  // ----------------------------------------------------
  const handleAssignMembership = async (member) => {
    const v = await askForm({
      title: `Membership for ${member.fullName || member.name}`,
      text: 'The membership starts at the type\'s current price.',
      confirmText: 'Add membership',
      fields: [
        {
          name: 'typeId',
          label: 'Membership type',
          type: 'select',
          required: true,
          options: membershipTypes
            .filter((mt) => mt.status === 'Active')
            .map((mt) => ({ value: mt.id, label: mt.name }))
        }
      ]
    });
    if (!v) return;
    try {
      const { data } = await api.post(`/members/${member.id}/memberships`, {
        membership_type_id: Number(v.typeId)
      });
      showToast(
        data?.approval_request_id || data?.status === 'PENDING'
          ? 'Membership change submitted for approval.'
          : 'Membership added.'
      );
      await loadMembers();
    } catch (error) {
      showToast(error.response?.data?.detail || 'Error adding the membership', 'error');
    }
  };

  const handleUploadPhoto = async (member) => {
    const v = await askForm({
      title: `Photo for ${member.fullName || member.name}`,
      confirmText: 'Upload',
      fields: [{ name: 'file', label: 'Photo (JPG or PNG)', type: 'file', required: true }]
    });
    if (!v) return;
    try {
      const form = new FormData();
      form.append('file', v.file);
      await api.post(`/members/${member.id}/photo`, form);
      showToast('Photo uploaded.');
      await loadMembers();
    } catch (error) {
      showToast(error.response?.data?.detail || 'Error uploading the photo', 'error');
    }
  };

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
      setMembers((prev) => prev.filter((m) => m.id !== deleteDialog.id));
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

  // ----------------------------------------------------
  // LABEL PREVIEW ITEMS & PRINT TRIGGER
  // ----------------------------------------------------
  const selectedMembersForLabels = useMemo(() => {
    return members.filter((m) => selectedMemberIds.has(m.id));
  }, [members, selectedMemberIds]);

  const handleTriggerPrint = () => {
    window.print();
  };

  return (
    <PermissionGate required="members.read">
    <div className="space-y-6">
      {/* ---------------------------------------------------- */}
      {/* HEADER, SEARCH & FILTERS SECTION                     */}
      {/* ---------------------------------------------------- */}
      <SearchFilterBar
        
        title={<h1 className="text-2xl sm:text-3xl font-bold text-[#180200] tracking-tight">Membership List</h1>}
        searchQuery={searchQuery}
        onSearchChange={(val) => {
          setSearchQuery(val);
          setCurrentPage(1);
        }}
        activeFiltersCount={
          (typeFilter !== 'ALL' ? 1 : 0) +
          (statusFilter !== 'ALL' ? 1 : 0) +
          (stateFilter !== 'ALL' ? 1 : 0) +
          (districtFilter !== 'ALL' ? 1 : 0)
        }
        onResetFilters={handleClearFilters}
        rightSlot={
          <>
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
            <button
              type="button"
              onClick={handleOpenAddModal}
              disabled={!hasPermission('members.write')}
              title={!hasPermission('members.write') ? 'Requires members.write permission' : undefined}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#510601] hover:bg-[#863221] text-white text-xs sm:text-sm font-bold rounded-xl transition-all shadow-sm cursor-pointer hover:shadow-md shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              <span>Add Membership</span>
            </button>
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
      </SearchFilterBar>

      {/* ---------------------------------------------------- */}
      {/* MEMBERSHIP TABLE                                     */}
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
                <th className="py-3 px-4">Membership No. & Name</th>
                <th className="py-3 px-4">Contact (Mobile & Email)</th>
                <th className="py-3 px-4">Membership Type</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">District / Location</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8]">
              {paginatedMembers.length === 0 ? (
                <tr>
                  <td colSpan="8" className="py-12 text-center text-[#863221]">
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
                      className={`transition-colors ${isSelected ? 'bg-[#FAF7F2]/80' : 'hover:bg-[#FAF7F2]/40'
                        }`}
                    >
                      {/* Checkbox */}
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectRow(m.id)}
                          className="w-4 h-4 rounded border-[#E8DFD8] text-[#510601] focus:ring-[#510601] cursor-pointer accent-[#510601]"
                        />
                      </td>

                      {/* Membership No. & Name */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          {m.membershipNumber && (
                            <span className="font-mono font-bold text-xs text-[#510601] bg-[#FAF7F2] px-1.5 py-0.5 rounded border border-[#E8DFD8]">
                              #{m.membershipNumber}
                            </span>
                          )}
                          <span className="font-bold text-[#180200] text-sm">
                            {m.fullName || m.name}
                          </span>
                        </div>
                        {m.gothra && (
                          <div className="text-[11px] text-[#863221] mt-0.5">
                            Gotra: <span className="font-medium text-[#180200]">{m.gothra}</span>
                          </div>
                        )}
                      </td>

                      {/* Contact Info (Mobile & Email) */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 font-mono font-medium text-xs text-[#180200]">
                          <Phone className="w-3 h-3 text-[#863221]/70 shrink-0" />
                          <span>{m.mobile || m.mobileNumber || '—'}</span>
                        </div>
                        {m.email ? (
                          <div className="flex items-center gap-1.5 text-[11px] text-[#863221] mt-0.5 truncate max-w-[180px]">
                            <Mail className="w-3 h-3 text-[#863221]/70 shrink-0" />
                            <span className="truncate">{m.email}</span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-stone-400 mt-0.5">No email</div>
                        )}
                      </td>

                      {/* Membership Type (Dynamically Calculated from Cumulative Receipts & Master) */}
                      <td className="py-3 px-4">
                        {(() => {
                          const memStatus = calculateMemberMembershipStatus(m, receipts, membershipTypes);
                          if (memStatus.isMilestoneReached) {
                            return (
                              <div className="space-y-0.5">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#510601]/10 text-[#510601] border border-[#510601]/20">
                                  <Award className="w-3.5 h-3.5 shrink-0" />
                                  <span>{memStatus.currentMembershipType}</span>
                                </span>
                                <div className="text-[10px] text-[#863221] font-mono font-medium">
                                  Paid: ₹{memStatus.totalMembershipPaid.toLocaleString('en-IN')}
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                                <span>Not Yet Reached</span>
                              </span>
                              <div className="text-[10px] text-[#863221] font-mono">
                                Paid: ₹{memStatus.totalMembershipPaid.toLocaleString('en-IN')}
                              </div>
                            </div>
                          );
                        })()}
                      </td>

                      {/* Category */}
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-[#FAF7F2] text-[#863221] border border-[#E8DFD8]">
                          {m.category || 'Individual'}
                        </span>
                      </td>

                      {/* District / Location */}
                      <td className="py-3 px-4 text-[#863221]">
                        <div className="font-medium text-[#180200] text-xs">
                          {m.districtName || m.stateName || '—'}
                        </div>
                        <div className="text-[11px] text-[#863221]/80 mt-0.5 truncate max-w-[160px]">
                          {m.city || m.place || m.talukName || ''} {m.postalCode ? `(${m.postalCode})` : ''}
                        </div>
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
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${displayStatus === 'Active'
                            ? 'bg-[#3D705C]/10 text-[#3D705C] hover:bg-[#3D705C]/20 border border-[#3D705C]/20'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200'
                            }`}
                          title={`Click to ${displayStatus === 'Active' ? 'deactivate' : 'activate'}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${displayStatus === 'Active' ? 'bg-[#3D705C]' : 'bg-gray-400'
                              }`}
                          />
                          <span>{displayStatus}</span>
                        </button>
                      </td>

                      {/* Action Buttons: View, Edit, Delete */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setViewingMember(m)}
                            className="p-1.5 text-[#863221] hover:text-[#510601] hover:bg-[#FAF7F2] rounded-lg transition-colors cursor-pointer"
                            title="View Full Profile"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(m)}
                            disabled={!hasPermission('members.write')}
                            className="p-1.5 text-amber-700 hover:text-amber-900 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            title={!hasPermission('members.write') ? 'Requires members.write permission' : 'Edit Member'}
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => { setDeleteReason(''); setDeleteDialog(m); }}
                            disabled={!hasPermission('members.delete')}
                            className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            title={!hasPermission('members.delete') ? 'Requires members.delete permission' : 'Delete Member'}
                          >
                            <Trash2 className="w-4 h-4" />
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
        {filteredMembers.length > 0 && (
          <div className="p-4 border-t border-[#E8DFD8] bg-[#FAF7F2]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#863221]">
            <div className="flex items-center gap-2">
              <span>Showing</span>
              <span className="font-bold text-[#180200]">
                {Math.min((currentPage - 1) * pageSize + 1, filteredMembers.length)}
              </span>
              <span>to</span>
              <span className="font-bold text-[#180200]">
                {Math.min(currentPage * pageSize, filteredMembers.length)}
              </span>
              <span>of</span>
              <span className="font-bold text-[#180200]">{filteredMembers.length}</span>
              <span>members</span>
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
                  <option value={100}>100</option>
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
      {/* MODAL 2: VIEW MEMBER PROFILE MODAL                   */}
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
                  {(viewingMember.fullName || viewingMember.name || 'M').charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-[#180200]">
                      {viewingMember.fullName || viewingMember.name}
                    </h3>
                    {viewingMember.membershipNumber && (
                      <span className="font-mono font-bold text-xs bg-[#FAF7F2] text-[#510601] px-2 py-0.5 rounded border border-[#E8DFD8]">
                        #{viewingMember.membershipNumber}
                      </span>
                    )}
                  </div>
                  {(() => {
                    const memStatus = calculateMemberMembershipStatus(viewingMember, receipts, membershipTypes);
                    return (
                      <p className="text-xs text-[#863221]">
                        {memStatus.isMilestoneReached ? `${memStatus.currentMembershipType} Member` : 'Member (Milestone in progress)'}
                      </p>
                    );
                  })()}
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

            {/* Profile actions */}
            <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b border-[#E8DFD8] bg-white">
              <button
                type="button"
                onClick={() => handleAssignMembership(viewingMember)}
                disabled={!hasPermission('members.write')}
                title={!hasPermission('members.write') ? 'Requires members.write permission' : undefined}
                className="px-3 py-1.5 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-40"
              >
                Add / change membership
              </button>
              <button
                type="button"
                onClick={() => handleUploadPhoto(viewingMember)}
                disabled={!hasPermission('members.write')}
                title={!hasPermission('members.write') ? 'Requires members.write permission' : undefined}
                className="px-3 py-1.5 bg-white hover:bg-[#FAF7F2] border border-[#E8DFD8] text-[#510601] text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-40"
              >
                Upload photo
              </button>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-6 px-6 border-b border-[#E8DFD8] bg-[#FAF7F2]/50">
              {['profile', 'family', 'services', 'donations'].map(tab => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveViewTab(tab)}
                  className={`py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
                    activeViewTab === tab 
                      ? 'border-[#510601] text-[#510601]' 
                      : 'border-transparent text-[#863221]/60 hover:text-[#863221]'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Modal Body Content */}
            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto text-xs text-[#180200]">
              {activeViewTab === 'profile' && (
                <div className="space-y-5">
              {/* Dynamic Membership Milestone & Cumulative Contribution Card */}
              {(() => {
                const memStatus = calculateMemberMembershipStatus(viewingMember, receipts, membershipTypes);
                return (
                  <>
                    <div className="bg-gradient-to-br from-[#FAF7F2] to-white rounded-2xl p-4 border border-[#510601]/20 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-[#510601] text-white">
                          <TrendingUp className="w-4 h-4" />
                        </div>
                        <span className="font-bold text-xs uppercase tracking-wider text-[#510601]">
                          Cumulative Membership Milestone Progress
                        </span>
                      </div>
                      <span className="text-[10px] text-[#863221] font-semibold bg-white px-2 py-0.5 rounded-full border border-[#E8DFD8]">
                        Source: Masters → Membership Types
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                      <div className="bg-white p-2.5 rounded-xl border border-[#E8DFD8]">
                        <span className="text-[10px] uppercase font-bold text-[#863221] block">Total Paid</span>
                        <p className="font-mono font-bold text-base text-[#510601] mt-0.5">
                          ₹{memStatus.totalMembershipPaid.toLocaleString('en-IN')}
                        </p>
                      </div>
                      <div className="bg-white p-2.5 rounded-xl border border-[#E8DFD8]">
                        <span className="text-[10px] uppercase font-bold text-[#863221] block">Current Member</span>
                        <p className="font-bold text-sm text-[#180200] mt-0.5 flex items-center gap-1">
                          {memStatus.isMilestoneReached ? (
                            <>
                              <Award className="w-3.5 h-3.5 text-[#510601]" />
                              <span>{memStatus.currentMembershipType}</span>
                            </>
                          ) : (
                            <span className="text-amber-800 text-xs">Not Yet Reached</span>
                          )}
                        </p>
                      </div>
                      <div className="bg-white p-2.5 rounded-xl border border-[#E8DFD8]">
                        <span className="text-[10px] uppercase font-bold text-[#863221] block">Next Milestone</span>
                        <p className="font-bold text-xs text-[#180200] mt-0.5">
                          {memStatus.nextMilestoneType ? (
                            <span>{memStatus.nextMilestoneType} (₹{memStatus.nextMilestoneAmount.toLocaleString('en-IN')})</span>
                          ) : (
                            <span className="text-emerald-700 font-semibold">Highest Milestone Achieved</span>
                          )}
                        </p>
                      </div>
                      <div className="bg-white p-2.5 rounded-xl border border-[#E8DFD8]">
                        <span className="text-[10px] uppercase font-bold text-[#863221] block">Remaining</span>
                        <p className="font-mono font-bold text-sm text-[#863221] mt-0.5">
                          {memStatus.nextMilestoneType ? (
                            `₹${memStatus.remainingAmount.toLocaleString('en-IN')}`
                          ) : (
                            <span className="text-emerald-700">₹0</span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Progress indicator */}
                    {memStatus.nextMilestoneAmount && memStatus.nextMilestoneAmount > 0 && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] text-[#863221]">
                          <span>Progress to {memStatus.nextMilestoneType}</span>
                          <span className="font-mono font-semibold">
                            {Math.min(100, Math.round((memStatus.totalMembershipPaid / memStatus.nextMilestoneAmount) * 100))}%
                          </span>
                        </div>
                        <div className="w-full bg-[#E8DFD8] rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-[#510601] h-1.5 rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.min(100, (memStatus.totalMembershipPaid / memStatus.nextMilestoneAmount) * 100)}%`
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Contributing Membership Receipts List */}
                    {memStatus.receipts.length > 0 && (
                      <div className="pt-2 border-t border-[#E8DFD8]">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#863221] flex items-center gap-1 mb-1.5">
                          <Receipt className="w-3 h-3 text-[#510601]" />
                          <span>Linked Membership Receipts ({memStatus.receipts.length})</span>
                        </span>
                        <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                          {memStatus.receipts.map((r) => (
                            <div
                              key={r.id || r.receiptNumber}
                              className="flex items-center justify-between p-1.5 bg-white rounded-lg border border-[#E8DFD8] text-[11px]"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-[#510601]">#{r.receiptNumber}</span>
                                <span className="text-stone-400">•</span>
                                <span className="text-[#863221]">{r.receiptDate || '—'}</span>
                                <span className="text-stone-400">•</span>
                                <span className="text-stone-600 font-medium">{r.paymentMode || 'Cash'}</span>
                              </div>
                              <span className="font-mono font-bold text-[#180200]">
                                ₹{Number(r.amount).toLocaleString('en-IN')}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Section 2: Donations & Other Contributions (Separate from Membership Milestones) */}
                  <div className="bg-white rounded-2xl p-4 border border-[#E8DFD8] shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-amber-100/80 text-amber-800">
                          <Coins className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="font-bold text-xs uppercase tracking-wider text-[#180200]">
                            Donations & Other Contributions
                          </h4>
                          <p className="text-[10px] text-[#863221]">
                            Non-membership receipts (Donations, Hostel, Scholarship, Events, etc.)
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-[#863221] block">Total Contributed</span>
                        <span className="font-mono font-bold text-sm text-[#3D705C]">
                          ₹{memStatus.totalOtherPaid.toLocaleString('en-IN')}
                        </span>
                      </div>
                    </div>

                    {memStatus.otherReceipts && memStatus.otherReceipts.length > 0 ? (
                      <div className="pt-2 border-t border-[#E8DFD8]">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-[#FAF7F2] text-[#863221] text-[10px] uppercase font-bold tracking-wider border-b border-[#E8DFD8]">
                                <th className="py-2 px-2.5">Receipt No.</th>
                                <th className="py-2 px-2.5">Date</th>
                                <th className="py-2 px-2.5">Particulars</th>
                                <th className="py-2 px-2.5">Sub-Type / Details</th>
                                <th className="py-2 px-2.5">Payment Mode</th>
                                <th className="py-2 px-2.5 text-right">Amount</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E8DFD8]/60">
                              {memStatus.otherReceipts.map((r) => {
                                const subType =
                                  r.donationSubType ||
                                  r.donationDetails ||
                                  r.othersDescription ||
                                  r.paymentReceivedDetails ||
                                  '—';
                                return (
                                  <tr key={r.id || r.receiptNumber} className="hover:bg-[#FAF7F2]/40 transition-colors">
                                    <td className="py-2 px-2.5 font-mono font-bold text-[#510601]">
                                      #{r.receiptNumber}
                                    </td>
                                    <td className="py-2 px-2.5 text-[#863221] font-mono text-[11px]">
                                      {r.receiptDate || '—'}
                                    </td>
                                    <td className="py-2 px-2.5 font-semibold text-[#180200]">
                                      {r.particulars}
                                    </td>
                                    <td className="py-2 px-2.5 text-[#863221] text-[11px]">
                                      {subType}
                                    </td>
                                    <td className="py-2 px-2.5 text-stone-600 text-[11px]">
                                      {r.paymentMode || 'Cash'}
                                    </td>
                                    <td className="py-2 px-2.5 text-right font-mono font-bold text-[#180200]">
                                      ₹{Number(r.amount).toLocaleString('en-IN')}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="pt-2 border-t border-[#E8DFD8]/60 text-center py-2.5 text-stone-400 text-xs">
                        No donations or non-membership receipts recorded for this member.
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
              {/* Card 1: Contact & Basic Info */}
              <div className="bg-[#FAF7F2]/40 rounded-xl p-4 border border-[#E8DFD8] grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Mobile</span>
                  <p className="font-mono font-bold text-sm text-[#510601] mt-0.5">
                    {viewingMember.mobile || viewingMember.mobileNumber || '—'}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Email</span>
                  <p className="font-medium mt-0.5">{viewingMember.email || '—'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Alt Phone</span>
                  <p className="font-mono mt-0.5">{viewingMember.phone || '—'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Status</span>
                  <p className="mt-0.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${viewingMember.status === 'Active' || viewingMember.status === 'Approved'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-red-50 text-red-700 border border-red-200'
                        }`}
                    >
                      {viewingMember.status || 'Active'}
                    </span>
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Gotra</span>
                  <p className="font-bold mt-0.5">{viewingMember.gothra || '—'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Blood Group</span>
                  <p className="font-bold mt-0.5">{viewingMember.bloodGroup || '—'}</p>
                </div>
              </div>

              {/* New registration-form details */}
              <MemberApplicationDetails member={viewingMember} />

              {/* Card 2: Address & Location Details */}
              <div className="bg-white rounded-xl p-4 border border-[#E8DFD8] space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#510601] uppercase tracking-wider">
                  <MapPin className="w-4 h-4" />
                  <span>Address & Geographical Hierarchy</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="sm:col-span-2">
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Street Address</span>
                    <p className="font-medium mt-0.5">{viewingMember.addressLine || viewingMember.address || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Post / Taluk</span>
                    <p className="font-medium mt-0.5">{viewingMember.talukName || viewingMember.post || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">District & State</span>
                    <p className="font-medium mt-0.5">
                      {[viewingMember.districtName, viewingMember.stateName].filter(Boolean).join(', ') || '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">PIN Code</span>
                    <p className="font-mono font-bold text-sm text-[#510601] mt-0.5">
                      {viewingMember.postalCode || '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Label Point</span>
                    <p className="font-medium mt-0.5">{viewingMember.labelPoint || 'Primary'}</p>
                  </div>
                </div>
              </div>

              {/* Card 3: Membership & Magazine Remarks */}
              <div className="bg-[#FAF7F2]/40 rounded-xl p-4 border border-[#E8DFD8] grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Category</span>
                  <p className="font-medium mt-0.5">{viewingMember.category || 'Individual'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Profession</span>
                  <p className="font-medium mt-0.5">{viewingMember.profession || '—'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Native Details</span>
                  <p className="font-medium mt-0.5">{viewingMember.nativeDetails || '—'}</p>
                </div>
                <div className="sm:col-span-3">
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Magazine Remarks</span>
                  <p className="font-medium mt-0.5">{viewingMember.magazineRemarks || 'Standard dispatch'}</p>
                </div>
              </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-[#E8DFD8] bg-[#FAF7F2]/60">
              <button
                type="button"
                onClick={() => {
                  setSelectedMemberIds(new Set([viewingMember.id]));
                  setIsLabelPreviewOpen(true);
                  setViewingMember(null);
                }}
                className="flex items-center gap-1.5 py-2 px-3.5 bg-white border border-[#510601] text-[#510601] text-xs font-semibold rounded-xl hover:bg-[#FAF7F2] transition-colors cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Preview Label</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const m = viewingMember;
                    setViewingMember(null);
                    handleOpenEditModal(m);
                  }}
                  disabled={!hasPermission('members.write')}
                  title={!hasPermission('members.write') ? 'Requires members.write permission' : undefined}
                  className="py-2 px-4 bg-[#510601] hover:bg-[#863221] text-white text-xs font-bold rounded-xl shadow-sm transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Edit Profile
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ==================================================== */}
      {/* MODAL 3: LABEL PREVIEW & PRINT INTERFACE             */}
      {/* ==================================================== */}
      <Modal isOpen={isLabelPreviewOpen} onClose={() => setIsLabelPreviewOpen(false)}>
        <div
          className="bg-white rounded-2xl max-w-4xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2] print:hidden no-print">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                <Printer className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#180200]">
                  Print-Oriented Address Label Preview
                </h3>
                <p className="text-xs text-[#863221]">
                  {selectedMembersForLabels.length} address label{selectedMembersForLabels.length !== 1 ? 's' : ''} ready for dispatch printing. Fixed physical aspect ratio.
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
                Physical 2-column sticker sheet format (3.5" x 2.25" / ~89mm x 57mm). Optimized for standard A4 / label printers without overflowing.
              </span>
            </div>

            {/* Labels Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2 print:gap-4">
              {selectedMembersForLabels.map((m) => (
                <div
                  key={m.id}
                  className="printable-label-card bg-white rounded-xl border-2 border-dashed border-stone-300 p-4 shadow-sm relative flex flex-col justify-between"
                  style={{
                    minHeight: '190px',
                    maxWidth: '380px',
                    margin: '0 auto',
                    width: '100%'
                  }}
                >
                  {/* Organization Top Banner */}
                  <div className="border-b border-[#E8DFD8] pb-1.5 mb-2 flex items-center justify-between">
                    <span className="font-bold text-[10px] tracking-wider text-[#510601] uppercase">
                      Akhila Havyaka Mahasabha
                    </span>
                    <span className="font-mono text-[10px] font-bold bg-[#FAF7F2] text-[#510601] px-1.5 py-0.5 rounded border border-[#E8DFD8]">
                      #{m.membershipNumber || m.id}
                    </span>
                  </div>

                  {/* Recipient Details */}
                  <div className="space-y-1 text-xs">
                    <div className="font-bold text-sm text-[#180200] leading-snug">
                      To: {m.fullName || m.name}
                    </div>
                    <div className="text-[#180200] leading-tight line-clamp-2">
                      {m.addressLine || m.address || '—'}
                    </div>
                    <div className="text-[#863221] text-[11px] font-medium leading-tight">
                      {m.talukName || m.post ? `${m.talukName || m.post}, ` : ''}
                      {m.districtName || ''}{m.stateName ? `, ${m.stateName}` : ''}
                    </div>
                    <div className="font-mono font-bold text-xs text-[#510601] pt-0.5">
                      PIN: {m.postalCode || '—'}
                    </div>
                  </div>

                  {/* Label Footer */}
                  <div className="border-t border-[#E8DFD8] pt-1.5 mt-2 flex items-center justify-between text-[10px] text-[#863221]">
                    <span className="font-mono">
                      Mob: {m.mobile || m.mobileNumber || '—'}
                    </span>
                    <span className="px-1.5 py-0.5 bg-[#FAF7F2] text-[#510601] font-semibold rounded border border-[#E8DFD8]">
                      {m.membershipType || 'Member'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-[#E8DFD8] bg-[#FAF7F2] print:hidden no-print">
            <span className="text-xs text-[#863221]">
              Showing {selectedMembersForLabels.length} printable label cards
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsLabelPreviewOpen(false)}
                className="py-2.5 px-4 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Close Preview
              </button>
              <button
                type="button"
                onClick={handleTriggerPrint}
                className="flex items-center gap-1.5 py-2.5 px-5 bg-[#510601] hover:bg-[#863221] text-white text-xs font-bold rounded-xl shadow-sm transition-colors cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Labels</span>
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ==================================================== */}
      {/* MODAL 4: STATUS TOGGLE CONFIRMATION                  */}
      {/* ==================================================== */}
      <Modal isOpen={Boolean(statusDialog)} onClose={() => setStatusDialog(null)}>
        {statusDialog && (
          <div
            className="bg-white rounded-2xl max-w-sm w-full border border-[#E8DFD8] shadow-2xl p-6 text-center animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3.5 ${statusDialog.nextStatus === 'Inactive'
                ? 'bg-red-100 text-[#ED4636]'
                : 'bg-[#3D705C]/10 text-[#3D705C]'
                }`}
            >
              {statusDialog.nextStatus === 'Inactive' ? (
                <AlertTriangle className="w-7 h-7" />
              ) : (
                <CheckCircle2 className="w-7 h-7" />
              )}
            </div>

            <h3 className="text-base font-bold text-[#180200]">
              {statusDialog.nextStatus === 'Inactive' ? 'Deactivate' : 'Activate'} Member?
            </h3>
            <p className="text-xs text-[#863221] mt-1.5 leading-relaxed">
              Are you sure you want to mark{' '}
              <strong className="text-[#180200]">
                {statusDialog.member.fullName || statusDialog.member.name}
              </strong>{' '}
              as <span className="font-bold">{statusDialog.nextStatus}</span>?
            </p>

            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setStatusDialog(null)}
                className="w-full py-2.5 px-4 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmStatusToggle}
                className={`w-full py-2.5 px-4 text-white text-xs font-bold rounded-xl shadow-sm transition-colors cursor-pointer ${statusDialog.nextStatus === 'Inactive'
                  ? 'bg-[#ED4636] hover:bg-[#C93324]'
                  : 'bg-[#3D705C] hover:bg-[#2F5747]'
                  }`}
              >
                {statusDialog.nextStatus === 'Inactive' ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ==================================================== */}
      {/* MODAL 5: DELETE CONFIRMATION                         */}
      {/* ==================================================== */}
      <Modal isOpen={Boolean(deleteDialog)} onClose={() => setDeleteDialog(null)}>
        {deleteDialog && (
          <div
            className="bg-white rounded-2xl max-w-md w-full border border-[#E8DFD8] shadow-2xl p-6 text-center animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-full bg-red-100 text-[#ED4636] flex items-center justify-center mx-auto mb-3.5">
              <Trash2 className="w-7 h-7" />
            </div>

            <h3 className="text-lg font-bold text-[#180200]">Delete Membership</h3>
            <p className="text-sm font-semibold text-[#510601] mt-2">
              Are you sure you want to delete this membership?
            </p>
            <p className="text-xs text-[#863221] mt-1.5 leading-relaxed bg-[#FAF7F2] p-2.5 rounded-xl border border-[#E8DFD8]">
              <strong className="text-[#180200]">
                {deleteDialog.fullName || deleteDialog.name}
              </strong>{' '}
              <span className="font-mono text-[#510601] font-bold">
                (#{deleteDialog.membershipNumber || deleteDialog.id})
              </span>
            </p>

            

            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setDeleteDialog(null)}
                className="w-full py-2.5 px-4 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                No / Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={!hasPermission('members.delete')}
                title={!hasPermission('members.delete') ? 'Requires members.delete permission' : undefined}
                className="w-full py-2.5 px-4 bg-[#ED4636] hover:bg-[#C93324] text-white text-xs font-bold rounded-xl shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Yes / Delete</span>
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
