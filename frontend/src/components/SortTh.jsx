import React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

// A table heading that sorts its column on the server when clicked (asc, desc, then the default order).
export default function SortTh({ label, field, sort, onSort, className = '' }) {
  const active = sort.by === field;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(field)}
        title={`Sort by ${label}`}
        className={`inline-flex items-center gap-1 uppercase font-bold tracking-wider cursor-pointer hover:text-[#510601] ${active ? 'text-[#510601]' : ''}`}
      >
        <span>{label}</span>
        <Icon className={`w-3 h-3 ${active ? '' : 'opacity-40'}`} />
      </button>
    </th>
  );
}
