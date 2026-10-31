// An old-register receipt: the UNKNOWN tag, on its own line under the receipt number, with what is missing beside it as small sub-labels - "No number" (the number is a made-up
// one) and "No amount" (it holds Rs 0). A real receipt with Rs 0 shows only "No amount".
const TAG = 'px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide bg-amber-100 text-amber-800 border border-amber-200 align-middle';
const SUB = 'px-1 py-px rounded text-[8px] font-semibold text-amber-800/80 bg-amber-50 border border-amber-200/70 align-middle';

export default function MissingTags({ noNumber, amount }) {
  const noAmount = Number(amount) === 0;
  if (!noNumber && !noAmount) return null;
  return (
    <div className="mt-1 flex flex-nowrap items-center gap-1 whitespace-nowrap">
      {noNumber && <span className={TAG} title="Old receipt added afterwards (dummy number)">UNKNOWN</span>}
      {noNumber && <span className={SUB} title="The real receipt number is not known; this one is made up">No number</span>}
      {noAmount && <span className={SUB} title="The amount is not known (Rs 0)">No amount</span>}
    </div>
  );
}
