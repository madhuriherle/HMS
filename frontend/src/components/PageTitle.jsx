import React, { createContext, useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';

const SLOT_ID = 'page-title-slot';

function areTitlesEqual(a, b) {
  if (a === b) return true;
  if (React.isValidElement(a) && React.isValidElement(b)) {
    return a.type === b.type && a.props?.children === b.props?.children;
  }
  return false;
}

// External store for dynamic page title
let currentTitle = null;
const listeners = new Set();

export const pageTitleStore = {
  getSnapshot: () => currentTitle,
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setTitle: (newTitle) => {
    if (!areTitlesEqual(currentTitle, newTitle)) {
      currentTitle = newTitle;
      listeners.forEach((l) => l());
      try {
        window.dispatchEvent(new CustomEvent('hms-page-title', { detail: newTitle }));
      } catch {
        // Safe in SSR or test runner
      }
    }
  }
};

export const PageTitleContext = createContext({
  title: null,
  setTitle: () => {},
});

// Default title mapping based on pathname for any page that doesn't explicitly set a title
export const ROUTE_TITLE_MAP = [
  { match: (p) => p === '/dashboard' || p === '/dashboard/', title: 'Welcome to HMS' },
  { match: (p) => p.startsWith('/dashboard/membership/list') || p === '/dashboard/membership' || p === '/dashboard/members' || p === '/dashboard/members/list', title: 'Membership List' },
  { match: (p) => p.startsWith('/dashboard/membership/register') || p.startsWith('/dashboard/membership/add'), title: 'Register New Member' },
  { match: (p) => p.startsWith('/dashboard/membership/edit/'), title: 'Edit Member Details' },
  { match: (p) => p.startsWith('/dashboard/membership/view/') || p.startsWith('/dashboard/membership/profile/'), title: 'Member Profile' },
  { match: (p) => p.startsWith('/dashboard/membership/import'), title: 'Bulk Member Import (Live Register)' },
  { match: (p) => p.startsWith('/dashboard/membership/unapproved'), title: 'Unapproved Membership' },
  { match: (p) => p.startsWith('/dashboard/membership/assigned'), title: 'Assigned for Approval' },
  { match: (p) => p.startsWith('/dashboard/receipts/entry') || p.startsWith('/dashboard/receipts/add') || p === '/dashboard/receipts', title: 'Receipt Entry' },
  { match: (p) => p.startsWith('/dashboard/receipts/edit/'), title: 'Edit Receipt' },
  { match: (p) => p.startsWith('/dashboard/receipts/tracking') || p.startsWith('/dashboard/receipt/tracking'), title: 'Receipt Tracking' },
  { match: (p) => p.startsWith('/dashboard/receipts/bulk-mapping') || p.startsWith('/dashboard/receipts/auto-map'), title: 'Bulk Receipt Auto-Mapping' },
  { match: (p) => p.startsWith('/dashboard/receipts/labels') || p.startsWith('/dashboard/receipts/label-list'), title: 'Address Label Printing' },
  { match: (p) => p.startsWith('/dashboard/magazine'), title: 'Magazine Management' },
  { match: (p) => p.startsWith('/dashboard/master/location') || p.startsWith('/dashboard/masters/location'), title: 'Location Setup' },
  { match: (p) => p.startsWith('/dashboard/master/membership-type') || p.startsWith('/dashboard/masters/membership-type'), title: 'Membership Types' },
  { match: (p) => p.startsWith('/dashboard/master/receipt-type') || p.startsWith('/dashboard/masters/receipt-type') || p.startsWith('/dashboard/master/particulars') || p.startsWith('/dashboard/masters/particulars') || p.startsWith('/dashboard/master/receipt'), title: 'Particulars Master' },
  { match: (p) => p.startsWith('/dashboard/master/organisation') || p.startsWith('/dashboard/masters/organisation') || p.startsWith('/dashboard/settings/organisation'), title: 'Organisation Settings' },
  { match: (p) => p.startsWith('/dashboard/system/number-formats'), title: 'Number Formats' },
  { match: (p) => p.startsWith('/dashboard/master/payment-mode') || p.startsWith('/dashboard/masters/payment-mode') || p.startsWith('/dashboard/master/bank') || p.startsWith('/dashboard/masters/bank'), title: 'Payment Modes & Bank Details' },
  { match: (p) => p.startsWith('/dashboard/users/roles') || p.startsWith('/dashboard/user/roles'), title: 'User Roles & Privileges' },
  { match: (p) => p.startsWith('/dashboard/users/list') || p === '/dashboard/users' || p.startsWith('/dashboard/users/management'), title: 'User Management' },
  { match: (p) => p.startsWith('/dashboard/users/modules') || p.startsWith('/dashboard/masters/modules') || p.startsWith('/dashboard/settings/modules'), title: 'Modules Management' },
  { match: (p) => p.startsWith('/dashboard/users/activity') || p.startsWith('/dashboard/activity'), title: 'User Activity Logs' },
  { match: (p) => p.startsWith('/dashboard/approvals'), title: 'Approvals' },
  { match: (p) => p.startsWith('/dashboard/events'), title: 'Events Management' },
  { match: (p) => p.startsWith('/dashboard/engagements'), title: 'Engagements Management' },
  { match: (p) => p.startsWith('/dashboard/reports'), title: 'Reports & Insights' },
  { match: (p) => p.startsWith('/dashboard/notifications'), title: 'Notifications & Reminders' },
  { match: (p) => p.startsWith('/dashboard/settings/recycle-bin'), title: 'Recycle Bin' },
  { match: (p) => p.startsWith('/dashboard/settings/cleanup'), title: 'Data Cleanup' },
  { match: (p) => p.startsWith('/dashboard/settings'), title: 'System Settings' },
  { match: (p) => p.startsWith('/dashboard/profile'), title: 'My Profile' },
];

export function getRouteTitle(pathname) {
  const clean = pathname ? pathname.split('?')[0].replace(/\/+$/, '') || '/' : '/';
  const match = ROUTE_TITLE_MAP.find((r) => r.match(clean));
  if (match) return match.title;
  // Fallback: derive human title from last path segment
  const parts = clean.split('/').filter(Boolean);
  if (parts.length > 0) {
    const last = parts[parts.length - 1];
    return last
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return '';
}

export function PageTitleProvider({ children }) {
  return (
    <PageTitleContext.Provider value={{ title: currentTitle, setTitle: pageTitleStore.setTitle }}>
      {children}
    </PageTitleContext.Provider>
  );
}

export function PageTitleSlot() {
  const location = useLocation();
  const customTitle = useSyncExternalStore(pageTitleStore.subscribe, pageTitleStore.getSnapshot);

  // Clear custom title whenever route changes
  useEffect(() => {
    pageTitleStore.setTitle(null);
  }, [location.pathname]);

  const routeTitle = getRouteTitle(location.pathname);
  const display = customTitle || routeTitle;

  return (
    <div id={SLOT_ID} className="min-w-0 flex-1 truncate">
      {display ? (
        typeof display === 'string' || typeof display === 'number' ? (
          <h1 className="truncate text-lg sm:text-xl font-bold text-[#180200] tracking-tight">
            {display}
          </h1>
        ) : (
          display
        )
      ) : null}
    </div>
  );
}

export default function PageTitle({ children, title }) {
  const content = children !== undefined ? children : title;

  useEffect(() => {
    if (content !== undefined && content !== null) {
      pageTitleStore.setTitle(content);
      return () => {
        pageTitleStore.setTitle(null);
      };
    }
  }, [content]);

  return null;
}
