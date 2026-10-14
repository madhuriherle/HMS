import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import PageActions, { PageActionsSlot } from '../components/PageActions';
import Modal from '../components/Modal';
import ModalFooter from '../components/ModalFooter';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
import SearchableFormSelect from '../components/SearchableFormSelect';
import DateInput from '../components/DateInput';
import PermissionGate from '../components/PermissionGate';
import api from '../api';
import { notify } from '../utils/notify';
import { confirmYesNo } from '../utils/dialogs';
import { loadMembers, loadLocations } from '../utils/serverData';
import { formatDate } from '../utils/dateUtils';
import useAuth from '../hooks/useAuth';
import {
  BookOpen,
  Plus,
  Search,
  X,
  RefreshCw,
  Pencil,
  Trash2,
  Eye,
  Printer,
  Download,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Undo2,
  CheckCircle2,
  AlertCircle,
  FileText,
  Calendar,
  PackageCheck,
} from 'lucide-react';

// ── constants ────────────────────────────────────────────────
const DELIVERY_STATUSES = ['ACTIVE', 'PAUSED', 'STOPPED', 'CANCELLED'];
// The server only accepts these three when starting/stopping (PAUSED is set by a pause).
const SETTABLE_STATUSES = ['ACTIVE', 'STOPPED', 'CANCELLED'];
const FOLLOW_UP_STATUSES = ['PENDING', 'CONTACTED', 'RESOLVED'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CHIP_STYLES = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PAUSED: 'bg-amber-50 text-amber-700 border-amber-200',
  STOPPED: 'bg-gray-100 text-gray-600 border-gray-200',
  CANCELLED: 'bg-red-50 text-red-700 border-red-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  CONTACTED: 'bg-blue-50 text-blue-700 border-blue-200',
  RESOLVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const RECIPIENT_TYPE_CHIPS = {
  MEMBER: 'bg-slate-100 text-slate-700 border-slate-200',
  AFFILIATION: 'bg-purple-50 text-purple-700 border-purple-200',
  ASSOCIATE: 'bg-blue-50 text-blue-700 border-blue-200',
  PRESS: 'bg-rose-50 text-rose-700 border-rose-200',
};

const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);

function Chip({ value }) {
  if (!value) return <span className="text-gray-400">—</span>;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${CHIP_STYLES[value] || 'bg-stone-100 text-stone-600 border-stone-200'}`}>
      {value}
    </span>
  );
}

const INPUT = 'w-full px-3.5 py-2.5 bg-white border border-[#DFD5CC] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-lg text-sm text-[#180200] focus:outline-none';
const LABEL = 'block text-xs font-bold text-[#180200] uppercase tracking-wider mb-1.5';
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#510601] hover:bg-[#3D0400] text-white text-sm font-bold rounded-xl shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';
const BTN_OUTLINE = 'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#863221] hover:text-[#510601] hover:bg-[#FAF7F2] rounded-lg border border-[#E8DFD8] transition-colors cursor-pointer';

function FieldError({ children }) {
  if (!children) return null;
  return (
    <p className="mt-1 text-xs text-red-600 flex items-center gap-1 font-medium">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function ModalShell({ title, children, footer }) {
  return (
    <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-[#E8DFD8] overflow-hidden max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
      <div className="px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-between">
        <h3 className="text-lg font-bold text-[#180200]">{title}</h3>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
      {footer}
    </div>
  );
}

function Pager({ page, pages, total, pageSize, onPage, onPageSize }) {
  const totalPages = pages || 1;
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-stone-200 bg-[#FAF7F2]/60 px-4 py-3 text-xs text-gray-600">
      <div>
        Showing <span className="font-semibold">{total}</span> record{total === 1 ? '' : 's'}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Rows per page:</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="rounded border border-stone-200 bg-white px-2 py-1 text-xs focus:outline-none"
        >
          {[5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <div className="ml-2 flex items-center space-x-1">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            className="rounded border border-stone-200 bg-white p-1 text-gray-600 hover:bg-stone-50 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-2 font-medium text-gray-800">{page} / {totalPages}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
            className="rounded border border-stone-200 bg-white p-1 text-gray-600 hover:bg-stone-50 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyRow({ colSpan, icon: Icon, title, hint }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-12 text-center text-gray-500">
        <div className="flex flex-col items-center justify-center space-y-2">
          {Icon && <Icon className="h-10 w-10 text-stone-300" />}
          <p className="text-base font-medium text-gray-700">{title}</p>
          {hint && <p className="text-xs text-gray-500">{hint}</p>}
        </div>
      </td>
    </tr>
  );
}

const TH = ({ children, className = '' }) => (
  <th className={`px-4 py-3.5 ${className}`}>{children}</th>
);

// ── page ─────────────────────────────────────────────────────
export default function MagazineManagement() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('magazines.write');
  const canDelete = hasPermission('magazines.delete');

  // the sidebar picks the section; each one is its own page
  const { pathname } = useLocation();
  const tab = pathname.includes('/pauses-returns') ? 'pauses-returns' : pathname.includes('/labels-delivery') ? 'labels-delivery' : 'subscriptions';
  const sectionTitle = { subscriptions: 'Subscriptions', 'pauses-returns': 'Pauses & Returns', 'labels-delivery': 'Labels & Delivery' }[tab];
  const [members, setMembers] = useState([]);
  const [locations, setLocations] = useState({ states: [], districts: [], taluks: [] });

  // subscriptions are shared: the pause/return pickers need the same list
  const [subscriptions, setSubscriptions] = useState([]);
  const [unsubscribedPaid, setUnsubscribedPaid] = useState([]);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const memberById = useMemo(() => new Map(members.map((m) => [String(m.id), m])), [members]);

  const memberName = useCallback(
    (id) => memberById.get(String(id))?.fullName || `Member ${id}`,
    [memberById]
  );

  const loadSubscriptions = useCallback(async () => {
    const { data } = await api.get('/magazines/subscriptions', { params: { limit: 5000 } });
    setSubscriptions(Array.isArray(data?.data) ? data.data : []);
  }, []);

  const loadUnsubscribed = useCallback(async () => {
    try {
      const { data } = await api.get('/magazines/unsubscribed-paid-members');
      setUnsubscribedPaid(Array.isArray(data) ? data : []);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [mems, locs] = await Promise.all([
          loadMembers({ limit: 5000 }),
          loadLocations(),
        ]);
        if (cancelled) return;
        setMembers(mems);
        setLocations(locs);
        await Promise.all([loadSubscriptions(), loadUnsubscribed()]);
      } catch (error) {
        if (!cancelled) notify(error.response?.data?.detail || 'Could not load magazine data.', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadSubscriptions, loadUnsubscribed]);

  return (
    <PermissionGate required="magazines.read" title="Access Restricted" message="You need the Magazine privilege to open this page.">
      <div className="space-y-6 pb-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl sm:text-2xl font-bold text-[#180200] tracking-tight">{sectionTitle}</h1>
          <PageActions><Link
            to="/dashboard/magazine/labels"
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 hover:bg-stone-50 transition-colors"
          >
            <Printer className="h-4 w-4 text-[#8C1801]" />
            <span>Quick Label List</span>
          </Link></PageActions>
          <PageActionsSlot />
        </div>

        {unsubscribedPaid.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-4 flex flex-wrap items-center justify-between gap-3 text-sm text-[#510601]">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 text-amber-700 shrink-0" />
              <span>
                <strong>{unsubscribedPaid.length}</strong> paid member{unsubscribedPaid.length === 1 ? '' : 's'} requested the magazine but {unsubscribedPaid.length === 1 ? 'has' : 'have'} no active subscription.
              </span>
            </div>
            {canWrite && (
              <button
                type="button"
                onClick={() => setBackfillOpen(true)}
                className="px-3.5 py-1.5 rounded-lg bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-bold transition-colors cursor-pointer"
              >
                Review &amp; Start Subscriptions
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="rounded-xl border border-stone-200 bg-white p-12 text-center text-sm text-gray-500">Loading…</div>
        ) : (
          <>
            {tab === 'subscriptions' && (
              <SubscriptionsTab
                members={members}
                memberName={memberName}
                subscriptions={subscriptions}
                reload={loadSubscriptions}
                canWrite={canWrite}
                canDelete={canDelete}
              />
            )}
            {tab === 'pauses-returns' && (
              <PausesTab
                subscriptions={subscriptions}
                memberName={memberName}
                canWrite={canWrite}
                canDelete={canDelete}
              />
            )}
            {tab === 'pauses-returns' && (
              <ReturnsTab
                subscriptions={subscriptions}
                memberName={memberName}
                canWrite={canWrite}
                canDelete={canDelete}
              />
            )}
            {tab === 'labels-delivery' && (
              <>
                <LabelsTab locations={locations} canWrite={canWrite} />
                <DeliveryBatchesTab canWrite={canWrite} canDelete={canDelete} />
              </>
            )}
          </>
        )}

        {backfillOpen && (
          <BackfillModal
            isOpen={backfillOpen}
            onClose={() => setBackfillOpen(false)}
            onBackfilled={() => {
              loadSubscriptions();
              loadUnsubscribed();
            }}
            canWrite={canWrite}
          />
        )}
      </div>
    </PermissionGate>
  );
}

// ── Subscriptions ────────────────────────────────────────────
function SubscriptionsTab({ members, memberName, subscriptions, reload, canWrite, canDelete }) {
  const [recipients, setRecipients] = useState([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [monthlyFor, setMonthlyFor] = useState(null);
  const [nonMemberSetting, setNonMemberSetting] = useState(null);

  const loadRecipients = useCallback(async () => {
    setLoadingRecipients(true);
    try {
      const { data } = await api.get('/magazines/all-recipients');
      setRecipients(Array.isArray(data) ? data : []);
    } catch {
      // Fallback gracefully
    } finally {
      setLoadingRecipients(false);
    }
  }, []);

  useEffect(() => {
    loadRecipients();
  }, [loadRecipients, subscriptions]);

  const stats = useMemo(() => {
    let active = 0;
    let paused = 0;
    let stopped = 0;
    const list = recipients.length > 0 ? recipients : subscriptions;
    for (const item of list) {
      if (item.delivery_status === 'ACTIVE') active++;
      else if (item.delivery_status === 'PAUSED') paused++;
      else stopped++;
    }
    return { total: list.length, active, paused, stopped };
  }, [recipients, subscriptions]);

  const memberOptions = useMemo(
    () => members.map((m) => ({ value: m.id, label: `${m.fullName} (${m.membershipNumber})` })),
    [members]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sourceList = recipients.length > 0
      ? recipients
      : subscriptions.map((s) => ({
          recipient_type: 'MEMBER',
          recipient_id: s.member_id,
          name: memberName(s.member_id),
          code_or_reg: members.find((m) => String(m.id) === String(s.member_id))?.membershipNumber || '',
          delivery_status: s.delivery_status,
          address_override: s.address_override,
          notes: s.notes,
        }));

    return sourceList.filter((r) => {
      const name = (r.name || '').toLowerCase();
      const code = String(r.code_or_reg || '').toLowerCase();
      const matchSearch = !q || name.includes(q) || code.includes(q);
      const matchType = typeFilter === 'ALL' || r.recipient_type === typeFilter;
      const matchStatus = statusFilter === 'ALL' || r.delivery_status === statusFilter;
      return matchSearch && matchType && matchStatus;
    });
  }, [recipients, subscriptions, search, typeFilter, statusFilter, memberName, members]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * pageSize, current * pageSize);

  const changeStatus = async (sub, delivery_status) => {
    try {
      await api.put(`/magazines/subscriptions/${sub.id}`, { delivery_status });
      notify(`Delivery set to ${delivery_status}.`);
      reload();
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not change the delivery status.', 'error');
    }
  };

  const remove = async (sub) => {
    const ok = await confirmYesNo({
      title: 'Remove subscription?',
      text: `Magazine delivery for ${memberName(sub.member_id)} will be removed. The member's "Magazine" service history stays on the profile.`,
      confirmText: 'Yes, remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/magazines/subscriptions/${sub.id}`);
      notify('Subscription removed.');
      reload();
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not remove the subscription.', 'error');
    }
  };

  return (
    <div className="space-y-5">
      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl bg-[#FAF7F2] border border-[#E8DFD8] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase text-[#863221]">Total Recipients</p>
          <p className="text-xl font-bold text-[#510601] mt-0.5">{stats.total}</p>
        </div>
        <div className="rounded-xl bg-[#FAF7F2] border border-[#E8DFD8] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase text-[#863221]">Active Deliveries</p>
          <p className="text-xl font-bold text-emerald-700 mt-0.5">{stats.active}</p>
        </div>
        <div className="rounded-xl bg-[#FAF7F2] border border-[#E8DFD8] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase text-[#863221]">Paused Deliveries</p>
          <p className="text-xl font-bold text-amber-700 mt-0.5">{stats.paused}</p>
        </div>
        <div className="rounded-xl bg-[#FAF7F2] border border-[#E8DFD8] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase text-[#863221]">Stopped / Inactive</p>
          <p className="text-xl font-bold text-gray-600 mt-0.5">{stats.stopped}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <Search className="w-4 h-4 text-[#863221]/60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search recipient name or code…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl focus:outline-none focus:border-[#510601]"
            />
          </div>
          <FilterSelect
            value={typeFilter}
            onChange={(v) => { setTypeFilter(v); setPage(1); }}
            options={[
              { value: 'ALL', label: 'All Recipient Types' },
              { value: 'MEMBER', label: 'Members' },
              { value: 'AFFILIATION', label: 'Affiliations' },
              { value: 'ASSOCIATE', label: 'Associates' },
              { value: 'PRESS', label: 'Press & Media' },
            ]}
            widthClass="w-48"
          />
          <FilterSelect
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
            options={[{ value: 'ALL', label: 'All Statuses' }, ...DELIVERY_STATUSES.map((s) => ({ value: s, label: s }))]}
            widthClass="w-44"
          />
        </div>
        {canWrite && (
          <PageActions><button type="button" onClick={() => { setEditing(null); setFormOpen(true); }} className={BTN_PRIMARY}>
            <Plus className="w-4 h-4" />
            <span>Start Subscription</span>
          </button></PageActions>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-700">
            <thead className="bg-[#FAF7F2] border-b border-stone-200 text-xs font-semibold uppercase tracking-wider text-[#180200]">
              <tr>
                <TH>Recipient</TH>
                <TH>Type</TH>
                <TH>Delivery</TH>
                <TH>Address</TH>
                <TH className="text-center">Actions</TH>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {rows.length === 0 ? (
                <EmptyRow colSpan={5} icon={BookOpen} title="No recipients found" hint="Start a subscription or enable magazine delivery for affiliates, associates or press." />
              ) : (
                rows.map((row) => {
                  const sub = row.recipient_type === 'MEMBER'
                    ? subscriptions.find((s) => String(s.member_id) === String(row.recipient_id))
                    : null;
                  return (
                    <tr key={`${row.recipient_type}-${row.recipient_id}`} className="hover:bg-amber-50/40 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-gray-900">{row.name}</div>
                        {row.code_or_reg ? (
                          <div className="text-[11px] text-gray-500 font-mono">{row.code_or_reg}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${RECIPIENT_TYPE_CHIPS[row.recipient_type] || 'bg-stone-100 text-stone-700 border-stone-200'}`}>
                          {row.recipient_type}
                        </span>
                      </td>
                      <td className="px-4 py-3.5"><Chip value={row.delivery_status} /></td>
                      <td className="px-4 py-3.5 text-xs text-gray-600 max-w-[240px]">
                        {row.address_override ? (
                          <span className="text-amber-700 font-medium">Override: {row.address_override}</span>
                        ) : row.address ? (
                          <span className="truncate block" title={row.address}>{row.address}</span>
                        ) : (
                          <span className="text-gray-400">Standard address</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          {row.recipient_type === 'MEMBER' && sub && (
                            <>
                              <button type="button" onClick={() => setMonthlyFor(sub)} className="btn-act" title="Monthly marks">
                                <Calendar className="w-3.5 h-3.5" /><span>Monthly</span>
                              </button>
                              {canWrite && sub.delivery_status !== 'ACTIVE' && (
                                <button type="button" onClick={() => changeStatus(sub, 'ACTIVE')} className="btn-act" title="Start delivery">
                                  <Play className="w-3.5 h-3.5" /><span>Start</span>
                                </button>
                              )}
                              {canWrite && sub.delivery_status === 'ACTIVE' && (
                                <button type="button" onClick={() => changeStatus(sub, 'STOPPED')} className="btn-act" title="Stop delivery">
                                  <Pause className="w-3.5 h-3.5" /><span>Stop</span>
                                </button>
                              )}
                              {canWrite && (
                                <button type="button" onClick={() => { setEditing(sub); setFormOpen(true); }} className="btn-act" title="Edit">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {canDelete && (
                                <button type="button" onClick={() => remove(sub)} className="btn-act btn-act-danger" title="Remove">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </>
                          )}
                          {row.recipient_type === 'MEMBER' && !sub && canWrite && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditing(null);
                                setFormOpen(true);
                              }}
                              className="btn-act"
                              title="Start Subscription"
                            >
                              <Plus className="w-3.5 h-3.5" /><span>Start</span>
                            </button>
                          )}
                          {row.recipient_type !== 'MEMBER' && canWrite && (
                            <button
                              type="button"
                              onClick={() => setNonMemberSetting(row)}
                              className="btn-act"
                              title="Edit Delivery Setting"
                            >
                              <Pencil className="w-3.5 h-3.5" /><span>Edit Setting</span>
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
        {filtered.length > 0 && (
          <Pager page={current} pages={pages} total={filtered.length} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
        )}
      </div>

      {formOpen && (
        <SubscriptionForm
          editing={editing}
          memberOptions={memberOptions}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); reload(); loadRecipients(); }}
        />
      )}
      {monthlyFor && <MonthlyModal sub={monthlyFor} memberName={memberName} onClose={() => setMonthlyFor(null)} />}
      {nonMemberSetting && (
        <NonMemberSettingModal
          recipient={nonMemberSetting}
          onClose={() => setNonMemberSetting(null)}
          onSaved={loadRecipients}
        />
      )}
    </div>
  );
}

function SubscriptionForm({ editing, memberOptions, onClose, onSaved }) {
  const [form, setForm] = useState({
    member_id: editing?.member_id || '',
    delivery_status: editing?.delivery_status && SETTABLE_STATUSES.includes(editing.delivery_status) ? editing.delivery_status : 'ACTIVE',
    address_override: editing?.address_override || '',
    notes: editing?.notes || '',
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const errs = {};
    if (!editing && !form.member_id) errs.member_id = 'Choose a member.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const base = {
        address_override: form.address_override.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (editing) {
        // Status is changed only through the Start/Stop buttons, so an edit
        // never silently un-pauses a PAUSED subscription.
        await api.put(`/magazines/subscriptions/${editing.id}`, base);
        notify('Subscription updated.');
      } else {
        await api.post('/magazines/subscriptions', {
          member_id: Number(form.member_id),
          ...base,
          delivery_status: form.delivery_status,
        });
        notify('Subscription started.');
      }
      onSaved();
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not save the subscription.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose}>
      <ModalShell
        title={editing ? 'Edit Subscription' : 'Start Subscription'}
        footer={<ModalFooter kind={editing ? 'edit' : 'add'} onCancel={onClose} onSubmit={save} busy={busy} />}
      >
        <div className="p-6 space-y-4">
          <div>
            <label className={LABEL}>Member <span className="text-[#ED4636]">*</span></label>
            {editing ? (
              <div className="px-3.5 py-2.5 bg-[#FAF7F2] border border-[#E8DFD8] rounded-lg text-sm text-[#180200]">
                {memberOptions.find((o) => String(o.value) === String(editing.member_id))?.label || `Member ${editing.member_id}`}
              </div>
            ) : (
              <SearchableFormSelect
                value={form.member_id}
                onChange={(v) => { setForm((f) => ({ ...f, member_id: v })); setErrors((e) => ({ ...e, member_id: '' })); }}
                options={memberOptions}
                placeholder="Choose a member"
                hasError={Boolean(errors.member_id)}
              />
            )}
            <FieldError>{errors.member_id}</FieldError>
          </div>

          <div>
            <label className={LABEL}>Delivery status</label>
            {editing ? (
              <div className="px-3.5 py-2.5 bg-[#FAF7F2] border border-[#E8DFD8] rounded-lg text-sm text-[#180200]">
                <Chip value={editing.delivery_status} />
              </div>
            ) : (
              <select value={form.delivery_status} onChange={(e) => setForm((f) => ({ ...f, delivery_status: e.target.value }))} className={INPUT}>
                {SETTABLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <p className="mt-1 text-[11px] text-gray-500">Use Start / Stop to change delivery. PAUSED is set automatically when a pause covers today.</p>
          </div>

          <div>
            <label className={LABEL}>Address override</label>
            <textarea
              rows={2}
              value={form.address_override}
              onChange={(e) => setForm((f) => ({ ...f, address_override: e.target.value }))}
              placeholder="Leave blank to use the member's own address"
              className={INPUT}
            />
          </div>

          <div>
            <label className={LABEL}>Notes</label>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={INPUT} />
          </div>
        </div>
      </ModalShell>
    </Modal>
  );
}

function MonthlyModal({ sub, memberName, onClose }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [grid, setGrid] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get(`/magazines/subscriptions/${sub.id}/monthly`, { params: { year } })
      .then(({ data }) => { if (!cancelled) { setGrid(data); setError(''); } })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.detail || 'Could not load the monthly marks.'); });
    return () => { cancelled = true; };
  }, [sub.id, year]);

  return (
    <Modal isOpen onClose={onClose}>
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-[#E8DFD8] overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-[#180200]">Monthly marks</h3>
            <p className="text-xs text-gray-500">{memberName(sub.member_id)}</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border border-[#E8DFD8] px-2 py-1 text-xs bg-white">
              {[year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).sort().map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-stone-200 hover:text-gray-700"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && !grid && <p className="text-sm text-gray-500">Loading…</p>}
          {grid && (
            <>
              <div className="grid grid-cols-6 gap-2">
                {grid.months.map((m) => (
                  <div
                    key={m.issue_month_year}
                    title={m.returned ? `Returned: ${m.return_reason || 'no reason'}` : m.paused ? `Paused: ${m.pause_reason || 'no reason'}` : 'Nothing recorded'}
                    className={`rounded-lg border px-2 py-3 text-center ${
                      m.mark === 'R'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : m.mark === 'P'
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : 'border-stone-200 bg-white text-stone-400'
                    }`}
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wide">{MONTH_LABELS[m.month - 1]}</div>
                    <div className="text-lg font-black leading-tight">{m.mark || '·'}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-gray-600">
                <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border border-red-200 bg-red-50" /> R = returned issue</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border border-amber-200 bg-amber-50" /> P = paused that month</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-semibold text-stone-700">Returned in {grid.year}: {grid.returned_in_year}</span>
                <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-semibold text-stone-700">Last 12 months: {grid.returned_last_12_months}</span>
                {grid.suggest_pause && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">Consider pausing — repeated returns</span>
                )}
              </div>
            </>
          )}
        </div>
        <ModalFooter kind="view" onCancel={onClose} />
      </div>
    </Modal>
  );
}

// ── Delivery Pauses ──────────────────────────────────────────
function PausesTab({ subscriptions, memberName, canWrite, canDelete }) {
  const [pauses, setPauses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const subOptions = useMemo(
    () => subscriptions.map((s) => ({ value: s.id, label: `${memberName(s.member_id)} — ${s.delivery_status}` })),
    [subscriptions, memberName]
  );
  const subLabel = useCallback(
    (id) => {
      const s = subscriptions.find((x) => String(x.id) === String(id));
      return s ? `${memberName(s.member_id)} — ${s.delivery_status}` : `Subscription ${id}`;
    },
    [subscriptions, memberName]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/magazines/pauses', { params: { limit: 5000, active_only: activeOnly } });
      setPauses(Array.isArray(data?.data) ? data.data : []);
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not load delivery pauses.', 'error');
    } finally {
      setLoading(false);
    }
  }, [activeOnly]);

  useEffect(() => { load(); }, [load]);

  const resume = async (pause) => {
    try {
      await api.post(`/magazines/pauses/${pause.id}/resume`);
      notify('Delivery resumed.');
      load();
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not resume delivery.', 'error');
    }
  };

  const remove = async (pause) => {
    const ok = await confirmYesNo({ title: 'Delete pause?', text: 'The pause record will be removed.', confirmText: 'Yes, delete', danger: true });
    if (!ok) return;
    try {
      await api.delete(`/magazines/pauses/${pause.id}`);
      notify('Pause deleted.');
      load();
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not delete the pause.', 'error');
    }
  };

  const pages = Math.max(1, Math.ceil(pauses.length / pageSize));
  const current = Math.min(page, pages);
  const rows = pauses.slice((current - 1) * pageSize, current * pageSize);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#863221] cursor-pointer">
          <input type="checkbox" checked={activeOnly} onChange={(e) => { setActiveOnly(e.target.checked); setPage(1); }} className="h-4 w-4 rounded border-stone-300 text-[#8C1801]" />
          Show only pauses active today
        </label>
        {canWrite && (
          <PageActions><button type="button" onClick={() => { setEditing(null); setFormOpen(true); }} className={BTN_PRIMARY}>
            <Plus className="w-4 h-4" /><span>Pause Delivery</span>
          </button></PageActions>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-700">
            <thead className="bg-[#FAF7F2] border-b border-stone-200 text-xs font-semibold uppercase tracking-wider text-[#180200]">
              <tr>
                <TH>Member</TH>
                <TH>From</TH>
                <TH>Until</TH>
                <TH>Reason</TH>
                <TH className="text-center">Actions</TH>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {loading ? (
                <EmptyRow colSpan={5} title="Loading…" />
              ) : rows.length === 0 ? (
                <EmptyRow colSpan={5} icon={Pause} title="No delivery pauses" hint="Pause a member's delivery with a reason (e.g. returned twice)." />
              ) : (
                rows.map((p) => {
                  const isOpen = !p.pause_end_date;
                  const isActive = p.pause_start_date <= today() && (isOpen || p.pause_end_date >= today());
                  return (
                    <tr key={p.id} className="hover:bg-amber-50/40 transition-colors">
                      <td className="px-4 py-3.5 font-semibold text-gray-900">{subLabel(p.subscription_id)}</td>
                      <td className="px-4 py-3.5 text-xs text-gray-700">{formatDate(p.pause_start_date)}</td>
                      <td className="px-4 py-3.5 text-xs">
                        {isOpen ? <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">Open</span> : <span className="text-gray-700">{formatDate(p.pause_end_date)}</span>}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-gray-600 max-w-[260px]" title={p.reason || ''}>{p.reason || '—'}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          {canWrite && isOpen && (
                            <button type="button" onClick={() => resume(p)} className="btn-act" title="Resume delivery">
                              <Play className="w-3.5 h-3.5" /><span>Resume</span>
                            </button>
                          )}
                          {canWrite && (
                            <button type="button" onClick={() => { setEditing(p); setFormOpen(true); }} className="btn-act" title="Edit">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button type="button" onClick={() => remove(p)} className="btn-act btn-act-danger" title="Delete">
                              <Trash2 className="w-3.5 h-3.5" />
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
        {pauses.length > 0 && (
          <Pager page={current} pages={pages} total={pauses.length} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
        )}
      </div>

      {formOpen && (
        <PauseForm
          editing={editing}
          subOptions={subOptions}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); load(); }}
        />
      )}
    </div>
  );
}

function PauseForm({ editing, subOptions, onClose, onSaved }) {
  const [form, setForm] = useState({
    subscription_id: editing?.subscription_id || '',
    pause_start_date: editing?.pause_start_date || today(),
    pause_end_date: editing?.pause_end_date || '',
    reason: editing?.reason || '',
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const errs = {};
    if (!editing && !form.subscription_id) errs.subscription_id = 'Choose a subscription.';
    if (!form.reason.trim()) errs.reason = 'A reason is required.';
    if (form.pause_end_date && form.pause_end_date < form.pause_start_date) errs.pause_end_date = 'End date cannot be before the start date.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const payload = {
        pause_start_date: form.pause_start_date,
        pause_end_date: form.pause_end_date || null,
        reason: form.reason.trim(),
      };
      if (editing) {
        await api.put(`/magazines/pauses/${editing.id}`, { pause_end_date: payload.pause_end_date, reason: payload.reason });
        notify('Pause updated.');
      } else {
        await api.post('/magazines/pauses', { subscription_id: Number(form.subscription_id), ...payload });
        notify('Delivery paused.');
      }
      onSaved();
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not save the pause.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose}>
      <ModalShell
        title={editing ? 'Edit Pause' : 'Pause Delivery'}
        footer={<ModalFooter kind={editing ? 'edit' : 'add'} onCancel={onClose} onSubmit={save} busy={busy} />}
      >
        <div className="p-6 space-y-4">
          <div>
            <label className={LABEL}>Subscription <span className="text-[#ED4636]">*</span></label>
            {editing ? (
              <div className="px-3.5 py-2.5 bg-[#FAF7F2] border border-[#E8DFD8] rounded-lg text-sm text-[#180200]">
                {subOptions.find((o) => String(o.value) === String(editing.subscription_id))?.label || `Subscription ${editing.subscription_id}`}
              </div>
            ) : (
              <SearchableFormSelect
                value={form.subscription_id}
                onChange={(v) => { setForm((f) => ({ ...f, subscription_id: v })); setErrors((e) => ({ ...e, subscription_id: '' })); }}
                options={subOptions}
                placeholder="Choose a subscription"
                hasError={Boolean(errors.subscription_id)}
              />
            )}
            <FieldError>{errors.subscription_id}</FieldError>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>Start date <span className="text-[#ED4636]">*</span></label>
              <DateInput
                value={form.pause_start_date}
                onChange={(e) => setForm((f) => ({ ...f, pause_start_date: e.target.value }))}
                placeholder="DD-MM-YYYY"
                className="border border-[#DFD5CC] rounded-lg px-3.5 py-2.5 pr-9 focus:outline-none focus:border-[#510601]"
              />
            </div>
            <div>
              <label className={LABEL}>End date</label>
              <DateInput
                value={form.pause_end_date}
                onChange={(e) => setForm((f) => ({ ...f, pause_end_date: e.target.value }))}
                placeholder="Leave open"
                className="border border-[#DFD5CC] rounded-lg px-3.5 py-2.5 pr-9 focus:outline-none focus:border-[#510601]"
              />
              <FieldError>{errors.pause_end_date}</FieldError>
            </div>
          </div>

          <div>
            <label className={LABEL}>Reason <span className="text-[#ED4636]">*</span></label>
            <textarea rows={2} value={form.reason} onChange={(e) => { setForm((f) => ({ ...f, reason: e.target.value })); setErrors((er) => ({ ...er, reason: '' })); }} placeholder="e.g. two issues returned, address being corrected" className={INPUT} />
            <FieldError>{errors.reason}</FieldError>
          </div>
        </div>
      </ModalShell>
    </Modal>
  );
}

// ── Returns ──────────────────────────────────────────────────
function ReturnsTab({ subscriptions, memberName, canWrite, canDelete }) {
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followFilter, setFollowFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [formOpen, setFormOpen] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);

  const subOptions = useMemo(
    () => subscriptions.map((s) => ({ value: s.id, label: `${memberName(s.member_id)} — ${s.delivery_status}` })),
    [subscriptions, memberName]
  );
  const subToMember = useMemo(() => new Map(subscriptions.map((s) => [String(s.id), s.member_id])), [subscriptions]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/magazines/returns', { params: { limit: 5000 } });
      setReturns(Array.isArray(data?.data) ? data.data : []);
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not load returns.', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setFollowUp = async (ret, follow_up_status) => {
    try {
      await api.put(`/magazines/returns/${ret.id}`, { follow_up_status });
      notify(`Follow-up set to ${follow_up_status}.`);
      load();
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not update the follow-up.', 'error');
    }
  };

  const remove = async (ret) => {
    const ok = await confirmYesNo({ title: 'Delete return?', text: 'The return marking will be removed and the monthly box cleared.', confirmText: 'Yes, delete', danger: true });
    if (!ok) return;
    try {
      await api.delete(`/magazines/returns/${ret.id}`);
      notify('Return deleted.');
      load();
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not delete the return.', 'error');
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return returns.filter((r) => {
      const name = memberName(subToMember.get(String(r.subscription_id))).toLowerCase();
      const matchSearch = !q || name.includes(q) || String(r.issue_month_year).includes(q);
      const matchStatus = followFilter === 'ALL' || r.follow_up_status === followFilter;
      return matchSearch && matchStatus;
    });
  }, [returns, search, followFilter, memberName, subToMember]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * pageSize, current * pageSize);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-56">
            <Search className="w-4 h-4 text-[#863221]/60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search member or issue…" className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl focus:outline-none focus:border-[#510601]" />
          </div>
          <FilterSelect
            value={followFilter}
            onChange={(v) => { setFollowFilter(v); setPage(1); }}
            options={[{ value: 'ALL', label: 'All Follow-ups' }, ...FOLLOW_UP_STATUSES.map((s) => ({ value: s, label: s }))]}
            widthClass="w-44"
          />
          <button type="button" onClick={() => setRepeatOpen(true)} className={BTN_OUTLINE} title="Subscriptions with repeated returns">
            <RefreshCw className="w-3.5 h-3.5" /><span>Repeat Returns</span>
          </button>
        </div>
        {canWrite && (
          <PageActions><button type="button" onClick={() => setFormOpen(true)} className={BTN_PRIMARY}>
            <Plus className="w-4 h-4" /><span>Mark Return</span>
          </button></PageActions>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-700">
            <thead className="bg-[#FAF7F2] border-b border-stone-200 text-xs font-semibold uppercase tracking-wider text-[#180200]">
              <tr>
                <TH>Member</TH>
                <TH>Issue</TH>
                <TH>Returned on</TH>
                <TH>Reason</TH>
                <TH>Follow-up</TH>
                <TH className="text-center">Actions</TH>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {loading ? (
                <EmptyRow colSpan={6} title="Loading…" />
              ) : rows.length === 0 ? (
                <EmptyRow colSpan={6} icon={Undo2} title="No magazine returns" hint="Mark a returned issue so it is flagged on the next label print." />
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-amber-50/40 transition-colors">
                    <td className="px-4 py-3.5 font-semibold text-gray-900">{memberName(subToMember.get(String(r.subscription_id)))}</td>
                    <td className="px-4 py-3.5 text-xs font-mono text-gray-800">{r.issue_month_year}</td>
                    <td className="px-4 py-3.5 text-xs text-gray-700">{formatDate(r.return_date)}</td>
                    <td className="px-4 py-3.5 text-xs text-gray-600 max-w-[220px]" title={r.return_reason || ''}>{r.return_reason || '—'}</td>
                    <td className="px-4 py-3.5"><Chip value={r.follow_up_status} /></td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-center gap-1.5">
                        {canWrite && FOLLOW_UP_STATUSES.filter((s) => s !== r.follow_up_status).map((s) => (
                          <button key={s} type="button" onClick={() => setFollowUp(r, s)} className="btn-act" title={`Mark ${s}`}>
                            <CheckCircle2 className="w-3.5 h-3.5" /><span>{s}</span>
                          </button>
                        ))}
                        {canDelete && (
                          <button type="button" onClick={() => remove(r)} className="btn-act btn-act-danger" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
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
        {filtered.length > 0 && (
          <Pager page={current} pages={pages} total={filtered.length} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
        )}
      </div>

      {formOpen && (
        <ReturnForm
          subOptions={subOptions}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); load(); }}
        />
      )}
      {repeatOpen && (
        <RepeatReturnsModal subToMember={subToMember} memberName={memberName} onClose={() => setRepeatOpen(false)} />
      )}
    </div>
  );
}

function ReturnForm({ subOptions, onClose, onSaved }) {
  const [form, setForm] = useState({
    subscription_id: '',
    issue_month_year: thisMonth(),
    return_date: today(),
    return_reason: '',
    follow_up_status: 'PENDING',
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const errs = {};
    if (!form.subscription_id) errs.subscription_id = 'Choose a subscription.';
    if (!/^\d{4}-\d{2}$/.test(form.issue_month_year)) errs.issue_month_year = 'Pick an issue month.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.post('/magazines/returns', {
        subscription_id: Number(form.subscription_id),
        issue_month_year: form.issue_month_year,
        return_date: form.return_date,
        return_reason: form.return_reason.trim() || null,
        follow_up_status: form.follow_up_status,
      });
      notify('Return recorded.');
      onSaved();
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not record the return.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose}>
      <ModalShell title="Mark Return" footer={<ModalFooter kind="add" onCancel={onClose} onSubmit={save} busy={busy} />}>
        <div className="p-6 space-y-4">
          <div>
            <label className={LABEL}>Subscription <span className="text-[#ED4636]">*</span></label>
            <SearchableFormSelect
              value={form.subscription_id}
              onChange={(v) => { setForm((f) => ({ ...f, subscription_id: v })); setErrors((e) => ({ ...e, subscription_id: '' })); }}
              options={subOptions}
              placeholder="Choose a subscription"
              hasError={Boolean(errors.subscription_id)}
            />
            <FieldError>{errors.subscription_id}</FieldError>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>Issue month <span className="text-[#ED4636]">*</span></label>
              <input
                type="month"
                value={form.issue_month_year}
                onChange={(e) => { setForm((f) => ({ ...f, issue_month_year: e.target.value })); setErrors((er) => ({ ...er, issue_month_year: '' })); }}
                className={INPUT}
              />
              <FieldError>{errors.issue_month_year}</FieldError>
            </div>
            <div>
              <label className={LABEL}>Returned on</label>
              <DateInput
                value={form.return_date}
                onChange={(e) => setForm((f) => ({ ...f, return_date: e.target.value }))}
                placeholder="DD-MM-YYYY"
                className="border border-[#DFD5CC] rounded-lg px-3.5 py-2.5 pr-9 focus:outline-none focus:border-[#510601]"
              />
            </div>
          </div>
          <div>
            <label className={LABEL}>Reason</label>
            <textarea rows={2} value={form.return_reason} onChange={(e) => setForm((f) => ({ ...f, return_reason: e.target.value }))} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Follow-up</label>
            <select value={form.follow_up_status} onChange={(e) => setForm((f) => ({ ...f, follow_up_status: e.target.value }))} className={INPUT}>
              {FOLLOW_UP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </ModalShell>
    </Modal>
  );
}

function RepeatReturnsModal({ subToMember, memberName, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get('/magazines/returns/repeat', { params: { min_returns: 2, months: 12 } })
      .then(({ data }) => { if (!cancelled) setRows(Array.isArray(data?.data) ? data.data : []); })
      .catch((err) => { if (!cancelled) notify(err.response?.data?.detail || 'Could not load repeat returns.', 'error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <Modal isOpen onClose={onClose}>
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-[#E8DFD8] overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-[#180200]">Repeat returns</h3>
            <p className="text-xs text-gray-500">Active subscriptions with 2+ returns in the last 12 months.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-stone-200 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-6 text-sm text-gray-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">No subscription had repeated returns. Nothing to pause.</p>
          ) : (
            <table className="w-full text-left text-sm text-gray-700">
              <thead className="bg-[#FAF7F2] border-b border-stone-200 text-xs font-semibold uppercase tracking-wider text-[#180200]">
                <tr><TH>Member</TH><TH>Returns</TH><TH>Last issue</TH><TH>Delivery</TH></tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {rows.map((r) => (
                  <tr key={r.subscription_id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{r.name || memberName(subToMember.get(String(r.subscription_id)))}</div>
                      <div className="text-[11px] text-gray-500 font-mono">{r.member_code || ''}</div>
                    </td>
                    <td className="px-4 py-3 font-bold text-red-600">{r.returns_in_period}</td>
                    <td className="px-4 py-3 text-xs font-mono">{r.last_returned_issue}</td>
                    <td className="px-4 py-3"><Chip value={r.delivery_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <ModalFooter kind="view" onCancel={onClose} />
      </div>
    </Modal>
  );
}

// ── Label Batches ────────────────────────────────────────────
function LabelsTab({ locations, canWrite }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  const [gen, setGen] = useState({ issue_month_year: thisMonth(), state_id: '', district_id: '', taluk_id: '', only_paid: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/magazines/label-batches', { params: { limit: 5000 } });
      setBatches(Array.isArray(data?.data) ? data.data : []);
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not load label batches.', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stateOptions = locations.states.map((s) => ({ value: s.id, label: s.name }));
  const districtOptions = locations.districts
    .filter((d) => !gen.state_id || String(d.stateId) === String(gen.state_id))
    .map((d) => ({ value: d.id, label: d.name }));
  const talukOptions = locations.taluks
    .filter((t) => (!gen.district_id || String(t.districtId) === String(gen.district_id)) && (!gen.state_id || String(t.stateId) === String(gen.state_id)))
    .map((t) => ({ value: t.id, label: t.name }));

  const downloadPdf = async (batchId, issue) => {
    const res = await api.get(`/magazines/label-batches/${batchId}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `labels-${issue || batchId}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const generate = async () => {
    if (!/^\d{4}-\d{2}$/.test(gen.issue_month_year)) { notify('Pick an issue month.', 'error'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/magazines/generate-labels', null, {
        params: {
          issue_month_year: gen.issue_month_year,
          state_id: gen.state_id || undefined,
          district_id: gen.district_id || undefined,
          taluk_id: gen.taluk_id || undefined,
          only_paid: gen.only_paid,
        },
      });
      if (data?.approval_request_id || data?.status === 'PENDING') {
        notify('Label batch submitted for approval.');
        return;
      }
      await downloadPdf(data.batch_id, gen.issue_month_year);
      notify(`Label batch generated (${data.total_labels ?? 0} labels${data.returned_count ? `, ${data.returned_count} returned` : ''}).`);
      load();
    } catch (error) {
      let message = error.response?.data?.detail;
      if (!message && error.response?.data instanceof Blob) {
        try { message = JSON.parse(await error.response.data.text()).detail; } catch (_) { /* keep default */ }
      }
      notify(message || 'Could not generate labels.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onDownload = async (b) => {
    try {
      await downloadPdf(b.id, b.issue_month_year);
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not download the PDF.', 'error');
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-[#180200] mb-4 flex items-center gap-2">
          <Printer className="h-4 w-4 text-[#8C1801]" /> Generate Labels
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className={LABEL}>Issue month</label>
            <input type="month" value={gen.issue_month_year} onChange={(e) => setGen((g) => ({ ...g, issue_month_year: e.target.value }))} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>State</label>
            <select value={gen.state_id} onChange={(e) => setGen((g) => ({ ...g, state_id: e.target.value, district_id: '', taluk_id: '' }))} className={INPUT}>
              <option value="">All states</option>
              {stateOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>District</label>
            <select value={gen.district_id} onChange={(e) => setGen((g) => ({ ...g, district_id: e.target.value, taluk_id: '' }))} className={INPUT} disabled={!gen.state_id}>
              <option value="">All districts</option>
              {districtOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>Taluk</label>
            <select value={gen.taluk_id} onChange={(e) => setGen((g) => ({ ...g, taluk_id: e.target.value }))} className={INPUT} disabled={!gen.district_id}>
              <option value="">All taluks</option>
              {talukOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#863221] cursor-pointer">
            <input type="checkbox" checked={gen.only_paid} onChange={(e) => setGen((g) => ({ ...g, only_paid: e.target.checked }))} className="h-4 w-4 rounded border-stone-300 text-[#8C1801]" />
            Paid members only (receipt allocated)
          </label>
          {canWrite && (
            <button type="button" onClick={generate} disabled={busy} className={BTN_PRIMARY}>
              <Printer className="w-4 h-4" /><span>{busy ? 'Generating…' : 'Generate & Download PDF'}</span>
            </button>
          )}
        </div>
        <div className="mt-4 rounded-lg bg-[#FAF7F2] border border-[#E8DFD8] p-3 text-xs text-[#863221] flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-[#8C1801] shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-[#510601]">Smart Auto-Exclusion Active:</span> Active subscriptions only. Paused delivery spans are skipped automatically, and returned issues are flagged on the dispatch labels.
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-700">
            <thead className="bg-[#FAF7F2] border-b border-stone-200 text-xs font-semibold uppercase tracking-wider text-[#180200]">
              <tr>
                <TH>Batch</TH>
                <TH>Issue</TH>
                <TH>Generated</TH>
                <TH className="text-center">Labels</TH>
                <TH className="text-center">Actions</TH>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {loading ? (
                <EmptyRow colSpan={5} title="Loading…" />
              ) : batches.length === 0 ? (
                <EmptyRow colSpan={5} icon={FileText} title="No label batches yet" hint="Generate a batch above to print magazine labels." />
              ) : (
                batches.map((b) => (
                  <tr key={b.id} className="hover:bg-amber-50/40 transition-colors">
                    <td className="px-4 py-3.5 font-semibold text-gray-900">{b.batch_name}</td>
                    <td className="px-4 py-3.5 text-xs font-mono">{b.issue_month_year}</td>
                    <td className="px-4 py-3.5 text-xs text-gray-600">{formatDate(b.generation_date)}</td>
                    <td className="px-4 py-3.5 text-center text-xs font-bold text-gray-800">{b.total_labels ?? 0}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-center gap-1.5">
                        <button type="button" onClick={() => setDetail(b)} className="btn-act" title="View labels"><Eye className="w-3.5 h-3.5" /><span>View</span></button>
                        {canWrite && (
                          <button type="button" onClick={() => onDownload(b)} className="btn-act" title="Download PDF"><Download className="w-3.5 h-3.5" /><span>PDF</span></button>
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

      {detail && <LabelBatchModal batch={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

const RECIPIENT_TYPE_CHIP = {
  MEMBER: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  AFFILIATION: 'bg-blue-50 text-blue-700 border-blue-200',
  ASSOCIATE: 'bg-purple-50 text-purple-700 border-purple-200',
  PRESS: 'bg-amber-50 text-amber-700 border-amber-200',
};

function LabelBatchModal({ batch, onClose }) {
  const [data, setData] = useState(null);
  const [returnsOnly, setReturnsOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/magazines/label-batches/${batch.id}`, { params: { returns_only: returnsOnly } })
      .then(({ data: d }) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) notify(err.response?.data?.detail || 'Could not load the batch.', 'error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [batch.id, returnsOnly]);

  const items = useMemo(() => {
    if (!data?.data) return [];
    if (typeFilter === 'ALL') return data.data;
    return data.data.filter((item) => item.recipient_type === typeFilter);
  }, [data, typeFilter]);

  return (
    <Modal isOpen onClose={onClose}>
      <div className="relative w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-[#E8DFD8] overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-[#180200]">{batch.batch_name}</h3>
            <p className="text-xs text-gray-500">{items.length} label{items.length === 1 ? '' : 's'} shown</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#863221] cursor-pointer">
              <input type="checkbox" checked={returnsOnly} onChange={(e) => setReturnsOnly(e.target.checked)} className="h-4 w-4 rounded border-stone-300 text-[#8C1801]" />
              Returned only
            </label>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-stone-200 hover:text-gray-700"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {/* Recipient Filter Tabs */}
        <div className="px-6 py-2 border-b border-[#E8DFD8] bg-white flex flex-wrap gap-1.5 text-xs">
          {['ALL', 'MEMBER', 'AFFILIATION', 'ASSOCIATE', 'PRESS'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                typeFilter === t
                  ? 'bg-[#510601] text-white'
                  : 'bg-[#FAF7F2] text-[#863221] hover:bg-stone-100'
              }`}
            >
              {t === 'ALL' ? 'All Recipients' : t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-6 text-sm text-gray-500">Loading…</p>
          ) : items.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">No labels to show.</p>
          ) : (
            <table className="w-full text-left text-sm text-gray-700">
              <thead className="bg-[#FAF7F2] border-b border-stone-200 text-xs font-semibold uppercase tracking-wider text-[#180200]">
                <tr><TH>Recipient</TH><TH>Type</TH><TH>Address</TH></tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {items.map((item) => (
                  <tr key={item.id} className={item.is_return ? 'bg-red-50/40' : ''}>
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      {item.recipient_name || `${item.recipient_type} ${item.recipient_id}`}
                      {item.is_return && <span className="ml-2 inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">RETURNED ISSUE</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${RECIPIENT_TYPE_CHIP[item.recipient_type] || 'bg-stone-100 text-stone-600 border-stone-200'}`}>
                        {item.recipient_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-pre-line">{item.label_address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <ModalFooter kind="view" onCancel={onClose} />
      </div>
    </Modal>
  );
}

// ── Delivery Batches ─────────────────────────────────────────
function DeliveryBatchesTab({ canWrite, canDelete }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/magazines/delivery-batches', { params: { limit: 5000 } });
      setBatches(Array.isArray(data?.data) ? data.data : []);
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not load delivery batches.', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (batch) => {
    const ok = await confirmYesNo({ title: 'Delete delivery batch?', text: `"${batch.batch_name}" will be removed.`, confirmText: 'Yes, delete', danger: true });
    if (!ok) return;
    try {
      await api.delete(`/magazines/delivery-batches/${batch.id}`);
      notify('Delivery batch deleted.');
      load();
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not delete the batch.', 'error');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">Dispatch batches track when an issue was sent out.</p>
        {canWrite && (
          <PageActions><button type="button" onClick={() => { setEditing(null); setFormOpen(true); }} className={BTN_PRIMARY}>
            <Plus className="w-4 h-4" /><span>New Delivery Batch</span>
          </button></PageActions>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-700">
            <thead className="bg-[#FAF7F2] border-b border-stone-200 text-xs font-semibold uppercase tracking-wider text-[#180200]">
              <tr>
                <TH>Batch</TH>
                <TH>Issue</TH>
                <TH>Dispatch date</TH>
                <TH>Status</TH>
                <TH className="text-center">Actions</TH>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {loading ? (
                <EmptyRow colSpan={5} title="Loading…" />
              ) : batches.length === 0 ? (
                <EmptyRow colSpan={5} icon={PackageCheck} title="No delivery batches" hint="Create a batch to track a magazine dispatch." />
              ) : (
                batches.map((b) => (
                  <tr key={b.id} className="hover:bg-amber-50/40 transition-colors">
                    <td className="px-4 py-3.5 font-semibold text-gray-900">{b.batch_name}</td>
                    <td className="px-4 py-3.5 text-xs font-mono">{b.issue_month_year}</td>
                    <td className="px-4 py-3.5 text-xs text-gray-700">{b.dispatch_date ? formatDate(b.dispatch_date) : '—'}</td>
                    <td className="px-4 py-3.5"><Chip value={b.status} /></td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-center gap-1.5">
                        {canWrite && (
                          <button type="button" onClick={() => { setEditing(b); setFormOpen(true); }} className="btn-act" title="Edit"><Pencil className="w-3.5 h-3.5" /><span>Edit</span></button>
                        )}
                        {canDelete && (
                          <button type="button" onClick={() => remove(b)} className="btn-act btn-act-danger" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
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

      {formOpen && (
        <DeliveryBatchForm
          editing={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); load(); }}
        />
      )}
    </div>
  );
}

function DeliveryBatchForm({ editing, onClose, onSaved }) {
  const [form, setForm] = useState({
    batch_name: editing?.batch_name || '',
    issue_month_year: editing?.issue_month_year || thisMonth(),
    dispatch_date: editing?.dispatch_date || '',
    status: editing?.status || 'PENDING',
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const errs = {};
    if (!form.batch_name.trim()) errs.batch_name = 'A batch name is required.';
    if (!/^\d{4}-\d{2}$/.test(form.issue_month_year)) errs.issue_month_year = 'Pick an issue month.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const payload = {
        batch_name: form.batch_name.trim(),
        issue_month_year: form.issue_month_year,
        dispatch_date: form.dispatch_date || null,
        status: form.status,
      };
      if (editing) {
        await api.put(`/magazines/delivery-batches/${editing.id}`, payload);
        notify('Delivery batch updated.');
      } else {
        await api.post('/magazines/delivery-batches', payload);
        notify('Delivery batch created.');
      }
      onSaved();
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not save the batch.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose}>
      <ModalShell title={editing ? 'Edit Delivery Batch' : 'New Delivery Batch'} footer={<ModalFooter kind={editing ? 'edit' : 'add'} onCancel={onClose} onSubmit={save} busy={busy} />}>
        <div className="p-6 space-y-4">
          <div>
            <label className={LABEL}>Batch name <span className="text-[#ED4636]">*</span></label>
            <input type="text" value={form.batch_name} onChange={(e) => { setForm((f) => ({ ...f, batch_name: e.target.value })); setErrors((er) => ({ ...er, batch_name: '' })); }} className={INPUT} placeholder="e.g. February dispatch" />
            <FieldError>{errors.batch_name}</FieldError>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>Issue month <span className="text-[#ED4636]">*</span></label>
              <input type="month" value={form.issue_month_year} onChange={(e) => { setForm((f) => ({ ...f, issue_month_year: e.target.value })); setErrors((er) => ({ ...er, issue_month_year: '' })); }} className={INPUT} />
              <FieldError>{errors.issue_month_year}</FieldError>
            </div>
            <div>
              <label className={LABEL}>Dispatch date</label>
              <DateInput
                value={form.dispatch_date}
                onChange={(e) => setForm((f) => ({ ...f, dispatch_date: e.target.value }))}
                placeholder="DD-MM-YYYY"
                className="border border-[#DFD5CC] rounded-lg px-3.5 py-2.5 pr-9 focus:outline-none focus:border-[#510601]"
              />
            </div>
          </div>
          <div>
            <label className={LABEL}>Status</label>
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className={INPUT}>
              {['PENDING', 'DISPATCHED', 'COMPLETED'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </ModalShell>
    </Modal>
  );
}

function NonMemberSettingModal({ recipient, onClose, onSaved }) {
  const [form, setForm] = useState({
    enabled: recipient?.delivery_status === 'ACTIVE',
    address_override: recipient?.address_override || '',
  });
  const [busy, setBusy] = useState(false);

  const endpointMap = {
    AFFILIATION: `/engagements/affiliations/${recipient?.recipient_id}/magazine-setting`,
    ASSOCIATE: `/engagements/associates/${recipient?.recipient_id}/magazine-setting`,
    PRESS: `/engagements/press-media/${recipient?.recipient_id}/magazine-setting`,
  };

  const save = async () => {
    const url = endpointMap[recipient.recipient_type];
    if (!url) return;
    setBusy(true);
    try {
      await api.put(url, {
        enabled: form.enabled,
        address_override: form.address_override.trim() || null,
      });
      notify('Magazine delivery setting updated.');
      onSaved();
      onClose();
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not update setting.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose}>
      <ModalShell
        title={`Edit Delivery: ${recipient.name}`}
        footer={<ModalFooter kind="edit" onCancel={onClose} onSubmit={save} busy={busy} />}
      >
        <div className="p-6 space-y-4">
          <div>
            <label className={LABEL}>Recipient Type</label>
            <div className="text-sm font-semibold text-gray-800">{recipient.recipient_type}</div>
          </div>
          <div>
            <label className={LABEL}>Delivery Enabled</label>
            <select
              value={form.enabled ? 'YES' : 'NO'}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.value === 'YES' }))}
              className={INPUT}
            >
              <option value="YES">YES - Deliver magazine</option>
              <option value="NO">NO - Stop delivery</option>
            </select>
          </div>
          <div>
            <label className={LABEL}>Delivery Address Override</label>
            <textarea
              rows={2}
              value={form.address_override}
              onChange={(e) => setForm((f) => ({ ...f, address_override: e.target.value }))}
              placeholder={`Leave blank to use registered address: ${recipient.address || 'None'}`}
              className={INPUT}
            />
            {recipient.address && (
              <p className="mt-1 text-xs text-gray-500">Registered address: {recipient.address}</p>
            )}
          </div>
        </div>
      </ModalShell>
    </Modal>
  );
}

function BackfillModal({ isOpen, onClose, onBackfilled, canWrite }) {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [busy, setBusy] = useState(false);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/magazines/unsubscribed-paid-members');
      const list = Array.isArray(data) ? data : [];
      setCandidates(list);
      setSelectedIds(list.map((c) => c.member_id));
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not load candidates.', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) loadCandidates();
  }, [isOpen, loadCandidates]);

  const toggleAll = () => {
    if (selectedIds.length === candidates.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(candidates.map((c) => c.member_id));
    }
  };

  const toggleOne = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const submit = async () => {
    if (selectedIds.length === 0) {
      notify('Select at least one member to activate.', 'error');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/magazines/backfill-subscriptions', {
        member_ids: selectedIds,
      });
      notify(data.message || `Activated ${data.created_count} subscriptions.`);
      onBackfilled();
      onClose();
    } catch (error) {
      notify(error.response?.data?.detail || 'Could not activate subscriptions.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen onClose={onClose}>
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-[#E8DFD8] overflow-hidden max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-between">
          <h3 className="text-lg font-bold text-[#180200]">Paid Members Awaiting Magazine Subscription</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          <p className="text-xs text-gray-600">
            These members indicated <strong>Magazine Needed: YES</strong> during registration and have a paid receipt allocation, but do not have an active subscription record. Select the members you wish to activate:
          </p>

          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading candidates…</div>
          ) : candidates.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              No paid members found without an active subscription.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs font-semibold text-[#863221]">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="hover:underline cursor-pointer"
                >
                  {selectedIds.length === candidates.length ? 'Deselect All' : 'Select All'}
                </button>
                <span>{selectedIds.length} of {candidates.length} selected</span>
              </div>

              <div className="border border-[#E8DFD8] rounded-xl overflow-hidden divide-y divide-[#E8DFD8]">
                {candidates.map((c) => (
                  <label
                    key={c.member_id}
                    className="flex items-center gap-3 p-3 hover:bg-[#FAF7F2]/60 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(c.member_id)}
                      onChange={() => toggleOne(c.member_id)}
                      className="rounded border-[#E8DFD8] text-[#510601] focus:ring-[#510601] h-4 w-4"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-gray-900">{c.name}</span>
                        {c.member_code && (
                          <span className="font-mono text-xs text-gray-500">{c.member_code}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {c.mobile && <span className="mr-3">Mob: {c.mobile}</span>}
                        <span>Paid: ₹{c.total_allocated}</span>
                        {c.magazine_delivery_address && (
                          <span className="ml-3 text-amber-800">
                            Deliver to: {c.magazine_delivery_address}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="px-6 py-3.5 border-t border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-stone-100 rounded-lg border border-stone-200"
          >
            Cancel
          </button>
          {canWrite && candidates.length > 0 && (
            <button
              type="button"
              disabled={busy || selectedIds.length === 0}
              onClick={submit}
              className="px-4 py-2 text-xs font-bold bg-[#510601] hover:bg-[#3D0400] text-white rounded-lg shadow-sm disabled:opacity-50"
            >
              {busy ? 'Activating…' : `Activate ${selectedIds.length} Subscriptions`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

