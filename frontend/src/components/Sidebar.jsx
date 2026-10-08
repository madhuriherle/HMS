import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Map,
  Users,
  FileText,
  ChevronDown,
  ChevronRight,
  UserCheck,
  X
} from 'lucide-react';
import clsx from 'clsx';
import useAuth from '../hooks/useAuth';
import fullLogo from '../assets/logo.png';

const menuItems = [
  {
    name: 'Dashboard',
    path: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    name: 'Membership',
    icon: UserCheck,
    submenus: [
      { name: 'Membership List', path: '/dashboard/membership/list', permission: 'members.read' },
      { name: 'Unapproved Membership', path: '/dashboard/membership/unapproved', permission: 'members.approvals.read' },
    ],
  },
  {
    name: 'Receipts',
    icon: FileText,
    submenus: [
      { name: 'Receipt Entry', path: '/dashboard/receipts/entry', permission: 'receipts.read' },
      { name: 'Receipt Tracking', path: '/dashboard/receipts/tracking', permission: 'receipts.read' },
    ],
  },
  {
    name: 'User',
    icon: Users,
    submenus: [
      { name: 'Roles & Privileges', path: '/dashboard/users/roles', permission: 'roles.read' },
      { name: 'Users', path: '/dashboard/users/list', permission: 'users.management.read' },
      { name: 'Modules', path: '/dashboard/users/modules', rank1Only: true },
    ],
  },
  {
    name: 'Masters',
    icon: Map,
    submenus: [
      {
        name: 'Location Setup',
        path: '/dashboard/master/location-setup',
        permission: 'masters.read',
      },
      {
        name: 'Membership Types',
        path: '/dashboard/master/membership-type',
        permission: 'masters.read',
      },
      {
        name: 'Particulars Master',
        path: '/dashboard/master/receipt-type',
        permission: 'masters.read',
      },
      {
        name: 'Organisation Settings',
        path: '/dashboard/master/organisation-settings',
        permission: 'system.read',
      },
      {
        name: 'Payment Mode Setup',
        path: '/dashboard/master/payment-modes',
        permission: 'masters.read',
      },
    ],
  },
];

// Checks exact and nested routes
const isPathActive = (pathname, path) => {
  if (path === '/dashboard') {
    return pathname === '/dashboard';
  }
  return pathname === path || pathname.startsWith(`${path}/`);
};

export default function Sidebar({ isOpen, onClose }) {
  const location = useLocation();
  const { myRank, hasPermission } = useAuth();
  const isRank1 = myRank === 1;

  const visibleMenuItems = menuItems
    .map((item) =>
      item.submenus
        ? {
            ...item,
            submenus: item.submenus.filter(
              (sub) =>
                (!sub.rank1Only || isRank1) &&
                (!sub.permission || hasPermission(sub.permission))
            ),
          }
        : item
    )
    .filter((item) => !item.submenus || item.submenus.length > 0);

  // Submenus expansion state (keyed by menu item name)
  const [expandedMenus, setExpandedMenus] = useState({});

  // Automatically keep the active parent menu expanded when navigating to any of its submenus
  useEffect(() => {
    const activeParent = visibleMenuItems.find(
      (item) =>
        item.submenus &&
        item.submenus.some((sub) => isPathActive(location.pathname, sub.path))
    );

    if (activeParent) {
      setExpandedMenus((prev) => ({
        ...prev,
        [activeParent.name]: true,
      }));
    }
  }, [location.pathname]);

  const toggleSubmenu = (menuName) => {
    setExpandedMenus((prev) => ({
      ...prev,
      [menuName]: !prev[menuName],
    }));
  };

  const handleNavClick = () => {
    // Close mobile drawer on item click
    if (onClose) {
      onClose();
    }
  };

  return (
    <aside
      className={clsx(
        'w-64 shrink-0 flex flex-col bg-[#200200] text-[#FAF7F2] select-none z-30 transition-transform duration-300 ease-in-out',
        // Desktop: Fixed/static expanded sidebar
        'lg:static lg:inset-auto lg:translate-x-0 lg:h-screen lg:shadow-none',
        // Mobile: Off-canvas slide-over drawer
        'fixed inset-y-0 left-0 shadow-2xl',
        isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}
    >
      {/* Brand Header */}
      <div className="flex h-20 shrink-0 items-center justify-between border-b border-[#8C1801] bg-[#200200] px-4 py-2">
        <NavLink
          to="/dashboard"
          onClick={handleNavClick}
          className="flex items-center justify-start flex-1 h-full min-w-0"
          title="Shri Akhila Havyaka Mahasabha"
        >
          <img
            src={fullLogo}
            alt="Shri Akhila Havyaka Mahasabha (R.)"
            className="w-full max-h-14 object-contain filter drop-shadow-sm"
          />
        </NavLink>

        {/* Close Button on Mobile Drawer */}
        <button
          type="button"
          onClick={onClose}
          className="lg:hidden p-1.5 rounded-lg text-stone-300 hover:text-white hover:bg-white/10 transition-colors ml-2 shrink-0 cursor-pointer"
          aria-label="Close navigation menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 space-y-1.5 p-3 overflow-y-auto overflow-x-hidden">
        {visibleMenuItems.map((item) => {
          const isParentActive =
            item.submenus?.some((sub) =>
              isPathActive(location.pathname, sub.path)
            ) ?? false;

          const isSingleActive =
            !item.submenus && isPathActive(location.pathname, item.path);

          const Icon = item.icon;
          const isItemExpanded = Boolean(expandedMenus[item.name]);

          return (
            <div key={item.name} className="relative">
              {item.submenus ? (
                <div>
                  {/* Parent Menu Item */}
                  <button
                    type="button"
                    onClick={() => toggleSubmenu(item.name)}
                    aria-expanded={isItemExpanded}
                    className={clsx(
                      'relative w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer group',
                      isParentActive
                        ? 'bg-[#8C1801] text-[#FFC107] font-semibold shadow-sm ring-1 ring-[#FFC107]/40'
                        : 'text-[#FAF7F2] hover:bg-[#8C1801]/60 hover:text-white'
                    )}
                  >
                    {/* Active Left Indicator Bar */}
                    {isParentActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-7 bg-[#FFC107] rounded-r-full shadow-md" />
                    )}

                    <div className="flex items-center min-w-0">
                      <Icon
                        className={clsx(
                          'h-5 w-5 shrink-0 mr-3 transition-colors',
                          isParentActive
                            ? 'text-[#FFC107]'
                            : 'text-[#FFC107]/80 group-hover:text-[#FFC107]'
                        )}
                      />
                      <span className="truncate text-left">{item.name}</span>
                    </div>

                    {/* Submenu Dropdown Chevron */}
                    <div className="shrink-0 transition-transform duration-200">
                      {isItemExpanded ? (
                        <ChevronDown className="h-4 w-4 text-[#FFC107]/90" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-stone-300" />
                      )}
                    </div>
                  </button>

                  {/* Submenu Items List */}
                  {isItemExpanded && (
                    <div className="space-y-1 py-1 pl-6 pr-1 animate-in fade-in-50 duration-200">
                      {item.submenus.map((sub) => {
                        const isSubActive = isPathActive(location.pathname, sub.path);

                        return (
                          <NavLink
                            key={sub.path}
                            to={sub.path}
                            onClick={handleNavClick}
                            className={clsx(
                              'relative block rounded-lg px-3 py-2 text-xs transition-all truncate group',
                              isSubActive
                                ? 'bg-[#863221] text-white font-bold ring-1 ring-[#FFC107]/50 shadow-xs pl-3.5'
                                : 'text-[#FAF7F2]/80 font-medium hover:bg-[#8C1801]/60 hover:text-white'
                            )}
                          >
                            {isSubActive && (
                              <span className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-3.5 bg-[#FFC107] rounded-r-full" />
                            )}
                            <span className="truncate">{sub.name}</span>
                          </NavLink>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* Single Menu Item (e.g. Dashboard) */
                <NavLink
                  to={item.path}
                  end={item.path === '/dashboard'}
                  onClick={handleNavClick}
                  className={clsx(
                    'relative w-full flex items-center px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer group',
                    isSingleActive
                      ? 'bg-[#8C1801] text-[#FFC107] font-semibold shadow-sm ring-1 ring-[#FFC107]/40'
                      : 'text-[#FAF7F2] hover:bg-[#8C1801]/60 hover:text-white'
                  )}
                >
                  {/* Active Left Indicator Bar */}
                  {isSingleActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-7 bg-[#FFC107] rounded-r-full shadow-md" />
                  )}

                  <Icon
                    className={clsx(
                      'h-5 w-5 shrink-0 mr-3 transition-colors',
                      isSingleActive
                        ? 'text-[#FFC107]'
                        : 'text-[#FFC107]/80 group-hover:text-[#FFC107]'
                    )}
                  />
                  <span className="truncate text-left">{item.name}</span>
                </NavLink>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}