import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Compass, Home, ArrowLeft } from 'lucide-react';

// Friendly "page not found" screen: a compass bobs between the 4s while it looks for the page.
export default function NotFound() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="hms-nf relative min-h-screen bg-[#FAF7F2] flex flex-col items-center justify-center text-center px-4 py-12 sm:py-16 overflow-hidden">
      {/* floating dots */}
      <span className="hms-nf-dot hms-nf-dot-1" />
      <span className="hms-nf-dot hms-nf-dot-2" />
      <span className="hms-nf-dot hms-nf-dot-3" />
      <span className="hms-nf-dot hms-nf-dot-4" />

      {/* 4 [compass] 4 */}
      <div className="flex items-end justify-center gap-2 sm:gap-4 select-none" aria-hidden="true">
        <span className="hms-nf-four text-[88px] sm:text-[140px] leading-none font-black text-[#510601]">4</span>
        <div className="relative flex flex-col items-center">
          <div className="hms-nf-bob w-[84px] h-[84px] sm:w-[128px] sm:h-[128px] rounded-full bg-gradient-to-br from-[#FFC107] to-[#EE6A00] shadow-[0_10px_30px_-8px_rgba(238,106,0,0.6)] flex items-center justify-center">
            <div className="w-[64px] h-[64px] sm:w-[98px] sm:h-[98px] rounded-full bg-white flex items-center justify-center">
              <Compass className="hms-nf-spin w-9 h-9 sm:w-14 sm:h-14 text-[#510601]" strokeWidth={1.6} />
            </div>
          </div>
          <span className="hms-nf-shadow mt-3 block w-[70px] sm:w-[104px] h-2.5 rounded-full bg-[#180200]/15" />
        </div>
        <span className="hms-nf-four hms-nf-four-2 text-[88px] sm:text-[140px] leading-none font-black text-[#510601]">4</span>
      </div>

      <h2 className="mt-6 text-2xl sm:text-3xl font-bold text-[#180200] tracking-tight">Page not found</h2>
      <p className="mt-2 text-sm text-[#863221] max-w-md leading-relaxed">
        Our compass looked everywhere, but this page isn&apos;t here. The address may be wrong, or the page isn&apos;t available yet.
      </p>
      <code className="mt-3 inline-block max-w-full truncate px-3 py-1 rounded-lg bg-[#FAF7F2] border border-[#E8DFD8] text-[11px] font-mono text-[#180200]/70">
        {location.pathname}
      </code>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-[#E8DFD8] hover:border-[#510601] text-[#510601] text-xs sm:text-sm font-semibold rounded-xl transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Go back</span>
        </button>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#510601] hover:bg-[#8C1801] text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm transition-colors"
        >
          <Home className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </Link>
      </div>
    </div>
  );
}
