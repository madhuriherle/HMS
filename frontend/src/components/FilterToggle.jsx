import React from 'react';
import { SlidersHorizontal } from 'lucide-react';

/**
 * The filter icon is gone: every list screen shows its filters in their card all the time (the owner's rule). The component stays so
 * the screens that still render it keep working; it draws nothing.
 */
export default function FilterToggle() {
  return null;
}

/** A card of filters, always shown. `extra` puts other small buttons above it, right-aligned. `className` styles the card itself. */
export function FilterCard({ className = '', extra = null, children }) {
  return (
    <div className="space-y-3">
      {extra && <div className="flex items-center justify-end gap-2">{extra}</div>}
      <div className={className}>{children}</div>
    </div>
  );
}

/** Filters that sit inline in a toolbar row: always shown. */
export function FilterInline({ children }) {
  return <>{children}</>;
}
