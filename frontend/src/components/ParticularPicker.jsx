import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Search } from 'lucide-react';

const activeSubs = (p) => (p?.subTypes || []).filter((st) => (st.status || 'Active') === 'Active');

/**
 * One field for "Particular" and its "Sub-Type".
 * One list: a particular without sub-types is chosen with one click; a particular with sub-types
 * opens in place and its sub-types are listed indented beneath it. Search looks in both.
 * `onChange({ particular, subType })`.
 */
export default function ParticularPicker({ particulars, particular, subType, onChange, hasError = false, placeholder = 'Select particular' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState('');
  const [upward, setUpward] = useState(false);
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

  const pick = (name, sub = '') => {
    onChange({ particular: name, subType: sub });
    setOpen(false);
    setQuery('');
  };

  const openBox = () => {
    const current = particulars.find((p) => p.name === particular);
    setExpanded(activeSubs(current).length ? particular : '');
    const rect = box.current?.getBoundingClientRect();
    setUpward(Boolean(rect) && window.innerHeight - rect.bottom < 320 && rect.top > 320);
    setOpen(true);
    setTimeout(() => input.current?.focus(), 0);
  };

  const onKey = (e) => {
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = rows[0];
      if (!first) return;
      if (first.subs.length === 0) pick(first.p.name);
      else if (first.shown.length) pick(first.p.name, first.shown[0].name);
    }
  };

  const chosen = particulars.find((p) => p.name === particular);
  const needsSub = activeSubs(chosen).length > 0;
  const label = particular ? `${particular}${needsSub ? ` › ${subType || 'choose sub-type'}` : ''}` : placeholder;
  const incomplete = particular && needsSub && !subType;

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openBox())}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={label}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 bg-[#FAF7F2] border rounded-xl text-xs sm:text-sm font-semibold text-left cursor-pointer transition-colors ${
          hasError ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30' : 'border-[#E8DFD8] focus:border-[#510601]'
        } ${particular && !incomplete ? 'text-[#180200]' : 'text-[#863221]/70'}`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className={`absolute z-40 w-full min-w-[280px] bg-white border border-[#E8DFD8] rounded-xl shadow-lg overflow-hidden ${
            upward ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
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
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {rows.map((r) => {
              const isOpen = r.subs.length > 0 && (q ? true : expanded === r.p.name);
              const selectedHere = r.p.name === particular;
              return (
                <li key={r.p.id || r.p.name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedHere && r.subs.length === 0}
                    aria-expanded={r.subs.length ? isOpen : undefined}
                    title={r.p.name}
                    onClick={() => (r.subs.length ? setExpanded(isOpen && !q ? '' : r.p.name) : pick(r.p.name))}
                    className={`w-full flex items-start justify-between gap-2 px-3 py-2 text-sm text-left cursor-pointer hover:bg-[#FAF7F2] ${
                      selectedHere ? 'font-bold text-[#510601]' : 'text-[#180200]'
                    }`}
                  >
                    <span className="break-words">{r.p.name}</span>
                    {r.subs.length > 0 ? (
                      isOpen ? <ChevronDown className="w-4 h-4 shrink-0 mt-0.5 text-[#863221]" /> : <ChevronRight className="w-4 h-4 shrink-0 mt-0.5 text-[#863221]" />
                    ) : (
                      selectedHere && <Check className="w-4 h-4 shrink-0 mt-0.5" />
                    )}
                  </button>
                  {isOpen && (
                    <ul className="border-l-2 border-[#E8DFD8] ml-5 mb-1">
                      {r.shown.map((st) => {
                        const on = selectedHere && st.name === subType;
                        return (
                          <li key={st.id || st.name}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={on}
                              title={st.name}
                              onClick={() => pick(r.p.name, st.name)}
                              className={`w-full flex items-start justify-between gap-2 pl-3 pr-3 py-1.5 text-sm text-left cursor-pointer hover:bg-[#FAF7F2] ${
                                on ? 'font-bold text-[#510601]' : 'text-[#180200]'
                              }`}
                            >
                              <span className="break-words">{st.name}</span>
                              {on && <Check className="w-4 h-4 shrink-0 mt-0.5" />}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
            {rows.length === 0 && <li className="px-3 py-3 text-sm text-[#863221]">Nothing found.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
