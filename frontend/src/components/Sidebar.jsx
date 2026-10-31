import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, Circle, List, Menu, X } from 'lucide-react';
import { MENU_ICONS } from '../utils/menuIcons';
import clsx from 'clsx';
import api from '../api';
import fullLogo from '../assets/logo.png';

// The menu itself (names, order, links, which privilege shows each page) lives
// in the database `modules` table and comes from GET /users/modules/menu.
// This table only turns the icon *name* stored on a module into a component.
const ICONS = MENU_ICONS;

const displayMenuName = (name) => name === 'Labels & Delivery' ? 'Print & Delivery' : name;

// Only modules that open a page of this panel belong in the sidebar.
const isPanelRoute = (route) => typeof route === 'string' && route.startsWith('/dashboard');

const leaves = (node) => {
  const kids = node.submodules || [];
  return kids.length ? kids.flatMap(leaves) : isPanelRoute(node.route) ? [node] : [];
};

// One entry of a group. A page that has pages of its own below it (System Settings) stays a link and
// shows them indented underneath; a heading without a page of its own just passes its pages up.
const entries = (node) => {
  const kids = (node.submodules || []).flatMap(leaves);
  if (isPanelRoute(node.route) && kids.length) {
    return [{ name: displayMenuName(node.name), path: node.route, children: kids.map((c) => ({ name: displayMenuName(c.name), path: c.route })) }];
  }
  return kids.length ? kids.map((c) => ({ name: displayMenuName(c.name), path: c.route })) : isPanelRoute(node.route) ? [{ name: displayMenuName(node.name), path: node.route }] : [];
};

const toMenuItems = (nodes) =>
  (nodes || [])
    .map((node) => {
      const displayName = displayMenuName(node.name);
      const Icon = ICONS[node.icon] || Circle;
      const children = (node.submodules || []).flatMap(entries);
      if (children.length) {
        return {
          name: displayName,
          icon: Icon,
          submenus: children,
        };
      }
      return isPanelRoute(node.route) ? { name: displayName, icon: Icon, path: node.route } : null;
    })
    .filter(Boolean);

// Checks exact and nested routes
const isPathActive = (pathname, path) => {
  if (path === '/dashboard') {
    return pathname === '/dashboard';
  }
  return pathname === path || pathname.startsWith(`${path}/`);
};

// The name of a menu item next to its icon while the menu is collapsed. Drawn on the page body (position: fixed) so
// the scrolling menu cannot clip it.
function CollapsedTip({ tip }) {
  if (!tip) return null;
  return createPortal(
    <div
      className="fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-[#180200] px-2.5 py-1 text-xs font-medium text-white shadow-lg pointer-events-none"
      style={{ top: tip.top, left: tip.left }}
    >
      {tip.name}
    </div>,
    document.body
  );
}

export default function Sidebar({ isOpen, onClose, collapsed = false, onToggle, onExpand }) {
  const location = useLocation();
  const [tip, setTip] = useState(null);
  const showTip = (name) => (e) => {
    if (!collapsed) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ name, top: r.top + r.height / 2, left: r.right + 10 });
  };
  const hideTip = () => setTip(null);
  // on a phone the menu is the full drawer: "collapsed" only applies from the desktop width up
  const hideWhenCollapsed = collapsed ? 'lg:hidden' : '';
  const centreWhenCollapsed = collapsed ? 'lg:justify-center lg:px-0' : '';

  const [visibleMenuItems, setVisibleMenuItems] = useState([]);
  const [menuState, setMenuState] = useState('loading'); // 'loading' | 'ready' | 'error'

  useEffect(() => {
    let cancelled = false;
    const loadMenu = () =>
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
    loadMenu();
    // Module Master > Arrange menu announces a new order
    window.addEventListener('hms-menu-change', loadMenu);
    return () => {
      cancelled = true;
      window.removeEventListener('hms-menu-change', loadMenu);
    };
  }, []);

  // Submenus expansion state (keyed by menu item name)
  const [expandedMenus, setExpandedMenus] = useState({});

  // Automatically keep the active parent menu expanded when navigating to any of its submenus
  useEffect(() => {
    const activeParent = visibleMenuItems.find(
      (item) =>
        item.submenus &&
        item.submenus.some((sub) => isPathActive(location.pathname, sub.path) || (sub.children || []).some((c) => isPathActive(location.pathname, c.path)))
    );

    if (activeParent) {
      setExpandedMenus({
        [activeParent.name]: true,
      });
    }
  }, [location.pathname, visibleMenuItems]);

  // Accordion behavior: clicking one closes previous and opens current
  const toggleSubmenu = (menuName) => {
    if (collapsed && onExpand) onExpand(); // a group opens its pages, so the menu opens first
    setExpandedMenus((prev) => (prev[menuName] ? {} : { [menuName]: true }));
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
        'w-72 shrink-0 flex flex-col bg-[#200200] text-[#FAF7F2] select-none z-30 transition-[transform,width] duration-300 ease-in-out',
        collapsed ? 'lg:w-16' : 'lg:w-72',
        // Desktop: Fixed/static expanded sidebar
        'lg:static lg:inset-auto lg:translate-x-0 lg:h-screen lg:shadow-none',
        // Mobile: Off-canvas slide-over drawer
        'fixed inset-y-0 left-0 shadow-2xl',
        isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}
    >
      {/* Brand Header */}
      <div className={clsx('flex h-16 shrink-0 items-center justify-between border-b border-[#8C1801] bg-[#200200] px-4 py-1.5', collapsed && 'lg:justify-center lg:px-2')}>
        {/* small hamburger at the left of the header: collapses / opens the menu (desktop) */}
        <button
          type="button"
          onClick={onToggle}
          className="hidden lg:inline-flex shrink-0 mr-3 p-1 text-[#FAF7F2]/80 hover:text-white focus:outline-none cursor-pointer"
          style={collapsed ? { marginRight: 0 } : undefined}
          aria-label={collapsed ? 'Open the menu' : 'Collapse the menu'}
          title={collapsed ? 'Open the menu' : 'Collapse the menu'}
        >
          <Menu className="h-5 w-5" />
        </button>
        <NavLink
          to="/dashboard"
          onClick={handleNavClick}
          className={clsx('flex items-center justify-start flex-1 h-full min-w-0', collapsed && 'lg:hidden')}
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
      <nav className={clsx('flex-1 space-y-1.5 p-3 overflow-y-auto overflow-x-hidden', collapsed && 'lg:px-2')}>
        {menuState === 'loading' && (
          <p className="px-3.5 py-2 text-xs text-[#FAF7F2]/60">Loading menu…</p>
        )}
        {menuState === 'error' && (
          <p className="px-3.5 py-2 text-xs text-[#FFC107]">Menu could not be loaded. Please refresh.</p>
        )}
        {visibleMenuItems.map((item) => {
          const isParentActive =
            item.submenus?.some((sub) =>
              isPathActive(location.pathname, sub.path) || (sub.children || []).some((c) => isPathActive(location.pathname, c.path))
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
                    onMouseEnter={showTip(item.name)}
                    onMouseLeave={hideTip}
                    aria-expanded={isItemExpanded}
                    className={clsx(
                      'relative w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer group',
                      centreWhenCollapsed,
                      isParentActive
                        ? 'bg-[#8C1801] text-[#FFC107] font-semibold shadow-sm ring-1 ring-[#FFC107]/40'
                        : 'text-[#FAF7F2] hover:bg-[#8C1801]/60 hover:text-white'
                    )}
                  >
                    <div className="flex items-center min-w-0">
                      <Icon
                        className={clsx(
                          'h-5 w-5 shrink-0 mr-3 transition-colors',
                          collapsed && 'lg:mr-0',
                          isParentActive
                            ? 'text-[#FFC107]'
                            : 'text-[#FFC107]/80 group-hover:text-[#FFC107]'
                        )}
                      />
                      <span className={clsx('truncate text-left', hideWhenCollapsed)}>{item.name}</span>
                    </div>

                    {/* Submenu Dropdown Chevron */}
                    <div className={clsx('shrink-0 transition-transform duration-200', hideWhenCollapsed)}>
                      {isItemExpanded ? (
                        <ChevronDown className="h-4 w-4 text-[#FFC107]/90" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-stone-300" />
                      )}
                    </div>
                  </button>

                  {/* Submenu Items List */}
                  {isItemExpanded && (
                    <div className={clsx('space-y-1 py-1 pl-6 pr-1 animate-in fade-in-50 duration-200', hideWhenCollapsed)}>
                      {item.submenus.map((sub) => {
                        // the page itself is only "active" when none of its own pages below it is the open one
                        const childActive = (sub.children || []).some((c) => isPathActive(location.pathname, c.path));
                        const isSubActive = isPathActive(location.pathname, sub.path) && !childActive;
                        const link = (entry, active, nested) => (
                          <NavLink
                            key={entry.path}
                            to={entry.path}
                            onClick={handleNavClick}
                            className={clsx(
                              'relative block rounded-lg px-3 py-2 transition-all truncate group',
                              nested ? 'text-[13px] ml-4' : 'text-sm',
                              active
                                ? 'bg-[#863221] text-white font-bold ring-1 ring-[#FFC107]/50 shadow-xs'
                                : 'text-[#FAF7F2]/80 font-medium hover:bg-[#8C1801]/60 hover:text-white'
                            )}
                          >
                            <span className="truncate">{entry.name}</span>
                          </NavLink>
                        );

                        return (
                          <React.Fragment key={sub.path}>
                            {link(sub, isSubActive, false)}
                            {(sub.children || []).map((c) => link(c, isPathActive(location.pathname, c.path), true))}
                          </React.Fragment>
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
                  onMouseEnter={showTip(item.name)}
                  onMouseLeave={hideTip}
                  className={clsx(
                    'relative w-full flex items-center px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer group',
                    centreWhenCollapsed,
                    isSingleActive
                      ? 'bg-[#8C1801] text-[#FFC107] font-semibold shadow-sm ring-1 ring-[#FFC107]/40'
                      : 'text-[#FAF7F2] hover:bg-[#8C1801]/60 hover:text-white'
                  )}
                >
                  <Icon
                    className={clsx(
                      'h-5 w-5 shrink-0 mr-3 transition-colors',
                      collapsed && 'lg:mr-0',
                      isSingleActive
                        ? 'text-[#FFC107]'
                        : 'text-[#FFC107]/80 group-hover:text-[#FFC107]'
                    )}
                  />
                  <span className={clsx('truncate text-left', hideWhenCollapsed)}>{item.name}</span>
                </NavLink>
              )}
            </div>
          );
        })}
      </nav>
      <CollapsedTip tip={tip} />
    </aside>
  );
}
