import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';

/**
 * The rare filters of a list screen behind one "More" button, so the card of filters stays in ONE line. The button shows how many
 * of them are on; the filters open in a small panel under it (each one full width). Put the filters you use most in the line itself.
 */
export default function FilterMore({ count = 0, label = 'More', children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`relative h-9 px-3 rounded-xl border text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs ${
          open || count > 0 ? 'border-[#510601] text-[#510601] bg-[#FAF7F2]' : 'border-[#E8DFD8] text-[#863221] bg-white hover:bg-[#FAF7F2]'
        }`}
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        <span>{label}</span>
        {count > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#ED4636] text-white text-[10px] font-bold flex items-center justify-center">{count}</span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-40 w-64 bg-white border border-[#E8DFD8] rounded-xl shadow-lg p-3 space-y-2.5 [&>*]:!w-full">
          {children}
        </div>
      )}
    </div>
  );
}
