// A member's name as it was typed (full_name_en). Older rows without it fall back to first / middle / last.
export const memberName = (m, withTitle = false) => {
  if (!m) return '';
  const base = m.full_name_en || [m.first_name_en, m.middle_name_en, m.last_name_en].filter(Boolean).join(' ');
  return withTitle && m.name_title && base ? `${m.name_title} ${base}` : base;
};
