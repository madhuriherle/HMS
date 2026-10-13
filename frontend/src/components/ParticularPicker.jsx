import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

const activeSubs = (p) => (p?.subTypes || []).filter((st) => (st.status || 'Active') === 'Active');

/**
 * One field for "Particular" and its "Sub-Type".
 * Left list: particulars. Right list: the sub-types of the highlighted particular.
 * A particular without sub-types is chosen with one click; otherwise the second click picks the sub-type.
 * Search looks in both lists. `onChange({ particular, subType })`.
 */
export default function ParticularPicker({ particulars, particular, subType, onChange, hasError = false, placeholder = 'Select particular' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState('');
  const box = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () => particulars.map((p) => {
      const subs = activeSubs(p);
      const nameHit = !q || p.name.toLowerCase().includes(q);
      const shown = nameHit ? subs : subs.filter((st) => st.name.toLowerCase().includes(q));
      return { p, subs, shown, visible: nameHit || shown.length > 0 };
    }).filter((r) => r.visible),
    [particulars, q]
  );
  const current = rows.find((r) => r.p.name === active) || rows[0];

  const pick = (name, sub = '') => {
    onChange({ particular: name, subType: sub });
    setOpen(false);
    setQuery('');
  };
  const choose = (r) => {
    if (r.subs.length === 0) pick(r.p.name);
    else setActive(r.p.name);
  };

  const openBox = () => {
    setActive(particular || '');
    setOpen(true);
    setTimeout(() => input.current?.focus(), 0);
  };

  const onKey = (e) => {
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!current) return;
      if (current.subs.length === 0) pick(current.p.name);
      else if (current.shown.length) pick(current.p.name, current.shown[0].name);
    }
  };

  const label = particular
    ? `${particular}${activeSubs(particulars.find((p) => p.name === particular)).length ? ` › ${subType || 'choose sub-type'}` : ''}`
    : placeholder;
  const incomplete = particular && activeSubs(particulars.find((p) => p.name === particular)).length > 0 && !subType;

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openBox())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 bg-[#FAF7F2] border rounded-xl text-xs sm:text-sm font-semibold text-left cursor-pointer transition-colors ${
          hasError ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30' : 'border-[#E8DFD8] focus:border-[#510601]'
        } ${particular && !incomplete ? 'text-[#180200]' : 'text-[#863221]/70'}`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full min-w-[300px] bg-white border border-[#E8DFD8] rounded-xl shadow-lg overflow-hidden">
          <div className="relative border-b border-[#E8DFD8]">
            <Search className="w-4 h-4 text-[#863221] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="Search particular or sub-type..."
              className="w-full pl-9 pr-3 py-2.5 text-sm focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 max-h-64">
            <ul role="listbox" className="overflow-y-auto border-r border-[#E8DFD8] py-1">
              {rows.map((r) => (
                <li key={r.p.id || r.p.name} role="option" aria-selected={r.p.name === particular}>
                  <button
                    type="button"
                    onClick={() => choose(r)}
                    onMouseEnter={() => r.subs.length && setActive(r.p.name)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left cursor-pointer ${
                      current?.p.name === r.p.name ? 'bg-[#FAF1EE] font-bold text-[#510601]' : 'text-[#180200] hover:bg-[#FAF7F2]'
                    }`}
                  >
                    <span className="truncate">{r.p.name}</span>
                    {r.subs.length > 0 && <span className="text-[#863221]">{'▸'}</span>}
                  </button>
                </li>
              ))}
              {rows.length === 0 && <li className="px-3 py-3 text-sm text-[#863221]">Nothing found.</li>}
            </ul>
            <ul role="listbox" className="overflow-y-auto py-1">
              {current && current.subs.length === 0 && (
                <li className="px-3 py-3 text-xs text-[#863221]">No sub-types. Click the particular to select it.</li>
              )}
              {current?.shown.map((st) => (
                <li key={st.id || st.name} role="option" aria-selected={current.p.name === particular && st.name === subType}>
                  <button
                    type="button"
                    onClick={() => pick(current.p.name, st.name)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left cursor-pointer hover:bg-[#FAF7F2] ${
                      current.p.name === particular && st.name === subType ? 'font-bold text-[#510601]' : 'text-[#180200]'
                    }`}
                  >
                    <span className="truncate">{st.name}</span>
                    {current.p.name === particular && st.name === subType && <span>{'✓'}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
