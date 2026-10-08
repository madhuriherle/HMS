import React, { useState, useEffect, useRef } from 'react';
import { Menu, User, Settings, LogOut, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Navbar({ onToggleSidebar }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const stored = localStorage.getItem('hms_user_profile');
      return stored ? JSON.parse(stored) : { name: 'hmsuser', username: 'hmsuser', email: 'hmsuser@hms.org' };
    } catch (_) {
      return { name: 'hmsuser', username: 'hmsuser', email: 'hmsuser@hms.org' };
    }
  });

  useEffect(() => {
    // Sync with localStorage changes
    const syncUser = () => {
      try {
        const stored = localStorage.getItem('hms_user_profile');
        if (stored) {
          setCurrentUser(JSON.parse(stored));
        }
      } catch (_) {}
    };

    window.addEventListener('storage', syncUser);
    return () => window.removeEventListener('storage', syncUser);
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setProfileOpen(false);
      }
    }

    if (profileOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [profileOpen]);

  const handleLogout = () => {
    setProfileOpen(false);
    try {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('hms_auth_token');
      localStorage.removeItem('hms_user_profile');
    } catch (_) {}
    navigate('/');
  };

  const displayName = currentUser?.username || currentUser?.name || currentUser?.fullName || 'hmsuser';
  const displayEmail = currentUser?.email || `${displayName}@hms.org`;

  return (
    <header className="bg-white border-b border-[#E8DFD8] h-16 flex items-center justify-between px-4 sm:px-6">
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleSidebar}
          className="lg:hidden text-[#180200] hover:text-[#510601] focus:outline-none"
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>

      <div className="flex items-center gap-4 sm:gap-6">

        {/* Profile Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="flex items-center gap-2 focus:outline-none group cursor-pointer"
            aria-expanded={profileOpen}
            aria-haspopup="true"
          >
            <div className="h-8 w-8 rounded-full bg-[#510601] flex items-center justify-center text-white font-bold text-sm shadow-xs">
              A
            </div>
            <span className="text-sm font-bold text-[#180200] hidden sm:block group-hover:text-[#510601] transition-colors">
              Admin
            </span>
            <ChevronDown className={`h-4 w-4 text-[#863221] hidden sm:block transition-transform duration-200 group-hover:text-[#510601] ${profileOpen ? 'rotate-180' : ''}`} />
          </button>

          {profileOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-[#E8DFD8] py-1 z-50">
              <div className="px-4 py-2 border-b border-[#E8DFD8]">
                <p className="text-sm font-medium text-[#180200] truncate" title={displayName}>{displayName}</p>
                <p className="text-xs text-[#863221] truncate" title={displayEmail}>{displayEmail}</p>
              </div>
              <a 
                href="#profile" 
                onClick={() => setProfileOpen(false)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-[#180200] hover:bg-[#FAF7F2] transition-colors"
              >
                <User className="h-4 w-4 text-[#863221]" /> Profile
              </a>
              <button 
                type="button"
                onClick={() => {
                  setProfileOpen(false);
                  navigate('/dashboard/master/organisation-settings');
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[#180200] hover:bg-[#FAF7F2] transition-colors text-left cursor-pointer"
              >
                <Settings className="h-4 w-4 text-[#863221]" /> Settings
              </button>
              <div className="border-t border-[#E8DFD8] my-1"></div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[#ED4636] hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-4 w-4" /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
