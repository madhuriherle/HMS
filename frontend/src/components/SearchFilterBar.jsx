import React, { useState } from 'react';
import { Search, X, RotateCcw, SlidersHorizontal } from 'lucide-react';
import PageTitle from './PageTitle';

/**
 * The toolbar of a list screen. The title goes to the top bar; the search box, the filter icon and the action buttons sit
 * in one row. The filters (the dropdowns and one reset icon) are hidden until the filter icon is clicked, and then they
 * open in the SAME row; the search box steps aside while they are open unless the screen is wide enough for both.
 */
export default function SearchFilterBar({
  title,
  breadcrumb,
  searchQuery = '',
  onSearchChange,
  searchPlaceholder = '',
  activeFiltersCount = 0,
  onResetFilters,
  children,
  rightSlot,
  leftSlot,
  searchInHeader = false, // kept for the screens that pass it: the search box is always in the toolbar row now
  filtersAlwaysShown = false, // the filters are open all the time, in a row under the toolbar (no filter icon)
  className = ''
}) {
  const [filtersToggled, setFiltersOpen] = useState(false);
  const hasFilters = Boolean(children) || Boolean(onResetFilters);
  const filtersOpen = !filtersAlwaysShown && filtersToggled;

  const searchBox = onSearchChange !== undefined && (
    <div className={filtersOpen ? 'hidden 2xl:block relative min-w-[200px] flex-1 max-w-sm' : 'relative min-w-[200px] flex-1 max-w-sm'}>
      <Search className="w-4 h-4 text-[#863221]/50 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder || 'Search...'}
        className="w-full pl-10 pr-9 py-2 text-sm bg-white border border-[#E8DFD8] rounded-xl focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] text-[#180200] placeholder-[#863221]/40 transition-colors shadow-sm"
      />
      {searchQuery && (
        <button
          type="button"
          onClick={() => onSearchChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-[#510601] p-0.5 rounded-md hover:bg-stone-100 transition-colors cursor-pointer"
          title="Clear search"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );

  const filterButton = hasFilters && !filtersAlwaysShown && (
    <button
      type="button"
      onClick={() => setFiltersOpen((open) => !open)}
      aria-expanded={filtersOpen}
      title={filtersOpen ? 'Hide the filters' : 'Show the filters'}
      className={`relative w-9 h-9 rounded-xl border flex items-center justify-center cursor-pointer transition-colors shadow-2xs shrink-0 ${
        filtersOpen
          ? 'bg-[#510601] border-[#510601] text-white'
          : 'bg-white border-[#E8DFD8] text-[#863221] hover:bg-[#FAF7F2] hover:border-[#863221]'
      }`}
    >
      <SlidersHorizontal className="w-4 h-4" />
      {activeFiltersCount > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ED4636] text-white text-[10px] font-bold flex items-center justify-center">
          {activeFiltersCount}
        </span>
      )}
    </button>
  );

  const showToolbar = Boolean(leftSlot || rightSlot || searchBox || filterButton);

  return (
    <div className={`space-y-4 w-full ${className}`}>
      {/* Send page title to the sticky top bar header */}
      {title && <PageTitle>{title}</PageTitle>}

      {/* Optional Breadcrumb */}
      {breadcrumb && <div>{breadcrumb}</div>}

      {/* Toolbar row: left slot on the left; search, the filter icon and the action buttons on the right */}
      {showToolbar && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-3 min-w-0">{leftSlot}</div>
          {(searchBox || filterButton || rightSlot) && (
            <div className="flex items-center gap-2.5 flex-wrap justify-end ml-auto">
              {hasFilters && filtersOpen && (
                <>
                  {children}
                  {onResetFilters && (
                    <button
                      type="button"
                      onClick={onResetFilters}
                      className="flex items-center justify-center w-9 h-9 bg-white border border-[#E8DFD8] text-[#863221] rounded-xl hover:bg-red-50 hover:text-[#ED4636] hover:border-red-200 transition-colors cursor-pointer shrink-0 shadow-2xs"
                      title="Reset all filters"
                      aria-label="Reset all filters"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}
              {searchBox}
              {filterButton}
              {rightSlot}
            </div>
          )}
        </div>
      )}

      {/* Always-shown filters: their own row under the toolbar, one reset icon at the end */}
      {hasFilters && filtersAlwaysShown && (
        <div className="flex items-center gap-2.5 flex-wrap">
          {children}
          {onResetFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="flex items-center justify-center w-9 h-9 bg-white border border-[#E8DFD8] text-[#863221] rounded-xl hover:bg-red-50 hover:text-[#ED4636] hover:border-red-200 transition-colors cursor-pointer shrink-0 shadow-2xs"
              title="Reset all filters"
              aria-label="Reset all filters"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
