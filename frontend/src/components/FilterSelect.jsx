import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export default function FilterSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Select...',
  className = '',
  widthClass = 'w-44 sm:w-48'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isOpen]);

  // Find current option label
  const selectedOption = options.find((opt) => String(opt.value) === String(value));
  const displayLabel = selectedOption ? selectedOption.label : placeholder;

  return (
    <div ref={containerRef} className={`relative inline-block ${widthClass} ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full py-2 px-3 text-xs font-medium bg-[#FAF7F2]/60 hover:bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl focus:outline-none focus:border-[#510601] focus:ring-1 focus:ring-[#510601] text-[#180200] cursor-pointer transition-colors shadow-2xs flex items-center justify-between gap-2 text-left ${
          isOpen ? 'border-[#510601] ring-1 ring-[#510601]' : ''
        }`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="truncate flex-1">{displayLabel}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[#863221]/70 transition-transform duration-200 shrink-0 ${
            isOpen ? 'rotate-180 text-[#510601]' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu (Fixed Max Height with Scrollbar) */}
      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1.5 z-50 w-full min-w-[180px] bg-white border border-[#E8DFD8] rounded-xl shadow-lg max-h-52 overflow-y-auto py-1 animate-in fade-in zoom-in-95 duration-150"
        >
          {options.map((opt) => {
            const isSelected = String(opt.value) === String(value);
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange?.(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full px-3 py-2 text-xs text-left cursor-pointer flex items-center justify-between gap-2 transition-colors ${
                  isSelected
                    ? 'bg-[#FAF7F2] text-[#510601] font-bold'
                    : 'text-[#180200] hover:bg-[#FAF7F2]/80 hover:text-[#510601]'
                }`}
              >
                <span className="truncate flex-1">{opt.label}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-[#510601] shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
