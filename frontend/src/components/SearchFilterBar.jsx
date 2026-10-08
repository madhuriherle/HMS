import React, { useState } from 'react';
import { Search, SlidersHorizontal, X, RotateCcw } from 'lucide-react';

export default function SearchFilterBar({
  title,
  breadcrumb,
  searchQuery = '',
  onSearchChange,
  searchPlaceholder = 'Search...',
  activeFiltersCount = 0,
  onResetFilters,
  children,
  rightSlot,
  leftSlot,
  className = ''
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`space-y-3 w-full ${className}`}>
      {/* Optional Breadcrumb */}
      {breadcrumb && (
        <div>
          {breadcrumb}
        </div>
      )}

      {/* Main Header Row: Title on Left, [ Search ] [ Filter Icon ] [ Action Buttons ] on Right */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 sm:gap-4">
        {/* Title / Left Area */}
        {(title || leftSlot) ? (
          <div className="flex items-center gap-3 min-w-0">
            {typeof title === 'string' ? (
              <h1 className="text-2xl font-bold text-[#180200] tracking-tight">{title}</h1>
            ) : (
              title
            )}
            {leftSlot}
          </div>
        ) : (
          <div />
        )}

        {/* Right Controls: [ 🔍 Search... ] [ 🎛️ ] [ Action Buttons ] */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 ml-auto w-full lg:w-auto justify-end">
          {/* Search Box */}
          <div className="relative w-full sm:w-60 md:w-64 min-w-0">
            <Search className="w-4 h-4 text-[#863221]/50 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full pl-9 pr-8 py-2 text-xs sm:text-sm bg-white border border-[#E8DFD8] rounded-xl focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] text-[#180200] placeholder-[#863221]/40 transition-colors shadow-2xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange?.('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-[#510601] p-0.5 rounded-md hover:bg-stone-100 transition-colors cursor-pointer"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filter Toggle Button (Border-free as requested) */}
          {children && (
            <button
              type="button"
              onClick={() => setIsOpen((prev) => !prev)}
              className={`relative h-9.5 w-9.5 flex items-center justify-center rounded-xl transition-all cursor-pointer shrink-0 ${
                isOpen || activeFiltersCount > 0
                  ? 'bg-[#FAF7F2] text-[#510601] font-bold'
                  : 'text-[#863221] hover:bg-[#FAF7F2] hover:text-[#510601]'
              }`}
              title={isOpen ? 'Hide Filters' : 'Show Filters'}
              aria-expanded={isOpen}
            >
              <SlidersHorizontal className="w-4 h-4" />
              {activeFiltersCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#ED4636] text-white text-[9px] font-bold flex items-center justify-center shadow-xs">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          )}

          {/* Right Action Buttons Slot */}
          {rightSlot && (
            <div className="flex items-center gap-2.5 shrink-0">
              {rightSlot}
            </div>
          )}
        </div>
      </div>

      {/* Collapsible Horizontal Filter Drawer (Shown below when Filter icon is clicked) */}
      {isOpen && children && (
        <div className="bg-white rounded-2xl border border-[#E8DFD8] p-3 sm:p-3.5 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            {children}

            {onResetFilters && (
              <button
                type="button"
                onClick={onResetFilters}
                className="px-3 py-2 text-xs font-semibold text-[#863221] hover:text-[#ED4636] hover:bg-red-50 rounded-xl border border-[#E8DFD8] hover:border-red-200 transition-colors cursor-pointer inline-flex items-center gap-1.5 ml-auto shrink-0 shadow-2xs"
                title="Reset all filters"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Filters</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
