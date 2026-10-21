import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import PageActions, { PageActionsSlot } from '../components/PageActions';
import PageTitle from '../components/PageTitle';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
import Pager from '../components/Pager';
import {
  Bell,
  MessageSquare,
  Send,
  Inbox,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Eye,
  Mail,
  Smartphone,
} from 'lucide-react';
import api from '../api';
import useAuth from '../hooks/useAuth';
import Modal from '../components/Modal';
import ModalFooter from '../components/ModalFooter';
import { formatDate } from '../utils/dateUtils';
import { notify } from '../utils/notify';
import { memberName } from '../utils/memberName';
import { loadLocations, loadMembershipTypes } from '../utils/serverData';

const TABS = [
  { key: 'campaigns', label: 'Send Messages', icon: Send },
  { key: 'templates', label: 'Message Templates', icon: MessageSquare },
  { key: 'inbox', label: 'System Inbox', icon: Inbox },
];

const CHANNELS = [
  { key: 'WHATSAPP', label: 'WhatsApp', icon: Smartphone, color: 'text-[#3D705C] bg-emerald-50 border-emerald-200' },
  { key: 'SMS', label: 'SMS', icon: MessageSquare, color: 'text-blue-700 bg-blue-50 border-blue-200' },
  { key: 'EMAIL', label: 'Email', icon: Mail, color: 'text-purple-700 bg-purple-50 border-purple-200' },
];

const PURPOSES = [
  { key: 'GENERAL', label: 'General Announcement' },
  { key: 'MEMBERSHIP_EXPIRY', label: 'Membership Expiry Reminder' },
  { key: 'RECEIPT_ACK', label: 'Receipt Acknowledgment' },
  { key: 'EVENT_INVITATION', label: 'Event Invitation' },
  { key: 'WELCOME', label: 'Welcome New Member' },
];

export default function NotificationsManagement() {
  const { hasPermission } = useAuth();

  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const activeTab = useMemo(() => {
    const p = location.pathname.toLowerCase();
    if (p.includes('/templates')) return 'templates';
    if (p.includes('/inbox')) return 'inbox';
    if (p.includes('/campaigns')) return 'campaigns';
    return searchParams.get('tab') || 'campaigns';
  }, [location.pathname, searchParams]);

  // each section has its own privileges
  const area = { campaigns: 'notifications.campaigns', templates: 'notifications.message_templates', inbox: 'notifications.inbox' }[activeTab] || 'notifications.campaigns';
  const canWrite = hasPermission(`${area}.write`);
  const canDelete = hasPermission(`${area}.delete`);

  const setTab = (t) => {
    navigate(`/dashboard/notifications/${t}`);
  };

  // Shared Reference Data
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
        console.error('Failed to load locations or types.', err);
      }
    })();
  }, []);

  return (
    <div className="space-y-6 pb-16">
      {/* Dynamic Page Title in Header Bar */}
      <PageTitle>{TABS.find((t) => t.key === activeTab)?.label || 'Notifications'}</PageTitle>

      {/* Action Toolbar slot for title bar */}
      <div className="flex justify-end -mb-2">
        <PageActionsSlot />
      </div>

      {/* Top Module Tab Switcher */}
      <div className="bg-[#FAF7F2] p-1.5 rounded-2xl border border-[#E8DFD8] flex flex-wrap gap-1 shadow-sm">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                isActive
                  ? 'bg-[#510601] text-white shadow-sm'
                  : 'text-[#863221] hover:bg-white hover:text-[#510601]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Views */}
      {activeTab === 'campaigns' && (
        <CampaignsTab
          canWrite={canWrite}
          canDelete={canDelete}
          districts={districts}
          taluks={taluks}
          membershipTypes={membershipTypes}
        />
      )}

      {activeTab === 'templates' && (
        <TemplatesTab
          canWrite={canWrite}
          canDelete={canDelete}
        />
      )}

      {activeTab === 'inbox' && (
        <InboxTab
          canWrite={canWrite}
        />
      )}
    </div>
  );
}

// ==============================================================
// 1. CAMPAIGNS TAB
// ==============================================================
function CampaignsTab({ canWrite, canDelete, districts, taluks, membershipTypes }) {
  const [quickSendOpen, setQuickSendOpen] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [csvFile, setCsvFile] = useState(null);

  // Filter & Search & Pagination states
  const [searchQuery, setSearchQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Campaign Form State
  const [formData, setFormData] = useState({
    campaign_name: '',
    channel: 'WHATSAPP',
    template_id: '',
    target_audience: 'ALL_APPROVED',
    district_id: '',
    taluk_id: '',
    membership_type_id: '',
  });

  // Recipients view modal
  const [recipientsModalOpen, setRecipientsModalOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/notifications/campaigns');
      setCampaigns(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch (err) {
      console.error('Failed to load campaigns.', err);
      notify('Failed to load campaigns.', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      // only provider-approved templates can be sent
      const res = await api.get('/notifications/templates', { params: { limit: 100, approval_status: 'APPROVED' } });
      setTemplates(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch (_) {}
  }, []);

  useEffect(() => {
    loadCampaigns();
    loadTemplates();
  }, [loadCampaigns, loadTemplates]);

  const handleCreateCampaign = async () => {
    if (!formData.campaign_name.trim()) {
      notify('Campaign name is required.', 'error');
      return;
    }
    if (!formData.template_id) {
      notify('Please select a message template.', 'error');
      return;
    }

    try {
      if (formData.target_audience === 'CSV') {
        if (!csvFile) {
          notify('Choose the CSV file with a "mobile" column.', 'error');
          return;
        }
        const body = new FormData();
        body.append('file', csvFile);
        await api.post('/notifications/campaigns/csv', body, {
          params: { campaign_name: formData.campaign_name.trim(), template_id: Number(formData.template_id) },
        });
        notify('Campaign created from the CSV. Press Send on it to dispatch.', 'success');
        setCsvFile(null);
        setModalOpen(false);
        loadCampaigns();
        return;
      }
      const filters = {};
      if (formData.district_id) filters.district_id = Number(formData.district_id);
      if (formData.taluk_id) filters.taluk_id = Number(formData.taluk_id);
      if (formData.membership_type_id) filters.membership_type_id = Number(formData.membership_type_id);
      if (formData.target_audience === 'ALL_APPROVED') filters.approval_status = 'APPROVED';
      else if (formData.target_audience === 'UNAPPROVED') filters.approval_status = 'UNAPPROVED';

      const payload = {
        campaign_name: formData.campaign_name.trim(),
        channel: formData.channel,
        template_id: Number(formData.template_id),
        member_filters: filters,
        filters,
      };

      await api.post('/notifications/campaigns', payload);
      notify('Campaign created successfully.', 'success');
      setModalOpen(false);
      loadCampaigns();
    } catch (err) {
      console.error('Failed to create campaign:', err);
      notify(err.response?.data?.detail || 'Failed to create campaign.', 'error');
    }
  };

  const handleSendCampaign = async (id) => {
    if (!window.confirm('Dispatch this campaign now to all matched recipients?')) return;
    try {
      const res = await api.post(`/notifications/campaigns/${id}/send`);
      notify(res.data?.message || 'Campaign dispatch started.', 'success');
      loadCampaigns();
    } catch (err) {
      console.error('Failed to send campaign:', err);
      notify(err.response?.data?.detail || 'Failed to send campaign.', 'error');
    }
  };

  const handleDeleteCampaign = async (id) => {
    if (!window.confirm('Delete this campaign?')) return;
    try {
      await api.delete(`/notifications/campaigns/${id}`);
      notify('Campaign deleted.', 'success');
      loadCampaigns();
    } catch (err) {
      notify('Failed to delete campaign.', 'error');
    }
  };

  const openRecipients = async (campaign) => {
    setSelectedCampaign(campaign);
    setRecipientsModalOpen(true);
    setLoadingRecipients(true);
    try {
      const res = await api.get(`/notifications/campaigns/${campaign.id}/recipients`);
      setRecipients(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch (err) {
      console.error('Failed to load campaign recipients:', err);
    } finally {
      setLoadingRecipients(false);
    }
  };

  // Filtered campaigns
  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((c) => {
      if (channelFilter !== 'ALL' && c.channel !== channelFilter) return false;
      if (statusFilter !== 'ALL' && (c.status || 'DRAFT') !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const name = (c.campaign_name || '').toLowerCase();
        const tname = (c.template_name || '').toLowerCase();
        if (!name.includes(q) && !tname.includes(q)) return false;
      }
      return true;
    });
  }, [campaigns, channelFilter, statusFilter, searchQuery]);

  const activeFiltersCount = (channelFilter !== 'ALL' ? 1 : 0) + (statusFilter !== 'ALL' ? 1 : 0);

  const resetFilters = () => {
    setChannelFilter('ALL');
    setStatusFilter('ALL');
    setSearchQuery('');
    setPage(1);
  };

  const total = filteredCampaigns.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const paginatedCampaigns = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredCampaigns.slice(start, start + pageSize);
  }, [filteredCampaigns, page, pageSize]);

  return (
    <div className="space-y-4">
      {/* Search & Filter Toolbar */}
      <SearchFilterBar
        searchQuery={searchQuery}
        onSearchChange={(q) => { setSearchQuery(q); setPage(1); }}
        searchPlaceholder="Search campaigns by name or template..."
        activeFiltersCount={activeFiltersCount}
        onResetFilters={resetFilters}
        rightSlot={
          <div className="flex items-center gap-2">
            <button
              onClick={loadCampaigns}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#863221] bg-white border border-[#E8DFD8] rounded-xl hover:bg-[#FAF7F2] cursor-pointer shadow-xs transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
            {canWrite && (
              <>
                <button
                  type="button"
                  onClick={() => setQuickSendOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#510601] bg-white border border-[#E8DFD8] rounded-xl hover:bg-[#FAF7F2] cursor-pointer shadow-xs transition-colors"
                >
                  <Smartphone className="w-4 h-4" />
                  <span>Quick Send</span>
                </button>
                <button
                  onClick={() => {
                    setFormData({
                      campaign_name: '',
                      channel: 'WHATSAPP',
                      template_id: templates[0]?.id ? String(templates[0].id) : '',
                      target_audience: 'ALL_APPROVED',
                      district_id: '',
                      taluk_id: '',
                      membership_type_id: '',
                    });
                    setModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#510601] rounded-xl hover:bg-[#3D0400] cursor-pointer shadow-sm transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Campaign</span>
                </button>
              </>
            )}
          </div>
        }
      >
        <FilterSelect
          value={channelFilter}
          onChange={(v) => { setChannelFilter(v); setPage(1); }}
          placeholder="All Channels"
          options={[
            { value: 'ALL', label: 'All Channels' },
            { value: 'WHATSAPP', label: 'WhatsApp' },
            { value: 'SMS', label: 'SMS' },
            { value: 'EMAIL', label: 'Email' },
          ]}
        />
        <FilterSelect
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v); setPage(1); }}
          placeholder="All Statuses"
          options={[
            { value: 'ALL', label: 'All Statuses' },
            { value: 'DRAFT', label: 'Draft' },
            { value: 'SENDING', label: 'Sending' },
            { value: 'SENT', label: 'Sent' },
            { value: 'FAILED', label: 'Failed' },
          ]}
        />
      </SearchFilterBar>

      {/* Campaigns Table Card */}
      <div className="bg-white border border-[#E8DFD8] rounded-2xl shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Campaign Name</th>
                <th className="py-3 px-4">Channel</th>
                <th className="py-3 px-4">Template</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Created Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8]">
              {loading ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-[#863221]">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#510601]" />
                    Loading campaigns...
                  </td>
                </tr>
              ) : paginatedCampaigns.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-[#863221]/70">
                    No broadcast campaigns match the specified criteria.
                  </td>
                </tr>
              ) : (
                paginatedCampaigns.map((c) => {
                  const ch = CHANNELS.find((x) => x.key === c.channel) || CHANNELS[0];
                  return (
                    <tr key={c.id} className="hover:bg-[#FAF7F2]/50 transition-colors">
                      <td className="py-3 px-4 font-semibold text-[#180200]">{c.campaign_name}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${ch.color}`}>
                          {ch.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[#863221]">{c.template_name || `Template ${c.template_id}`}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          c.status === 'SENT'
                            ? 'bg-emerald-50 text-[#3D705C] border border-emerald-200'
                            : c.status === 'SENDING' || c.status === 'PARTIAL'
                            ? 'bg-amber-50 text-[#EE6A00] border border-amber-200'
                            : c.status === 'FAILED'
                            ? 'bg-rose-50 text-[#8C1801] border border-rose-200'
                            : 'bg-[#FAF7F2] text-[#863221] border border-[#E8DFD8]'
                        }`}>
                          {c.status || 'DRAFT'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[#863221]">{formatDate(c.created_at)}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openRecipients(c)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-[#863221] bg-[#FAF7F2] hover:bg-[#E8DFD8] border border-[#E8DFD8] rounded-lg transition-colors cursor-pointer font-medium"
                            title="View Recipients"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Recipients</span>
                          </button>
                          {canWrite && c.status !== 'SENT' && (
                            <button
                              onClick={() => handleSendCampaign(c.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-white bg-[#510601] hover:bg-[#3D0400] rounded-lg transition-colors cursor-pointer font-semibold shadow-xs"
                              title="Send Now"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>Send</span>
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => handleDeleteCampaign(c.id)}
                              className="p-1.5 text-[#863221]/60 hover:text-[#8C1801] rounded-lg transition-colors cursor-pointer hover:bg-rose-50"
                              title="Delete Campaign"
                            >
                              <Trash2 className="w-4 h-4" />
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

        {total > 0 && (
          <div className="p-4 border-t border-[#E8DFD8] bg-[#FAF7F2]/30">
            <Pager
              page={page}
              pages={pages}
              total={total}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(s) => { setPageSize(s); setPage(1); }}
            />
          </div>
        )}
      </div>

      <QuickSendModal isOpen={quickSendOpen} onClose={() => setQuickSendOpen(false)} canWrite={canWrite} />

      {/* Create Campaign Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Create Broadcast Campaign"
        footer={
          <ModalFooter
            onCancel={() => setModalOpen(false)}
            onSubmit={handleCreateCampaign}
            submitLabel="Create Campaign"
          />
        }
      >
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#863221] uppercase tracking-wider mb-1">Campaign Name *</label>
            <input
              type="text"
              value={formData.campaign_name}
              onChange={(e) => setFormData({ ...formData, campaign_name: e.target.value })}
              className="w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#863221] uppercase tracking-wider mb-1">Communication Channel</label>
              <select
                value={formData.channel}
                onChange={(e) => setFormData({ ...formData, channel: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] cursor-pointer"
              >
                <option value="WHATSAPP">WhatsApp</option>
                <option value="SMS">SMS</option>
                <option value="EMAIL">Email</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#863221] uppercase tracking-wider mb-1">Message Template *</label>
              <select
                value={formData.template_id}
                onChange={(e) => setFormData({ ...formData, template_id: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] cursor-pointer"
              >
                <option value="">Select a template...</option>
                {templates
                  .filter((t) => t.channel === formData.channel)
                  .map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.purpose})</option>
                  ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#863221] uppercase tracking-wider mb-1">Target Audience</label>
            <select
              value={formData.target_audience}
              onChange={(e) => setFormData({ ...formData, target_audience: e.target.value })}
              className="w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] cursor-pointer"
            >
              <option value="ALL_APPROVED">All Approved Members</option>
              <option value="UNAPPROVED">Unapproved / Pending Applicants</option>
              <option value="ALL">All Registered Records</option>
              <option value="CSV">Upload a CSV of mobile numbers</option>
            </select>
          </div>

          {formData.target_audience === 'CSV' && (
            <div className="bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl p-3 space-y-1">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                className="text-xs"
              />
              <p className="text-[11px] text-[#863221]">
                The first row must have a column named <b>mobile</b>. Any other column, such as name, fills the template tag with the same name. Repeated numbers are sent once.
              </p>
            </div>
          )}

          <div className={`border-t border-[#E8DFD8] pt-3 ${formData.target_audience === 'CSV' ? 'hidden' : ''}`}>
            <span className="block text-xs font-bold text-[#863221] uppercase tracking-wider mb-2">Optional Geographic / Category Filters</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-[#863221]/80 mb-1">District</label>
                <select
                  value={formData.district_id}
                  onChange={(e) => setFormData({ ...formData, district_id: e.target.value, taluk_id: '' })}
                  className="w-full px-2.5 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] cursor-pointer"
                >
                  <option value="">All Districts</option>
                  {districts.map((d) => (
                    <option key={d.id} value={d.id}>{d.name_en || d.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#863221]/80 mb-1">Taluk</label>
                <select
                  value={formData.taluk_id}
                  onChange={(e) => setFormData({ ...formData, taluk_id: e.target.value })}
                  disabled={!formData.district_id}
                  className="w-full px-2.5 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] disabled:opacity-50 cursor-pointer"
                >
                  <option value="">All Taluks</option>
                  {taluks
                    .filter((t) => String(t.district_id) === String(formData.district_id))
                    .map((t) => (
                      <option key={t.id} value={t.id}>{t.name_en || t.name}</option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#863221]/80 mb-1">Membership Type</label>
                <select
                  value={formData.membership_type_id}
                  onChange={(e) => setFormData({ ...formData, membership_type_id: e.target.value })}
                  className="w-full px-2.5 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] cursor-pointer"
                >
                  <option value="">All Types</option>
                  {membershipTypes.map((mt) => (
                    <option key={mt.id} value={mt.id}>{mt.name_en || mt.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* View Recipients Modal */}
      <Modal
        isOpen={recipientsModalOpen}
        onClose={() => setRecipientsModalOpen(false)}
        title={`Campaign Recipients — ${selectedCampaign?.campaign_name || ''}`}
        footer={
          <ModalFooter
            kind="view"
            onCancel={() => setRecipientsModalOpen(false)}
          />
        }
      >
        <div className="p-6 space-y-3">
          <div className="overflow-x-auto max-h-80 overflow-y-auto rounded-xl border border-[#E8DFD8]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-2.5 px-3">Recipient Name</th>
                  <th className="py-2.5 px-3">Destination</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {loadingRecipients ? (
                  <tr>
                    <td colSpan="3" className="py-8 text-center text-[#863221]">Loading recipients...</td>
                  </tr>
                ) : recipients.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="py-8 text-center text-[#863221]/70">No recipients queued or recorded.</td>
                  </tr>
                ) : (
                  recipients.map((r, i) => (
                    <tr key={i} className="hover:bg-[#FAF7F2]/50 transition-colors">
                      <td className="py-2.5 px-3 font-medium text-[#180200]">{r.name || r.recipient_name || 'Member'}</td>
                      <td className="py-2.5 px-3 text-[#863221]">{r.destination || r.mobile || r.email || '—'}</td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          r.status === 'SENT'
                            ? 'bg-emerald-50 text-[#3D705C] border border-emerald-200'
                            : r.status === 'FAILED'
                            ? 'bg-rose-50 text-[#8C1801] border border-rose-200'
                            : 'bg-[#FAF7F2] text-[#863221] border border-[#E8DFD8]'
                        }`}>
                          {r.status || 'PENDING'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ==============================================================
// 2. TEMPLATES TAB
// ==============================================================
function TemplatesTab({ canWrite, canDelete }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState('ALL');
  const [purposeFilter, setPurposeFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [formData, setFormData] = useState({
    name: '',
    code: '',
    channel: 'WHATSAPP',
    purpose: 'GENERAL',
    subject: '',
    body: '',
    language: 'kn',
  });

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/notifications/templates', { params: { limit: 100 } });
      setTemplates(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch (err) {
      console.error('Failed to load templates:', err);
      notify('Failed to load templates.', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleSaveTemplate = async () => {
    if (!formData.name.trim() || !formData.code.trim() || !formData.body.trim()) {
      notify('Template Name, Code, and Body are required.', 'error');
      return;
    }

    try {
      const payload = {
        name: formData.name.trim(),
        code: formData.code.trim().toUpperCase(),
        channel: formData.channel,
        purpose: formData.purpose,
        subject: formData.subject.trim() || undefined,
        body: formData.body,
        language: formData.language,
      };

      if (editingTemplate) {
        await api.put(`/notifications/templates/${editingTemplate.id}`, payload);
        notify('Template updated successfully.', 'success');
      } else {
        await api.post('/notifications/templates', payload);
        notify('Template created successfully.', 'success');
      }
      setModalOpen(false);
      loadTemplates();
    } catch (err) {
      console.error('Failed to save template:', err);
      notify(err.response?.data?.detail || 'Failed to save template.', 'error');
    }
  };

  const handleDeleteTemplate = async (id) => {
    if (!window.confirm('Delete this template?')) return;
    try {
      await api.delete(`/notifications/templates/${id}`);
      notify('Template deleted.', 'success');
      loadTemplates();
    } catch (err) {
      notify('Failed to delete template.', 'error');
    }
  };

  const insertVariable = (variable) => {
    setFormData((prev) => ({
      ...prev,
      body: prev.body + ` {{${variable}}} `,
    }));
  };

  // Filtered templates
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (channelFilter !== 'ALL' && t.channel !== channelFilter) return false;
      if (purposeFilter !== 'ALL' && t.purpose !== purposeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const name = (t.name || '').toLowerCase();
        const code = (t.code || '').toLowerCase();
        const body = (t.body || '').toLowerCase();
        if (!name.includes(q) && !code.includes(q) && !body.includes(q)) return false;
      }
      return true;
    });
  }, [templates, channelFilter, purposeFilter, searchQuery]);

  const activeFiltersCount = (channelFilter !== 'ALL' ? 1 : 0) + (purposeFilter !== 'ALL' ? 1 : 0);

  const resetFilters = () => {
    setChannelFilter('ALL');
    setPurposeFilter('ALL');
    setSearchQuery('');
    setPage(1);
  };

  const total = filteredTemplates.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const paginatedTemplates = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredTemplates.slice(start, start + pageSize);
  }, [filteredTemplates, page, pageSize]);

  return (
    <div className="space-y-4">
      {/* Search & Filter Toolbar */}
      <SearchFilterBar
        searchQuery={searchQuery}
        onSearchChange={(q) => { setSearchQuery(q); setPage(1); }}
        searchPlaceholder="Search templates by name, code or content..."
        activeFiltersCount={activeFiltersCount}
        onResetFilters={resetFilters}
        rightSlot={
          <div className="flex items-center gap-2">
            <button
              onClick={loadTemplates}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#863221] bg-white border border-[#E8DFD8] rounded-xl hover:bg-[#FAF7F2] cursor-pointer shadow-xs transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
            {canWrite && (
              <button
                onClick={() => {
                  setEditingTemplate(null);
                  setFormData({
                    name: '',
                    code: '',
                    channel: 'WHATSAPP',
                    purpose: 'GENERAL',
                    subject: '',
                    body: '',
                    language: 'kn',
                  });
                  setModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#510601] rounded-xl hover:bg-[#3D0400] cursor-pointer shadow-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Create Template</span>
              </button>
            )}
          </div>
        }
      >
        <FilterSelect
          value={channelFilter}
          onChange={(v) => { setChannelFilter(v); setPage(1); }}
          placeholder="All Channels"
          options={[
            { value: 'ALL', label: 'All Channels' },
            { value: 'WHATSAPP', label: 'WhatsApp' },
            { value: 'SMS', label: 'SMS' },
            { value: 'EMAIL', label: 'Email' },
          ]}
        />
        <FilterSelect
          value={purposeFilter}
          onChange={(v) => { setPurposeFilter(v); setPage(1); }}
          placeholder="All Purposes"
          options={[
            { value: 'ALL', label: 'All Purposes' },
            ...PURPOSES.map((p) => ({ value: p.key, label: p.label })),
          ]}
        />
      </SearchFilterBar>

      {/* Templates Table Card */}
      <div className="bg-white border border-[#E8DFD8] rounded-2xl shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Template Name</th>
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Channel</th>
                <th className="py-3 px-4">Purpose</th>
                <th className="py-3 px-4">Provider Review</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8]">
              {loading ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-[#863221]">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#510601]" />
                    Loading templates...
                  </td>
                </tr>
              ) : paginatedTemplates.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-[#863221]/70">
                    No message templates found matching criteria.
                  </td>
                </tr>
              ) : (
                paginatedTemplates.map((t) => {
                  const ch = CHANNELS.find((x) => x.key === t.channel) || CHANNELS[0];
                  return (
                    <tr key={t.id} className="hover:bg-[#FAF7F2]/50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[#180200]">{t.name}</div>
                        <div className="text-[11px] text-[#863221] line-clamp-1 max-w-sm mt-0.5">{t.body}</div>
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-[11px] text-[#510601]">{t.code}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${ch.color}`}>
                          {ch.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[#863221]">{t.purpose}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          t.provider_approval_status === 'APPROVED'
                            ? 'bg-emerald-50 text-[#3D705C] border border-emerald-200'
                            : t.provider_approval_status === 'REJECTED'
                            ? 'bg-rose-50 text-[#8C1801] border border-rose-200'
                            : 'bg-[#FAF7F2] text-[#863221] border border-[#E8DFD8]'
                        }`}>
                          {t.provider_approval_status || 'LOCAL'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {canWrite && (
                            <button
                              onClick={() => {
                                setEditingTemplate(t);
                                setFormData({
                                  name: t.name || '',
                                  code: t.code || '',
                                  channel: t.channel || 'WHATSAPP',
                                  purpose: t.purpose || 'GENERAL',
                                  subject: t.subject || '',
                                  body: t.body || '',
                                  language: t.language || 'kn',
                                });
                                setModalOpen(true);
                              }}
                              className="p-1.5 text-[#863221] hover:text-[#510601] hover:bg-[#FAF7F2] rounded-lg transition-colors cursor-pointer"
                              title="Edit Template"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => handleDeleteTemplate(t.id)}
                              className="p-1.5 text-[#863221]/60 hover:text-[#8C1801] hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              title="Delete Template"
                            >
                              <Trash2 className="w-4 h-4" />
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

        {total > 0 && (
          <div className="p-4 border-t border-[#E8DFD8] bg-[#FAF7F2]/30">
            <Pager
              page={page}
              pages={pages}
              total={total}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(s) => { setPageSize(s); setPage(1); }}
            />
          </div>
        )}
      </div>

      {/* Create / Edit Template Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingTemplate ? 'Edit Message Template' : 'Create Message Template'}
        footer={
          <ModalFooter
            kind={editingTemplate ? 'edit' : 'add'}
            onCancel={() => setModalOpen(false)}
            onSubmit={handleSaveTemplate}
            submitLabel={editingTemplate ? 'Update Template' : 'Create Template'}
          />
        }
      >
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#863221] uppercase tracking-wider mb-1">Template Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#863221] uppercase tracking-wider mb-1">Template Code *</label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] font-mono focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#863221] uppercase tracking-wider mb-1">Channel</label>
              <select
                value={formData.channel}
                onChange={(e) => setFormData({ ...formData, channel: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] cursor-pointer"
              >
                <option value="WHATSAPP">WhatsApp</option>
                <option value="SMS">SMS</option>
                <option value="EMAIL">Email</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#863221] uppercase tracking-wider mb-1">Purpose</label>
              <select
                value={formData.purpose}
                onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] cursor-pointer"
              >
                {PURPOSES.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#863221] uppercase tracking-wider mb-1">Language</label>
              <select
                value={formData.language}
                onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] cursor-pointer"
              >
                <option value="kn">Kannada (ಕನ್ನಡ)</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

          {formData.channel === 'EMAIL' && (
            <div>
              <label className="block text-xs font-bold text-[#863221] uppercase tracking-wider mb-1">Email Subject *</label>
              <input
                type="text"
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-[#863221] uppercase tracking-wider">Message Content / Body *</label>
              <div className="flex items-center gap-1.5 text-[11px] text-[#863221]">
                <span>Insert tag:</span>
                {['name', 'member_code', 'mobile'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertVariable(v)}
                    className="px-2 py-0.5 bg-[#FAF7F2] hover:bg-[#E8DFD8] text-[#510601] font-mono font-bold text-[10px] rounded-md border border-[#E8DFD8] cursor-pointer transition-colors"
                  >
                    +{v}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              rows={5}
              value={formData.body}
              onChange={(e) => setFormData({ ...formData, body: e.target.value })}
              
              className="w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ==============================================================
// 3. QUICK SEND (a popup on the Send Messages page)
// ==============================================================
function QuickSendModal({ isOpen, onClose, canWrite }) {
  // Step 1 pick the member, step 2 pick an approved template, step 3 check the preview and send (WhatsApp).
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [member, setMember] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [extra, setExtra] = useState({}); // values for placeholders the member record cannot fill
  const [sending, setSending] = useState(false);

  const STANDARD = ['name', 'full_name_kn', 'member_code', 'mobile'];

  useEffect(() => {
    if (!isOpen) return;
    setQuery(''); setResults([]); setMember(null); setTemplateId(''); setExtra({});
    (async () => {
      try {
        const res = await api.get('/notifications/templates', { params: { limit: 100, approval_status: 'APPROVED' } });
        setTemplates((Array.isArray(res.data) ? res.data : (res.data?.data || [])).filter((t) => t.status !== false));
      } catch (_) { setTemplates([]); }
    })();
  }, [isOpen]);

  const search = async (q) => {
    setQuery(q);
    if (!q || q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await api.get('/members/', { params: { search: q.trim(), limit: 8 } });
      setResults(res.data?.data || res.data || []);
    } catch (_) {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const template = templates.find((t) => String(t.id) === String(templateId));
  const placeholders = template ? [...new Set([...(template.content || '').matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))] : [];
  const askFor = placeholders.filter((p) => !STANDARD.includes(p));
  const values = member ? {
    name: memberName(member) || '',
    full_name_kn: member.full_name_kn || '',
    member_code: member.membership_number || member.member_code || '',
    mobile: member.mobile || '',
    ...extra,
  } : {};
  const preview = template
    ? (template.content || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (values[k] !== undefined && values[k] !== '' ? values[k] : `{{${k}}}`))
    : '';
  const ready = member && member.mobile && template && askFor.every((k) => String(extra[k] || '').trim());

  const handleSend = async (e) => {
    e?.preventDefault?.();
    if (!ready) return;
    setSending(true);
    try {
      await api.post('/notifications/send-individual', askFor.length ? { ...extra } : {}, {
        params: { member_id: member.id, template_id: template.id },
      });
      notify('Message queued for WhatsApp.', 'success');
      onClose();
    } catch (err) {
      if (err.response?.data?.detail) notify(err.response.data.detail, 'error');
    } finally {
      setSending(false);
    }
  };

  const label = 'block text-xs font-bold text-[#863221] uppercase tracking-wider mb-1';
  const field = 'w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Quick Send - WhatsApp message to a member">
      <form onSubmit={handleSend} className="flex-1 flex flex-col justify-between">
        <div className="p-6 space-y-5 flex-1 overflow-y-auto">
          <div>
            <label className={label}>1 · Member *</label>
            {member ? (
              <div className="flex items-center justify-between gap-3 px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs">
                <span className="text-[#180200] font-semibold">
                  {memberName(member) || member.full_name_kn}
                  <span className="font-normal text-[#863221]"> · {member.membership_number || member.member_code || '-'} · {member.mobile || 'no mobile'}</span>
                </span>
                <button type="button" onClick={() => setMember(null)} className="text-[#510601] font-semibold cursor-pointer">Change</button>
              </div>
            ) : (
              <>
                <input type="text" value={query} onChange={(e) => search(e.target.value)} placeholder="Search by name, mobile or membership number" className={field} />
                {searching && <p className="text-[11px] text-[#863221] mt-1">Searching...</p>}
                {results.length > 0 && (
                  <div className="mt-1 border border-[#E8DFD8] rounded-xl divide-y divide-[#E8DFD8] max-h-44 overflow-y-auto">
                    {results.map((m) => (
                      <button key={m.id} type="button" onClick={() => { setMember(m); setResults([]); }} className="w-full text-left px-3 py-2 text-xs hover:bg-[#FAF7F2] cursor-pointer">
                        <span className="font-semibold text-[#180200]">{memberName(m) || m.full_name_kn}</span>
                        <span className="text-[#863221]"> · {m.membership_number || m.member_code || '-'} · {m.mobile || 'no mobile'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {member && !member.mobile && <p className="text-[11px] text-[#ED4636] mt-1">This member has no mobile number, so a message cannot be sent.</p>}
          </div>

          <div>
            <label className={label}>2 · Approved template *</label>
            <select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setExtra({}); }} disabled={!member} className={`${field} cursor-pointer disabled:opacity-50`}>
              <option value="">{member ? 'Choose a template...' : 'Pick the member first'}</option>
              {templates.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </select>
            {templates.length === 0 && <p className="text-[11px] text-[#863221] mt-1">No approved templates yet. Templates must be approved before they can be sent.</p>}
          </div>

          {askFor.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {askFor.map((k) => (
                <div key={k}>
                  <label className={label}>{k.replace(/_/g, ' ')} *</label>
                  <input type="text" value={extra[k] || ''} onChange={(e) => setExtra({ ...extra, [k]: e.target.value })} className={field} />
                </div>
              ))}
            </div>
          )}

          {template && (
            <div>
              <label className={label}>3 · Preview</label>
              <div className="px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs text-[#180200] whitespace-pre-wrap">{preview}</div>
              <p className="text-[11px] text-[#863221] mt-1">Goes to {member?.mobile || '-'} on WhatsApp. For a number that is not a member, use Send Messages.</p>
            </div>
          )}
        </div>
        <ModalFooter onCancel={onClose} busy={sending} disabled={!canWrite || !ready} submitLabel="Send on WhatsApp" />
      </form>
    </Modal>
  );
}

// ==============================================================
// 4. INBOX & BROADCAST ANNOUNCEMENTS TAB
// ==============================================================
function InboxTab({ canWrite }) {
  const [messages, setMessages] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [broadcastModalOpen, setBroadcastModalOpen] = useState(false);
  const [broadcastBody, setBroadcastBody] = useState({ title: '', body: '', priority: 'NORMAL' });

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    try {
      const [inboxRes, countRes] = await Promise.all([
        api.get('/notifications/inbox'),
        api.get('/notifications/inbox/unread-count')
      ]);
      setMessages(Array.isArray(inboxRes.data) ? inboxRes.data : (inboxRes.data?.data || []));
      setUnreadCount(countRes.data?.unread_count || 0);
    } catch (err) {
      console.error('Failed to load inbox:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  const markAsRead = async (id) => {
    try {
      await api.post(`/notifications/inbox/${id}/read`);
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, is_read: true } : m))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (_) {}
  };

  const handleBroadcast = async () => {
    if (!broadcastBody.title.trim() || !broadcastBody.body.trim()) {
      notify('Title and announcement content are required.', 'error');
      return;
    }
    try {
      await api.post('/notifications/inbox/broadcast', {
        title: broadcastBody.title.trim(),
        body: broadcastBody.body.trim(),
        priority: broadcastBody.priority,
      });
      notify('Broadcast announcement dispatched.', 'success');
      setBroadcastModalOpen(false);
      setBroadcastBody({ title: '', body: '', priority: 'NORMAL' });
      loadInbox();
    } catch (err) {
      notify('Failed to broadcast announcement.', 'error');
    }
  };

  // Filtered inbox messages
  const filteredMessages = useMemo(() => {
    return messages.filter((m) => {
      if (priorityFilter !== 'ALL' && (m.priority || 'NORMAL') !== priorityFilter) return false;
      if (statusFilter === 'UNREAD' && m.is_read) return false;
      if (statusFilter === 'READ' && !m.is_read) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const title = (m.title || '').toLowerCase();
        const body = (m.body || m.message || '').toLowerCase();
        if (!title.includes(q) && !body.includes(q)) return false;
      }
      return true;
    });
  }, [messages, priorityFilter, statusFilter, searchQuery]);

  const activeFiltersCount = (priorityFilter !== 'ALL' ? 1 : 0) + (statusFilter !== 'ALL' ? 1 : 0);

  const resetFilters = () => {
    setPriorityFilter('ALL');
    setStatusFilter('ALL');
    setSearchQuery('');
    setPage(1);
  };

  const total = filteredMessages.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const paginatedMessages = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredMessages.slice(start, start + pageSize);
  }, [filteredMessages, page, pageSize]);

  return (
    <div className="space-y-4">
      {/* Search & Filter Toolbar */}
      <SearchFilterBar
        searchQuery={searchQuery}
        onSearchChange={(q) => { setSearchQuery(q); setPage(1); }}
        searchPlaceholder="Search inbox alerts and announcements..."
        activeFiltersCount={activeFiltersCount}
        onResetFilters={resetFilters}
        rightSlot={
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-[#8C1801] text-white">
                {unreadCount} unread
              </span>
            )}
            <button
              onClick={loadInbox}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#863221] bg-white border border-[#E8DFD8] rounded-xl hover:bg-[#FAF7F2] cursor-pointer shadow-xs transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
            {canWrite && (
              <button
                onClick={() => setBroadcastModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#510601] rounded-xl hover:bg-[#3D0400] cursor-pointer shadow-sm transition-colors"
              >
                <Bell className="w-4 h-4" />
                <span>Broadcast Announcement</span>
              </button>
            )}
          </div>
        }
      >
        <FilterSelect
          value={priorityFilter}
          onChange={(v) => { setPriorityFilter(v); setPage(1); }}
          placeholder="All Priorities"
          options={[
            { value: 'ALL', label: 'All Priorities' },
            { value: 'NORMAL', label: 'Normal Priority' },
            { value: 'HIGH', label: 'High / Urgent' },
          ]}
        />
        <FilterSelect
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v); setPage(1); }}
          placeholder="All Read States"
          options={[
            { value: 'ALL', label: 'All Messages' },
            { value: 'UNREAD', label: 'Unread Only' },
            { value: 'READ', label: 'Read Only' },
          ]}
        />
      </SearchFilterBar>

      {/* Messages List Card */}
      <div className="bg-white border border-[#E8DFD8] rounded-2xl shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] divide-y divide-[#E8DFD8] overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-[#863221]">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#510601]" />
            Loading notifications...
          </div>
        ) : paginatedMessages.length === 0 ? (
          <div className="py-12 text-center text-[#863221]/70 text-xs">
            No system notifications or alerts match the filter.
          </div>
        ) : (
          paginatedMessages.map((m) => (
            <div
              key={m.id}
              className={`p-4 flex items-start justify-between gap-4 transition-colors ${
                !m.is_read ? 'bg-[#FAF7F2]/60' : 'hover:bg-[#FAF7F2]/30'
              }`}
            >
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-[#180200]">{m.title || 'Notification'}</h3>
                  {!m.is_read && (
                    <span className="w-2 h-2 rounded-full bg-[#8C1801] shrink-0" />
                  )}
                  {m.priority === 'HIGH' && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-[#8C1801] border border-rose-200">
                      URGENT
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#863221] leading-relaxed">{m.body || m.message}</p>
                <span className="text-[10px] text-[#863221]/60 block">{formatDate(m.created_at)}</span>
              </div>
              {!m.is_read && (
                <button
                  onClick={() => markAsRead(m.id)}
                  className="px-2.5 py-1 text-xs font-semibold text-[#510601] hover:bg-[#FAF7F2] border border-[#E8DFD8] rounded-lg transition-colors cursor-pointer shrink-0"
                >
                  Mark Read
                </button>
              )}
            </div>
          ))
        )}

        {total > 0 && (
          <div className="p-4 bg-[#FAF7F2]/30">
            <Pager
              page={page}
              pages={pages}
              total={total}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(s) => { setPageSize(s); setPage(1); }}
            />
          </div>
        )}
      </div>

      {/* Broadcast Announcement Modal */}
      <Modal
        isOpen={broadcastModalOpen}
        onClose={() => setBroadcastModalOpen(false)}
        title="Broadcast System Announcement"
        footer={
          <ModalFooter
            onCancel={() => setBroadcastModalOpen(false)}
            onSubmit={handleBroadcast}
            submitLabel="Broadcast Now"
          />
        }
      >
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#863221] uppercase tracking-wider mb-1">Title *</label>
            <input
              type="text"
              value={broadcastBody.title}
              onChange={(e) => setBroadcastBody({ ...broadcastBody, title: e.target.value })}
              className="w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#863221] uppercase tracking-wider mb-1">Priority</label>
            <select
              value={broadcastBody.priority}
              onChange={(e) => setBroadcastBody({ ...broadcastBody, priority: e.target.value })}
              className="w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] cursor-pointer"
            >
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High / Urgent</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-[#863221] uppercase tracking-wider mb-1">Announcement Body *</label>
            <textarea
              rows={4}
              value={broadcastBody.body}
              onChange={(e) => setBroadcastBody({ ...broadcastBody, body: e.target.value })}
              className="w-full px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
