import { PageTitleSlot, PageTitleProvider } from '../components/PageTitle';
import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Menu, User, LogOut, ChevronDown } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import api from '../api';
import Swal from 'sweetalert2';

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

  const handleLogout = async () => {
    const result = await Swal.fire({
      title: 'Log out?',
      text: 'Are you sure you want to log out?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Yes, log out',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#ED4636',
      cancelButtonColor: '#863221',
      reverseButtons: true,
      customClass: { popup: 'hms-mini-swal' },
    });

    if (result.isConfirmed) {
      try {
        const refreshToken = localStorage.getItem('refresh_token');
        await api.post('/auth/logout', { refresh_token: refreshToken });
      } catch (err) {
        console.error('Logout error:', err);
      } finally {
        try {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('hms_auth_token');
          localStorage.removeItem('hms_user_profile');
        } catch (_) {}
        navigate('/');
      }
    }
  };

  const displayName = currentUser?.name || currentUser?.username || currentUser?.fullName || '';

  return (
    <PageTitleProvider>
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
          <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between border-b border-[#E8DFD8] bg-white shadow-2xs px-4 sm:px-6 lg:px-8">
            {/* Mobile menu button */}
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 rounded-lg bg-stone-50 border border-[#E8DFD8] shadow-2xs text-[#180200] hover:text-[#510601] hover:bg-stone-100 focus:outline-none"
                aria-label="Open navigation menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <PageTitleSlot />
            </div>

            {/* Admin Profile Section (Top-Right aligned): hover (or click on touch screens) for Profile and Log Out */}
            <div className="relative ml-auto group" tabIndex={0}>
              <div className="flex items-center gap-2.5 rounded-xl bg-[#FAF7F2]/80 hover:bg-[#FAF7F2] border border-[#E8DFD8] p-1.5 sm:px-3 sm:py-1.5 shadow-2xs group-hover:border-[#510601]/30 group-focus-within:border-[#510601]/30 transition-all cursor-pointer">
                <div className="h-7 w-7 sm:h-8 sm:w-8 shrink-0 rounded-full bg-[#510601] flex items-center justify-center text-white font-bold text-xs sm:text-sm shadow-xs">
                  {(displayName || '?').charAt(0).toUpperCase()}
                </div>
                <span className="text-xs sm:text-sm font-bold text-[#180200]">{displayName}</span>
                <ChevronDown className="h-4 w-4 text-[#863221] transition-transform group-hover:rotate-180 group-focus-within:rotate-180" />
              </div>
              <div className="absolute right-0 top-full pt-2 w-44 hidden group-hover:block group-focus-within:block z-50">
                <div className="bg-white rounded-xl shadow-lg border border-[#E8DFD8] py-1">
                  <button
                    type="button"
                    onClick={() => navigate('/dashboard/profile')}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[#180200] hover:bg-[#FAF7F2] transition-colors text-left cursor-pointer"
                  >
                    <User className="h-4 w-4 text-[#863221]" /> Profile
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[#180200] hover:bg-[#FAF7F2] hover:text-[#ED4636] transition-colors text-left cursor-pointer"
                  >
                    <LogOut className="h-4 w-4 text-[#863221]" /> Log Out
                  </button>
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-[#FAF7F2]">
            <Outlet />
          </main>
        </div>
      </div>
    </PageTitleProvider>
  );
}
