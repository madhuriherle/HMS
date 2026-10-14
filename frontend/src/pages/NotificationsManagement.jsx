import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import PageActions, { PageActionsSlot } from '../components/PageActions';
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
import { loadLocations, loadMembershipTypes } from '../utils/serverData';

const TABS = [
  { key: 'campaigns', label: 'Send Messages', icon: Send },
  { key: 'templates', label: 'Message Templates', icon: MessageSquare },
  { key: 'inbox', label: 'System Inbox', icon: Inbox },
];

const CHANNELS = [
  { key: 'WHATSAPP', label: 'WhatsApp', icon: Smartphone, color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
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
  const canWrite = hasPermission('notifications.write');
  const canDelete = hasPermission('notifications.delete');

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
          loadLocations(),
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
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#180200] tracking-tight">
            {TABS.find((t) => t.key === activeTab)?.label || 'Notifications'}
          </h1>
        </div>
        <PageActionsSlot />
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
      const res = await api.get('/notifications/templates', { params: { limit: 100 } });
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

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-xs text-stone-600">
          Broadcast campaigns dispatched across WhatsApp, SMS, or Email
        </div>
        <PageActions>
          <button
            onClick={loadCampaigns}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-700 bg-white border border-[#E8DFD8] rounded-lg hover:bg-stone-50 cursor-pointer shadow-sm transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
          {canWrite && (
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
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#510601] rounded-lg hover:bg-[#3D0400] cursor-pointer shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create Campaign</span>
            </button>
          )}
          {canWrite && (
            <button
              type="button"
              onClick={() => setQuickSendOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#510601] bg-white border border-[#E8DFD8] rounded-lg hover:bg-[#FAF7F2] cursor-pointer shadow-sm transition-colors"
            >
              <Smartphone className="w-4 h-4" />
              <span>Quick Send</span>
            </button>
          )}
        </PageActions>
      </div>

      {/* Campaigns Table */}
      <div className="bg-white border border-[#E8DFD8] rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-stone-700 font-bold">
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
                  <td colSpan="6" className="py-12 text-center text-stone-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#8C1801]" />
                    Loading campaigns...
                  </td>
                </tr>
              ) : campaigns.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-stone-400">
                    No broadcast campaigns created yet.
                  </td>
                </tr>
              ) : (
                campaigns.map((c) => {
                  const ch = CHANNELS.find((x) => x.key === c.channel) || CHANNELS[0];
                  return (
                    <tr key={c.id} className="hover:bg-stone-50">
                      <td className="py-3 px-4 font-semibold text-stone-800">{c.campaign_name}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${ch.color}`}>
                          {ch.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-stone-600">{c.template_name || `Template ${c.template_id}`}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          c.status === 'SENT'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : c.status === 'SENDING' || c.status === 'PARTIAL'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : c.status === 'FAILED'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-stone-100 text-stone-600 border border-stone-200'
                        }`}>
                          {c.status || 'DRAFT'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-stone-600">{formatDate(c.created_at)}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openRecipients(c)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-stone-700 bg-stone-100 hover:bg-stone-200 rounded transition-colors cursor-pointer"
                            title="View Recipients"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Recipients</span>
                          </button>
                          {canWrite && c.status !== 'SENT' && (
                            <button
                              onClick={() => handleSendCampaign(c.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-white bg-[#510601] hover:bg-[#3D0400] rounded transition-colors cursor-pointer font-semibold"
                              title="Send Now"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>Send</span>
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => handleDeleteCampaign(c.id)}
                              className="p-1 text-stone-400 hover:text-red-700 rounded transition-colors cursor-pointer"
                              title="Delete Campaign"
                            >
                              <Trash2 className="w-4 h-4" /><span>Delete</span>
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
            <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Campaign Name *</label>
            <input
              type="text"
              value={formData.campaign_name}
              onChange={(e) => setFormData({ ...formData, campaign_name: e.target.value })}
              placeholder="e.g. Annual General Body Meeting Announcement"
              className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Communication Channel</label>
              <select
                value={formData.channel}
                onChange={(e) => setFormData({ ...formData, channel: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
              >
                <option value="WHATSAPP">WhatsApp</option>
                <option value="SMS">SMS</option>
                <option value="EMAIL">Email</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Message Template *</label>
              <select
                value={formData.template_id}
                onChange={(e) => setFormData({ ...formData, template_id: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
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
            <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Target Audience</label>
            <select
              value={formData.target_audience}
              onChange={(e) => setFormData({ ...formData, target_audience: e.target.value })}
              className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
            >
              <option value="ALL_APPROVED">All Approved Members</option>
              <option value="UNAPPROVED">Unapproved / Pending Applicants</option>
              <option value="ALL">All Registered Records</option>
            </select>
          </div>

          <div className="border-t border-[#E8DFD8] pt-3">
            <span className="block text-xs font-bold text-stone-600 uppercase mb-2">Optional Geographic / Category Filters</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] text-stone-500 mb-1">District</label>
                <select
                  value={formData.district_id}
                  onChange={(e) => setFormData({ ...formData, district_id: e.target.value, taluk_id: '' })}
                  className="w-full px-2 py-1.5 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800"
                >
                  <option value="">All Districts</option>
                  {districts.map((d) => (
                    <option key={d.id} value={d.id}>{d.name_en || d.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-stone-500 mb-1">Taluk</label>
                <select
                  value={formData.taluk_id}
                  onChange={(e) => setFormData({ ...formData, taluk_id: e.target.value })}
                  disabled={!formData.district_id}
                  className="w-full px-2 py-1.5 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 disabled:opacity-50"
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
                <label className="block text-[11px] text-stone-500 mb-1">Membership Type</label>
                <select
                  value={formData.membership_type_id}
                  onChange={(e) => setFormData({ ...formData, membership_type_id: e.target.value })}
                  className="w-full px-2 py-1.5 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800"
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
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-stone-700 font-bold sticky top-0">
                <tr>
                  <th className="py-2 px-3">Recipient Name</th>
                  <th className="py-2 px-3">Destination</th>
                  <th className="py-2 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {loadingRecipients ? (
                  <tr>
                    <td colSpan="3" className="py-8 text-center text-stone-400">Loading recipients...</td>
                  </tr>
                ) : recipients.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="py-8 text-center text-stone-400">No recipients queued or recorded.</td>
                  </tr>
                ) : (
                  recipients.map((r, i) => (
                    <tr key={i} className="hover:bg-stone-50">
                      <td className="py-2 px-3 font-medium text-stone-800">{r.name || r.recipient_name || 'Member'}</td>
                      <td className="py-2 px-3 text-stone-600">{r.destination || r.mobile || r.email || '—'}</td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          r.status === 'SENT'
                            ? 'bg-emerald-50 text-emerald-700'
                            : r.status === 'FAILED'
                            ? 'bg-rose-50 text-rose-700'
                            : 'bg-stone-100 text-stone-600'
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

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-xs text-stone-600">
          Reusable message templates with dynamic tags like <code className="bg-stone-100 px-1 py-0.5 rounded text-[#510601]">{'{{name}}'}</code>, <code className="bg-stone-100 px-1 py-0.5 rounded text-[#510601]">{'{{member_code}}'}</code>
        </div>
        <PageActions>
          <button
            onClick={loadTemplates}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-700 bg-white border border-[#E8DFD8] rounded-lg hover:bg-stone-50 cursor-pointer shadow-sm transition-colors"
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
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#510601] rounded-lg hover:bg-[#3D0400] cursor-pointer shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create Template</span>
            </button>
          )}
        </PageActions>
      </div>

      {/* Templates Table */}
      <div className="bg-white border border-[#E8DFD8] rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-stone-700 font-bold">
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
                  <td colSpan="6" className="py-12 text-center text-stone-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#8C1801]" />
                    Loading templates...
                  </td>
                </tr>
              ) : templates.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-stone-400">
                    No message templates created yet.
                  </td>
                </tr>
              ) : (
                templates.map((t) => {
                  const ch = CHANNELS.find((x) => x.key === t.channel) || CHANNELS[0];
                  return (
                    <tr key={t.id} className="hover:bg-stone-50">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-stone-800">{t.name}</div>
                        <div className="text-[11px] text-stone-500 line-clamp-1 max-w-sm mt-0.5">{t.body}</div>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-stone-600">{t.code}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${ch.color}`}>
                          {ch.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-stone-600">{t.purpose}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          t.provider_approval_status === 'APPROVED'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : t.provider_approval_status === 'REJECTED'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-stone-100 text-stone-600 border border-stone-200'
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
                              className="p-1 text-stone-500 hover:text-[#510601] rounded transition-colors cursor-pointer"
                              title="Edit Template"
                            >
                              <Pencil className="w-4 h-4" /><span>Edit</span>
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => handleDeleteTemplate(t.id)}
                              className="p-1 text-stone-400 hover:text-red-700 rounded transition-colors cursor-pointer"
                              title="Delete Template"
                            >
                              <Trash2 className="w-4 h-4" /><span>Delete</span>
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
              <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Template Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Receipt Confirmation"
                className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Template Code *</label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                placeholder="e.g. RECEIPT_CONFIRM"
                className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 font-mono focus:outline-none focus:border-[#510601]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Channel</label>
              <select
                value={formData.channel}
                onChange={(e) => setFormData({ ...formData, channel: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
              >
                <option value="WHATSAPP">WhatsApp</option>
                <option value="SMS">SMS</option>
                <option value="EMAIL">Email</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Purpose</label>
              <select
                value={formData.purpose}
                onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
              >
                {PURPOSES.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Language</label>
              <select
                value={formData.language}
                onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
              >
                <option value="kn">Kannada (ಕನ್ನಡ)</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

          {formData.channel === 'EMAIL' && (
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Email Subject *</label>
              <input
                type="text"
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                placeholder="Important Notice from Akhila Havyaka Mahasabha"
                className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-stone-700 uppercase">Message Content / Body *</label>
              <div className="flex items-center gap-1 text-[11px] text-stone-500">
                <span>Insert tag:</span>
                {['name', 'member_code', 'mobile'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertVariable(v)}
                    className="px-1.5 py-0.5 bg-stone-100 hover:bg-[#FAF7F2] text-[#510601] font-mono text-[10px] rounded border border-stone-200 cursor-pointer"
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
              placeholder="ನಮಸ್ಕಾರ {{name}}, ಅಖಿಲ ಹವ್ಯಕ ಮಹಾಸಭಾದಿಂದ ಪ್ರಕಟಣೆ..."
              className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
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
  const [channel, setChannel] = useState('WHATSAPP');
  const [recipient, setRecipient] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [message, setMessage] = useState('');
  const [templates, setTemplates] = useState([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/notifications/templates', { params: { limit: 100 } });
        setTemplates(Array.isArray(res.data) ? res.data : (res.data?.data || []));
      } catch (_) {}
    })();
  }, []);

  const handleTemplateSelect = (id) => {
    setTemplateId(id);
    const t = templates.find((x) => String(x.id) === String(id));
    if (t) {
      setChannel(t.channel || 'WHATSAPP');
      setMessage(t.body || '');
    }
  };

  const handleSend = async (e) => {
    e?.preventDefault?.();
    if (!recipient.trim() || !message.trim()) {
      notify('Recipient number/email and message body are required.', 'error');
      return;
    }

    setSending(true);
    try {
      await api.post('/notifications/send-individual', {
        channel,
        destination: recipient.trim(),
        message: message.trim(),
        template_id: templateId ? Number(templateId) : undefined,
      });
      notify('Message sent successfully.', 'success');
      setRecipient('');
      setMessage('');
      setTemplateId('');
      onClose();
    } catch (err) {
      console.error('Failed to send message:', err);
      notify(err.response?.data?.detail || 'Failed to dispatch message.', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Quick Send">
      <form onSubmit={handleSend} className="flex-1 flex flex-col justify-between">
        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Communication Channel</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
            >
              <option value="WHATSAPP">WhatsApp</option>
              <option value="SMS">SMS</option>
              <option value="EMAIL">Email</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Load Template (Optional)</label>
            <select
              value={templateId}
              onChange={(e) => handleTemplateSelect(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
            >
              <option value="">Draft custom message...</option>
              {templates
                .filter((t) => t.channel === channel)
                .map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-stone-700 uppercase mb-1">
            Recipient {channel === 'EMAIL' ? 'Email Address' : 'Mobile Number'} *
          </label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={channel === 'EMAIL' ? 'user@example.com' : '9876543210'}
            className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Message Body *</label>
          <textarea
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your communication message here..."
            className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
          />
        </div>

        </div>
        <ModalFooter onCancel={onClose} busy={sending} disabled={!canWrite} submitLabel="Send" />
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

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-xs text-stone-600">Internal notifications and administrative alerts</span>
          {unreadCount > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#8C1801] text-white">
              {unreadCount} unread
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadInbox}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-700 bg-white border border-[#E8DFD8] rounded-lg hover:bg-stone-50 cursor-pointer shadow-sm transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
          {canWrite && (
            <button
              onClick={() => setBroadcastModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#510601] rounded-lg hover:bg-[#3D0400] cursor-pointer shadow-sm transition-colors"
            >
              <Bell className="w-4 h-4" />
              <span>Broadcast Announcement</span>
            </button>
          )}
        </div>
      </div>

      {/* Messages List */}
      <div className="bg-white border border-[#E8DFD8] rounded-xl shadow-sm divide-y divide-[#E8DFD8]">
        {loading ? (
          <div className="py-12 text-center text-stone-400">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#8C1801]" />
            Loading notifications...
          </div>
        ) : messages.length === 0 ? (
          <div className="py-12 text-center text-stone-400 text-xs">
            No system notifications or alerts in your inbox.
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`p-4 flex items-start justify-between gap-4 transition-colors ${
                !m.is_read ? 'bg-[#FAF7F2]' : 'hover:bg-stone-50'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-stone-900">{m.title || 'Notification'}</h3>
                  {!m.is_read && (
                    <span className="w-2 h-2 rounded-full bg-[#8C1801]" />
                  )}
                  {m.priority === 'HIGH' && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                      URGENT
                    </span>
                  )}
                </div>
                <p className="text-xs text-stone-700">{m.body || m.message}</p>
                <span className="text-[10px] text-stone-400 block">{formatDate(m.created_at)}</span>
              </div>
              {!m.is_read && (
                <button
                  onClick={() => markAsRead(m.id)}
                  className="px-2 py-1 text-[11px] font-semibold text-[#510601] hover:bg-stone-100 rounded transition-colors cursor-pointer"
                >
                  Mark Read
                </button>
              )}
            </div>
          ))
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
            <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Title *</label>
            <input
              type="text"
              value={broadcastBody.title}
              onChange={(e) => setBroadcastBody({ ...broadcastBody, title: e.target.value })}
              placeholder="e.g. System Maintenance Notice"
              className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Priority</label>
            <select
              value={broadcastBody.priority}
              onChange={(e) => setBroadcastBody({ ...broadcastBody, priority: e.target.value })}
              className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
            >
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High / Urgent</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase mb-1">Announcement Body *</label>
            <textarea
              rows={4}
              value={broadcastBody.body}
              onChange={(e) => setBroadcastBody({ ...broadcastBody, body: e.target.value })}
              placeholder="Enter announcement details..."
              className="w-full px-3 py-2 bg-white border border-[#DFD5CC] rounded-lg text-xs text-stone-800 focus:outline-none focus:border-[#510601]"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
