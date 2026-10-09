import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { notify } from '../utils/notify';
import useAuth from '../hooks/useAuth';
import PermissionGate from '../components/PermissionGate';
import {
  Building2,
  Printer,
  Bell,
  PhoneCall,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  X,
  ChevronRight,
  Upload,
  Image as ImageIcon,
  Trash2,
  Globe,
  Mail,
  Phone,
  Smartphone,
  MapPin,
  Calendar,
  FileText,
  ShieldCheck,
  Eye,
  Info,
  Layers,
  Sparkles
} from 'lucide-react';
import {
  ORGANISATION_TYPES,
  EMPTY_ORGANISATION_SETTINGS,
  settingsFromApi,
  settingsToApi
} from '../utils/organisationStore';
import { loadLocations, findLocationByPin } from '../utils/serverData';

export default function OrganisationSettings() {
  const { hasPermission } = useAuth();

  // Tab state: 'profile' | 'print' | 'notifications' | 'contact'
  const [activeTab, setActiveTab] = useState('profile');

  // Master Settings State
  const [settings, setSettings] = useState(EMPTY_ORGANISATION_SETTINGS);
  const [savedSettingsSnapshot, setSavedSettingsSnapshot] = useState(EMPTY_ORGANISATION_SETTINGS);

  // Errors & UI Feedback
  const [errors, setErrors] = useState({});
  const [toast, setToast] = useState(null);
  const [isDirty, setIsDirty] = useState(false);

  const fileInputRef = useRef(null);

  // The logo is a protected server file: fetch it as an image blob for display
  const loadLogoUrl = async (path) => {
    if (!path) return null;
    const res = await api.get('/system/files', { params: { path }, responseType: 'blob' });
    return URL.createObjectURL(res.data);
  };

  const fetchSettings = async () => {
    try {
      const { data } = await api.get('/system/settings');
      const next = settingsFromApi(data);
      try {
        next.profile.logo = await loadLogoUrl(next.profile.logoPath);
      } catch (logoErr) {
        console.error('Failed to load the logo.', logoErr);
      }
      setSettings(next);
      setSavedSettingsSnapshot(next);
    } catch (err) {
      console.error('Failed to load settings from API', err);
      showToast(err.response?.data?.detail || 'Failed to load settings from the server.', 'error');
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);




  const showToast = (message, type = 'success') => {
    notify(message, type);
  };

  // Check if form has modified changes compared to saved snapshot
  useEffect(() => {
    const isDifferent = JSON.stringify(settings) !== JSON.stringify(savedSettingsSnapshot);
    setIsDirty(isDifferent);
  }, [settings, savedSettingsSnapshot]);

  // Nested form change handlers
  const handleProfileChange = (e) => {
    const { name, value } = e.target;
    setSettings((prev) => ({
      ...prev,
      profile: {
        ...prev.profile,
        [name]: value
      }
    }));

    if (errors[`profile_${name}`]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[`profile_${name}`];
        return next;
      });
    }

    // Auto-fill state / district on 6-digit PIN code lookup
    if (name === 'postalCode' && value.length === 6 && /^\d{6}$/.test(value)) {
      loadLocations()
        .then((loc) => {
          const match = findLocationByPin(loc.postalCodes, value);
          if (!match.found) return;
          setSettings((prev) => ({
            ...prev,
            profile: {
              ...prev.profile,
              postalCode: value,
              state: match.stateName || prev.profile.state,
              district: match.districtName || prev.profile.district,
              taluk: match.talukName || match.area || prev.profile.taluk
            }
          }));
          showToast(`Resolved location for PIN ${value}: ${match.districtName}, ${match.stateName}`);
        })
        .catch(() => showToast('Could not look up the PIN code on the server.', 'error'));
    }
  };

  const handlePrintHeadersChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSettings((prev) => ({
      ...prev,
      printHeaders: {
        ...prev.printHeaders,
        [name]: type === 'checkbox' ? checked : value
      }
    }));
  };

  const handleNotificationToggle = (key) => {
    setSettings((prev) => ({
      ...prev,
      notifications: {
        ...prev.notifications,
        [key]: !prev.notifications[key]
      }
    }));
  };

  const handleContactChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSettings((prev) => ({
      ...prev,
      contact: {
        ...prev.contact,
        [name]: type === 'checkbox' ? checked : value
      }
    }));

    if (errors[`contact_${name}`]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[`contact_${name}`];
        return next;
      });
    }
  };

  // Logo upload / reset handlers
  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please select a valid image file (PNG, JPG, SVG, WebP).', 'error');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      showToast('Image file size exceeds 2MB limit.', 'error');
      return;
    }

    const form = new FormData();
    form.append('file', file);
    api.post('/system/settings/logo', form)
      .then(({ data }) => {
        const preview = URL.createObjectURL(file);
        const apply = (prev) => ({ ...prev, profile: { ...prev.profile, logo: preview, logoPath: data.logo_path } });
        setSettings(apply);
        setSavedSettingsSnapshot(apply);
        showToast('Logo uploaded successfully.');
      })
      .catch((err) => showToast(err.response?.data?.detail || 'Failed to upload the logo.', 'error'));
  };

  const handleRemoveLogo = () => {
    api.put('/system/settings', { logo_path: null })
      .then(() => {
        const apply = (prev) => ({ ...prev, profile: { ...prev.profile, logo: null, logoPath: null } });
        setSettings(apply);
        setSavedSettingsSnapshot(apply);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        showToast('Logo removed.');
      })
      .catch((err) => showToast(err.response?.data?.detail || 'Failed to remove the logo.', 'error'));
  };

  // Validation
  const validateSettings = () => {
    const errs = {};

    // 1. Profile Validation
    if (!settings.profile.organisationName?.trim()) {
      errs['profile_organisationName'] = 'Organisation Name is mandatory.';
    }

    if (settings.profile.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.profile.email.trim())) {
      errs['profile_email'] = 'Please enter a valid email address.';
    }

    if (settings.profile.mobile?.trim() && !/^\d{10}$/.test(settings.profile.mobile.trim())) {
      errs['profile_mobile'] = 'Mobile number must be a 10-digit number.';
    }

    if (settings.profile.postalCode?.trim() && !/^\d{6}$/.test(settings.profile.postalCode.trim())) {
      errs['profile_postalCode'] = 'PIN Code must be 6 numeric digits.';
    }

    // 2. Contact Validation
    if (!settings.contact.primaryContactName?.trim()) {
      errs['contact_primaryContactName'] = 'Primary Contact Name is mandatory.';
    }

    if (!settings.contact.contactNumber?.trim()) {
      errs['contact_contactNumber'] = 'Contact Number is mandatory.';
    } else if (!/^\d{10}$/.test(settings.contact.contactNumber.trim())) {
      errs['contact_contactNumber'] = 'Contact Number must be a valid 10-digit mobile number.';
    }

    if (!settings.contact.email?.trim()) {
      errs['contact_email'] = 'Primary Contact Email is mandatory.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.contact.email.trim())) {
      errs['contact_email'] = 'Please enter a valid email address.';
    }

    if (settings.contact.alternateEmail?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.contact.alternateEmail.trim())) {
      errs['contact_alternateEmail'] = 'Please enter a valid alternate email address.';
    }

    if (settings.contact.supportEmail?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.contact.supportEmail.trim())) {
      errs['contact_supportEmail'] = 'Please enter a valid support email address.';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Save Settings
  const handleSave = (e) => {
    if (e) e.preventDefault();

    if (!validateSettings()) {
      // Find which tab has errors and switch to it if needed
      const errorKeys = Object.keys(errors);
      const hasProfileErr = errorKeys.some((k) => k.startsWith('profile_'));
      const hasContactErr = errorKeys.some((k) => k.startsWith('contact_'));

      if (hasProfileErr && activeTab !== 'profile') {
        setActiveTab('profile');
      } else if (hasContactErr && activeTab !== 'contact') {
        setActiveTab('contact');
      }

      showToast('Please fix the highlighted required fields before saving.', 'error');
      return;
    }

    // If print header organisationName is empty, auto sync with profile organisationName
    const payload = {
      ...settings,
      printHeaders: {
        ...settings.printHeaders,
        organisationName: settings.printHeaders.organisationName?.trim() || settings.profile.organisationName.trim()
      }
    };

    

    const apiPayload = settingsToApi(payload);

    api.put('/system/settings', apiPayload)
      .then(() => {
        setSavedSettingsSnapshot(payload);
        setSettings(payload);
        setIsDirty(false);
        showToast('Organisation settings updated successfully via API.');
      })
      .catch(err => {
        console.error(err);
        showToast('Failed to save settings to API.', 'error');
      });


  };

  // Reset to last saved snapshot
  const handleReset = async () => {
    await fetchSettings();
    setErrors({});
    setIsDirty(false);
    showToast('Settings restored to the values saved on the server.');
  };

  return (
    <PermissionGate required="system.read">
    <div className="space-y-6 pb-20 font-sans">
      {/* ---------------------------------------------------- */}
      {/* Toast Notification Alert                            */}
      {/* ---------------------------------------------------- */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl px-5 py-3.5 shadow-2xl border transition-all animate-in slide-in-from-bottom-4 duration-200 ${toast.type === 'error'
            ? 'bg-[#180200] text-white border-red-500/50'
            : 'bg-[#180200] text-white border-emerald-500/50'
            }`}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          )}
          <span className="text-xs sm:text-sm font-medium">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-2 rounded-lg p-1 hover:bg-white/10 text-stone-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* BREADCRUMB & HEADER                                  */}
      {/* ---------------------------------------------------- */}
      <div>
<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#180200] tracking-tight">
              Organisation Settings
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2.5 rounded-xl border border-[#E8DFD8] hover:border-[#863221] bg-white text-[#863221] hover:text-[#510601] text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm hover:bg-[#FAF7F2] cursor-pointer"
              title="Revert modifications to previously saved values"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Reset</span>
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={!hasPermission('system.write')}
              title={!hasPermission('system.write') ? 'You need the system.write permission' : 'Save Changes'}
              className="px-5 py-2.5 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs sm:text-sm font-bold rounded-xl shadow-sm hover:shadow-md transition-all flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Save Changes</span>
              {isDirty && (
                <span className="w-2 h-2 rounded-full bg-[#FFC107] animate-pulse" title="Unsaved changes" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------- */}
      {/* TAB NAVIGATION                                       */}
      {/* ---------------------------------------------------- */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] p-1.5 shadow-sm flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`flex-1 min-w-[140px] py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${activeTab === 'profile'
            ? 'bg-[#510601] text-white shadow-sm'
            : 'text-[#863221] hover:bg-[#FAF7F2] hover:text-[#510601]'
            }`}
        >
          <Building2 className="w-4 h-4 shrink-0" />
          <span>Organisation Profile</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('print')}
          className={`flex-1 min-w-[140px] py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${activeTab === 'print'
            ? 'bg-[#510601] text-white shadow-sm'
            : 'text-[#863221] hover:bg-[#FAF7F2] hover:text-[#510601]'
            }`}
        >
          <Printer className="w-4 h-4 shrink-0" />
          <span>Print Headers</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('notifications')}
          className={`flex-1 min-w-[140px] py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${activeTab === 'notifications'
            ? 'bg-[#510601] text-white shadow-sm'
            : 'text-[#863221] hover:bg-[#FAF7F2] hover:text-[#510601]'
            }`}
        >
          <Bell className="w-4 h-4 shrink-0" />
          <span>Notifications</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('contact')}
          className={`flex-1 min-w-[140px] py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${activeTab === 'contact'
            ? 'bg-[#510601] text-white shadow-sm'
            : 'text-[#863221] hover:bg-[#FAF7F2] hover:text-[#510601]'
            }`}
        >
          <PhoneCall className="w-4 h-4 shrink-0" />
          <span>Contact</span>
        </button>
      </div>

      {/* ============================================================ */}
      {/* TAB 1: ORGANISATION PROFILE                                  */}
      {/* ============================================================ */}
      {activeTab === 'profile' && (
        <div className="space-y-6 animate-in fade-in-50 duration-200">
          {/* Logo & Identity Summary Card */}
          <div className="bg-white rounded-2xl border border-[#E8DFD8] p-5 sm:p-6 shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)]">
            <div className="flex items-center gap-2 pb-4 border-b border-[#E8DFD8]">
              <div className="p-1.5 rounded-lg bg-[#510601]/10 text-[#510601]">
                <ImageIcon className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-[#180200] uppercase tracking-wider">
                Organisation Logo & Brand Identity
              </h2>
            </div>

            <div className="mt-5 flex flex-col sm:flex-row items-center gap-6">
              {/* Logo Preview Container */}
              <div className="relative w-48 h-28 rounded-2xl bg-[#180200] border border-[#510601]/40 flex items-center justify-center p-3.5 shrink-0 overflow-hidden shadow-sm">
                {settings.profile.logo ? (
                  <img
                    src={settings.profile.logo}
                    alt="Organisation Logo Preview"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-xs font-medium text-stone-400">
                    No logo uploaded
                  </span>
                )}
              </div>

              {/* Upload Controls */}
              <div className="flex-1 space-y-3 text-center sm:text-left">
                <div>
                  <h3 className="text-sm font-bold text-[#180200]">
                    Organisation Logo
                  </h3>
                  <p className="text-xs text-[#863221] mt-0.5">
                    This logo appears on printed receipts, identity cards, label headers, and exported reports.
                  </p>
                  <p className="text-[11px] text-[#863221]/70 mt-1">
                    Recommended: Transparent PNG or SVG with aspect ratio 1:1 or 4:3 (Max file size: 2MB).
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 pt-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!hasPermission('system.write')}
                    title={!hasPermission('system.write') ? 'You need the system.write permission' : settings.profile.logo ? 'Change Logo' : 'Upload Logo'}
                    className="px-3.5 py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-bold rounded-xl shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{settings.profile.logo ? 'Change Logo' : 'Upload Logo'}</span>
                  </button>

                  {settings.profile.logo && (
                    <button
                      type="button"
                      onClick={handleRemoveLogo}
                      className="px-3.5 py-2 bg-white hover:bg-red-50 text-[#ED4636] border border-[#E8DFD8] hover:border-red-200 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Core Profile Details */}
          <div className="bg-white rounded-2xl border border-[#E8DFD8] p-5 sm:p-6 shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-[#E8DFD8]">
              <div className="p-1.5 rounded-lg bg-[#510601]/10 text-[#510601]">
                <Building2 className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-[#180200] uppercase tracking-wider">
                1. Core Organisation Profile
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Field: Organisation Name * */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Organisation Name <span className="text-[#ED4636]">*</span>
                </label>
                <input
                  type="text"
                  name="organisationName"
                  value={settings.profile.organisationName}
                  onChange={handleProfileChange}
                  className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-bold text-[#180200] focus:outline-none transition-colors ${errors.profile_organisationName
                    ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                    : 'border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601]'
                    }`}
                />
                {errors.profile_organisationName && (
                  <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {errors.profile_organisationName}
                  </p>
                )}
              </div>

              {/* Field: Short Name */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Short Name / Acronym
                </label>
                <input
                  type="text"
                  name="shortName"
                  value={settings.profile.shortName}
                  onChange={handleProfileChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm font-bold text-[#510601] focus:outline-none"
                />
              </div>

              {/* Field: Registration Number */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Registration Number
                </label>
                <input
                  type="text"
                  name="registrationNumber"
                  value={settings.profile.registrationNumber}
                  onChange={handleProfileChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm font-mono font-semibold text-[#180200] focus:outline-none"
                />
              </div>

              {/* Field: Organisation Type */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Organisation Type
                </label>
                <select
                  name="organisationType"
                  value={settings.profile.organisationType}
                  onChange={handleProfileChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm font-medium text-[#180200] focus:outline-none cursor-pointer"
                >
                  {ORGANISATION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              {/* Field: Established Year */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Established Year
                </label>
                <input
                  type="text"
                  name="establishedYear"
                  value={settings.profile.establishedYear}
                  onChange={handleProfileChange}
                  maxLength={4}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm font-mono text-[#180200] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Registered Address & Location Details */}
          <div className="bg-white rounded-2xl border border-[#E8DFD8] p-5 sm:p-6 shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-[#E8DFD8]">
              <div className="p-1.5 rounded-lg bg-[#510601]/10 text-[#510601]">
                <MapPin className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-[#180200] uppercase tracking-wider">
                2. Registered Address & Location Setup
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Address Line 1 */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Address Line 1
                </label>
                <input
                  type="text"
                  name="addressLine1"
                  value={settings.profile.addressLine1}
                  onChange={handleProfileChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm text-[#180200] focus:outline-none"
                />
              </div>

              {/* Address Line 2 */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Address Line 2 (Landmark / Area)
                </label>
                <input
                  type="text"
                  name="addressLine2"
                  value={settings.profile.addressLine2}
                  onChange={handleProfileChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm text-[#180200] focus:outline-none"
                />
              </div>

              {/* Country */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Country
                </label>
                <input
                  type="text"
                  name="country"
                  value={settings.profile.country}
                  onChange={handleProfileChange}
                  className="w-full px-3.5 py-2.5 bg-[#FAF7F2] border border-[#E8DFD8] focus:border-[#510601] rounded-xl text-sm font-semibold text-[#180200] focus:outline-none"
                />
              </div>

              {/* State */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  State
                </label>
                <input
                  type="text"
                  name="state"
                  value={settings.profile.state}
                  onChange={handleProfileChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] rounded-xl text-sm text-[#180200] focus:outline-none"
                />
              </div>

              {/* District */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  District
                </label>
                <input
                  type="text"
                  name="district"
                  value={settings.profile.district}
                  onChange={handleProfileChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] rounded-xl text-sm text-[#180200] focus:outline-none"
                />
              </div>

              {/* Taluk */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Taluk / Area
                </label>
                <input
                  type="text"
                  name="taluk"
                  value={settings.profile.taluk}
                  onChange={handleProfileChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] rounded-xl text-sm text-[#180200] focus:outline-none"
                />
              </div>

              {/* PIN Code */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  PIN Code
                  <span className="text-[10px] font-normal text-[#863221] ml-1">(auto-lookup)</span>
                </label>
                <input
                  type="text"
                  name="postalCode"
                  value={settings.profile.postalCode}
                  onChange={handleProfileChange}
                  maxLength={6}
                  className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-mono font-bold text-[#180200] focus:outline-none transition-colors ${errors.profile_postalCode
                    ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                    : 'border-[#E8DFD8] focus:border-[#510601]'
                    }`}
                />
                {errors.profile_postalCode && (
                  <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {errors.profile_postalCode}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Online & Official Communications */}
          <div className="bg-white rounded-2xl border border-[#E8DFD8] p-5 sm:p-6 shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-[#E8DFD8]">
              <div className="p-1.5 rounded-lg bg-[#510601]/10 text-[#510601]">
                <Globe className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-[#180200] uppercase tracking-wider">
                3. Official Communications & Web Presence
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Website */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Official Website
                </label>
                <div className="relative">
                  <Globe className="w-4 h-4 text-[#863221]/50 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="url"
                    name="website"
                    value={settings.profile.website}
                    onChange={handleProfileChange}
                    className="w-full pl-9 pr-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-xs sm:text-sm text-[#180200] focus:outline-none"
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Official Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#863221]/50 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    name="email"
                    value={settings.profile.email}
                    onChange={handleProfileChange}
                    className={`w-full pl-9 pr-3.5 py-2.5 bg-white border rounded-xl text-xs sm:text-sm text-[#180200] focus:outline-none transition-colors ${errors.profile_email
                      ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                      : 'border-[#E8DFD8] focus:border-[#510601]'
                      }`}
                  />
                </div>
                {errors.profile_email && (
                  <p className="text-xs text-[#ED4636] mt-1 font-medium">{errors.profile_email}</p>
                )}
              </div>

              {/* Phone (Landline) */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Office Phone (Landline)
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-[#863221]/50 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    name="phone"
                    value={settings.profile.phone}
                    onChange={handleProfileChange}
                    className="w-full pl-9 pr-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] rounded-xl text-xs sm:text-sm font-mono text-[#180200] focus:outline-none"
                  />
                </div>
              </div>

              {/* Mobile */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Official Mobile
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#863221]/70">
                    +91
                  </span>
                  <input
                    type="tel"
                    name="mobile"
                    value={settings.profile.mobile}
                    onChange={handleProfileChange}
                    maxLength={10}
                    className={`w-full pl-11 pr-3.5 py-2.5 bg-white border rounded-xl text-xs sm:text-sm font-mono text-[#180200] focus:outline-none transition-colors ${errors.profile_mobile
                      ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                      : 'border-[#E8DFD8] focus:border-[#510601]'
                      }`}
                  />
                </div>
                {errors.profile_mobile && (
                  <p className="text-xs text-[#ED4636] mt-1 font-medium">{errors.profile_mobile}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 2: PRINT HEADERS SETTINGS & LIVE PREVIEW                */}
      {/* ============================================================ */}
      {activeTab === 'print' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in-50 duration-200">
          {/* Header Configurations Form (7 cols on desktop) */}
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-white rounded-2xl border border-[#E8DFD8] p-5 sm:p-6 shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#E8DFD8]">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-[#510601]/10 text-[#510601]">
                    <Printer className="w-4 h-4" />
                  </div>
                  <h2 className="text-sm font-bold text-[#180200] uppercase tracking-wider">
                    Print Header Configurations
                  </h2>
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FAF7F2] text-[#510601] border border-[#E8DFD8]">
                  Universal Template
                </span>
              </div>

              {/* Toggle: Show Organisation Logo */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#FAF7F2] border border-[#E8DFD8]">
                <div>
                  <h4 className="text-xs font-bold text-[#180200]">Show Organisation Logo in Print Header</h4>
                  <p className="text-[11px] text-[#863221]">
                    Renders the emblem on top of receipts, certificates, and label reports.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    name="showLogo"
                    checked={settings.printHeaders.showLogo}
                    onChange={handlePrintHeadersChange}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#510601]"></div>
                </label>
              </div>

              {/* Organisation Name for Print */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Organisation Title on Documents
                </label>
                <input
                  type="text"
                  name="organisationName"
                  value={settings.printHeaders.organisationName}
                  onChange={handlePrintHeadersChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-sm font-bold text-[#180200] focus:outline-none"
                />
              </div>

              {/* Header Subtitle Line 1 */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Header Subtitle Line 1
                </label>
                <input
                  type="text"
                  name="headerLine1"
                  value={settings.printHeaders.headerLine1}
                  onChange={handlePrintHeadersChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] rounded-xl text-xs sm:text-sm text-[#180200] focus:outline-none"
                />
              </div>

              {/* Header Subtitle Line 2 */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Header Subtitle Line 2 / Location
                </label>
                <input
                  type="text"
                  name="headerLine2"
                  value={settings.printHeaders.headerLine2}
                  onChange={handlePrintHeadersChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] rounded-xl text-xs sm:text-sm text-[#180200] focus:outline-none"
                />
              </div>

              {/* Print Address */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Detailed Printable Address
                </label>
                <input
                  type="text"
                  name="address"
                  value={settings.printHeaders.address}
                  onChange={handlePrintHeadersChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] rounded-xl text-xs sm:text-sm text-[#180200] focus:outline-none"
                />
              </div>

              {/* Contact Triplets (Phone, Email, Website) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                    Print Phone
                  </label>
                  <input
                    type="text"
                    name="phone"
                    value={settings.printHeaders.phone}
                    onChange={handlePrintHeadersChange}
                    className="w-full px-3 py-2 bg-white border border-[#E8DFD8] focus:border-[#510601] rounded-xl text-xs text-[#180200] focus:outline-none font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                    Print Email
                  </label>
                  <input
                    type="text"
                    name="email"
                    value={settings.printHeaders.email}
                    onChange={handlePrintHeadersChange}
                    className="w-full px-3 py-2 bg-white border border-[#E8DFD8] focus:border-[#510601] rounded-xl text-xs text-[#180200] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                    Print Website
                  </label>
                  <input
                    type="text"
                    name="website"
                    value={settings.printHeaders.website}
                    onChange={handlePrintHeadersChange}
                    className="w-full px-3 py-2 bg-white border border-[#E8DFD8] focus:border-[#510601] rounded-xl text-xs text-[#180200] focus:outline-none"
                  />
                </div>
              </div>

              {/* Footer Text */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Receipt / Report Footer Disclaimer Note
                </label>
                <textarea
                  name="footerText"
                  rows={2}
                  value={settings.printHeaders.footerText}
                  onChange={handlePrintHeadersChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-xs text-[#180200] focus:outline-none resize-none"
                />
              </div>
            </div>
          </div>

          {/* Live Printable Preview Area (5 cols on desktop) */}
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-[#510601]" />
                <h3 className="text-xs font-bold text-[#180200] uppercase tracking-wider">
                  Live Print Preview
                </h3>
              </div>
              <span className="text-[11px] text-[#863221] font-medium">
                Simulated Output Preview
              </span>
            </div>

            {/* Simulated Paper Document Card */}
            <div className="bg-white rounded-2xl border-2 border-[#E8DFD8] p-6 shadow-xl relative overflow-hidden">
              {/* Paper Top Accent Line */}
              <div className="h-1.5 bg-gradient-to-r from-[#510601] via-[#8C1801] to-[#F4AA26] -mx-6 -mt-6 mb-5" />

              {/* Document Header */}
              <div className="text-center pb-4 border-b border-dashed border-[#E8DFD8] space-y-2">
                {settings.printHeaders.showLogo && settings.profile.logo && (
                  <div className="flex justify-center mb-2">
                    <img
                      src={settings.profile.logo}
                      alt="Print Header Logo"
                      className="h-12 max-w-[140px] object-contain"
                    />
                  </div>
                )}

                <h2 className="text-base sm:text-lg font-extrabold text-[#180200] tracking-tight leading-tight uppercase font-serif">
                  {settings.printHeaders.organisationName || settings.profile.organisationName || 'Shri Akhila Havyaka Mahasabha (R)'}
                </h2>

                {settings.printHeaders.headerLine1 && (
                  <p className="text-xs font-semibold text-[#510601]">
                    {settings.printHeaders.headerLine1}
                  </p>
                )}

                {settings.printHeaders.headerLine2 && (
                  <p className="text-[11px] text-[#863221]">
                    {settings.printHeaders.headerLine2}
                  </p>
                )}

                {settings.printHeaders.address && (
                  <p className="text-[11px] text-[#180200]/80">
                    {settings.printHeaders.address}
                  </p>
                )}

                {/* Print Contact Row */}
                {(settings.printHeaders.phone || settings.printHeaders.email || settings.printHeaders.website) && (
                  <div className="pt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[10px] text-[#863221] font-mono">
                    {settings.printHeaders.phone && <span>Ph: {settings.printHeaders.phone}</span>}
                    {settings.printHeaders.phone && settings.printHeaders.email && <span>•</span>}
                    {settings.printHeaders.email && <span>Email: {settings.printHeaders.email}</span>}
                    {settings.printHeaders.email && settings.printHeaders.website && <span>•</span>}
                    {settings.printHeaders.website && <span>Web: {settings.printHeaders.website}</span>}
                  </div>
                )}
              </div>

              {/* Sample Document Body Placeholder */}
              <div className="my-5 p-4 rounded-xl bg-[#FAF7F2]/60 border border-dashed border-[#E8DFD8] text-center space-y-2">
                <div className="inline-block px-3 py-1 bg-white border border-[#E8DFD8] rounded-md text-[10px] font-bold text-[#510601] tracking-wider uppercase">
                  Sample Official Document Body Area
                </div>
                <div className="space-y-1.5 max-w-xs mx-auto py-2">
                  <div className="h-2 bg-stone-200/80 rounded w-full" />
                  <div className="h-2 bg-stone-200/60 rounded w-5/6 mx-auto" />
                  <div className="h-2 bg-stone-200/40 rounded w-4/6 mx-auto" />
                </div>
                <p className="text-[10px] text-[#863221]/70 italic">
                  (Member receipts, label sheets, and official letters render content here)
                </p>
              </div>

              {/* Document Footer */}
              {settings.printHeaders.footerText && (
                <div className="pt-3 border-t border-dashed border-[#E8DFD8] text-center">
                  <p className="text-[10px] text-[#863221]/90 italic leading-relaxed">
                    {settings.printHeaders.footerText}
                  </p>
                </div>
              )}
            </div>


          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 3: NOTIFICATION SETTINGS                                 */}
      {/* ============================================================ */}
      {activeTab === 'notifications' && (
        <div className="space-y-6 animate-in fade-in-50 duration-200">
          {/* General Notifications */}
          <div className="bg-white rounded-2xl border border-[#E8DFD8] p-5 sm:p-6 shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-[#E8DFD8]">
              <div className="p-1.5 rounded-lg bg-[#510601]/10 text-[#510601]">
                <Bell className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-[#180200] uppercase tracking-wider">
                1. General System Notifications
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Master System Notifications */}
              <div className="flex items-start justify-between p-4 rounded-xl bg-[#FAF7F2] border border-[#E8DFD8]">
                <div className="pr-4">
                  <h4 className="text-xs font-bold text-[#180200]">Enable System Notifications</h4>
                  <p className="text-[11px] text-[#863221] mt-0.5">
                    Master toggle for background notification queues and administrative alerts.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                  <input
                    type="checkbox"
                    checked={settings.notifications.enableNotifications}
                    onChange={() => handleNotificationToggle('enableNotifications')}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#510601]"></div>
                </label>
              </div>

              {/* Show In-App Notifications */}
              <div className="flex items-start justify-between p-4 rounded-xl bg-[#FAF7F2] border border-[#E8DFD8]">
                <div className="pr-4">
                  <h4 className="text-xs font-bold text-[#180200]">Show In-App Notifications</h4>
                  <p className="text-[11px] text-[#863221] mt-0.5">
                    Display badge counters, floating toast messages, and header bell dropdown alerts.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                  <input
                    type="checkbox"
                    checked={settings.notifications.showInAppNotifications}
                    onChange={() => handleNotificationToggle('showInAppNotifications')}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#510601]"></div>
                </label>
              </div>
            </div>
          </div>

          {/* Membership Notifications */}
          <div className="bg-white rounded-2xl border border-[#E8DFD8] p-5 sm:p-6 shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E8DFD8]">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-[#3D705C]/10 text-[#3D705C]">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-bold text-[#180200] uppercase tracking-wider">
                  2. Membership Lifecycle Notifications
                </h2>
              </div>
              <span className="text-[11px] text-[#863221] font-semibold">
                Member Events
              </span>
            </div>

            <div className="space-y-3">
              {[
                {
                  key: 'newMembershipRegistration',
                  title: 'New Membership Registration',
                  desc: 'Notify administration when an applicant submits an online membership registration form.'
                },
                {
                  key: 'membershipApproval',
                  title: 'Membership Approval & Verification',
                  desc: 'Alert officer when an unapproved member is accepted, rejected, or flagged for review.'
                },
                {
                  key: 'membershipActivation',
                  title: 'Membership Activation & ID Issuance',
                  desc: 'Notify member and office when membership credentials and physical cards are generated.'
                },
                {
                  key: 'membershipTypeChange',
                  title: 'Membership Type Change / Upgrade',
                  desc: 'Send notification when a member tier upgrades (e.g. from Poshaka to Mahaposhaka).'
                },
                {
                  key: 'membershipExpiry',
                  title: 'Membership Expiry & Renewal Reminders',
                  desc: 'Trigger automatic advance reminders for annual and recurring subscription renewals.'
                }
              ].map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between p-3.5 rounded-xl hover:bg-[#FAF7F2] border border-[#E8DFD8]/70 transition-colors"
                >
                  <div className="pr-4">
                    <h4 className="text-xs font-bold text-[#180200]">{item.title}</h4>
                    <p className="text-[11px] text-[#863221] mt-0.5">{item.desc}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={Boolean(settings.notifications[item.key])}
                      onChange={() => handleNotificationToggle(item.key)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#3D705C]"></div>
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Receipt Notifications */}
          <div className="bg-white rounded-2xl border border-[#E8DFD8] p-5 sm:p-6 shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E8DFD8]">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-[#510601]/10 text-[#510601]">
                  <FileText className="w-4 h-4" />
                </div>
                <h2 className="text-sm font-bold text-[#180200] uppercase tracking-wider">
                  3. Receipt & Accounting Notifications
                </h2>
              </div>
              <span className="text-[11px] text-[#863221] font-semibold">
                Financial Transactions
              </span>
            </div>

            <div className="space-y-3">
              {[
                {
                  key: 'receiptCreated',
                  title: 'Receipt Created Notification',
                  desc: 'Notify counter staff and applicant upon generating a new official donation or membership receipt.'
                },
                {
                  key: 'receiptMapped',
                  title: 'Receipt Mapped to Member',
                  desc: 'Alert administrative desk when an unapproved member receipt is successfully linked.'
                },
                {
                  key: 'receiptPaymentUpdate',
                  title: 'Receipt Payment & Bank Clearance Update',
                  desc: 'Notify accounting team when cheque, UPI, or NEFT payment is verified and cleared.'
                }
              ].map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between p-3.5 rounded-xl hover:bg-[#FAF7F2] border border-[#E8DFD8]/70 transition-colors"
                >
                  <div className="pr-4">
                    <h4 className="text-xs font-bold text-[#180200]">{item.title}</h4>
                    <p className="text-[11px] text-[#863221] mt-0.5">{item.desc}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={Boolean(settings.notifications[item.key])}
                      onChange={() => handleNotificationToggle(item.key)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#510601]"></div>
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 4: CONTACT SETTINGS                                      */}
      {/* ============================================================ */}
      {activeTab === 'contact' && (
        <div className="space-y-6 animate-in fade-in-50 duration-200">
          {/* Public Display Toggle */}
          <div className="bg-white rounded-2xl border border-[#E8DFD8] p-4 sm:p-5 shadow-sm flex items-center justify-between gap-4">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-[#180200]">
                Display Contact Information
              </h3>
              <p className="text-[11px] sm:text-xs text-[#863221] mt-0.5">
                Enable this to display designated contact and helpdesk details on member portals and official receipts.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                name="displayContactInfo"
                checked={settings.contact.displayContactInfo}
                onChange={handleContactChange}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#510601]"></div>
            </label>
          </div>

          {/* Primary Administrative Contact */}
          <div className="bg-white rounded-2xl border border-[#E8DFD8] p-5 sm:p-6 shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-[#E8DFD8]">
              <div className="p-1.5 rounded-lg bg-[#510601]/10 text-[#510601]">
                <PhoneCall className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-[#180200] uppercase tracking-wider">
                1. Primary Administrative Contact
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Primary Contact Name * */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Primary Contact Name <span className="text-[#ED4636]">*</span>
                </label>
                <input
                  type="text"
                  name="primaryContactName"
                  value={settings.contact.primaryContactName}
                  onChange={handleContactChange}
                  className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-sm font-semibold text-[#180200] focus:outline-none transition-colors ${errors.contact_primaryContactName
                    ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                    : 'border-[#E8DFD8] focus:border-[#510601]'
                    }`}
                />
                {errors.contact_primaryContactName && (
                  <p className="text-xs text-[#ED4636] mt-1 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {errors.contact_primaryContactName}
                  </p>
                )}
              </div>

              {/* Designation */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Designation / Role
                </label>
                <input
                  type="text"
                  name="designation"
                  value={settings.contact.designation}
                  onChange={handleContactChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] rounded-xl text-sm text-[#180200] focus:outline-none"
                />
              </div>

              {/* Contact Number * */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Contact Number <span className="text-[#ED4636]">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#863221]/70">
                    +91
                  </span>
                  <input
                    type="tel"
                    name="contactNumber"
                    value={settings.contact.contactNumber}
                    onChange={handleContactChange}
                    maxLength={10}
                    className={`w-full pl-11 pr-3.5 py-2.5 bg-white border rounded-xl text-sm font-mono text-[#180200] focus:outline-none transition-colors ${errors.contact_contactNumber
                      ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                      : 'border-[#E8DFD8] focus:border-[#510601]'
                      }`}
                  />
                </div>
                {errors.contact_contactNumber && (
                  <p className="text-xs text-[#ED4636] mt-1 font-medium">{errors.contact_contactNumber}</p>
                )}
              </div>

              {/* Alternate Contact Number */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Alternate Contact Number
                </label>
                <input
                  type="text"
                  name="alternateContactNumber"
                  value={settings.contact.alternateContactNumber}
                  onChange={handleContactChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] rounded-xl text-sm font-mono text-[#180200] focus:outline-none"
                />
              </div>

              {/* Email * */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Email Address <span className="text-[#ED4636]">*</span>
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#863221]/50 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    name="email"
                    value={settings.contact.email}
                    onChange={handleContactChange}
                    className={`w-full pl-9 pr-3.5 py-2.5 bg-white border rounded-xl text-sm text-[#180200] focus:outline-none transition-colors ${errors.contact_email
                      ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30 bg-red-50/20'
                      : 'border-[#E8DFD8] focus:border-[#510601]'
                      }`}
                  />
                </div>
                {errors.contact_email && (
                  <p className="text-xs text-[#ED4636] mt-1 font-medium">{errors.contact_email}</p>
                )}
              </div>

              {/* Alternate Email */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Alternate Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#863221]/50 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    name="alternateEmail"
                    value={settings.contact.alternateEmail}
                    onChange={handleContactChange}
                    className={`w-full pl-9 pr-3.5 py-2.5 bg-white border rounded-xl text-sm text-[#180200] focus:outline-none ${errors.contact_alternateEmail
                      ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30'
                      : 'border-[#E8DFD8] focus:border-[#510601]'
                      }`}
                  />
                </div>
                {errors.contact_alternateEmail && (
                  <p className="text-xs text-[#ED4636] mt-1 font-medium">{errors.contact_alternateEmail}</p>
                )}
              </div>
            </div>
          </div>

          {/* Helpdesk & Support Contacts */}
          <div className="bg-white rounded-2xl border border-[#E8DFD8] p-5 sm:p-6 shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-[#E8DFD8]">
              <div className="p-1.5 rounded-lg bg-[#510601]/10 text-[#510601]">
                <Smartphone className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-[#180200] uppercase tracking-wider">
                2. Member Helpdesk & Support Contacts
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Support Contact Number */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Support Helpline Number
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-[#863221]/50 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    name="supportContactNumber"
                    value={settings.contact.supportContactNumber}
                    onChange={handleContactChange}
                    className="w-full pl-9 pr-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] rounded-xl text-sm font-mono text-[#180200] focus:outline-none"
                  />
                </div>
              </div>

              {/* Support Email */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Support Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#863221]/50 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    name="supportEmail"
                    value={settings.contact.supportEmail}
                    onChange={handleContactChange}
                    className={`w-full pl-9 pr-3.5 py-2.5 bg-white border rounded-xl text-sm text-[#180200] focus:outline-none ${errors.contact_supportEmail
                      ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30'
                      : 'border-[#E8DFD8] focus:border-[#510601]'
                      }`}
                  />
                </div>
                {errors.contact_supportEmail && (
                  <p className="text-xs text-[#ED4636] mt-1 font-medium">{errors.contact_supportEmail}</p>
                )}
              </div>
            </div>
          </div>

          {/* Office Address & Operating Hours */}
          <div className="bg-white rounded-2xl border border-[#E8DFD8] p-5 sm:p-6 shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-[#E8DFD8]">
              <div className="p-1.5 rounded-lg bg-[#510601]/10 text-[#510601]">
                <Calendar className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-[#180200] uppercase tracking-wider">
                3. Office Address & Operating Hours
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Office Address */}
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Physical Office Address
                </label>
                <textarea
                  name="officeAddress"
                  rows={2}
                  value={settings.contact.officeAddress}
                  onChange={handleContactChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-xl text-xs sm:text-sm text-[#180200] focus:outline-none resize-none"
                />
              </div>

              {/* Working Days */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Working Days
                </label>
                <input
                  type="text"
                  name="workingDays"
                  value={settings.contact.workingDays}
                  onChange={handleContactChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] rounded-xl text-xs sm:text-sm text-[#180200] focus:outline-none"
                />
              </div>

              {/* Working Hours */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Working Hours
                </label>
                <input
                  type="text"
                  name="workingHours"
                  value={settings.contact.workingHours}
                  onChange={handleContactChange}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] focus:border-[#510601] rounded-xl text-xs sm:text-sm text-[#180200] focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* GLOBAL ACTIONS FOOTER                                */}
      {/* ---------------------------------------------------- */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] p-4 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs text-[#863221]">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>All four sections share this central organisation settings store.</span>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleReset}
            className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-[#E8DFD8] hover:border-[#863221] bg-white text-[#863221] hover:text-[#510601] text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Reset Form</span>
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={!hasPermission('system.write')}
            title={!hasPermission('system.write') ? 'You need the system.write permission' : 'Save Changes'}
            className="flex-1 sm:flex-none px-6 py-2.5 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs sm:text-sm font-bold rounded-xl shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>Save Changes</span>
          </button>
        </div>
      </div>
    </div>
    </PermissionGate>
  );
}
