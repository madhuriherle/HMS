import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { CheckCircle2, XCircle, Inbox, Search, RefreshCw, X, AlertTriangle } from 'lucide-react';
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
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'REJECTED'
      ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-amber-50 text-amber-700 border-amber-200';

const kindBadge = (kind) => {
  switch (kind) {
    case 'requests':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'deletions':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'profile':
      return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'types':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    default:
      return 'bg-gray-50 text-gray-700 border-gray-200';
  }
};

const formatPayloadSummary = (payload) => {
  if (!payload || typeof payload !== 'object') return '';
  const entries = Object.entries(payload).filter(([k]) => !k.startsWith('_'));
  if (entries.length === 0) return '';
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' | ');
};

export default function Approvals() {
  const { hasPermission } = useAuth();
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Filters
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('PENDING'); // Default to PENDING
  const [searchQuery, setSearchQuery] = useState('');

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
          const { _warning: _, ...cleanPayload } = r.payload || {};
          const detailText = warning
            ? `Warning: ${warning}`
            : formatPayloadSummary(cleanPayload) || r.error || '—';

          normalized.push({
            id: `req-${r.id}`,
            rawId: r.id,
            kind: 'requests',
            kindLabel: 'Change Request',
            module: r.module || 'system',
            summary: `${r.action} ${r.entity_type}${r.entity_id ? ` #${r.entity_id}` : ''}`,
            detail: detailText,
            hasWarning: Boolean(warning),
            warningText: warning,
            requested_by: r.requested_by,
            created_at: r.created_at,
            status: r.status || 'PENDING',
            review_note: r.review_note || '',
            approvePath: `/approvals/requests/${r.id}/approve`,
            rejectPath: `/approvals/requests/${r.id}/reject`,
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
            summary: `Delete Member #${r.member_id} (${r.deletion_type || 'Termination'})`,
            detail: r.reason || 'No reason specified',
            hasWarning: false,
            warningText: null,
            requested_by: r.requested_by,
            created_at: r.created_at,
            status: r.status || 'PENDING',
            review_note: r.review_note || '',
            approvePath: `/approvals/deletion-requests/${r.id}/approve`,
            rejectPath: `/approvals/deletion-requests/${r.id}/reject`,
          });
        }
      }

      // 3. Member Profile Changes
      if (profRes.status === 'fulfilled' && profRes.value?.data?.data) {
        for (const r of profRes.value.data.data) {
          const detailText = typeof r.new_values === 'object'
            ? formatPayloadSummary(r.new_values)
            : String(r.new_values || '—');
          normalized.push({
            id: `prof-${r.id}`,
            rawId: r.id,
            kind: 'profile',
            kindLabel: 'Profile Change',
            module: 'members',
            summary: `Profile Change for Member #${r.member_id}`,
            detail: detailText,
            hasWarning: false,
            warningText: null,
            requested_by: r.requested_by,
            created_at: r.created_at,
            status: r.status || 'PENDING',
            review_note: r.review_note || '',
            approvePath: `/approvals/profile-changes/${r.id}/approve`,
            rejectPath: `/approvals/profile-changes/${r.id}/reject`,
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
            summary: `Member #${r.member_id}: Change to Type #${r.requested_type_id}`,
            detail: r.reason || 'No reason specified',
            hasWarning: false,
            warningText: null,
            requested_by: r.requested_by,
            created_at: r.created_at,
            status: r.status || 'PENDING',
            review_note: r.review_note || '',
            approvePath: `/approvals/type-changes/${r.id}/approve`,
            rejectPath: `/approvals/type-changes/${r.id}/reject`,
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

  // Counts by category
  const counts = useMemo(() => {
    const c = { ALL: allItems.length, requests: 0, deletions: 0, profile: 0, types: 0 };
    for (const item of allItems) {
      if (c[item.kind] !== undefined) c[item.kind] += 1;
    }
    return c;
  }, [allItems]);

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

  return (
    <PermissionGate required="approvals.read">
      <div className="space-y-6">
        {/* Page Heading and Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#180200] tracking-tight">Approvals</h1>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E8DFD8] hover:bg-[#FAF7F2] text-xs font-semibold text-[#510601] rounded-xl transition-colors cursor-pointer disabled:opacity-60"
            title="Refresh approvals"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Filter Bar */}
        <div className="space-y-3">
          {/* Top row: Category Filter Pills & Search */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {CATEGORIES.map((cat) => {
                const count = counts[cat.key] || 0;
                const isSelected = selectedCategory === cat.key;
                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => setSelectedCategory(cat.key)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[#510601] text-white border-[#510601]'
                        : 'bg-white text-[#510601] border-[#E8DFD8] hover:bg-[#FAF7F2]'
                    }`}
                  >
                    <span>{cat.label}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-[#FAF7F2] text-[#863221]'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Status Filter & Search */}
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-white border border-[#E8DFD8] rounded-xl text-xs font-semibold text-[#510601] focus:outline-none focus:border-[#510601] cursor-pointer"
              >
                <option value="PENDING">Status: Pending</option>
                <option value="ALL">Status: All</option>
                <option value="APPROVED">Status: Approved</option>
                <option value="REJECTED">Status: Rejected</option>
              </select>

              <div className="relative min-w-[180px] max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#863221]/50" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter requests..."
                  className="w-full pl-8 pr-7 py-1.5 bg-white border border-[#E8DFD8] rounded-xl text-xs text-[#180200] placeholder-[#863221]/40 focus:outline-none focus:border-[#510601]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
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
                  <th className="py-3 px-4 w-[14%]">Category</th>
                  <th className="py-3 px-4 w-[28%]">Request</th>
                  <th className="py-3 px-4 w-[24%]">Details</th>
                  <th className="py-3 px-4 w-[13%]">Requested</th>
                  <th className="py-3 px-4 w-[8%] text-center">Status</th>
                  <th className="py-3 px-4 w-[17%] text-right">Actions</th>
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
                        #{r.rawId}
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
                      <td className="py-3 px-4 max-w-[320px]">
                        {r.hasWarning ? (
                          <div
                            className="inline-flex items-center gap-1 font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded text-[11px]"
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
                          <div className="text-[10px] text-[#863221]/60">by user #{r.requested_by}</div>
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
                        {r.status === 'PENDING' ? (
                          <div className="flex items-center justify-end gap-1.5">
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
                          </div>
                        ) : (
                          <div className="text-right text-[#863221]/70 text-[11px]">
                            {r.review_note || '—'}
                          </div>
                        )}
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
