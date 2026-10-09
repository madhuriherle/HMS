import React, { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { MENU_ICONS, MENU_ICON_NAMES } from '../utils/menuIcons';

// Pick a module's icon from a grid instead of typing its name. `value` is the icon name ('' = none).
export default function IconPicker({ value, onChange, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState('');

  const names = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? MENU_ICON_NAMES.filter((n) => n.includes(q)) : MENU_ICON_NAMES;
  }, [query]);

  const Selected = value ? MENU_ICONS[value] : null;
  const known = !value || Boolean(MENU_ICONS[value]);

  const pick = (name) => {
    onChange(name);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white border border-[#E8DFD8] hover:border-[#510601] rounded-xl text-sm text-[#180200] transition-colors cursor-pointer"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-lg bg-[#510601]/10 text-[#510601] flex items-center justify-center shrink-0">
            {Selected ? <Selected className="w-4 h-4" /> : <span className="text-[10px] font-semibold">none</span>}
          </span>
          <span className="truncate">{value ? value : 'Choose an icon'}</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-[#863221] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {!known && (
        <p className="text-[11px] text-amber-700">
          &quot;{value}&quot; has no picture in the list, so the sidebar shows a plain dot. Pick an icon below to replace it.
        </p>
      )}

      {open && (
        <div className="rounded-xl border border-[#E8DFD8] bg-white p-3 space-y-3 shadow-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#863221]/50" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white border border-[#E8DFD8] focus:border-[#510601] focus:ring-1 focus:ring-[#510601] rounded-lg text-sm text-[#180200] focus:outline-none"
              aria-label="Search icons"
            />
          </div>

          <div className="grid grid-cols-5 gap-2 max-h-56 overflow-y-auto pr-1">
            {!query.trim() && (
              <button
                type="button"
                onClick={() => pick('')}
                title="No icon"
                className={`h-11 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  !value ? 'bg-[#510601] border-[#510601] text-white' : 'bg-[#FAF7F2] border-[#E8DFD8] text-[#510601] hover:border-[#510601]'
                }`}
              >
                None
              </button>
            )}
            {names.map((name) => {
              const Icon = MENU_ICONS[name];
              const on = name === value;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => pick(name)}
                  title={name}
                  aria-label={name}
                  className={`h-11 rounded-lg border flex items-center justify-center transition-colors cursor-pointer ${
                    on ? 'bg-[#510601] border-[#510601] text-white' : 'bg-white border-[#E8DFD8] text-[#510601] hover:bg-[#FAF7F2] hover:border-[#510601]'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </button>
              );
            })}
          </div>
          {names.length === 0 && <p className="text-xs text-[#863221] text-center py-2">No icon matches &quot;{query}&quot;.</p>}
        </div>
      )}
    </div>
  );
}
