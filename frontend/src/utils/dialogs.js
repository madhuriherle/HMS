import Swal from 'sweetalert2';

const BRAND = '#510601';
const DANGER = '#ED4636';

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const INPUT_CLASS =
  'width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #E8DFD8;border-radius:12px;font-size:14px;margin-top:4px;background:#fff;color:#180200';

// Asks for a reason. Resolves with the text, or null when cancelled.
export const askReason = async ({ title, text, confirmText = 'Confirm', danger = false }) => {
  const res = await Swal.fire({
    title,
    text,
    icon: danger ? 'warning' : 'question',
    input: 'textarea',
    inputAttributes: { maxlength: 500 },
    showCancelButton: true,
    confirmButtonText: confirmText,
    confirmButtonColor: danger ? DANGER : BRAND,
    cancelButtonColor: '#863221',
    reverseButtons: true,
    allowOutsideClick: false,
    customClass: { popup: 'hms-mini-swal' },
    inputValidator: (v) => (!v || !v.trim() ? 'A reason is required' : undefined)
  });
  return res.isConfirmed ? res.value.trim() : null;
};

// Simple yes/no confirmation. Resolves true / false.
export const confirmYesNo = async ({ title, text, confirmText = 'Yes', danger = false }) => {
  const res = await Swal.fire({
    title,
    text,
    icon: danger ? 'warning' : 'question',
    showCancelButton: true,
    confirmButtonText: confirmText,
    confirmButtonColor: danger ? DANGER : BRAND,
    cancelButtonColor: '#863221',
    reverseButtons: true,
    customClass: { popup: 'hms-mini-swal' }
  });
  return res.isConfirmed;
};

let formHost = null;

export const registerFormHost = (fn) => {
  formHost = fn;
  return () => {
    if (formHost === fn) formHost = null;
  };
};

export const askForm = (config) =>
  new Promise((resolve) => {
    if (!formHost) {
      resolve(null);
      return;
    }
    formHost({ ...config, resolve });
  });

// Scrollable list of checkboxes. Resolves with the ticked values, or null when cancelled.
//   items: [{ value, label, hint, checked }]
export const askChecklist = async ({ title, text, items, confirmText = 'Save' }) => {
  const rows = items
    .map(
      (it, i) =>
        `<label style="display:flex;gap:8px;align-items:flex-start;text-align:left;padding:6px 4px;border-bottom:1px solid #F0E8E2;font-size:13px;cursor:pointer">
          <input type="checkbox" data-i="${i}" ${it.checked ? 'checked' : ''} style="margin-top:3px" />
          <span>${esc(it.label)}${it.hint ? `<br/><small style="color:#863221">${esc(it.hint)}</small>` : ''}</span>
        </label>`
    )
    .join('');
  const res = await Swal.fire({
    title,
    text,
    html: `<div id="swal-checklist" style="max-height:320px;overflow:auto;border:1px solid #E8DFD8;border-radius:12px;padding:4px 8px">${rows || '<em>Nothing to choose from.</em>'}</div>`,
    showCancelButton: true,
    confirmButtonText: confirmText,
    confirmButtonColor: BRAND,
    cancelButtonColor: '#863221',
    reverseButtons: true,
    allowOutsideClick: false,
    preConfirm: () =>
      [...document.querySelectorAll('#swal-checklist input[type=checkbox]')]
        .filter((el) => el.checked)
        .map((el) => items[Number(el.dataset.i)].value)
  });
  return res.isConfirmed ? res.value : null;
};

export const showError = (err, fallback) =>
  Swal.fire({
    icon: 'error',
    title: 'Something went wrong',
    text: (typeof err?.response?.data?.detail === 'string' && err.response.data.detail) || fallback,
    confirmButtonColor: BRAND,
    customClass: { popup: 'hms-mini-swal hms-result-swal' }
  });

export const showSuccess = (text) =>
  Swal.fire({ icon: 'success', title: 'Done', text, confirmButtonColor: BRAND, customClass: { popup: 'hms-mini-swal hms-result-swal' } });
