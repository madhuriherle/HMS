import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// A page's action buttons (Add, Export, Refresh ...) sit on the right of the page heading row (rule 12.1).
// The page puts <PageActionsSlot /> in its heading row; any list on the page wraps its buttons in
// <PageActions> and they show up there, while the list keeps its own state and popups.
const SLOT_ID = 'page-actions-slot';

export function PageActionsSlot() {
  return <div id={SLOT_ID} className="flex items-center gap-2.5 flex-wrap justify-end" />;
}

export default function PageActions({ children }) {
  const [target, setTarget] = useState(null);
  useEffect(() => {
    setTarget(document.getElementById(SLOT_ID));
  }, []);
  return target ? createPortal(children, target) : null;
}
