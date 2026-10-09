import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal';
import {
  MapPin,
  Building,
  Layers,
  FileText,
  Plus,
  Search,
  Edit3,
  Trash2,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  X,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Upload,
  Download,
  Filter,
  Check,
  Info
} from 'lucide-react';
import api from '../api';
import { askForm, confirmYesNo } from '../utils/dialogs';
import { notify } from '../utils/notify';
import useAuth from '../hooks/useAuth';
import PermissionGate from '../components/PermissionGate';

// <select> values are always strings; API ids are numbers, so convert back
// before comparing with `===` or sending to the API.
const toId = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? v : Number(v));

export default function LocationSetup() {
  const { hasPermission } = useAuth();

  // ----------------------------------------------------
  // PRIMARY TAB STATE
  // 'hierarchy' | 'postal'
  // ----------------------------------------------------
  const [activeTab, setActiveTab] = useState('hierarchy');

  // ----------------------------------------------------
  // MASTER DATA STATES
  // ----------------------------------------------------
  const [states, setStates] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [taluks, setTaluks] = useState([]);
  const [postalCodes, setPostalCodes] = useState([]);

  const fetchMasters = async () => {
    try {
      const [stRes, dtRes, tkRes, pcRes] = await Promise.all([
        api.get('/masters/states?limit=2000'),
        api.get('/masters/districts?limit=2000'),
        api.get('/masters/taluks?limit=20000'),
        api.get('/masters/postal-codes?limit=20000')
      ]);
      
      const sName = (arr, id) => { const f = arr?.find(x => x.id === id); return f ? f.name_en : ''; };
      const dState = (arr, id) => { const f = arr?.find(x => x.id === id); return f ? f.state_id : ''; };

      const mapState = s => ({ id: s.id, name: s.name_en, code: s.code || '', status: s.status ? 'Active' : 'Inactive' });
      const mapDist = d => ({ id: d.id, name: d.name_en, stateId: d.state_id, status: d.status ? 'Active' : 'Inactive', stateName: sName(stRes.data?.data, d.state_id) });
      const mapTk = t => ({ id: t.id, name: t.name_en, districtId: t.district_id, stateId: dState(dtRes.data?.data, t.district_id), status: t.status ? 'Active' : 'Inactive', districtName: sName(dtRes.data?.data, t.district_id) });
      const mapPc = p => ({ 
        id: p.id, 
        postalCode: p.pincode, 
        area: p.post_office_name, 
        stateId: p.state_id, 
        districtId: p.district_id, 
        talukId: p.taluk_id, 
        status: p.status ? 'Active' : 'Inactive',
        stateName: sName(stRes.data?.data, p.state_id),
        districtName: sName(dtRes.data?.data, p.district_id),
        talukName: sName(tkRes.data?.data, p.taluk_id)
      });

      setStates((stRes.data?.data || []).map(mapState));
      setDistricts((dtRes.data?.data || []).map(mapDist));
      setTaluks((tkRes.data?.data || []).map(mapTk));
      setPostalCodes((pcRes.data?.data || []).map(mapPc));
    } catch (err) {
      console.error(err);
      // alert('Failed to fetch geography data');
    }
  };

  useEffect(() => {
    fetchMasters();
  }, []);

  const persistStates = () => { fetchMasters(); };
  const persistDistricts = () => { fetchMasters(); };
  const persistTaluks = () => { fetchMasters(); };
  const persistPostalCodes = () => { fetchMasters(); };

  // Toast feedback
  const [toastMessage, setToastMessage] = useState(null);
  const showToast = (message, type = 'success') => {
    notify(message, type);
  };

  // ====================================================
  // TAB 1: GEOGRAPHIC HIERARCHY STATE & LOGIC
  // ====================================================
  const [selectedStateId, setSelectedStateId] = useState(''); // first state from the server unless one is picked
  const [selectedDistrictIdForTaluk, setSelectedDistrictIdForTaluk] = useState(''); // first district of the state unless one is picked

  // Sub-searches
  const [districtSearchQuery, setDistrictSearchQuery] = useState('');
  const [talukSearchQuery, setTalukSearchQuery] = useState('');

  // Modals for District
  const [isDistrictModalOpen, setIsDistrictModalOpen] = useState(false);
  const [districtModalMode, setDistrictModalMode] = useState('add'); // 'add' | 'edit'
  const [editingDistrict, setEditingDistrict] = useState(null);
  const [districtFormData, setDistrictFormData] = useState({
    name: '',
    stateId: '',
    status: 'Active'
  });
  const [districtFormErrors, setDistrictFormErrors] = useState({});

  // Modals for Taluk
  const [isTalukModalOpen, setIsTalukModalOpen] = useState(false);
  const [talukModalMode, setTalukModalMode] = useState('add'); // 'add' | 'edit'
  const [editingTaluk, setEditingTaluk] = useState(null);
  const [talukFormData, setTalukFormData] = useState({
    name: '',
    stateId: '',
    districtId: '',
    status: 'Active'
  });
  const [talukFormErrors, setTalukFormErrors] = useState({});

  // Confirmation Modals (Delete & Status)
  const [deleteDialog, setDeleteDialog] = useState(null); // { type: 'state' | 'district' | 'taluk' | 'postal', item }
  const [statusDialog, setStatusDialog] = useState(null); // { type: 'state' | 'district' | 'taluk' | 'postal', item, nextStatus }

  // Current active selected state object
  const currentState = states.find((s) => s.id === selectedStateId) || states[0] || { id: '', name: '' };

  // Filtered districts for selected state
  const stateDistricts = useMemo(() => {
    return districts.filter((d) => d.stateId === currentState.id);
  }, [districts, currentState.id]);

  // Displayed districts with search
  const displayedDistricts = useMemo(() => {
    return stateDistricts.filter((d) =>
      d.name.toLowerCase().includes(districtSearchQuery.trim().toLowerCase())
    );
  }, [stateDistricts, districtSearchQuery]);

  // If selected district for taluk doesn't belong to current state, reset to first district of state
  useEffect(() => {
    if (stateDistricts.length > 0) {
      const match = stateDistricts.find((d) => d.id === selectedDistrictIdForTaluk);
      if (!match) {
        setSelectedDistrictIdForTaluk(stateDistricts[0].id);
      }
    } else {
      setSelectedDistrictIdForTaluk('');
    }
  }, [selectedStateId, stateDistricts, selectedDistrictIdForTaluk]);

  // Current selected district for taluk view
  const currentDistrictForTaluk = districts.find((d) => d.id === selectedDistrictIdForTaluk) || stateDistricts[0];

  // Taluks for current district
  const districtTaluks = useMemo(() => {
    if (!currentDistrictForTaluk) return [];
    return taluks.filter((t) => t.districtId === currentDistrictForTaluk.id);
  }, [taluks, currentDistrictForTaluk]);

  // Displayed taluks with search
  const displayedTaluks = useMemo(() => {
    return districtTaluks.filter((t) =>
      t.name.toLowerCase().includes(talukSearchQuery.trim().toLowerCase())
    );
  }, [districtTaluks, talukSearchQuery]);

  // Count helpers for hierarchy badges
  const getTaluksCountForDistrict = (districtId) => {
    return taluks.filter((t) => t.districtId === districtId).length;
  };

  const getPostalCountForTaluk = (talukId) => {
    return postalCodes.filter((p) => p.talukId === talukId).length;
  };

  // --- District CRUD Operations ---
  const handleOpenAddDistrict = () => {
    setDistrictModalMode('add');
    setEditingDistrict(null);
    setDistrictFormData({
      name: '',
      stateId: currentState.id,
      status: 'Active'
    });
    setDistrictFormErrors({});
    setIsDistrictModalOpen(true);
  };

  const handleOpenEditDistrict = (dist) => {
    setDistrictModalMode('edit');
    setEditingDistrict(dist);
    setDistrictFormData({
      name: dist.name,
      stateId: dist.stateId,
      status: dist.status
    });
    setDistrictFormErrors({});
    setIsDistrictModalOpen(true);
  };

  const handleSaveDistrict = async (e) => {
    e.preventDefault();
    const errors = {};
    const trimmedName = districtFormData.name.trim();

    if (!trimmedName) {
      errors.name = 'District name is required';
    }

    if (Object.keys(errors).length > 0) {
      setDistrictFormErrors(errors);
      return;
    }

    const targetState = states.find((s) => s.id === districtFormData.stateId) || currentState;

    try {
      if (districtModalMode === 'add') {
        await api.post('/masters/districts', {
          name_en: trimmedName,
          state_id: targetState.id,
          status: districtFormData.status === 'Active'
        });
        showToast(`District "${trimmedName}" created successfully.`);
      } else {
        await api.put(`/masters/districts/${editingDistrict.id}`, {
          name_en: trimmedName,
          state_id: targetState.id,
          status: districtFormData.status === 'Active'
        });
        showToast(`District "${trimmedName}" updated successfully.`);
      }
      setIsDistrictModalOpen(false);
      fetchMasters();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error saving district', 'error');
    }
  };

  // --- Taluk CRUD Operations ---
  const handleOpenAddTaluk = () => {
    setTalukModalMode('add');
    setEditingTaluk(null);
    setTalukFormData({
      name: '',
      stateId: currentState.id,
      districtId: currentDistrictForTaluk ? currentDistrictForTaluk.id : (stateDistricts[0]?.id || ''),
      status: 'Active'
    });
    setTalukFormErrors({});
    setIsTalukModalOpen(true);
  };

  const handleOpenEditTaluk = (taluk) => {
    setTalukModalMode('edit');
    setEditingTaluk(taluk);
    setTalukFormData({
      name: taluk.name,
      stateId: taluk.stateId,
      districtId: taluk.districtId,
      status: taluk.status
    });
    setTalukFormErrors({});
    setIsTalukModalOpen(true);
  };

  const handleSaveTaluk = async (e) => {
    e.preventDefault();
    const errors = {};
    const trimmedName = talukFormData.name.trim();

    if (!trimmedName) {
      errors.name = 'Taluk name is required';
    } else if (!talukFormData.districtId) {
      errors.districtId = 'Please select a parent district';
    }

    if (Object.keys(errors).length > 0) {
      setTalukFormErrors(errors);
      return;
    }

    const targetDist = districts.find((d) => d.id === talukFormData.districtId);

    try {
      if (talukModalMode === 'add') {
        await api.post('/masters/taluks', {
          name_en: trimmedName,
          district_id: targetDist.id,
          status: talukFormData.status === 'Active'
        });
        showToast(`Taluk "${trimmedName}" created successfully.`);
      } else {
        await api.put(`/masters/taluks/${editingTaluk.id}`, {
          name_en: trimmedName,
          district_id: targetDist.id,
          status: talukFormData.status === 'Active'
        });
        showToast(`Taluk "${trimmedName}" updated successfully.`);
      }
      setIsTalukModalOpen(false);
      fetchMasters();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error saving taluk', 'error');
    }
  };

  // ====================================================
  // TAB 2: POSTAL / PIN CODE DIRECTORY STATE & LOGIC
  // ====================================================
  const [postalSearchQuery, setPostalSearchQuery] = useState('');
  const [postalStateFilter, setPostalStateFilter] = useState('ALL');
  const [postalDistrictFilter, setPostalDistrictFilter] = useState('ALL');
  const [postalPrefixFilter, setPostalPrefixFilter] = useState('ALL');
  const [postalStatusFilter, setPostalStatusFilter] = useState('ALL');

  // Pagination for PIN Directory Table
  const [postalCurrentPage, setPostalCurrentPage] = useState(1);
  const [postalPageSize, setPostalPageSize] = useState(10);

  // Add / Edit PIN Modal State
  const [isPostalModalOpen, setIsPostalModalOpen] = useState(false);
  const [postalModalMode, setPostalModalMode] = useState('add'); // 'add' | 'edit'
  const [editingPostal, setEditingPostal] = useState(null);
  const [postalFormData, setPostalFormData] = useState({
    postalCode: '',
    area: '',
    stateId: '',
    districtId: '',
    talukId: '',
    status: 'Active'
  });
  const [postalFormErrors, setPostalFormErrors] = useState({});

  // Bulk Import Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importPreviewRows, setImportPreviewRows] = useState([]);
  const [importSummary, setImportSummary] = useState(null);
  const [isProcessingImport, setIsProcessingImport] = useState(false);
  const fileInputRef = useRef(null);

  // Filtered districts for Add/Edit PIN modal based on selected state
  const activeDistrictsForModal = useMemo(() => {
    return districts.filter((d) => d.stateId === postalFormData.stateId && (postalModalMode === 'edit' || d.status === 'Active'));
  }, [districts, postalFormData.stateId, postalModalMode]);

  // Filtered taluks for Add/Edit PIN modal based on selected district
  const activeTaluksForModal = useMemo(() => {
    return taluks.filter((t) => t.districtId === postalFormData.districtId && (postalModalMode === 'edit' || t.status === 'Active'));
  }, [taluks, postalFormData.districtId, postalModalMode]);

  // Available districts for Postal Directory filter dropdown
  const filterDistrictsList = useMemo(() => {
    if (postalStateFilter === 'ALL') return districts;
    const s = states.find((st) => st.name.toLowerCase() === postalStateFilter.toLowerCase());
    return s ? districts.filter((d) => d.stateId === s.id) : districts;
  }, [districts, states, postalStateFilter]);

  // Filtering Postal Codes
  const filteredPostalCodes = useMemo(() => {
    return postalCodes.filter((item) => {
      // Search by PIN or Area
      if (postalSearchQuery.trim()) {
        const q = postalSearchQuery.trim().toLowerCase();
        const matchesPin = item.postalCode.toLowerCase().includes(q);
        const matchesArea = (item.area || '').toLowerCase().includes(q);
        const matchesTaluk = (item.talukName || '').toLowerCase().includes(q);
        if (!matchesPin && !matchesArea && !matchesTaluk) return false;
      }

      // Filter by State
      if (postalStateFilter !== 'ALL') {
        if ((item.stateName || '').toLowerCase() !== postalStateFilter.toLowerCase()) return false;
      }

      // Filter by District
      if (postalDistrictFilter !== 'ALL') {
        if ((item.districtName || '').toLowerCase() !== postalDistrictFilter.toLowerCase()) return false;
      }

      // Filter by Prefix
      if (postalPrefixFilter !== 'ALL') {
        if (!item.postalCode.startsWith(postalPrefixFilter)) return false;
      }

      // Filter by Status
      if (postalStatusFilter !== 'ALL') {
        const normalizedItemStatus = item.status === 'Mapped' ? 'Active' : item.status;
        if (normalizedItemStatus !== postalStatusFilter) return false;
      }

      return true;
    });
  }, [postalCodes, postalSearchQuery, postalStateFilter, postalDistrictFilter, postalPrefixFilter, postalStatusFilter]);

  // Pagination calculation
  const totalPostalPages = Math.max(1, Math.ceil(filteredPostalCodes.length / postalPageSize));
  const paginatedPostalCodes = useMemo(() => {
    const startIndex = (postalCurrentPage - 1) * postalPageSize;
    return filteredPostalCodes.slice(startIndex, startIndex + postalPageSize);
  }, [filteredPostalCodes, postalCurrentPage, postalPageSize]);

  // Clear filters
  const handleClearPostalFilters = () => {
    setPostalSearchQuery('');
    setPostalStateFilter('ALL');
    setPostalDistrictFilter('ALL');
    setPostalPrefixFilter('ALL');
    setPostalStatusFilter('ALL');
    setPostalCurrentPage(1);
  };

  // --- Add / Edit Postal Code Handlers ---
  const handleOpenAddPostal = () => {
    setPostalModalMode('add');
    setEditingPostal(null);
    const activeState = states.find((s) => s.status === 'Active') || states[0];
    const matchingDists = districts.filter((d) => d.stateId === activeState?.id && d.status === 'Active');
    const firstDist = matchingDists[0];
    const matchingTaluks = taluks.filter((t) => t.districtId === firstDist?.id && t.status === 'Active');

    setPostalFormData({
      postalCode: '',
      area: '',
      stateId: activeState ? activeState.id : '',
      districtId: firstDist ? firstDist.id : '',
      talukId: matchingTaluks[0] ? matchingTaluks[0].id : '',
      status: 'Active'
    });
    setPostalFormErrors({});
    setIsPostalModalOpen(true);
  };

  const handleOpenEditPostal = (pinItem) => {
    setPostalModalMode('edit');
    setEditingPostal(pinItem);
    setPostalFormData({
      postalCode: pinItem.postalCode,
      area: pinItem.area || '',
      stateId: pinItem.stateId,
      districtId: pinItem.districtId,
      talukId: pinItem.talukId || '',
      status: pinItem.status === 'Mapped' ? 'Active' : pinItem.status
    });
    setPostalFormErrors({});
    setIsPostalModalOpen(true);
  };

  const handleSavePostal = async (e) => {
    e.preventDefault();
    const errors = {};
    const cleanPin = postalFormData.postalCode.trim();
    const cleanArea = postalFormData.area.trim();

    if (!cleanPin) {
      errors.postalCode = 'PIN Code is required';
    } else if (!/^\d{6}$/.test(cleanPin)) {
      errors.postalCode = 'PIN Code must be exactly 6 numeric digits (0-9)';
    }

    if (!cleanArea) {
      errors.area = 'Post Office / Area Name is required';
    }
    if (!postalFormData.stateId) errors.stateId = 'Please select a State';
    if (!postalFormData.districtId) errors.districtId = 'Please select a District';
    if (!postalFormData.talukId) errors.talukId = 'Please select a Taluk';

    if (Object.keys(errors).length > 0) {
      setPostalFormErrors(errors);
      return;
    }

    try {
      if (postalModalMode === 'add') {
        await api.post('/masters/postal-codes', {
          pincode: cleanPin,
          post_office_name: cleanArea,
          state_id: postalFormData.stateId,
          district_id: postalFormData.districtId,
          taluk_id: postalFormData.talukId,
          status: postalFormData.status === 'Active'
        });
        showToast(`PIN Code ${cleanPin} (${cleanArea}) added successfully.`);
      } else {
        await api.put(`/masters/postal-codes/${editingPostal.id}`, {
          pincode: cleanPin,
          post_office_name: cleanArea,
          state_id: postalFormData.stateId,
          district_id: postalFormData.districtId,
          taluk_id: postalFormData.talukId,
          status: postalFormData.status === 'Active'
        });
        showToast(`PIN Code ${cleanPin} updated successfully.`);
      }
      setIsPostalModalOpen(false);
      fetchMasters();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error saving postal code', 'error');
    }
  };

  // ====================================================
  // BULK IMPORT LOGIC & TEMPLATE DOWNLOAD
  // ====================================================
  const handleDownloadSampleTemplate = () => {
    const csvContent = `pin_code,post_office_name,taluk_name,district_name,state_name
576101,Udupi H.O,Udupi,Udupi,Karnataka
575001,Mangaluru H.O,Mangaluru,Dakshina Kannada,Karnataka
560003,Malleswaram H.O,Bengaluru North,Bengaluru Urban,Karnataka
581401,Sirsi H.O,Sirsi,Uttara Kannada,Karnataka
671121,Kasaragod H.O,Kasaragod,Kasaragod,Kerala
670001,Kannur H.O,Kannur,Kannur,Kerala`;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'location_postal_codes_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportPostalCodes = () => {
    if (filteredPostalCodes.length === 0) {
      showToast('No records available to export.', 'error');
      return;
    }

    const headers = ['pin_code', 'post_office_name', 'taluk_name', 'district_name', 'state_name', 'status'];
    const rows = filteredPostalCodes.map((p) => [
      `"${p.postalCode}"`,
      `"${(p.area || '').replace(/"/g, '""')}"`,
      `"${(p.talukName || '').replace(/"/g, '""')}"`,
      `"${(p.districtName || '').replace(/"/g, '""')}"`,
      `"${(p.stateName || '').replace(/"/g, '""')}"`,
      `"${p.status}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `hms_postal_directory_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${filteredPostalCodes.length} PIN code records.`);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      processImportFile(file);
    }
  };

  const processImportFile = (file) => {
    setImportFile(file);
    setIsProcessingImport(true);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      parseAndValidateCsv(text);
      setIsProcessingImport(false);
    };
    reader.onerror = () => {
      showToast('Failed to read file. Please ensure it is a valid CSV or Excel text file.', 'error');
      setIsProcessingImport(false);
    };
    reader.readAsText(file);
  };

  const parseAndValidateCsv = (csvText) => {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length <= 1) {
      setImportPreviewRows([]);
      setImportSummary({
        total: 0,
        valid: 0,
        skipped: 0,
        duplicates: 0,
        invalidPin: 0,
        invalidLocation: 0
      });
      return;
    }

    // Determine header indices
    const headerLine = lines[0].toLowerCase();
    const headers = headerLine.split(',').map((h) => h.trim().replace(/^["']|["']$/g, ''));

    const pinIdx = headers.findIndex((h) => h.includes('pin'));
    const areaIdx = headers.findIndex((h) => h.includes('office') || h.includes('area') || h.includes('post'));
    const talukIdx = headers.findIndex((h) => h.includes('taluk'));
    const districtIdx = headers.findIndex((h) => h.includes('district'));
    const stateIdx = headers.findIndex((h) => h.includes('state'));

    const parsedRows = [];
    let validCount = 0;
    let duplicateCount = 0;
    let invalidPinCount = 0;
    let invalidLocationCount = 0;

    const seenInBatch = new Set();

    for (let i = 1; i < lines.length; i++) {
      const rawLine = lines[i];
      if (!rawLine.trim()) continue;

      // Handle quoted commas
      const cols = rawLine
        .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
        .map((c) => c.trim().replace(/^["']|["']$/g, ''));

      const pinCode = pinIdx >= 0 ? cols[pinIdx] || '' : cols[0] || '';
      const area = areaIdx >= 0 ? cols[areaIdx] || '' : cols[1] || '';
      const talukName = talukIdx >= 0 ? cols[talukIdx] || '' : cols[2] || '';
      const districtName = districtIdx >= 0 ? cols[districtIdx] || '' : cols[3] || '';
      const stateName = stateIdx >= 0 ? cols[stateIdx] || '' : cols[4] || '';

      const rowData = {
        rowNum: i + 1,
        pinCode: pinCode.trim(),
        area: area.trim(),
        talukName: talukName.trim(),
        districtName: districtName.trim(),
        stateName: stateName.trim(),
        isValid: true,
        errorType: null,
        errorMsg: null,
        matchedState: null,
        matchedDistrict: null,
        matchedTaluk: null
      };

      // 1. Validate PIN code (exact 6 numeric digits)
      if (!rowData.pinCode || !/^\d{6}$/.test(rowData.pinCode)) {
        rowData.isValid = false;
        rowData.errorType = 'INVALID_PIN';
        rowData.errorMsg = 'PIN must be exactly 6 numeric digits';
        invalidPinCount++;
      }
      // 2. Validate Area
      else if (!rowData.area) {
        rowData.isValid = false;
        rowData.errorType = 'INVALID_LOCATION';
        rowData.errorMsg = 'Post Office / Area name is required';
        invalidLocationCount++;
      }
      // 3. Validate State against the states on the server
      else {
        const stateMatch = states.find(
          (s) => s.name.toLowerCase() === rowData.stateName.toLowerCase()
        );
        if (!stateMatch) {
          rowData.isValid = false;
          rowData.errorType = 'INVALID_LOCATION';
          rowData.errorMsg = `State "${rowData.stateName || 'empty'}" does not exist in the State master`;
          invalidLocationCount++;
        } else {
          rowData.matchedState = stateMatch;

          // 4. Validate District in State
          const districtMatch = districts.find(
            (d) =>
              d.stateId === stateMatch.id &&
              d.name.toLowerCase() === rowData.districtName.toLowerCase()
          );
          if (!districtMatch) {
            rowData.isValid = false;
            rowData.errorType = 'INVALID_LOCATION';
            rowData.errorMsg = `District "${rowData.districtName}" not found under ${stateMatch.name}`;
            invalidLocationCount++;
          } else {
            rowData.matchedDistrict = districtMatch;

            // 5. Validate Taluk in District
            const talukMatch = taluks.find(
              (t) =>
                t.districtId === districtMatch.id &&
                t.name.toLowerCase() === rowData.talukName.toLowerCase()
            );
            if (!talukMatch) {
              rowData.isValid = false;
              rowData.errorType = 'INVALID_LOCATION';
              rowData.errorMsg = `Taluk "${rowData.talukName}" not found under district ${districtMatch.name}`;
              invalidLocationCount++;
            } else {
              rowData.matchedTaluk = talukMatch;

              // 6. Duplicate check against existing and batch
              const batchKey = `${rowData.pinCode}_${rowData.area.toLowerCase()}`;
              const existsInStore = postalCodes.some(
                (p) =>
                  p.postalCode === rowData.pinCode &&
                  (p.area || '').toLowerCase() === rowData.area.toLowerCase()
              );

              if (existsInStore || seenInBatch.has(batchKey)) {
                rowData.isValid = false;
                rowData.errorType = 'DUPLICATE';
                rowData.errorMsg = 'Duplicate PIN & Post Office mapping';
                duplicateCount++;
              } else {
                seenInBatch.add(batchKey);
                validCount++;
              }
            }
          }
        }
      }

      parsedRows.push(rowData);
    }

    setImportPreviewRows(parsedRows);
    setImportSummary({
      total: parsedRows.length,
      valid: validCount,
      skipped: parsedRows.length - validCount,
      duplicates: duplicateCount,
      invalidPin: invalidPinCount,
      invalidLocation: invalidLocationCount
    });
  };

  const handleCommitImport = async () => {
    const validRows = importPreviewRows.filter((r) => r.isValid);
    if (validRows.length === 0) {
      showToast('No valid records to import.', 'error');
      return;
    }

    // The server imports a CSV of ids it validates again
    const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      'pincode,post_office_name,state_id,district_id,taluk_id',
      ...validRows.map((r) =>
        [r.pinCode, quote(r.area), r.matchedState.id, r.matchedDistrict.id, r.matchedTaluk.id].join(',')
      )
    ].join('\n');
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'postal_codes.csv');

    try {
      const { data } = await api.post('/imports/postal-codes/import', form);
      const added = data?.inserted ?? validRows.length;
      const updated = data?.updated ?? 0;
      showToast(`Imported PIN codes: ${added} added, ${updated} updated.`);
      setIsImportModalOpen(false);
      setImportFile(null);
      setImportPreviewRows([]);
      setImportSummary(null);
      await fetchMasters();
    } catch (err) {
      showToast(err.response?.data?.detail || 'PIN code import failed.', 'error');
    }
  };

  // ====================================================
  // STATUS TOGGLE & DELETE CONFIRMATION HANDLERS
  // ====================================================
  const isPendingApproval = (data) => Boolean(data && (data.approval_request_id || data.status === 'PENDING'));

  const LOCATION_PATHS = { state: 'states', district: 'districts', taluk: 'taluks', postal: 'postal-codes' };
  const locationLabel = (type, item) =>
    type === 'postal'
      ? `PIN Code "${item.postalCode}"`
      : `${type.charAt(0).toUpperCase() + type.slice(1)} "${item.name}"`;

  const handleEditState = async (st) => {
    const v = await askForm({
      title: 'Edit State',
      confirmText: 'Save',
      fields: [
        { name: 'name', label: 'State name', required: true, value: st.name },
        { name: 'code', label: 'State code', value: st.code }
      ]
    });
    if (!v) return;
    try {
      const { data } = await api.put(`/masters/states/${st.id}`, { name_en: v.name, code: v.code || null });
      showToast(isPendingApproval(data) ? `Change to "${st.name}" submitted for approval.` : `State "${v.name}" updated.`);
      await fetchMasters();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error updating state', 'error');
    }
  };

  const handleDeleteState = async (st) => {
    const dCount = districts.filter((d) => d.stateId === st.id).length;
    const tCount = taluks.filter((x) => x.stateId === st.id).length;
    const pCount = postalCodes.filter((x) => x.stateId === st.id).length;
    const ok = await confirmYesNo({
      title: `Delete ${st.name}?`,
      text: `This also deletes its ${dCount} districts, ${tCount} taluks and ${pCount} PIN codes. Members linked to them lose their location names.`,
      confirmText: 'Yes, delete everything',
      danger: true
    });
    if (!ok) return;
    try {
      const { data } = await api.delete(`/masters/states/${st.id}`);
      showToast(isPendingApproval(data) ? `Delete request for "${st.name}" submitted for approval.` : `State "${st.name}" deleted.`);
      if (selectedStateId === st.id) setSelectedStateId('');
      await fetchMasters();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error deleting state', 'error');
    }
  };

  const handleConfirmStatusToggle = async () => {
    if (!statusDialog) return;
    const { type, item, nextStatus } = statusDialog;
    try {
      const { data } = await api.put(`/masters/${LOCATION_PATHS[type]}/${item.id}`, {
        status: nextStatus === 'Active'
      }, { params: { reason: 'Status changed via UI' } });
      showToast(
        isPendingApproval(data)
          ? `Status change for ${locationLabel(type, item)} submitted for approval.`
          : `${locationLabel(type, item)} set to ${nextStatus}.`
      );
      await fetchMasters();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Error updating status', 'error');
    }
    setStatusDialog(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteDialog) return;
    const { type, item } = deleteDialog;
    try {
      const { data } = await api.delete(`/masters/${LOCATION_PATHS[type]}/${item.id}`, { params: { reason: 'Deleted via UI' } });
      showToast(
        isPendingApproval(data)
          ? `Delete request for ${locationLabel(type, item)} submitted for approval.`
          : `${locationLabel(type, item)} deleted.`
      );
      await fetchMasters();
    } catch (err) {
      // the server refuses to delete a parent that still has children and says why
      showToast(err.response?.data?.detail || 'Error deleting record', 'error');
    }
    setDeleteDialog(null);
  };

  return (
    <PermissionGate required="masters.read">
    <div className="space-y-6">
      {/* ---------------------------------------------------- */}
      {/* BREADCRUMB & HEADER                                  */}
      {/* ---------------------------------------------------- */}
      <div>
<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#180200] tracking-tight">Location Setup</h1>

          </div>
        </div>
      </div>

      {/* ---------------------------------------------------- */}
      {/* TOP TAB SWITCHER (INTERNAL MODULE TABS)             */}
      {/* ---------------------------------------------------- */}
      <div className="bg-white rounded-xl p-1.5 border border-[#E8DFD8] shadow-sm inline-flex w-full sm:w-auto">
        <button
          type="button"
          onClick={() => setActiveTab('hierarchy')}
          className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${activeTab === 'hierarchy'
            ? 'bg-[#510601] text-white shadow-md'
            : 'text-[#863221] hover:text-[#510601] hover:bg-[#FAF7F2]'
            }`}
        >
          <Layers className="w-4 h-4" />
          <span>Geographic Hierarchy</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('postal')}
          className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${activeTab === 'postal'
            ? 'bg-[#510601] text-white shadow-md'
            : 'text-[#863221] hover:text-[#510601] hover:bg-[#FAF7F2]'
            }`}
        >
          <Building className="w-4 h-4" />
          <span>Postal / PIN Code Directory</span>
        </button>
      </div>

      {/* ---------------------------------------------------- */}
      {/* TAB 1: GEOGRAPHIC HIERARCHY                          */}
      {/* ---------------------------------------------------- */}
      {activeTab === 'hierarchy' && (
        <div className="space-y-6">
          {/* Section 1: States Card */}
          <div className="bg-white rounded-xl border border-[#E8DFD8] p-5 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-[#E8DFD8]">
              <div>

                <p className="text-xs text-[#863221] mt-1">
                  Select a state to view and manage its districts and taluks below. Creation of arbitrary states outside Karnataka & Kerala is restricted.
                </p>
              </div>
            </div>

            {/* State Selection Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {states.map((st) => {
                const isSelected = st.id === selectedStateId;
                const stateDistCount = districts.filter((d) => d.stateId === st.id).length;
                const stateTalukCount = taluks.filter((t) => t.stateId === st.id).length;
                const statePinCount = postalCodes.filter((p) => p.stateId === st.id).length;

                return (
                  <div
                    key={st.id}
                    onClick={() => setSelectedStateId(st.id)}
                    className={`cursor-pointer rounded-xl p-4 border transition-all relative ${isSelected
                      ? 'border-[#510601] bg-[#FAF7F2] shadow-sm ring-2 ring-[#510601]/20'
                      : 'border-[#E8DFD8] bg-white hover:border-[#863221]/50 hover:bg-[#FAF7F2]/40'
                      }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${isSelected ? 'bg-[#510601] text-white' : 'bg-[#E8DFD8]/60 text-[#863221]'
                            }`}
                        >
                          {st.code || st.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="font-bold text-[#180200] text-base">{st.name}</h3>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-[#863221]">
                            <span>{stateDistCount} Districts</span>
                            <span>•</span>
                            <span>{stateTalukCount} Taluks</span>
                            <span>•</span>
                            <span>{statePinCount} PIN Codes</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={!hasPermission('masters.write')}
                          onClick={(e) => {
                            e.stopPropagation();
                            setStatusDialog({
                              type: 'state',
                              item: st,
                              nextStatus: st.status === 'Active' ? 'Inactive' : 'Active'
                            });
                          }}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                            st.status === 'Active'
                              ? 'bg-[#3D705C]/10 text-[#3D705C] hover:bg-[#3D705C]/20 border border-[#3D705C]/20'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200'
                          }`}
                          title={!hasPermission('masters.write') ? 'Requires masters.write permission' : `Click to ${st.status === 'Active' ? 'deactivate' : 'activate'}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${st.status === 'Active' ? 'bg-[#3D705C]' : 'bg-gray-400'}`} />
                          <span>{st.status}</span>
                        </button>
                        <button
                          type="button"
                          disabled={!hasPermission('masters.write')}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditState(st);
                          }}
                          className="p-1.5 rounded-lg text-[#510601] hover:bg-[#FAF7F2] border border-[#E8DFD8] cursor-pointer disabled:opacity-40"
                          title={!hasPermission('masters.write') ? 'Requires masters.write permission' : 'Edit State'}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={!hasPermission('masters.delete')}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteState(st);
                          }}
                          className="p-1.5 rounded-lg text-[#ED4636] hover:bg-red-50 border border-red-200 cursor-pointer disabled:opacity-40"
                          title={!hasPermission('masters.delete') ? 'Requires masters.delete permission' : 'Delete State'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: Two-column layout for Districts & Taluks */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* DISTRICTS COLUMN */}
            <div className="bg-white rounded-xl border border-[#E8DFD8] shadow-sm flex flex-col">
              <div className="p-4 border-b border-[#E8DFD8] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-[#180200]">Districts ({currentState.name})</h3>
                    <span className="px-2 py-0.5 text-xs font-semibold bg-[#FAF7F2] text-[#863221] rounded-full border border-[#E8DFD8]">
                      {displayedDistricts.length}
                    </span>
                  </div>
                  <p className="text-xs text-[#863221] mt-0.5">
                    Manage districts belonging to {currentState.name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenAddDistrict}
                  disabled={!hasPermission('masters.write')}
                  title={!hasPermission('masters.write') ? 'Requires masters.write permission' : undefined}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#510601] text-white text-xs font-semibold rounded-lg hover:bg-[#863221] transition-colors self-start sm:self-auto"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add District</span>
                </button>
              </div>

              {/* District Search */}
              <div className="p-3 border-b border-[#E8DFD8] bg-[#FAF7F2]/40">
                <div className="relative">
                  <Search className="w-4 h-4 text-[#863221]/60 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search district name..."
                    value={districtSearchQuery}
                    onChange={(e) => setDistrictSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-[#E8DFD8] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#510601]"
                  />
                  {districtSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setDistrictSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#863221] hover:text-[#510601]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* District List Table */}
              <div className="overflow-x-auto flex-1 max-h-[460px]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-[#FAF7F2] sticky top-0 z-10 border-b border-[#E8DFD8] text-[#863221] font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">District Name</th>
                      <th className="py-2.5 px-3 text-center">Taluks</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8DFD8]">
                    {displayedDistricts.length === 0 ? (
                      <tr>
                        <td colSpan="4" className="py-8 text-center text-[#863221]">
                          No districts found for {currentState.name}.
                        </td>
                      </tr>
                    ) : (
                      displayedDistricts.map((dist) => {
                        const isDistSelected = dist.id === selectedDistrictIdForTaluk;
                        const talukCount = getTaluksCountForDistrict(dist.id);

                        return (
                          <tr
                            key={dist.id}
                            onClick={() => setSelectedDistrictIdForTaluk(dist.id)}
                            className={`cursor-pointer transition-colors ${isDistSelected ? 'bg-[#FAF7F2] font-semibold text-[#510601]' : 'hover:bg-[#FAF7F2]/60'
                              }`}
                          >
                            <td className="py-2.5 px-3 font-medium">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`w-2 h-2 rounded-full ${isDistSelected ? 'bg-[#510601]' : 'bg-transparent'
                                    }`}
                                />
                                <span>{dist.name}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className="px-2 py-0.5 bg-white border border-[#E8DFD8] rounded text-xs text-[#863221]">
                                {talukCount}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <button
                                type="button"
                                disabled={!hasPermission('masters.write')}
                                onClick={() =>
                                  setStatusDialog({
                                    type: 'district',
                                    item: dist,
                                    nextStatus: dist.status === 'Active' ? 'Inactive' : 'Active'
                                  })
                                }
                                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold transition-all cursor-pointer ${
                                  dist.status === 'Active'
                                    ? 'bg-[#3D705C]/10 text-[#3D705C] hover:bg-[#3D705C]/20 border border-[#3D705C]/20'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200'
                                }`}
                                title={!hasPermission('masters.write') ? 'Requires masters.write permission' : `Click to ${dist.status === 'Active' ? 'deactivate' : 'activate'}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${dist.status === 'Active' ? 'bg-[#3D705C]' : 'bg-gray-400'}`} />
                                <span>{dist.status}</span>
                              </button>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditDistrict(dist)}
                                  disabled={!hasPermission('masters.write')}
                                  className="p-1 text-[#863221] hover:text-[#510601] hover:bg-white rounded transition-colors"
                                  title={!hasPermission('masters.write') ? 'Requires masters.write permission' : 'Edit District'}
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleteDialog({ type: 'district', item: dist })}
                                  disabled={!hasPermission('masters.delete')}
                                  className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
                                  title={!hasPermission('masters.delete') ? 'Requires masters.delete permission' : 'Delete District'}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
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
            </div>

            {/* TALUKS COLUMN */}
            <div className="bg-white rounded-xl border border-[#E8DFD8] shadow-sm flex flex-col">
              <div className="p-4 border-b border-[#E8DFD8] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-[#180200]">
                      Taluks ({currentDistrictForTaluk ? currentDistrictForTaluk.name : 'All'})
                    </h3>
                    <span className="px-2 py-0.5 text-xs font-semibold bg-[#FAF7F2] text-[#863221] rounded-full border border-[#E8DFD8]">
                      {displayedTaluks.length}
                    </span>
                  </div>
                  <p className="text-xs text-[#863221] mt-0.5">
                    Under {currentState.name} → {currentDistrictForTaluk?.name || 'Selected District'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenAddTaluk}
                  disabled={!currentDistrictForTaluk || !hasPermission('masters.write')}
                  title={!hasPermission('masters.write') ? 'Requires masters.write permission' : undefined}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#510601] text-white text-xs font-semibold rounded-lg hover:bg-[#863221] disabled:opacity-50 transition-colors self-start sm:self-auto"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Taluk</span>
                </button>
              </div>

              {/* District Dropdown Selector & Taluk Search */}
              <div className="p-3 border-b border-[#E8DFD8] bg-[#FAF7F2]/40 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <select
                    value={selectedDistrictIdForTaluk}
                    onChange={(e) => setSelectedDistrictIdForTaluk(toId(e.target.value))}
                    className="w-full py-1.5 px-2.5 text-xs bg-white border border-[#E8DFD8] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#510601] font-medium text-[#180200]"
                  >
                    {stateDistricts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({getTaluksCountForDistrict(d.id)} taluks)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="relative">
                  <Search className="w-4 h-4 text-[#863221]/60 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search taluk name..."
                    value={talukSearchQuery}
                    onChange={(e) => setTalukSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-[#E8DFD8] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#510601]"
                  />
                  {talukSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setTalukSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#863221] hover:text-[#510601]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Taluk List Table */}
              <div className="overflow-x-auto flex-1 max-h-[460px]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-[#FAF7F2] sticky top-0 z-10 border-b border-[#E8DFD8] text-[#863221] font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">Taluk Name</th>
                      <th className="py-2.5 px-3 text-center">PIN Codes</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8DFD8]">
                    {displayedTaluks.length === 0 ? (
                      <tr>
                        <td colSpan="4" className="py-8 text-center text-[#863221]">
                          No taluks found for {currentDistrictForTaluk?.name || 'this district'}.
                        </td>
                      </tr>
                    ) : (
                      displayedTaluks.map((tk) => {
                        const pinCount = getPostalCountForTaluk(tk.id);

                        return (
                          <tr key={tk.id} className="hover:bg-[#FAF7F2]/60 transition-colors">
                            <td className="py-2.5 px-3 font-medium text-[#180200]">
                              {tk.name}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className="px-2 py-0.5 bg-white border border-[#E8DFD8] rounded text-xs text-[#863221]">
                                {pinCount}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <button
                                type="button"
                                disabled={!hasPermission('masters.write')}
                                onClick={() =>
                                  setStatusDialog({
                                    type: 'taluk',
                                    item: tk,
                                    nextStatus: tk.status === 'Active' ? 'Inactive' : 'Active'
                                  })
                                }
                                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold transition-all cursor-pointer ${
                                  tk.status === 'Active'
                                    ? 'bg-[#3D705C]/10 text-[#3D705C] hover:bg-[#3D705C]/20 border border-[#3D705C]/20'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200'
                                }`}
                                title={!hasPermission('masters.write') ? 'Requires masters.write permission' : `Click to ${tk.status === 'Active' ? 'deactivate' : 'activate'}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${tk.status === 'Active' ? 'bg-[#3D705C]' : 'bg-gray-400'}`} />
                                <span>{tk.status}</span>
                              </button>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditTaluk(tk)}
                                  disabled={!hasPermission('masters.write')}
                                  className="p-1 text-[#863221] hover:text-[#510601] hover:bg-white rounded transition-colors"
                                  title={!hasPermission('masters.write') ? 'Requires masters.write permission' : 'Edit Taluk'}
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleteDialog({ type: 'taluk', item: tk })}
                                  disabled={!hasPermission('masters.delete')}
                                  className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
                                  title={!hasPermission('masters.delete') ? 'Requires masters.delete permission' : 'Delete Taluk'}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
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
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* TAB 2: POSTAL / PIN CODE DIRECTORY                   */}
      {/* ---------------------------------------------------- */}
      {activeTab === 'postal' && (
        <div className="space-y-6">
          {/* Search, Filter & Action Bar */}
          <div className="bg-white rounded-xl border border-[#E8DFD8] p-4 shadow-sm space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Primary Search */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-[#863221]/60 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by 6-digit PIN Code, Post Office, or Taluk name..."
                  value={postalSearchQuery}
                  onChange={(e) => {
                    setPostalSearchQuery(e.target.value);
                    setPostalCurrentPage(1);
                  }}
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#510601]"
                />
                {postalSearchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setPostalSearchQuery('');
                      setPostalCurrentPage(1);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#863221] hover:text-[#510601]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Action Buttons: Add, Bulk Import, Export */}
              <div className="flex items-center flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleOpenAddPostal}
                  disabled={!hasPermission('masters.write')}
                  title={!hasPermission('masters.write') ? 'Requires masters.write permission' : undefined}
                  className="flex items-center gap-1.5 px-4 py-2 bg-[#510601] text-white text-sm font-semibold rounded-lg hover:bg-[#863221] transition-colors shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add PIN Code</span>
                </button>
                <button
                  type="button"
                  disabled={!hasPermission('masters.write')}
                  title={!hasPermission('masters.write') ? 'Requires masters.write permission' : undefined}
                  onClick={() => {
                    setImportFile(null);
                    setImportPreviewRows([]);
                    setImportSummary(null);
                    setIsImportModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-[#510601] text-[#510601] text-sm font-semibold rounded-lg hover:bg-[#FAF7F2] transition-colors shadow-sm"
                >
                  <Upload className="w-4 h-4" />
                  <span>Bulk Import</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportPostalCodes}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-[#FAF7F2] border border-[#E8DFD8] text-[#863221] text-sm font-medium rounded-lg hover:bg-[#E8DFD8]/50 transition-colors"
                  title="Export Filtered PIN Directory to CSV"
                >
                  <Download className="w-4 h-4" />
                  <span>Export</span>
                </button>
              </div>
            </div>

            {/* Filter Controls Row */}
            <div className="pt-3 border-t border-[#E8DFD8] grid grid-cols-2 sm:grid-cols-5 gap-3">
              {/* State Filter */}
              <div>
                <label className="block text-[11px] font-semibold text-[#863221] mb-1">State</label>
                <select
                  value={postalStateFilter}
                  onChange={(e) => {
                    setPostalStateFilter(e.target.value);
                    setPostalDistrictFilter('ALL');
                    setPostalCurrentPage(1);
                  }}
                  className="w-full py-1.5 px-2.5 text-xs bg-white border border-[#E8DFD8] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#510601] text-[#180200]"
                >
                  <option value="ALL">All States</option>
                  {states.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* District Filter */}
              <div>
                <label className="block text-[11px] font-semibold text-[#863221] mb-1">District</label>
                <select
                  value={postalDistrictFilter}
                  onChange={(e) => {
                    setPostalDistrictFilter(e.target.value);
                    setPostalCurrentPage(1);
                  }}
                  className="w-full py-1.5 px-2.5 text-xs bg-white border border-[#E8DFD8] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#510601] text-[#180200]"
                >
                  <option value="ALL">All Districts</option>
                  {filterDistrictsList.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Prefix Filter */}
              <div>
                <label className="block text-[11px] font-semibold text-[#863221] mb-1">PIN Prefix</label>
                <select
                  value={postalPrefixFilter}
                  onChange={(e) => {
                    setPostalPrefixFilter(e.target.value);
                    setPostalCurrentPage(1);
                  }}
                  className="w-full py-1.5 px-2.5 text-xs bg-white border border-[#E8DFD8] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#510601] text-[#180200]"
                >
                  <option value="ALL">All Prefixes</option>
                  <option value="56">56xxxx (Bengaluru & surrounding)</option>
                  <option value="57">57xxxx (Coastal & Malnad KA)</option>
                  <option value="58">58xxxx (North KA)</option>
                  <option value="67">67xxxx (North Kerala)</option>
                  <option value="68">68xxxx (Central Kerala)</option>
                  <option value="69">69xxxx (South Kerala)</option>
                </select>
              </div>

              {/* Status Filter */}
              <div>
                <label className="block text-[11px] font-semibold text-[#863221] mb-1">Status</label>
                <select
                  value={postalStatusFilter}
                  onChange={(e) => {
                    setPostalStatusFilter(e.target.value);
                    setPostalCurrentPage(1);
                  }}
                  className="w-full py-1.5 px-2.5 text-xs bg-white border border-[#E8DFD8] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#510601] text-[#180200]"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>

              {/* Clear Filters Button */}
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleClearPostalFilters}
                  className="w-full py-1.5 px-2.5 text-xs bg-[#FAF7F2] text-[#863221] hover:text-[#510601] hover:bg-[#E8DFD8]/60 font-semibold border border-[#E8DFD8] rounded-lg transition-colors"
                >
                  Reset Filters
                </button>
              </div>
            </div>
          </div>

          {/* Postal Directory Data Table */}
          <div className="bg-white rounded-xl border border-[#E8DFD8] shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#863221] font-semibold">
                  <tr>
                    <th className="py-3 px-4">PIN Code</th>
                    <th className="py-3 px-4">Post Office / Area Name</th>
                    <th className="py-3 px-4">Taluk</th>
                    <th className="py-3 px-4">District</th>
                    <th className="py-3 px-4">State</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8DFD8]">
                  {paginatedPostalCodes.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="py-12 text-center text-[#863221]">
                        <div className="flex flex-col items-center justify-center">
                          <AlertCircle className="w-8 h-8 text-[#863221]/40 mb-2" />
                          <p className="font-semibold text-sm text-[#180200]">No postal codes found</p>
                          <p className="text-xs text-[#863221] mt-1">
                            Try adjusting your search criteria or add a new PIN code mapping.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedPostalCodes.map((item) => {
                      const displayStatus = item.status === 'Mapped' ? 'Active' : item.status;

                      return (
                        <tr key={item.id} className="hover:bg-[#FAF7F2]/60 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-sm text-[#510601]">
                            {item.postalCode}
                          </td>
                          <td className="py-3 px-4 font-medium text-[#180200]">
                            {item.area || '—'}
                          </td>
                          <td className="py-3 px-4 text-[#863221]">{item.talukName || '—'}</td>
                          <td className="py-3 px-4 text-[#863221]">{item.districtName || '—'}</td>
                          <td className="py-3 px-4">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#FAF7F2] text-[#510601] border border-[#E8DFD8]">
                              {item.stateName || ''}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              type="button"
                              disabled={!hasPermission('masters.write')}
                              onClick={() =>
                                setStatusDialog({
                                  type: 'postal',
                                  item,
                                  nextStatus: displayStatus === 'Active' ? 'Inactive' : 'Active'
                                })
                              }
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                                displayStatus === 'Active'
                                  ? 'bg-[#3D705C]/10 text-[#3D705C] hover:bg-[#3D705C]/20 border border-[#3D705C]/20'
                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200'
                              }`}
                              title={!hasPermission('masters.write') ? 'Requires masters.write permission' : `Click to ${displayStatus === 'Active' ? 'deactivate' : 'activate'}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${displayStatus === 'Active' ? 'bg-[#3D705C]' : 'bg-gray-400'}`} />
                              <span>{displayStatus}</span>
                            </button>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenEditPostal(item)}
                                disabled={!hasPermission('masters.write')}
                                className="p-1.5 text-[#863221] hover:text-[#510601] hover:bg-[#FAF7F2] rounded-lg transition-colors"
                                title={!hasPermission('masters.write') ? 'Requires masters.write permission' : 'Edit PIN Code Mapping'}
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteDialog({ type: 'postal', item })}
                                disabled={!hasPermission('masters.delete')}
                                className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors"
                                title={!hasPermission('masters.delete') ? 'Requires masters.delete permission' : 'Delete PIN Code'}
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

            {/* Pagination Controls */}
            {filteredPostalCodes.length > 0 && (
              <div className="p-4 border-t border-[#E8DFD8] bg-[#FAF7F2]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#863221]">
                <div className="flex items-center gap-2">
                  <span>Showing</span>
                  <span className="font-bold text-[#180200]">
                    {Math.min((postalCurrentPage - 1) * postalPageSize + 1, filteredPostalCodes.length)}
                  </span>
                  <span>to</span>
                  <span className="font-bold text-[#180200]">
                    {Math.min(postalCurrentPage * postalPageSize, filteredPostalCodes.length)}
                  </span>
                  <span>of</span>
                  <span className="font-bold text-[#180200]">{filteredPostalCodes.length}</span>
                  <span>entries</span>
                </div>

                <div className="flex items-center gap-4 self-end sm:self-auto">
                  <div className="flex items-center gap-1.5">
                    <span>Rows per page:</span>
                    <select
                      value={postalPageSize}
                      onChange={(e) => {
                        setPostalPageSize(Number(e.target.value));
                        setPostalCurrentPage(1);
                      }}
                      className="py-1 px-2 text-xs bg-white border border-[#E8DFD8] rounded focus:outline-none focus:ring-1 focus:ring-[#510601]"
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
                      disabled={postalCurrentPage <= 1}
                      onClick={() => setPostalCurrentPage((p) => Math.max(1, p - 1))}
                      className="p-1 rounded bg-white border border-[#E8DFD8] disabled:opacity-40 hover:bg-[#FAF7F2] transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="px-2 font-medium">
                      {postalCurrentPage} / {totalPostalPages}
                    </span>
                    <button
                      type="button"
                      disabled={postalCurrentPage >= totalPostalPages}
                      onClick={() => setPostalCurrentPage((p) => Math.min(totalPostalPages, p + 1))}
                      className="p-1 rounded bg-white border border-[#E8DFD8] disabled:opacity-40 hover:bg-[#FAF7F2] transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* MODAL 1: ADD / EDIT DISTRICT                         */}
      {/* ==================================================== */}
      <Modal
        isOpen={isDistrictModalOpen}
        onClose={() => setIsDistrictModalOpen(false)}
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
                  {districtModalMode === 'add' ? 'Add District' : 'Edit District'}
                </h3>
                <p className="text-xs text-[#863221]">
                  {districtModalMode === 'add' ? `Add a new district under ${currentState.name}` : `Editing "${editingDistrict?.name}"`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsDistrictModalOpen(false)}
              className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form Body */}
          <form onSubmit={handleSaveDistrict} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                State <span className="text-red-500">*</span>
              </label>
              <select
                value={districtFormData.stateId}
                onChange={(e) => setDistrictFormData({ ...districtFormData, stateId: toId(e.target.value) })}
                className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm font-medium text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
              >
                {states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.status})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                District Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={districtFormData.name}
                onChange={(e) => {
                  setDistrictFormData({ ...districtFormData, name: e.target.value });
                  if (districtFormErrors.name) {
                    setDistrictFormErrors({ ...districtFormErrors, name: null });
                  }
                }}
                placeholder="e.g. Bengaluru Urban, Dakshina Kannada"
                className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-medium text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${
                  districtFormErrors.name
                    ? 'border-red-500 ring-1 ring-red-500/30 bg-red-50/20'
                    : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                }`}
              />
              {districtFormErrors.name && (
                <p className="text-xs text-red-600 mt-1 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {districtFormErrors.name}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">Status</label>
              <select
                value={districtFormData.status}
                onChange={(e) => setDistrictFormData({ ...districtFormData, status: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm font-medium text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E8DFD8] bg-[#FAF7F2] -mx-6 -mb-6 mt-6 rounded-b-2xl">
              <button
                type="button"
                onClick={() => setIsDistrictModalOpen(false)}
                className="py-2.5 px-4 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="py-2.5 px-5 bg-[#510601] hover:bg-[#863221] text-white text-xs font-bold rounded-xl shadow-sm transition-colors cursor-pointer"
              >
                {districtModalMode === 'add' ? 'Add District' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* ==================================================== */}
      {/* MODAL 2: ADD / EDIT TALUK                            */}
      {/* ==================================================== */}
      <Modal
        isOpen={isTalukModalOpen}
        onClose={() => setIsTalukModalOpen(false)}
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
                  {talukModalMode === 'add' ? 'Add Taluk' : 'Edit Taluk'}
                </h3>
                <p className="text-xs text-[#863221]">
                  {talukModalMode === 'add' ? `Add a new taluk under ${currentDistrictForTaluk?.name || currentState.name}` : `Editing "${editingTaluk?.name}"`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsTalukModalOpen(false)}
              className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form Body */}
          <form onSubmit={handleSaveTaluk} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                State <span className="text-red-500">*</span>
              </label>
              <select
                value={talukFormData.stateId}
                onChange={(e) => {
                  const newStateId = toId(e.target.value);
                  const matchDists = districts.filter((d) => d.stateId === newStateId);
                  setTalukFormData({
                    ...talukFormData,
                    stateId: newStateId,
                    districtId: matchDists[0] ? matchDists[0].id : ''
                  });
                }}
                className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm font-medium text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
              >
                {states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Parent District <span className="text-red-500">*</span>
              </label>
              <select
                value={talukFormData.districtId}
                onChange={(e) => {
                  setTalukFormData({ ...talukFormData, districtId: toId(e.target.value) });
                  if (talukFormErrors.districtId) {
                    setTalukFormErrors({ ...talukFormErrors, districtId: null });
                  }
                }}
                className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-medium text-[#180200] focus:outline-none transition-colors ${
                  talukFormErrors.districtId
                    ? 'border-red-500 ring-1 ring-red-500/30 bg-red-50/20'
                    : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                }`}
              >
                <option value="">-- Select District --</option>
                {districts
                  .filter((d) => d.stateId === talukFormData.stateId)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.status})
                    </option>
                  ))}
              </select>
              {talukFormErrors.districtId && (
                <p className="text-xs text-red-600 mt-1 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {talukFormErrors.districtId}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                Taluk Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={talukFormData.name}
                onChange={(e) => {
                  setTalukFormData({ ...talukFormData, name: e.target.value });
                  if (talukFormErrors.name) {
                    setTalukFormErrors({ ...talukFormErrors, name: null });
                  }
                }}
                placeholder="e.g. Mangaluru, Sirsi, Udupi"
                className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-medium text-[#180200] placeholder-[#863221]/40 focus:outline-none transition-colors ${
                  talukFormErrors.name
                    ? 'border-red-500 ring-1 ring-red-500/30 bg-red-50/20'
                    : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                }`}
              />
              {talukFormErrors.name && (
                <p className="text-xs text-red-600 mt-1 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {talukFormErrors.name}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">Status</label>
              <select
                value={talukFormData.status}
                onChange={(e) => setTalukFormData({ ...talukFormData, status: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm font-medium text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E8DFD8] bg-[#FAF7F2] -mx-6 -mb-6 mt-6 rounded-b-2xl">
              <button
                type="button"
                onClick={() => setIsTalukModalOpen(false)}
                className="py-2.5 px-4 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="py-2.5 px-5 bg-[#510601] hover:bg-[#863221] text-white text-xs font-bold rounded-xl shadow-sm transition-colors cursor-pointer"
              >
                {talukModalMode === 'add' ? 'Add Taluk' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* ==================================================== */}
      {/* MODAL 3: ADD / EDIT POSTAL / PIN CODE MAPPING        */}
      {/* ==================================================== */}
      <Modal
        isOpen={isPostalModalOpen}
        onClose={() => setIsPostalModalOpen(false)}
      >
        <div
          className="bg-white rounded-2xl max-w-lg w-full border border-[#E8DFD8] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2]">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                <Building className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#180200]">
                  {postalModalMode === 'add' ? 'Add PIN Code Entry' : 'Edit PIN Code Mapping'}
                </h3>
                <p className="text-xs text-[#863221]">
                  {postalModalMode === 'add' ? 'Configure a new 6-digit postal code mapping.' : `Editing PIN "${editingPostal?.postalCode}"`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsPostalModalOpen(false)}
              className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form Body */}
          <form onSubmit={handleSavePostal} className="p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* PIN Code */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  PIN Code (6 Digits Numeric) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={postalFormData.postalCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, ''); // Numeric only
                    setPostalFormData({ ...postalFormData, postalCode: val });
                    if (postalFormErrors.postalCode) {
                      setPostalFormErrors({ ...postalFormErrors, postalCode: null });
                    }
                  }}
                  placeholder="e.g. 576101"
                  className={`w-full px-3.5 py-2.5 text-sm font-mono bg-white border rounded-xl focus:outline-none transition-colors ${
                    postalFormErrors.postalCode
                      ? 'border-red-500 ring-1 ring-red-500/30 bg-red-50/20'
                      : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                  }`}
                />
                {postalFormErrors.postalCode && (
                  <p className="text-xs text-red-600 mt-1 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {postalFormErrors.postalCode}
                  </p>
                )}
              </div>

              {/* Post Office / Area Name */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Post Office / Area Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={postalFormData.area}
                  onChange={(e) => {
                    setPostalFormData({ ...postalFormData, area: e.target.value });
                    if (postalFormErrors.area) {
                      setPostalFormErrors({ ...postalFormErrors, area: null });
                    }
                  }}
                  placeholder="e.g. Udupi H.O, Malleswaram"
                  className={`w-full px-3.5 py-2.5 text-sm bg-white border rounded-xl focus:outline-none transition-colors ${
                    postalFormErrors.area
                      ? 'border-red-500 ring-1 ring-red-500/30 bg-red-50/20'
                      : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                  }`}
                />
                {postalFormErrors.area && (
                  <p className="text-xs text-red-600 mt-1 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {postalFormErrors.area}
                  </p>
                )}
              </div>
            </div>

            {/* Cascading State -> District -> Taluk */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              {/* 1. State */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  State <span className="text-red-500">*</span>
                </label>
                <select
                  value={postalFormData.stateId}
                  onChange={(e) => {
                    const newStateId = toId(e.target.value);
                    const newDists = districts.filter(
                      (d) => d.stateId === newStateId && (postalModalMode === 'edit' || d.status === 'Active')
                    );
                    const firstD = newDists[0];
                    const newTaluks = taluks.filter(
                      (t) => t.districtId === firstD?.id && (postalModalMode === 'edit' || t.status === 'Active')
                    );

                    setPostalFormData({
                      ...postalFormData,
                      stateId: newStateId,
                      districtId: firstD ? firstD.id : '',
                      talukId: newTaluks[0] ? newTaluks[0].id : ''
                    });
                  }}
                  className="w-full px-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl text-sm font-medium text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
                >
                  {states
                    .filter((s) => postalModalMode === 'edit' || s.status === 'Active')
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </div>

              {/* 2. District (Dependent on State) */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  District <span className="text-red-500">*</span>
                </label>
                <select
                  value={postalFormData.districtId}
                  onChange={(e) => {
                    const newDistId = toId(e.target.value);
                    const newTaluks = taluks.filter(
                      (t) => t.districtId === newDistId && (postalModalMode === 'edit' || t.status === 'Active')
                    );

                    setPostalFormData({
                      ...postalFormData,
                      districtId: newDistId,
                      talukId: newTaluks[0] ? newTaluks[0].id : ''
                    });
                    if (postalFormErrors.districtId) {
                      setPostalFormErrors({ ...postalFormErrors, districtId: null });
                    }
                  }}
                  className={`w-full px-3 py-2 text-xs bg-white border rounded-xl text-sm font-medium text-[#180200] focus:outline-none transition-colors ${
                    postalFormErrors.districtId
                      ? 'border-red-500 ring-1 ring-red-500/30 bg-red-50/20'
                      : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                  }`}
                >
                  <option value="">-- Select District --</option>
                  {activeDistrictsForModal.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                {postalFormErrors.districtId && (
                  <p className="text-xs text-red-600 mt-1 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {postalFormErrors.districtId}
                  </p>
                )}
              </div>

              {/* 3. Taluk (Dependent on District) */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Taluk <span className="text-red-500">*</span>
                </label>
                <select
                  value={postalFormData.talukId}
                  onChange={(e) => {
                    setPostalFormData({ ...postalFormData, talukId: toId(e.target.value) });
                    if (postalFormErrors.talukId) {
                      setPostalFormErrors({ ...postalFormErrors, talukId: null });
                    }
                  }}
                  className={`w-full px-3 py-2 text-xs bg-white border rounded-xl text-sm font-medium text-[#180200] focus:outline-none transition-colors ${
                    postalFormErrors.talukId
                      ? 'border-red-500 ring-1 ring-red-500/30 bg-red-50/20'
                      : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                  }`}
                >
                  <option value="">-- Select Taluk --</option>
                  {activeTaluksForModal.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {postalFormErrors.talukId && (
                  <p className="text-xs text-red-600 mt-1 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {postalFormErrors.talukId}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">Status</label>
              <select
                value={postalFormData.status}
                onChange={(e) => setPostalFormData({ ...postalFormData, status: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm font-medium text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E8DFD8] bg-[#FAF7F2] -mx-6 -mb-6 mt-6 rounded-b-2xl">
              <button
                type="button"
                onClick={() => setIsPostalModalOpen(false)}
                className="py-2.5 px-4 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="py-2.5 px-5 bg-[#510601] hover:bg-[#863221] text-white text-xs font-bold rounded-xl shadow-sm transition-colors cursor-pointer"
              >
                {postalModalMode === 'add' ? 'Add PIN Code' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* ==================================================== */}
      {/* MODAL 4: BULK IMPORT MODAL & SUMMARY                 */}
      {/* ==================================================== */}
      <Modal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      >
        <div
          className="bg-white rounded-2xl max-w-2xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2]">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#510601]/10 text-[#510601]">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#180200]">
                  Bulk Import PIN Code Directory
                </h3>
                <p className="text-xs text-[#863221]">
                  Import multiple postal code mappings using CSV or Excel spreadsheet format.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsImportModalOpen(false)}
              className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
            {/* Instructions & Template Download */}
            <div className="bg-[#FAF7F2] rounded-xl p-4 border border-[#E8DFD8] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-bold text-[#180200]">Import CSV / Excel Template Requirements</h4>
                <p className="text-[11px] text-[#863221] mt-0.5">
                  Columns: <code className="bg-white px-1.5 py-0.5 rounded border border-[#E8DFD8] font-mono">pin_code, post_office_name, taluk_name, district_name, state_name</code>
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadSampleTemplate}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-[#510601] text-[#510601] text-xs font-semibold rounded-xl hover:bg-[#510601] hover:text-white transition-all self-start sm:self-auto shadow-sm cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Template</span>
              </button>
            </div>

            {/* File Drag & Drop / Upload Area */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#E8DFD8] hover:border-[#510601] bg-white hover:bg-[#FAF7F2]/50 rounded-2xl p-6 text-center cursor-pointer transition-colors"
            >
              <input
                type="file"
                ref={fileInputRef}
                accept=".csv,.txt,.xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="flex flex-col items-center justify-center">
                <div className="w-12 h-12 rounded-full bg-[#510601]/10 text-[#510601] flex items-center justify-center mb-2">
                  <Upload className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-[#180200]">
                  {importFile ? importFile.name : 'Click to select or drag & drop CSV file here'}
                </p>
                <p className="text-xs text-[#863221] mt-1">Supports CSV, text, and spreadsheet exports</p>
              </div>
            </div>

            {/* Import Summary Results */}
            {importSummary && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-center">
                  <div className="bg-[#FAF7F2] p-2.5 rounded-xl border border-[#E8DFD8]">
                    <span className="text-[10px] uppercase tracking-wider text-[#863221] font-semibold">Total Rows</span>
                    <p className="text-lg font-bold text-[#180200]">{importSummary.total}</p>
                  </div>
                  <div className="bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
                    <span className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold">Valid (Ready)</span>
                    <p className="text-lg font-bold text-emerald-700">{importSummary.valid}</p>
                  </div>
                  <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                    <span className="text-[10px] uppercase tracking-wider text-amber-800 font-semibold">Duplicates</span>
                    <p className="text-lg font-bold text-amber-700">{importSummary.duplicates}</p>
                  </div>
                  <div className="bg-red-50 p-2.5 rounded-xl border border-red-200">
                    <span className="text-[10px] uppercase tracking-wider text-red-800 font-semibold">Invalid PIN</span>
                    <p className="text-lg font-bold text-red-700">{importSummary.invalidPin}</p>
                  </div>
                  <div className="bg-rose-50 p-2.5 rounded-xl border border-rose-200 col-span-2 sm:col-span-1">
                    <span className="text-[10px] uppercase tracking-wider text-rose-800 font-semibold">Invalid Mapping</span>
                    <p className="text-lg font-bold text-rose-700">{importSummary.invalidLocation}</p>
                  </div>
                </div>

                {/* Preview Table with Validation Status */}
                <div>
                  <h5 className="text-xs font-bold text-[#180200] mb-2">Rows Validation Preview:</h5>
                  <div className="max-h-56 overflow-y-auto border border-[#E8DFD8] rounded-xl">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-[#FAF7F2] sticky top-0 border-b border-[#E8DFD8] text-[#863221]">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">PIN Code</th>
                          <th className="py-2.5 px-3">Post Office</th>
                          <th className="py-2.5 px-3">Location Hierarchy</th>
                          <th className="py-2.5 px-3 text-right">Validation</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E8DFD8]">
                        {importPreviewRows.map((r) => (
                          <tr key={r.rowNum} className={r.isValid ? 'bg-white' : 'bg-red-50/30'}>
                            <td className="py-2.5 px-3 text-[#863221]">{r.rowNum}</td>
                            <td className="py-2.5 px-3 font-mono font-bold text-[#510601]">{r.pinCode || '—'}</td>
                            <td className="py-2.5 px-3 text-[#180200] font-medium">{r.area || '—'}</td>
                            <td className="py-2.5 px-3 text-[#863221]">
                              {r.talukName} → {r.districtName} → {r.stateName}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {r.isValid ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                  <Check className="w-3 h-3" /> Valid
                                </span>
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-200"
                                  title={r.errorMsg}
                                >
                                  <AlertTriangle className="w-3 h-3" /> {r.errorType} ({r.errorMsg})
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-[#E8DFD8] bg-[#FAF7F2] -mx-6 -mb-6 mt-6 rounded-b-2xl">
              <p className="text-xs text-[#863221]">
                Only valid rows without errors will be imported into the directory.
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsImportModalOpen(false)}
                  className="py-2.5 px-4 border border-[#E8DFD8] text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={(!importSummary || importSummary.valid === 0) || !hasPermission('masters.write')}
                  title={!hasPermission('masters.write') ? 'Requires masters.write permission' : undefined}
                  onClick={handleCommitImport}
                  className="py-2.5 px-5 bg-[#510601] hover:bg-[#863221] text-white text-xs font-bold rounded-xl shadow-sm disabled:opacity-40 transition-colors cursor-pointer"
                >
                  Import {importSummary?.valid || 0} Valid Records
                </button>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* ==================================================== */}
      {/* MODAL 5: STATUS TOGGLE CONFIRMATION                  */}
      {/* ==================================================== */}
      <Modal
        isOpen={Boolean(statusDialog)}
        onClose={() => setStatusDialog(null)}
      >
        {statusDialog && (
          <div
            className="bg-white rounded-2xl max-w-sm w-full border border-[#E8DFD8] shadow-2xl p-6 text-center animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3.5 ${
                statusDialog.nextStatus === 'Inactive'
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
              {statusDialog.nextStatus === 'Inactive' ? 'Deactivate' : 'Activate'}{' '}
              {statusDialog.type === 'state'
                ? 'State'
                : statusDialog.type === 'district'
                ? 'District'
                : statusDialog.type === 'taluk'
                ? 'Taluk'
                : 'PIN Code'}?
            </h3>
            <p className="text-xs text-[#863221] mt-1.5 leading-relaxed">
              Are you sure you want to mark{' '}
              <strong className="text-[#180200]">
                {statusDialog.item.name || `${statusDialog.item.postalCode} (${statusDialog.item.area})`}
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
                disabled={!hasPermission('masters.write')}
                title={!hasPermission('masters.write') ? 'Requires masters.write permission' : undefined}
                onClick={handleConfirmStatusToggle}
                className={`w-full py-2.5 px-4 text-white text-xs font-bold rounded-xl shadow-sm transition-colors cursor-pointer ${
                  statusDialog.nextStatus === 'Inactive'
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
      {/* MODAL 6: DELETE CONFIRMATION                         */}
      {/* ==================================================== */}
      <Modal
        isOpen={Boolean(deleteDialog)}
        onClose={() => setDeleteDialog(null)}
      >
        {deleteDialog && (
          <div
            className="bg-white rounded-2xl max-w-md w-full border border-[#E8DFD8] shadow-2xl p-6 text-center animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-14 h-14 rounded-full bg-red-100 text-[#ED4636] flex items-center justify-center mx-auto mb-3.5">
              <Trash2 className="w-7 h-7" />
            </div>

            <h3 className="text-lg font-bold text-[#180200]">
              Delete{' '}
              {deleteDialog.type === 'district'
                ? 'District'
                : deleteDialog.type === 'taluk'
                ? 'Taluk'
                : 'PIN Code'}?
            </h3>
            <p className="text-xs text-[#863221] mt-1.5 leading-relaxed">
              Are you sure you want to delete{' '}
              <strong className="text-[#180200]">
                {deleteDialog?.item?.name || `${deleteDialog?.item?.postalCode} (${deleteDialog?.item?.area})`}
              </strong>
              ? This action cannot be undone.
            </p>

            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setDeleteDialog(null)}
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
