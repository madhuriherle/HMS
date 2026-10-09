import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  BadgeCheck,
  Bell,
  BarChart3,
  BookOpen,
  Building2,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Circle,
  CreditCard,
  Database,
  FilePlus,
  FileText,
  IdCard,
  Key,
  LayoutDashboard,
  LayoutGrid,
  Link as LinkIcon,
  List,
  ListChecks,
  Map,
  MapPin,
  Receipt,
  Search,
  Settings,
  Shield,
  Upload,
  User,
  UserCheck,
  Users,
  X
} from 'lucide-react';
import clsx from 'clsx';
import api from '../api';
import fullLogo from '../assets/logo.png';

// The menu itself (names, order, links, which privilege shows each page) lives
// in the database `modules` table and comes from GET /users/modules/menu.
// This table only turns the icon *name* stored on a module into a component.
const ICONS = {
  'layout-dashboard': LayoutDashboard,
  list: List,
  'user-check': UserCheck,
  'file-plus': FilePlus,
  search: Search,
  'layout-grid': LayoutGrid,
  'map-pin': MapPin,
  badge: BadgeCheck,
  'list-checks': ListChecks,
  building: Building2,
  'credit-card': CreditCard,
  database: Database,
  users: Users,
  user: User,
  shield: Shield,
  key: Key,
  'id-card': IdCard,
  'check-circle': CheckCircle,
  'book-open': BookOpen,
  receipt: Receipt,
  'bar-chart': BarChart3,
  bell: Bell,
  activity: Activity,
  calendar: Calendar,
  link: LinkIcon,
  upload: Upload,
  settings: Settings,
  map: Map,
  'file-text': FileText,
};

// Only modules that open a page of this panel belong in the sidebar.
const isPanelRoute = (route) => typeof route === 'string' && route.startsWith('/dashboard');

const leaves = (node) => {
  const kids = node.submodules || [];
  return kids.length ? kids.flatMap(leaves) : isPanelRoute(node.route) ? [node] : [];
};

const toMenuItems = (nodes) =>
  (nodes || [])
    .map((node) => {
      const Icon = ICONS[node.icon] || Circle;
      const children = (node.submodules || []).flatMap(leaves);
      if (children.length) {
        return {
          name: node.name,
          icon: Icon,
          submenus: children.map((c) => ({ name: c.name, path: c.route })),
        };
      }
      return isPanelRoute(node.route) ? { name: node.name, icon: Icon, path: node.route } : null;
    })
    .filter(Boolean);

// Checks exact and nested routes
const isPathActive = (pathname, path) => {
  if (path === '/dashboard') {
    return pathname === '/dashboard';
  }
  return pathname === path || pathname.startsWith(`${path}/`);
};

export default function Sidebar({ isOpen, onClose }) {
  const location = useLocation();

  const [visibleMenuItems, setVisibleMenuItems] = useState([]);
  const [menuState, setMenuState] = useState('loading'); // 'loading' | 'ready' | 'error'

  useEffect(() => {
    let cancelled = false;
    api
      .get('/users/modules/menu')
      .then((res) => {
        if (cancelled) return;
        setVisibleMenuItems(toMenuItems(res.data));
        setMenuState('ready');
      })
      .catch(() => {
        if (!cancelled) setMenuState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
  }, [location.pathname, visibleMenuItems]);

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
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#8C1801] bg-[#200200] px-4 py-1.5">
        <NavLink
          to="/dashboard"
          onClick={handleNavClick}
          className="flex items-center justify-start flex-1 h-full min-w-0"
          title="Shri Akhila Havyaka Mahasabha"
        >
          <img
            src={fullLogo}
            alt="Shri Akhila Havyaka Mahasabha (R.)"
            className="w-full max-h-11 object-contain filter drop-shadow-sm"
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
        {menuState === 'loading' && (
          <p className="px-3.5 py-2 text-xs text-[#FAF7F2]/60">Loading menu…</p>
        )}
        {menuState === 'error' && (
          <p className="px-3.5 py-2 text-xs text-[#FFC107]">Menu could not be loaded. Please refresh.</p>
        )}
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
                              'relative block rounded-lg px-3 py-2 text-sm transition-all truncate group',
                              isSubActive
                                ? 'bg-[#863221] text-white font-bold ring-1 ring-[#FFC107]/50 shadow-xs'
                                : 'text-[#FAF7F2]/80 font-medium hover:bg-[#8C1801]/60 hover:text-white'
                            )}
                          >
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