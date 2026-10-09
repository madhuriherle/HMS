import React, { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { formatDate, toISODate } from '../utils/dateUtils';

/**
 * Date box that ALWAYS shows DD-MM-YYYY while the form keeps ISO (YYYY-MM-DD).
 *
 * What you type stays exactly as typed. The form only gets a value (the ISO date)
 * once the date is complete and real; while it is incomplete or invalid the form
 * gets an empty value, so a half-typed date can never be saved.
 */
const isRealIso = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
};

export default function DateInput({
  value = '',
  onChange,
  name,
  id,
  placeholder = '',
  min,
  max,
  disabled = false,
  required = false,
  className = '',
  iconClassName = '',
  autoFocus = false,
  ...props
}) {
  const hiddenDateInputRef = useRef(null);

  const fromValue = (v) => (v ? formatDate(v, '') : '');
  const [text, setText] = useState(() => fromValue(value));
  const lastEmitted = useRef(value || '');

  // The form changed the value from outside (loaded a record, cleared the form, picked in the calendar)
  useEffect(() => {
    if ((value || '') !== lastEmitted.current) {
      lastEmitted.current = value || '';
      setText(fromValue(value));
    }
  }, [value]);

  const emit = (e, newValue) => {
    lastEmitted.current = newValue;
    if (onChange) {
      onChange({
        ...e,
        target: { ...e.target, name: name || id, value: newValue }
      });
    }
  };

  const isoValue = isRealIso(value) ? value : '';

  const handleDisplayChange = (e) => {
    let raw = e.target.value.replace(/[^\d-]/g, '');

    // Auto-hyphenate DD-MM-YYYY as the user types (not when deleting)
    if (raw.length > text.length) {
      if (raw.length === 2 && !raw.includes('-')) raw += '-';
      else if (raw.length === 5 && raw.split('-').length === 2) raw += '-';
    }
    raw = raw.slice(0, 10);
    setText(raw);

    if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) {
      const iso = toISODate(raw);
      emit(e, isRealIso(iso) ? iso : '');
    } else {
      emit(e, '');
    }
  };

  const handlePickerChange = (e) => {
    const selectedIso = e.target.value; // YYYY-MM-DD from the calendar
    setText(fromValue(selectedIso));
    emit(e, selectedIso);
  };

  const openPicker = () => {
    if (disabled) return;
    if (hiddenDateInputRef.current) {
      try {
        if (typeof hiddenDateInputRef.current.showPicker === 'function') {
          hiddenDateInputRef.current.showPicker();
        } else {
          hiddenDateInputRef.current.focus();
          hiddenDateInputRef.current.click();
        }
      } catch (err) {
        hiddenDateInputRef.current.focus();
        hiddenDateInputRef.current.click();
      }
    }
  };

  return (
    <div className="relative flex items-center w-full">
      {/* Visual Text Field showing DD-MM-YYYY */}
      <input
        type="text"
        id={id}
        name={name}
        value={text}
        onChange={handleDisplayChange}
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
        placeholder={placeholder}
        inputMode="numeric"
        maxLength={10}
        className={`w-full text-xs sm:text-sm tracking-wide bg-white font-mono ${className}`}
        {...props}
      />

      {/* Calendar Icon Button to trigger native date picker */}
      <button
        type="button"
        tabIndex={-1}
        onClick={openPicker}
        disabled={disabled}
        aria-label="Choose date"
        className={`absolute right-2.5 p-1 text-stone-400 hover:text-[#510601] transition-colors rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${iconClassName}`}
      >
        <Calendar className="w-4 h-4" />
      </button>

      {/* Hidden native date picker */}
      <input
        ref={hiddenDateInputRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={isoValue}
        min={min ? toISODate(min) : undefined}
        max={max ? toISODate(max) : undefined}
        onChange={handlePickerChange}
        disabled={disabled}
        className="sr-only absolute opacity-0 pointer-events-none w-0 h-0"
      />
    </div>
  );
}
