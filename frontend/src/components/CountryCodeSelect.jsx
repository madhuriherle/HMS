import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';
import { COUNTRY_CODES } from '../utils/countryCodes';

export default function CountryCodeSelect({
  value = '+91',
  countryIso = 'IN',
  onChange,
  disabled = false,
  className = ''
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);

  // Find currently selected country
  const selectedCountry = useMemo(() => {
    return (
      COUNTRY_CODES.find((c) => c.code === countryIso) ||
      COUNTRY_CODES.find((c) => c.dialCode === value) ||
      COUNTRY_CODES[0]
    );
  }, [countryIso, value]);

  // Filtered countries list based on search
  const filteredCountries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return COUNTRY_CODES;
    return COUNTRY_CODES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.dialCode.includes(q)
    );
  }, [searchQuery]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Focus search input on open
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  const handleSelect = (country) => {
    if (onChange) {
      onChange({
        dialCode: country.dialCode,
        countryIso: country.code,
        countryName: country.name
      });
    }
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between gap-1.5 px-3 py-2.5 border rounded-lg text-xs sm:text-sm text-[#180200] transition-all ${
          disabled
            ? 'bg-stone-100 text-stone-400 border-[#DFD5CC] cursor-not-allowed'
            : 'bg-[#FAF7F2] hover:bg-[#FDFBF7] focus:bg-white border-[#DFD5CC] hover:border-[#8C1801]/60 cursor-pointer focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20 shadow-2xs'
        }`}
        title={`${selectedCountry.name} (${selectedCountry.dialCode})`}
      >
        <span className="flex items-center gap-1.5 truncate">
          <span className="text-base leading-none">{selectedCountry.flag}</span>
          <span className="font-semibold">{selectedCountry.dialCode}</span>
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-[#863221]/70 shrink-0" />
      </button>

      {/* Searchable Dropdown Popup */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-white border border-[#DFD5CC] rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150 flex flex-col">
          {/* Search Header */}
          <div className="p-2 border-b border-[#DFD5CC] bg-[#FAF7F2] shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#863221]/60" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-white border border-[#DFD5CC] rounded-lg text-[#180200] placeholder:text-[#9E8B7F] focus:outline-none focus:border-[#510601] focus:ring-2 focus:ring-[#510601]/20"
              />
            </div>
          </div>

          {/* Countries List - Inner Scrollable Container */}
          <div className="max-h-52 overflow-y-auto overscroll-contain p-1.5 space-y-0.5 [scrollbar-width:thin] [scrollbar-color:#DFD5CC_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#DFD5CC] hover:[&::-webkit-scrollbar-thumb]:bg-[#863221]/50 [&::-webkit-scrollbar-track]:bg-transparent">
            {filteredCountries.length === 0 ? (
              <div className="p-3 text-center text-xs text-[#863221]">
                No country found
              </div>
            ) : (
              filteredCountries.map((country) => {
                const isSelected = country.code === selectedCountry.code;
                return (
                  <button
                    key={country.code}
                    type="button"
                    onClick={() => handleSelect(country)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#FAF7F2] text-[#510601] font-semibold border border-[#510601]/20'
                        : 'text-[#180200] hover:bg-[#FAF7F2]/80'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-base leading-none shrink-0">{country.flag}</span>
                      <span className="truncate">{country.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 font-mono text-xs text-[#863221]">
                      <span>{country.dialCode}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-[#510601]" />}
                    </div>
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
