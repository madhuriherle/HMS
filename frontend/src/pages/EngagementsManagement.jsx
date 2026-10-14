import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import {
  Users,
  UserCheck,
  Newspaper,
  Shield,
  Plus,
  Pencil,
  Trash2,
  Search,
  BookOpen,
  CheckCircle2,
  XCircle,
  ExternalLink,
  X,
  Loader2,
  Phone,
  Mail,
  MapPin,
  Building,
  CreditCard,
  Eye,
  Settings,
  Calendar,
  Layers,
  ChevronDown
} from 'lucide-react';
import api from '../api';
import useAuth from '../hooks/useAuth';
import Modal from '../components/Modal';
import ModalFooter from '../components/ModalFooter';
import PermissionGate from '../components/PermissionGate';
import DateInput from '../components/DateInput';
import { formatDate } from '../utils/dateUtils';
import { notify } from '../utils/notify';
import Swal from 'sweetalert2';

export default function EngagementsManagement() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('engagements.write');
  const canDelete = hasPermission('engagements.delete');

  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const activeTab = useMemo(() => {
    const p = location.pathname.toLowerCase();
    if (p.includes('/associates')) return 'associates';
    if (p.includes('/press-media')) return 'press-media';
    if (p.includes('/committee')) return 'committee';
    if (p.includes('/affiliations')) return 'affiliations';
    return searchParams.get('tab') || 'affiliations';
  }, [location.pathname, searchParams]);

  const setTab = (t) => {
    navigate(`/dashboard/engagements/${t}`);
  };

  return (
    <PermissionGate
      required={[
        'engagements.read',
        'engagements.affiliations.read',
        'engagements.associates.read',
        'engagements.press_media.read',
        'engagements.committee.read',
      ]}
      title="Access Restricted"
      message="You need Engagements privilege to view this page."
    >
      <div className="space-y-6 pb-12">
        {/* Page Heading - Rule 12.1 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h1 className="text-xl sm:text-2xl font-bold text-[#180200] tracking-tight">
            Engagements
          </h1>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#E8DFD8] gap-1 overflow-x-auto">
          {[
            { id: 'affiliations', label: 'Affiliations', icon: Users },
            { id: 'associates', label: 'Associates', icon: UserCheck },
            { id: 'press-media', label: 'Press & Media', icon: Newspaper },
            { id: 'committee', label: 'Managing Committee', icon: Shield },
          ].map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-xl border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'border-[#8C1801] text-[#8C1801] bg-[#FAF7F2]'
                    : 'border-transparent text-[#863221]/70 hover:text-[#8C1801] hover:bg-[#FAF7F2]/60'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Active Tab View */}
        {activeTab === 'affiliations' && <AffiliationsView canWrite={canWrite} canDelete={canDelete} />}
        {activeTab === 'associates' && <AssociatesView canWrite={canWrite} canDelete={canDelete} />}
        {activeTab === 'press-media' && <PressMediaView canWrite={canWrite} canDelete={canDelete} />}
        {activeTab === 'committee' && <CommitteeView canWrite={canWrite} canDelete={canDelete} />}
      </div>
    </PermissionGate>
  );
}

// ══════════════════════════════════════════════════════════════════
// 1. AFFILIATIONS TAB
// ══════════════════════════════════════════════════════════════════
function AffiliationsView({ canWrite, canDelete }) {
  const [affiliations, setAffiliations] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [magFilter, setMagFilter] = useState('ALL');

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingAff, setEditingAff] = useState(null);
  const [formData, setFormData] = useState({
    group_name: '',
    contact_person: '',
    contact_number: '',
    address: '',
    magazine_enabled: true,
  });
  const [saving, setSaving] = useState(false);

  // Contacts modal
  const [contactsModalOpen, setContactsModalOpen] = useState(false);
  const [activeAffForContacts, setActiveAffForContacts] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [contactForm, setContactForm] = useState({
    name: '',
    mobile: '',
    email: '',
    designation: '',
  });
  const [savingContact, setSavingContact] = useState(false);

  const loadAffiliations = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 15 };
      if (magFilter === 'ENABLED') params.magazine_enabled = true;
      if (magFilter === 'DISABLED') params.magazine_enabled = false;
      const res = await api.get('/engagements/affiliations', { params });
      let items = res.data?.data || res.data || [];
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        items = items.filter(
          (a) =>
            (a.group_name || '').toLowerCase().includes(q) ||
            (a.contact_person || '').toLowerCase().includes(q) ||
            (a.contact_number || '').includes(q)
        );
      }
      setAffiliations(items);
      setTotal(res.data?.total ?? items.length);
    } catch (err) {
      console.error(err);
      notify('Failed to load affiliations.', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, magFilter, search]);

  useEffect(() => {
    loadAffiliations();
  }, [loadAffiliations]);

  const openAddModal = () => {
    setEditingAff(null);
    setFormData({
      group_name: '',
      contact_person: '',
      contact_number: '',
      address: '',
      magazine_enabled: true,
    });
    setFormModalOpen(true);
  };

  const openEditModal = (aff) => {
    setEditingAff(aff);
    setFormData({
      group_name: aff.group_name || '',
      contact_person: aff.contact_person || '',
      contact_number: aff.contact_number || '',
      address: aff.address || '',
      magazine_enabled: aff.magazine_enabled !== false,
    });
    setFormModalOpen(true);
  };

  const handleSaveAffiliation = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!formData.group_name.trim()) {
      notify('Group Name is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editingAff) {
        await api.put(`/engagements/affiliations/${editingAff.id}`, formData);
        notify('Affiliation updated.', 'success');
      } else {
        await api.post('/engagements/affiliations', formData);
        notify('Affiliation added.', 'success');
      }
      setFormModalOpen(false);
      loadAffiliations();
    } catch (err) {
      notify(err.response?.data?.detail || 'Failed to save affiliation.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAffiliation = async (aff) => {
    const res = await Swal.fire({
      title: 'Delete Affiliation?',
      text: `Are you sure you want to delete "${aff.group_name}"?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, delete',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#ED4636',
      cancelButtonColor: '#863221',
      reverseButtons: true,
      customClass: { popup: 'hms-mini-swal' },
    });
    if (res.isConfirmed) {
      try {
        await api.delete(`/engagements/affiliations/${aff.id}`);
        notify('Affiliation deleted.', 'success');
        loadAffiliations();
      } catch (err) {
        notify(err.response?.data?.detail || 'Failed to delete affiliation.', 'error');
      }
    }
  };

  // Toggle Magazine Delivery
  const handleToggleMagazine = async (aff) => {
    if (!canWrite) return;
    const newStatus = !aff.magazine_enabled;
    try {
      await api.put(`/engagements/affiliations/${aff.id}/magazine-setting`, {
        enabled: newStatus,
      });
      notify(`Magazine delivery ${newStatus ? 'enabled' : 'disabled'}.`, 'success');
      loadAffiliations();
    } catch (err) {
      notify('Failed to update magazine delivery setting.', 'error');
    }
  };

  // Contacts
  const openContactsModal = async (aff) => {
    setActiveAffForContacts(aff);
    setContactsModalOpen(true);
    setLoadingContacts(true);
    try {
      const res = await api.get(`/engagements/affiliations/${aff.id}/contacts`);
      setContacts(res.data?.data || []);
    } catch {
      setContacts([]);
    } finally {
      setLoadingContacts(false);
    }
  };

  const openAddContact = () => {
    setEditingContact(null);
    setContactForm({ name: '', mobile: '', email: '', designation: '' });
    setContactFormOpen(true);
  };

  const openEditContact = (c) => {
    setEditingContact(c);
    setContactForm({
      name: c.name || '',
      mobile: c.mobile || '',
      email: c.email || '',
      designation: c.designation || '',
    });
    setContactFormOpen(true);
  };

  const handleSaveContact = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!contactForm.name.trim()) {
      notify('Contact name is required.', 'error');
      return;
    }
    setSavingContact(true);
    try {
      if (editingContact) {
        await api.put(`/engagements/affiliations/${activeAffForContacts.id}/contacts/${editingContact.id}`, contactForm);
        notify('Contact updated.', 'success');
      } else {
        await api.post(`/engagements/affiliations/${activeAffForContacts.id}/contacts`, contactForm);
        notify('Contact added.', 'success');
      }
      setContactFormOpen(false);
      const res = await api.get(`/engagements/affiliations/${activeAffForContacts.id}/contacts`);
      setContacts(res.data?.data || []);
    } catch (err) {
      notify(err.response?.data?.detail || 'Failed to save contact.', 'error');
    } finally {
      setSavingContact(false);
    }
  };

  const handleDeleteContact = async (c) => {
    try {
      await api.delete(`/engagements/affiliations/${activeAffForContacts.id}/contacts/${c.id}`);
      notify('Contact deleted.', 'success');
      const res = await api.get(`/engagements/affiliations/${activeAffForContacts.id}/contacts`);
      setContacts(res.data?.data || []);
    } catch (err) {
      notify('Failed to delete contact.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls & Filter Bar */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative w-64">
            <Search className="w-4 h-4 text-[#863221]/60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search group or contact..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
            />
          </div>

          <select
            value={magFilter}
            onChange={(e) => setMagFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
          >
            <option value="ALL">All Magazine Statuses</option>
            <option value="ENABLED">Magazine Delivery Enabled</option>
            <option value="DISABLED">Magazine Delivery Disabled</option>
          </select>
        </div>

        {canWrite && (
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Affiliate</span>
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-[#863221]">
            <Loader2 className="w-6 h-6 animate-spin text-[#510601] mx-auto mb-2" />
            <span>Loading affiliations...</span>
          </div>
        ) : affiliations.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#863221]">
            <Users className="w-10 h-10 text-[#863221]/40 mx-auto mb-2" />
            <p className="font-semibold text-[#180200]">No affiliate groups found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#FAF7F2] text-[#863221] text-[10px] uppercase font-bold tracking-wider border-b border-[#E8DFD8]">
                  <th className="px-4 py-3">Group Name</th>
                  <th className="px-4 py-3">Contact Person</th>
                  <th className="px-4 py-3">Contact Phone</th>
                  <th className="px-4 py-3">Address</th>
                  <th className="px-4 py-3">Magazine Delivery</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {affiliations.map((a) => (
                  <tr key={a.id} className="hover:bg-[#FAF7F2]/50 transition-colors">
                    <td className="px-4 py-3 font-bold text-[#180200]">{a.group_name}</td>
                    <td className="px-4 py-3 text-[#180200]">{a.contact_person || '—'}</td>
                    <td className="px-4 py-3 text-[#863221]">{a.contact_number || '—'}</td>
                    <td className="px-4 py-3 text-[#180200] max-w-xs truncate">{a.address || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={!canWrite}
                        onClick={() => handleToggleMagazine(a)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors cursor-pointer ${
                          a.magazine_enabled
                            ? 'bg-[#3D705C]/15 text-[#3D705C] hover:bg-[#3D705C]/25'
                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                        title={canWrite ? 'Click to toggle magazine delivery' : 'Magazine delivery status'}
                      >
                        <BookOpen className="w-3 h-3" />
                        <span>{a.magazine_enabled ? 'Delivered' : 'Disabled'}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        <button
                          type="button"
                          onClick={() => openContactsModal(a)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#FAF7F2] hover:bg-[#E8DFD8] text-[#510601] font-semibold rounded-lg text-xs transition-colors cursor-pointer"
                          title="Manage Contacts"
                        >
                          <Phone className="w-3 h-3" />
                          <span>Contacts</span>
                        </button>
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditModal(a)}
                            className="p-1.5 text-[#863221] hover:text-[#510601] hover:bg-[#FAF7F2] rounded-lg transition-colors cursor-pointer"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => handleDeleteAffiliation(a)}
                            className="p-1.5 text-[#ED4636] hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Add / Edit Affiliation */}
      <Modal isOpen={formModalOpen} onClose={() => setFormModalOpen(false)}>
        <div className="bg-white rounded-2xl max-w-lg w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2]">
            <h3 className="text-base font-bold text-[#180200]">
              {editingAff ? 'Edit Affiliate Group' : 'Add Affiliate Group'}
            </h3>
            <button
              type="button"
              onClick={() => setFormModalOpen(false)}
              className="p-1.5 rounded-lg text-[#863221] hover:bg-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={handleSaveAffiliation} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Group Name <span className="text-[#ED4636]">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.group_name}
                onChange={(e) => setFormData({ ...formData, group_name: e.target.value })}
                placeholder="e.g. Uttara Kannada Havyaka Parishat"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Primary Contact Person
              </label>
              <input
                type="text"
                value={formData.contact_person}
                onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                placeholder="e.g. Sri Krishna Hegde"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Contact Phone / Mobile
              </label>
              <input
                type="text"
                value={formData.contact_number}
                onChange={(e) => setFormData({ ...formData, contact_number: e.target.value })}
                placeholder="e.g. 9845012345"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Address
              </label>
              <textarea
                rows={3}
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Delivery / correspondence address..."
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="aff_mag_en"
                checked={formData.magazine_enabled}
                onChange={(e) => setFormData({ ...formData, magazine_enabled: e.target.checked })}
                className="accent-[#510601] w-4 h-4 rounded"
              />
              <label htmlFor="aff_mag_en" className="text-xs font-bold text-[#180200] cursor-pointer">
                Enable Magazine Delivery for this Affiliate (Included in label print)
              </label>
            </div>
            <ModalFooter
              kind={editingAff ? 'edit' : 'add'}
              submitLabel={editingAff ? 'Update' : 'Save'}
              busyLabel={editingAff ? 'Updating...' : 'Saving...'}
              busy={saving}
              onSubmit={handleSaveAffiliation}
              onCancel={() => setFormModalOpen(false)}
            />
          </form>
        </div>
      </Modal>

      {/* Modal: Affiliate Contacts List */}
      <Modal isOpen={contactsModalOpen} onClose={() => setContactsModalOpen(false)}>
        <div className="bg-white rounded-2xl max-w-2xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
          <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2]">
            <h3 className="text-base font-bold text-[#180200]">
              Contacts: {activeAffForContacts?.group_name}
            </h3>
            <button
              type="button"
              onClick={() => setContactsModalOpen(false)}
              className="p-1.5 rounded-lg text-[#863221] hover:bg-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6 space-y-4 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between">
              <p className="text-xs text-[#863221]">
                Persons representing this affiliate group
              </p>
              {canWrite && (
                <button
                  type="button"
                  onClick={openAddContact}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Contact</span>
                </button>
              )}
            </div>

            {loadingContacts ? (
              <div className="py-8 text-center text-xs text-[#863221]">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-1 text-[#510601]" />
                Loading contacts...
              </div>
            ) : contacts.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#863221] bg-[#FAF7F2] rounded-xl border border-[#E8DFD8]">
                No contact persons added yet.
              </div>
            ) : (
              <div className="border border-[#E8DFD8] rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#FAF7F2] text-[#863221] text-[10px] uppercase font-bold tracking-wider border-b border-[#E8DFD8]">
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Designation</th>
                      <th className="px-3 py-2">Mobile</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8DFD8]">
                    {contacts.map((c) => (
                      <tr key={c.id} className="hover:bg-[#FAF7F2]/40">
                        <td className="px-3 py-2 font-semibold text-[#180200]">{c.name}</td>
                        <td className="px-3 py-2 text-[#863221]">{c.designation || '—'}</td>
                        <td className="px-3 py-2 text-[#180200]">{c.mobile || '—'}</td>
                        <td className="px-3 py-2 text-[#863221]">{c.email || '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1">
                            {canWrite && (
                              <button
                                type="button"
                                onClick={() => openEditContact(c)}
                                className="p-1 text-[#863221] hover:text-[#510601]"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => handleDeleteContact(c)}
                                className="p-1 text-[#ED4636] hover:text-red-700"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="px-6 h-14 shrink-0 border-t border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-end">
            <button
              type="button"
              onClick={() => setContactsModalOpen(false)}
              className="px-4 py-2 border border-[#E8DFD8] bg-white text-[#180200] text-xs font-semibold rounded-xl hover:bg-[#FAF7F2]"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Add / Edit Contact Form */}
      <Modal isOpen={contactFormOpen} onClose={() => setContactFormOpen(false)}>
        <div className="bg-white rounded-2xl max-w-md w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2]">
            <h3 className="text-base font-bold text-[#180200]">
              {editingContact ? 'Edit Contact' : 'Add Contact Person'}
            </h3>
            <button
              type="button"
              onClick={() => setContactFormOpen(false)}
              className="p-1.5 rounded-lg text-[#863221] hover:bg-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={handleSaveContact} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Name <span className="text-[#ED4636]">*</span>
              </label>
              <input
                type="text"
                required
                value={contactForm.name}
                onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                placeholder="Full Name"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Designation
              </label>
              <input
                type="text"
                value={contactForm.designation}
                onChange={(e) => setContactForm({ ...contactForm, designation: e.target.value })}
                placeholder="e.g. President / Secretary"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Mobile Number
              </label>
              <input
                type="text"
                value={contactForm.mobile}
                onChange={(e) => setContactForm({ ...contactForm, mobile: e.target.value })}
                placeholder="10 digit mobile"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Email
              </label>
              <input
                type="email"
                value={contactForm.email}
                onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                placeholder="Email address"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <ModalFooter
              kind={editingContact ? 'edit' : 'add'}
              submitLabel={editingContact ? 'Update' : 'Save'}
              busyLabel={editingContact ? 'Updating...' : 'Saving...'}
              busy={savingContact}
              onSubmit={handleSaveContact}
              onCancel={() => setContactFormOpen(false)}
            />
          </form>
        </div>
      </Modal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 2. ASSOCIATES TAB
// ══════════════════════════════════════════════════════════════════
function AssociatesView({ canWrite, canDelete }) {
  const [associates, setAssociates] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [magFilter, setMagFilter] = useState('ALL');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingAssoc, setEditingAssoc] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    organization: '',
    mobile: '',
    email: '',
    pan_number: '',
    address: '',
    magazine_enabled: true,
  });
  const [saving, setSaving] = useState(false);

  const loadAssociates = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 15 };
      if (search.trim()) params.search = search.trim();
      if (magFilter === 'ENABLED') params.magazine_enabled = true;
      if (magFilter === 'DISABLED') params.magazine_enabled = false;

      const res = await api.get('/engagements/associates', { params });
      setAssociates(res.data?.data || res.data || []);
      setTotal(res.data?.total ?? 0);
    } catch (err) {
      console.error(err);
      notify('Failed to load associates.', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, search, magFilter]);

  useEffect(() => {
    loadAssociates();
  }, [loadAssociates]);

  const openAdd = () => {
    setEditingAssoc(null);
    setFormData({
      name: '',
      organization: '',
      mobile: '',
      email: '',
      pan_number: '',
      address: '',
      magazine_enabled: true,
    });
    setModalOpen(true);
  };

  const openEdit = (a) => {
    setEditingAssoc(a);
    setFormData({
      name: a.name || '',
      organization: a.organization || '',
      mobile: a.mobile || '',
      email: a.email || '',
      pan_number: a.pan_number || '',
      address: a.address || '',
      magazine_enabled: a.magazine_enabled !== false,
    });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!formData.name.trim()) {
      notify('Associate Name is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editingAssoc) {
        await api.put(`/engagements/associates/${editingAssoc.id}`, formData);
        notify('Associate updated.', 'success');
      } else {
        await api.post('/engagements/associates', formData);
        notify('Associate registered.', 'success');
      }
      setModalOpen(false);
      loadAssociates();
    } catch (err) {
      notify(err.response?.data?.detail || 'Failed to save associate.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (a) => {
    const res = await Swal.fire({
      title: 'Delete Associate?',
      text: `Are you sure you want to delete "${a.name}"?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, delete',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#ED4636',
      cancelButtonColor: '#863221',
      reverseButtons: true,
      customClass: { popup: 'hms-mini-swal' },
    });
    if (res.isConfirmed) {
      try {
        await api.delete(`/engagements/associates/${a.id}`);
        notify('Associate deleted.', 'success');
        loadAssociates();
      } catch (err) {
        notify(err.response?.data?.detail || 'Failed to delete associate.', 'error');
      }
    }
  };

  const handleToggleMagazine = async (a) => {
    if (!canWrite) return;
    const newStatus = !a.magazine_enabled;
    try {
      await api.put(`/engagements/associates/${a.id}/magazine-setting`, {
        enabled: newStatus,
      });
      notify(`Magazine delivery ${newStatus ? 'enabled' : 'disabled'}.`, 'success');
      loadAssociates();
    } catch {
      notify('Failed to update magazine delivery setting.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative w-64">
            <Search className="w-4 h-4 text-[#863221]/60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search associate, organization..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
            />
          </div>

          <select
            value={magFilter}
            onChange={(e) => setMagFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
          >
            <option value="ALL">All Magazine Statuses</option>
            <option value="ENABLED">Magazine Delivery Enabled</option>
            <option value="DISABLED">Magazine Delivery Disabled</option>
          </select>
        </div>

        {canWrite && (
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Register Associate</span>
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-[#863221]">
            <Loader2 className="w-6 h-6 animate-spin text-[#510601] mx-auto mb-2" />
            <span>Loading associates...</span>
          </div>
        ) : associates.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#863221]">
            <UserCheck className="w-10 h-10 text-[#863221]/40 mx-auto mb-2" />
            <p className="font-semibold text-[#180200]">No associates registered</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#FAF7F2] text-[#863221] text-[10px] uppercase font-bold tracking-wider border-b border-[#E8DFD8]">
                  <th className="px-4 py-3">Associate Name</th>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Mobile & Email</th>
                  <th className="px-4 py-3">PAN Number</th>
                  <th className="px-4 py-3">Address</th>
                  <th className="px-4 py-3">Magazine Delivery</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {associates.map((a) => (
                  <tr key={a.id} className="hover:bg-[#FAF7F2]/50 transition-colors">
                    <td className="px-4 py-3 font-bold text-[#180200]">{a.name}</td>
                    <td className="px-4 py-3 text-[#180200]">{a.organization || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="text-[#180200]">{a.mobile || '—'}</div>
                      {a.email && <div className="text-[11px] text-[#863221]">{a.email}</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-[#863221]">{a.pan_number || '—'}</td>
                    <td className="px-4 py-3 text-[#180200] max-w-xs truncate">{a.address || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={!canWrite}
                        onClick={() => handleToggleMagazine(a)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors cursor-pointer ${
                          a.magazine_enabled
                            ? 'bg-[#3D705C]/15 text-[#3D705C] hover:bg-[#3D705C]/25'
                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                        title={canWrite ? 'Click to toggle magazine delivery' : 'Magazine delivery status'}
                      >
                        <BookOpen className="w-3 h-3" />
                        <span>{a.magazine_enabled ? 'Delivered' : 'Disabled'}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEdit(a)}
                            className="p-1.5 text-[#863221] hover:text-[#510601] hover:bg-[#FAF7F2] rounded-lg transition-colors cursor-pointer"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => handleDelete(a)}
                            className="p-1.5 text-[#ED4636] hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Add / Edit Associate */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}>
        <div className="bg-white rounded-2xl max-w-lg w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2]">
            <h3 className="text-base font-bold text-[#180200]">
              {editingAssoc ? 'Edit Associate' : 'Register New Associate'}
            </h3>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="p-1.5 rounded-lg text-[#863221] hover:bg-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={handleSave} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Associate Full Name <span className="text-[#ED4636]">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Sri Anantha Murthy"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Organization / Company
              </label>
              <input
                type="text"
                value={formData.organization}
                onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                placeholder="Organization or Trust name"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Mobile Number
                </label>
                <input
                  type="text"
                  value={formData.mobile}
                  onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                  placeholder="10 digit mobile"
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  PAN Number
                </label>
                <input
                  type="text"
                  value={formData.pan_number}
                  onChange={(e) => setFormData({ ...formData, pan_number: e.target.value.toUpperCase() })}
                  placeholder="ABCDE1234F"
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601] font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="associate@example.com"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Address
              </label>
              <textarea
                rows={3}
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Correspondence address..."
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="assoc_mag_en"
                checked={formData.magazine_enabled}
                onChange={(e) => setFormData({ ...formData, magazine_enabled: e.target.checked })}
                className="accent-[#510601] w-4 h-4 rounded"
              />
              <label htmlFor="assoc_mag_en" className="text-xs font-bold text-[#180200] cursor-pointer">
                Enable Magazine Delivery for this Associate (Included in label print)
              </label>
            </div>
            <ModalFooter
              kind={editingAssoc ? 'edit' : 'add'}
              submitLabel={editingAssoc ? 'Update' : 'Save'}
              busyLabel={editingAssoc ? 'Updating...' : 'Saving...'}
              busy={saving}
              onSubmit={handleSave}
              onCancel={() => setModalOpen(false)}
            />
          </form>
        </div>
      </Modal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 3. PRESS & MEDIA TAB
// ══════════════════════════════════════════════════════════════════
function PressMediaView({ canWrite, canDelete }) {
  const [pressList, setPressList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [magFilter, setMagFilter] = useState('ALL');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingPress, setEditingPress] = useState(null);
  const [formData, setFormData] = useState({
    organization_name: '',
    reporter_name: '',
    mobile: '',
    email: '',
    address: '',
    magazine_enabled: true,
  });
  const [saving, setSaving] = useState(false);

  const loadPress = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 50 };
      if (search.trim()) params.search = search.trim();
      if (magFilter === 'ENABLED') params.magazine_enabled = true;
      if (magFilter === 'DISABLED') params.magazine_enabled = false;

      const res = await api.get('/engagements/press-media', { params });
      setPressList(res.data?.data || res.data || []);
    } catch {
      notify('Failed to load press and media records.', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, magFilter]);

  useEffect(() => {
    loadPress();
  }, [loadPress]);

  const openAdd = () => {
    setEditingPress(null);
    setFormData({
      organization_name: '',
      reporter_name: '',
      mobile: '',
      email: '',
      address: '',
      magazine_enabled: true,
    });
    setModalOpen(true);
  };

  const openEdit = (p) => {
    setEditingPress(p);
    setFormData({
      organization_name: p.organization_name || '',
      reporter_name: p.reporter_name || '',
      mobile: p.mobile || '',
      email: p.email || '',
      address: p.address || '',
      magazine_enabled: p.magazine_enabled !== false,
    });
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!formData.organization_name.trim()) {
      notify('Organization / Publication name is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editingPress) {
        await api.put(`/engagements/press-media/${editingPress.id}`, formData);
        notify('Press/Media record updated.', 'success');
      } else {
        await api.post('/engagements/press-media', formData);
        notify('Press/Media record added.', 'success');
      }
      setModalOpen(false);
      loadPress();
    } catch (err) {
      notify(err.response?.data?.detail || 'Failed to save press/media.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p) => {
    const res = await Swal.fire({
      title: 'Delete Press/Media?',
      text: `Are you sure you want to delete "${p.organization_name}"?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, delete',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#ED4636',
      cancelButtonColor: '#863221',
      reverseButtons: true,
      customClass: { popup: 'hms-mini-swal' },
    });
    if (res.isConfirmed) {
      try {
        await api.delete(`/engagements/press-media/${p.id}`);
        notify('Press/Media record deleted.', 'success');
        loadPress();
      } catch (err) {
        notify(err.response?.data?.detail || 'Failed to delete record.', 'error');
      }
    }
  };

  const handleToggleMagazine = async (p) => {
    if (!canWrite) return;
    const newStatus = !p.magazine_enabled;
    try {
      await api.put(`/engagements/press-media/${p.id}/magazine-setting`, {
        enabled: newStatus,
      });
      notify(`Magazine delivery ${newStatus ? 'enabled' : 'disabled'}.`, 'success');
      loadPress();
    } catch {
      notify('Failed to update magazine delivery setting.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative w-64">
            <Search className="w-4 h-4 text-[#863221]/60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search publication, reporter..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
            />
          </div>

          <select
            value={magFilter}
            onChange={(e) => setMagFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
          >
            <option value="ALL">All Magazine Statuses</option>
            <option value="ENABLED">Magazine Delivery Enabled</option>
            <option value="DISABLED">Magazine Delivery Disabled</option>
          </select>
        </div>

        {canWrite && (
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Press / Media</span>
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-[#863221]">
            <Loader2 className="w-6 h-6 animate-spin text-[#510601] mx-auto mb-2" />
            <span>Loading press and media...</span>
          </div>
        ) : pressList.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#863221]">
            <Newspaper className="w-10 h-10 text-[#863221]/40 mx-auto mb-2" />
            <p className="font-semibold text-[#180200]">No press or media records found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#FAF7F2] text-[#863221] text-[10px] uppercase font-bold tracking-wider border-b border-[#E8DFD8]">
                  <th className="px-4 py-3">Publication / Channel</th>
                  <th className="px-4 py-3">Reporter / Contact</th>
                  <th className="px-4 py-3">Phone & Email</th>
                  <th className="px-4 py-3">Address</th>
                  <th className="px-4 py-3">Magazine Delivery</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {pressList.map((p) => (
                  <tr key={p.id} className="hover:bg-[#FAF7F2]/50 transition-colors">
                    <td className="px-4 py-3 font-bold text-[#180200]">{p.organization_name}</td>
                    <td className="px-4 py-3 text-[#180200]">{p.reporter_name || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="text-[#180200]">{p.mobile || '—'}</div>
                      {p.email && <div className="text-[11px] text-[#863221]">{p.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-[#180200] max-w-xs truncate">{p.address || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={!canWrite}
                        onClick={() => handleToggleMagazine(p)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors cursor-pointer ${
                          p.magazine_enabled
                            ? 'bg-[#3D705C]/15 text-[#3D705C] hover:bg-[#3D705C]/25'
                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                        title={canWrite ? 'Click to toggle magazine delivery' : 'Magazine delivery status'}
                      >
                        <BookOpen className="w-3 h-3" />
                        <span>{p.magazine_enabled ? 'Delivered' : 'Disabled'}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEdit(p)}
                            className="p-1.5 text-[#863221] hover:text-[#510601] hover:bg-[#FAF7F2] rounded-lg transition-colors cursor-pointer"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => handleDelete(p)}
                            className="p-1.5 text-[#ED4636] hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Add / Edit Press */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}>
        <div className="bg-white rounded-2xl max-w-lg w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2]">
            <h3 className="text-base font-bold text-[#180200]">
              {editingPress ? 'Edit Press/Media' : 'Add Press/Media'}
            </h3>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="p-1.5 rounded-lg text-[#863221] hover:bg-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={handleSave} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Publication / Organization Name <span className="text-[#ED4636]">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.organization_name}
                onChange={(e) => setFormData({ ...formData, organization_name: e.target.value })}
                placeholder="e.g. Prajavani / Havyaka Sandesha"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Reporter / Contact Name
              </label>
              <input
                type="text"
                value={formData.reporter_name}
                onChange={(e) => setFormData({ ...formData, reporter_name: e.target.value })}
                placeholder="e.g. Sri Govinda Bhat"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Mobile Number
                </label>
                <input
                  type="text"
                  value={formData.mobile}
                  onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                  placeholder="10 digit mobile"
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="press@example.com"
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Address
              </label>
              <textarea
                rows={3}
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Press office / delivery address..."
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="press_mag_en"
                checked={formData.magazine_enabled}
                onChange={(e) => setFormData({ ...formData, magazine_enabled: e.target.checked })}
                className="accent-[#510601] w-4 h-4 rounded"
              />
              <label htmlFor="press_mag_en" className="text-xs font-bold text-[#180200] cursor-pointer">
                Enable Magazine Delivery for this Press (Included in label print)
              </label>
            </div>
            <ModalFooter
              kind={editingPress ? 'edit' : 'add'}
              submitLabel={editingPress ? 'Update' : 'Save'}
              busyLabel={editingPress ? 'Updating...' : 'Saving...'}
              busy={saving}
              onSubmit={handleSave}
              onCancel={() => setModalOpen(false)}
            />
          </form>
        </div>
      </Modal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 4. MANAGING COMMITTEE TAB
// ══════════════════════════════════════════════════════════════════
function CommitteeView({ canWrite, canDelete }) {
  const [categories, setCategories] = useState([]);
  const [subcategories, setSubcategories] = useState([]);
  const [terms, setTerms] = useState([]);
  const [committeeMembers, setCommitteeMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('ALL');
  const [selectedTermFilter, setSelectedTermFilter] = useState('ALL');

  // Committee Member Modal
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [memberForm, setMemberForm] = useState({
    category_id: '',
    subcategory_id: '',
    term_id: '',
    member_name: '',
    designation: '',
    display_on_website: true,
    is_hms_member: false,
    hms_member_id: null,
    hms_member_name: '',
    hms_member_code: '',
  });
  const [savingMember, setSavingMember] = useState(false);

  // Live member picker search
  const [hmsSearchQuery, setHmsSearchQuery] = useState('');
  const [hmsSearchResults, setHmsSearchResults] = useState([]);
  const [searchingHms, setSearchingHms] = useState(false);

  // Setup Modals (Categories & Terms)
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState(null);
  const [catForm, setCatForm] = useState({ name_en: '', name_kn: '', display_on_website: true });
  const [savingCat, setSavingCat] = useState(false);

  const [termModalOpen, setTermModalOpen] = useState(false);
  const [editingTerm, setEditingTerm] = useState(null);
  const [termForm, setTermForm] = useState({ term_name: '', start_date: '', end_date: '', is_current: false });
  const [savingTerm, setSavingTerm] = useState(false);

  // Load masters & roster
  const loadMasters = useCallback(async () => {
    try {
      const [catsRes, subsRes, termsRes] = await Promise.all([
        api.get('/engagements/committee/categories'),
        api.get('/engagements/committee/subcategories'),
        api.get('/engagements/committee/terms'),
      ]);
      setCategories(catsRes.data?.data || catsRes.data || []);
      setSubcategories(subsRes.data?.data || subsRes.data || []);
      setTerms(termsRes.data?.data || termsRes.data || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const loadMembersRoster = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 100 };
      if (selectedCategoryFilter !== 'ALL') params.category_id = Number(selectedCategoryFilter);
      if (selectedTermFilter !== 'ALL') params.term_id = Number(selectedTermFilter);

      const res = await api.get('/engagements/committee/members', { params });
      setCommitteeMembers(res.data?.data || res.data || []);
    } catch {
      notify('Failed to load committee roster.', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedCategoryFilter, selectedTermFilter]);

  useEffect(() => {
    loadMasters();
  }, [loadMasters]);

  useEffect(() => {
    loadMembersRoster();
  }, [loadMembersRoster]);

  // Open Add Member
  const openAddMember = () => {
    setEditingMember(null);
    const defaultCat = categories[0]?.id || '';
    const defaultTerm = terms.find((t) => t.is_current)?.id || terms[0]?.id || '';
    setMemberForm({
      category_id: defaultCat,
      subcategory_id: '',
      term_id: defaultTerm,
      member_name: '',
      designation: '',
      display_on_website: true,
      is_hms_member: false,
      hms_member_id: null,
      hms_member_name: '',
      hms_member_code: '',
    });
    setHmsSearchQuery('');
    setHmsSearchResults([]);
    setMemberModalOpen(true);
  };

  const openEditMember = (m) => {
    setEditingMember(m);
    setMemberForm({
      category_id: m.category_id || '',
      subcategory_id: m.subcategory_id || '',
      term_id: m.term_id || '',
      member_name: m.member_name || '',
      designation: m.designation || '',
      display_on_website: m.display_on_website !== false,
      is_hms_member: Boolean(m.hms_member_id),
      hms_member_id: m.hms_member_id || null,
      hms_member_name: m.hms_member_name || '',
      hms_member_code: m.hms_member_code || '',
    });
    setHmsSearchQuery('');
    setHmsSearchResults([]);
    setMemberModalOpen(true);
  };

  const handleSearchHmsMembers = async (q) => {
    setHmsSearchQuery(q);
    if (!q || q.trim().length < 2) {
      setHmsSearchResults([]);
      return;
    }
    setSearchingHms(true);
    try {
      const res = await api.get('/members/', { params: { search: q.trim(), limit: 8 } });
      setHmsSearchResults(res.data?.data || res.data || []);
    } catch {
      setHmsSearchResults([]);
    } finally {
      setSearchingHms(false);
    }
  };

  const handleSelectHmsMember = (m) => {
    const fullName = `${m.first_name_en || ''} ${m.last_name_en || ''}`.trim() || m.full_name_kn || 'Member';
    const code = m.membership_number || m.member_code || '';
    setMemberForm((prev) => ({
      ...prev,
      hms_member_id: m.id,
      hms_member_name: fullName,
      hms_member_code: code,
      member_name: fullName,
    }));
    setHmsSearchResults([]);
    setHmsSearchQuery('');
  };

  const handleSaveMember = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!memberForm.category_id) {
      notify('Category is required.', 'error');
      return;
    }
    if (!memberForm.member_name.trim()) {
      notify('Member name is required.', 'error');
      return;
    }
    setSavingMember(true);
    try {
      const payload = {
        category_id: Number(memberForm.category_id),
        subcategory_id: memberForm.subcategory_id ? Number(memberForm.subcategory_id) : null,
        term_id: memberForm.term_id ? Number(memberForm.term_id) : null,
        member_name: memberForm.member_name.trim(),
        designation: memberForm.designation.trim() || null,
        display_on_website: memberForm.display_on_website,
        hms_member_id: memberForm.is_hms_member ? memberForm.hms_member_id : null,
      };

      if (editingMember) {
        await api.put(`/engagements/committee/members/${editingMember.id}`, payload);
        notify('Committee member updated.', 'success');
      } else {
        await api.post('/engagements/committee/members', payload);
        notify('Committee member added.', 'success');
      }
      setMemberModalOpen(false);
      loadMembersRoster();
    } catch (err) {
      notify(err.response?.data?.detail || 'Failed to save committee member.', 'error');
    } finally {
      setSavingMember(false);
    }
  };

  const handleDeleteMember = async (m) => {
    const res = await Swal.fire({
      title: 'Remove Member?',
      text: `Remove "${m.member_name}" from the committee?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, remove',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#ED4636',
      cancelButtonColor: '#863221',
      reverseButtons: true,
      customClass: { popup: 'hms-mini-swal' },
    });
    if (res.isConfirmed) {
      try {
        await api.delete(`/engagements/committee/members/${m.id}`);
        notify('Committee member removed.', 'success');
        loadMembersRoster();
      } catch (err) {
        notify('Failed to remove committee member.', 'error');
      }
    }
  };

  // Category save
  const handleSaveCategory = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!catForm.name_en.trim()) {
      notify('Category English name is required.', 'error');
      return;
    }
    setSavingCat(true);
    try {
      if (editingCat) {
        await api.put(`/engagements/committee/categories/${editingCat.id}`, catForm);
        notify('Category updated.', 'success');
      } else {
        await api.post('/engagements/committee/categories', catForm);
        notify('Category created.', 'success');
      }
      setCatModalOpen(false);
      loadMasters();
    } catch (err) {
      notify(err.response?.data?.detail || 'Failed to save category.', 'error');
    } finally {
      setSavingCat(false);
    }
  };

  // Term save
  const handleSaveTerm = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!termForm.term_name.trim()) {
      notify('Term name is required.', 'error');
      return;
    }
    setSavingTerm(true);
    try {
      if (editingTerm) {
        await api.put(`/engagements/committee/terms/${editingTerm.id}`, termForm);
        notify('Term updated.', 'success');
      } else {
        await api.post('/engagements/committee/terms', termForm);
        notify('Term created.', 'success');
      }
      setTermModalOpen(false);
      loadMasters();
    } catch (err) {
      notify(err.response?.data?.detail || 'Failed to save term.', 'error');
    } finally {
      setSavingTerm(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls & Filter Bar */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedCategoryFilter}
            onChange={(e) => setSelectedCategoryFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
          >
            <option value="ALL">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_en} {c.name_kn ? `(${c.name_kn})` : ''}
              </option>
            ))}
          </select>

          <select
            value={selectedTermFilter}
            onChange={(e) => setSelectedTermFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
          >
            <option value="ALL">All Terms</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.term_name} {t.is_current ? '(Current)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          {canWrite && (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditingCat(null);
                  setCatForm({ name_en: '', name_kn: '', display_on_website: true });
                  setCatModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#FAF7F2] hover:bg-[#E8DFD8] text-[#180200] text-xs font-semibold rounded-xl border border-[#E8DFD8] transition-colors cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5 text-[#510601]" />
                <span>Manage Categories</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEditingTerm(null);
                  setTermForm({ term_name: '', start_date: '', end_date: '', is_current: false });
                  setTermModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#FAF7F2] hover:bg-[#E8DFD8] text-[#180200] text-xs font-semibold rounded-xl border border-[#E8DFD8] transition-colors cursor-pointer"
              >
                <Calendar className="w-3.5 h-3.5 text-[#510601]" />
                <span>Manage Terms</span>
              </button>

              <button
                type="button"
                onClick={openAddMember}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl shadow-sm transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add Member</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Roster Table */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-[#863221]">
            <Loader2 className="w-6 h-6 animate-spin text-[#510601] mx-auto mb-2" />
            <span>Loading committee roster...</span>
          </div>
        ) : committeeMembers.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#863221]">
            <Shield className="w-10 h-10 text-[#863221]/40 mx-auto mb-2" />
            <p className="font-semibold text-[#180200]">No committee members found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#FAF7F2] text-[#863221] text-[10px] uppercase font-bold tracking-wider border-b border-[#E8DFD8]">
                  <th className="px-4 py-3">Member Name</th>
                  <th className="px-4 py-3">Designation</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Term</th>
                  <th className="px-4 py-3">Havyaka Member Link</th>
                  <th className="px-4 py-3">Website Display</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {committeeMembers.map((m) => (
                  <tr key={m.id} className="hover:bg-[#FAF7F2]/50 transition-colors">
                    <td className="px-4 py-3 font-bold text-[#180200]">{m.member_name}</td>
                    <td className="px-4 py-3 text-[#863221] font-semibold">{m.designation || '—'}</td>
                    <td className="px-4 py-3 text-[#180200]">
                      <div>{m.category_name_en || '—'}</div>
                      {m.subcategory_name_en && (
                        <div className="text-[11px] text-[#863221]">{m.subcategory_name_en}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#180200]">{m.term_name || '—'}</td>
                    <td className="px-4 py-3">
                      {m.hms_member_id ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-semibold">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>{m.hms_member_name || `ID ${m.hms_member_id}`}</span>
                          {m.hms_member_code && <span className="font-mono">({m.hms_member_code})</span>}
                        </span>
                      ) : (
                        <span className="text-[#863221]/50 text-[11px]">External</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          m.display_on_website
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-stone-100 text-stone-500'
                        }`}
                      >
                        {m.display_on_website ? 'Displayed' : 'Hidden'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditMember(m)}
                            className="p-1.5 text-[#863221] hover:text-[#510601] hover:bg-[#FAF7F2] rounded-lg transition-colors cursor-pointer"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => handleDeleteMember(m)}
                            className="p-1.5 text-[#ED4636] hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            title="Remove"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Add / Edit Committee Member */}
      <Modal isOpen={memberModalOpen} onClose={() => setMemberModalOpen(false)}>
        <div className="bg-white rounded-2xl max-w-lg w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2]">
            <h3 className="text-base font-bold text-[#180200]">
              {editingMember ? 'Edit Committee Member' : 'Add Committee Member'}
            </h3>
            <button
              type="button"
              onClick={() => setMemberModalOpen(false)}
              className="p-1.5 rounded-lg text-[#863221] hover:bg-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={handleSaveMember} className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Category <span className="text-[#ED4636]">*</span>
                </label>
                <select
                  required
                  value={memberForm.category_id}
                  onChange={(e) => setMemberForm({ ...memberForm, category_id: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
                >
                  <option value="">Select Category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name_en}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Term
                </label>
                <select
                  value={memberForm.term_id}
                  onChange={(e) => setMemberForm({ ...memberForm, term_id: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
                >
                  <option value="">Select Term</option>
                  {terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.term_name} {t.is_current ? '(Current)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Subcategory optional */}
            {subcategories.filter((s) => String(s.category_id) === String(memberForm.category_id)).length > 0 && (
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Sub-Category
                </label>
                <select
                  value={memberForm.subcategory_id}
                  onChange={(e) => setMemberForm({ ...memberForm, subcategory_id: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
                >
                  <option value="">Select Subcategory (Optional)</option>
                  {subcategories
                    .filter((s) => String(s.category_id) === String(memberForm.category_id))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name_en}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {/* Is Havyaka Member Toggle */}
            <div className="rounded-xl border border-[#E8DFD8] bg-[#FAF7F2] p-3">
              <label className="flex items-center gap-2 text-xs font-bold text-[#180200] cursor-pointer">
                <input
                  type="checkbox"
                  checked={memberForm.is_hms_member}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setMemberForm({
                      ...memberForm,
                      is_hms_member: checked,
                      hms_member_id: checked ? memberForm.hms_member_id : null,
                      hms_member_name: checked ? memberForm.hms_member_name : '',
                      hms_member_code: checked ? memberForm.hms_member_code : '',
                    });
                  }}
                  className="accent-[#510601] w-4 h-4 rounded"
                />
                <span>Is this person a registered Havyaka Member?</span>
              </label>

              {memberForm.is_hms_member && (
                <div className="mt-3 ml-6 space-y-2">
                  {memberForm.hms_member_id ? (
                    <div className="flex items-center justify-between bg-white border border-emerald-300 rounded-lg p-2.5">
                      <div>
                        <p className="text-xs font-bold text-[#180200]">{memberForm.hms_member_name}</p>
                        <p className="text-[11px] text-[#863221]">
                          Membership: {memberForm.hms_member_code || `ID ${memberForm.hms_member_id}`}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setMemberForm((prev) => ({
                            ...prev,
                            hms_member_id: null,
                            hms_member_name: '',
                            hms_member_code: '',
                            member_name: '',
                          }))
                        }
                        className="text-xs text-[#ED4636] hover:underline"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-[#863221]/60 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          placeholder="Type member name, membership number or phone..."
                          value={hmsSearchQuery}
                          onChange={(e) => handleSearchHmsMembers(e.target.value)}
                          className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-[#E8DFD8] rounded-lg text-[#180200] focus:outline-none focus:border-[#510601]"
                        />
                      </div>

                      {searchingHms && (
                        <p className="text-[11px] text-[#863221] flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Searching members...
                        </p>
                      )}

                      {hmsSearchResults.length > 0 && (
                        <div className="border border-[#E8DFD8] rounded-lg bg-white max-h-40 overflow-y-auto divide-y divide-[#E8DFD8]">
                          {hmsSearchResults.map((m) => {
                            const name = `${m.first_name_en || ''} ${m.last_name_en || ''}`.trim() || m.full_name_kn;
                            const code = m.membership_number || m.member_code;
                            return (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => handleSelectHmsMember(m)}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-[#FAF7F2] flex items-center justify-between"
                              >
                                <div>
                                  <p className="font-semibold text-[#180200]">{name}</p>
                                  <p className="text-[10px] text-[#863221]">
                                    {code ? `No: ${code}` : `App ID ${m.id}`}
                                    {m.mobile ? ` · 📞 ${m.mobile}` : ''}
                                  </p>
                                </div>
                                <span className="text-[11px] font-bold text-[#510601]">Select</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Member Full Name <span className="text-[#ED4636]">*</span>
              </label>
              <input
                type="text"
                required
                value={memberForm.member_name}
                onChange={(e) => setMemberForm({ ...memberForm, member_name: e.target.value })}
                placeholder="Full Name"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                Designation / Office Held
              </label>
              <input
                type="text"
                value={memberForm.designation}
                onChange={(e) => setMemberForm({ ...memberForm, designation: e.target.value })}
                placeholder="e.g. Vice President / Director / Joint Secretary"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="mem_web_disp"
                checked={memberForm.display_on_website}
                onChange={(e) => setMemberForm({ ...memberForm, display_on_website: e.target.checked })}
                className="accent-[#510601] w-4 h-4 rounded"
              />
              <label htmlFor="mem_web_disp" className="text-xs font-bold text-[#180200] cursor-pointer">
                Display on public website committee page
              </label>
            </div>

            <ModalFooter
              kind={editingMember ? 'edit' : 'add'}
              submitLabel={editingMember ? 'Update' : 'Save'}
              busyLabel={editingMember ? 'Updating...' : 'Saving...'}
              busy={savingMember}
              onSubmit={handleSaveMember}
              onCancel={() => setMemberModalOpen(false)}
            />
          </form>
        </div>
      </Modal>

      {/* Modal: Category Setup */}
      <Modal isOpen={catModalOpen} onClose={() => setCatModalOpen(false)}>
        <div className="bg-white rounded-2xl max-w-lg w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
          <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2]">
            <h3 className="text-base font-bold text-[#180200]">Committee Categories</h3>
            <button
              type="button"
              onClick={() => setCatModalOpen(false)}
              className="p-1.5 rounded-lg text-[#863221] hover:bg-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6 space-y-4 flex-1 overflow-y-auto">
            {/* Existing categories list */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-[#180200] uppercase tracking-wider">
                Current Categories ({categories.length})
              </h4>
              <div className="border border-[#E8DFD8] rounded-xl divide-y divide-[#E8DFD8] max-h-48 overflow-y-auto">
                {categories.map((c) => (
                  <div key={c.id} className="p-2.5 flex items-center justify-between text-xs hover:bg-[#FAF7F2]">
                    <div>
                      <p className="font-semibold text-[#180200]">{c.name_en}</p>
                      {c.name_kn && <p className="text-[11px] text-[#863221]">{c.name_kn}</p>}
                    </div>
                    <span className="text-[10px] text-stone-500">
                      {c.display_on_website ? 'Website: Yes' : 'Website: No'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Add New Category Form */}
            <form onSubmit={handleSaveCategory} className="border-t border-[#E8DFD8] pt-4 space-y-3">
              <h4 className="text-xs font-bold text-[#180200] uppercase tracking-wider">
                Add New Category
              </h4>
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Category Name (English) <span className="text-[#ED4636]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={catForm.name_en}
                  onChange={(e) => setCatForm({ ...catForm, name_en: e.target.value })}
                  placeholder="e.g. Bangalore Region / Executive Council"
                  className="w-full px-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Category Name (Kannada)
                </label>
                <input
                  type="text"
                  value={catForm.name_kn}
                  onChange={(e) => setCatForm({ ...catForm, name_kn: e.target.value })}
                  placeholder="e.g. ಬೆಂಗಳೂರು ಕ್ಷೇತ್ರ"
                  className="w-full px-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="cat_web_disp"
                  checked={catForm.display_on_website}
                  onChange={(e) => setCatForm({ ...catForm, display_on_website: e.target.checked })}
                  className="accent-[#510601] w-4 h-4 rounded"
                />
                <label htmlFor="cat_web_disp" className="text-xs font-bold text-[#180200] cursor-pointer">
                  Display on website
                </label>
              </div>
              <button
                type="submit"
                disabled={savingCat}
                className="w-full py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-40"
              >
                {savingCat ? 'Saving...' : 'Add Category'}
              </button>
            </form>
          </div>
        </div>
      </Modal>

      {/* Modal: Term Setup */}
      <Modal isOpen={termModalOpen} onClose={() => setTermModalOpen(false)}>
        <div className="bg-white rounded-2xl max-w-lg w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
          <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2]">
            <h3 className="text-base font-bold text-[#180200]">Committee Terms</h3>
            <button
              type="button"
              onClick={() => setTermModalOpen(false)}
              className="p-1.5 rounded-lg text-[#863221] hover:bg-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6 space-y-4 flex-1 overflow-y-auto">
            {/* Existing terms list */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-[#180200] uppercase tracking-wider">
                Current Terms ({terms.length})
              </h4>
              <div className="border border-[#E8DFD8] rounded-xl divide-y divide-[#E8DFD8] max-h-48 overflow-y-auto">
                {terms.map((t) => (
                  <div key={t.id} className="p-2.5 flex items-center justify-between text-xs hover:bg-[#FAF7F2]">
                    <div>
                      <p className="font-semibold text-[#180200]">{t.term_name}</p>
                      <p className="text-[11px] text-[#863221]">
                        {t.start_date || '—'} to {t.end_date || '—'}
                      </p>
                    </div>
                    {t.is_current && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                        Current Term
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Add New Term Form */}
            <form onSubmit={handleSaveTerm} className="border-t border-[#E8DFD8] pt-4 space-y-3">
              <h4 className="text-xs font-bold text-[#180200] uppercase tracking-wider">
                Add New Term
              </h4>
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Term Name <span className="text-[#ED4636]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={termForm.term_name}
                  onChange={(e) => setTermForm({ ...termForm, term_name: e.target.value })}
                  placeholder="e.g. 2024–2027 Term"
                  className="w-full px-3 py-2 text-xs bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                    Start Date
                  </label>
                  <DateInput
                    value={termForm.start_date}
                    onChange={(e) => setTermForm({ ...termForm, start_date: e.target.value })}
                    placeholder="DD-MM-YYYY"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                    End Date
                  </label>
                  <DateInput
                    value={termForm.end_date}
                    onChange={(e) => setTermForm({ ...termForm, end_date: e.target.value })}
                    placeholder="DD-MM-YYYY"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="term_is_curr"
                  checked={termForm.is_current}
                  onChange={(e) => setTermForm({ ...termForm, is_current: e.target.checked })}
                  className="accent-[#510601] w-4 h-4 rounded"
                />
                <label htmlFor="term_is_curr" className="text-xs font-bold text-[#180200] cursor-pointer">
                  Mark as Current Active Term
                </label>
              </div>
              <button
                type="submit"
                disabled={savingTerm}
                className="w-full py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-40"
              >
                {savingTerm ? 'Saving...' : 'Add Term'}
              </button>
            </form>
          </div>
        </div>
      </Modal>
    </div>
  );
}
