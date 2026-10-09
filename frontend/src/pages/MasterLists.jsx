import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Edit3, Trash2, RefreshCw } from 'lucide-react';
import api from '../api';
import PermissionGate from '../components/PermissionGate';
import SearchFilterBar from '../components/SearchFilterBar';
import FilterSelect from '../components/FilterSelect';
import useAuth from '../hooks/useAuth';
import { askForm, confirmYesNo, showError, showSuccess } from '../utils/dialogs';

const isPending = (d) => Boolean(d && (d.approval_request_id || d.status === 'PENDING'));
const makeCode = (name) => `${String(name).replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'ITEM'}${Date.now().toString().slice(-5)}`;

// One list screen for a simple master: search, add, edit, active/inactive, delete.
// Everything is read from and written to the server.
//   fields:  [{ name, label, type, required, options }]   -> keys sent to the API as-is
//   columns: [{ label, render(row) }]
function MasterTable({ title, subtitle, endpoint, fields, columns, withCode, pageTitle }) {
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(endpoint, { params: { limit: 1000 } });
      setRows(res.data?.data || []);
    } catch (err) {
      setRows([]);
      setError(err.response?.data?.detail || 'Failed to load from the server.');
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    let list = rows;
    if (statusFilter !== 'ALL') {
      const want = statusFilter === 'Active';
      list = list.filter((r) => Boolean(r.status) === want);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }, [rows, search, statusFilter]);

  const formFields = (row) => [
    ...fields.map((f) => ({ ...f, value: row ? row[f.name] ?? '' : '' })),
    { name: 'status', label: 'Status', type: 'status', required: true, value: row ? (row.status ? 'Active' : 'Inactive') : 'Active' }
  ];

  const toBody = (values) => {
    const body = { status: values.status !== 'Inactive' };
    fields.forEach((f) => {
      const v = values[f.name];
      body[f.name] = v === '' || v === undefined ? null : f.type === 'select' && /^\d+$/.test(String(v)) ? Number(v) : v;
    });
    return body;
  };

  const done = async (data, ok, pending) => {
    await showSuccess(isPending(data) ? pending : ok);
    await load();
  };

  const add = async () => {
    const values = await askForm({ title: `Add ${title}`, fields: formFields(null), confirmText: 'Add' });
    if (!values) return;
    try {
      const body = toBody(values);
      if (withCode) body.code = makeCode(values.name_en);
      const { data } = await api.post(endpoint, body);
      await done(data, 'Added.', 'Submitted for approval.');
    } catch (err) {
      await showError(err, 'Could not add.');
    }
  };

  const edit = async (row) => {
    const values = await askForm({ title: `Edit ${title}`, fields: formFields(row), confirmText: 'Save' });
    if (!values) return;
    try {
      const { data } = await api.put(`${endpoint}/${row.id}`, toBody(values));
      await done(data, 'Saved.', 'Change submitted for approval.');
    } catch (err) {
      await showError(err, 'Could not save.');
    }
  };

  const toggle = async (row) => {
    const next = !row.status;
    const ok = await confirmYesNo({
      title: `Set ${next ? 'Active' : 'Inactive'}?`,
      text: row.name_en,
      confirmText: next ? 'Activate' : 'Deactivate'
    });
    if (!ok) return;
    try {
      const { data } = await api.put(`${endpoint}/${row.id}`, { status: next });
      await done(data, `Now ${next ? 'Active' : 'Inactive'}.`, 'Change submitted for approval.');
    } catch (err) {
      await showError(err, 'Could not change the status.');
    }
  };

  const remove = async (row) => {
    const ok = await confirmYesNo({
      title: `Delete "${row.name_en}"?`,
      text: 'This cannot be undone.',
      confirmText: 'Yes, delete',
      danger: true
    });
    if (!ok) return;
    try {
      const { data } = await api.delete(`${endpoint}/${row.id}`);
      await done(data, 'Deleted.', 'Delete request submitted for approval.');
    } catch (err) {
      await showError(err, 'Could not delete.');
    }
  };

  return (
    <div className="space-y-4">
      <SearchFilterBar
        title={pageTitle ? pageTitle : <h2 className="text-lg font-bold text-[#180200]">{title}</h2>}
        searchQuery={search}
        onSearchChange={(val) => setSearch(val)}
        activeFiltersCount={statusFilter !== 'ALL' ? 1 : 0}
        onResetFilters={() => {
          setSearch('');
          setStatusFilter('ALL');
        }}
        rightSlot={
          <>
            <button
              type="button"
              onClick={load}
              className="p-2 bg-white border border-[#E8DFD8] rounded-xl text-[#510601] hover:bg-[#FAF7F2] cursor-pointer shrink-0"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={add}
              disabled={!hasPermission('masters.write')}
              title={!hasPermission('masters.write') ? 'Requires masters.write permission' : `Add ${title}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-40 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </>
        }
      >
        <FilterSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'ALL', label: 'All Status' },
            { value: 'Active', label: 'Active' },
            { value: 'Inactive', label: 'Inactive' }
          ]}
          widthClass="w-full sm:w-40"
        />
      </SearchFilterBar>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
            <tr>
              {columns.map((c) => (
                <th key={c.label} className="py-3 px-4">{c.label}</th>
              ))}
              <th className="py-3 px-4 text-center">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E8DFD8]">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="py-10 text-center text-[#863221]/70">
                  {loading ? 'Loading…' : 'Nothing here yet.'}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.id} className="hover:bg-[#FAF7F2]/40">
                  {columns.map((c) => (
                    <td key={c.label} className="py-3 px-4 text-[#180200]">{c.render(row) || '—'}</td>
                  ))}
                  <td className="py-3 px-4 text-center">
                    <button
                      type="button"
                      onClick={() => toggle(row)}
                      disabled={!hasPermission('masters.write')}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold border cursor-pointer disabled:opacity-40 ${
                        row.status
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-gray-100 text-gray-600 border-gray-200'
                      }`}
                      title={!hasPermission('masters.write') ? 'Requires masters.write permission' : 'Click to change status'}
                    >
                      {row.status ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => edit(row)}
                        disabled={!hasPermission('masters.write')}
                        className="p-1.5 rounded-lg text-[#510601] border border-[#E8DFD8] hover:bg-[#FAF7F2] cursor-pointer disabled:opacity-40"
                        title={!hasPermission('masters.write') ? 'Requires masters.write permission' : 'Edit'}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(row)}
                        disabled={!hasPermission('masters.delete')}
                        className="p-1.5 rounded-lg text-[#ED4636] border border-red-200 hover:bg-red-50 cursor-pointer disabled:opacity-40"
                        title={!hasPermission('masters.delete') ? 'Requires masters.delete permission' : 'Delete'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────── Bank master ─────────────
export function BankMaster() {
  return (
    <PermissionGate required="masters.read">
      <div className="space-y-6">
        <MasterTable
          pageTitle="Bank Master"
          title="Bank"
          endpoint="/masters/banks"
          withCode
          fields={[
            { name: 'name_en', label: 'Bank name', required: true },
            { name: 'branch_name', label: 'Branch' },
            { name: 'ifsc_code', label: 'IFSC code' },
            { name: 'account_number', label: 'Account number' }
          ]}
          columns={[
            { label: 'Bank', render: (r) => r.name_en },
            { label: 'Branch', render: (r) => r.branch_name },
            { label: 'IFSC', render: (r) => r.ifsc_code },
            { label: 'Account no.', render: (r) => r.account_number }
          ]}
        />
      </div>
    </PermissionGate>
  );
}

// ───────────── Personal masters: gotra, qualification, native place ─────────────
export default function PersonalMasters() {
  const [tab, setTab] = useState('gotras');
  const [districts, setDistricts] = useState([]);

  useEffect(() => {
    api
      .get('/masters/districts', { params: { limit: 2000 } })
      .then((res) => setDistricts(res.data?.data || []))
      .catch(() => setDistricts([]));
  }, []);

  const districtName = useMemo(() => Object.fromEntries(districts.map((d) => [d.id, d.name_en])), [districts]);

  const base = [
    { name: 'name_en', label: 'Name', required: true },
    { name: 'name_kn', label: 'Name (Kannada)' }
  ];
  const baseColumns = [
    { label: 'Name', render: (r) => r.name_en },
    { label: 'Kannada', render: (r) => r.name_kn }
  ];

  const tabs = {
    gotras: { label: 'Gotra', title: 'Gotra', endpoint: '/masters/gotras', fields: base, columns: baseColumns },
    qualifications: { label: 'Qualification', title: 'Qualification', endpoint: '/masters/qualifications', fields: base, columns: baseColumns },
    'native-places': {
      label: 'Native place',
      title: 'Native place',
      endpoint: '/masters/native-places',
      fields: [
        ...base,
        { name: 'district_id', label: 'District', type: 'select', options: districts.map((d) => ({ value: d.id, label: d.name_en })) }
      ],
      columns: [...baseColumns, { label: 'District', render: (r) => districtName[r.district_id] }]
    }
  };
  const current = tabs[tab];

  return (
    <PermissionGate required="masters.read">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#180200] tracking-tight">Personal Masters</h1>
          <p className="text-sm text-[#863221] mt-1">Dropdown values used in the member profile.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(tabs).map(([key, t]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer transition-colors ${
                tab === key ? 'bg-[#510601] text-white border-[#510601]' : 'bg-white text-[#510601] border-[#E8DFD8] hover:bg-[#FAF7F2]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <MasterTable key={tab} {...current} />
      </div>
    </PermissionGate>
  );
}
