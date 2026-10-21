import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import PageActions, { PageActionsSlot } from '../components/PageActions';
import PageTitle from '../components/PageTitle';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
import Pager from '../components/Pager';
import { formatMoney } from '../utils/money';
import {
  BarChart3,
  Users,
  UserCheck,
  UserX,
  Award,
  ArrowRight,
  Receipt,
  BookOpen,
  History,
  Download,
  Search,
  Filter,
  RefreshCw,
  SlidersHorizontal,
  CreditCard,
  FileSpreadsheet,
  MapPin,
  Trash2,
} from 'lucide-react';
import api from '../api';
import useAuth from '../hooks/useAuth';
import Modal from '../components/Modal';
import ModalFooter from '../components/ModalFooter';
import DateInput from '../components/DateInput';
import { formatDate } from '../utils/dateUtils';
import { notify } from '../utils/notify';
import { loadLocations, loadMembershipTypes } from '../utils/serverData';
import { memberName } from '../utils/memberName';

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
  const canSave = hasPermission('reports.saved_report.write');

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
          loadLocations({ postalCodes: false }),
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
      {/* Dynamic Page Title in Header Bar */}
      <PageTitle>{TABS.find((t) => t.key === activeTab)?.label || 'Reports'}</PageTitle>

      {/* each report is its own sidebar page: no tab row, only the page actions */}
      <div className="flex justify-end -mb-2">
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
  const approved = mem.by_approval_status?.APPROVED || 0;
  const pending = mem.by_approval_status?.UNAPPROVED || 0;
  const male = mem.by_gender?.MALE || mem.by_gender?.Male || 0;
  const female = mem.by_gender?.FEMALE || mem.by_gender?.Female || 0;
  const otherGender = Math.max(0, (mem.total || 0) - male - female);
  const share = (n, of) => (of > 0 ? Math.min(100, (n / of) * 100) : 0);

  // a clickable headline card: icon tile, big number, a line of detail and an arrow
  const Kpi = ({ to, label, icon: Icon, tone, value, detail, linkLabel }) => (
    <button
      type="button"
      onClick={() => onNavigate(to)}
      className="text-left bg-white p-5 rounded-2xl border border-[#E8DFD8] shadow-sm hover:border-[#510601]/40 hover:shadow-md transition-all group flex flex-col justify-between gap-3 cursor-pointer"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-[#863221] uppercase tracking-wider">{label}</span>
        <span className={`p-2 rounded-xl ${tone}`}><Icon className="w-4 h-4" /></span>
      </div>
      <div>
        <strong className="text-2xl font-bold text-[#180200] block tabular-nums">{value}</strong>
        <span className="text-xs text-[#863221] block mt-0.5">{detail}</span>
      </div>
      <span className="text-xs font-semibold text-[#510601] inline-flex items-center gap-1">
        {linkLabel}
        <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
      </span>
    </button>
  );

  // a labelled bar: the name, the number, and how much of the whole it is
  const Bar = ({ label, count, of, color }) => (
    <div>
      <div className="flex justify-between text-xs font-semibold mb-1">
        <span className="text-[#180200] truncate pr-2">{label}</span>
        <span className="text-[#510601] tabular-nums">{count.toLocaleString()}</span>
      </div>
      <div className="w-full bg-[#FAF7F2] h-2 rounded-full overflow-hidden border border-[#E8DFD8]">
        <div className={`${color} h-full rounded-full`} style={{ width: `${share(count, of)}%` }} />
      </div>
    </div>
  );

  const Section = ({ icon: Icon, title, to, linkLabel, children }) => (
    <div className="bg-white rounded-2xl p-5 border border-[#E8DFD8] shadow-sm">
      <div className="flex items-center justify-between pb-3 border-b border-[#E8DFD8]">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-[#510601]" />
          <h3 className="font-bold text-[#180200] text-sm">{title}</h3>
        </div>
        {to && (
          <button type="button" onClick={() => onNavigate(to)} className="text-xs font-semibold text-[#510601] hover:underline cursor-pointer">
            {linkLabel}
          </button>
        )}
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageActions>
        <button
          type="button"
          onClick={loadSummary}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#510601] bg-white border border-[#E8DFD8] rounded-xl hover:bg-[#FAF7F2] cursor-pointer shadow-2xs transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
        <button
          type="button"
          onClick={() => onDownload('/reports/members', { export: 'csv' }, `members-summary-${new Date().toISOString().slice(0, 10)}.csv`)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#510601] rounded-xl hover:bg-[#3D0400] cursor-pointer shadow-2xs transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Download All Members CSV</span>
        </button>
      </PageActions>

      {/* Headline cards: each one opens its report */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <Kpi to="members" label="Approved Members" icon={UserCheck} tone="bg-[#3D705C]/15 text-[#3D705C]"
          value={approved.toLocaleString()} detail={`${(mem.total || 0).toLocaleString()} registered in all`} linkLabel="View members" />
        <Kpi to="members" label="Pending Approval" icon={UserX} tone="bg-[#EE6A00]/15 text-[#EE6A00]"
          value={pending.toLocaleString()} detail={`${mem.by_approval_status?.REJECTED || 0} rejected`} linkLabel="View unapproved" />
        <Kpi to="receipts" label="Collections" icon={CreditCard} tone="bg-[#510601]/10 text-[#510601]"
          value={formatMoney(rec.total_amount || 0)} detail={`${(rec.count || 0).toLocaleString()} receipts`} linkLabel="View receipts" />
        <Kpi to="magazines" label="Magazine Circulation" icon={BookOpen} tone="bg-[#8C1801]/15 text-[#8C1801]"
          value={(mag.subscriptions_by_status?.ACTIVE || 0).toLocaleString()}
          detail={`${mag.active_pauses || 0} paused · ${mag.returns_total || 0} returned`} linkLabel="View circulation" />
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Section icon={Award} title="Membership Types" to="members" linkLabel="View details">
          {mtypes.length === 0 ? (
            <p className="text-xs text-[#863221]/60">No membership type data recorded.</p>
          ) : (
            mtypes.map((t) => (
              <Bar key={t.membership_type} label={t.membership_type} count={t.member_count} of={mem.total || 0} color="bg-[#8C1801]" />
            ))
          )}
        </Section>

        <Section icon={Users} title="Gender" to="members" linkLabel="View details">
          <Bar label="Male" count={male} of={mem.total || 0} color="bg-[#510601]" />
          <Bar label="Female" count={female} of={mem.total || 0} color="bg-[#8C1801]" />
          <Bar label="Other / not given" count={otherGender} of={mem.total || 0} color="bg-[#863221]/40" />
        </Section>

        <Section icon={MapPin} title="Top Districts" to="members" linkLabel="View details">
          {(mem.top_districts || []).length === 0 ? (
            <p className="text-xs text-stone-400">No district data recorded.</p>
          ) : (
            (mem.top_districts || []).map((d) => (
              <Bar key={d.name} label={d.name} count={d.count} of={mem.total || 0} color="bg-[#510601]" />
            ))
          )}
        </Section>
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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedColumns, setSelectedColumns] = useState(MEMBER_COLUMNS.map((c) => c.key));
  const [columnModalOpen, setColumnModalOpen] = useState(false);

  // Table Data State
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

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

  // Client-side search filtering across list rows
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase().trim();
    return rows.filter((r) =>
      String(r.member_code || '').toLowerCase().includes(q) ||
      String(r.first_name_en || '').toLowerCase().includes(q) ||
      String(r.last_name_en || '').toLowerCase().includes(q) ||
      String(r.full_name_kn || '').toLowerCase().includes(q) ||
      String(r.mobile || '').toLowerCase().includes(q) ||
      String(r.email || '').toLowerCase().includes(q) ||
      String(r.district_name || '').toLowerCase().includes(q) ||
      String(r.taluk_name || '').toLowerCase().includes(q)
    );
  }, [rows, searchQuery]);

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

  const activeFiltersCount = [
    districtId,
    talukId,
    gender,
    approvalStatus,
    membershipTypeId,
    language !== 'en' ? language : '',
  ].filter(Boolean).length;

  const handleResetFilters = () => {
    setDistrictId('');
    setTalukId('');
    setGender('');
    setApprovalStatus('');
    setMembershipTypeId('');
    setLanguage('en');
    setSearchQuery('');
  };

  // Pagination slice
  const paginatedRows = useMemo(() => {
    const list = subView === 'list' ? filteredRows : rows;
    const start = (page - 1) * pageSize;
    return list.slice(start, start + pageSize);
  }, [subView, filteredRows, rows, page, pageSize]);

  const totalPages = Math.ceil((subView === 'list' ? filteredRows.length : rows.length) / pageSize) || 1;

  // Sub-view Switcher component
  const subViewSwitcher = (
    <div className="inline-flex rounded-xl border border-[#E8DFD8] bg-[#FAF7F2] p-1 shadow-2xs">
      {[
        { id: 'list', label: 'All Members List' },
        { id: 'geography', label: 'By Geography' },
        { id: 'gender', label: 'By Gender' },
        { id: 'unapproved', label: 'Unapproved Aging' },
      ].map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => {
            setSubView(tab.id);
            setPage(1);
          }}
          className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            subView === tab.id
              ? 'bg-[#510601] text-white shadow-2xs'
              : 'text-[#863221] hover:text-[#510601] hover:bg-white/60'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Standard SearchFilterBar Toolbar matching ReceiptTracking */}
      <SearchFilterBar
        searchQuery={subView === 'list' ? searchQuery : undefined}
        onSearchChange={subView === 'list' ? setSearchQuery : undefined}
        searchPlaceholder="Search member name, code, mobile, email..."
        activeFiltersCount={activeFiltersCount}
        onResetFilters={handleResetFilters}
        leftSlot={subViewSwitcher}
        rightSlot={
          <>
            {subView === 'list' && (
              <button
                type="button"
                onClick={() => setColumnModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#863221] bg-white border border-[#E8DFD8] rounded-xl hover:bg-[#FAF7F2] cursor-pointer shadow-2xs transition-colors"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#510601]" />
                <span>Columns ({selectedColumns.length})</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleExport('csv')}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#510601] bg-white border border-[#E8DFD8] rounded-xl hover:bg-[#FAF7F2] cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              <span>Export CSV</span>
            </button>

            <button
              type="button"
              onClick={() => handleExport('excel')}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#510601] rounded-xl hover:bg-[#3D0400] cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Export Excel</span>
            </button>
          </>
        }
      >
        <FilterSelect
          value={districtId}
          onChange={(val) => {
            setDistrictId(val);
            setTalukId('');
          }}
          options={[
            { value: '', label: 'All Districts' },
            ...districts.map((d) => ({ value: String(d.id), label: d.name_en || d.name })),
          ]}
          widthClass="w-full sm:w-48"
        />

        <FilterSelect
          value={talukId}
          onChange={setTalukId}
          options={[
            { value: '', label: 'All Taluks' },
            ...availableTaluks.map((t) => ({ value: String(t.id), label: t.name_en || t.name })),
          ]}
          widthClass="w-full sm:w-48"
        />

        <FilterSelect
          value={gender}
          onChange={setGender}
          options={[
            { value: '', label: 'All Genders' },
            { value: 'Male', label: 'Male' },
            { value: 'Female', label: 'Female' },
            { value: 'Other', label: 'Other' },
          ]}
          widthClass="w-full sm:w-40"
        />

        <FilterSelect
          value={approvalStatus}
          onChange={setApprovalStatus}
          options={[
            { value: '', label: 'All Approval Statuses' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'UNAPPROVED', label: 'Unapproved' },
            { value: 'REJECTED', label: 'Rejected' },
          ]}
          widthClass="w-full sm:w-48"
        />

        <FilterSelect
          value={membershipTypeId}
          onChange={setMembershipTypeId}
          options={[
            { value: '', label: 'All Membership Types' },
            ...membershipTypes.map((mt) => ({ value: String(mt.id), label: mt.name_en || mt.name })),
          ]}
          widthClass="w-full sm:w-52"
        />

        <FilterSelect
          value={language}
          onChange={setLanguage}
          options={[
            { value: 'en', label: 'English Headers' },
            { value: 'kn', label: 'ಕನ್ನಡ ಹೆಡರ್ಸ್' },
          ]}
          widthClass="w-full sm:w-44"
        />
      </SearchFilterBar>

      {/* Standard HMS Table matching ReceiptTracking */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          {subView === 'list' && (
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-bold text-[#863221] uppercase tracking-wider">
                  {selectedColumns.map((colKey) => {
                    const col = MEMBER_COLUMNS.find((c) => c.key === colKey);
                    return (
                      <th key={colKey} className="py-3.5 px-4 whitespace-nowrap">
                        {language === 'kn' ? (col?.labelKn || colKey) : (col?.labelEn || colKey)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8] text-xs sm:text-sm">
                {loading ? (
                  <tr>
                    <td colSpan={selectedColumns.length} className="py-14 text-center text-[#863221]">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <RefreshCw className="w-8 h-8 animate-spin text-[#8C1801]" />
                        <p className="text-sm font-semibold text-[#180200]">Loading members...</p>
                      </div>
                    </td>
                  </tr>
                ) : paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan={selectedColumns.length} className="py-14 text-center text-[#863221]">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <Users className="w-10 h-10 text-[#863221]/40" />
                        <p className="text-base font-bold text-[#180200]">No member records match the selected filters</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((r, i) => (
                    <tr key={i} className="transition-colors bg-white hover:bg-[#FAF7F2] text-[#180200]">
                      {selectedColumns.map((colKey) => {
                        const val = r[colKey];
                        if (colKey === 'member_code') {
                          return (
                            <td key={colKey} className="py-3.5 px-4 font-mono font-bold text-xs text-[#510601] whitespace-nowrap">
                              {val || '—'}
                            </td>
                          );
                        }
                        if (colKey === 'mobile') {
                          return (
                            <td key={colKey} className="py-3.5 px-4 font-mono text-xs text-[#863221] whitespace-nowrap">
                              {val || '—'}
                            </td>
                          );
                        }
                        if (colKey === 'approval_status') {
                          return (
                            <td key={colKey} className="py-3.5 px-4 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                val === 'APPROVED'
                                  ? 'bg-[#3D705C]/15 text-[#3D705C] border border-[#3D705C]/30'
                                  : val === 'UNAPPROVED'
                                  ? 'bg-[#EE6A00]/15 text-[#EE6A00] border border-[#EE6A00]/30'
                                  : 'bg-rose-50 text-rose-700 border border-rose-200'
                              }`}>
                                {val || '—'}
                              </span>
                            </td>
                          );
                        }
                        if (colKey === 'first_name_en' || colKey === 'full_name_kn') {
                          return (
                            <td key={colKey} className="py-3.5 px-4 font-bold text-[#180200] whitespace-nowrap">
                              {val || '—'}
                            </td>
                          );
                        }
                        return (
                          <td key={colKey} className="py-3.5 px-4 whitespace-nowrap">
                            {val !== null && val !== undefined ? String(val) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {subView === 'geography' && (
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-bold text-[#863221] uppercase tracking-wider">
                  <th className="py-3.5 px-4">District</th>
                  <th className="py-3.5 px-4">Taluk</th>
                  <th className="py-3.5 px-4 text-right">Member Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8] text-xs sm:text-sm">
                {loading ? (
                  <tr>
                    <td colSpan="3" className="py-14 text-center text-[#863221]">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <RefreshCw className="w-8 h-8 animate-spin text-[#8C1801]" />
                        <p className="text-sm font-semibold text-[#180200]">Loading geographic breakdown...</p>
                      </div>
                    </td>
                  </tr>
                ) : paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="py-14 text-center text-[#863221]">
                      <p className="text-sm font-semibold text-[#180200]">No geographic records found</p>
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((r, i) => (
                    <tr key={i} className="transition-colors bg-white hover:bg-[#FAF7F2] text-[#180200]">
                      <td className="py-3.5 px-4 font-bold text-[#180200]">{r.district_name || 'Unassigned'}</td>
                      <td className="py-3.5 px-4 text-[#863221]">{r.taluk_name || 'All Taluks'}</td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-xs sm:text-sm text-[#510601]">
                        {Number(r.count || r.member_count || 0).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {subView === 'gender' && (
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-bold text-[#863221] uppercase tracking-wider">
                  <th className="py-3.5 px-4">Gender</th>
                  <th className="py-3.5 px-4">Membership Type</th>
                  <th className="py-3.5 px-4 text-right">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8] text-xs sm:text-sm">
                {loading ? (
                  <tr>
                    <td colSpan="3" className="py-14 text-center text-[#863221]">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <RefreshCw className="w-8 h-8 animate-spin text-[#8C1801]" />
                        <p className="text-sm font-semibold text-[#180200]">Loading demographic breakdown...</p>
                      </div>
                    </td>
                  </tr>
                ) : paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="py-14 text-center text-[#863221]">
                      <p className="text-sm font-semibold text-[#180200]">No gender records found</p>
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((r, i) => (
                    <tr key={i} className="transition-colors bg-white hover:bg-[#FAF7F2] text-[#180200]">
                      <td className="py-3.5 px-4 font-bold text-[#180200]">{r.gender || 'Unspecified'}</td>
                      <td className="py-3.5 px-4 text-[#863221]">{r.membership_type || 'All Types'}</td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-xs sm:text-sm text-[#510601]">
                        {Number(r.count || 0).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {subView === 'unapproved' && (
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-bold text-[#863221] uppercase tracking-wider">
                  <th className="py-3.5 px-4">Applicant Name</th>
                  <th className="py-3.5 px-4">Mobile</th>
                  <th className="py-3.5 px-4">District</th>
                  <th className="py-3.5 px-4">Taluk</th>
                  <th className="py-3.5 px-4">Applied Date</th>
                  <th className="py-3.5 px-4 text-right">Days Pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8] text-xs sm:text-sm">
                {loading ? (
                  <tr>
                    <td colSpan="6" className="py-14 text-center text-[#863221]">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <RefreshCw className="w-8 h-8 animate-spin text-[#8C1801]" />
                        <p className="text-sm font-semibold text-[#180200]">Loading unapproved members...</p>
                      </div>
                    </td>
                  </tr>
                ) : paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="py-14 text-center text-[#863221]">
                      <p className="text-sm font-semibold text-[#180200]">No unapproved members pending review</p>
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((r, i) => (
                    <tr key={i} className="transition-colors bg-white hover:bg-[#FAF7F2] text-[#180200]">
                      <td className="py-3.5 px-4 font-bold text-[#180200]">{r.name || memberName(r) || '—'}</td>
                      <td className="py-3.5 px-4 font-mono text-xs text-[#863221]">{r.mobile || '—'}</td>
                      <td className="py-3.5 px-4">{r.district_name || '—'}</td>
                      <td className="py-3.5 px-4 text-[#863221]">{r.taluk_name || '—'}</td>
                      <td className="py-3.5 px-4 font-mono text-xs">{formatDate(r.created_at) || '—'}</td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-xs sm:text-sm text-[#EE6A00]">
                        {r.days_pending ?? '—'} days
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Standard Pager Component */}
        <div className="px-4 py-3 bg-[#FAF7F2] border-t border-[#E8DFD8]">
          <Pager
            page={page}
            pages={totalPages}
            total={subView === 'list' ? filteredRows.length : rows.length}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={setPageSize}
          />
        </div>
      </div>

      {/* Column Picker Modal */}
      <Modal
        isOpen={columnModalOpen}
        onClose={() => setColumnModalOpen(false)}
        title="Select Report Columns"
        footer={
          <ModalFooter
            kind="confirm"
            submitLabel="Apply Columns"
            onCancel={() => setColumnModalOpen(false)}
            onSubmit={() => setColumnModalOpen(false)}
          />
        }
      >
        <div className="p-6 space-y-4">
          <p className="text-xs text-[#863221]">
            Choose which data fields to include in the screen table and CSV/Excel export:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pt-2">
            {MEMBER_COLUMNS.map((col) => {
              const isChecked = selectedColumns.includes(col.key);
              return (
                <label key={col.key} className="flex items-center gap-2.5 p-2.5 rounded-xl border border-[#E8DFD8] hover:bg-[#FAF7F2] cursor-pointer text-xs transition-colors">
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
                  <span className="font-semibold text-[#180200]">{col.labelEn}</span>
                </label>
              );
            })}
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ==============================================================
// 3. RECEIPTS & FINANCE REPORT TAB
// ==============================================================
function ReceiptsReportTab({ membershipTypes, onDownload }) {
  const [subView, setSubView] = useState('fy_breakdown'); // 'fy_breakdown' | 'register'

  // ── State for FY Collections Breakdown ──
  const getCurrentFY = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const start = m >= 4 ? y : y - 1;
    return `${start}-${String(start + 1).slice(-2)}`;
  };

  const [selectedFY, setSelectedFY] = useState(getCurrentFY());
  const [availableFYs, setAvailableFYs] = useState([getCurrentFY()]);
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [fyRows, setFyRows] = useState([]);
  const [fySummary, setFySummary] = useState({});
  const [fyLoading, setFyLoading] = useState(false);
  const [fyPage, setFyPage] = useState(1);
  const [fyPageSize, setFyPageSize] = useState(25);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load FY collections breakdown data
  const loadFYData = useCallback(async () => {
    setFyLoading(true);
    try {
      const params = {
        fy: selectedFY,
        category: selectedCategory,
      };
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();

      const res = await api.get('/reports/member-collections-by-fy', { params });
      const body = res.data || {};
      setFyRows(body.data || []);
      setFySummary(body.summary || {});
      if (body.financial_years && body.financial_years.length > 0) {
        setAvailableFYs(body.financial_years);
      }
      setFyPage(1);
    } catch (err) {
      console.error('Failed to load FY member collections report.', err);
      notify('Failed to load FY member collections report.', 'error');
    } finally {
      setFyLoading(false);
    }
  }, [selectedFY, selectedCategory, debouncedSearch]);

  useEffect(() => {
    if (subView === 'fy_breakdown') {
      loadFYData();
    }
  }, [subView, loadFYData]);

  const handleExportFY = (format) => {
    const params = {
      fy: selectedFY,
      category: selectedCategory,
      export: format,
    };
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
    const filename = `member-collections-fy-${selectedFY}-${selectedCategory.toLowerCase()}.${format === 'csv' ? 'csv' : 'xlsx'}`;
    onDownload('/reports/member-collections-by-fy', params, filename);
  };

  const paginatedFYRows = useMemo(() => {
    const start = (fyPage - 1) * fyPageSize;
    return fyRows.slice(start, start + fyPageSize);
  }, [fyRows, fyPage, fyPageSize]);

  const totalFYPages = Math.ceil(fyRows.length / fyPageSize) || 1;

  // ── State for General Receipts Register ──
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [paymentMode, setPaymentMode] = useState('ALL');
  const [particularId, setParticularId] = useState('ALL');
  const [particulars, setParticulars] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/masters/particulars');
        setParticulars(res.data?.data || res.data || []);
      } catch (_) {}
    })();
  }, []);

  const loadRegisterData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (fromDate) params.from_date = fromDate;
      if (toDate) params.to_date = toDate;
      if (paymentMode !== 'ALL') params.payment_mode = paymentMode;
      if (particularId !== 'ALL') params.particular_id = particularId;

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
    if (subView === 'register') {
      loadRegisterData();
    }
  }, [subView, loadRegisterData]);

  const handleExportRegister = (format) => {
    const params = { export: format };
    if (fromDate) params.from_date = fromDate;
    if (toDate) params.to_date = toDate;
    if (paymentMode !== 'ALL') params.payment_mode = paymentMode;
    if (particularId !== 'ALL') params.particular_id = particularId;

    const filename = `receipts-register-${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'xlsx'}`;
    onDownload('/reports/receipts', params, filename);
  };

  const totalRegisterAmount = useMemo(() => {
    return rows.reduce((acc, r) => acc + Number(r.net_amount || r.total_amount || 0), 0);
  }, [rows]);

  const paginatedRegisterRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize]);

  const totalRegisterPages = Math.ceil(rows.length / pageSize) || 1;

  // View switcher component
  const subViewSwitcher = (
    <div className="inline-flex rounded-xl border border-[#E8DFD8] bg-[#FAF7F2] p-1 shadow-2xs">
      <button
        type="button"
        onClick={() => setSubView('fy_breakdown')}
        className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
          subView === 'fy_breakdown'
            ? 'bg-[#510601] text-white shadow-2xs'
            : 'text-[#863221] hover:text-[#510601] hover:bg-white/60'
        }`}
      >
        FY Member Collections
      </button>
      <button
        type="button"
        onClick={() => setSubView('register')}
        className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
          subView === 'register'
            ? 'bg-[#510601] text-white shadow-2xs'
            : 'text-[#863221] hover:text-[#510601] hover:bg-white/60'
        }`}
      >
        All Receipts Register
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ──────────────────────────────────────────────────────────── */}
      {/* SUBVIEW 1: FY MEMBER COLLECTIONS (NEW VS EXISTING)          */}
      {/* ──────────────────────────────────────────────────────────── */}
      {subView === 'fy_breakdown' && (
        <>
          {/* KPI Summary Cards matching Dashboard StatCard design */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {/* 1. New Member Admissions */}
            <div className="bg-white rounded-2xl p-5 border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] hover:shadow-md transition-all flex flex-col justify-between">
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#863221] uppercase tracking-wider mb-1 truncate" title="New Member Admissions">
                    New Member Admissions
                  </p>
                  <h3 className="text-2xl font-bold font-mono text-[#180200] tracking-tight">
                    {formatMoney(fySummary.new_members_amount || 0)}
                  </h3>
                  <p className="text-xs text-[#863221] mt-1">
                    <strong className="text-[#180200]">{fySummary.new_members_count || 0}</strong> new member accounts this FY
                  </p>
                </div>
                <div className="p-2.5 rounded-xl shrink-0 flex items-center justify-center bg-[#3D705C]/15 text-[#3D705C]">
                  <Users className="h-5 w-5" />
                </div>
              </div>
            </div>

            {/* 2. Existing Member Collections */}
            <div className="bg-white rounded-2xl p-5 border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] hover:shadow-md transition-all flex flex-col justify-between">
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#863221] uppercase tracking-wider mb-1 truncate" title="Existing Member Collections">
                    Existing Member Collections
                  </p>
                  <h3 className="text-2xl font-bold font-mono text-[#180200] tracking-tight">
                    {formatMoney(fySummary.existing_members_amount || 0)}
                  </h3>
                  <p className="text-xs text-[#863221] mt-1">
                    <strong className="text-[#180200]">{fySummary.existing_members_count || 0}</strong> existing members paid
                  </p>
                </div>
                <div className="p-2.5 rounded-xl shrink-0 flex items-center justify-center bg-[#8C1801]/15 text-[#8C1801]">
                  <RefreshCw className="h-5 w-5" />
                </div>
              </div>
            </div>

            {/* 3. Unassigned Receipts */}
            <div className="bg-white rounded-2xl p-5 border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] hover:shadow-md transition-all flex flex-col justify-between">
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#863221] uppercase tracking-wider mb-1 truncate" title="Unassigned Receipts">
                    Unassigned Receipts
                  </p>
                  <h3 className="text-2xl font-bold font-mono text-[#180200] tracking-tight">
                    {formatMoney(fySummary.unassigned_amount || 0)}
                  </h3>
                  <p className="text-xs text-[#863221] mt-1">
                    <strong className="text-[#180200]">{fySummary.unassigned_count || 0}</strong> counter / unassigned receipts
                  </p>
                </div>
                <div className="p-2.5 rounded-xl shrink-0 flex items-center justify-center bg-[#EE6A00]/15 text-[#EE6A00]">
                  <CreditCard className="h-5 w-5" />
                </div>
              </div>
            </div>

            {/* 4. Total FY Collections */}
            <div className="bg-[#FAF7F2] rounded-2xl p-5 border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] hover:shadow-md transition-all flex flex-col justify-between">
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#863221] uppercase tracking-wider mb-1 truncate" title="Total FY Collections">
                    Total Collections (FY {selectedFY})
                  </p>
                  <h3 className="text-2xl font-bold font-mono text-[#510601] tracking-tight">
                    {formatMoney(fySummary.total_collections || 0)}
                  </h3>
                  <p className="text-xs text-[#863221] mt-1">
                    <strong className="text-[#180200]">{fySummary.total_receipts_count || 0}</strong> total receipts in FY {selectedFY}
                  </p>
                </div>
                <div className="p-2.5 rounded-xl shrink-0 flex items-center justify-center bg-[#510601] text-white">
                  <Receipt className="h-5 w-5" />
                </div>
              </div>
            </div>
          </div>

          {/* Standard SearchFilterBar Toolbar matching ReceiptTracking */}
          <SearchFilterBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search member name, number, receipt, mobile..."
            activeFiltersCount={
              (selectedFY !== getCurrentFY() ? 1 : 0) +
              (selectedCategory !== 'ALL' ? 1 : 0)
            }
            onResetFilters={() => {
              setSelectedFY(getCurrentFY());
              setSelectedCategory('ALL');
              setSearchQuery('');
            }}
            leftSlot={subViewSwitcher}
            rightSlot={
              <>
                <button
                  type="button"
                  onClick={() => handleExportFY('csv')}
                  disabled={fyRows.length === 0}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#510601] bg-white border border-[#E8DFD8] rounded-xl hover:bg-[#FAF7F2] cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  <span>Export CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportFY('excel')}
                  disabled={fyRows.length === 0}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#510601] rounded-xl hover:bg-[#3D0400] cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Export Excel</span>
                </button>
              </>
            }
          >
            {/* Financial Year Filter */}
            <FilterSelect
              value={selectedFY}
              onChange={setSelectedFY}
              options={availableFYs.map((fy) => ({ value: fy, label: `FY ${fy}` }))}
              widthClass="w-full sm:w-44"
            />

            {/* Collection Category Filter */}
            <FilterSelect
              value={selectedCategory}
              onChange={setSelectedCategory}
              options={[
                { value: 'ALL', label: 'All Collections' },
                { value: 'NEW_MEMBER', label: 'New Member Admissions' },
                { value: 'EXISTING_MEMBER', label: 'Existing Member Collections' },
                { value: 'UNASSIGNED', label: 'Unassigned Receipts' },
              ]}
              widthClass="w-full sm:w-60"
            />
          </SearchFilterBar>

          {/* Standard HMS Table matching ReceiptTracking */}
          <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-bold text-[#863221] uppercase tracking-wider">
                    <th className="py-3.5 px-4 whitespace-nowrap">Receipt No.</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Date</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Category</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Member Details</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Particulars</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Mode</th>
                    <th className="py-3.5 px-4 text-right whitespace-nowrap">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8DFD8] text-xs sm:text-sm">
                  {fyLoading ? (
                    <tr>
                      <td colSpan="7" className="py-14 text-center text-[#863221]">
                        <div className="flex flex-col items-center justify-center space-y-2">
                          <RefreshCw className="w-8 h-8 animate-spin text-[#8C1801]" />
                          <p className="text-sm font-semibold text-[#180200]">Loading financial year collections...</p>
                        </div>
                      </td>
                    </tr>
                  ) : paginatedFYRows.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="py-14 text-center text-[#863221]">
                        <div className="flex flex-col items-center justify-center space-y-2">
                          <FileSpreadsheet className="w-10 h-10 text-[#863221]/40" />
                          <p className="text-base font-bold text-[#180200]">No collection records found</p>
                          <p className="text-xs text-[#863221] max-w-sm mx-auto">
                            No receipts match the selected financial year or category filter.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedFYRows.map((r) => (
                      <tr
                        key={`${r.receipt_id}-${r.member_id || 'unassigned'}`}
                        className="transition-colors bg-white hover:bg-[#FAF7F2] text-[#180200]"
                      >
                        {/* Column 1: Receipt Number */}
                        <td className="py-3.5 px-4 font-mono font-bold text-xs">
                          <span className="text-[#510601] tracking-wider">{r.receipt_number || '—'}</span>
                        </td>

                        {/* Column 2: Date */}
                        <td className="py-3.5 px-4 font-mono text-xs whitespace-nowrap text-[#180200]">
                          {formatDate(r.receipt_date)}
                        </td>

                        {/* Column 3: Category Badge */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {r.category === 'NEW_MEMBER' ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#3D705C]/15 text-[#3D705C] border border-[#3D705C]/30">
                              New Admission
                            </span>
                          ) : r.category === 'EXISTING_MEMBER' ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#510601]/10 text-[#510601] border border-[#510601]/25">
                              Existing Member
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#EE6A00]/15 text-[#EE6A00] border border-[#EE6A00]/30">
                              Unassigned
                            </span>
                          )}
                        </td>

                        {/* Column 4: Member Details */}
                        <td className="py-3.5 px-4">
                          <div>
                            <span className="font-bold text-[#180200]">{r.member_name || '—'}</span>
                            {r.full_name_kn && (
                              <span className="text-[11px] text-[#863221] ml-1.5 font-medium">({r.full_name_kn})</span>
                            )}
                            {(r.membership_number !== '—' || r.mobile !== '—') && (
                              <div className="text-[11px] font-mono text-[#863221] mt-0.5">
                                {[r.membership_number !== '—' ? r.membership_number : '', r.mobile !== '—' ? r.mobile : ''].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Column 5: Particulars */}
                        <td className="py-3.5 px-4 text-xs font-semibold text-[#510601] max-w-[240px] truncate" title={r.particulars}>
                          {r.particulars || '—'}
                        </td>

                        {/* Column 6: Payment Mode & Ref */}
                        <td className="py-3.5 px-4 text-xs">
                          <div className="font-medium text-[#180200]">{r.payment_mode || '—'}</div>
                          {r.transaction_reference && r.transaction_reference !== '—' && (
                            <div className="text-[10px] text-[#863221] font-mono">Ref: {r.transaction_reference}</div>
                          )}
                        </td>

                        {/* Column 7: Amount */}
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-xs sm:text-sm text-[#180200] whitespace-nowrap">
                          {formatMoney(r.allocated_amount || r.amount || 0)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Standard Pager Component */}
            <div className="px-4 py-3 bg-[#FAF7F2] border-t border-[#E8DFD8]">
              <Pager
                page={fyPage}
                pages={totalFYPages}
                total={fyRows.length}
                pageSize={fyPageSize}
                onPage={setFyPage}
                onPageSize={setFyPageSize}
              />
            </div>
          </div>
        </>
      )}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* SUBVIEW 2: GENERAL RECEIPTS REGISTER (ORIGINAL VIEW)         */}
      {/* ──────────────────────────────────────────────────────────── */}
      {subView === 'register' && (
        <>
          {/* Summary Strip */}
          <div className="flex items-center gap-4 text-xs">
            <div className="bg-white border border-[#E8DFD8] rounded-xl px-4 py-2.5 shadow-2xs">
              <span className="text-[#863221]">Total Count: </span>
              <strong className="text-[#180200] font-mono font-bold ml-1">{rows.length}</strong>
            </div>
            <div className="bg-white border border-[#E8DFD8] rounded-xl px-4 py-2.5 shadow-2xs">
              <span className="text-[#863221]">Total Collections: </span>
              <strong className="text-[#510601] font-mono font-bold ml-1">{formatMoney(totalRegisterAmount)}</strong>
            </div>
          </div>

          {/* Standard SearchFilterBar for Register */}
          <SearchFilterBar
            activeFiltersCount={
              (fromDate || toDate ? 1 : 0) +
              (paymentMode !== 'ALL' ? 1 : 0) +
              (particularId !== 'ALL' ? 1 : 0)
            }
            onResetFilters={() => {
              setFromDate('');
              setToDate('');
              setPaymentMode('ALL');
              setParticularId('ALL');
            }}
            leftSlot={subViewSwitcher}
            rightSlot={
              <>
                <button
                  type="button"
                  onClick={() => handleExportRegister('csv')}
                  disabled={rows.length === 0}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#510601] bg-white border border-[#E8DFD8] rounded-xl hover:bg-[#FAF7F2] cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  <span>Export CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportRegister('excel')}
                  disabled={rows.length === 0}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#510601] rounded-xl hover:bg-[#3D0400] cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Export Excel</span>
                </button>
              </>
            }
          >
            <div>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                title="From date"
                placeholder="From Date"
                className="px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                title="To date"
                placeholder="To Date"
                className="px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <FilterSelect
              value={paymentMode}
              onChange={setPaymentMode}
              options={[
                { value: 'ALL', label: 'All Payment Modes' },
                { value: 'CASH', label: 'Cash' },
                { value: 'CHEQUE', label: 'Cheque' },
                { value: 'DD', label: 'Demand Draft (D.D.)' },
                { value: 'UPI', label: 'UPI' },
                { value: 'BANK_TRANSFER', label: 'Bank Transfer (NEFT/RTGS)' },
              ]}
              widthClass="w-full sm:w-48"
            />
            <FilterSelect
              value={particularId}
              onChange={setParticularId}
              options={[
                { value: 'ALL', label: 'All Particulars' },
                ...particulars.map((p) => ({ value: String(p.id), label: p.name_en || p.name })),
              ]}
              widthClass="w-full sm:w-52"
            />
          </SearchFilterBar>

          {/* Standard Table matching ReceiptTracking */}
          <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-bold text-[#863221] uppercase tracking-wider">
                    <th className="py-3.5 px-4 whitespace-nowrap">Receipt No.</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Date</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Payee / Member</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Payment Mode</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Bank Account</th>
                    <th className="py-3.5 px-4 text-right whitespace-nowrap">Net Amount</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8DFD8] text-xs sm:text-sm">
                  {loading ? (
                    <tr>
                      <td colSpan="7" className="py-14 text-center text-[#863221]">
                        <div className="flex flex-col items-center justify-center space-y-2">
                          <RefreshCw className="w-8 h-8 animate-spin text-[#8C1801]" />
                          <p className="text-sm font-semibold text-[#180200]">Loading receipts...</p>
                        </div>
                      </td>
                    </tr>
                  ) : paginatedRegisterRows.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="py-14 text-center text-[#863221]">
                        <div className="flex flex-col items-center justify-center space-y-2">
                          <FileSpreadsheet className="w-10 h-10 text-[#863221]/40" />
                          <p className="text-base font-bold text-[#180200]">No receipt transactions match the selected filters</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedRegisterRows.map((r, i) => (
                      <tr key={i} className="transition-colors bg-white hover:bg-[#FAF7F2] text-[#180200]">
                        <td className="py-3.5 px-4 font-mono font-bold text-xs text-[#510601]">{r.receipt_number || '—'}</td>
                        <td className="py-3.5 px-4 font-mono text-xs whitespace-nowrap text-[#180200]">{formatDate(r.receipt_date) || '—'}</td>
                        <td className="py-3.5 px-4 font-bold text-[#180200]">{r.received_from || r.member_name || '—'}</td>
                        <td className="py-3.5 px-4 text-xs text-[#180200]">{r.payment_mode || '—'}</td>
                        <td className="py-3.5 px-4 text-xs text-[#863221]">{r.bank_account || '—'}</td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-xs sm:text-sm text-[#180200]">
                          {formatMoney(r.net_amount || 0)}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            r.status === 'ACTIVE' || r.status === 'PAID'
                              ? 'bg-[#3D705C]/15 text-[#3D705C] border border-[#3D705C]/30'
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

            {/* Standard Pager Component */}
            <div className="px-4 py-3 bg-[#FAF7F2] border-t border-[#E8DFD8]">
              <Pager
                page={page}
                pages={totalRegisterPages}
                total={rows.length}
                pageSize={pageSize}
                onPage={setPage}
                onPageSize={setPageSize}
              />
            </div>
          </div>
        </>
      )}
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
  const [pageSize, setPageSize] = useState(25);

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
  }, [rows, page, pageSize]);

  const totalPages = Math.ceil(rows.length / pageSize) || 1;

  const activeFiltersCount = [
    issueMonth,
    subType === 'returns' ? returnReason : '',
    subType === 'returns' ? followUpStatus : '',
  ].filter(Boolean).length;

  const handleResetFilters = () => {
    setIssueMonth('');
    setReturnReason('');
    setFollowUpStatus('');
  };

  // Sub-type Switcher component
  const subTypeSwitcher = (
    <div className="inline-flex rounded-xl border border-[#E8DFD8] bg-[#FAF7F2] p-1 shadow-2xs">
      <button
        type="button"
        onClick={() => {
          setSubType('returns');
          setPage(1);
        }}
        className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
          subType === 'returns'
            ? 'bg-[#510601] text-white shadow-2xs'
            : 'text-[#863221] hover:text-[#510601] hover:bg-white/60'
        }`}
      >
        Magazine Returns
      </button>
      <button
        type="button"
        onClick={() => {
          setSubType('labels');
          setPage(1);
        }}
        className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
          subType === 'labels'
            ? 'bg-[#510601] text-white shadow-2xs'
            : 'text-[#863221] hover:text-[#510601] hover:bg-white/60'
        }`}
      >
        Label Batches
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Standard SearchFilterBar Toolbar matching ReceiptTracking */}
      <SearchFilterBar
        activeFiltersCount={activeFiltersCount}
        onResetFilters={handleResetFilters}
        leftSlot={subTypeSwitcher}
        rightSlot={
          <>
            <button
              type="button"
              onClick={() => handleExport('csv')}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#510601] bg-white border border-[#E8DFD8] rounded-xl hover:bg-[#FAF7F2] cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={() => handleExport('excel')}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#510601] rounded-xl hover:bg-[#3D0400] cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Export Excel</span>
            </button>
          </>
        }
      >
        {/* Issue Month */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[#863221] uppercase">Month:</span>
          <input
            type="month"
            value={issueMonth}
            onChange={(e) => setIssueMonth(e.target.value)}
            className="px-3 py-1.5 text-xs bg-[#FAF7F2]/60 hover:bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601] transition-colors"
          />
        </div>

        {subType === 'returns' && (
          <>
            <FilterSelect
              value={returnReason}
              onChange={setReturnReason}
              options={[
                { value: '', label: 'All Return Reasons' },
                { value: 'ADDRESS_NOT_FOUND', label: 'Address Not Found' },
                { value: 'MOVED', label: 'Recipient Moved' },
                { value: 'REFUSED', label: 'Delivery Refused' },
                { value: 'DECEASED', label: 'Deceased' },
                { value: 'UNCLAIMED', label: 'Unclaimed / Other' },
              ]}
              widthClass="w-full sm:w-52"
            />
            <FilterSelect
              value={followUpStatus}
              onChange={setFollowUpStatus}
              options={[
                { value: '', label: 'All Follow-up States' },
                { value: 'PENDING', label: 'Pending Action' },
                { value: 'CONTACTED', label: 'Contacted Recipient' },
                { value: 'RESOLVED', label: 'Resolved / Updated' },
              ]}
              widthClass="w-full sm:w-48"
            />
          </>
        )}
      </SearchFilterBar>

      {/* Standard HMS Table matching ReceiptTracking */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          {subType === 'returns' ? (
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-bold text-[#863221] uppercase tracking-wider">
                  <th className="py-3.5 px-4 whitespace-nowrap">Issue Month</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Member / Recipient</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Return Reason</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Return Date</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Follow-up Status</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Action Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8] text-xs sm:text-sm">
                {loading ? (
                  <tr>
                    <td colSpan="6" className="py-14 text-center text-[#863221]">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <RefreshCw className="w-8 h-8 animate-spin text-[#8C1801]" />
                        <p className="text-sm font-semibold text-[#180200]">Loading magazine returns...</p>
                      </div>
                    </td>
                  </tr>
                ) : paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="py-14 text-center text-[#863221]">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <BookOpen className="w-10 h-10 text-[#863221]/40" />
                        <p className="text-base font-bold text-[#180200]">No magazine returns recorded matching the criteria</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((r, i) => (
                    <tr key={i} className="transition-colors bg-white hover:bg-[#FAF7F2] text-[#180200]">
                      <td className="py-3.5 px-4 font-mono font-bold text-xs text-[#510601]">{r.issue_month_year || '—'}</td>
                      <td className="py-3.5 px-4 font-bold text-[#180200]">{r.member_name || r.name || '—'}</td>
                      <td className="py-3.5 px-4 font-semibold text-[#8C1801]">{r.reason || '—'}</td>
                      <td className="py-3.5 px-4 font-mono text-xs">{formatDate(r.return_date) || '—'}</td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          r.follow_up_status === 'RESOLVED'
                            ? 'bg-[#3D705C]/15 text-[#3D705C] border border-[#3D705C]/30'
                            : r.follow_up_status === 'CONTACTED'
                            ? 'bg-[#510601]/10 text-[#510601] border border-[#510601]/25'
                            : 'bg-[#EE6A00]/15 text-[#EE6A00] border border-[#EE6A00]/30'
                        }`}>
                          {r.follow_up_status || 'PENDING'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-[#863221]">{r.action_notes || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-bold text-[#863221] uppercase tracking-wider">
                  <th className="py-3.5 px-4 whitespace-nowrap">Batch Name</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Issue Month</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Generated Date</th>
                  <th className="py-3.5 px-4 text-right whitespace-nowrap">Total Labels</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8] text-xs sm:text-sm">
                {loading ? (
                  <tr>
                    <td colSpan="5" className="py-14 text-center text-[#863221]">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <RefreshCw className="w-8 h-8 animate-spin text-[#8C1801]" />
                        <p className="text-sm font-semibold text-[#180200]">Loading label batches...</p>
                      </div>
                    </td>
                  </tr>
                ) : paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-14 text-center text-[#863221]">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <BookOpen className="w-10 h-10 text-[#863221]/40" />
                        <p className="text-base font-bold text-[#180200]">No label batches recorded matching the criteria</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((r, i) => (
                    <tr key={i} className="transition-colors bg-white hover:bg-[#FAF7F2] text-[#180200]">
                      <td className="py-3.5 px-4 font-bold text-[#180200]">{r.batch_name || `Batch ${r.id}`}</td>
                      <td className="py-3.5 px-4 font-mono text-xs text-[#863221]">{r.issue_month_year || '—'}</td>
                      <td className="py-3.5 px-4 font-mono text-xs">{formatDate(r.generation_date || r.created_at) || '—'}</td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-xs sm:text-sm text-[#510601]">
                        {Number(r.total_labels || r.count || 0).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#3D705C]/15 text-[#3D705C] border border-[#3D705C]/30">
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

        {/* Standard Pager Component */}
        <div className="px-4 py-3 bg-[#FAF7F2] border-t border-[#E8DFD8]">
          <Pager
            page={page}
            pages={totalPages}
            total={rows.length}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={setPageSize}
          />
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
    <div className="space-y-6">
      {/* Subtab selection & Refresh */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex rounded-xl border border-[#E8DFD8] bg-[#FAF7F2] p-1 shadow-2xs">
          <button
            type="button"
            onClick={() => setSubTab('saved')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              subTab === 'saved'
                ? 'bg-[#510601] text-white shadow-2xs'
                : 'text-[#863221] hover:text-[#510601] hover:bg-white/60'
            }`}
          >
            Saved Report Presets
          </button>
          <button
            type="button"
            onClick={() => setSubTab('logs')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              subTab === 'logs'
                ? 'bg-[#510601] text-white shadow-2xs'
                : 'text-[#863221] hover:text-[#510601] hover:bg-white/60'
            }`}
          >
            Export Audit Trail
          </button>
        </div>

        <button
          type="button"
          onClick={loadData}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#510601] bg-white border border-[#E8DFD8] rounded-xl hover:bg-[#FAF7F2] cursor-pointer shadow-2xs transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {subTab === 'saved' ? (
        <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-bold text-[#863221] uppercase tracking-wider">
                  <th className="py-3.5 px-4 whitespace-nowrap">Report Name</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Module / Type</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Saved Filters</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Created At</th>
                  <th className="py-3.5 px-4 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8] text-xs sm:text-sm">
                {loading ? (
                  <tr>
                    <td colSpan="5" className="py-14 text-center text-[#863221]">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <RefreshCw className="w-8 h-8 animate-spin text-[#8C1801]" />
                        <p className="text-sm font-semibold text-[#180200]">Loading saved reports...</p>
                      </div>
                    </td>
                  </tr>
                ) : savedReports.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-14 text-center text-[#863221]">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <History className="w-10 h-10 text-[#863221]/40" />
                        <p className="text-base font-bold text-[#180200]">No saved report presets found</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  savedReports.map((r) => (
                    <tr key={r.id} className="transition-colors bg-white hover:bg-[#FAF7F2] text-[#180200]">
                      <td className="py-3.5 px-4 font-bold text-[#180200]">{r.report_name}</td>
                      <td className="py-3.5 px-4 font-mono text-xs text-[#510601] uppercase">{r.report_key}</td>
                      <td className="py-3.5 px-4 text-[#863221] font-mono text-[11px]">
                        {JSON.stringify(r.filters || {})}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs">{formatDate(r.created_at)}</td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {canSave && (
                            <button
                              type="button"
                              onClick={() => handleDeleteSaved(r.id)}
                              className="p-1.5 text-[#863221] hover:text-red-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              title="Delete Saved Report"
                            >
                              <Trash2 className="w-4 h-4" />
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
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-xs font-bold text-[#863221] uppercase tracking-wider">
                  <th className="py-3.5 px-4 whitespace-nowrap">Export Timestamp</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Report Type</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Format</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Exported By</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Filters Applied</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8] text-xs sm:text-sm">
                {loading ? (
                  <tr>
                    <td colSpan="5" className="py-14 text-center text-[#863221]">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <RefreshCw className="w-8 h-8 animate-spin text-[#8C1801]" />
                        <p className="text-sm font-semibold text-[#180200]">Loading export logs...</p>
                      </div>
                    </td>
                  </tr>
                ) : exportLogs.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-14 text-center text-[#863221]">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <History className="w-10 h-10 text-[#863221]/40" />
                        <p className="text-base font-bold text-[#180200]">No export audit logs recorded yet</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  exportLogs.map((l) => (
                    <tr key={l.id} className="transition-colors bg-white hover:bg-[#FAF7F2] text-[#180200]">
                      <td className="py-3.5 px-4 font-mono text-xs">{formatDate(l.exported_at)}</td>
                      <td className="py-3.5 px-4 font-bold text-[#510601] uppercase">{l.report_key}</td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-[#FAF7F2] border border-[#E8DFD8] text-[#863221] uppercase font-mono">
                          {l.format}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-[#180200] font-medium">{l.user_name || l.exported_by || 'Staff'}</td>
                      <td className="py-3.5 px-4 text-[#863221] font-mono text-[11px]">
                        {JSON.stringify(l.filters || {})}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
