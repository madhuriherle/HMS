import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Trash2, Search } from 'lucide-react';
import api from '../api';
import PageTitle from '../components/PageTitle';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import { confirmYesNo, showError, showSuccess } from '../utils/dialogs';

const isPending = (d) => Boolean(d && (d.approval_request_id || d.status === 'PENDING'));

// A master with one field: the form on the left (Add, or Edit after Edit is pressed), the list on the right.
// Every row is Active; there is no status to set. Everything is read from and written to the server.
// The Kannada name is switched off for now (the column and the server still support it).
function SimpleMaster({ title, endpoint, label = 'Name', placeholder = '' }) {
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);   // the row being edited, null when adding
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canWrite = hasPermission('masters.write');

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
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => String(r.name_en || '').toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const reset = () => {
    setEditing(null);
    setName('');
  };

  const save = async (e) => {
    e.preventDefault();
    const value = name.trim();
    if (!value) {
      setError(`${label} is required.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { data } = editing
        ? await api.put(`${endpoint}/${editing.id}`, { name_en: value })
        : await api.post(endpoint, { name_en: value, status: true });
      await showSuccess(isPending(data) ? 'Submitted for approval.' : editing ? 'Saved.' : 'Added.');
      reset();
      await load();
    } catch (err) {
      await showError(err, editing ? 'Could not save.' : 'Could not add.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (row) => {
    setEditing(row);
    setName(row.name_en || '');
    setError('');
  };

  const remove = async (row) => {
    const ok = await confirmYesNo({ title: `Delete "${row.name_en}"?`, text: 'This cannot be undone.', confirmText: 'Yes, delete', danger: true });
    if (!ok) return;
    try {
      const { data } = await api.delete(`${endpoint}/${row.id}`);
      await showSuccess(isPending(data) ? 'Delete request submitted for approval.' : 'Deleted.');
      if (editing?.id === row.id) reset();
      await load();
    } catch (err) {
      await showError(err, 'Could not delete.');
    }
  };

  return (
    <PermissionGate required="masters.read">
      <PageTitle>{title}</PageTitle>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] gap-6 items-start">
        {canWrite && (
          <form onSubmit={save} className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 bg-[#FAF7F2] border-b border-[#E8DFD8]">
              <h2 className="text-sm font-bold text-[#180200]">{editing ? `Edit ${title}` : `Add ${title}`}</h2>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs sm:text-sm text-[#3D140C] mb-1 font-semibold">
                  {label}: <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  maxLength={100}
                  placeholder={placeholder}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError('');
                  }}
                  className="w-full px-3 py-2 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border border-[#E8DFD8] rounded-lg text-xs sm:text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs transition-all"
                />
              </div>
              {error && <p className="text-[11px] text-red-600 font-medium">{error}</p>}
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 bg-[#510601] hover:bg-[#8C1801] disabled:opacity-60 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm transition-colors cursor-pointer"
                >
                  {saving ? 'Saving…' : editing ? 'Update' : 'Save'}
                </button>
                {editing && (
                  <button
                    type="button"
                    onClick={reset}
                    className="flex-1 px-4 py-2.5 bg-white border border-[#E8DFD8] text-[#510601] hover:bg-[#FAF7F2] text-xs sm:text-sm font-semibold rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </form>
        )}

        <div className="space-y-3">
          {!canWrite && error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
          <div className="relative">
            <Search className="w-4 h-4 text-[#9E8B7F] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${title.toLowerCase()}`}
              className="w-full pl-9 pr-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs sm:text-sm text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20"
            />
          </div>
          <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#FAF7F2] border-b border-[#E8DFD8] text-[#863221] font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">{title}</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]">
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="py-10 text-center text-[#863221]/70">
                      {loading ? 'Loading…' : 'Nothing here yet.'}
                    </td>
                  </tr>
                ) : (
                  visible.map((row) => (
                    <tr key={row.id} className={`hover:bg-[#FAF7F2]/40 ${editing?.id === row.id ? 'bg-[#FAF7F2]' : ''}`}>
                      <td className="py-3 px-4 text-[#180200] break-words [overflow-wrap:anywhere]">{row.name_en || '—'}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {canWrite && (
                            <button type="button" onClick={() => startEdit(row)} className="btn-act" title="Edit">
                              <Pencil className="w-3.5 h-3.5" />
                              <span>Edit</span>
                            </button>
                          )}
                          {hasPermission('masters.delete') && (
                            <button type="button" onClick={() => remove(row)} className="btn-act btn-act-danger" title="Delete">
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete</span>
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
      </div>
    </PermissionGate>
  );
}

export const GotraMaster = () => <SimpleMaster title="Gotra" endpoint="/masters/gotras" />;
export const QualificationMaster = () => <SimpleMaster title="Qualification" endpoint="/masters/qualifications" />;
export const NameTitleMaster = () => <SimpleMaster title="Name Title" endpoint="/masters/name-titles" label="Title" placeholder="for example SRI." />;

// The Personal Masters page: the parent of the three screens above in the sidebar, with a link to each.
export const PersonalMastersHub = () => (
  <PermissionGate required="masters.read">
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {[
        ['Gotra', '/dashboard/master/gotra', 'The gotras a member can belong to'],
        ['Name Title', '/dashboard/master/name-title', 'SRI., SMT., DR. and the other titles before a name'],
        ['Qualification', '/dashboard/master/qualification', 'The qualifications a member can have']
      ].map(([name, to, note]) => (
        <Link key={to} to={to} className="block bg-white border border-[#E8DFD8] rounded-2xl shadow-sm p-5 hover:border-[#510601] transition-colors">
          <h3 className="text-sm font-bold text-[#180200]">{name}</h3>
          <p className="text-xs text-[#863221] mt-1">{note}</p>
        </Link>
      ))}
    </div>
  </PermissionGate>
);
