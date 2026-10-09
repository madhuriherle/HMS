import Swal from 'sweetalert2';

// Every change (create / edit / delete / status) must be confirmed with a
// reason. api.js calls confirmAction() before sending any non-GET request and
// forwards the reason in the X-Action-Reason header, which the backend stores
// in the audit log.

// Words for the last URL segment(s) that name the thing being changed.
const ENTITY_LABELS = {
  members: 'member',
  receipts: 'receipt',
  states: 'state',
  districts: 'district',
  taluks: 'taluk',
  'postal-codes': 'PIN code',
  'membership-types': 'membership type',
  prices: 'membership price',
  particulars: 'particular',
  banks: 'bank',
  'payment-modes': 'payment mode',
  users: 'user',
  roles: 'role',
  modules: 'module',
  permissions: 'privileges',
  settings: 'organisation settings',
  system: 'settings',
};

const VERBS = {
  post: { verb: 'Create', past: 'create', icon: 'question' },
  put: { verb: 'Update', past: 'update', icon: 'question' },
  patch: { verb: 'Update', past: 'update', icon: 'question' },
  delete: { verb: 'Delete', past: 'delete', icon: 'warning' },
};

const entityFromUrl = (url = '') => {
  const parts = url.split('?')[0].split('/').filter(Boolean);
  // walk backwards past numeric ids to the last word segment
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (/^\d+$/.test(parts[i])) continue;
    if (ENTITY_LABELS[parts[i]]) return ENTITY_LABELS[parts[i]];
  }
  const last = [...parts].reverse().find((p) => !/^\d+$/.test(p));
  return last ? last.replace(/-/g, ' ') : 'record';
};

// A single user action often fires several requests back to back (e.g. create
// a membership type, then its price). Ask once and reuse the answer briefly.
const REUSE_MS = 4000;
let lastApproved = { at: 0, reason: '' };

export const describeAction = (method, url) => {
  const m = VERBS[(method || '').toLowerCase()] || VERBS.post;
  const entity = entityFromUrl(url);
  return { ...m, entity, title: `${m.verb} ${entity}?` };
};

// Resolves with the reason text, or null if the user cancelled.
export const confirmAction = async (method, url) => {
  if (Date.now() - lastApproved.at < REUSE_MS && lastApproved.reason) {
    return lastApproved.reason;
  }
  const { verb, past, icon, entity, title } = describeAction(method, url);
  const result = await Swal.fire({
    title,
    text: `Please give a reason to ${past} this ${entity}.`,
    icon,
    input: 'textarea',
    inputPlaceholder: 'Reason (required)',
    inputAttributes: { 'aria-label': 'Reason', maxlength: 500 },
    showCancelButton: true,
    confirmButtonText: `Yes, ${past}`,
    cancelButtonText: 'Cancel',
    confirmButtonColor: verb === 'Delete' ? '#ED4636' : '#510601',
    cancelButtonColor: '#863221',
    reverseButtons: true,
    focusConfirm: false,
    allowOutsideClick: false,
    inputValidator: (value) => (!value || !value.trim() ? 'A reason is required' : undefined),
  });
  if (!result.isConfirmed) return null;
  const reason = result.value.trim();
  lastApproved = { at: Date.now(), reason };
  return reason;
};

// Shown by api.js when the user backs out; pages display response.data.detail.
export const cancelledError = (config) => {
  const err = new Error('Action cancelled');
  err.config = config;
  err.isCancelled = true;
  err.response = { status: 0, data: { detail: 'Action cancelled' } };
  return err;
};
