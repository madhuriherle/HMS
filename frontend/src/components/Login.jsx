import React, { useState } from 'react';
import { Eye, EyeOff, AlertCircle, ArrowRight, User, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import logoIcon from '../assets/logo-icon.png';
import api from '../api';
import { notifySuccess } from '../utils/notify';

export default function Login() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [authError, setAuthError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = () => {
    const newErrors = {};
    if (!formData.username.trim()) {
      newErrors.username = 'Username is required.';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
    if (authError) {
      setAuthError('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');

    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const body = new URLSearchParams({
        username: formData.username.trim(),
        password: formData.password,
      });
      const res = await api.post('/auth/login', body);
      const { access_token, refresh_token } = res.data;

      localStorage.setItem('access_token', access_token);
      if (refresh_token) localStorage.setItem('refresh_token', refresh_token);

      try {
        const me = await api.get('/auth/me');
        localStorage.setItem('hms_user_profile', JSON.stringify(me.data));
      } catch (meErr) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        throw meErr;
      }

      navigate('/dashboard');
      notifySuccess('Login successful! Welcome back.');
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setAuthError(
        typeof detail === 'string' ? detail : 'Invalid username or password.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center font-sans p-4 sm:p-8 bg-[#F4EFE6]">
      {/* Top Logo Header (Spanning Full Width of Card) */}
      <div className="w-full max-w-[420px] flex items-center justify-center sm:justify-between gap-4 mb-7 px-2 select-none">
        <img 
          src={logoIcon} 
          alt="Shri Akhila Havyaka Mahasabha Logo" 
          className="w-16 h-20 sm:w-18 sm:h-22 object-contain filter drop-shadow-sm shrink-0"
        />
        <div className="flex-1 flex flex-col items-start justify-center">
          <span className="text-[20px] sm:text-[22px] font-bold text-[#4A1208] leading-snug font-kannada tracking-wide">
            ಶ್ರೀ ಅಖಿಲ ಹವ್ಯಕ ಮಹಾಸಭಾ (ರಿ.)
          </span>
          <span className="text-[11.5px] sm:text-[12.5px] font-bold text-[#4A1208] tracking-wider uppercase mt-1">
            SHRI AKHILA HAVYAKA MAHASABHA (R.)
          </span>
        </div>
      </div>

      {/* Centered Login Card */}
      <div className="w-full max-w-[420px] bg-[#FCFAF7] rounded-[32px] shadow-[0_16px_50px_rgba(70,20,10,0.07)] border border-[#EFE5DA] px-7 sm:px-9 py-12 sm:py-14 transition-all duration-300">
        {/* Login Form */}
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {/* Auth Error Banner */}
          {authError && (
            <div className="p-3.5 bg-red-50/90 border border-red-200 rounded-xl text-xs sm:text-sm text-red-700 flex items-start gap-2.5 animate-in fade-in duration-200">
              <AlertCircle className="w-4.5 h-4.5 shrink-0 mt-0.5 text-red-600" />
              <div>
                <span className="font-semibold block">Authentication Failed</span>
                <span>{authError}</span>
              </div>
            </div>
          )}

          {/* Username Field */}
          <div>
            <label
              htmlFor="username"
              className="block text-[15px] sm:text-[15.5px] font-bold text-[#4A1208] mb-2 text-left tracking-tight"
            >
              Username
            </label>
            <div className="relative">
              <User className="w-5 h-5 text-[#8C6B5E] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                value={formData.username}
                onChange={handleChange}
                placeholder="Enter username"
                className={`w-full pl-12 pr-4 py-3.5 bg-[#F5EDE3] border rounded-[14px] text-sm sm:text-base text-[#280E07] placeholder-[#A69385] focus:outline-none focus:ring-0 focus:border-[#D5C2B1] focus:bg-[#F5EDE3] active:bg-[#F5EDE3] caret-[#5B140A] login-input-field transition-colors ${
                  errors.username
                    ? 'border-red-400 ring-1 ring-red-400/30'
                    : 'border-[#E5D7C8]'
                }`}
              />
            </div>
            {errors.username && (
              <p className="mt-1.5 text-xs sm:text-sm text-red-600 flex items-center gap-1 font-medium text-left">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errors.username}</span>
              </p>
            )}
          </div>

          {/* Password Field */}
          <div>
            <label
              htmlFor="password"
              className="block text-[15px] sm:text-[15.5px] font-bold text-[#4A1208] mb-2 text-left tracking-tight"
            >
              Password
            </label>
            <div className="relative">
              <Lock className="w-5 h-5 text-[#8C6B5E] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                className={`w-full pl-12 pr-12 py-3.5 bg-[#F5EDE3] border rounded-[14px] text-sm sm:text-base text-[#280E07] placeholder-[#A69385] focus:outline-none focus:ring-0 focus:border-[#D5C2B1] focus:bg-[#F5EDE3] active:bg-[#F5EDE3] caret-[#5B140A] login-input-field transition-colors ${
                  errors.password
                    ? 'border-red-400 ring-1 ring-red-400/30'
                    : 'border-[#E5D7C8]'
                }`}
              />
              <button
                type="button"
                id="toggle-password-visibility"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-[#8C6B5E] hover:text-[#4A1208] focus:outline-none transition-colors cursor-pointer"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="mt-1.5 text-xs sm:text-sm text-red-600 flex items-center gap-1 font-medium text-left">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errors.password}</span>
              </p>
            )}
          </div>

          {/* Login Button */}
          <div className="pt-2.5">
            <button
              type="submit"
              id="login-submit-button"
              disabled={isSubmitting}
              className="w-full py-3.5 sm:py-4 px-6 bg-[#55140A] hover:bg-[#430F07] active:bg-[#340B05] text-white font-bold text-base sm:text-[16.5px] rounded-full shadow-sm hover:shadow transition-all duration-200 flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-75"
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="animate-spin h-4.5 w-4.5 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Logging In...
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span>Login</span>
                  <ArrowRight className="w-5 h-5 mt-0.5" />
                </span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


