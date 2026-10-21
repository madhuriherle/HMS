import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  MapPin,
  Plus,
  Pencil,
  Trash2,
  FileText,
  Upload,
  Send,
  Award,
  Search,
  Users,
  CheckCircle2,
  X,
  Loader2,
  Download,
} from 'lucide-react';
import api from '../api';
import useAuth from '../hooks/useAuth';
import Modal from '../components/Modal';
import ModalFooter from '../components/ModalFooter';
import SearchFilterBar from '../components/SearchFilterBar';
import DateInput from '../components/DateInput';
import PermissionGate from '../components/PermissionGate';
import Pager from '../components/Pager';
import { formatDate, getTodayISODate } from '../utils/dateUtils';
import { notify } from '../utils/notify';
import Swal from 'sweetalert2';
import { memberName } from '../utils/memberName';

export default function EventsManagement() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('events.write');
  const canDelete = hasPermission('events.delete');
  const canNotify = hasPermission('notifications.write') || canWrite;

  // ── Event list state ──────────────────────────────────────────
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // ── Filter state ──────────────────────────────────────────────
  const [filterTab, setFilterTab] = useState('upcoming'); // 'upcoming' | 'past' | 'all'
  const [searchQuery, setSearchQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // ── Create / Edit Event Modal ─────────────────────────────────
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null); // null for create, event obj for edit
  const [eventForm, setEventForm] = useState({
    title: '',
    event_date: '',
    location: '',
    description: '',
  });
  const [savingEvent, setSavingEvent] = useState(false);

  // ── Event Detail Modal (Guests, Honours, Files, Notification) ─
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [eventDetail, setEventDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [, setDetailTab] = useState('participants'); // 'participants' | 'invitation'

  // ── Participant Modal (Add / Edit Guest or Honoured Person) ────
  const [participantModalOpen, setParticipantModalOpen] = useState(false);
  const [editingParticipant, setEditingParticipant] = useState(null);
  const [participantForm, setParticipantForm] = useState({
    participant_name: '',
    participant_role: '',
    participant_type: 'GUEST',
    is_member: false,
    member_id: null,
    member_name: '',
    member_code: '',
  });
  const [savingParticipant, setSavingParticipant] = useState(false);

  // ── Member Search for Participant ─────────────────────────────
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [memberSearchResults, setMemberSearchResults] = useState([]);
  const [searchingMembers, setSearchingMembers] = useState(false);

  // ── Invitation File Upload ────────────────────────────────────
  const [uploadingInvitation, setUploadingInvitation] = useState(false);

  // ── WhatsApp Notification Modal ───────────────────────────────
  const [notifyModalOpen, setNotifyModalOpen] = useState(false);
  const [notifyMessage, setNotifyMessage] = useState('');
  const [sendingNotify, setSendingNotify] = useState(false);

  // ── Load Events ───────────────────────────────────────────────
  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page,
        limit: pageSize,
      };
      if (filterTab === 'upcoming') {
        params.upcoming_only = true;
      }
      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      if (fromDate) {
        params.from_date = fromDate;
      }
      if (toDate) {
        params.to_date = toDate;
      }

      const res = await api.get('/events/', { params });
      let eventItems = [];
      let totalCount = 0;

      if (res.data?.data && Array.isArray(res.data.data)) {
        eventItems = res.data.data;
        totalCount = res.data.total ?? eventItems.length;
      } else if (Array.isArray(res.data)) {
        eventItems = res.data;
        totalCount = eventItems.length;
      }

      // If 'past' filter, filter client-side if needed
      if (filterTab === 'past') {
        const today = getTodayISODate();
        eventItems = eventItems.filter((e) => (e.event_date || '') < today);
        totalCount = eventItems.length;
      }

      setEvents(eventItems);
      setTotal(totalCount);
    } catch (err) {
      console.error('Failed to load events:', err);
      notify(err.response?.data?.detail || 'Could not load events.', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filterTab, searchQuery, fromDate, toDate]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // ── Load Event Detail ─────────────────────────────────────────
  const loadEventDetail = useCallback(async (id) => {
    if (!id) return;
    setLoadingDetail(true);
    try {
      const res = await api.get(`/events/${id}/detail`);
      setEventDetail(res.data);
    } catch (err) {
      console.error('Failed to load event detail:', err);
      notify(err.response?.data?.detail || 'Could not load event detail.', 'error');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const openDetailModal = (eventItem) => {
    setSelectedEventId(eventItem.id);
    setDetailTab('participants');
    setDetailModalOpen(true);
    loadEventDetail(eventItem.id);
  };

  // ── Create / Edit Event Handlers ──────────────────────────────
  const openCreateModal = () => {
    setEditingEvent(null);
    setEventForm({
      title: '',
      event_date: '',
      end_date: '',
      location: '',
      description: '',
    });
    setEventModalOpen(true);
  };

  const openEditModal = (eventItem) => {
    setEditingEvent(eventItem);
    setEventForm({
      title: eventItem.title || '',
      event_date: eventItem.event_date || '',
      end_date: eventItem.end_date || '',
      location: eventItem.location || '',
      description: eventItem.description || '',
    });
    setEventModalOpen(true);
  };

  const handleSaveEvent = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!eventForm.title.trim()) {
      notify('Event title is required.', 'error');
      return;
    }
    if (!eventForm.event_date) {
      notify('Event date is required.', 'error');
      return;
    }

    if (eventForm.end_date && eventForm.end_date < eventForm.event_date) {
      notify('The last day cannot be before the first day.', 'error');
      return;
    }

    setSavingEvent(true);
    try {
      if (editingEvent) {
        await api.put(`/events/${editingEvent.id}`, {
          title: eventForm.title.trim(),
          event_date: eventForm.event_date,
          end_date: eventForm.end_date || null,
          location: eventForm.location.trim() || null,
          description: eventForm.description.trim() || null,
        });
        notify('Event updated successfully.', 'success');
      } else {
        await api.post('/events/', {
          title: eventForm.title.trim(),
          event_date: eventForm.event_date,
          end_date: eventForm.end_date || null,
          location: eventForm.location.trim() || null,
          description: eventForm.description.trim() || null,
        });
        notify('Event created successfully.', 'success');
      }
      setEventModalOpen(false);
      loadEvents();
      if (selectedEventId && editingEvent && selectedEventId === editingEvent.id) {
        loadEventDetail(selectedEventId);
      }
    } catch (err) {
      console.error('Save event failed:', err);
      notify(err.response?.data?.detail || 'Failed to save event.', 'error');
    } finally {
      setSavingEvent(false);
    }
  };

  // ── Delete Event Handler ──────────────────────────────────────
  const handleDeleteEvent = async (eventItem) => {
    const result = await Swal.fire({
      title: 'Delete Event?',
      text: `Are you sure you want to delete "${eventItem.title}"?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, delete',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#ED4636',
      cancelButtonColor: '#863221',
      reverseButtons: true,
      customClass: { popup: 'hms-mini-swal' },
    });

    if (result.isConfirmed) {
      try {
        await api.delete(`/events/${eventItem.id}`, { params: { force: true } });
        notify('Event deleted successfully.', 'success');
        if (selectedEventId === eventItem.id) {
          setDetailModalOpen(false);
        }
        loadEvents();
      } catch (err) {
        console.error('Delete event failed:', err);
        notify(err.response?.data?.detail || 'Failed to delete event.', 'error');
      }
    }
  };

  // ── Participant Handlers ──────────────────────────────────────
  const openAddParticipant = (defaultType = 'GUEST') => {
    setEditingParticipant(null);
    setParticipantForm({
      participant_name: '',
      participant_role: '',
      participant_type: defaultType,
      is_member: false,
      member_id: null,
      member_name: '',
      member_code: '',
    });
    setMemberSearchQuery('');
    setMemberSearchResults([]);
    setParticipantModalOpen(true);
  };

  const openEditParticipant = (p) => {
    setEditingParticipant(p);
    setParticipantForm({
      participant_name: p.name || '',
      participant_role: p.role || '',
      participant_type: p.participant_type || (eventDetail?.honoured?.some(h => h.id === p.id) ? 'HONOURED' : 'GUEST'),
      is_member: Boolean(p.member_id),
      member_id: p.member_id || null,
      member_name: p.member_name || '',
      member_code: '',
    });
    setMemberSearchQuery('');
    setMemberSearchResults([]);
    setParticipantModalOpen(true);
  };

  const handleSearchMembers = async (q) => {
    setMemberSearchQuery(q);
    if (!q || q.trim().length < 2) {
      setMemberSearchResults([]);
      return;
    }
    setSearchingMembers(true);
    try {
      const res = await api.get('/members/', {
        params: { search: q.trim(), limit: 8 },
      });
      const items = res.data?.data || res.data || [];
      setMemberSearchResults(items);
    } catch {
      setMemberSearchResults([]);
    } finally {
      setSearchingMembers(false);
    }
  };

  const handleSelectMember = (m) => {
    const fullName = memberName(m) || m.full_name_kn || 'Member';
    const code = m.membership_number || m.member_code || '';
    setParticipantForm((prev) => ({
      ...prev,
      member_id: m.id,
      member_name: fullName,
      member_code: code,
      participant_name: fullName,
    }));
    setMemberSearchResults([]);
    setMemberSearchQuery('');
  };

  const handleClearSelectedMember = () => {
    setParticipantForm((prev) => ({
      ...prev,
      member_id: null,
      member_name: '',
      member_code: '',
      participant_name: '',
    }));
  };

  const handleSaveParticipant = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!participantForm.participant_name.trim()) {
      notify('Participant name is required.', 'error');
      return;
    }

    setSavingParticipant(true);
    try {
      const payload = {
        participant_name: participantForm.participant_name.trim(),
        participant_role: participantForm.participant_role.trim() || null,
        participant_type: participantForm.participant_type,
        member_id: participantForm.is_member ? participantForm.member_id : null,
      };

      if (editingParticipant) {
        await api.put(`/events/${selectedEventId}/participants/${editingParticipant.id}`, payload);
        notify('Participant updated successfully.', 'success');
      } else {
        await api.post(`/events/${selectedEventId}/participants`, payload);
        notify(
          participantForm.is_member
            ? 'Participant added and linked to Havyaka Member.'
            : 'Participant added.',
          'success'
        );
      }
      setParticipantModalOpen(false);
      loadEventDetail(selectedEventId);
    } catch (err) {
      console.error('Save participant failed:', err);
      notify(err.response?.data?.detail || 'Failed to save participant.', 'error');
    } finally {
      setSavingParticipant(false);
    }
  };

  const handleDeleteParticipant = async (participantId, participantName) => {
    const result = await Swal.fire({
      title: 'Remove Participant?',
      text: `Remove "${participantName}" from this event?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, remove',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#ED4636',
      cancelButtonColor: '#863221',
      reverseButtons: true,
      customClass: { popup: 'hms-mini-swal' },
    });

    if (result.isConfirmed) {
      try {
        await api.delete(`/events/${selectedEventId}/participants/${participantId}`);
        notify('Participant removed.', 'success');
        loadEventDetail(selectedEventId);
      } catch (err) {
        console.error('Delete participant failed:', err);
        notify(err.response?.data?.detail || 'Failed to remove participant.', 'error');
      }
    }
  };

  // ── Invitation File Upload Handler ────────────────────────────
  const handleInvitationUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedEventId) return;

    const formData = new FormData();
    formData.append('file', file);

    setUploadingInvitation(true);
    try {
      await api.post(`/events/${selectedEventId}/invitation`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      notify('Invitation copy uploaded successfully.', 'success');
      loadEventDetail(selectedEventId);
      loadEvents();
    } catch (err) {
      console.error('Upload invitation failed:', err);
      notify(err.response?.data?.detail || 'Failed to upload invitation file.', 'error');
    } finally {
      setUploadingInvitation(false);
      e.target.value = '';
    }
  };

  // ── Notification Modal & Trigger ──────────────────────────────
  const openNotifyModal = () => {
    if (!eventDetail?.event) return;
    const title = eventDetail.event.title || 'the event';
    const dateStr = eventDetail.event.event_date ? formatDate(eventDetail.event.event_date) : '';
    const loc = eventDetail.event.location || '';
    const defaultMsg = `Sri Akhila Havyaka Mahasabha cordially invites you to ${title}${dateStr ? ` on ${dateStr}` : ''}${loc ? ` at ${loc}` : ''}.`;
    setNotifyMessage(defaultMsg);
    setNotifyModalOpen(true);
  };

  const handleSendNotification = async () => {
    if (!selectedEventId) return;
    if (!notifyMessage.trim()) {
      notify('Notification message is required.', 'error');
      return;
    }

    setSendingNotify(true);
    try {
      const res = await api.post(`/events/${selectedEventId}/notify`, null, {
        params: { message: notifyMessage.trim() },
      });
      notify(res.data?.message || 'Notifications queued successfully.', 'success');
      setNotifyModalOpen(false);
    } catch (err) {
      console.error('Send notification failed:', err);
      notify(err.response?.data?.detail || 'Failed to dispatch notifications.', 'error');
    } finally {
      setSendingNotify(false);
    }
  };

  // Helper to open file
  const handleDownloadFile = async (path, filename = 'invitation') => {
    try {
      const res = await api.get('/system/files', {
        params: { path },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download file failed:', err);
      notify('Could not download file.', 'error');
    }
  };

  // ── Reset Filters ─────────────────────────────────────────────
  const handleResetFilters = () => {
    setFilterTab('upcoming');
    setSearchQuery('');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  const activeFiltersCount = (filterTab !== 'upcoming' ? 1 : 0) + (fromDate ? 1 : 0) + (toDate ? 1 : 0);

  return (
    <PermissionGate required="events.read" title="Access Restricted" message="You need the Events privilege to view this page.">
      <div className="space-y-6 pb-12">
        {/* Page Header and Search */}
        <SearchFilterBar
          title="Events"
          searchQuery={searchQuery}
          onSearchChange={(q) => { setSearchQuery(q); setPage(1); }}
          searchPlaceholder="Search events by title or location..."
          activeFiltersCount={activeFiltersCount}
          onResetFilters={handleResetFilters}
          searchInHeader={true}
          rightSlot={
            canWrite && (
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl shadow-sm transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add Event</span>
              </button>
            )
          }
        >
          {/* Filter Bar Row under Header */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl bg-[#FAF7F2] p-1 border border-[#E8DFD8]">
              <button
                type="button"
                onClick={() => { setFilterTab('upcoming'); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  filterTab === 'upcoming'
                    ? 'bg-[#510601] text-white shadow-2xs'
                    : 'text-[#863221] hover:text-[#510601]'
                }`}
              >
                Upcoming Events
              </button>
              <button
                type="button"
                onClick={() => { setFilterTab('past'); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  filterTab === 'past'
                    ? 'bg-[#510601] text-white shadow-2xs'
                    : 'text-[#863221] hover:text-[#510601]'
                }`}
              >
                Past Events
              </button>
              <button
                type="button"
                onClick={() => { setFilterTab('all'); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  filterTab === 'all'
                    ? 'bg-[#510601] text-white shadow-2xs'
                    : 'text-[#863221] hover:text-[#510601]'
                }`}
              >
                All Events
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-[#863221] font-medium">From:</span>
              <DateInput
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
                placeholder="From Date"
                className="w-32"
              />
              <span className="text-xs text-[#863221] font-medium">To:</span>
              <DateInput
                value={toDate}
                onChange={(e) => { setToDate(e.target.value); setPage(1); }}
                placeholder="To Date"
                className="w-32"
              />
            </div>
          </div>
        </SearchFilterBar>

        {/* Events Table Container */}
        <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-20 text-center text-sm text-[#863221]">
              <Loader2 className="w-6 h-6 animate-spin text-[#510601] mx-auto mb-2" />
              <span>Loading events...</span>
            </div>
          ) : events.length === 0 ? (
            <div className="py-16 text-center text-sm text-[#863221]">
              <Calendar className="w-10 h-10 text-[#863221]/40 mx-auto mb-2" />
              <p className="font-semibold text-[#180200]">No events found</p>
              <p className="text-xs text-[#863221]/70 mt-1">
                {searchQuery || fromDate || toDate
                  ? 'Try adjusting your search query or date filters.'
                  : 'Get started by creating your first event.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="px-4 py-3">Event Date</th>
                    <th className="px-4 py-3">Event Title & Details</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3">Invitation Copy</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8DFD8]">
                  {events.map((e) => {
                    const isUpcoming = e.event_date && (e.end_date || e.event_date) >= getTodayISODate();
                    return (
                      <tr key={e.id} className="hover:bg-[#FAF7F2]/50 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap align-top">
                          <div className="flex items-center gap-1.5 font-medium text-[#180200]">
                            <Calendar className="w-3.5 h-3.5 text-[#510601]" />
                            <span>{e.event_date ? formatDate(e.event_date) : '—'}{e.end_date && e.end_date !== e.event_date ? ` to ${formatDate(e.end_date)}` : ''}</span>
                          </div>
                          <span
                            className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isUpcoming
                                ? 'bg-[#3D705C]/15 text-[#3D705C]'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {isUpcoming ? 'Upcoming' : 'Past'}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top max-w-sm">
                          <p className="font-bold text-sm text-[#180200]">{e.title}</p>
                          {e.description && (
                            <p className="text-xs text-[#863221]/80 mt-0.5 line-clamp-2">
                              {e.description}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {e.location ? (
                            <div className="flex items-start gap-1 text-[#180200]">
                              <MapPin className="w-3.5 h-3.5 text-[#863221] shrink-0 mt-0.5" />
                              <span>{e.location}</span>
                            </div>
                          ) : (
                            <span className="text-[#863221]/50">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {e.invitation_file_path ? (
                            <button
                              type="button"
                              onClick={() => handleDownloadFile(e.invitation_file_path, `${e.title}_invitation`)}
                              className="inline-flex items-center gap-1 text-[#510601] hover:text-[#8C1801] font-semibold underline underline-offset-2 cursor-pointer"
                              title="Download invitation copy"
                            >
                              <FileText className="w-3.5 h-3.5 text-[#510601]" />
                              <span>View Copy</span>
                            </button>
                          ) : (
                            <span className="text-[#863221]/50 italic text-[11px]">Not uploaded</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            <button
                              type="button"
                              onClick={() => openDetailModal(e)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-[#FAF7F2] hover:bg-[#E8DFD8] text-[#510601] font-semibold rounded-lg text-xs transition-colors cursor-pointer"
                              title="Add guests and honoured persons, and send the event notification"
                            >
                              <Users className="w-3.5 h-3.5" />
                              <span>Guests &amp; Send</span>
                            </button>
                            {canWrite && (
                              <button
                                type="button"
                                onClick={() => openEditModal(e)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-[#FAF7F2] hover:bg-[#E8DFD8] text-[#510601] font-semibold rounded-lg text-xs transition-colors cursor-pointer"
                                title="Edit event"
                              >
                                <Pencil className="w-3.5 h-3.5" /><span>Edit</span>
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => handleDeleteEvent(e)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-[#ED4636] font-semibold rounded-lg text-xs transition-colors cursor-pointer"
                                title="Delete event"
                              >
                                <Trash2 className="w-3.5 h-3.5" /><span>Delete</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination bar */}
          {total > 0 && (
            <div className="p-4 border-t border-[#E8DFD8] bg-[#FAF7F2]/40">
              <Pager
                page={page}
                pages={Math.max(1, Math.ceil(total / pageSize))}
                total={total}
                pageSize={pageSize}
                onPage={setPage}
                onPageSize={(s) => { setPageSize(s); setPage(1); }}
              />
            </div>
          )}
        </div>

        {/* ── CREATE / EDIT EVENT MODAL ───────────────────────── */}
        <Modal isOpen={eventModalOpen} onClose={() => setEventModalOpen(false)}>
          <div className="bg-white rounded-2xl max-w-lg w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
              <h3 className="text-base font-bold text-[#180200]">
                {editingEvent ? 'Edit Event' : 'Add New Event'}
              </h3>
              <button
                type="button"
                onClick={() => setEventModalOpen(false)}
                className="p-1.5 rounded-lg text-[#863221] hover:bg-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEvent} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Event Title <span className="text-[#ED4636]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={eventForm.title}
                  onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Event Date <span className="text-[#ED4636]">*</span>
                </label>
                <DateInput
                  value={eventForm.event_date}
                  onChange={(e) => setEventForm({ ...eventForm, event_date: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Last Day
                </label>
                <DateInput
                  value={eventForm.end_date}
                  onChange={(e) => setEventForm({ ...eventForm, end_date: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Location / Venue
                </label>
                <input
                  type="text"
                  value={eventForm.location}
                  onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Description / Agenda Notes
                </label>
                <textarea
                  rows={3}
                  value={eventForm.description}
                  onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
                />
              </div>

              <ModalFooter
                inForm
                kind={editingEvent ? 'edit' : 'add'}
                submitLabel={editingEvent ? 'Update' : 'Save'}
                busyLabel={editingEvent ? 'Updating...' : 'Saving...'}
                busy={savingEvent}
                onSubmit={handleSaveEvent}
                onCancel={() => setEventModalOpen(false)}
              />
            </form>
          </div>
        </Modal>

        {/* ── EVENT DETAIL & PARTICIPANTS MODAL ────────────────── */}
        <Modal isOpen={detailModalOpen} onClose={() => setDetailModalOpen(false)}>
          <div className="bg-white rounded-2xl max-w-4xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-[#510601]" />
                <h3 className="text-base font-bold text-[#180200]">
                  {eventDetail?.event?.title || 'Event Details'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDetailModalOpen(false)}
                className="p-1.5 rounded-lg text-[#863221] hover:bg-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingDetail ? (
              <div className="p-12 text-center text-sm text-[#863221]">
                <Loader2 className="w-6 h-6 animate-spin text-[#510601] mx-auto mb-2" />
                <span>Loading event information...</span>
              </div>
            ) : eventDetail ? (
              <div className="p-6 space-y-6 flex-1 overflow-y-auto">
                {/* Event Summary Box */}
                <div className="bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl p-4">
                  <p className="text-[11px] font-bold text-[#863221] uppercase tracking-wider mb-2">1 · Event details <span className="normal-case font-normal">(saved; change them with Edit in the events list)</span></p>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm text-[#180200] font-semibold">
                        <Calendar className="w-4 h-4 text-[#510601]" />
                        <span>Date: {eventDetail.event.event_date ? formatDate(eventDetail.event.event_date) : '—'}{eventDetail.event.end_date && eventDetail.event.end_date !== eventDetail.event.event_date ? ` to ${formatDate(eventDetail.event.end_date)}` : ''}</span>
                      </div>
                      {eventDetail.event.location && (
                        <div className="flex items-center gap-2 text-xs text-[#863221]">
                          <MapPin className="w-3.5 h-3.5 text-[#863221]" />
                          <span>Venue: {eventDetail.event.location}</span>
                        </div>
                      )}
                    </div>

                  </div>

                  {eventDetail.event.description && (
                    <p className="mt-3 text-xs text-[#863221]/90 border-t border-[#E8DFD8] pt-2">
                      {eventDetail.event.description}
                    </p>
                  )}
                </div>

                {/* Invitation Copy Upload / View Card */}
                <div className="bg-white border border-[#E8DFD8] rounded-xl p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-[#180200] uppercase tracking-wider flex items-center gap-1.5">
                        <FileText className="w-4 h-4 text-[#510601]" />
                        <span>2 · Invitation copy</span>
                      </h4>
                      <p className="text-[11px] text-[#863221] mt-0.5">
                        Official circular, pamphlet, or invitation card for this event
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {eventDetail.event.invitation_file_path ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleDownloadFile(eventDetail.event.invitation_file_path, `${eventDetail.event.title}_invitation`)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E8DFD8] hover:bg-[#FAF7F2] text-[#510601] text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download Copy</span>
                          </button>
                          {canWrite && (
                            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FAF7F2] hover:bg-[#E8DFD8] text-[#180200] text-xs font-semibold rounded-lg transition-colors cursor-pointer">
                              <Upload className="w-3.5 h-3.5 text-[#510601]" />
                              <span>{uploadingInvitation ? 'Uploading...' : 'Replace File'}</span>
                              <input
                                type="file"
                                onChange={handleInvitationUpload}
                                disabled={uploadingInvitation}
                                className="hidden"
                                accept=".pdf,.png,.jpg,.jpeg"
                              />
                            </label>
                          )}
                        </>
                      ) : (
                        canWrite && (
                          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer">
                            <Upload className="w-3.5 h-3.5" />
                            <span>{uploadingInvitation ? 'Uploading...' : 'Upload Invitation Copy'}</span>
                            <input
                              type="file"
                              onChange={handleInvitationUpload}
                              disabled={uploadingInvitation}
                              className="hidden"
                              accept=".pdf,.png,.jpg,.jpeg"
                            />
                          </label>
                        )
                      )}
                    </div>
                  </div>
                </div>

                {/* Guests & Honourable Persons Section */}
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E8DFD8] pb-2">
                    <div>
                      <h4 className="text-sm font-bold text-[#180200]">
                        3 · Guests & honourable persons
                      </h4>
                      <p className="text-xs text-[#863221]">
                        When linked to a Havyaka Member, this event automatically appears on their profile screen.
                      </p>
                    </div>

                    {canWrite && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openAddParticipant('GUEST')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Guest</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openAddParticipant('HONOURED')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#8C1801] hover:bg-[#510601] text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
                        >
                          <Award className="w-3.5 h-3.5" />
                          <span>Add Honour</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Combined list of guests and honours */}
                  {(!eventDetail.guests || eventDetail.guests.length === 0) &&
                  (!eventDetail.honoured || eventDetail.honoured.length === 0) ? (
                    <div className="py-8 text-center text-xs text-[#863221] bg-[#FAF7F2] rounded-xl border border-[#E8DFD8]">
                      No guests or honoured persons recorded for this event yet.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Honoured Persons Column */}
                      <div className="bg-[#FAF7F2]/60 border border-[#E8DFD8] rounded-xl p-3 space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[#8C1801] uppercase tracking-wider">
                          <Award className="w-4 h-4" />
                          <span>Honoured Persons ({eventDetail.honoured?.length || 0})</span>
                        </div>
                        {eventDetail.honoured?.length === 0 ? (
                          <p className="text-xs text-[#863221]/60 italic py-2">None added</p>
                        ) : (
                          <div className="space-y-2">
                            {eventDetail.honoured.map((h) => (
                              <div
                                key={h.id}
                                className="bg-white border border-[#E8DFD8] rounded-lg p-2.5 flex items-start justify-between gap-2 shadow-2xs"
                              >
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-[#180200] truncate">{h.name}</p>
                                  {h.role && (
                                    <p className="text-[11px] text-[#863221]">{h.role}</p>
                                  )}
                                  {h.member_id ? (
                                    <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-semibold">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                      <span>Havyaka Member: {h.member_name || `ID ${h.member_id}`}</span>
                                    </span>
                                  ) : (
                                    <span className="inline-block mt-1 text-[10px] text-[#863221]/70">
                                      External / Non-member
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {canWrite && (
                                    <button
                                      type="button"
                                      onClick={() => openEditParticipant(h)}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-[#510601] bg-[#FAF7F2] hover:bg-[#E8DFD8] rounded-lg transition-colors cursor-pointer"
                                      title="Edit"
                                    >
                                      <Pencil className="w-3.5 h-3.5" /><span>Edit</span>
                                    </button>
                                  )}
                                  {canDelete && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteParticipant(h.id, h.name)}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-[#ED4636] bg-red-50 hover:bg-red-100 rounded-lg transition-colors cursor-pointer"
                                      title="Remove"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" /><span>Remove</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Guests Column */}
                      <div className="bg-[#FAF7F2]/60 border border-[#E8DFD8] rounded-xl p-3 space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[#510601] uppercase tracking-wider">
                          <Users className="w-4 h-4" />
                          <span>Guests ({eventDetail.guests?.length || 0})</span>
                        </div>
                        {eventDetail.guests?.length === 0 ? (
                          <p className="text-xs text-[#863221]/60 italic py-2">None added</p>
                        ) : (
                          <div className="space-y-2">
                            {eventDetail.guests.map((g) => (
                              <div
                                key={g.id}
                                className="bg-white border border-[#E8DFD8] rounded-lg p-2.5 flex items-start justify-between gap-2 shadow-2xs"
                              >
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-[#180200] truncate">{g.name}</p>
                                  {g.role && (
                                    <p className="text-[11px] text-[#863221]">{g.role}</p>
                                  )}
                                  {g.member_id ? (
                                    <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-semibold">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                      <span>Havyaka Member: {g.member_name || `ID ${g.member_id}`}</span>
                                    </span>
                                  ) : (
                                    <span className="inline-block mt-1 text-[10px] text-[#863221]/70">
                                      External / Non-member
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {canWrite && (
                                    <button
                                      type="button"
                                      onClick={() => openEditParticipant(g)}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-[#510601] bg-[#FAF7F2] hover:bg-[#E8DFD8] rounded-lg transition-colors cursor-pointer"
                                      title="Edit"
                                    >
                                      <Pencil className="w-3.5 h-3.5" /><span>Edit</span>
                                    </button>
                                  )}
                                  {canDelete && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteParticipant(g.id, g.name)}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-[#ED4636] bg-red-50 hover:bg-red-100 rounded-lg transition-colors cursor-pointer"
                                      title="Remove"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" /><span>Remove</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Step 4: tell the people */}
                {canNotify && (
                  <div className="bg-white border border-[#E8DFD8] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-[#180200] uppercase tracking-wider flex items-center gap-1.5">
                        <Send className="w-4 h-4 text-[#510601]" />
                        <span>4 · Send notification</span>
                      </h4>
                      <p className="text-[11px] text-[#863221] mt-0.5">
                        {((eventDetail.guests || []).length + (eventDetail.honoured || []).length) > 0
                          ? 'WhatsApp the guests, honoured persons and linked members, once the list above is complete.'
                          : 'Add the guests and honoured persons first (step 3), then send.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={openNotifyModal}
                      disabled={((eventDetail.guests || []).length + (eventDetail.honoured || []).length) === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#3D705C] hover:bg-[#2d5445] text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      title="WhatsApp all linked participants & members"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Send Notification</span>
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            {/* Footer with Close button */}
            <div className="px-6 h-14 shrink-0 border-t border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-end">
              <button
                type="button"
                onClick={() => setDetailModalOpen(false)}
                className="px-4 py-2 border border-[#E8DFD8] bg-white text-[#180200] text-xs font-semibold rounded-xl hover:bg-[#FAF7F2] transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>

        {/* ── PARTICIPANT ADD / EDIT MODAL ────────────────────── */}
        <Modal isOpen={participantModalOpen} onClose={() => setParticipantModalOpen(false)}>
          <div className="bg-white rounded-2xl max-w-lg w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
              <h3 className="text-base font-bold text-[#180200]">
                {editingParticipant ? 'Edit Participant' : 'Add Participant'}
              </h3>
              <button
                type="button"
                onClick={() => setParticipantModalOpen(false)}
                className="p-1.5 rounded-lg text-[#863221] hover:bg-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveParticipant} className="p-6 space-y-4">
              {/* Type: Guest vs Honoured */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5">
                  Participant Role Category
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer text-xs font-semibold ${
                      participantForm.participant_type === 'GUEST'
                        ? 'border-[#510601] bg-[#510601]/5 text-[#510601]'
                        : 'border-[#E8DFD8] text-[#180200]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="ptype"
                      value="GUEST"
                      checked={participantForm.participant_type === 'GUEST'}
                      onChange={() => setParticipantForm({ ...participantForm, participant_type: 'GUEST' })}
                      className="accent-[#510601]"
                    />
                    <span>Guest</span>
                  </label>

                  <label
                    className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer text-xs font-semibold ${
                      participantForm.participant_type === 'HONOURED'
                        ? 'border-[#8C1801] bg-[#8C1801]/5 text-[#8C1801]'
                        : 'border-[#E8DFD8] text-[#180200]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="ptype"
                      value="HONOURED"
                      checked={participantForm.participant_type === 'HONOURED'}
                      onChange={() => setParticipantForm({ ...participantForm, participant_type: 'HONOURED' })}
                      className="accent-[#8C1801]"
                    />
                    <span>Honoured Person</span>
                  </label>
                </div>
              </div>

              {/* Is Havyaka Member Toggle */}
              <div className="rounded-xl border border-[#E8DFD8] bg-[#FAF7F2] p-3">
                <label className="flex items-center gap-2 text-xs font-bold text-[#180200] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={participantForm.is_member}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setParticipantForm({
                        ...participantForm,
                        is_member: checked,
                        member_id: checked ? participantForm.member_id : null,
                        member_name: checked ? participantForm.member_name : '',
                        member_code: checked ? participantForm.member_code : '',
                      });
                    }}
                    className="accent-[#510601] w-4 h-4 rounded"
                  />
                  <span>Is this person a registered Havyaka Member?</span>
                </label>
                <p className="text-[11px] text-[#863221] mt-1 ml-6">
                  Linking a member ensures this event will be reflected under their Profile Screen.
                </p>

                {participantForm.is_member && (
                  <div className="mt-3 ml-6 space-y-2">
                    {participantForm.member_id ? (
                      <div className="flex items-center justify-between bg-white border border-emerald-300 rounded-lg p-2.5">
                        <div>
                          <p className="text-xs font-bold text-[#180200]">{participantForm.member_name}</p>
                          <p className="text-[11px] text-[#863221]">
                            Membership: {participantForm.member_code || `ID ${participantForm.member_id}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleClearSelectedMember}
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
                            placeholder="Type member name, membership number or mobile..."
                            value={memberSearchQuery}
                            onChange={(e) => handleSearchMembers(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-[#E8DFD8] rounded-lg text-[#180200] focus:outline-none focus:border-[#510601]"
                          />
                        </div>

                        {searchingMembers && (
                          <p className="text-[11px] text-[#863221] flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> Searching members...
                          </p>
                        )}

                        {memberSearchResults.length > 0 && (
                          <div className="border border-[#E8DFD8] rounded-lg bg-white max-h-40 overflow-y-auto divide-y divide-[#E8DFD8]">
                            {memberSearchResults.map((m) => {
                              const name = memberName(m) || m.full_name_kn;
                              const code = m.membership_number || m.member_code;
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => handleSelectMember(m)}
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

              {/* Participant Name */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Participant Full Name <span className="text-[#ED4636]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={participantForm.participant_name}
                  onChange={(e) => setParticipantForm({ ...participantForm, participant_name: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
                />
              </div>

              {/* Role / Honour Details */}
              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Role / Honour Description
                </label>
                <input
                  type="text"
                  value={participantForm.participant_role}
                  onChange={(e) => setParticipantForm({ ...participantForm, participant_role: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
                />
              </div>

              <ModalFooter
                inForm
                kind={editingParticipant ? 'edit' : 'add'}
                submitLabel={editingParticipant ? 'Update' : 'Save'}
                busyLabel={editingParticipant ? 'Updating...' : 'Saving...'}
                busy={savingParticipant}
                onSubmit={handleSaveParticipant}
                onCancel={() => setParticipantModalOpen(false)}
              />
            </form>
          </div>
        </Modal>

        {/* ── NOTIFICATION MODAL ──────────────────────────────── */}
        <Modal isOpen={notifyModalOpen} onClose={() => setNotifyModalOpen(false)}>
          <div className="bg-white rounded-2xl max-w-lg w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-[#3D705C]" />
                <h3 className="text-base font-bold text-[#180200]">Send WhatsApp Notification</h3>
              </div>
              <button
                type="button"
                onClick={() => setNotifyModalOpen(false)}
                className="p-1.5 rounded-lg text-[#863221] hover:bg-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
                <p className="font-semibold">Recipients:</p>
                <p className="mt-0.5 text-[11px] text-amber-800">
                  This will queue a WhatsApp notification to all registered Havyaka Members linked as participants or organisers for this event.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1">
                  Message Content <span className="text-[#ED4636]">*</span>
                </label>
                <textarea
                  rows={4}
                  required
                  value={notifyMessage}
                  onChange={(e) => setNotifyMessage(e.target.value)}
                  placeholder="Notification message..."
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
                />
              </div>

              <ModalFooter
                inForm
                kind="confirm"
                submitLabel="Send Now"
                busyLabel="Sending..."
                busy={sendingNotify}
                onSubmit={handleSendNotification}
                onCancel={() => setNotifyModalOpen(false)}
              />
            </div>
          </div>
        </Modal>
      </div>
    </PermissionGate>
  );
}
