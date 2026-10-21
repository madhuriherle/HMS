import Pager from '../components/Pager';
import { FilterCard } from '../components/FilterToggle';
import { formatDateTime } from '../utils/dateUtils';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Eye,
  Filter,
} from 'lucide-react';
import api from '../api';
import { notify } from '../utils/notify';
import useLists from '../hooks/useLists';
import { apiErrorMessage } from '../utils/apiError';

export default function ActivityLogs() {
  const lists = useLists(); // filter choices from the server (GET /meta/lists)
  // Preset tabs: 'today' | 'yesterday' | 'week' | 'month' | 'custom'
  const [activeDateTab, setActiveDateTab] = useState('today');

  // Filters
  // opens on today (the local date, not the UTC one)
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [fromDate, setFromDate] = useState(localToday);
  const [toDate, setToDate] = useState(localToday);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedActivityType, setSelectedActivityType] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All Status');
  const [selectedClient, setSelectedClient] = useState('All Clients');
  const [showNavigation, setShowNavigation] = useState(false); // navigation activity is hidden until it is ticked

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [totalCount, setTotalCount] = useState(0);

  // Data
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total_logs: 0,
    success: 0,
    failed: 0,
    important: 0,
  });

  // User list for dropdown
  const [usersList, setUsersList] = useState([]);

  // Load user options
  useEffect(() => {
    api.get('/users/', { params: { limit: 500 } })
      .then((res) => {
        const uData = res.data?.data || res.data || [];
        setUsersList(Array.isArray(uData) ? uData : []);
      })
      .catch(() => {});
  }, []);

  // Quick Date Preset handler
  const handleDatePreset = (preset) => {
    setActiveDateTab(preset);
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    if (preset === 'today') {
      setFromDate(todayStr);
      setToDate(todayStr);
    } else if (preset === 'yesterday') {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yStr = y.toISOString().split('T')[0];
      setFromDate(yStr);
      setToDate(yStr);
    } else if (preset === 'week') {
      const w = new Date();
      w.setDate(w.getDate() - 7);
      setFromDate(w.toISOString().split('T')[0]);
      setToDate(todayStr);
    } else if (preset === 'month') {
      const m = new Date();
      m.setDate(m.getDate() - 30);
      setFromDate(m.toISOString().split('T')[0]);
      setToDate(todayStr);
    }
    setPage(1);
  };

  // Fetch stats and logs
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page,
        limit,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        user_id: selectedUser || undefined,
        activity_type: selectedActivityType !== 'All' ? selectedActivityType : undefined,
        status: selectedStatus !== 'All Status' ? selectedStatus : undefined,
        client_type: selectedClient !== 'All Clients' ? selectedClient : undefined,
        show_navigation: showNavigation,
      };

      const [logsRes, statsRes] = await Promise.all([
        api.get('/activity/users', { params }),
        api.get('/activity/stats', {
          params: {
            from_date: fromDate || undefined,
            to_date: toDate || undefined,
            user_id: selectedUser || undefined,
          },
        }),
      ]);

      const logData = logsRes.data?.data || [];
      setLogs(Array.isArray(logData) ? logData : []);
      setTotalCount(logsRes.data?.total || 0);

      if (statsRes.data) {
        setStats(statsRes.data);
      }
    } catch (err) {
      notify(apiErrorMessage(err, 'Failed to load activity logs'), 'error');
    } finally {
      setLoading(false);
    }
  }, [page, limit, fromDate, toDate, selectedUser, selectedActivityType, selectedStatus, selectedClient, showNavigation]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  // Format timestamp: DD-MM-YYYY HH:mm:ss
  const formatLogDate = (isoStr) => formatDateTime(isoStr);

  return (
    <div className="space-y-6">
      {/* Quick Date Tabs */}
      <div className="flex flex-wrap items-center gap-2 -mb-2">
          {[
            { id: 'today', label: 'Today' },
            { id: 'yesterday', label: 'Yesterday' },
            { id: 'week', label: 'This Week' },
            { id: 'month', label: 'This Month' },
            { id: 'custom', label: 'Custom' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleDatePreset(tab.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer shadow-2xs ${
                activeDateTab === tab.id
                  ? 'bg-[#510601] text-white shadow-xs'
                  : 'bg-white hover:bg-[#FAF7F2] text-[#180200] border border-[#E8DFD8]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

      {/* Top 4 Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* TOTAL LOGS */}
        <div className="bg-white rounded-2xl p-5 border border-[#E8DFD8] shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold tracking-wider text-[#863221] uppercase">Total Logs</span>
            <div className="text-2xl font-black text-[#510601] mt-1">
              {Number(stats.total_logs || 0).toLocaleString()}
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-[#510601]/10 border border-[#510601]/15 flex items-center justify-center text-[#510601]">
            <Activity className="w-5 h-5 stroke-[2.2]" />
          </div>
        </div>

        {/* SUCCESS */}
        <div className="bg-white rounded-2xl p-5 border border-[#E8DFD8] shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold tracking-wider text-[#863221] uppercase">Success</span>
            <div className="text-2xl font-black text-[#3D705C] mt-1">
              {Number(stats.success || 0).toLocaleString()}
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-[#3D705C]/10 border border-[#3D705C]/20 flex items-center justify-center text-[#3D705C]">
            <CheckCircle2 className="w-5 h-5 stroke-[2.2]" />
          </div>
        </div>

        {/* FAILED */}
        <div className="bg-white rounded-2xl p-5 border border-[#E8DFD8] shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold tracking-wider text-[#863221] uppercase">Failed</span>
            <div className="text-2xl font-black text-[#8C1801] mt-1">
              {Number(stats.failed || 0).toLocaleString()}
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-[#8C1801]/10 border border-[#8C1801]/20 flex items-center justify-center text-[#8C1801]">
            <XCircle className="w-5 h-5 stroke-[2.2]" />
          </div>
        </div>

        {/* IMPORTANT */}
        <div className="bg-white rounded-2xl p-5 border border-[#E8DFD8] shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold tracking-wider text-[#863221] uppercase">Important</span>
            <div className="text-2xl font-black text-[#EE6A00] mt-1">
              {Number(stats.important || 0).toLocaleString()}
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-[#EE6A00]/10 border border-[#EE6A00]/20 flex items-center justify-center text-[#EE6A00]">
            <AlertTriangle className="w-5 h-5 stroke-[2.2]" />
          </div>
        </div>
      </div>

      {/* Advanced Filter Card */}
      <FilterCard
        count={(selectedUser ? 1 : 0) + (selectedActivityType !== 'All' ? 1 : 0) + (selectedStatus !== 'All Status' ? 1 : 0) + (selectedClient !== 'All Clients' ? 1 : 0)}
        className="bg-white rounded-2xl p-5 border border-[#E8DFD8] shadow-2xs space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
          {/* FROM DATE */}
          <div>
            <label className="block text-[11px] font-bold text-[#180200] uppercase tracking-wider mb-1">
              From Date
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setActiveDateTab('custom');
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FAF7F2] focus:bg-white border border-[#E8DFD8] rounded-lg text-xs font-medium text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]/20 shadow-2xs cursor-pointer"
            />
          </div>

          {/* TO DATE */}
          <div>
            <label className="block text-[11px] font-bold text-[#180200] uppercase tracking-wider mb-1">
              To Date
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setActiveDateTab('custom');
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FAF7F2] focus:bg-white border border-[#E8DFD8] rounded-lg text-xs font-medium text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]/20 shadow-2xs cursor-pointer"
            />
          </div>

          {/* USER */}
          <div>
            <label className="block text-[11px] font-bold text-[#180200] uppercase tracking-wider mb-1">
              User
            </label>
            <select
              value={selectedUser}
              onChange={(e) => {
                setSelectedUser(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FAF7F2] focus:bg-white border border-[#E8DFD8] rounded-lg text-xs font-medium text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]/20 shadow-2xs cursor-pointer"
            >
              <option value="">All Users</option>
              {usersList.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.username} ({u.username})
                </option>
              ))}
            </select>
          </div>

          {/* ACTIVITY TYPE */}
          <div>
            <label className="block text-[11px] font-bold text-[#180200] uppercase tracking-wider mb-1">
              Activity Type
            </label>
            <select
              value={selectedActivityType}
              onChange={(e) => {
                setSelectedActivityType(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FAF7F2] focus:bg-white border border-[#E8DFD8] rounded-lg text-xs font-medium text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]/20 shadow-2xs cursor-pointer"
            >
              <option value="All">All Actions</option>
              {(lists?.activity_action_groups || []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </div>

          {/* STATUS */}
          <div>
            <label className="block text-[11px] font-bold text-[#180200] uppercase tracking-wider mb-1">
              Status
            </label>
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FAF7F2] focus:bg-white border border-[#E8DFD8] rounded-lg text-xs font-medium text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]/20 shadow-2xs cursor-pointer"
            >
              <option value="All Status">All Status</option>
              {(lists?.activity_statuses || []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </div>

          {/* CLIENT */}
          <div>
            <label className="block text-[11px] font-bold text-[#180200] uppercase tracking-wider mb-1">
              Client
            </label>
            <select
              value={selectedClient}
              onChange={(e) => {
                setSelectedClient(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FAF7F2] focus:bg-white border border-[#E8DFD8] rounded-lg text-xs font-medium text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]/20 shadow-2xs cursor-pointer"
            >
              <option value="All Clients">All Clients</option>
              {(lists?.activity_clients || []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* Bottom row: Checkbox & Refresh Button */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#E8DFD8]">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showNavigation}
              onChange={(e) => {
                setShowNavigation(e.target.checked);
                setPage(1);
              }}
              className="w-4 h-4 rounded text-[#510601] focus:ring-[#510601] border-[#E8DFD8] accent-[#510601] cursor-pointer"
            />
            <span className="text-xs font-semibold text-[#180200]">
              Show Navigation Activity
            </span>
          </label>

          <button
            type="button"
            onClick={fetchLogs}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-[#E8DFD8] bg-white hover:bg-[#FAF7F2] text-xs font-semibold text-[#180200] transition-colors shadow-2xs cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#510601]' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </FilterCard>

      {/* Main Table Card */}
      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-2xs overflow-hidden">
        {/* Table Header Row (Terracotta Background like screenshot) */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#863221] text-xs font-bold uppercase tracking-wider">
                <th className="py-3 px-4 w-5/12">Activity</th>
                <th className="py-3 px-4 w-3/12">User</th>
                <th className="py-3 px-4 w-2/12">Module</th>
                <th className="py-3 px-4 w-2/12">Status</th>
                <th className="py-3 px-4 text-right">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8DFD8] text-xs">
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[#863221] font-medium">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-[#510601] mb-2" />
                    Loading activity logs...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[#863221] font-medium">
                    No activity logs match the selected filter criteria.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isSuccess = (log.status || 'SUCCESS') === 'SUCCESS';
                  return (
                    <tr
                      key={log.id}
                      className="hover:bg-[#FAF7F2] transition-colors font-medium text-[#180200]"
                    >
                      {/* Activity Description */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <Eye className="w-3.5 h-3.5 text-[#863221] shrink-0" />
                          <span className="font-semibold text-[#180200] capitalize">
                            {log.activity_description || log.description || log.action}
                          </span>
                        </div>
                      </td>

                      {/* User */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-[#510601]/10 text-[#510601] flex items-center justify-center font-bold text-[10px] shrink-0">
                            {(log.user_name || 'U').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-[#180200] block truncate">
                              {log.user_name}
                            </span>
                            <span className="text-[10px] text-[#863221] block">
                              {log.role_name || 'User'}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Module Pill Badge */}
                      <td className="py-3 px-4">
                        <span className="inline-block px-2.5 py-0.5 rounded-md bg-[#FAF7F2] border border-[#E8DFD8] text-[11px] font-semibold text-[#863221]">
                          {log.module || 'System'}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        {isSuccess ? (
                          <span className="inline-flex items-center gap-1 font-bold text-[#3D705C] text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>SUCCESS</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-bold text-[#8C1801] text-[11px]">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>FAILED</span>
                          </span>
                        )}
                      </td>

                      {/* Date & Time */}
                      <td className="py-3 px-4 text-right whitespace-nowrap text-[#863221] font-mono text-[11px]">
                        {formatLogDate(log.created_at)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer: Pager */}
        {totalCount > 0 && (
          <div className="p-4 bg-[#FAF7F2]/40 border-t border-[#E8DFD8]">
            <Pager
              page={page}
              pages={totalPages}
              total={totalCount}
              pageSize={limit}
              onPage={setPage}
              onPageSize={(s) => { setLimit(s); setPage(1); }}
              sizes={[20, 50, 100, 200]}
            />
          </div>
        )}
      </div>
    </div>
  );
}
