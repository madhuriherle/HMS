import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// A page's title can sit in the top bar instead of the body, which gives the body its full height back.
// MainLayout puts <PageTitleSlot /> on the left of the top bar; a page wraps its <h1> in <PageTitle>.
const SLOT_ID = 'page-title-slot';

export function PageTitleSlot() {
  return <div id={SLOT_ID} className="min-w-0 flex-1 truncate" />;
}

export default function PageTitle({ children }) {
  const [target, setTarget] = useState(null);
  useEffect(() => {
    setTarget(document.getElementById(SLOT_ID));
  }, []);
  return target ? createPortal(children, target) : null;
}
