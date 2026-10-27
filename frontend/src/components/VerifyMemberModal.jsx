import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import Modal from './Modal';
import ModalFooter from './ModalFooter';
import { VERIFICATION } from './VerificationBadge';
import { confirmAction } from '../utils/actionConfirm';
import { formatDateTime } from '../utils/dateUtils';
import { lookupPin } from '../utils/serverData';
import { notify } from '../utils/notify';

// The caller rings the member, fixes whatever is wrong, and records how the call went. The details are saved with the
// normal member update; the outcome with the verification call. One reason prompt covers both.
const FIELDS = [
  ['name', 'Name'],
  ['mobile', 'Mobile'],
  ['date_of_birth', 'Date of birth', 'date'],
  ['father_husband_name', 'Father / husband'],
  ['locality', 'Village / area (as typed in the register)']
];
// the name is one box, as on the Register screen: first / middle / last are filled from it the same way
const nameOf = (m) => m.full_name_en || [m.first_name_en, m.middle_name_en, m.last_name_en].filter(Boolean).join(' ');
const nameParts = (name) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return {
    full_name_en: words.join(' '),
    first_name_en: words[0] || null,
    middle_name_en: words.length > 2 ? words.slice(1, -1).join(' ') : null,
    last_name_en: words.length > 1 ? words[words.length - 1] : null
  };
};
const OUTCOMES = ['VERIFIED', 'NOT_REACHABLE', 'WRONG_NUMBER', 'CALL_BACK'];
const input = 'w-full px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-sm text-[#180200] focus:outline-none focus:border-[#510601]';
const heading = 'text-[11px] font-bold uppercase tracking-wider text-[#7D7068]';
const tagTone = { 'Same mobile': 'bg-[#8C1801]/10 text-[#8C1801] border-[#8C1801]/20', 'Same name': 'bg-[#8C1801]/10 text-[#8C1801] border-[#8C1801]/20', 'Similar name': 'bg-[#EE6A00]/10 text-[#B34E00] border-[#EE6A00]/30' };

export default function VerifyMemberModal({ memberId, onClose, onSaved }) {
  const [member, setMember] = useState(null);
  const [form, setForm] = useState({});
  const [pin, setPin] = useState('');
  const [pinInfo, setPinInfo] = useState(null);   // what the pincode master says about the pincode typed
  const [pinChoice, setPinChoice] = useState(null); // the post office row chosen when the pincode has several
  const [calls, setCalls] = useState([]);
  const [others, setOthers] = useState([]);
  const [status, setStatus] = useState('VERIFIED');
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);

  const showPin = async (value, wantedId) => {
    const found = await lookupPin(value);
    setPinInfo(found);
    const pick = found.found ? (found.matches.find((x) => x.id === wantedId) || found.matches.find((x) => x.status === 'Active') || found.matches[0]) : null;
    setPinChoice(pick ? pick.id : null);
  };

  useEffect(() => {
    let current = true;
    Promise.all([api.get(`/members/${memberId}`), api.get(`/members/${memberId}/verification`), api.get(`/members/${memberId}/possible-duplicates`)])
      .then(([m, v, d]) => {
        if (!current) return;
        setMember(m.data);
        setForm(Object.fromEntries(FIELDS.map(([k]) => [k, (k === 'name' ? nameOf(m.data) : m.data[k]) || ''])));
        setCalls(v.data.calls || []);
        setOthers(d.data.items || []);
        setPin(m.data.pincode || '');
        if (m.data.pincode) showPin(m.data.pincode, m.data.pincode_id);
      })
      .catch((e) => { notify(e.response?.data?.detail || 'Could not load the member.', 'error'); onClose(); });
    return () => { current = false; };
  }, [memberId]);

  const onPin = (value) => {
    const clean = value.replace(/\D/g, '').slice(0, 6);
    setPin(clean);
    if (clean.length === 6) showPin(clean, null);
    else { setPinInfo(null); setPinChoice(null); }
  };

  const chosen = pinInfo?.found ? pinInfo.matches.find((x) => x.id === pinChoice) : null;

  const answer = async (other, decision) => {
    const reason = await confirmAction('put', `/members/${memberId}/duplicate-review`);
    if (!reason) return;
    try {
      const { data } = await api.put(`/members/${memberId}/duplicate-review`, { other_id: other.id, decision }, { headers: { 'X-Action-Reason': reason } });
      setOthers((list) => list.map((x) => (x.id === other.id ? { ...x, review: data.decision } : x)));
    } catch (e) {
      notify(e.response?.data?.detail || 'Could not save the answer.', 'error');
    }
  };

  const save = async () => {
    const was = (k) => (k === 'name' ? nameOf(member) : member[k]) || '';
    const changed = Object.fromEntries(FIELDS.map(([k]) => k).filter((k) => k !== 'name' && (form[k] || '') !== was(k)).map((k) => [k, form[k] || null]));
    if (form.name.trim().split(/\s+/).join(' ') !== was('name').trim().split(/\s+/).join(' ')) Object.assign(changed, nameParts(form.name));
    if (pin.length === 6 && (pin !== (member.pincode || '') || (chosen && chosen.id !== member.pincode_id))) {
      if (!chosen) { notify('This pincode is not in the pincode master.', 'error'); return; }
      Object.assign(changed, { pincode_id: chosen.id, state_id: chosen.stateId || null, district_id: chosen.districtId || null, taluk_id: chosen.talukId || null });
    }
    const reason = await confirmAction('put', `/members/${memberId}/verification`);
    if (!reason) return;
    const headers = { 'X-Action-Reason': reason };
    setBusy(true);
    try {
      if (Object.keys(changed).length) {
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

  const field = ([k, label, type]) => (
    <label key={k} className={`block ${heading} ${k === 'name' || k === 'locality' ? 'sm:col-span-2' : ''}`}>
      {label}
      <input type={type || 'text'} value={form[k] || ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={`${input} mt-1 normal-case tracking-normal font-normal`} />
    </label>
  );

  return (
    <Modal title={`KYC call${member?.membership_number ? ` · ${member.membership_number}` : ''}`} onClose={onClose} maxWidthClass="max-w-3xl"
      footer={<ModalFooter kind="add" submitLabel="Save KYC" onCancel={onClose} onSubmit={save} busy={busy} disabled={!member} />}>
      {!member ? <div className="p-8 text-sm text-center text-[#7D7068]">Loading…</div> : (
        <div className="p-5 space-y-5">
          <section className="space-y-3">
            <h3 className={heading}>Confirm on the call</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {field(FIELDS[0])}
              {field(FIELDS[1])}
              {field(FIELDS[2])}
              {field(FIELDS[3])}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className={heading}>Place (from the pincode)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)] gap-3 items-start">
              <label className={`block ${heading}`}>
                Pincode
                <input type="text" inputMode="numeric" value={pin} onChange={(e) => onPin(e.target.value)} className={`${input} mt-1 normal-case tracking-normal font-normal`} />
              </label>
              <div className="bg-[#F4F8F5] border border-[#CFE2D8] rounded-xl px-4 py-3 text-sm min-h-[64px]">
                {pin.length < 6 ? <span className="text-[#7D7068]">Type the 6 digit pincode: the post office, taluk and district appear here.</span>
                  : !pinInfo ? <span className="text-[#7D7068]">Looking up…</span>
                  : !pinInfo.found ? <span className="text-[#8C1801] font-semibold">This pincode is not in the pincode master.</span>
                  : (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                      <div>
                        <div className="text-xs text-[#5C7A6C]">Post office</div>
                        {pinInfo.matches.length > 1 ? (
                          <select value={pinChoice || ''} onChange={(e) => setPinChoice(Number(e.target.value))} className="mt-0.5 w-full bg-white border border-[#CFE2D8] rounded-lg px-2 py-1 text-sm font-semibold">
                            {pinInfo.matches.map((x) => <option key={x.id} value={x.id}>{x.area || x.postalCode}</option>)}
                          </select>
                        ) : <b>{chosen?.area || '—'}</b>}
                      </div>
                      <div><div className="text-xs text-[#5C7A6C]">Taluk</div><b>{chosen?.talukName || '—'}</b></div>
                      <div><div className="text-xs text-[#5C7A6C]">District</div><b>{chosen?.districtName || '—'}</b></div>
                      <div><div className="text-xs text-[#5C7A6C]">State</div><b>{chosen?.stateName || '—'}</b></div>
                    </div>
                  )}
              </div>
            </div>
            <div className="grid grid-cols-1">{field(FIELDS[4])}</div>
          </section>

          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h3 className={heading}>Other records that may be this person</h3>
              <span className="text-xs text-[#7D7068]">{others.length ? `${others.length} found` : 'none found'}</span>
            </div>
            {others.length > 0 && (
              <div className="border border-[#E8DFD8] rounded-xl divide-y divide-[#E8DFD8] overflow-hidden">
                {others.map((o) => (
                  <div key={o.id} className="px-4 py-3 space-y-2 bg-white">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-sm">{o.name}</b>
                      <span className="text-xs text-[#7D4A3F]">{o.membership_no ? `Membership no ${o.membership_no}` : `ID: ${o.id}`}</span>
                      {o.tags.map((t) => <span key={t} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tagTone[t] || ''}`}>{t}</span>)}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
                      <div><span className="text-[#7D7068]">Type</span><br /><b>{o.type || '—'}</b></div>
                      <div><span className="text-[#7D7068]">Date of birth</span><br /><b>{o.dob || '—'}</b></div>
                      <div><span className="text-[#7D7068]">Father / husband</span><br /><b>{o.father || '—'}</b></div>
                      <div><span className="text-[#7D7068]">Pincode</span><br /><b>{o.pincode || '—'}</b></div>
                      <div><span className="text-[#7D7068]">Receipts</span><br /><b>{o.receipts_count ? `${o.receipts_count} · total ${o.receipts_total.toLocaleString('en-IN')}` : 'none'}</b></div>
                      <div><span className="text-[#7D7068]">Magazine</span><br /><b>{o.magazine}</b></div>
                      <div><span className="text-[#7D7068]">KYC</span><br /><b>{VERIFICATION[o.verification]?.label || '—'}{o.verified_at ? ` ${o.verified_at}` : ''}</b></div>
                      <div><span className="text-[#7D7068]">Status</span><br /><b>{o.status || '—'}</b></div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {o.review ? (
                        <>
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${o.review === 'SAME' ? 'bg-[#8C1801]/10 text-[#8C1801] border-[#8C1801]/20' : 'bg-[#3D705C]/10 text-[#3D705C] border-[#3D705C]/30'}`}>
                            {o.review === 'SAME' ? 'Marked as the same person · waiting for an admin' : 'Marked as a different person'}
                          </span>
                          <button type="button" onClick={() => answer(o, 'CLEAR')} className="text-xs font-bold text-[#510601] underline cursor-pointer">Undo</button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => answer(o, 'SAME')} className="px-3.5 py-2 text-xs font-bold text-white bg-[#510601] border border-[#510601] rounded-xl cursor-pointer">Same person</button>
                          <button type="button" onClick={() => answer(o, 'DIFFERENT')} className="px-3.5 py-2 text-xs font-bold text-[#510601] bg-white border border-[#510601] rounded-xl cursor-pointer">Different person</button>
                        </>
                      )}
                      <Link to={`/dashboard/membership/profile/${o.id}`} target="_blank" className="text-xs font-bold text-[#510601] hover:underline ml-1">Open profile</Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-[#7D7068]">Same person only marks the pair for an admin: nothing is merged or deleted here. Different person takes the pair off the Duplicate Members list.</p>
          </section>

          <section className="space-y-3">
            <h3 className={heading}>Call result</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className={`block ${heading}`}>
                KYC call result
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${input} mt-1 normal-case tracking-normal font-normal`}>
                  {OUTCOMES.map((o) => <option key={o} value={o}>{VERIFICATION[o].label}</option>)}
                </select>
              </label>
              <label className={`block ${heading}`}>
                Remark
                <input type="text" value={remark} maxLength={1000} onChange={(e) => setRemark(e.target.value)} className={`${input} mt-1 normal-case tracking-normal font-normal`} />
              </label>
            </div>
            {calls.length > 0 && (
              <div>
                <div className={`${heading} mb-1`}>Earlier KYC calls</div>
                <ul className="text-xs text-[#180200] divide-y divide-[#EFE6DE] border border-[#EFE6DE] rounded-xl">
                  {calls.map((c) => (
                    <li key={c.id} className="px-3 py-1.5">
                      <b>{VERIFICATION[c.status]?.label || c.status}</b> · {formatDateTime(c.called_at, '', false)} · {c.called_by}{c.remark ? ` · ${c.remark}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <div className="pt-1">
            <Link to={`/dashboard/membership/edit/${memberId}`} className="text-sm font-bold text-[#510601] hover:underline">Open full edit (address, Kannada name, type)</Link>
          </div>
        </div>
      )}
    </Modal>
  );
}
