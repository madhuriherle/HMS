import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import PageActions, { PageActionsSlot } from '../components/PageActions';
import {
  BarChart3,
  Users,
  Receipt,
  BookOpen,
  History,
  Download,
  Printer,
  Search,
  Filter,
  RefreshCw,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  CreditCard,
  FileSpreadsheet,
  FileText,
  AlertCircle,
  CheckCircle2,
  Clock,
  MapPin,
  Bookmark,
  Trash2,
  Play,
  X
} from 'lucide-react';
import api from '../api';
import useAuth from '../hooks/useAuth';
import Modal from '../components/Modal';
import ModalFooter from '../components/ModalFooter';
import DateInput from '../components/DateInput';
import { formatDate } from '../utils/dateUtils';
import { notify } from '../utils/notify';
import { loadLocations, loadMembershipTypes } from '../utils/serverData';

const TABS = [
  { key: 'summary', label: 'Summary', icon: BarChart3 },
  { key: 'members', label: 'Members', icon: Users },
  { key: 'receipts', label: 'Receipts & Finance', icon: Receipt },
  { key: 'magazines', label: 'Magazine & Logistics', icon: BookOpen },
  { key: 'saved', label: 'Saved & Audit Logs', icon: History },
];

const MEMBER_COLUMNS = [
  { key: 'member_code', labelEn: 'Membership Number', labelKn: 'ಸದಸ್ಯ ಸಂಖ್ಯೆ' },
  { key: 'first_name_en', labelEn: 'First Name', labelKn: 'ಮೊದಲ ಹೆಸರು' },
  { key: 'last_name_en', labelEn: 'Last Name', labelKn: 'ಕೊನೆಯ ಹೆಸರು' },
  { key: 'full_name_kn', labelEn: 'Full Name (Kannada)', labelKn: 'ಹೆಸರು (ಕನ್ನಡ)' },
  { key: 'gender', labelEn: 'Gender', labelKn: 'ಲಿಂಗ' },
  { key: 'mobile', labelEn: 'Mobile', labelKn: 'ಮೊಬೈಲ್ ಸಂಖ್ಯೆ' },
  { key: 'email', labelEn: 'Email', labelKn: 'ಇಮೇಲ್' },
  { key: 'approval_status', labelEn: 'Approval Status', labelKn: 'ಅನುಮೋದನೆ ಸ್ಥಿತಿ' },
  { key: 'member_status', labelEn: 'Member Status', labelKn: 'ಸದಸ್ಯ ಸ್ಥಿತಿ' },
  { key: 'registration_source', labelEn: 'Registration Source', labelKn: 'ನೋಂದಣಿ ಮೂಲ' },
];

export default function ReportsManagement() {
  const { hasPermission } = useAuth();
  const canExport = hasPermission('reports.read');
  const canSave = hasPermission('reports.write');

  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Tab routing
  const activeTab = useMemo(() => {
    const p = location.pathname.toLowerCase();
    if (p.includes('/members')) return 'members';
    if (p.includes('/receipts')) return 'receipts';
    if (p.includes('/magazines')) return 'magazines';
    if (p.includes('/saved')) return 'saved';
    if (p.includes('/summary')) return 'summary';
    return searchParams.get('tab') || 'summary';
  }, [location.pathname, searchParams]);

  const setTab = (t) => {
    navigate(`/dashboard/reports/${t}`);
  };

  // Shared Masters
  const [districts, setDistricts] = useState([]);
  const [taluks, setTaluks] = useState([]);
  const [membershipTypes, setMembershipTypes] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [locs, mtypes] = await Promise.all([
          loadLocations(),
          loadMembershipTypes()
        ]);
        setDistricts(locs.districts || []);
        setTaluks(locs.taluks || []);
        setMembershipTypes(mtypes || []);
      } catch (err) {
        console.error('Failed to load filter options.', err);
      }
    })();
  }, []);

  // Download export helper
  const handleDownload = async (endpoint, params, defaultName) => {
    try {
      const res = await api.get(endpoint, { params, responseType: 'blob' });
      const blob = new Blob([res.data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      let filename = defaultName;
      const disposition = res.headers?.['content-disposition'];
      if (disposition) {
        const match = disposition.match(/filename=["']?([^"';]+)["']?/);
        if (match && match[1]) filename = match[1];
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify('Report export downloaded successfully.', 'success');
    } catch (err) {
      console.error('Export download failed:', err);
      notify('Failed to export report.', 'error');
    }
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#180200] tracking-tight">
            {TABS.find((t) => t.key === activeTab)?.label || 'Reports'}
          </h1>
        </div>
        <PageActionsSlot />
      </div>

      {/* Tab Panels */}
      {activeTab === 'summary' && (
        <SummaryTab onNavigate={setTab} onDownload={handleDownload} />
      )}

      {activeTab === 'members' && (
        <MembersReportTab
          districts={districts}
          taluks={taluks}
          membershipTypes={membershipTypes}
          onDownload={handleDownload}
          canSave={canSave}
        />
      )}

      {activeTab === 'receipts' && (
        <ReceiptsReportTab
          membershipTypes={membershipTypes}
          onDownload={handleDownload}
          canSave={canSave}
        />
      )}

      {activeTab === 'magazines' && (
        <MagazinesReportTab
          districts={districts}
          taluks={taluks}
          onDownload={handleDownload}
        />
      )}

      {activeTab === 'saved' && (
        <SavedReportsAndLogsTab
          onDownload={handleDownload}
          canSave={canSave}
        />
      )}
    </div>
  );
}

// ==============================================================
// 1. SUMMARY TAB
// ==============================================================
function SummaryTab({ onNavigate, onDownload }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/reports/summary');
      setSummary(res.data);
    } catch (err) {
      console.error('Failed to load report summary.', err);
      notify('Failed to load report summary.', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-16 text-stone-400">
        <RefreshCw className="w-8 h-8 animate-spin mb-3 text-[#8C1801]" />
        <p className="text-sm font-medium">Gathering analytics snapshot...</p>
      </div>
    );
  }

  const mem = summary?.members || {};
  const rec = summary?.receipts || {};
  const mag = summary?.magazines || {};
  const mtypes = summary?.memberships?.by_type || [];

  return (
    <div className="space-y-6">
      {/* Quick Action Banner */}
      <div className="bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-[#180200]">Executive Overview</h2>
          <span className="text-xs text-stone-600">
            Real-time counts across membership, financial receipts, and magazine logistics.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadSummary}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#510601] bg-white border border-[#E8DFD8] rounded-lg hover:bg-stone-50 cursor-pointer shadow-sm transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => onDownload('/reports/members', { export: 'csv' }, `members-summary-${new Date().toISOString().slice(0, 10)}.csv`)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#510601] rounded-lg hover:bg-[#3D0400] cursor-pointer shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download All Members CSV</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Members */}
        <div className="bg-white border border-[#E8DFD8] rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between text-stone-500">
            <span className="text-xs font-bold uppercase tracking-wider text-stone-600">Total Members</span>
            <Users className="w-5 h-5 text-[#8C1801]" />
          </div>
          <div>
            <div className="text-3xl font-extrabold text-[#180200]">
              {(mem.total || 0).toLocaleString()}
            </div>
            <div className="mt-2 text-xs text-stone-500 space-y-1">
              <div className="flex justify-between">
                <span>Approved:</span>
                <strong className="text-emerald-700">{mem.by_approval_status?.APPROVED || 0}</strong>
              </div>
              <div className="flex justify-between">
                <span>Pending Approval:</span>
                <strong className="text-amber-700">{mem.by_approval_status?.UNAPPROVED || 0}</strong>
              </div>
              <div className="flex justify-between">
                <span>Rejected:</span>
                <strong className="text-stone-600">{mem.by_approval_status?.REJECTED || 0}</strong>
              </div>
            </div>
          </div>
          <button
            onClick={() => onNavigate('members')}
            className="w-full text-center text-xs font-semibold text-[#8C1801] hover:text-[#510601] pt-2 border-t border-stone-100 cursor-pointer block"
          >
            View Members Report &rarr;
          </button>
        </div>

        {/* Collections & Financials */}
        <div className="bg-white border border-[#E8DFD8] rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between text-stone-500">
            <span className="text-xs font-bold uppercase tracking-wider text-stone-600">Collections</span>
            <CreditCard className="w-5 h-5 text-emerald-700" />
          </div>
          <div>
            <div className="text-3xl font-extrabold text-[#180200]">
              ₹{(rec.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div className="mt-2 text-xs text-stone-500 space-y-1">
              <div className="flex justify-between">
                <span>Total Receipts:</span>
                <strong className="text-stone-800">{rec.count || 0}</strong>
              </div>
              <div className="flex justify-between">
                <span>Allocated:</span>
                <strong className="text-emerald-700">₹{(rec.allocated_amount || 0).toLocaleString('en-IN')}</strong>
              </div>
              <div className="flex justify-between">
                <span>Unallocated Balance:</span>
                <strong className="text-stone-600">₹{((rec.total_amount || 0) - (rec.allocated_amount || 0)).toLocaleString('en-IN')}</strong>
              </div>
            </div>
          </div>
          <button
            onClick={() => onNavigate('receipts')}
            className="w-full text-center text-xs font-semibold text-[#8C1801] hover:text-[#510601] pt-2 border-t border-stone-100 cursor-pointer block"
          >
            View Financials Report &rarr;
          </button>
        </div>

        {/* Magazine Subscriptions */}
        <div className="bg-white border border-[#E8DFD8] rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between text-stone-500">
            <span className="text-xs font-bold uppercase tracking-wider text-stone-600">Magazine Circulation</span>
            <BookOpen className="w-5 h-5 text-[#510601]" />
          </div>
          <div>
            <div className="text-3xl font-extrabold text-[#180200]">
              {(mag.subscriptions_by_status?.ACTIVE || 0).toLocaleString()}
            </div>
            <div className="mt-2 text-xs text-stone-500 space-y-1">
              <div className="flex justify-between">
                <span>Active Delivery:</span>
                <strong className="text-emerald-700">{mag.subscriptions_by_status?.ACTIVE || 0}</strong>
              </div>
              <div className="flex justify-between">
                <span>Temporary Pauses:</span>
                <strong className="text-amber-700">{mag.active_pauses || 0}</strong>
              </div>
              <div className="flex justify-between">
                <span>Returns / Undelivered:</span>
                <strong className="text-rose-700">{mag.returns_total || 0}</strong>
              </div>
            </div>
          </div>
          <button
            onClick={() => onNavigate('magazines')}
            className="w-full text-center text-xs font-semibold text-[#8C1801] hover:text-[#510601] pt-2 border-t border-stone-100 cursor-pointer block"
          >
            View Circulation Report &rarr;
          </button>
        </div>

        {/* Gender Demographics */}
        <div className="bg-white border border-[#E8DFD8] rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between text-stone-500">
            <span className="text-xs font-bold uppercase tracking-wider text-stone-600">Demographics</span>
            <TrendingUp className="w-5 h-5 text-blue-700" />
          </div>
          <div>
            <div className="text-3xl font-extrabold text-[#180200]">
              {(mem.by_gender?.MALE || mem.by_gender?.Male || 0) + (mem.by_gender?.FEMALE || mem.by_gender?.Female || 0)}
            </div>
            <div className="mt-2 text-xs text-stone-500 space-y-1">
              <div className="flex justify-between">
                <span>Male Members:</span>
                <strong>{mem.by_gender?.MALE || mem.by_gender?.Male || 0}</strong>
              </div>
              <div className="flex justify-between">
                <span>Female Members:</span>
                <strong>{mem.by_gender?.FEMALE || mem.by_gender?.Female || 0}</strong>
              </div>
              <div className="flex justify-between">
                <span>Unspecified:</span>
                <strong>{mem.by_gender?.UNSPECIFIED || 0}</strong>
              </div>
            </div>
          </div>
          <button
            onClick={() => onNavigate('members')}
            className="w-full text-center text-xs font-semibold text-[#8C1801] hover:text-[#510601] pt-2 border-t border-stone-100 cursor-pointer block"
          >
            View Demographic Breakdown &rarr;
          </button>
        </div>
      </div>

      {/* Membership Type Breakdown Table */}
      <div className="bg-white border border-[#E8DFD8] rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-[#E8DFD8] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-[#180200]">Membership by Category</h2>
            <span className="text-xs text-stone-500">Breakdown of members across configured membership types</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-stone-600 font-bold">
                <th className="py-3 px-4">Membership Type</th>
                <th className="py-3 px-4">Kannada Name</th>
                <th className="py-3 px-4 text-right">Member Count</th>
                <th className="py-3 px-4 text-right">Share of Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8]">
              {mtypes.length === 0 ? (
                <tr>
                  <td colSpan="4" className="py-8 text-center text-stone-400">
                    No membership type data recorded.
                  </td>
                </tr>
              ) : (
                mtypes.map((t, idx) => {
                  const pct = mem.total ? ((t.member_count / mem.total) * 100).toFixed(1) : '0.0';
                  return (
                    <tr key={idx} className="hover:bg-stone-50">
                      <td className="py-3 px-4 font-semibold text-stone-800">{t.membership_type}</td>
                      <td className="py-3 px-4 text-stone-600">{t.type_name_kn || '—'}</td>
                      <td className="py-3 px-4 text-right font-bold text-stone-800">{t.member_count.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-stone-600">{pct}%</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==============================================================
// 2. MEMBERS REPORT TAB
// ==============================================================
function MembersReportTab({ districts, taluks, membershipTypes, onDownload, canSave }) {
  const [subView, setSubView] = useState('list'); // 'list' | 'geography' | 'gender' | 'unapproved'
  const [districtId, setDistrictId] = useState('');
  const [talukId, setTalukId] = useState('');
  const [gender, setGender] = useState('');
  const [approvalStatus, setApprovalStatus] = useState('');
  const [membershipTypeId, setMembershipTypeId] = useState('');
  const [language, setLanguage] = useState('en');
  const [selectedColumns, setSelectedColumns] = useState(MEMBER_COLUMNS.map((c) => c.key));
  const [columnModalOpen, setColumnModalOpen] = useState(false);

  // Table Data State
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Filtered taluks by selected district
  const availableTaluks = useMemo(() => {
    if (!districtId) return taluks;
    return taluks.filter((t) => String(t.district_id) === String(districtId));
  }, [taluks, districtId]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let endpoint = '/reports/members';
      const params = {};
      if (districtId) params.district_id = districtId;
      if (talukId) params.taluk_id = talukId;
      if (gender) params.gender = gender;
      if (approvalStatus) params.approval_status = approvalStatus;
      if (membershipTypeId) params.membership_type_id = membershipTypeId;

      if (subView === 'geography') endpoint = '/reports/members/by-geography';
      else if (subView === 'gender') endpoint = '/reports/members/by-gender';
      else if (subView === 'unapproved') endpoint = '/reports/unapproved-members';
      else {
        params.language = language;
        params.columns = selectedColumns.join(',');
      }

      const res = await api.get(endpoint, { params });
      setRows(Array.isArray(res.data) ? res.data : (res.data?.data || []));
      setPage(1);
    } catch (err) {
      console.error('Failed to load member report rows.', err);
      notify('Failed to load member report data.', 'error');
    } finally {
      setLoading(false);
    }
  }, [subView, districtId, talukId, gender, approvalStatus, membershipTypeId, language, selectedColumns]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Export handlers
  const handleExport = (format) => {
    let endpoint = '/reports/members';
    const params = { export: format };
    if (districtId) params.district_id = districtId;
    if (talukId) params.taluk_id = talukId;
    if (gender) params.gender = gender;
    if (approvalStatus) params.approval_status = approvalStatus;
    if (membershipTypeId) params.membership_type_id = membershipTypeId;

    if (subView === 'geography') endpoint = '/reports/members/by-geography';
    else if (subView === 'gender') endpoint = '/reports/members/by-gender';
    else if (subView === 'unapproved') endpoint = '/reports/unapproved-members';
    else {
      params.language = language;
      params.columns = selectedColumns.join(',');
    }

    const filename = `members-${subView}-${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'xlsx'}`;
    onDownload(endpoint, params, filename);
  };

  // Pagination slice
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page]);

  const totalPages = Math.ceil(rows.length / pageSize) || 1;

  return (
    <div className="space-y-4">
      {/* Sub-view Switcher & Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex rounded-lg border border-[#E8DFD8] bg-white p-1 shadow-sm">
          <button
            onClick={() => setSubView('list')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              subView === 'list' ? 'bg-[#510601] text-white' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            All Members List
          </button>
          <button
            onClick={() => setSubView('geography')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              subView === 'geography' ? 'bg-[#510601] text-white' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            By Geography
          </button>
          <button
            onClick={() => setSubView('gender')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              subView === 'gender' ? 'bg-[#510601] text-white' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            By Gender
          </button>
          <button
            onClick={() => setSubView('unapproved')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              subView === 'unapproved' ? 'bg-[#510601] text-white' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Unapproved Aging
          </button>
        </div>

        {/* Export Buttons */}
        <PageActions>
          {subView === 'list' && (
            <button
              onClick={() => setColumnModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-700 bg-white border border-[#E8DFD8] rounded-lg hover:bg-stone-50 cursor-pointer shadow-sm transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Columns ({selectedColumns.length})</span>
            </button>
          )}

          <button
            onClick={() => handleExport('csv')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#510601] bg-white border border-[#E8DFD8] rounded-lg hover:bg-[#FAF7F2] cursor-pointer shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => handleExport('excel')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#510601] rounded-lg hover:bg-[#3D0400] cursor-pointer shadow-sm transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export Excel</span>
          </button>
        </PageActions>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white border border-[#E8DFD8] rounded-xl p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div>
          <label className="block text-xs font-bold text-stone-600 uppercase mb-1">District</label>
          <select
            value={districtId}
            onChange={(e) => {
              setDistrictId(e.target.value);
              setTalukId('');
            }}
            className="w-full px-2.5 py-1.5 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
          >
            <option value="">All Districts</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>{d.name_en || d.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-stone-600 uppercase mb-1">Taluk</label>
          <select
            value={talukId}
            onChange={(e) => setTalukId(e.target.value)}
            disabled={!districtId}
            className="w-full px-2.5 py-1.5 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601] disabled:opacity-50"
          >
            <option value="">All Taluks</option>
            {availableTaluks.map((t) => (
              <option key={t.id} value={t.id}>{t.name_en || t.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-stone-600 uppercase mb-1">Gender</label>
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
          >
            <option value="">All Genders</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-stone-600 uppercase mb-1">Approval Status</label>
          <select
            value={approvalStatus}
            onChange={(e) => setApprovalStatus(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
          >
            <option value="">All Statuses</option>
            <option value="APPROVED">Approved</option>
            <option value="UNAPPROVED">Unapproved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-stone-600 uppercase mb-1">Membership Type</label>
          <select
            value={membershipTypeId}
            onChange={(e) => setMembershipTypeId(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
          >
            <option value="">All Types</option>
            {membershipTypes.map((mt) => (
              <option key={mt.id} value={mt.id}>{mt.name_en || mt.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-stone-600 uppercase mb-1">Header Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
          >
            <option value="en">English (English Headers)</option>
            <option value="kn">Kannada (ಕನ್ನಡ ಹೆಡರ್ಸ್)</option>
          </select>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-white border border-[#E8DFD8] rounded-xl shadow-sm overflow-hidden">
        <div className="p-3 bg-[#FAF7F2] border-b border-[#E8DFD8] flex items-center justify-between text-xs font-semibold text-stone-600">
          <span>Found {rows.length.toLocaleString()} matching records</span>
          {loading && <span className="inline-flex items-center gap-1.5 text-[#510601]"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading data...</span>}
        </div>

        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          {subView === 'list' && (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-[#FAF7F2] border-b border-[#E8DFD8] text-stone-700 font-bold">
                <tr>
                  {selectedColumns.map((colKey) => {
                    const col = MEMBER_COLUMNS.find((c) => c.key === colKey);
                    return (
                      <th key={colKey} className="py-2.5 px-3 whitespace-nowrap">
                        {language === 'kn' ? (col?.labelKn || colKey) : (col?.labelEn || colKey)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan={selectedColumns.length} className="py-12 text-center text-stone-400">
                      No records match the selected filters.
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((r, i) => (
                    <tr key={i} className="hover:bg-stone-50">
                      {selectedColumns.map((colKey) => (
                        <td key={colKey} className="py-2.5 px-3 text-stone-700 whitespace-nowrap">
                          {r[colKey] !== null && r[colKey] !== undefined ? String(r[colKey]) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {subView === 'geography' && (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-[#FAF7F2] border-b border-[#E8DFD8] text-stone-700 font-bold">
                <tr>
                  <th className="py-2.5 px-4">District</th>
                  <th className="py-2.5 px-4">Taluk</th>
                  <th className="py-2.5 px-4 text-right">Member Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="py-12 text-center text-stone-400">
                      No geography records match the filter.
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((r, i) => (
                    <tr key={i} className="hover:bg-stone-50">
                      <td className="py-2.5 px-4 font-semibold text-stone-800">{r.district_name || 'Unassigned'}</td>
                      <td className="py-2.5 px-4 text-stone-600">{r.taluk_name || 'All Taluks'}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-[#510601]">{Number(r.count || r.member_count || 0).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {subView === 'gender' && (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-[#FAF7F2] border-b border-[#E8DFD8] text-stone-700 font-bold">
                <tr>
                  <th className="py-2.5 px-4">Gender</th>
                  <th className="py-2.5 px-4">Membership Type</th>
                  <th className="py-2.5 px-4 text-right">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="py-12 text-center text-stone-400">
                      No gender demographics records match the filter.
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((r, i) => (
                    <tr key={i} className="hover:bg-stone-50">
                      <td className="py-2.5 px-4 font-semibold text-stone-800">{r.gender || 'Unspecified'}</td>
                      <td className="py-2.5 px-4 text-stone-600">{r.membership_type || 'All Types'}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-[#510601]">{Number(r.count || 0).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {subView === 'unapproved' && (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-[#FAF7F2] border-b border-[#E8DFD8] text-stone-700 font-bold">
                <tr>
                  <th className="py-2.5 px-3">Applicant Name</th>
                  <th className="py-2.5 px-3">Mobile</th>
                  <th className="py-2.5 px-3">District</th>
                  <th className="py-2.5 px-3">Taluk</th>
                  <th className="py-2.5 px-3">Applied Date</th>
                  <th className="py-2.5 px-3 text-right">Days Pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="py-12 text-center text-stone-400">
                      No unapproved members pending review.
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((r, i) => (
                    <tr key={i} className="hover:bg-stone-50">
                      <td className="py-2.5 px-3 font-semibold text-stone-800">{r.name || [r.first_name_en, r.last_name_en].filter(Boolean).join(' ') || '—'}</td>
                      <td className="py-2.5 px-3 text-stone-600">{r.mobile || '—'}</td>
                      <td className="py-2.5 px-3 text-stone-600">{r.district_name || '—'}</td>
                      <td className="py-2.5 px-3 text-stone-600">{r.taluk_name || '—'}</td>
                      <td className="py-2.5 px-3 text-stone-600">{formatDate(r.created_at) || '—'}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-amber-700">{r.days_pending ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Controls */}
        <div className="p-3 bg-white border-t border-[#E8DFD8] flex items-center justify-between text-xs text-stone-600">
          <span>Page {page} of {totalPages}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1 rounded border border-[#DFD5CC] disabled:opacity-30 hover:bg-stone-100 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1 rounded border border-[#DFD5CC] disabled:opacity-30 hover:bg-stone-100 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Column Picker Modal */}
      <Modal
        isOpen={columnModalOpen}
        onClose={() => setColumnModalOpen(false)}
        title="Select Report Columns"
      >
        <div className="p-4 space-y-3">
          <p className="text-xs text-stone-600">
            Choose which data fields to include in the screen table and CSV/Excel export:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pt-2">
            {MEMBER_COLUMNS.map((col) => {
              const isChecked = selectedColumns.includes(col.key);
              return (
                <label key={col.key} className="flex items-center gap-2 p-2 rounded-lg border border-stone-200 hover:bg-stone-50 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {
                      if (isChecked) {
                        if (selectedColumns.length <= 1) {
                          notify('You must select at least one column.', 'warning');
                          return;
                        }
                        setSelectedColumns(selectedColumns.filter((k) => k !== col.key));
                      } else {
                        setSelectedColumns([...selectedColumns, col.key]);
                      }
                    }}
                    className="rounded text-[#510601] focus:ring-[#510601]"
                  />
                  <span className="font-medium text-stone-800">{col.labelEn}</span>
                </label>
              );
            })}
          </div>
        </div>
        <ModalFooter
          onCancel={() => setColumnModalOpen(false)}
          onSubmit={() => setColumnModalOpen(false)}
          submitLabel="Apply Columns"
        />
      </Modal>
    </div>
  );
}

// ==============================================================
// 3. RECEIPTS & FINANCE REPORT TAB
// ==============================================================
function ReceiptsReportTab({ membershipTypes, onDownload }) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [paymentMode, setPaymentMode] = useState('');
  const [particularId, setParticularId] = useState('');
  const [particulars, setParticulars] = useState([]);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 15;

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/masters/particulars');
        setParticulars(res.data?.data || res.data || []);
      } catch (_) {}
    })();
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (fromDate) params.from_date = fromDate;
      if (toDate) params.to_date = toDate;
      if (paymentMode) params.payment_mode = paymentMode;
      if (particularId) params.particular_id = particularId;

      const res = await api.get('/reports/receipts', { params });
      setRows(Array.isArray(res.data) ? res.data : (res.data?.data || []));
      setPage(1);
    } catch (err) {
      console.error('Failed to load receipts report.', err);
      notify('Failed to load receipts report data.', 'error');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, paymentMode, particularId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleExport = (format) => {
    const params = { export: format };
    if (fromDate) params.from_date = fromDate;
    if (toDate) params.to_date = toDate;
    if (paymentMode) params.payment_mode = paymentMode;
    if (particularId) params.particular_id = particularId;

    const filename = `receipts-report-${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'xlsx'}`;
    onDownload('/reports/receipts', params, filename);
  };

  const totalAmount = useMemo(() => {
    return rows.reduce((acc, r) => acc + Number(r.net_amount || r.total_amount || 0), 0);
  }, [rows]);

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page]);

  const totalPages = Math.ceil(rows.length / pageSize) || 1;

  return (
    <div className="space-y-4">
      {/* Top Banner & Export Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 text-xs">
          <div className="bg-[#FAF7F2] border border-[#E8DFD8] rounded-lg px-3 py-2">
            <span className="text-stone-500">Total Count: </span>
            <strong className="text-[#180200]">{rows.length}</strong>
          </div>
          <div className="bg-[#FAF7F2] border border-[#E8DFD8] rounded-lg px-3 py-2">
            <span className="text-stone-500">Total Collections: </span>
            <strong className="text-emerald-700">₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
          </div>
        </div>

        <PageActions>
          <button
            onClick={() => handleExport('csv')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#510601] bg-white border border-[#E8DFD8] rounded-lg hover:bg-[#FAF7F2] cursor-pointer shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => handleExport('excel')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#510601] rounded-lg hover:bg-[#3D0400] cursor-pointer shadow-sm transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export Excel</span>
          </button>
        </PageActions>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white border border-[#E8DFD8] rounded-xl p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-bold text-stone-600 uppercase mb-1">From Date</label>
          <DateInput
            value={fromDate}
            onChange={(val) => setFromDate(val)}
            className="w-full px-2.5 py-1.5 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-stone-600 uppercase mb-1">To Date</label>
          <DateInput
            value={toDate}
            onChange={(val) => setToDate(val)}
            className="w-full px-2.5 py-1.5 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-stone-600 uppercase mb-1">Payment Mode</label>
          <select
            value={paymentMode}
            onChange={(e) => setPaymentMode(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
          >
            <option value="">All Payment Modes</option>
            <option value="CASH">Cash</option>
            <option value="CHEQUE">Cheque</option>
            <option value="DD">Demand Draft (D.D.)</option>
            <option value="UPI">UPI</option>
            <option value="BANK_TRANSFER">Bank Transfer (NEFT/RTGS)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-stone-600 uppercase mb-1">Particular</label>
          <select
            value={particularId}
            onChange={(e) => setParticularId(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
          >
            <option value="">All Particulars</option>
            {particulars.map((p) => (
              <option key={p.id} value={p.id}>{p.name_en || p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Receipts Table */}
      <div className="bg-white border border-[#E8DFD8] rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 bg-[#FAF7F2] border-b border-[#E8DFD8] text-stone-700 font-bold">
              <tr>
                <th className="py-2.5 px-3">Receipt Number</th>
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Payee / Member</th>
                <th className="py-2.5 px-3">Payment Mode</th>
                <th className="py-2.5 px-3">Bank Account</th>
                <th className="py-2.5 px-3 text-right">Net Amount</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8]">
              {paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan="7" className="py-12 text-center text-stone-400">
                    No receipt transactions match the selected filters.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((r, i) => (
                  <tr key={i} className="hover:bg-stone-50">
                    <td className="py-2.5 px-3 font-semibold text-stone-800">{r.receipt_number || '—'}</td>
                    <td className="py-2.5 px-3 text-stone-600">{formatDate(r.receipt_date) || '—'}</td>
                    <td className="py-2.5 px-3 text-stone-800">{r.received_from || r.member_name || '—'}</td>
                    <td className="py-2.5 px-3 text-stone-600">{r.payment_mode || '—'}</td>
                    <td className="py-2.5 px-3 text-stone-600">{r.bank_account || '—'}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-stone-900">
                      ₹{Number(r.net_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        r.status === 'ACTIVE' || r.status === 'PAID'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-stone-100 text-stone-600 border border-stone-200'
                      }`}>
                        {r.status || 'ACTIVE'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-3 bg-white border-t border-[#E8DFD8] flex items-center justify-between text-xs text-stone-600">
          <span>Page {page} of {totalPages}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1 rounded border border-[#DFD5CC] disabled:opacity-30 hover:bg-stone-100 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1 rounded border border-[#DFD5CC] disabled:opacity-30 hover:bg-stone-100 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==============================================================
// 4. MAGAZINE & LOGISTICS REPORT TAB
// ==============================================================
function MagazinesReportTab({ districts, taluks, onDownload }) {
  const [subType, setSubType] = useState('returns'); // 'returns' | 'labels'
  const [issueMonth, setIssueMonth] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [followUpStatus, setFollowUpStatus] = useState('');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 15;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let endpoint = '/reports/magazine-returns';
      const params = {};
      if (issueMonth) params.issue_month_year = issueMonth;

      if (subType === 'returns') {
        if (returnReason) params.reason = returnReason;
        if (followUpStatus) params.follow_up_status = followUpStatus;
      } else {
        endpoint = '/reports/labels';
      }

      const res = await api.get(endpoint, { params });
      setRows(Array.isArray(res.data) ? res.data : (res.data?.data || []));
      setPage(1);
    } catch (err) {
      console.error('Failed to load magazine report.', err);
      notify('Failed to load magazine report data.', 'error');
    } finally {
      setLoading(false);
    }
  }, [subType, issueMonth, returnReason, followUpStatus]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleExport = (format) => {
    let endpoint = subType === 'returns' ? '/reports/magazine-returns' : '/reports/labels';
    const params = { export: format };
    if (issueMonth) params.issue_month_year = issueMonth;
    if (subType === 'returns') {
      if (returnReason) params.reason = returnReason;
      if (followUpStatus) params.follow_up_status = followUpStatus;
    }

    const filename = `magazine-${subType}-${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'xlsx'}`;
    onDownload(endpoint, params, filename);
  };

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page]);

  const totalPages = Math.ceil(rows.length / pageSize) || 1;

  return (
    <div className="space-y-4">
      {/* Switcher & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex rounded-lg border border-[#E8DFD8] bg-white p-1 shadow-sm">
          <button
            onClick={() => setSubType('returns')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              subType === 'returns' ? 'bg-[#510601] text-white' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Magazine Returns
          </button>
          <button
            onClick={() => setSubType('labels')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              subType === 'labels' ? 'bg-[#510601] text-white' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Label Batches
          </button>
        </div>

        <PageActions>
          <button
            onClick={() => handleExport('csv')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#510601] bg-white border border-[#E8DFD8] rounded-lg hover:bg-[#FAF7F2] cursor-pointer shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => handleExport('excel')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#510601] rounded-lg hover:bg-[#3D0400] cursor-pointer shadow-sm transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export Excel</span>
          </button>
        </PageActions>
      </div>

      {/* Filter toolbar */}
      <div className="bg-white border border-[#E8DFD8] rounded-xl p-4 shadow-sm grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-bold text-stone-600 uppercase mb-1">Issue Month (YYYY-MM)</label>
          <input
            type="month"
            value={issueMonth}
            onChange={(e) => setIssueMonth(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
          />
        </div>

        {subType === 'returns' && (
          <>
            <div>
              <label className="block text-xs font-bold text-stone-600 uppercase mb-1">Return Reason</label>
              <select
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
              >
                <option value="">All Reasons</option>
                <option value="ADDRESS_NOT_FOUND">Address Not Found</option>
                <option value="MOVED">Recipient Moved</option>
                <option value="REFUSED">Delivery Refused</option>
                <option value="DECEASED">Deceased</option>
                <option value="UNCLAIMED">Unclaimed / Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-600 uppercase mb-1">Follow-up Status</label>
              <select
                value={followUpStatus}
                onChange={(e) => setFollowUpStatus(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
              >
                <option value="">All Follow-up States</option>
                <option value="PENDING">Pending Action</option>
                <option value="CONTACTED">Contacted Recipient</option>
                <option value="RESOLVED">Resolved / Address Updated</option>
              </select>
            </div>
          </>
        )}
      </div>

      {/* Results Table */}
      <div className="bg-white border border-[#E8DFD8] rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          {subType === 'returns' ? (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-[#FAF7F2] border-b border-[#E8DFD8] text-stone-700 font-bold">
                <tr>
                  <th className="py-2.5 px-3">Issue Month</th>
                  <th className="py-2.5 px-3">Member / Recipient</th>
                  <th className="py-2.5 px-3">Return Reason</th>
                  <th className="py-2.5 px-3">Return Date</th>
                  <th className="py-2.5 px-3">Follow-up Status</th>
                  <th className="py-2.5 px-3">Action Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="py-12 text-center text-stone-400">
                      No magazine returns recorded matching the criteria.
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((r, i) => (
                    <tr key={i} className="hover:bg-stone-50">
                      <td className="py-2.5 px-3 font-semibold text-stone-800">{r.issue_month_year || '—'}</td>
                      <td className="py-2.5 px-3 text-stone-800">{r.member_name || r.name || '—'}</td>
                      <td className="py-2.5 px-3 text-rose-700 font-medium">{r.reason || '—'}</td>
                      <td className="py-2.5 px-3 text-stone-600">{formatDate(r.return_date) || '—'}</td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          r.follow_up_status === 'RESOLVED'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : r.follow_up_status === 'CONTACTED'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}>
                          {r.follow_up_status || 'PENDING'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-stone-600">{r.action_notes || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-[#FAF7F2] border-b border-[#E8DFD8] text-stone-700 font-bold">
                <tr>
                  <th className="py-2.5 px-3">Batch Name</th>
                  <th className="py-2.5 px-3">Issue Month</th>
                  <th className="py-2.5 px-3">Generated Date</th>
                  <th className="py-2.5 px-3 text-right">Total Labels</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-12 text-center text-stone-400">
                      No label batches recorded matching the criteria.
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((r, i) => (
                    <tr key={i} className="hover:bg-stone-50">
                      <td className="py-2.5 px-3 font-semibold text-stone-800">{r.batch_name || `Batch ${r.id}`}</td>
                      <td className="py-2.5 px-3 text-stone-600">{r.issue_month_year || '—'}</td>
                      <td className="py-2.5 px-3 text-stone-600">{formatDate(r.generation_date || r.created_at) || '—'}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-stone-900">{r.total_labels || r.count || 0}</td>
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {r.status || 'COMPLETED'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div className="p-3 bg-white border-t border-[#E8DFD8] flex items-center justify-between text-xs text-stone-600">
          <span>Page {page} of {totalPages}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1 rounded border border-[#DFD5CC] disabled:opacity-30 hover:bg-stone-100 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1 rounded border border-[#DFD5CC] disabled:opacity-30 hover:bg-stone-100 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==============================================================
// 5. SAVED REPORTS & AUDIT LOGS TAB
// ==============================================================
function SavedReportsAndLogsTab({ onDownload, canSave }) {
  const [subTab, setSubTab] = useState('saved'); // 'saved' | 'logs'
  const [savedReports, setSavedReports] = useState([]);
  const [exportLogs, setExportLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (subTab === 'saved') {
        const res = await api.get('/reports/saved');
        setSavedReports(Array.isArray(res.data) ? res.data : []);
      } else {
        const res = await api.get('/reports/export-logs');
        setExportLogs(Array.isArray(res.data) ? res.data : (res.data?.data || []));
      }
    } catch (err) {
      console.error('Failed to load saved reports or logs.', err);
    } finally {
      setLoading(false);
    }
  }, [subTab]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDeleteSaved = async (id) => {
    if (!window.confirm('Are you sure you want to delete this saved report preset?')) return;
    try {
      await api.delete(`/reports/saved/${id}`);
      notify('Saved report deleted.', 'success');
      loadData();
    } catch (err) {
      notify('Failed to delete saved report.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Subtab selection */}
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-[#E8DFD8] bg-white p-1 shadow-sm">
          <button
            onClick={() => setSubTab('saved')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              subTab === 'saved' ? 'bg-[#510601] text-white' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Saved Report Presets
          </button>
          <button
            onClick={() => setSubTab('logs')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              subTab === 'logs' ? 'bg-[#510601] text-white' : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Export Audit Trail
          </button>
        </div>

        <button
          onClick={loadData}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-700 bg-white border border-[#E8DFD8] rounded-lg hover:bg-stone-50 cursor-pointer shadow-sm transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {subTab === 'saved' ? (
        <div className="bg-white border border-[#E8DFD8] rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-stone-700 font-bold">
              <tr>
                <th className="py-2.5 px-4">Report Name</th>
                <th className="py-2.5 px-4">Module / Type</th>
                <th className="py-2.5 px-4">Saved Filters</th>
                <th className="py-2.5 px-4">Created At</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8]">
              {savedReports.length === 0 ? (
                <tr>
                  <td colSpan="5" className="py-12 text-center text-stone-400">
                    No saved report presets found.
                  </td>
                </tr>
              ) : (
                savedReports.map((r) => (
                  <tr key={r.id} className="hover:bg-stone-50">
                    <td className="py-2.5 px-4 font-semibold text-stone-800">{r.report_name}</td>
                    <td className="py-2.5 px-4 text-stone-600 uppercase">{r.report_key}</td>
                    <td className="py-2.5 px-4 text-stone-500 font-mono text-[11px]">
                      {JSON.stringify(r.filters || {})}
                    </td>
                    <td className="py-2.5 px-4 text-stone-600">{formatDate(r.created_at)}</td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canSave && (
                          <button
                            onClick={() => handleDeleteSaved(r.id)}
                            className="p-1 text-stone-400 hover:text-red-700 rounded transition-colors cursor-pointer"
                            title="Delete Saved Report"
                          >
                            <Trash2 className="w-4 h-4" /><span>Delete</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white border border-[#E8DFD8] rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-stone-700 font-bold">
              <tr>
                <th className="py-2.5 px-4">Export Timestamp</th>
                <th className="py-2.5 px-4">Report Type</th>
                <th className="py-2.5 px-4">Format</th>
                <th className="py-2.5 px-4">Exported By</th>
                <th className="py-2.5 px-4">Filters Applied</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8]">
              {exportLogs.length === 0 ? (
                <tr>
                  <td colSpan="5" className="py-12 text-center text-stone-400">
                    No export audit logs recorded yet.
                  </td>
                </tr>
              ) : (
                exportLogs.map((l) => (
                  <tr key={l.id} className="hover:bg-stone-50">
                    <td className="py-2.5 px-4 text-stone-800 font-semibold">{formatDate(l.exported_at)}</td>
                    <td className="py-2.5 px-4 text-stone-700 font-medium uppercase">{l.report_key}</td>
                    <td className="py-2.5 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-stone-100 text-stone-700 uppercase">
                        {l.format}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-stone-600">{l.user_name || l.exported_by || 'Staff'}</td>
                    <td className="py-2.5 px-4 text-stone-500 font-mono text-[11px]">
                      {JSON.stringify(l.filters || {})}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
