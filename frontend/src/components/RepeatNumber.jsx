import React from 'react';

// A register number used again keeps a tail: 32170, 32170/2, 32170/3 ...
export const splitRepeat = (number) => {
  const m = /^(.+)\/(\d+)$/.exec(String(number || ''));
  return m ? { base: m[1], tail: Number(m[2]) } : null;
};

export const ordinal = (n) => `${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/**
 * A receipt number. A repeated one shows its base number in grey, the tail in a blue chip and a very small REPEAT tag,
 * so the office sees at a glance that the register used this number before. `showWhy` adds "2nd use of 32170" below.
 */
export default function RepeatNumber({ number, className = '', showWhy = false, children = null }) {
  const rep = splitRepeat(number);
  if (!rep) return <span className={className}>{number}{children}</span>;
  return (
    <span className="inline-flex flex-col align-top leading-tight">
      <span className={className}>
        <span className="text-[#7D7068] font-medium">{rep.base}</span>
        <span className="mx-px px-1 rounded bg-blue-100 text-blue-800 font-extrabold">/{rep.tail}</span>
        <span
          className="ml-1.5 px-1 py-px rounded text-[8px] font-semibold tracking-wide bg-blue-50 text-blue-700 border border-blue-200 align-middle"
          title={`The register used ${rep.base} before: this is the ${ordinal(rep.tail)} record with it`}
        >
          REPEAT
        </span>
        {children}
      </span>
      {showWhy && <span className="text-[10px] font-sans font-normal text-blue-700 tracking-normal">↺ {ordinal(rep.tail)} use of {rep.base}</span>}
    </span>
  );
}
