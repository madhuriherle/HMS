import React, { useEffect, useState } from 'react';
import api from '../api';
import Modal from './Modal';
import ModalFooter from './ModalFooter';
import { VERIFICATION } from './VerificationBadge';
import { confirmAction } from '../utils/actionConfirm';
import { formatDateTime } from '../utils/dateUtils';
import { lookupPin, loadLocations } from '../utils/serverData';
import { notify } from '../utils/notify';

// Helpers to extract and reconstruct full name
const nameOf = (m) => m?.full_name_en || [m?.first_name_en, m?.middle_name_en, m?.last_name_en].filter(Boolean).join(' ') || '';
const nameParts = (name) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return {
    full_name_en: words.join(' '),
    first_name_en: words[0] || null,
    middle_name_en: words.length > 2 ? words.slice(1, -1).join(' ') : null,
    last_name_en: words.length > 1 ? words[words.length - 1] : null
  };
};

const OUTCOMES = [
  { id: 'VERIFIED', label: 'Verified', activeClass: 'bg-green-700 text-white border-green-700 shadow-xs', inactiveClass: 'bg-green-50 text-green-800 border-green-200 hover:bg-green-100' },
  { id: 'NOT_VERIFIED', label: 'Not verified', activeClass: 'bg-stone-700 text-white border-stone-700 shadow-xs', inactiveClass: 'bg-stone-100 text-stone-700 border-stone-300 hover:bg-stone-200' },
  { id: 'NOT_REACHABLE', label: 'Not reachable', activeClass: 'bg-amber-600 text-white border-amber-600 shadow-xs', inactiveClass: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100' },
  { id: 'WRONG_NUMBER', label: 'Wrong number', activeClass: 'bg-red-700 text-white border-red-700 shadow-xs', inactiveClass: 'bg-red-50 text-red-800 border-red-200 hover:bg-red-100' },
  { id: 'CALL_BACK', label: 'Call back', activeClass: 'bg-blue-700 text-white border-blue-700 shadow-xs', inactiveClass: 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100' }
];

const inputClass = 'w-full px-3 py-1.5 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] font-normal normal-case';
const headingClass = 'text-[11px] font-bold uppercase tracking-wider text-[#7D7068]';

export default function VerifyMemberModal({ memberId, onClose, onSaved }) {
  const [member, setMember] = useState(null);
  const [locations, setLocations] = useState({ states: [], districts: [], taluks: [] });
  const [form, setForm] = useState({
    name: '',
    mobile: '',
    date_of_birth: '',
    father_husband_name: '',
    state_id: '',
    district_id: '',
    taluk_id: '',
    locality: '',
    pincode: ''
  });
  const [chosenPinId, setChosenPinId] = useState(null);
  const [calls, setCalls] = useState([]);
  const [status, setStatus] = useState('VERIFIED');
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    Promise.all([
      api.get(`/members/${memberId}`),
      api.get(`/members/${memberId}/verification`),
      loadLocations().catch(() => ({ states: [], districts: [], taluks: [] }))
    ])
      .then(([m, v, locs]) => {
        if (!current) return;
        const d = m.data;
        setMember(d);
        setLocations(locs || { states: [], districts: [], taluks: [] });

        setForm({
          name: nameOf(d),
          mobile: d.mobile || '',
          date_of_birth: d.date_of_birth ? d.date_of_birth.slice(0, 10) : '',
          father_husband_name: d.father_husband_name || d.father_name || '',
          state_id: d.state_id ? String(d.state_id) : '',
          district_id: d.district_id ? String(d.district_id) : '',
          taluk_id: d.taluk_id ? String(d.taluk_id) : '',
          locality: d.locality || d.village || d.place || '',
          pincode: d.pincode || ''
        });
        setChosenPinId(d.pincode_id || null);
        setCalls(v.data.calls || []);
        setStatus(v.data.status && v.data.status !== 'NOT_VERIFIED' ? v.data.status : 'VERIFIED');
        setRemark(v.data.remark || '');
      })
      .catch((e) => {
        notify(e.response?.data?.detail || 'Could not load the member.', 'error');
        onClose();
      });
    return () => { current = false; };
  }, [memberId]);

  const onPinChange = async (value) => {
    const clean = value.replace(/\D/g, '').slice(0, 6);
    setForm((prev) => ({ ...prev, pincode: clean }));
    if (clean.length === 6) {
      try {
        const info = await lookupPin(clean);
        if (info.found && info.matches?.length > 0) {
          const match = info.matches.find((x) => x.status === 'Active') || info.matches[0];
          setChosenPinId(match.id);
          setForm((prev) => ({
            ...prev,
            pincode: clean,
            state_id: match.stateId ? String(match.stateId) : prev.state_id,
            district_id: match.districtId ? String(match.districtId) : prev.district_id,
            taluk_id: match.talukId ? String(match.talukId) : prev.taluk_id,
            locality: prev.locality || match.area || ''
          }));
        }
      } catch (err) {
        console.warn('Pincode lookup error:', err);
      }
    } else {
      setChosenPinId(null);
    }
  };

  const onStateChange = (newStId) => {
    setForm((prev) => ({
      ...prev,
      state_id: newStId,
      district_id: '',
      taluk_id: ''
    }));
  };

  const onDistrictChange = (newDtId) => {
    setForm((prev) => ({
      ...prev,
      district_id: newDtId,
      taluk_id: ''
    }));
  };

  const onTalukChange = (newTkId) => {
    setForm((prev) => ({ ...prev, taluk_id: newTkId }));
  };

  // Filtered dropdown lists based on normal membership hierarchy
  const filteredDistricts = locations.districts.filter((d) => !form.state_id || String(d.stateId) === String(form.state_id));
  const filteredTaluks = locations.taluks.filter((t) => !form.district_id || String(t.districtId) === String(form.district_id));

  const save = async () => {
    const changed = {};

    // 1. Name
    const origName = nameOf(member);
    if (form.name.trim() !== origName.trim()) {
      Object.assign(changed, nameParts(form.name));
    }

    // 2. Mobile
    if (form.mobile !== (member.mobile || '')) {
      changed.mobile = form.mobile.trim() || null;
    }

    // 3. Date of birth
    const origDob = member.date_of_birth ? member.date_of_birth.slice(0, 10) : '';
    if (form.date_of_birth !== origDob) {
      changed.date_of_birth = form.date_of_birth || null;
    }

    // 4. Father / Husband
    const origFather = member.father_husband_name || member.father_name || '';
    if (form.father_husband_name.trim() !== origFather.trim()) {
      changed.father_husband_name = form.father_husband_name.trim() || null;
      changed.father_name = form.father_husband_name.trim() || null;
    }

    // 5. Normal Flow Place: State, District, Taluk
    if (form.state_id !== (member.state_id ? String(member.state_id) : '')) {
      changed.state_id = form.state_id ? Number(form.state_id) : null;
    }
    if (form.district_id !== (member.district_id ? String(member.district_id) : '')) {
      changed.district_id = form.district_id ? Number(form.district_id) : null;
    }
    if (form.taluk_id !== (member.taluk_id ? String(member.taluk_id) : '')) {
      changed.taluk_id = form.taluk_id ? Number(form.taluk_id) : null;
    }

    // 6. Locality / Village
    const origLocality = member.locality || member.village || member.place || '';
    if (form.locality.trim() !== origLocality.trim()) {
      changed.locality = form.locality.trim() || null;
    }

    // 7. Pincode
    if (form.pincode && form.pincode.length === 6 && form.pincode !== (member.pincode || '')) {
      if (chosenPinId) changed.pincode_id = chosenPinId;
    }

    const reason = await confirmAction('put', `/members/${memberId}/verification`);
    if (!reason) return;
    const headers = { 'X-Action-Reason': reason };

    setBusy(true);
    try {
      if (Object.keys(changed).length > 0) {
        const { data } = await api.put(`/members/${memberId}`, changed, { headers });
        if (data?.status === 'PENDING') notify('The changed details were sent for approval.', 'success');
      }
      await api.put(`/members/${memberId}/verification`, { status, remark: remark.trim() || null }, { headers });
      notify('KYC saved.', 'success');
      onSaved?.();
      onClose();
    } catch (e) {
      notify(e.response?.data?.detail || 'Could not save.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`KYC call · ${member?.membership_number || member?.member_code || `ID: ${memberId}`}${member?.full_name_en ? ` (${member.full_name_en})` : ''}`}
      onClose={onClose}
      maxWidthClass="max-w-3xl"
      footer={
        <ModalFooter
          kind="add"
          submitLabel="Save KYC"
          onCancel={onClose}
          onSubmit={save}
          busy={busy}
          disabled={!member}
        />
      }
    >
      {!member ? (
        <div className="p-8 text-sm text-center text-[#7D7068]">Loading…</div>
      ) : (
        <div className="p-4 space-y-3.5">
          {/* Top section: Call Result & Remark */}
          <div className="bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl p-3 space-y-2.5">
            <div>
              <span className={headingClass}>Call Outcome *</span>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {OUTCOMES.map((o) => {
                  const isActive = status === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setStatus(o.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                        isActive ? o.activeClass : o.inactiveClass
                      }`}
                    >
                      {isActive ? '✓ ' : ''}{o.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="block">
              <span className={headingClass}>Remark (Optional)</span>
              <input
                type="text"
                value={remark}
                maxLength={1000}
                placeholder="e.g., Confirmed phone & address with member"
                onChange={(e) => setRemark(e.target.value)}
                className={`${inputClass} mt-1`}
              />
            </label>
          </div>

          {/* 2-Column Balanced Layout: Personal Details & Normal Place Flow */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Left Column: Personal Details */}
            <div className="space-y-2.5">
              <div className="text-xs font-bold text-[#510601] border-b border-[#E8DFD8] pb-1">
                Personal Details
              </div>

              <label className="block">
                <span className={headingClass}>Name *</span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={`${inputClass} mt-1 font-semibold`}
                />
              </label>

              <label className="block">
                <span className={headingClass}>Mobile *</span>
                <input
                  type="tel"
                  maxLength={10}
                  value={form.mobile}
                  onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                  className={`${inputClass} mt-1 font-mono`}
                />
              </label>

              <label className="block">
                <span className={headingClass}>Date of birth</span>
                <input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
                  className={`${inputClass} mt-1`}
                />
              </label>

              <label className="block">
                <span className={headingClass}>Father / Husband</span>
                <input
                  type="text"
                  value={form.father_husband_name}
                  onChange={(e) => setForm({ ...form, father_husband_name: e.target.value })}
                  className={`${inputClass} mt-1`}
                />
              </label>
            </div>

            {/* Right Column: Place (Normal Membership Flow) */}
            <div className="space-y-2.5">
              <div className="text-xs font-bold text-[#510601] border-b border-[#E8DFD8] pb-1">
                Place (Normal Membership Flow)
              </div>

              <label className="block">
                <span className={headingClass}>State</span>
                <select
                  value={form.state_id}
                  onChange={(e) => onStateChange(e.target.value)}
                  className={`${inputClass} mt-1`}
                >
                  <option value="">Select State</option>
                  {locations.states.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={headingClass}>District</span>
                <select
                  value={form.district_id}
                  onChange={(e) => onDistrictChange(e.target.value)}
                  disabled={!form.state_id}
                  className={`${inputClass} mt-1 disabled:opacity-50`}
                >
                  <option value="">Select District</option>
                  {filteredDistricts.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={headingClass}>Taluk</span>
                <select
                  value={form.taluk_id}
                  onChange={(e) => onTalukChange(e.target.value)}
                  disabled={!form.district_id}
                  className={`${inputClass} mt-1 disabled:opacity-50`}
                >
                  <option value="">Select Taluk</option>
                  {filteredTaluks.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2">
                <label className="block">
                  <span className={headingClass}>Pincode</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6 digits"
                    value={form.pincode}
                    onChange={(e) => onPinChange(e.target.value)}
                    className={`${inputClass} mt-1 font-mono`}
                  />
                </label>
                <label className="block">
                  <span className={headingClass}>Village / Area</span>
                  <input
                    type="text"
                    placeholder="Village or locality"
                    value={form.locality}
                    onChange={(e) => setForm({ ...form, locality: e.target.value })}
                    className={`${inputClass} mt-1`}
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Earlier KYC Call history (compact) */}
          {calls.length > 0 && (
            <div className="text-[11px] text-[#7D7068] bg-[#FAF7F2] px-3 py-1.5 rounded-lg border border-[#E8DFD8] flex items-center justify-between">
              <span className="truncate">
                <b>Earlier KYC:</b> {VERIFICATION[calls[0].status]?.label || calls[0].status} · {formatDateTime(calls[0].called_at, '', false)} · {calls[0].called_by}
                {calls[0].remark ? ` ("${calls[0].remark}")` : ''}
              </span>
              {calls.length > 1 && (
                <span className="text-[10px] text-[#7D7068] shrink-0 ml-2">+{calls.length - 1} earlier</span>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
