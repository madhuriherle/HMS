// What an old-register receipt is missing: "No number" (the number is a made-up one) and "No amount" (it holds Rs 0).
const TAG = 'ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide bg-amber-100 text-amber-800 border border-amber-200 align-middle';

export default function MissingTags({ noNumber, amount }) {
  const noAmount = Number(amount) === 0;
  if (!noNumber && !noAmount) return null;
  return (
    <>
      {noNumber && <span className={`${TAG} ml-1.5`} title="The real receipt number is not known; this one is made up">No number</span>}
      {noAmount && <span className={noNumber ? TAG : `${TAG} ml-1.5`} title="The amount is not known (Rs 0)">No amount</span>}
    </>
  );
}
