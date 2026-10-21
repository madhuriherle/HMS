import FilterToggle from '../components/FilterToggle';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  XCircle,
  Inbox,
  Search,
  RefreshCw,
  X,
  AlertTriangle,
  Eye,
  ArrowLeft,
  FileText,
  History,
  Trash2,
} from 'lucide-react';
import api from '../api';
import { formatDateTime } from '../utils/dateUtils';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import { askReason, confirmYesNo, showError, showSuccess } from '../utils/dialogs';

// Category metadata for unified approvals
const CATEGORIES = [
  { key: 'ALL', label: 'All Actions' },
  { key: 'requests', label: 'Change Requests' },
  { key: 'deletions', label: 'Member Deletions' },
  { key: 'profile', label: 'Profile Changes' },
  { key: 'types', label: 'Type Changes' },
];

const badge = (status) =>
  status === 'APPROVED'
    ? 'bg-[#3D705C]/10 text-[#3D705C] border-[#3D705C]/30'
    : status === 'REJECTED'
      ? 'bg-[#8C1801]/10 text-[#8C1801] border-[#8C1801]/30'
      : 'bg-[#EE6A00]/10 text-[#B34E00] border-[#EE6A00]/30';

const kindBadge = (kind) => {
  switch (kind) {
    case 'requests':
      return 'bg-[#510601]/10 text-[#510601] border-[#510601]/20';
    case 'deletions':
      return 'bg-[#8C1801]/10 text-[#8C1801] border-[#8C1801]/20';
    case 'profile':
      return 'bg-[#863221]/10 text-[#863221] border-[#863221]/20';
    case 'types':
      return 'bg-[#EE6A00]/10 text-[#B34E00] border-[#EE6A00]/20';
    default:
      return 'bg-[#FAF7F2] text-[#863221] border-[#E8DFD8]';
  }
};

const formatValue = (val) => {
  if (val === null || val === undefined || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'Active / Yes' : 'Inactive / No';
  if (Array.isArray(val)) {
    if (val.length === 0) return 'None';
    return val
      .map((item, index) => {
        const label = val.length > 1 ? `${index + 1}. ` : '';
        return `${label}${formatValue(item)}`;
      })
      .join('  •  ');
  }
  if (typeof val === 'object') {
    const entries = Object.entries(val).filter(([key]) => !key.startsWith('_'));
    if (entries.length === 0) return 'None';
    return entries
      .map(([key, value]) => `${humanizeKey(key)}: ${formatValue(value)}`)
      .join('  •  ');
  }
  return String(val);
};

const humanizeKey = (key) => {
  if (!key) return '';
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

// Flatten nested payloads to one row per leaf: { 'Items 1 › Amount': 44, ... }
const flattenPayload = (val, label = '', out = {}) => {
  const isObj = val && typeof val === 'object';
  if (Array.isArray(val) && val.length > 0 && val.some((v) => v && typeof v === 'object')) {
    val.forEach((item, i) => flattenPayload(item, `${label}${val.length > 1 ? ` ${i + 1}` : ''}`, out));
  } else if (isObj && !Array.isArray(val)) {
    const entries = Object.entries(val).filter(([k]) => !k.startsWith('_'));
    if (entries.length === 0 && label) out[label] = val;
    entries.forEach(([k, v]) => flattenPayload(v, label ? `${label} › ${humanizeKey(k)}` : humanizeKey(k), out));
  } else {
    out[label] = val;
  }
  return out;
};

const isEmptyVal = (v) => v === null || v === undefined || v === '';

const formatPayloadSummary = (payload) => {
  if (!payload || typeof payload !== 'object') return '';
  const entries = Object.entries(payload).filter(([k]) => !k.startsWith('_'));
  if (entries.length === 0) return '';
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${humanizeKey(k)}: ${formatValue(v)}`)
    .join(' | ');
};

// ── the full-page request detail ──
// Rows come as { field: 'Group › Sub › Label', previous, proposed, changed }. The last part is the row label, the
// parts before it are the section heading (a wrapper shared by every row is dropped).
const groupRows = (rows) => {
  const paths = rows.map((r) => String(r.field).split(' › '));
  const first = paths[0]?.[0];
  const dropFirst = paths.length > 0 && paths.every((p) => p.length > 1 && p[0] === first);
  const groups = [];
  rows.forEach((r, i) => {
    const p = dropFirst ? paths[i].slice(1) : paths[i];
    const title = p.slice(0, -1).join(' › ') || 'Details';
    let g = groups.find((x) => x.title === title);
    if (!g) {
      g = { title, rows: [] };
      groups.push(g);
    }
    g.rows.push({ ...r, label: p[p.length - 1] });
  });
  return groups;
};

const detailMode = (item) => {
  if (item.kind === 'deletions') return 'delete';
  if (item.kind === 'requests') {
    const action = String(item.raw?.action || '').toUpperCase();
    if (action === 'CREATE') return 'create';
    if (action === 'DELETE') return 'delete';
  }
  return 'update';
};

function DetailPanel({ header, tone, groups, side, onlyChanged }) {
  const Icon = tone === 'old' ? History : tone === 'del' ? Trash2 : FileText;
  const tag = tone === 'old' ? 'Before' : tone === 'new' ? 'After' : tone === 'del' ? 'Removed' : 'New';
  return (
    <section className="bg-white rounded-2xl border border-[#EFE6DE] shadow-xs overflow-hidden min-w-0">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#EFE6DE]/70">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#F7EDE6] text-[#8D4C32] flex items-center justify-center">
            <Icon className="w-3.5 h-3.5" />
          </div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#241B16]">{header}</h3>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tone === 'del' ? 'bg-[#8C1801]/10 text-[#8C1801] border-[#8C1801]/20' : tone === 'new' ? 'bg-[#3D705C]/10 text-[#3D705C] border-[#3D705C]/30' : tone === 'old' ? 'bg-[#EE6A00]/10 text-[#B34E00] border-[#EE6A00]/30' : 'bg-[#510601]/10 text-[#510601] border-[#510601]/20'}`}>{tag}</span>
      </div>
      <div className="p-5 space-y-5">
        {groups.map((g) => {
          const rows = onlyChanged ? g.rows.filter((r) => r.changed) : g.rows;
          if (rows.length === 0) return null;
          return (
            <div key={g.title}>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#510601] mb-1">{g.title}</h4>
              <dl className="divide-y divide-[#EFE6DE]/60">
                {rows.map((r, i) => (
                  <div key={i} className="py-2 grid grid-cols-[38%_1fr] items-start gap-4 text-xs">
                    <dt className="text-[#7D7068] font-medium">{r.label}</dt>
                    <dd
                      className={`text-left min-w-0 break-words ${
                        side === 'new' && r.changed ? 'text-[#8C1801] font-bold' : 'text-[#180200] font-semibold'
                      }`}
                    >
                      {side === 'old' ? r.previous : r.proposed}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ApprovalDetail({ item, rows, canWrite, onBack, onApprove, onReject }) {
  const [onlyChanged, setOnlyChanged] = useState(true);
  const mode = detailMode(item);
  const groups = useMemo(() => groupRows(rows), [rows]);
  const changedCount = rows.filter((r) => r.changed).length;
  const pending = item.status === 'PENDING';

  return (
    <div className="space-y-4 pb-4">
      {/* Title bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E8DFD8] hover:bg-[#FAF7F2] text-xs font-semibold text-[#510601] rounded-xl cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <h2 className="text-base font-bold text-[#180200]">
          {mode === 'create' ? 'New Record Request' : mode === 'delete' ? 'Delete Request' : 'Update Request'} #{item.rawId}
        </h2>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${kindBadge(item.kind)}`}>{item.kindLabel}</span>
        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${badge(item.status)}`}>{item.status}</span>
      </div>

      {/* Who / what / when */}
      <div className="bg-white border border-[#E8DFD8] rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        {[
          ['Action / Request', item.summary],
          ['Module', item.module],
          ['Requested by', item.requested_by ? `User ${item.requested_by}` : 'System'],
          ['Submitted on', formatDateTime(item.created_at, '—', false)],
        ].map(([label, value]) => (
          <div key={label}>
            <span className="text-[10px] uppercase font-bold text-[#863221]/70 block">{label}</span>
            <span className="font-semibold text-[#180200] capitalize">{value}</span>
          </div>
        ))}
      </div>

      {item.hasWarning && (
        <div className="p-3.5 rounded-xl bg-[#FFF7EC] border border-[#EE6A00]/30 text-[#7A3A00] flex items-start gap-2.5 text-xs">
          <AlertTriangle className="w-4 h-4 text-[#EE6A00] shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block">Caution / Dependency Notice:</span>
            <span>{item.warningText}</span>
          </div>
        </div>
      )}
      {item.review_note && (
        <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#E8DFD8] text-xs text-[#180200]">
          <span className="font-bold text-[#863221]">Reviewer Note: </span>
          <span>{item.review_note}</span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="p-4 border border-[#E8DFD8] rounded-xl text-center text-xs text-[#863221]/70 bg-white">
          No detailed field-level information is available for this request.
        </div>
      ) : mode === 'create' ? (
        <DetailPanel header="New record details" tone="new" groups={groups} side="new" onlyChanged={false} />
      ) : mode === 'delete' ? (
        <>
          <div className="p-3.5 rounded-xl bg-[#FAF1EE] border border-[#8C1801]/25 text-[#8C1801] text-xs font-semibold">
            Approving this request will delete the record below.
          </div>
          <DetailPanel header="Record to be deleted" tone="del" groups={groups} side="old" onlyChanged={false} />
        </>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-[#863221]">
            <span>
              {changedCount} {changedCount === 1 ? 'field' : 'fields'} changed
            </span>
            <label className="inline-flex items-center gap-2 cursor-pointer font-semibold">
              <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} className="w-4 h-4 accent-[#510601] cursor-pointer" />
              Show only changed
            </label>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <DetailPanel header="Old detail" tone="old" groups={groups} side="old" onlyChanged={onlyChanged} />
            <DetailPanel header="Updated detail" tone="new" groups={groups} side="new" onlyChanged={onlyChanged} />
          </div>
        </>
      )}

      {/* Action bar */}
      <div className="flex items-center justify-center gap-3 pt-2">
        {pending && canWrite ? (
          <>
            <button type="button" onClick={onReject} className="px-6 py-2.5 rounded-xl bg-white border border-[#8C1801] text-[#8C1801] hover:bg-[#FAF1EE] text-sm font-semibold cursor-pointer">
              Reject
            </button>
            <button type="button" onClick={onApprove} className="px-6 py-2.5 rounded-xl bg-[#3D705C] hover:bg-[#2F5A49] text-white text-sm font-semibold cursor-pointer shadow-sm">
              Approve
            </button>
          </>
        ) : (
          <button type="button" onClick={onBack} className="px-6 py-2.5 rounded-xl bg-[#510601] hover:bg-[#863221] text-white text-sm font-semibold cursor-pointer">
            Back to list
          </button>
        )}
      </div>
    </div>
  );
}

export default function Approvals() {
  const { hasPermission } = useAuth();
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Filters
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('PENDING'); // Default to PENDING
  const [filtersOpen, setFiltersOpen] = useState(false); // the status filter shows only when the filter icon is clicked
  const [searchQuery, setSearchQuery] = useState('');

  // Modal View / Comparison State
  const [searchParams, setSearchParams] = useSearchParams();
  const viewId = searchParams.get('view');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { limit: 200 };
      if (statusFilter !== 'ALL') {
        params.status = statusFilter;
      }

      // Fetch all approval endpoints in parallel
      const [reqsRes, delRes, profRes, typeRes] = await Promise.allSettled([
        api.get('/approvals/requests', { params }),
        api.get('/approvals/deletion-requests', { params }),
        api.get('/approvals/profile-changes', { params }),
        api.get('/approvals/type-changes', { params }),
      ]);

      const normalized = [];

      // 1. Generic Change Requests (gated master items, receipts, roles, users, etc.)
      if (reqsRes.status === 'fulfilled' && reqsRes.value?.data?.data) {
        for (const r of reqsRes.value.data.data) {
          const warning = r.payload?._warning || null;
          const { _warning: _, _previous: __, ...cleanPayload } = r.payload || {};
          const detailText = warning
            ? `Warning: ${warning}`
            : formatPayloadSummary(cleanPayload) || r.error || '—';

          normalized.push({
            id: `req-${r.id}`,
            rawId: r.id,
            kind: 'requests',
            kindLabel: 'Change Request',
            module: r.module || 'system',
            summary: `${r.action} ${r.entity_type}${r.entity_id ? ` ${r.entity_id}` : ''}`,
            detail: detailText,
            hasWarning: Boolean(warning),
            warningText: warning,
            requested_by: r.requested_by,
            created_at: r.created_at,
            status: r.status || 'PENDING',
            review_note: r.review_note || '',
            approvePath: `/approvals/requests/${r.id}/approve`,
            rejectPath: `/approvals/requests/${r.id}/reject`,
            raw: r,
          });
        }
      }

      // 2. Member Deletion Requests
      if (delRes.status === 'fulfilled' && delRes.value?.data?.data) {
        for (const r of delRes.value.data.data) {
          normalized.push({
            id: `del-${r.id}`,
            rawId: r.id,
            kind: 'deletions',
            kindLabel: 'Member Deletion',
            module: 'members',
            summary: `Delete Member ${r.member_id} (${r.deletion_type || 'Termination'})`,
            detail: r.reason || 'No reason specified',
            hasWarning: false,
            warningText: null,
            requested_by: r.requested_by,
            created_at: r.created_at,
            status: r.status || 'PENDING',
            review_note: r.review_note || '',
            approvePath: `/approvals/deletion-requests/${r.id}/approve`,
            rejectPath: `/approvals/deletion-requests/${r.id}/reject`,
            raw: r,
          });
        }
      }

      // 3. Member Profile Changes
      if (profRes.status === 'fulfilled' && profRes.value?.data?.data) {
        for (const r of profRes.value.data.data) {
          const detailText =
            typeof r.new_values === 'object'
              ? formatPayloadSummary(r.new_values)
              : String(r.new_values || '—');
          normalized.push({
            id: `prof-${r.id}`,
            rawId: r.id,
            kind: 'profile',
            kindLabel: 'Profile Change',
            module: 'members',
            summary: `Profile Change for Member ${r.member_id}`,
            detail: detailText,
            hasWarning: false,
            warningText: null,
            requested_by: r.requested_by,
            created_at: r.created_at,
            status: r.status || 'PENDING',
            review_note: r.review_note || '',
            approvePath: `/approvals/profile-changes/${r.id}/approve`,
            rejectPath: `/approvals/profile-changes/${r.id}/reject`,
            raw: r,
          });
        }
      }

      // 4. Membership Type Changes
      if (typeRes.status === 'fulfilled' && typeRes.value?.data?.data) {
        for (const r of typeRes.value.data.data) {
          normalized.push({
            id: `type-${r.id}`,
            rawId: r.id,
            kind: 'types',
            kindLabel: 'Type Change',
            module: 'members',
            summary: `Member ${r.member_id}: Change to Type ${r.requested_type_id}`,
            detail: r.reason || 'No reason specified',
            hasWarning: false,
            warningText: null,
            requested_by: r.requested_by,
            created_at: r.created_at,
            status: r.status || 'PENDING',
            review_note: r.review_note || '',
            approvePath: `/approvals/type-changes/${r.id}/approve`,
            rejectPath: `/approvals/type-changes/${r.id}/reject`,
            raw: r,
          });
        }
      }

      // Sort all items newest first
      normalized.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      setAllItems(normalized);
    } catch (err) {
      setAllItems([]);
      setError(err.response?.data?.detail || 'Failed to load approvals from the server.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    let rows = allItems;
    if (selectedCategory !== 'ALL') {
      rows = rows.filter((r) => r.kind === selectedCategory);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.summary.toLowerCase().includes(q) ||
          r.detail.toLowerCase().includes(q) ||
          r.module.toLowerCase().includes(q) ||
          String(r.rawId).includes(q) ||
          (r.requested_by && String(r.requested_by).includes(q))
      );
    }
    return rows;
  }, [allItems, selectedCategory, searchQuery]);

  const approve = async (item) => {
    const ok = await confirmYesNo({
      title: 'Approve this request?',
      text: item.summary,
      confirmText: 'Yes, approve',
    });
    if (!ok) return;
    try {
      await api.put(item.approvePath);
      await showSuccess('Request approved.');
      await load();
    } catch (err) {
      await showError(err, 'Could not approve the request.');
      await load();
    }
  };

  const reject = async (item) => {
    const note = await askReason({
      title: 'Reject this request?',
      text: item.summary,
      confirmText: 'Yes, reject',
      danger: true,
    });
    if (!note) return;
    try {
      await api.put(item.rejectPath, null, { params: { note } });
      await showSuccess('Request rejected.');
      await load();
    } catch (err) {
      await showError(err, 'Could not reject the request.');
    }
  };

  const viewItem = useMemo(() => (viewId ? allItems.find((x) => x.id === viewId) || null : null), [allItems, viewId]);
  const setViewItem = (r) => setSearchParams(r ? { view: r.id } : {});

  // Build field comparison rows for the detail page
  const comparisonRows = useMemo(() => {
    if (!viewItem) return [];
    const raw = viewItem.raw || {};

    // 1. Profile Changes: compare old_values vs new_values
    if (viewItem.kind === 'profile') {
      const oldVals = raw.old_values || {};
      const newVals = raw.new_values || {};
      const allKeys = Array.from(new Set([...Object.keys(oldVals), ...Object.keys(newVals)]));

      return allKeys.map((key) => {
        const prev = oldVals[key];
        const next = newVals[key];
        const prevFormatted = formatValue(prev);
        const nextFormatted = formatValue(next);
        return {
          field: humanizeKey(key),
          previous: prevFormatted,
          proposed: nextFormatted,
          changed: prevFormatted !== nextFormatted,
        };
      });
    }

    // 2. Type Changes: compare current vs requested type
    if (viewItem.kind === 'types') {
      return [
        {
          field: 'Membership Type',
          previous: raw.current_membership_id
            ? `Membership ${raw.current_membership_id}`
            : 'Current Membership',
          proposed: `Requested Type ${raw.requested_type_id}`,
          changed: true,
        },
        {
          field: 'Change Reason',
          previous: '—',
          proposed: raw.reason || 'Not specified',
          changed: Boolean(raw.reason),
        },
      ];
    }

    // 3. Member Deletions: compare active vs deleted
    if (viewItem.kind === 'deletions') {
      return [
        {
          field: 'Member Status',
          previous: `Active (Member ${raw.member_id})`,
          proposed: `Deleted (${raw.deletion_type || 'SOFT'})`,
          changed: true,
        },
        {
          field: 'Deletion Grounds / Reason',
          previous: '—',
          proposed: raw.reason || 'Not specified',
          changed: true,
        },
      ];
    }

    // 4. Generic Change Requests
    if (viewItem.kind === 'requests') {
      const payload = raw.payload || {};
      const prev = payload._previous || null;
      const { _warning: _, _previous: __, ...newVals } = payload;
      const action = String(raw.action || '').toUpperCase();

      // the request body is usually wrapped once ({ receipt_in: { ... } }): show the fields themselves, not "Receipt In ›"
      // (an edit also carries the record's id beside the body: the id is dropped so the fields line up with the old values)
      const unwrap = (o) => {
        const entries = Object.entries(o || {});
        const bodies = entries.filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
        if (bodies.length !== 1) return o;
        const [bodyKey, body] = bodies[0];
        const rest = Object.fromEntries(entries.filter(([k, v]) => k !== bodyKey && k !== 'id' && !(v && typeof v === 'object')));
        return { ...rest, ...body };
      };
      const isNum = (v) => v !== '' && v !== null && typeof v !== 'boolean' && Number.isFinite(Number(v));
      const newFlat = flattenPayload(unwrap(newVals));
      const prevFlat = prev ? flattenPayload(unwrap(prev)) : null;

      if (action === 'CREATE') {
        const keys = Object.keys(newFlat).filter((k) => !isEmptyVal(newFlat[k]));
        if (keys.length === 0) {
          return [{ field: 'Record Status', previous: '—', proposed: 'New Record Creation', changed: true }];
        }
        return keys.map((key) => ({
          field: key,
          previous: '—',
          proposed: formatValue(newFlat[key]),
          changed: true,
        }));
      }

      if (action === 'DELETE') {
        const rows = [{ field: 'Record Status', previous: 'Active / Existing', proposed: 'Deleted', changed: true }];
        if (prevFlat) {
          Object.keys(prevFlat)
            .filter((k) => !isEmptyVal(prevFlat[k]))
            .forEach((k) => {
              rows.push({ field: k, previous: formatValue(prevFlat[k]), proposed: '(Deleted)', changed: true });
            });
        }
        return rows;
      }

      // Action is UPDATE: show only fields that actually changed when the old values are known
      const keys = Object.keys(newFlat);
      if (keys.length === 0) {
        return [{ field: 'Status', previous: 'Existing', proposed: 'Update Requested', changed: true }];
      }

      const rows = keys.map((key) => {
        const known = prevFlat && key in prevFlat;
        const prevFormatted = known ? formatValue(prevFlat[key]) : '(Current Value)';
        const nextFormatted = formatValue(newFlat[key]);
        // 44 and "44.00" are the same amount
        const sameNumber = known && isNum(prevFlat[key]) && isNum(newFlat[key]) && Number(prevFlat[key]) === Number(newFlat[key]);
        return {
          field: key,
          previous: prevFormatted,
          proposed: nextFormatted,
          changed: known ? prevFormatted !== nextFormatted && !sameNumber : true,
        };
      });
      return rows;
    }

    return [];
  }, [viewItem]);
  // a request that creates a record has nothing before it: show the fields and their values only

  if (viewId) {
    return (
      <PermissionGate required="approvals.read">
        {viewItem ? (
          <ApprovalDetail
            item={viewItem}
            rows={comparisonRows}
            canWrite={hasPermission('approvals.write')}
            onBack={() => setViewItem(null)}
            onApprove={async () => {
              await approve(viewItem);
              setViewItem(null);
            }}
            onReject={async () => {
              await reject(viewItem);
              setViewItem(null);
            }}
          />
        ) : (
          <div className="text-xs text-[#863221]">
            {loading ? 'Loading request…' : 'This request was not found in the current list.'}{' '}
            <button type="button" onClick={() => setViewItem(null)} className="underline font-semibold cursor-pointer">
              Back to list
            </button>
          </div>
        )}
      </PermissionGate>
    );
  }

  return (
    <PermissionGate required="approvals.read">
      <div className="space-y-6">
        {/* Action row: the filter icon (it opens the search and filter card below) and Refresh */}
        <div className="flex items-center justify-end gap-2 -mb-2">
          <FilterToggle
            open={filtersOpen}
            onToggle={() => setFiltersOpen((o) => !o)}
            count={(statusFilter !== 'PENDING' ? 1 : 0) + (selectedCategory !== 'ALL' ? 1 : 0)}
          />
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 h-9 bg-white border border-[#E8DFD8] hover:bg-[#FAF7F2] text-xs font-semibold text-[#510601] rounded-xl transition-colors cursor-pointer disabled:opacity-60 shadow-2xs"
            title="Refresh approvals"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* The search and filters: hidden until the filter icon is clicked */}
        {filtersOpen && (
          <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] p-4 sm:p-5 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#863221]/50" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search requests..."
                className="w-full h-9 pl-9 pr-8 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] placeholder-[#863221]/40 focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#863221]/50 hover:text-[#510601] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="h-9 px-3 bg-white border border-[#E8DFD8] rounded-xl text-xs font-semibold text-[#510601] focus:outline-none focus:border-[#510601] cursor-pointer"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat.key} value={cat.key}>{cat.label}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 px-3 bg-white border border-[#E8DFD8] rounded-xl text-xs font-semibold text-[#510601] focus:outline-none focus:border-[#510601] cursor-pointer"
            >
              <option value="PENDING">Status: Pending</option>
              <option value="ALL">Status: All</option>
              <option value="APPROVED">Status: Approved</option>
              <option value="REJECTED">Status: Rejected</option>
            </select>
            <button
              type="button"
              onClick={() => { setSearchQuery(''); setSelectedCategory('ALL'); setStatusFilter('PENDING'); }}
              className="h-9 px-3 text-xs font-semibold text-[#863221] hover:text-[#ED4636] hover:bg-red-50 rounded-xl border border-[#E8DFD8] hover:border-red-200 transition-colors cursor-pointer inline-flex items-center gap-1.5"
              title="Reset the filters"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset Filters</span>
            </button>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-[#FAF1EE] border border-[#8C1801]/25 text-xs text-[#8C1801]">
            {error}
          </div>
        )}

        {/* Unified Table */}
        <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4 w-[6%]">#</th>
                  <th className="py-3 px-4 w-[13%]">Category</th>
                  <th className="py-3 px-4 w-[26%]">Request</th>
                  <th className="py-3 px-4 w-[23%]">Details</th>
                  <th className="py-3 px-4 w-[12%]">Requested</th>
                  <th className="py-3 px-4 w-[8%] text-center">Status</th>
                  <th className="py-3 px-4 w-[20%] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-[#863221]/70">
                      <div className="flex flex-col items-center gap-2">
                        <Inbox className="w-7 h-7 text-[#863221]/40" />
                        <span className="font-medium">
                          {loading
                            ? 'Loading requests…'
                            : searchQuery || selectedCategory !== 'ALL' || statusFilter !== 'ALL'
                              ? 'No matching requests found.'
                              : 'No pending approval requests.'}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r) => (
                    <tr key={r.id} className="hover:bg-[#FAF7F2]/40 transition-colors">
                      <td className="py-3 px-4 font-mono font-semibold text-[#510601]">
                        {r.rawId}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${kindBadge(
                            r.kind
                          )}`}
                        >
                          {r.kindLabel}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[#180200]">{r.summary}</div>
                        <div className="text-[10px] text-[#863221]/70 capitalize">{r.module}</div>
                      </td>
                      <td className="py-3 px-4 max-w-[300px]">
                        {r.hasWarning ? (
                          <div
                            className="inline-flex items-center gap-1 font-semibold text-[#8C1801] bg-[#8C1801]/10 border border-[#8C1801]/20 px-2 py-0.5 rounded text-[11px]"
                            title={r.warningText}
                          >
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span className="truncate">{r.warningText}</span>
                          </div>
                        ) : (
                          <div className="text-[#863221] truncate" title={r.detail}>
                            {r.detail}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-[#863221]">
                        <div>{formatDateTime(r.created_at, '—', false)}</div>
                        {r.requested_by ? (
                          <div className="text-[10px] text-[#863221]/60">by user {r.requested_by}</div>
                        ) : null}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${badge(
                            r.status
                          )}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* View Button */}
                          <button
                            type="button"
                            onClick={() => setViewItem(r)}
                            title="View & Compare"
                            className="btn-act btn-act-neutral"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View</span>
                          </button>

                          {r.status === 'PENDING' ? (
                            <>
                              {hasPermission('approvals.write') && (
                                <button
                                  type="button"
                                  onClick={() => approve(r)}
                                  title="Approve"
                                  className="btn-act btn-act-ok"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Approve</span>
                                </button>
                              )}
                              {hasPermission('approvals.write') && (
                                <button
                                  type="button"
                                  onClick={() => reject(r)}
                                  title="Reject"
                                  className="btn-act btn-act-danger"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>Reject</span>
                                </button>
                              )}
                            </>
                          ) : (
                            <span className="text-[#863221]/60 text-[10px] italic truncate max-w-[80px]" title={r.review_note}>
                              {r.review_note || '—'}
                            </span>
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
      </div>

    </PermissionGate>
  );
}
