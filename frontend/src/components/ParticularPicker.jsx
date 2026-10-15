import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import Modal from './Modal';
import ModalFooter from './ModalFooter';

const activeSubs = (p) => (p?.subTypes || []).filter((st) => (st.status || 'Active') === 'Active');

// The key a line is known by: particular and sub-type, in lower case
export const lineKey = (particular, subType = '') =>
  `${String(particular || '').trim().toLowerCase()}::${String(subType || '').trim().toLowerCase()}`;

/**
 * ParticularPicker:
 * Form button opens a spacious, horizontal-tabbed modal dialog.
 * Dynamic categories (Horizontal Tabs) + 3-column responsive tile grid of all items / sub-types ("members").
 * Instant 1-click selection: clicking any card immediately selects that Particular + SubType and closes the modal.
 * Real-time search across all particulars and sub-types.
 */
export default function ParticularPicker({
  particulars = [],
  particular = '',
  subType = '',
  onChange,
  hasError = false,
  placeholder = 'Select particular',
  spread = false,
  taken = []
}) {
  const takenKeys = useMemo(() => new Set(taken), [taken]);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);

  // Active particulars only (completely dynamic from the server)
  const activeParticulars = useMemo(
    () => (particulars || []).filter((p) => (p.status || 'Active') === 'Active'),
    [particulars]
  );

  // Flatten into selectable items: each sub-type or standalone parent particular
  const allItems = useMemo(() => {
    const items = [];
    activeParticulars.forEach((p) => {
      const subs = activeSubs(p);
      if (subs.length > 0) {
        subs.forEach((st) => {
          items.push({
            id: `${p.id || p.name}-${st.id || st.name}`,
            title: st.name,
            particular: p.name,
            subType: st.name,
            category: p.name,
            key: lineKey(p.name, st.name),
          });
        });
      } else {
        items.push({
          id: `${p.id || p.name}-root`,
          title: p.name,
          particular: p.name,
          subType: '',
          category: p.name,
          key: lineKey(p.name, ''),
        });
      }
    });
    return items;
  }, [activeParticulars]);

  // Categories for Horizontal Tabs with dynamic item counts
  const categories = useMemo(() => {
    const list = [{ key: 'ALL', name: 'All', count: allItems.length }];
    activeParticulars.forEach((p) => {
      const count = allItems.filter((it) => it.particular === p.name).length;
      if (count > 0) {
        list.push({ key: p.name, name: p.name, count });
      }
    });
    return list;
  }, [activeParticulars, allItems]);

  // Filter items based on activeTab and searchQuery
  const q = searchQuery.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      if (activeTab !== 'ALL' && item.particular !== activeTab) {
        return false;
      }
      if (q) {
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesCat = item.category.toLowerCase().includes(q);
        return matchesTitle || matchesCat;
      }
      return true;
    });
  }, [allItems, activeTab, q]);

  // Group filtered items by category for structured display when "ALL" tab is selected
  const groupedSections = useMemo(() => {
    if (activeTab !== 'ALL' || q) {
      return [{ category: activeTab === 'ALL' ? 'Search Results' : activeTab, items: filteredItems }];
    }
    const groups = [];
    activeParticulars.forEach((p) => {
      const itemsInGroup = filteredItems.filter((it) => it.particular === p.name);
      if (itemsInGroup.length > 0) {
        groups.push({ category: p.name, items: itemsInGroup });
      }
    });
    return groups;
  }, [activeTab, q, filteredItems, activeParticulars]);

  const handlePick = (pickedParticular, pickedSubType = '') => {
    if (takenKeys.has(lineKey(pickedParticular, pickedSubType))) return;
    onChange({ particular: pickedParticular, subType: pickedSubType });
    setOpen(false);
    setSearchQuery('');
  };

  const handleOpenModal = () => {
    setOpen(true);
    setSearchQuery('');
    // Auto-select the tab matching the current particular if available
    if (particular && activeParticulars.some((p) => p.name === particular)) {
      setActiveTab(particular);
    } else {
      setActiveTab('ALL');
    }
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const firstEnabled = filteredItems.find((it) => !takenKeys.has(it.key));
      if (firstEnabled) {
        handlePick(firstEnabled.particular, firstEnabled.subType);
      }
    }
  };

  // Display label on the closed form button
  const chosenParticular = activeParticulars.find((p) => p.name === particular);
  const needsSub = activeSubs(chosenParticular).length > 0;
  const label = particular
    ? `${particular}${needsSub ? ` › ${subType || 'choose sub-type'}` : ''}`
    : placeholder;
  const isIncomplete = particular && needsSub && !subType;

  return (
    <div className={spread ? 'w-full' : 'relative w-full'}>
      {/* Trigger Button inside Receipt Form */}
      <button
        type="button"
        onClick={handleOpenModal}
        title={label}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 bg-[#FAF7F2] border rounded-xl text-xs sm:text-sm font-semibold text-left cursor-pointer transition-colors ${
          hasError
            ? 'border-[#ED4636] ring-1 ring-[#ED4636]/30'
            : 'border-[#E8DFD8] hover:border-[#510601] focus:border-[#510601]'
        } ${particular && !isIncomplete ? 'text-[#180200]' : 'text-[#863221]/70'}`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="w-4 h-4 shrink-0 text-[#863221]" />
      </button>

      {/* Horizontal Tabs Modal Picker */}
      {open && (
        <Modal
          isOpen
          onClose={() => setOpen(false)}
          title="Select Receipt Particular"
          maxWidthClass="max-w-4xl"
          footer={
            <ModalFooter
              kind="view"
              onCancel={() => setOpen(false)}
              cancelLabel="Close"
              left={
                <span className="text-xs text-[#863221] hidden sm:inline">
                  Click any tile to select instantly and return to receipt form
                </span>
              }
            />
          }
        >
          <div className="p-4 sm:p-5 space-y-4">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-[#863221] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search particular, sub-type, or keyword (press Enter to pick first)..."
                className="w-full pl-10 pr-9 py-2.5 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs sm:text-sm text-[#180200] placeholder-[#863221]/50 focus:outline-none focus:bg-white focus:border-[#510601] focus:ring-1 focus:ring-[#510601] transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#863221]/60 hover:text-[#180200] p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Horizontal Category Tabs Bar */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin border-b border-[#E8DFD8]">
              {categories.map((cat) => {
                const isActive = activeTab === cat.key;
                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => {
                      setActiveTab(cat.key);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                      isActive
                        ? 'bg-[#510601] text-white shadow-sm'
                        : 'bg-[#FAF7F2] text-[#863221] border border-[#E8DFD8] hover:bg-white hover:text-[#510601] hover:border-[#510601]'
                    }`}
                  >
                    <span>{cat.name}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                        isActive ? 'bg-white/20 text-white' : 'bg-[#E8DFD8]/60 text-[#863221]'
                      }`}
                    >
                      {cat.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Tiles Grid Container */}
            <div className="max-h-[50vh] overflow-y-auto pr-1 space-y-4">
              {filteredItems.length === 0 ? (
                <div className="py-12 text-center text-[#863221]">
                  <p className="font-semibold text-sm text-[#180200]">No matching particulars found</p>
                  <p className="text-xs mt-1">
                    {searchQuery
                      ? `No items match “${searchQuery}”. Try clearing the search or checking another tab.`
                      : 'No active items available in this category.'}
                  </p>
                </div>
              ) : (
                groupedSections.map((group) => (
                  <div key={group.category} className="space-y-2">
                    {/* Section Header (when in ALL tab with multiple groups) */}
                    {activeTab === 'ALL' && !q && (
                      <div className="flex items-center justify-between border-b border-[#E8DFD8] pb-1 pt-1">
                        <span className="text-[11px] font-bold text-[#510601] uppercase tracking-wider">
                          {group.category}
                        </span>
                        <span className="text-[10px] font-mono text-[#863221] font-semibold">
                          {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
                        </span>
                      </div>
                    )}

                    {/* 3-Column Tiles Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                      {group.items.map((item) => {
                        const isTaken = takenKeys.has(item.key);
                        const isSelected =
                          particular === item.particular && (subType || '') === item.subType;

                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={isTaken}
                            onClick={() => handlePick(item.particular, item.subType)}
                            title={
                              isTaken
                                ? 'Already added on another line of this receipt'
                                : `Select ${item.title}`
                            }
                            className={`group relative flex flex-col justify-between p-3 rounded-xl border text-left transition-all cursor-pointer min-h-[72px] ${
                              isTaken
                                ? 'opacity-40 bg-[#FAF7F2] border-[#E8DFD8] cursor-not-allowed'
                                : isSelected
                                ? 'bg-[#FAF7F2] border-[#510601] ring-2 ring-[#510601]/20 shadow-sm'
                                : 'bg-white border-[#E8DFD8] hover:border-[#510601] hover:bg-[#FAF7F2]/50 hover:shadow-sm'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2 w-full">
                              <span
                                className={`text-xs font-bold leading-snug line-clamp-2 ${
                                  isSelected
                                    ? 'text-[#510601]'
                                    : isTaken
                                    ? 'text-[#863221]'
                                    : 'text-[#180200] group-hover:text-[#510601]'
                                }`}
                              >
                                {item.title}
                              </span>
                              {isSelected && (
                                <span className="w-4 h-4 rounded-full bg-[#510601] text-white flex items-center justify-center shrink-0">
                                  <Check className="w-2.5 h-2.5" />
                                </span>
                              )}
                            </div>

                            <div className="flex items-center justify-between gap-2 mt-2 pt-1 border-t border-[#E8DFD8]/60 w-full text-[10px]">
                              <span className="text-[#863221] font-medium truncate">
                                {item.category}
                              </span>
                              {isTaken && (
                                <span className="font-semibold text-[#ED4636] shrink-0">
                                  already added
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
