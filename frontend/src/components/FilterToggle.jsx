import React from 'react';
import { SlidersHorizontal } from 'lucide-react';

/** The filter icon button used on every list screen: it shows or hides that screen's filters. `count` is how many are on. */
export default function FilterToggle({ open, onToggle, count = 0, className = '' }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title={open ? 'Hide the filters' : 'Show the filters'}
      className={`relative w-9 h-9 rounded-xl border flex items-center justify-center cursor-pointer transition-colors shadow-2xs shrink-0 ${
        open ? 'bg-[#510601] border-[#510601] text-white' : 'bg-white border-[#E8DFD8] text-[#863221] hover:bg-[#FAF7F2] hover:border-[#863221]'
      } ${className}`}
    >
      <SlidersHorizontal className="w-4 h-4" />
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ED4636] text-white text-[10px] font-bold flex items-center justify-center">
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * A card of filters that is hidden until the filter icon is clicked. The icon sits right-aligned just above where the
 * card opens; `extra` puts other small buttons beside it. `className` styles the card itself.
 */
export function FilterCard({ count = 0, className = '', extra = null, children }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        {extra}
        <FilterToggle open={open} onToggle={() => setOpen((o) => !o)} count={count} />
      </div>
      {open && <div className={className}>{children}</div>}
    </div>
  );
}

/**
 * Filters that sit inline in a toolbar row: only the filter icon shows until it is clicked, then the filters appear
 * right after it. Used where the page already has its own row of search box and buttons.
 */
export function FilterInline({ count = 0, children }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <FilterToggle open={open} onToggle={() => setOpen((o) => !o)} count={count} />
      {open && children}
    </>
  );
}
