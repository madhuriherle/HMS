import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Search } from 'lucide-react';

const activeSubs = (p) => (p?.subTypes || []).filter((st) => (st.status || 'Active') === 'Active');

/**
 * One field for "Particular" and its "Sub-Type".
 * One list: a particular without sub-types is chosen with one click; a particular with sub-types
 * shows its sub-types indented beneath it, all open by default (the arrow folds one away). Search looks in both.
 * The list always opens downward and is only as tall as the room below the field (it scrolls inside).
 * `onChange({ particular, subType })`. With `spread` the list is as wide as the whole row it sits in
 * (the parent row must be `relative`), instead of only as wide as the field.
 */
// the key a line is known by: particular and sub-type, in lower case
export const lineKey = (particular, subType = '') => `${String(particular || '').trim().toLowerCase()}::${String(subType || '').trim().toLowerCase()}`;

export default function ParticularPicker({ particulars, particular, subType, onChange, hasError = false, placeholder = 'Select particular', spread = false, taken = [] }) {
  // particular + sub-type choices already used on the OTHER lines of the receipt: they cannot be picked again
  const takenKeys = new Set(taken);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [folded, setFolded] = useState(() => new Set()); // particulars whose sub-types are folded away
  const [listMax, setListMax] = useState(288);
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
    setFolded(new Set());
    setOpen(true);
    setTimeout(() => input.current?.focus(), 0);
    // keep the list below the field: scroll the field up if there is little room, then size the list to the room left
    const room = () => window.innerHeight - (box.current?.getBoundingClientRect().bottom || 0) - 12;
    if (room() < 260) box.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setTimeout(() => setListMax(Math.max(150, Math.min(288, room() - 56))), 300);
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
    <div className={spread ? '' : 'relative'} ref={box}>
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
          className={`absolute z-40 ${spread ? 'left-0 right-0' : 'w-full min-w-[280px]'} bg-white border border-[#E8DFD8] rounded-xl shadow-lg overflow-hidden ${
            'top-full mt-1'
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
          <ul role="listbox" className="overflow-y-auto py-1" style={{ maxHeight: listMax }}>
            {rows.map((r) => {
              const isOpen = r.subs.length > 0 && (q ? true : !folded.has(r.p.name));
              const selectedHere = r.p.name === particular;
              return (
                <li key={r.p.id || r.p.name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedHere && r.subs.length === 0}
                    aria-expanded={r.subs.length ? isOpen : undefined}
                    title={r.p.name}
                    onClick={() => {
                      if (!r.subs.length) return takenKeys.has(lineKey(r.p.name)) ? undefined : pick(r.p.name);
                      setFolded((prev) => {
                        const next = new Set(prev);
                        if (next.has(r.p.name)) next.delete(r.p.name); else next.add(r.p.name);
                        return next;
                      });
                    }}
                    className={`w-full flex items-start justify-between gap-2 px-3 py-2 text-sm text-left ${
                      !r.subs.length && takenKeys.has(lineKey(r.p.name))
                        ? 'text-[#863221]/40 cursor-not-allowed'
                        : `cursor-pointer hover:bg-[#FAF7F2] ${selectedHere ? 'font-bold text-[#510601]' : 'text-[#180200]'}`
                    }`}
                  >
                    <span className="break-words">{r.p.name}{!r.subs.length && takenKeys.has(lineKey(r.p.name)) && <span className="ml-2 text-[10px] font-semibold">already added</span>}</span>
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
                        const used = takenKeys.has(lineKey(r.p.name, st.name));
                        return (
                          <li key={st.id || st.name}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={on}
                              title={st.name}
                              onClick={() => (used ? undefined : pick(r.p.name, st.name))}
                              className={`w-full flex items-start justify-between gap-2 pl-3 pr-3 py-1.5 text-sm text-left ${
                                used
                                  ? 'text-[#863221]/40 cursor-not-allowed'
                                  : `cursor-pointer hover:bg-[#FAF7F2] ${on ? 'font-bold text-[#510601]' : 'text-[#180200]'}`
                              }`}
                            >
                              <span className="break-words">{st.name}{used && <span className="ml-2 text-[10px] font-semibold">already added</span>}</span>
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
