import React, { useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import Modal from './Modal';
import ModalFooter from './ModalFooter';

const normalise = (opt) =>
  typeof opt === 'object' && opt !== null
    ? { value: opt.value ?? opt.id ?? opt.name, label: String(opt.label ?? opt.name ?? opt.value) }
    : { value: opt, label: String(opt) };

/**
 * OptionPicker: a plain list of choices (qualifications, gotras and the like) picked in a popup instead of a dropdown.
 * The form shows one button with the current choice; it opens a popup with every choice at once as buttons, a search
 * box that narrows them as you type (Enter picks the first match), and one click picks and closes. Same look as the
 * Particular picker.
 */
export default function OptionPicker({
  value = '',
  onChange,
  options = [],
  placeholder = 'Select',
  title = 'Select',
  hasError = false,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);

  const items = useMemo(() => options.map(normalise), [options]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (q ? items.filter((o) => o.label.toLowerCase().includes(q)) : items), [items, q]);
  const current = items.find((o) => String(o.value) === String(value));

  const openPopup = () => {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    setTimeout(() => searchRef.current?.focus(), 50);
  };
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const pick = (val) => {
    onChange(val);
    close();
  };

  return (
    <div className="relative w-full">
      <button
        type="button"
        onClick={openPopup}
        disabled={disabled}
        title={current ? current.label : placeholder}
        className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] border rounded-lg text-sm text-left cursor-pointer transition-all shadow-2xs disabled:cursor-not-allowed disabled:opacity-60 ${
          hasError ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#E8DFD8] hover:border-[#8C1801]/60'
        } ${current ? 'text-[#180200]' : 'text-[#9E8B7F]'}`}
      >
        <span className="truncate">{current ? current.label : placeholder}</span>
        <ChevronDown className="w-4 h-4 shrink-0 text-[#863221]" />
      </button>

      {open && (
        <Modal
          isOpen
          onClose={close}
          title={title}
          maxWidthClass="max-w-4xl"
          heightClass="h-[80vh]"
          footer={
            <ModalFooter
              kind="view"
              onCancel={close}
              cancelLabel="Close"
              left={
                value ? (
                  <button type="button" onClick={() => pick('')} className="text-xs font-semibold text-[#863221] hover:text-[#510601] underline cursor-pointer">
                    Clear the choice
                  </button>
                ) : (
                  <span className="text-xs text-[#863221] hidden sm:inline">Click a button to pick it</span>
                )
              }
            />
          }
        >
          <div className="p-4 sm:p-5 space-y-4 flex flex-col flex-1 min-h-0">
            <div className="relative">
              <Search className="w-4 h-4 text-[#863221] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (shown[0]) pick(shown[0].value);
                  }
                }}
                placeholder="Type to find one (Enter picks the first match)"
                className="w-full pl-10 pr-9 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs sm:text-sm text-[#180200] placeholder-[#863221]/50 focus:outline-none focus:bg-white focus:border-[#510601] focus:ring-1 focus:ring-[#510601] transition-colors"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#863221]/60 hover:text-[#180200] p-1">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {shown.length === 0 ? (
              <p className="py-10 text-center text-sm text-[#863221]">{items.length === 0 ? 'Nothing to choose from yet.' : 'No match.'}</p>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                <div className="flex flex-wrap gap-2 content-start">
                  {shown.map((opt) => {
                    const selected = String(opt.value) === String(value);
                    return (
                      <button
                        key={String(opt.value)}
                        type="button"
                        onClick={() => pick(opt.value)}
                        className={`inline-flex max-w-full items-center gap-1 rounded-lg border px-3 py-1.5 text-left break-words text-xs sm:text-sm font-semibold leading-snug transition-colors cursor-pointer ${
                          selected
                            ? 'border-[#510601] bg-[#510601] text-white'
                            : 'border-[#CDBFB3] text-[#180200] hover:border-[#510601] hover:text-[#510601]'
                        }`}
                      >
                        {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
