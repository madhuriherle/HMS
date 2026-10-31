import React, { useEffect, useRef, useState } from 'react';
import api from '../api';
import Modal from './Modal';
import ModalFooter from './ModalFooter';
import { VERIFICATION } from './VerificationBadge';
import { confirmAction } from '../utils/actionConfirm';
import { formatDateTime } from '../utils/dateUtils';
import { lookupPin, loadLocations, searchPostalCodes } from '../utils/serverData';
import { notify } from '../utils/notify';
import useRules from '../hooks/useRules';
import DateInput from './DateInput';

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
const cardClass = 'bg-white border border-[#E8DFD8] rounded-xl p-3.5 space-y-2.5';
const cardTitle = 'text-xs font-bold text-[#510601] uppercase tracking-wider pb-1.5 border-b border-[#EFE6DE]';

// `focus`: the box to start at (the problem the list found): name, mobile, alternate_mobile, email, date_of_birth, address or place
export default function VerifyMemberModal({ memberId, onClose, onSaved, focus = null }) {
  const rules = useRules();
  const boxes = useRef({});
  const mark = (key) => (focus === key || (key === 'place' && ['state', 'district', 'taluk', 'pin'].includes(focus)) ? 'ring-2 ring-[#510601]/30 border-[#510601]' : '');
  const [member, setMember] = useState(null);
  const [locations, setLocations] = useState({ states: [], districts: [], taluks: [] });
  const [form, setForm] = useState({
    name: '',
    gender: '',
    mobile: '',
    whatsapp_number: '',
    alternate_mobile: '',
    email: '',
    address_line1: '',
    address_line2: '',
    magazine: 'NONE',          // NONE | EMAIL (read online) | PHYSICAL (posted)
    date_of_birth: '',
    father_husband_name: '',
    guardian_name: '',
    state_id: '',
    district_id: '',
    taluk_id: '',
    locality: '',
    pincode: ''
  });
  const [chosenPinId, setChosenPinId] = useState(null);
  const [pinOptions, setPinOptions] = useState([]);   // the pincodes and post offices under the chosen taluk
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
          gender: (d.gender || '').toUpperCase(),
          mobile: d.mobile || '',
          whatsapp_number: d.whatsapp_number || '',
          alternate_mobile: d.alternate_mobile || '',
          email: d.email || '',
          address_line1: d.address_line1 || '',
          address_line2: d.address_line2 || '',
          magazine: !d.magazine_needed ? 'NONE' : d.magazine_kind === 'EMAIL' ? 'EMAIL' : 'PHYSICAL',
          date_of_birth: d.date_of_birth ? d.date_of_birth.slice(0, 10) : '',
          father_husband_name: d.father_husband_name || d.father_name || '',
          guardian_name: d.guardian_name || '',
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
        // start at the box the list is about
        setTimeout(() => {
          const key = focus === 'place' ? (!d.state_id ? 'state' : !d.district_id ? 'district' : !d.taluk_id ? 'taluk' : 'pin') : focus;
          boxes.current[key]?.focus?.();
        }, 60);
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

  // a new state, district or taluk: the pincode no longer belongs to it, so it is cleared and picked again from the taluk's list
  const clearPin = () => { setChosenPinId(null); };
  const onStateChange = (newStId) => {
    clearPin();
    setForm((prev) => ({
      ...prev,
      state_id: newStId,
      district_id: '',
      taluk_id: '',
      pincode: ''
    }));
  };

  const onDistrictChange = (newDtId) => {
    clearPin();
    setForm((prev) => ({
      ...prev,
      district_id: newDtId,
      taluk_id: '',
      pincode: ''
    }));
  };

  const onTalukChange = (newTkId) => {
    clearPin();
    setForm((prev) => ({ ...prev, taluk_id: newTkId, pincode: '' }));
  };

  // the pincodes and post offices under the chosen taluk
  useEffect(() => {
    if (!form.taluk_id) { setPinOptions([]); return undefined; }
    let current = true;
    searchPostalCodes({ taluk_id: Number(form.taluk_id) }, 200)
      .then((rows) => { if (current) setPinOptions(rows); })
      .catch(() => { if (current) setPinOptions([]); });
    return () => { current = false; };
  }, [form.taluk_id]);

  const onPickPostOffice = (id) => {
    const row = pinOptions.find((p) => String(p.id) === String(id));
    if (!row) { clearPin(); setForm((prev) => ({ ...prev, pincode: '' })); return; }
    setChosenPinId(row.id);
    setForm((prev) => ({ ...prev, pincode: row.postalCode, locality: row.area || prev.locality }));
  };

  // Filtered dropdown lists based on normal membership hierarchy
  const filteredDistricts = locations.districts.filter((d) => !form.state_id || String(d.stateId) === String(form.state_id));
  // an inactive taluk is not offered (the one the member already has stays)
  const filteredTaluks = locations.taluks.filter((t) => (!form.district_id || String(t.districtId) === String(form.district_id)) && (t.status === 'Active' || String(t.id) === String(form.taluk_id)));

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

    // 2b. Alternate number (a second mobile, or a landline with its STD code), email and address
    if (form.alternate_mobile.trim() !== (member.alternate_mobile || '').trim()) {
      changed.alternate_mobile = form.alternate_mobile.trim() || null;
    }
    if (form.email.trim() !== (member.email || '').trim()) {
      const mail = form.email.trim();
      if (mail && !/^[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}$/.test(mail)) {
        notify('The email address is not valid (one address, like name@example.com).', 'error');
        return;
      }
      changed.email = mail || null;
    }
    if (form.address_line1.trim() !== (member.address_line1 || '').trim()) {
      changed.address_line1 = form.address_line1.trim() || null;
    }
    if (form.address_line2.trim() !== (member.address_line2 || '').trim()) {
      changed.address_line2 = form.address_line2.trim() || null;
    }
    if (form.whatsapp_number.trim() !== (member.whatsapp_number || '').trim()) {
      changed.whatsapp_number = form.whatsapp_number.trim() || null;
    }
    if (form.gender !== (member.gender || '').toUpperCase()) {
      changed.gender = form.gender || null;
    }
    // how the magazine reaches them: the server tidies the rest (an e-copy keeps no postal address, a printed one needs it)
    const wasMagazine = !member.magazine_needed ? 'NONE' : member.magazine_kind === 'EMAIL' ? 'EMAIL' : 'PHYSICAL';
    if (form.magazine !== wasMagazine) {
      changed.magazine_needed = form.magazine !== 'NONE';
      if (form.magazine !== 'NONE') changed.magazine_kind = form.magazine;
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

    // 4b. Guardian
    if (form.guardian_name.trim() !== (member.guardian_name || '').trim()) {
      changed.guardian_name = form.guardian_name.trim() || null;
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

    // a new taluk needs the pincode / post office picked again, or the old pincode would stay with the wrong taluk
    if (changed.taluk_id && pinOptions.length > 0 && !chosenPinId) {
      notify('Pick the pincode / post office of the new taluk.', 'error');
      return;
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
      title={`KYC call${member?.membership_number || member?.member_code ? ` · ${member.membership_number || member.member_code}` : ''}${member?.full_name_en ? ` (${member.full_name_en})` : ''}`}
      onClose={onClose}
      maxWidthClass="max-w-5xl"
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
          {/* The call: its outcome and a remark, on one band */}
          <div className="bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl p-3 grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 items-end">
            <div>
              <span className={headingClass}>Call outcome *</span>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {OUTCOMES.map((o) => {
                  const isActive = status === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setStatus(o.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${isActive ? o.activeClass : o.inactiveClass}`}
                    >
                      {isActive ? '✓ ' : ''}{o.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="block min-w-0">
              <span className={headingClass}>Remark (optional)</span>
              <input
                type="text"
                value={remark}
                maxLength={1000}
                placeholder="e.g., Confirmed phone and address with the member"
                onChange={(e) => setRemark(e.target.value)}
                className={`${inputClass} mt-1`}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 items-start">
            {/* 1. Who they are */}
            <section className={cardClass}>
              <h3 className={cardTitle}>Identity</h3>
              <label className="block">
                <span className={headingClass}>Name *</span>
                <input
                  ref={(el) => { boxes.current.name = el; }}
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={`${inputClass} mt-1 font-semibold ${mark('name')}`}
                />
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                <label className="block">
                  <span className={headingClass}>Gender</span>
                  <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} className={`${inputClass} mt-1`}>
                    <option value="">Select</option>
                    {(rules?.genders || ['MALE', 'FEMALE', 'OTHER']).map((g) => (
                      <option key={g} value={g}>{g.charAt(0) + g.slice(1).toLowerCase()}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={headingClass}>Date of birth</span>
                  <div className="mt-1">
                    <DateInput
                      value={form.date_of_birth}
                      onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
                      autoFocus={focus === 'date_of_birth'}
                      placeholder="DD-MM-YYYY"
                      className={`${inputClass} font-mono ${mark('date_of_birth')}`}
                    />
                  </div>
                </label>
              </div>
              <label className="block">
                <span className={headingClass}>Father / Husband</span>
                <input
                  type="text"
                  value={form.father_husband_name}
                  onChange={(e) => setForm({ ...form, father_husband_name: e.target.value })}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="block">
                <span className={headingClass}>Guardian</span>
                <input
                  type="text"
                  value={form.guardian_name}
                  onChange={(e) => setForm({ ...form, guardian_name: e.target.value })}
                  className={`${inputClass} mt-1`}
                />
              </label>
            </section>

            {/* 2. How to reach them, and how the magazine reaches them */}
            <section className={cardClass}>
              <h3 className={cardTitle}>Contact</h3>
              <div className="grid grid-cols-2 gap-2.5">
                <label className="block">
                  <span className={headingClass}>Mobile *</span>
                  <input
                    ref={(el) => { boxes.current.mobile = el; }}
                    type="tel"
                    maxLength={10}
                    value={form.mobile}
                    onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                    className={`${inputClass} mt-1 font-mono ${mark('mobile')}`}
                  />
                </label>
                <label className="block">
                  <span className={headingClass}>WhatsApp</span>
                  <input
                    type="tel"
                    maxLength={12}
                    value={form.whatsapp_number}
                    onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value.replace(/\D/g, '').slice(0, 12) })}
                    className={`${inputClass} mt-1 font-mono`}
                  />
                </label>
              </div>
              <label className="block">
                <span className={headingClass}>Alternate number</span>
                <input
                  ref={(el) => { boxes.current.alternate_mobile = el; }}
                  type="tel"
                  maxLength={20}
                  value={form.alternate_mobile}
                  placeholder="Mobile, or a landline with its STD code"
                  onChange={(e) => setForm({ ...form, alternate_mobile: e.target.value.replace(/[^0-9 -]/g, '') })}
                  className={`${inputClass} mt-1 font-mono ${mark('alternate_mobile')}`}
                />
              </label>
              <label className="block">
                <span className={headingClass}>Email</span>
                <input
                  ref={(el) => { boxes.current.email = el; }}
                  type="text"
                  maxLength={191}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className={`${inputClass} mt-1 ${mark('email')}`}
                />
              </label>
              <label className="block">
                <span className={headingClass}>Magazine</span>
                <select value={form.magazine} onChange={(e) => setForm({ ...form, magazine: e.target.value })} className={`${inputClass} mt-1`}>
                  <option value="NONE">Not needed</option>
                  <option value="EMAIL">E-Magazine</option>
                  <option value="PHYSICAL">Physical Copy</option>
                </select>
                {form.magazine === 'PHYSICAL' && !form.address_line1.trim() && !member.magazine_delivery_address && (
                  <span className="block mt-1 text-[11px] text-amber-700">A Physical Copy needs an address: add it under Address.</span>
                )}
              </label>
            </section>

            {/* 3. Where they live */}
            <section className={`${cardClass} md:col-span-2 lg:col-span-1`}>
              <h3 className={cardTitle}>Address</h3>
              <label className="block">
                <span className={headingClass}>Address line 1</span>
                <input
                  ref={(el) => { boxes.current.address = el; }}
                  type="text"
                  maxLength={255}
                  value={form.address_line1}
                  placeholder="House / street"
                  onChange={(e) => setForm({ ...form, address_line1: e.target.value })}
                  className={`${inputClass} mt-1 ${mark('address')}`}
                />
              </label>
              <label className="block">
                <span className={headingClass}>Address line 2</span>
                <input
                  type="text"
                  maxLength={255}
                  value={form.address_line2}
                  placeholder="Area / village"
                  onChange={(e) => setForm({ ...form, address_line2: e.target.value })}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                <label className="block">
                  <span className={headingClass}>State</span>
                  <select
                    ref={(el) => { boxes.current.state = el; }}
                    value={form.state_id}
                    onChange={(e) => onStateChange(e.target.value)}
                    className={`${inputClass} mt-1 ${mark('place')}`}
                  >
                    <option value="">Select State</option>
                    {locations.states.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                  </select>
                </label>
                <label className="block">
                  <span className={headingClass}>District</span>
                  <select
                    ref={(el) => { boxes.current.district = el; }}
                    value={form.district_id}
                    onChange={(e) => onDistrictChange(e.target.value)}
                    disabled={!form.state_id}
                    className={`${inputClass} mt-1 disabled:opacity-50 ${mark('place')}`}
                  >
                    <option value="">Select District</option>
                    {filteredDistricts.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
                  </select>
                </label>
                <label className="block">
                  <span className={headingClass}>Taluk</span>
                  <select
                    ref={(el) => { boxes.current.taluk = el; }}
                    value={form.taluk_id}
                    onChange={(e) => onTalukChange(e.target.value)}
                    disabled={!form.district_id}
                    className={`${inputClass} mt-1 disabled:opacity-50 ${mark('place')}`}
                  >
                    <option value="">Select Taluk</option>
                    {filteredTaluks.map((tk) => (<option key={tk.id} value={tk.id}>{tk.name}</option>))}
                  </select>
                </label>
                <label className="block">
                  <span className={headingClass}>Locality</span>
                  <input
                    type="text"
                    value={form.locality}
                    onChange={(e) => setForm({ ...form, locality: e.target.value })}
                    className={`${inputClass} mt-1`}
                  />
                </label>
              </div>
              <label className="block">
                <span className={headingClass}>Pincode / Post office</span>
                <select
                  ref={(el) => { boxes.current.pin = el; }}
                  value={chosenPinId ? String(chosenPinId) : ''}
                  onChange={(e) => onPickPostOffice(e.target.value)}
                  disabled={!form.taluk_id}
                  className={`${inputClass} mt-1 disabled:opacity-50 ${mark('place')}`}
                >
                  <option value="">{!form.taluk_id ? 'Select a taluk first' : pinOptions.length ? 'Select pincode / post office' : 'No pincodes for this taluk'}</option>
                  {chosenPinId && form.pincode && !pinOptions.some((po) => po.id === chosenPinId) && (
                    <option value={chosenPinId}>{form.pincode} — {form.locality || 'current'}</option>
                  )}
                  {pinOptions.map((po) => (<option key={po.id} value={po.id}>{po.postalCode} — {po.area}</option>))}
                </select>
              </label>
            </section>
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
