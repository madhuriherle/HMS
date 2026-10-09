// Turns whatever a toast is given (a string, or a FastAPI validation error list) into text,
// so a 422 from the server shows a readable message instead of breaking the screen.
export const toText = (message) => {
  if (message == null) return '';
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) {
    return message
      .map((m) => {
        if (typeof m === 'string') return m;
        const field = Array.isArray(m?.loc) ? m.loc.filter((l) => l !== 'body').join('.') : '';
        return [field, m?.msg].filter(Boolean).join(': ') || JSON.stringify(m);
      })
      .join('; ');
  }
  if (typeof message === 'object') return message.message || message.msg || JSON.stringify(message);
  return String(message);
};

// Message for a failed request: the server's text plus any field-level validation errors.
export const apiErrorMessage = (error, fallback) => {
  const data = error?.response?.data;
  const detail = toText(data?.detail);
  const list = Array.isArray(data?.errors)
    ? data.errors
        .map((e) => `${String(e.field || '').replace(/^body -> /, '')}: ${e.message}`)
        .join('; ')
    : '';
  return [detail, list].filter(Boolean).join(' - ') || fallback;
};
