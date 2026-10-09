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
    inputPlaceholder: 'Reason (required)',
    inputAttributes: { maxlength: 500 },
    showCancelButton: true,
    confirmButtonText: confirmText,
    confirmButtonColor: danger ? DANGER : BRAND,
    cancelButtonColor: '#863221',
    reverseButtons: true,
    allowOutsideClick: false,
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
    reverseButtons: true
  });
  return res.isConfirmed;
};

// Small form in a popup.
//   fields: [{ name, label, type: 'text'|'number'|'date'|'month'|'select'|'textarea'|'file',
//              required, value, options: [{ value, label }], placeholder }]
// Resolves with { name: value } (File objects for type 'file'), or null when cancelled.
export const askForm = async ({ title, text, fields, confirmText = 'Save' }) => {
  const html = fields
    .map((f) => {
      const id = `swal-f-${f.name}`;
      const label = `<label for="${id}" style="display:block;text-align:left;font-size:12px;font-weight:700;color:#180200;margin-top:12px">${esc(f.label)}${f.required ? ' *' : ''}</label>`;
      if (f.type === 'select') {
        const opts = (f.options || [])
          .map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(f.value ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`)
          .join('');
        return `${label}<select id="${id}" style="${INPUT_CLASS}"><option value="">-- Select --</option>${opts}</select>`;
      }
      if (f.type === 'textarea') {
        return `${label}<textarea id="${id}" rows="3" style="${INPUT_CLASS}" placeholder="${esc(f.placeholder)}">${esc(f.value)}</textarea>`;
      }
      return `${label}<input id="${id}" type="${f.type || 'text'}" value="${esc(f.value)}" placeholder="${esc(f.placeholder)}" style="${INPUT_CLASS}" />`;
    })
    .join('');

  const res = await Swal.fire({
    title,
    text,
    html,
    showCancelButton: true,
    confirmButtonText: confirmText,
    confirmButtonColor: BRAND,
    cancelButtonColor: '#863221',
    reverseButtons: true,
    focusConfirm: false,
    allowOutsideClick: false,
    preConfirm: () => {
      const out = {};
      for (const f of fields) {
        const el = document.getElementById(`swal-f-${f.name}`);
        let value = f.type === 'file' ? el.files?.[0] || null : (el.value || '').trim();
        if (f.required && !value) {
          Swal.showValidationMessage(`${f.label} is required`);
          return false;
        }
        if (f.type === 'number' && value !== '') value = Number(value);
        out[f.name] = value;
      }
      return out;
    }
  });
  return res.isConfirmed ? res.value : null;
};

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
    confirmButtonColor: BRAND
  });

export const showSuccess = (text) =>
  Swal.fire({ icon: 'success', title: 'Done', text, confirmButtonColor: BRAND, timer: 2500 });
