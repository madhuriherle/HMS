import { useEffect, useRef } from 'react';
import { confirmYesNo } from '../utils/dialogs';

// Shows the app's one confirmation popup whenever `dialog` becomes non-null.
//   build(dialog)  -> { title, text, confirmText, danger }
//   onConfirm()    -> runs when the user says yes (the page handler reads its own dialog state)
//   clear()        -> resets the dialog state afterwards (yes or no)
export default function useSwalConfirm(dialog, clear, build, onConfirm) {
  const latest = useRef({});
  latest.current = { clear, build, onConfirm };

  useEffect(() => {
    if (!dialog) return;
    let live = true;
    (async () => {
      const ok = await confirmYesNo(latest.current.build(dialog));
      if (!live) return;
      if (ok) await latest.current.onConfirm();
      latest.current.clear();
    })();
    return () => {
      live = false;
    };
  }, [dialog]);
}
