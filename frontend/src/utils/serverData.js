// Server-backed data for the whole panel. Nothing here is stored in the
// browser: every function reads the API and returns the shape the pages use.
import api from '../api';
import { fetchMembers, fetchMemberPage, fetchReceipts, normalizeReceipt, unwrapList } from './apiAdapters';

const rows = (res) => unwrapList(res?.data);
const statusLabel = (flag) => (flag ? 'Active' : 'Inactive');

// ── Locations (states / districts / taluks / PIN codes) ──────────────────
export const loadLocations = async () => {
  const [st, dt, tk, pc] = await Promise.all([
    api.get('/masters/states', { params: { limit: 2000 } }),
    api.get('/masters/districts', { params: { limit: 2000 } }),
    api.get('/masters/taluks', { params: { limit: 25000 } }),
    api.get('/masters/postal-codes', { params: { limit: 25000 } }),
  ]);

  const states = rows(st).map((s) => ({ id: s.id, name: s.name_en, status: statusLabel(s.status) }));
  const stateName = new Map(states.map((s) => [s.id, s.name]));

  const districts = rows(dt).map((d) => ({
    id: d.id,
    name: d.name_en,
    stateId: d.state_id,
    stateName: stateName.get(d.state_id) || '',
    status: statusLabel(d.status),
  }));
  const districtById = new Map(districts.map((d) => [d.id, d]));

  const taluks = rows(tk).map((t) => {
    const dist = districtById.get(t.district_id);
    return {
      id: t.id,
      name: t.name_en,
      districtId: t.district_id,
      districtName: dist?.name || '',
      stateId: dist?.stateId ?? '',
      stateName: dist?.stateName || '',
      status: statusLabel(t.status),
    };
  });
  const talukName = new Map(taluks.map((t) => [t.id, t.name]));

  const postalCodes = rows(pc).map((p) => ({
    id: p.id,
    postalCode: p.pincode,
    area: p.post_office_name,
    stateId: p.state_id,
    districtId: p.district_id,
    talukId: p.taluk_id,
    stateName: stateName.get(p.state_id) || '',
    districtName: districtById.get(p.district_id)?.name || '',
    talukName: talukName.get(p.taluk_id) || '',
    status: statusLabel(p.status),
  }));

  return { states, districts, taluks, postalCodes };
};

// PIN code -> state / district / taluk, from an already loaded list of postal codes.
export const findLocationByPin = (postalCodes, pinCode) => {
  const pin = String(pinCode || '').trim();
  if (!/^\d{6}$/.test(pin)) return { found: false, matches: [] };
  const matches = (postalCodes || []).filter((p) => String(p.postalCode || '').trim() === pin);
  if (matches.length === 0) return { found: false, matches: [] };
  const primary = matches.find((m) => m.status === 'Active') || matches[0];
  return {
    found: true,
    pinCode: primary.postalCode,
    area: primary.area,
    talukName: primary.talukName,
    talukId: primary.talukId,
    districtName: primary.districtName,
    districtId: primary.districtId,
    stateName: primary.stateName,
    stateId: primary.stateId,
    status: primary.status,
    allAreas: matches.map((m) => m.area),
    matches,
  };
};

// ── Membership types, gotras, particulars, payment modes ─────────────────
export const loadMembershipTypes = async () => {
  const res = await api.get('/masters/membership-types', { params: { limit: 1000 } });
  return rows(res).map((m) => ({
    id: m.id,
    name: m.name_en,
    code: m.code,
    currentPrice: Number(m.current_price || 0),
    status: statusLabel(m.status),
  }));
};

export const loadGothras = async () => {
  const res = await api.get('/masters/gotras', { params: { limit: 1000 } });
  return rows(res).filter((g) => g.status !== false).map((g) => g.name_en || g.name);
};

export const loadQualifications = async () => {
  const res = await api.get('/masters/qualifications', { params: { limit: 1000 } });
  return rows(res).filter((q) => q.status !== false).map((q) => q.name_en || q.name);
};

export const loadParticulars = async () => {
  const res = await api.get('/masters/particulars', { params: { limit: 2000 } });
  const all = rows(res);
  return all
    .filter((p) => !p.parent_id)
    .map((p) => ({
      id: p.id,
      name: p.name_en,
      status: statusLabel(p.status),
      subTypes: all
        .filter((c) => c.parent_id === p.id)
        .map((c) => ({ id: c.id, name: c.name_en, status: statusLabel(c.status) })),
    }));
};

export const loadPaymentModeConfigs = async () => {
  const [banksRes, modesRes] = await Promise.all([
    api.get('/masters/banks', { params: { limit: 1000 } }),
    api.get('/masters/payment-modes', { params: { limit: 1000 } }),
  ]);
  const banks = rows(banksRes);
  return rows(modesRes).map((m) => {
    const bank = banks.find((b) => b.id === m.bank_id);
    return {
      id: m.id,
      paymentMode: m.payment_mode,
      paymentType: m.payment_type,
      bankAccount: bank ? bank.name_en : '',
      branch: bank ? bank.branch_name : '',
      ifscCode: bank ? bank.ifsc_code : '',
      accountNumber: bank ? bank.account_number : '',
      status: statusLabel(m.status),
    };
  });
};

// ── Members, receipts, renewals ──────────────────────────────────────────
export const loadMembers = (params) => fetchMembers(params);
export const loadReceipts = (params) => fetchReceipts(params);

// One page of the members waiting for approval (rule 10.6): each row carries the receipt mapped to it, if any,
// and `summary` has the with / without receipt counts of the whole filtered set.
export const loadUnapprovedPage = async (params = {}) => {
  const page = await fetchMemberPage({ approval_status: 'UNAPPROVED', with_receipt: true, ...params });
  const rows = page.rows.map((m) => {
    const receipt = m.receipt ? normalizeReceipt(m.receipt) : null;
    return {
      ...m,
      receiptStatus: receipt ? 'Assigned' : 'Pending',
      assignedReceiptNumber: receipt ? receipt.receiptNumber : '',
      receipt,
      registrationDate: m.created_at ? String(m.created_at).slice(0, 10) : '',
    };
  });
  return { ...page, rows };
};
