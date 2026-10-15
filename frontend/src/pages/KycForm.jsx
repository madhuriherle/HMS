import React, { useEffect, useState } from 'react';
import { ShieldCheck, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import api from '../api';
import { apiErrorMessage } from '../utils/apiError';
import { memberName } from '../utils/memberName';

// ── Member KYC update — public, token-authenticated (no sign-in) ──────────────
// The admin sends a KYC request from the member profile; the member opens the
// WhatsApp link (…/kyc?token=…), sees their current basic details, edits them
// and submits. The submission becomes a profile-change request that the admin
// still approves on the Approvals screen — nothing changes before that.

const FIELDS = [
  { key: 'mobile', label: 'Mobile Number', kannada: 'ಮೊಬೈಲ್ ದೂರವಾಣಿ ಸಂಖ್ಯೆ', phone: true },
  { key: 'alternate_mobile', label: 'Alternate Mobile', kannada: 'ಪರ್ಯಾಯ ಮೊಬೈಲ್', phone: true },
  { key: 'whatsapp_number', label: 'WhatsApp Number', kannada: 'ವಾಟ್ಸಾಪ್ ಸಂಖ್ಯೆ', phone: true },
  { key: 'email', label: 'Email ID', kannada: 'ಇಮೇಲ್', email: true },
  { key: 'date_of_birth', label: 'Date of Birth', kannada: 'ಜನ್ಮ ದಿನಾಂಕ', date: true },
  { key: 'address_line1', label: 'Address Line 1', kannada: 'ವಿಳಾಸ - 1', full: true },
  { key: 'address_line2', label: 'Address Line 2', kannada: 'ವಿಳಾಸ - 2', full: true },
  { key: 'locality', label: 'Locality', kannada: 'ಸ್ಥಳ', full: true },
  { key: 'area', label: 'Area', kannada: 'ಪ್ರದೇಶ' },
  { key: 'place', label: 'Place', kannada: 'ಊರು' },
  { key: 'grama', label: 'Grama', kannada: 'ಗ್ರಾಮ' },
  { key: 'village', label: 'Village', kannada: 'ಹಳ್ಳಿ' },
];

const todayISO = () => new Date().toISOString().slice(0, 10);

function approve(value, field) {
  if (!value) return true; // clearing a field is allowed
  if (field.phone) {
    const digits = String(value).replace(/\D/g, '');
    if (!digits || digits.length < 7 || digits.length > 15) return false;
  }
  if (field.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) return false;
  return true;
}

export default function KycForm() {
  const token = new URLSearchParams(window.location.search).get('token') || '';

  const [state, setState] = useState({ loading: true, error: '', member: null });
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setState({ loading: false, error: 'This link is missing its KYC token. Please use the link sent to you.', member: null });
      return undefined;
    }
    api
      .get(`/kyc/${token}`)
      .then(({ data }) => {
        setState({ loading: false, error: '', member: data.member });
        setValues(Object.fromEntries(Object.entries(data.member).filter(([, v]) => v != null)));
      })
      .catch((error) => {
        const status = error.response?.status;
        const fallback = status === 410 ? 'This KYC link has expired.'
          : status === 400 ? 'This KYC link has already been used.'
          : status === 404 ? 'This KYC link is not valid.'
          : 'This form could not be opened.';
        setState({ loading: false, error: apiErrorMessage(error, fallback), member: null });
      });
    return undefined;
  }, [token]);

  const set = (key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: false, __form: false }));
  };

  const submit = (e) => {
    e.preventDefault();
    const changed = Object.fromEntries(
      Object.entries(values).filter(([k, v]) => v !== state.member[k] && v !== '')
    );
    if (Object.keys(changed).length === 0) {
      setErrors({ __form: true });
      return;
    }
    const bad = Object.keys(changed).filter((k) => !approve(changed[k], FIELDS.find((f) => f.key === k) || {}));
    if (bad.length) {
      setErrors({ ...Object.fromEntries(bad.map((k) => [k, true])), __form: false });
      return;
    }
    setSubmitting(true);
    api
      .post(`/kyc/${token}`, { values: changed })
      .then(({ data }) => {
        setSubmitting(false);
        setDone(data.message || 'Details submitted and queued for admin approval');
      })
      .catch((error) => {
        setSubmitting(false);
        if (error.response?.status === 422) {
          setErrors({ __form: true });
          setState((s) => ({ ...s, formMessage: error.response?.data?.detail || 'Some fields were not accepted. Please check and try again.' }));
        } else {
          setState((s) => ({ ...s, error: apiErrorMessage(error, 'The details could not be submitted.') }));
        }
      });
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2] font-sans flex items-start sm:items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl border border-[#E8DFD8] shadow-sm mt-6 sm:mt-0">
        <div className="h-14 shrink-0 flex items-center gap-2 px-6 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
          <ShieldCheck className="w-5 h-5 text-[#510601]" />
          <div>
            <h1 className="text-base font-bold text-[#180200] leading-tight">Update Your Details</h1>
            <p className="text-[11px] text-[#863221]">ನಿಮ್ಮ ಮಾಹಿತಿಯನ್ನು ಹೊಸದಾಗಿ ನಮೂದಿಸಿ</p>
          </div>
        </div>

        {state.loading && (
          <div className="p-10 flex items-center justify-center gap-2 text-sm text-[#863221]">
            <Loader2 className="w-4 h-4 animate-spin" /> Opening your KYC form…
          </div>
        )}

        {!state.loading && state.error && (
          <div className="p-10 flex flex-col items-center gap-3 text-center">
            <AlertCircle className="w-10 h-10 text-[#ED4636]" />
            <p className="text-sm font-semibold text-[#180200]">{state.error}</p>
            <p className="text-xs text-[#863221]">If you need a fresh link, please ask the Mahasabha office to send one again.</p>
          </div>
        )}

        {!state.loading && done && (
          <div className="p-10 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="w-10 h-10 text-[#510601]" />
            <p className="text-sm font-semibold text-[#180200]">Thank you! Your details were received.</p>
            <p className="text-xs text-[#863221]">{done}. Once the admin approves, they appear on your profile. This link is now closed — ಧನ್ಯವಾದಗಳು.</p>
          </div>
        )}

        {!state.loading && !done && !state.error && state.member && (
          <form onSubmit={submit} className="p-6 space-y-4">
            <div className="rounded-xl bg-[#FAF7F2] border border-[#E8DFD8] p-3">
              <span className="block text-xs text-[#863221]">Updating details for</span>
              <span className="block text-sm font-bold text-[#180200]">
                {memberName(state.member)}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {FIELDS.map((f) => (
                <label key={f.key} className={f.full ? 'sm:col-span-2' : ''}>
                  <span className="block text-[11px] font-semibold text-[#180200]">
                    {f.label} <span className="font-normal text-[#863221]">· {f.kannada}</span>
                  </span>
                  <input
                    type={f.date ? 'date' : 'text'}
                    max={f.date ? todayISO() : undefined}
                    inputMode={f.phone ? 'numeric' : undefined}
                    value={values[f.key] || ''}
                    onChange={(e) => f.phone
                      ? set(f.key, e.target.value.replace(/\D/g, '').slice(0, 15))
                      : set(f.key, e.target.value)}
                    className={`mt-1 w-full px-3 py-2 rounded-xl text-sm border bg-white outline-none transition-colors ${errors[f.key] ? 'border-[#ED4636]' : 'border-[#E8DFD8] focus:border-[#510601]'}`}
                  />
                  {errors[f.key] && <span className="block mt-1 text-[11px] text-[#ED4636]">Please check this entry.</span>}
                </label>
              ))}
            </div>

            {errors.__form && (
              <p className="text-xs font-semibold text-[#ED4636]">
                {state.formMessage || 'Change at least one field before submitting, and check the highlighted entries.'}
              </p>
            )}

            <p className="text-xs text-[#863221]">
              ನೀವು ಸಲ್ಲಿಸುವ ಮಾಹಿತಿ ನೇರವಾಗಿ ಬದಲಾಗುವುದಿಲ್ಲ — Mahasabha ಅಧಿಕಾರಿ ಅಂಗೀಕರಿಸಿದ ನಂತರ ಖಾಯವಾಗಿ ಬದಲಾಗುತ್ತದೆ.<br />
              Nothing changes immediately: the office admin approves your submission first.
            </p>

            <button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto px-6 py-2.5 text-xs font-bold rounded-xl bg-[#510601] hover:bg-[#863221] disabled:opacity-60 text-white transition-colors"
            >
              {submitting ? 'Submitting…' : 'Submit for Approval'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
