/**
 * Centralized Date Formatting & Parsing Utilities for HMS MMA
 *
 * ALL user-visible dates across the application MUST use:
 * DD-MM-YYYY (e.g. 15-09-1989, 08-10-2026)
 *
 * Backend/API storage dates (ISO YYYY-MM-DD) are preserved without breaking API contracts.
 */

/**
 * Formats any date input (ISO string, Date object, timestamp, formatted string)
 * into strictly DD-MM-YYYY format for user display.
 *
 * @param {string|number|Date|null|undefined} dateInput
 * @param {string} [fallback='—'] Value to return if date is invalid or empty
 * @returns {string} Formatted date as "DD-MM-YYYY" or fallback
 *
 * @example
 * formatDate('2026-10-08') // "08-10-2026"
 * formatDate('1989-09-15') // "15-09-1989"
 * formatDate('2026-10-08T14:30:00.000Z') // "08-10-2026"
 * formatDate('08/10/2026') // "08-10-2026"
 * formatDate(null) // "—"
 */
export const formatDate = (dateInput, fallback = '—') => {
  if (
    dateInput === null ||
    dateInput === undefined ||
    dateInput === '' ||
    dateInput === 'Invalid Date' ||
    dateInput === 'NaN' ||
    dateInput === 'undefined' ||
    dateInput === 'null'
  ) {
    return fallback;
  }

  // Handle Date instance
  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) return fallback;
    const day = String(dateInput.getDate()).padStart(2, '0');
    const month = String(dateInput.getMonth() + 1).padStart(2, '0');
    const year = dateInput.getFullYear();
    return `${day}-${month}-${year}`;
  }

  // Handle numeric timestamp
  if (typeof dateInput === 'number') {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return fallback;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  }

  const str = String(dateInput).trim();
  if (!str || str === '-' || str === '—') return fallback;

  // Pattern 1: Already DD-MM-YYYY (e.g. 15-09-1989 or 08-10-2026)
  if (/^\d{2}-\d{2}-\d{4}$/.test(str)) {
    return str;
  }

  // Pattern 2: DD/MM/YYYY (e.g. 15/09/1989)
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [dd, mm, yyyy] = str.split('/');
    return `${dd}-${mm}-${yyyy}`;
  }

  // Pattern 3: YYYY-MM-DD (e.g. 2026-10-08)
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [yyyy, mm, dd] = str.split('-');
    return `${dd}-${mm}-${yyyy}`;
  }

  // Pattern 4: YYYY/MM/DD (e.g. 2026/10/08)
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) {
    const [yyyy, mm, dd] = str.split('/');
    return `${dd}-${mm}-${yyyy}`;
  }

  // Pattern 5: ISO or date with time (e.g. 2026-10-08T14:30:00 or 2026-10-08 14:30:00)
  if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(str)) {
    const datePart = str.split(/[T\s]/)[0];
    const [yyyy, mm, dd] = datePart.split('-');
    if (yyyy && mm && dd) {
      return `${dd}-${mm}-${yyyy}`;
    }
  }

  // Pattern 6: DD-MM-YYYY with time (e.g. 08-10-2026 14:30:00)
  if (/^\d{2}-\d{2}-\d{4}[T\s]/.test(str)) {
    const datePart = str.split(/[T\s]/)[0];
    return datePart;
  }

  // Fallback to JS Date parsing
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const day = String(parsed.getDate()).padStart(2, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const year = parsed.getFullYear();
    return `${day}-${month}-${year}`;
  }

  return fallback;
};

/**
 * Formats a date & time input into "DD-MM-YYYY HH:mm:ss" or "DD-MM-YYYY HH:mm".
 *
 * @param {string|number|Date|null|undefined} dateInput
 * @param {string} [fallback='—']
 * @param {boolean} [includeSeconds=true]
 * @returns {string} Formatted date-time string
 */
export const formatDateTime = (dateInput, fallback = '—', includeSeconds = true) => {
  if (
    dateInput === null ||
    dateInput === undefined ||
    dateInput === '' ||
    dateInput === 'Invalid Date' ||
    dateInput === 'NaN'
  ) {
    return fallback;
  }

  const str = String(dateInput).trim();

  // A time that carries a zone (Z or +hh:mm, as the server sends it) is converted to the
  // viewer's local time; only zone-less strings are shown exactly as written.
  const hasZone = /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(str);

  // If matches "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DDTHH:mm:ss"
  if (!hasZone && /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(:\d{2})?/.test(str)) {
    const parts = str.split(/[T\s]/);
    const [yyyy, mm, dd] = parts[0].split('-');
    let timePart = parts[1].replace(/Z|\..*$/g, '');
    if (!includeSeconds && timePart.split(':').length === 3) {
      timePart = timePart.split(':').slice(0, 2).join(':');
    }
    return `${dd}-${mm}-${yyyy} ${timePart}`;
  }

  // If matches "DD-MM-YYYY HH:mm:ss"
  if (/^\d{2}-\d{2}-\d{4}[T\s]\d{2}:\d{2}(:\d{2})?/.test(str)) {
    const parts = str.split(/[T\s]/);
    let timePart = parts[1].replace(/Z|\..*$/g, '');
    if (!includeSeconds && timePart.split(':').length === 3) {
      timePart = timePart.split(':').slice(0, 2).join(':');
    }
    return `${parts[0]} ${timePart}`;
  }

  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return fallback;

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  const time = includeSeconds ? `${hours}:${minutes}:${seconds}` : `${hours}:${minutes}`;
  return `${day}-${month}-${year} ${time}`;
};

/**
 * Converts a DD-MM-YYYY or DD/MM/YYYY display date to ISO YYYY-MM-DD format for API payloads.
 *
 * @param {string} displayDate - Date in DD-MM-YYYY or DD/MM/YYYY format
 * @returns {string} ISO date string in YYYY-MM-DD format, or original string if already ISO
 */
export const toISODate = (displayDate) => {
  if (!displayDate) return '';
  const str = String(displayDate).trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // DD-MM-YYYY
  if (/^\d{2}-\d{2}-\d{4}$/.test(str)) {
    const [dd, mm, yyyy] = str.split('-');
    return `${yyyy}-${mm}-${dd}`;
  }

  // DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [dd, mm, yyyy] = str.split('/');
    return `${yyyy}-${mm}-${dd}`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return str;
};

/**
 * Returns today's date formatted as DD-MM-YYYY for display.
 * @returns {string} e.g. "08-10-2026"
 */
export const getTodayDisplayDate = () => {
  return formatDate(new Date());
};

/**
 * Returns today's date in ISO YYYY-MM-DD format for storage/APIs.
 * @returns {string} e.g. "2026-10-08"
 */
export const getTodayISODate = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * Alias for formatDate to match different naming conventions
 */
export const formatDateForDisplay = formatDate;
export const formatDateTimeForDisplay = formatDateTime;
