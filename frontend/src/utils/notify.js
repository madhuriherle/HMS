import Swal from 'sweetalert2';

// One consistent result popup for the whole app: a green tick on success and a
// red cross on failure, auto-dismissing so it never blocks the user.
const ResultToast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 3200,
  timerProgressBar: true,
  customClass: {
    popup: 'hms-result-toast',
  },
  didOpen: (toast) => {
    toast.onmouseenter = Swal.stopTimer;
    toast.onmouseleave = Swal.resumeTimer;
  },
});

export const notifySuccess = (message, title = 'Success!') =>
  ResultToast.fire({ icon: 'success', title, text: message });

export const notifyError = (message, title = 'Error!') =>
  ResultToast.fire({ icon: 'error', title, text: message });

// `type` is 'success' (default) or 'error'
export const notify = (message, type = 'success') => {
  // The user backing out of a confirm is not an error worth reporting.
  if (type === 'error' && String(message || '').trim().toLowerCase() === 'action cancelled') return;
  return type === 'error' ? notifyError(message) : notifySuccess(message);
};
