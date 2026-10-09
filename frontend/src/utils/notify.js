import Swal from 'sweetalert2';
import { toText } from './apiError';

// One consistent result popup for the whole app: a green tick on success and a
// red cross on failure, shown as a centred SweetAlert dialog with an OK button.
const BRAND = '#510601';

const ResultPopup = Swal.mixin({
  position: 'center',
  confirmButtonText: 'OK',
  confirmButtonColor: BRAND,
  customClass: { popup: 'hms-mini-swal hms-result-swal' },
});

export const notifySuccess = (message, title = 'Success!') =>
  ResultPopup.fire({ icon: 'success', title, text: message });

export const notifyError = (message, title = 'Error!') =>
  ResultPopup.fire({ icon: 'error', title, text: message });

// `type` is 'success' (default) or 'error'
export const notify = (message, type = 'success') => {
  message = toText(message); // a server validation list becomes readable text
  // The user backing out of a confirm is not an error worth reporting.
  if (type === 'error' && String(message || '').trim().toLowerCase() === 'action cancelled') return;
  return type === 'error' ? notifyError(message) : notifySuccess(message);
};
