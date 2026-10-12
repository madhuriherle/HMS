import { useEffect, useState } from 'react';
import api from '../api';

// The data rules the server enforces (formats, limits, fixed lists), fetched once from GET /meta/rules.
// Until they arrive `rules` is null: the screens skip their own checks and the server still validates.
let cached = null;
let pending = null;

export const loadRules = () => {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = api
      .get('/meta/rules')
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

export const currentRules = () => cached;

export default function useRules() {
  const [rules, setRules] = useState(cached);
  useEffect(() => {
    if (!cached) loadRules().then(setRules).catch(() => {});
  }, []);
  return rules;
}

// Helpers that stay quiet (valid) while the rules have not loaded yet.
export const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');
export const hasDigits = (value, count) => !count || new RegExp(`^\\d{${count}}$`).test(String(value ?? '').replace(/\s/g, ''));
export const matchesPattern = (value, pattern) => !pattern || new RegExp(pattern).test(String(value ?? ''));

// '' when the password satisfies the server's policy (or the rules have not loaded yet), else the server's message.
export const passwordProblem = (rules, password) => {
  const rule = rules?.password;
  if (!rule) return '';
  const pw = String(password ?? '');
  const ok =
    pw.length >= rule.min_length &&
    (!rule.needs.includes('uppercase') || /[A-Z]/.test(pw)) &&
    (!rule.needs.includes('lowercase') || /[a-z]/.test(pw)) &&
    (!rule.needs.includes('number') || /\d/.test(pw)) &&
    (!rule.needs.includes('symbol') || /[^A-Za-z0-9\s]/.test(pw));
  return ok ? '' : rule.message;
};

// '' when the digits count is within the mobile rule (or the rules have not loaded yet), else a message.
export const mobileProblem = (rules, mobile) => {
  const rule = rules?.mobile;
  if (!rule) return '';
  const m = String(mobile ?? '');
  return /^\d+$/.test(m) && m.length >= rule.min_digits && m.length <= rule.max_digits
    ? ''
    : `Mobile number must be ${rule.min_digits}-${rule.max_digits} digits`;
};
