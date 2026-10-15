import React, { useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import Modal from './Modal';
import ModalFooter from './ModalFooter';

const activeSubs = (p) => (p?.subTypes || []).filter((st) => (st.status || 'Active') === 'Active');

// The key a line is known by: particular and sub-type, in lower case
export const lineKey = (particular, subType = '') =>
  `${String(particular || '').trim().toLowerCase()}::${String(subType || '').trim().toLowerCase()}`;

/**
 * ParticularPicker:
 * The form button opens one wide popup that shows every particular as a card with its sub types as buttons,
 * all at once (no tabs, no dropdown to scroll). One click on a button picks that particular + sub type and
 * closes the popup. The search box only dims what does not match; Enter picks the first match.
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
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);

  // Active particulars only (completely dynamic from the server)
  const activeParticulars = useMemo(
    () => (particulars || []).filter((p) => (p.status || 'Active') === 'Active'),
    [particulars]
  );

  // One card per particular: its sub types as buttons, or a single button when it has none
  const cards = useMemo(
    () => activeParticulars.map((p) => {
      const subs = activeSubs(p);
      const buttons = subs.length
        ? subs.map((st) => ({ id: `${p.id || p.name}-${st.id || st.name}`, title: st.name, particular: p.name, subType: st.name, key: lineKey(p.name, st.name) }))
        : [{ id: `${p.id || p.name}-root`, title: p.name, particular: p.name, subType: '', key: lineKey(p.name, '') }];
      return { name: p.name, hasSubs: subs.length > 0, buttons };
    }),
    [activeParticulars]
  );

  const q = searchQuery.trim().toLowerCase();
  const matches = (card, btn) => !q || btn.title.toLowerCase().includes(q) || card.name.toLowerCase().includes(q);
  const firstMatch = useMemo(() => {
    for (const card of cards) {
      for (const btn of card.buttons) {
        if (!takenKeys.has(btn.key) && (!q || btn.title.toLowerCase().includes(q) || card.name.toLowerCase().includes(q))) return btn;
      }
    }
    return null;
  }, [cards, q, takenKeys]);

  const handlePick = (pickedParticular, pickedSubType = '') => {
    if (takenKeys.has(lineKey(pickedParticular, pickedSubType))) return;
    onChange({ particular: pickedParticular, subType: pickedSubType });
    setOpen(false);
    setSearchQuery('');
  };

  const handleOpenModal = () => {
    setOpen(true);
    setSearchQuery('');
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (firstMatch) handlePick(firstMatch.particular, firstMatch.subType);
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

      {/* Everything at once: a card per particular, its sub types as buttons */}
      {open && (
        <Modal
          isOpen
          onClose={() => setOpen(false)}
          title="Select Receipt Particular"
          maxWidthClass="max-w-6xl"
          footer={
            <ModalFooter
              kind="view"
              onCancel={() => setOpen(false)}
              cancelLabel="Close"
              left={<span className="text-xs text-[#863221] hidden sm:inline">Click a button to pick it</span>}
            />
          }
        >
          <div className="p-4 sm:p-5 space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 text-[#863221] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type to find one (Enter picks the first match)"
                className="w-full pl-10 pr-9 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs sm:text-sm text-[#180200] placeholder-[#863221]/50 focus:outline-none focus:bg-white focus:border-[#510601] focus:ring-1 focus:ring-[#510601] transition-colors"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#863221]/60 hover:text-[#180200] p-1">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {cards.length === 0 ? (
              <p className="py-10 text-center text-sm text-[#863221]">No active particulars.</p>
            ) : (
              <div className="max-h-[75vh] overflow-y-auto columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4">
                {cards.map((card) => {
                  const cardHasMatch = card.buttons.some((b) => matches(card, b));
                  return (
                    <div
                      key={card.name}
                      className={`mb-4 break-inside-avoid rounded-xl border border-[#E8DFD8] bg-white p-3 transition-opacity ${cardHasMatch ? '' : 'opacity-30'}`}
                    >
                      <p className="mb-2 border-b border-[#E8DFD8] pb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#510601]">{card.name}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {card.buttons.map((btn) => {
                          const isTaken = takenKeys.has(btn.key);
                          const isSelected = particular === btn.particular && (subType || '') === btn.subType;
                          const dim = q && !matches(card, btn);
                          return (
                            <button
                              key={btn.id}
                              type="button"
                              disabled={isTaken}
                              onClick={() => handlePick(btn.particular, btn.subType)}
                              title={isTaken ? 'Already added on another line of this receipt' : `Select ${card.hasSubs ? `${card.name} › ` : ''}${btn.title}`}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-left text-xs font-semibold leading-snug transition-colors ${
                                isTaken
                                  ? 'cursor-not-allowed border-[#E8DFD8] bg-[#FAF7F2] text-[#863221]/50 line-through'
                                  : isSelected
                                  ? 'cursor-pointer border-[#510601] bg-[#510601] text-white'
                                  : 'cursor-pointer border-[#E8DFD8] bg-[#FAF7F2] text-[#180200] hover:border-[#510601] hover:bg-white hover:text-[#510601]'
                              } ${dim ? 'opacity-30' : ''}`}
                            >
                              {isSelected && <Check className="h-3 w-3 shrink-0" />}
                              <span>{btn.title}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
