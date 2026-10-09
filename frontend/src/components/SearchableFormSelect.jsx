import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, Check, X } from 'lucide-react';

export default function SearchableFormSelect({
  value,
  onChange,
  options = [],
  placeholder = '',
  searchPlaceholder = '',
  hasError = false,
  className = '',
  disabled = false,
  showSearch = true,
  maxHeightClass = 'max-h-52'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);

  // Normalize options if passed as string array or object array
  const normalizedOptions = options.map((opt) => {
    if (typeof opt === 'object' && opt !== null) {
      return { value: opt.value ?? opt.id ?? opt.name, label: opt.label ?? opt.name ?? String(opt.value) };
    }
    return { value: opt, label: String(opt) };
  });

  // Filtered options based on search query
  const filteredOptions = normalizedOptions.filter((opt) =>
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Close when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isOpen]);

  // Focus search input on open
  useEffect(() => {
    if (isOpen && showSearch && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen, showSearch]);

  const selectedOption = normalizedOptions.find((opt) => String(opt.value) === String(value));
  const displayLabel = selectedOption ? selectedOption.label : '';

  const handleSelect = (val) => {
    onChange?.(val);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full px-3.5 py-2.5 bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border rounded-lg text-sm text-left flex items-center justify-between gap-2 shadow-2xs transition-all cursor-pointer select-none ${
          hasError
            ? 'border-red-500 ring-2 ring-red-500/20'
            : isOpen
            ? 'border-[#510601] ring-2 ring-[#510601]/20 bg-white'
            : 'border-[#DFD5CC] hover:border-[#8C1801]/60'
        } ${disabled ? 'opacity-60 cursor-not-allowed bg-stone-100' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={`truncate flex-1 ${displayLabel ? 'text-[#180200] font-medium' : 'text-[#9E8B7F]'}`}>
          {displayLabel || placeholder}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-[#863221]/70 transition-transform duration-200 shrink-0 ${
            isOpen ? 'rotate-180 text-[#510601]' : ''
          }`}
        />
      </button>

      {/* Floating Scrollable Container */}
      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white border border-[#DFD5CC] rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          style={{ minWidth: '100%' }}
        >
          {/* Optional Search bar inside dropdown */}
          {showSearch && normalizedOptions.length > 7 && (
            <div className="p-2 border-b border-[#DFD5CC]/80 bg-[#FAF7F2]/50">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#863221]/60" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-[#DFD5CC] rounded-lg text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601]"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Scrollable Options List (Bounded Height) */}
          <div className={`${maxHeightClass} overflow-y-auto divide-y divide-stone-100 overscroll-contain [scrollbar-width:thin] [scrollbar-color:#DFD5CC_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#DFD5CC] hover:[&::-webkit-scrollbar-thumb]:bg-[#863221]/50 [&::-webkit-scrollbar-track]:bg-transparent`}>
            {/* Clear / Default Option */}
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => handleSelect('')}
              className={`w-full px-3.5 py-2 text-sm text-left transition-colors flex items-center justify-between cursor-pointer ${
                !value
                  ? 'bg-[#FAF7F2] text-[#510601] font-semibold'
                  : 'text-stone-500 hover:bg-[#FAF7F2]/80 hover:text-[#510601]'
              }`}
            >
              <span>{placeholder}</span>
              {!value && <Check className="w-4 h-4 text-[#510601] shrink-0" />}
            </button>

            {filteredOptions.length === 0 ? (
              <div className="px-3.5 py-4 text-center text-xs text-stone-500">
                No matching options found
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = String(opt.value) === String(value);
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(opt.value)}
                    className={`w-full px-3.5 py-2.5 text-sm text-left transition-colors flex items-center justify-between gap-2 cursor-pointer group ${
                      isSelected
                        ? 'bg-[#FAF7F2] text-[#510601] font-bold'
                        : 'text-[#180200] hover:bg-[#FAF7F2] hover:text-[#510601]'
                    }`}
                  >
                    <span className="truncate flex-1">{opt.label}</span>
                    {isSelected && <Check className="w-4 h-4 text-[#510601] shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
