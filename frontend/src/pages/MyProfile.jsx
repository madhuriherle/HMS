import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import api from '../api';
import CountryCodeSelect from '../components/CountryCodeSelect';
import { askReason } from '../utils/dialogs';
import { notify } from '../utils/notify';
import { apiErrorMessage } from '../utils/apiError';
import { formatDate, formatDateTime } from '../utils/dateUtils';

const labelCls = 'block text-xs font-bold text-[#180200] mb-1.5';
const inputCls =
  'w-full px-3.5 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm text-[#180200] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] disabled:bg-[#FAF7F2] disabled:text-[#863221]';
const buttonCls =
  'h-10 min-w-[110px] px-5 inline-flex items-center justify-center rounded-xl text-sm font-semibold text-white bg-[#510601] hover:bg-[#8C1801] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed transition-colors';

// everything below the people in the menu: groups, then the pages inside them
const accessNames = (nodes) =>
  (nodes || []).map((n) => ({
    name: n.name,
    pages: (n.submodules || []).flatMap(function flat(c) {
      return c.submodules?.length ? c.submodules.flatMap(flat) : [c.name];
    }),
  }));

const endSession = (navigate) => {
  try {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('hms_auth_token');
    localStorage.removeItem('hms_user_profile');
  } catch (_) { /* storage can be blocked */ }
  navigate('/');
};

// defined outside the page so typing does not remount the inputs
const Field = ({ id, label, error, children }) => (
  <div>
    <label htmlFor={id} className={labelCls}>{label}</label>
    {children}
    {error && <p className="mt-1 text-xs font-medium text-[#ED4636]">{error}</p>}
  </div>
);

export default function MyProfile() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [menu, setMenu] = useState([]);
  const [form, setForm] = useState({ name: '', username: '', email: '', mobile: '', mobile_country_code: '+91' });
  const [countryIso, setCountryIso] = useState('IN');
  const [errors, setErrors] = useState({});
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [{ data: u }, { data: m }] = await Promise.all([api.get('/auth/me'), api.get('/users/modules/menu')]);
        setMe(u);
        setMenu(accessNames(m));
        setForm({
          name: u.name || '', username: u.username || '', email: u.email || '',
          mobile: u.mobile || '', mobile_country_code: u.mobile_country_code || '+91',
        });
      } catch (e) {
        setLoadError(apiErrorMessage(e, 'Could not load your profile.'));
      }
    })();
  }, []);

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  const dirty = me && ['name', 'username', 'email', 'mobile', 'mobile_country_code'].some((k) => (form[k] || '') !== (me[k] || ''));

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Full name is required.';
    if (!form.username.trim()) e.username = 'Username is required.';
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) e.email = 'Enter a valid email address.';
    if (form.mobile && !/^\d{6,15}$/.test(form.mobile)) e.mobile = 'Enter digits only (6 to 15).';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    const reason = await askReason({
      title: 'Update your profile?',
      text: 'You will be signed out and asked to log in again. Why are you changing it?',
      confirmText: 'Update',
    });
    if (!reason) return;
    setSaving(true);
    try {
      await api.put('/auth/me', {
        name: form.name.trim(), username: form.username.trim(), email: form.email.trim() || null,
        mobile: form.mobile || null, mobile_country_code: form.mobile_country_code,
      }, { params: { reason } });
      notify('Profile updated. Please log in again.');
      endSession(navigate);
    } catch (e) {
      if (!e?.isCancelled) notify(apiErrorMessage(e, 'Could not update your profile.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (ev) => {
    ev.preventDefault();
    const e = {};
    if (!pw.current) e.current = 'Enter your current password.';
    if (!pw.next) e.next = 'Enter a new password.';
    if (pw.next && pw.next === pw.current) e.next = 'The new password must be different.';
    if (pw.next !== pw.confirm) e.confirm = 'The passwords do not match.';
    setErrors((prev) => ({ ...prev, pw: e }));
    if (Object.keys(e).length) return;
    const reason = await askReason({
      title: 'Change your password?',
      text: 'You will be signed out and asked to log in again. Why are you changing it?',
      confirmText: 'Update',
    });
    if (!reason) return;
    setPwSaving(true);
    try {
      await api.post('/auth/change-password', { current_password: pw.current, new_password: pw.next }, { params: { reason } });
      notify('Password changed. Please log in again.');
      endSession(navigate);
    } catch (err) {
      if (!err?.isCancelled) notify(apiErrorMessage(err, 'Could not change the password.'), 'error');
    } finally {
      setPwSaving(false);
    }
  };

  if (loadError) return <p className="text-sm font-semibold text-red-700">{loadError}</p>;
  if (!me) return <p className="text-sm text-[#863221]">Loading...</p>;

  const pwErr = errors.pw || {};
  return (
    <div className="space-y-5">
      <h1 className="text-xl sm:text-2xl font-bold text-[#180200] tracking-tight">My Profile</h1>

      <div className="bg-white rounded-2xl border border-[#E8DFD8] p-5 flex flex-wrap items-center gap-4">
        <div className="h-14 w-14 rounded-full bg-[#510601] text-white flex items-center justify-center text-xl font-bold">
          {(me.name || me.username || '?').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-lg font-bold text-[#180200] truncate">{me.name}</p>
          <p className="text-sm text-[#863221]">
            {me.role_name || 'No role'}{me.role_rank_level != null ? ` · Rank ${me.role_rank_level}` : ''} · {me.status ? 'Active' : 'Inactive'}
          </p>
        </div>
        <div className="ml-auto text-xs text-[#863221] text-right space-y-0.5">
          <p>Last login: <span className="font-semibold text-[#180200]">{formatDateTime(me.last_login_at, 'Never', false)}</span></p>
          <p>Member since: <span className="font-semibold text-[#180200]">{me.created_at ? formatDate(me.created_at) : '—'}</span></p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
      <div className="xl:col-span-2 space-y-5">
      <form onSubmit={save} className="bg-white rounded-2xl border border-[#E8DFD8] overflow-hidden">
        <div className="px-6 h-14 flex items-center border-b border-[#E8DFD8] bg-[#FAF7F2]">
          <h2 className="text-base font-bold text-[#180200]">Profile Information</h2>
        </div>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field id="p-name" label="Full Name *" error={errors.name}>
            <input id="p-name" className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field id="p-username" label="Username *" error={errors.username}>
            <input id="p-username" className={inputCls} value={form.username} onChange={(e) => set('username', e.target.value)} />
          </Field>
          <Field id="p-email" label="Email Address" error={errors.email}>
            <input id="p-email" type="email" className={inputCls} value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field id="p-mobile" label="Mobile Number" error={errors.mobile}>
            <div className="flex gap-2">
              <CountryCodeSelect
                value={form.mobile_country_code}
                countryIso={countryIso}
                onChange={({ dialCode, countryIso: iso }) => { set('mobile_country_code', dialCode); setCountryIso(iso); }}
              />
              <input
                id="p-mobile" type="tel" inputMode="numeric" className={inputCls} value={form.mobile}
                onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 15))}
              />
            </div>
          </Field>
          <Field id="p-role" label="Role">
            <input id="p-role" className={inputCls} value={me.role_name || ''} disabled />
          </Field>
          <Field id="p-status" label="Status">
            <input id="p-status" className={inputCls} value={me.status ? 'Active' : 'Inactive'} disabled />
          </Field>
        </div>
        <div className="px-6 h-14 flex items-center justify-end border-t border-[#E8DFD8] bg-[#FAF7F2]">
          <button type="submit" disabled={!dirty || saving} className={buttonCls}>{saving ? 'Updating...' : 'Update'}</button>
        </div>
      </form>

      <div className="bg-white rounded-2xl border border-[#E8DFD8] overflow-hidden">
        <button
          type="button"
          onClick={() => setPwOpen((o) => !o)}
          aria-expanded={pwOpen}
          className="w-full px-6 h-14 flex items-center justify-between bg-[#FAF7F2] text-left cursor-pointer"
        >
          <h2 className="text-base font-bold text-[#180200]">Change Password</h2>
          {pwOpen ? <ChevronDown className="w-4 h-4 text-[#863221]" /> : <ChevronRight className="w-4 h-4 text-[#863221]" />}
        </button>
        {pwOpen && (
          <form onSubmit={changePassword}>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-5 border-t border-[#E8DFD8]">
              <Field id="pw-current" label="Current Password" error={pwErr.current}>
                <input id="pw-current" type="password" autoComplete="current-password" className={inputCls}
                  value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
              </Field>
              <Field id="pw-next" label="New Password" error={pwErr.next}>
                <input id="pw-next" type="password" autoComplete="new-password" className={inputCls}
                  value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
              </Field>
              <Field id="pw-confirm" label="Confirm New Password" error={pwErr.confirm}>
                <input id="pw-confirm" type="password" autoComplete="new-password" className={inputCls}
                  value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
              </Field>
            </div>
            <div className="px-6 h-14 flex items-center justify-end border-t border-[#E8DFD8] bg-[#FAF7F2]">
              <button type="submit" disabled={pwSaving} className={buttonCls}>{pwSaving ? 'Updating...' : 'Update'}</button>
            </div>
          </form>
        )}
      </div>

      </div>

      <div className="bg-white rounded-2xl border border-[#E8DFD8] overflow-hidden">
        <div className="px-6 h-14 flex items-center border-b border-[#E8DFD8] bg-[#FAF7F2]">
          <h2 className="text-base font-bold text-[#180200]">My Access</h2>
        </div>
        <div className="p-6">
          {me.is_all_access ? (
            <p className="text-sm text-[#180200]">Your role has full access to every module.</p>
          ) : menu.length === 0 ? (
            <p className="text-sm text-[#863221]">Your role has no pages assigned yet.</p>
          ) : (
            <div className="space-y-3">
              {menu.map((g) => (
                <div key={g.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm font-bold text-[#180200] min-w-[130px]">{g.name}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {(g.pages.length ? g.pages : ['Open']).map((p) => (
                      <span key={p} className="px-2.5 py-0.5 rounded-full border border-[#E8DFD8] bg-[#FAF7F2] text-xs text-[#180200]">{p}</span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
