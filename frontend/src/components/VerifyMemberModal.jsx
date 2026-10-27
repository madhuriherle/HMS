import React, { useEffect, useState } from 'react';
import api from '../api';
import Modal from './Modal';
import ModalFooter from './ModalFooter';
import { VERIFICATION } from './VerificationBadge';
import { confirmAction } from '../utils/actionConfirm';
import { formatDateTime } from '../utils/dateUtils';
import { notify } from '../utils/notify';

// The caller rings the member, fixes whatever is wrong, and records how the call went. The details are saved with the
// normal member update; the outcome with the verification call. One reason prompt covers both.
const FIELDS = [
  ['name', 'Name'],
  ['mobile', 'Mobile'],
  ['date_of_birth', 'Date of birth', 'date'],
  ['father_husband_name', 'Father / husband'],
  ['locality', 'Place']
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

export default function VerifyMemberModal({ memberId, onClose, onSaved }) {
  const [member, setMember] = useState(null);
  const [form, setForm] = useState({});
  const [calls, setCalls] = useState([]);
  const [status, setStatus] = useState('VERIFIED');
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    Promise.all([api.get(`/members/${memberId}`), api.get(`/members/${memberId}/verification`)])
      .then(([m, v]) => {
        if (!current) return;
        setMember(m.data);
        setForm(Object.fromEntries(FIELDS.map(([k]) => [k, (k === 'name' ? nameOf(m.data) : m.data[k]) || ''])));
        setCalls(v.data.calls || []);
      })
      .catch((e) => { notify(e.response?.data?.detail || 'Could not load the member.', 'error'); onClose(); });
    return () => { current = false; };
  }, [memberId]);

  const save = async () => {
    const was = (k) => (k === 'name' ? nameOf(member) : member[k]) || '';
    const changed = Object.fromEntries(FIELDS.map(([k]) => k).filter((k) => k !== 'name' && (form[k] || '') !== was(k)).map((k) => [k, form[k] || null]));
    if (form.name.trim().split(/\s+/).join(' ') !== was('name').trim().split(/\s+/).join(' ')) Object.assign(changed, nameParts(form.name));
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

  return (
    <Modal title={`KYC call${member?.membership_number ? ` · ${member.membership_number}` : ''}`} onClose={onClose} maxWidthClass="max-w-2xl"
      footer={<ModalFooter kind="add" submitLabel="Save KYC" onCancel={onClose} onSubmit={save} busy={busy} disabled={!member} />}>
      {!member ? <div className="p-8 text-sm text-center text-[#7D7068]">Loading…</div> : (
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FIELDS.map(([k, label, type]) => (
              <label key={k} className="block text-[11px] font-bold uppercase tracking-wider text-[#7D7068]">
                {label}
                <input type={type || 'text'} value={form[k] || ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={`${input} mt-1 normal-case tracking-normal font-normal`} />
              </label>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#7D7068]">
              KYC call result
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${input} mt-1 normal-case tracking-normal font-normal`}>
                {OUTCOMES.map((o) => <option key={o} value={o}>{VERIFICATION[o].label}</option>)}
              </select>
            </label>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#7D7068]">
              Remark
              <input type="text" value={remark} maxLength={1000} onChange={(e) => setRemark(e.target.value)} className={`${input} mt-1 normal-case tracking-normal font-normal`} />
            </label>
          </div>
          {calls.length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#7D7068] mb-1">Earlier KYC calls</div>
              <ul className="text-xs text-[#180200] divide-y divide-[#EFE6DE] border border-[#EFE6DE] rounded-xl">
                {calls.map((c) => (
                  <li key={c.id} className="px-3 py-1.5">
                    <b>{VERIFICATION[c.status]?.label || c.status}</b> · {formatDateTime(c.called_at, '', false)} · {c.called_by}{c.remark ? ` · ${c.remark}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
