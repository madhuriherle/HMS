import React from 'react';

// Every popup ends with this footer, so they all look and read the same:
//   Cancel (outline) + one main button, equal size, text only, bar as tall as the header (h-14).
// `kind` picks the label: add -> Save, edit -> Update, delete -> Delete, confirm -> Confirm, view -> Close only.
const LABELS = { add: 'Save', edit: 'Update', delete: 'Delete', confirm: 'Confirm' };
const BUSY = { add: 'Saving...', edit: 'Updating...', delete: 'Deleting...', confirm: 'Please wait...' };

export const MODAL_BAR = 'h-14 shrink-0';

const BUTTON = 'h-10 min-w-[110px] px-5 inline-flex items-center justify-center rounded-xl text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

export default function ModalFooter({
  kind = 'add',
  onCancel,
  onSubmit,          // omit when the main button is a form submit
  busy = false,
  disabled = false,
  title,             // tooltip on the main button (e.g. a missing privilege)
  submitLabel,       // only for a verb the kinds do not cover (Restore, Generate...)
  cancelLabel = 'Cancel',
  inForm = false,    // the footer sits inside a padded form body (p-6): pull it to the edges
  left = null,       // optional text / control at the far left
  className = '',    // e.g. print:hidden
}) {
  const view = kind === 'view';
  const danger = kind === 'delete';
  const label = submitLabel || LABELS[kind];
  return (
    <div
      className={`${MODAL_BAR} ${
        inForm ? 'w-[calc(100%+3rem)] -mx-6 -mb-6 mt-6 sticky bottom-0 z-10' : 'w-full'
      } flex items-center gap-3 px-6 border-t border-[#E8DFD8] bg-[#FAF7F2] rounded-b-2xl ${left ? 'justify-between' : 'justify-end'} ${className}`}
    >
      {left}
      <div className="flex items-center gap-3">
        {!view && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`${BUTTON} border border-[#E8DFD8] bg-white text-[#863221] hover:text-[#180200] hover:bg-[#FAF7F2]`}
          >
            {cancelLabel}
          </button>
        )}
        <button
          type={view || onSubmit ? 'button' : 'submit'}
          onClick={view ? onCancel : onSubmit}
          disabled={!view && (busy || disabled)}
          title={title}
          className={`${BUTTON} text-white ${danger ? 'bg-[#ED4636] hover:bg-[#c93a2b]' : 'bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200]'}`}
        >
          {view ? 'Close' : busy ? BUSY[kind] : label}
        </button>
      </div>
    </div>
  );
}
