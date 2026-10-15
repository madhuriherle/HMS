import React from 'react';

// Page controls for a list the server pages: "Showing 1-25 of 480", rows per page (never more than 200), 1 2 ... N.
export const PAGE_SIZES = [25, 50, 100, 200];

export default function Pager({ page, pages, total, pageSize, onPage, onPageSize, sizes = PAGE_SIZES }) {
  if (!total) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const numbers = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#863221]">
      <span>
        Showing <strong className="text-[#180200]">{first}</strong>–<strong className="text-[#180200]">{last}</strong> of{' '}
        <strong className="text-[#180200]">{total}</strong>
      </span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="px-2 py-1 bg-white border border-[#E8DFD8] rounded-lg text-xs cursor-pointer"
          >
            {sizes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}
            className="px-2 py-1 rounded-lg border border-[#E8DFD8] bg-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed" title="Previous page">‹</button>
          {numbers.map((n, i) => (
            <React.Fragment key={n}>
              {i > 0 && n - numbers[i - 1] > 1 && <span className="px-1">…</span>}
              <button type="button" onClick={() => onPage(n)}
                className={`min-w-[28px] px-2 py-1 rounded-lg border cursor-pointer ${n === page ? 'bg-[#510601] text-white border-[#510601]' : 'bg-white border-[#E8DFD8]'}`}>{n}</button>
            </React.Fragment>
          ))}
          <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}
            className="px-2 py-1 rounded-lg border border-[#E8DFD8] bg-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed" title="Next page">›</button>
        </div>
      </div>
    </div>
  );
}
