import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Menu, User, LogOut } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import api from '../api';

export default function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const stored = localStorage.getItem('hms_user_profile');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.username || parsed?.name) return parsed;
      }
    } catch (_) {}
    return null;
  });

  // Refresh the signed-in user (role, privileges) from the server on every panel load
  useEffect(() => {
    api.get('/auth/me')
      .then(({ data }) => {
        try {
          localStorage.setItem('hms_user_profile', JSON.stringify(data));
        } catch (_) {}
        setCurrentUser(data);
        window.dispatchEvent(new Event('hms-profile-change'));
      })
      .catch((err) => console.error('Failed to refresh the signed-in user.', err));
  }, []);

  useEffect(() => {
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

  const handleLogout = () => {
    try {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('hms_auth_token');
      localStorage.removeItem('hms_user_profile');
    } catch (_) {}
    navigate('/');
  };

  const displayName = currentUser?.name || currentUser?.username || currentUser?.fullName || '';

  return (
    <div className="flex h-screen overflow-hidden bg-[#FAF7F2] font-sans">
      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-20 bg-[#180200]/50 lg:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-col flex-1 w-full overflow-hidden relative min-w-0">
        {/* Main Application Top Header with Logged-in User Profile */}
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between border-b border-[#E8DFD8] bg-[#FAF7F2]/95 backdrop-blur-sm px-4 sm:px-6 lg:px-8">
          {/* Mobile menu button */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg bg-white border border-[#E8DFD8] shadow-sm text-[#180200] hover:text-[#510601] focus:outline-none"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>

          {/* Admin Profile Section (Top-Right aligned) */}
          <div className="flex items-center gap-3 ml-auto">
            <div className="flex items-center gap-2.5 rounded-xl bg-white border border-[#E8DFD8] p-1.5 sm:px-3 sm:py-1.5 shadow-sm hover:border-[#510601]/30 transition-all">
              <div className="h-7 w-7 sm:h-8 sm:w-8 shrink-0 rounded-full bg-[#510601] flex items-center justify-center text-white font-bold text-xs sm:text-sm shadow-xs">
                {(displayName || '?').charAt(0).toUpperCase()}
              </div>
              <span className="text-xs sm:text-sm font-bold text-[#180200]">{displayName}</span>
              <button
                onClick={handleLogout}
                title="Log Out"
                className="ml-1 rounded-lg p-1 text-[#863221] hover:bg-[#FAF7F2] hover:text-[#ED4636] transition-colors cursor-pointer"
                aria-label="Log Out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-[#FAF7F2]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
