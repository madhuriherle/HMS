import { useState, useEffect } from 'react';

const readProfile = () => {
  try {
    return JSON.parse(localStorage.getItem('hms_user_profile')) || null;
  } catch {
    return null;
  }
};

// Current signed-in user's rank / privileges, from GET /auth/me (stored at login).
// rank_level: 1 = top (Super Admin), larger = weaker (default 99).
export default function useAuth() {
  const [profile, setProfile] = useState(readProfile);

  useEffect(() => {
    const sync = () => setProfile(readProfile());
    window.addEventListener('storage', sync);
    window.addEventListener('hms-profile-change', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('hms-profile-change', sync);
    };
  }, []);

  const parsedRank = Number(profile?.role_rank_level);
  const myRank = Number.isFinite(parsedRank) && parsedRank > 0 ? parsedRank : 99;
  const isAllAccess = Boolean(profile?.is_all_access);
  const privileges = Array.isArray(profile?.privileges) ? profile.privileges : [];

  const hasPermission = (code) => isAllAccess || privileges.includes(code);

  return { profile, myRank, isAllAccess, privileges, hasPermission };
}
