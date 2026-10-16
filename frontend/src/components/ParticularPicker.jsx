import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

  // Every particular is a card of the same width, in the order given. One with sub types is headed by its name and holds
  // its sub types as rows; one without sub types is a small card that is just its name, clickable.
  const cards = useMemo(() => activeParticulars.map((p) => {
    const subs = activeSubs(p);
    if (subs.length) {
      return {
        name: p.name,
        hasSubs: true,
        buttons: subs.map((st) => ({ id: `${p.id || p.name}-${st.id || st.name}`, title: st.name, particular: p.name, subType: st.name, key: lineKey(p.name, st.name) })),
      };
    }
    return { name: p.name, hasSubs: false, single: true, buttons: [{ id: `${p.id || p.name}-root`, title: p.name, particular: p.name, subType: '', key: lineKey(p.name, '') }] };
  }), [activeParticulars]);

  // The cards flow down a column until its height is full, then the rest continues in the next column (the browser
  // lays them out: columns of one fixed width, a card is never cut in two). If that would need more columns than fit
  // the width, the cards are spread evenly over the columns instead and the popup scrolls up and down.
  const widthNow = () => (typeof window === 'undefined' ? 1400 : window.innerWidth);
  const columnsFor = (w) => (w >= 1280 ? 4 : w >= 1024 ? 3 : w >= 640 ? 2 : 1);
  const [screenWidth, setScreenWidth] = useState(widthNow);
  useEffect(() => {
    const onResize = () => setScreenWidth(widthNow());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const columnCount = columnsFor(screenWidth);
  const wrapRef = useRef(null);
  const flowRef = useRef(null);
  const [wrapHeight, setWrapHeight] = useState(0);
  const [flow, setFlow] = useState('height'); // 'height': fill each column to the popup's height; 'balanced': it would not fit
  useLayoutEffect(() => {
    if (!open) return;
    if (wrapRef.current) setWrapHeight(wrapRef.current.clientHeight);
    setFlow('height');
  }, [open, cards, screenWidth, columnCount]);
  useLayoutEffect(() => {
    const el = flowRef.current;
    if (open && flow === 'height' && el && el.scrollWidth > el.clientWidth + 2) setFlow('balanced');
  });

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

  // one pick button (a head, or a sub type inside a card)
  const pickButton = (btn, card, isHead = false) => {
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
        className={`items-center gap-1 text-left break-words leading-snug transition-colors ${
          isHead
            ? 'flex w-full rounded-md px-1 py-0.5 text-[11px] font-bold uppercase tracking-wider'
            : 'flex w-full rounded-md px-2 py-1 text-xs font-semibold hover:bg-[#FAF7F2]'
        } ${
          isTaken
            ? 'cursor-not-allowed text-[#863221]/50 line-through'
            : isSelected
            ? 'cursor-pointer !border-[#510601] bg-[#510601] text-white hover:!bg-[#510601]'
            : `cursor-pointer hover:border-[#510601] hover:text-[#510601] ${isHead ? 'text-[#510601]' : 'text-[#180200]'}`
        } ${dim ? 'opacity-30' : ''}`}
      >
        {isSelected && <Check className="h-3 w-3 shrink-0" />}
        <span>{btn.title}</span>
      </button>
    );
  };

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
          maxWidthClass="max-w-[1500px]"
          heightClass="h-[95vh]"
          maxHeightClass="max-h-[95vh]"
          footer={
            <ModalFooter
              kind="view"
              onCancel={() => setOpen(false)}
              cancelLabel="Close"
              left={<span className="text-xs text-[#863221] hidden sm:inline">Click a button to pick it</span>}
            />
          }
        >
          <div className="p-4 sm:p-5 space-y-4 flex flex-col flex-1 min-h-0">
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
              <div ref={wrapRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                <div
                  ref={flowRef}
                  style={{
                    columnCount,
                    columnGap: '12px',
                    columnFill: flow === 'height' ? 'auto' : 'balance',
                    height: flow === 'height' && wrapHeight ? `${wrapHeight}px` : 'auto',
                  }}
                >
                  {cards.map((card) => {
                    const cardHasMatch = card.buttons.some((b) => matches(card, b));
                    return (
                      <div
                        key={card.name}
                        className={`mb-3 min-w-0 rounded-xl border border-[#B8A89B] p-3 transition-opacity ${cardHasMatch ? '' : 'opacity-30'}`}
                        style={{ breakInside: 'avoid' }}
                      >
                        {card.single ? (
                          pickButton(card.buttons[0], card, true)
                        ) : (
                          <>
                            <p className="mb-2 border-b border-[#CDBFB3] pb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#510601]">{card.name}</p>
                            <div className="flex flex-col gap-0.5">
                              {card.buttons.map((btn) => pickButton(btn, card))}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
