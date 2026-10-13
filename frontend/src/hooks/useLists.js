import { useEffect, useState } from 'react';
import api from '../api';

// The fixed lists the screens show (child relations, receipt statuses, country codes ...), fetched once from
// GET /meta/lists. Each entry is { code, label, extra }. Until they arrive a list is empty.
let cached = null;
let pending = null;

export const loadLists = () => {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = api
      .get('/meta/lists')
      .then(({ data }) => {
        cached = data;
        return data;
      })
      .catch((error) => {
        pending = null;
        throw error;
      });
  }
  return pending;
};

export const currentLists = () => cached;

export default function useLists() {
  const [lists, setLists] = useState(cached);
  useEffect(() => {
    if (!cached) loadLists().then(setLists).catch(() => {});
  }, []);
  return lists;
}

// One list by name ([] until loaded).
export function useList(name) {
  const lists = useLists();
  return lists?.[name] || [];
}

// Flag emoji from the two-letter country code.
const flagOf = (iso) =>
  String(iso || '')
    .toUpperCase()
    .replace(/./g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0)));

// The country_codes list as { code, name, dialCode, flag }.
export function useCountryCodes() {
  const rows = useList('country_codes');
  return rows.map((r) => ({ code: r.code, name: r.label, dialCode: r.extra, flag: flagOf(r.code) }));
}
