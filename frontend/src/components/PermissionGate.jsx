import React from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import useAuth from '../hooks/useAuth';

export default function PermissionGate({
  required,
  minRank,
  icon: Icon = Lock,
  title,
  message,
  children
}) {
  const { myRank, hasPermission } = useAuth();

  const granted = Array.isArray(required)
    ? required.some((code) => hasPermission(code))
    : required == null || required === '' || hasPermission(required);

  const rankOk = minRank == null || myRank <= minRank;

  if (granted && rankOk) return children;

  const missing = Array.isArray(required) ? required : [required];

  return (
    <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] p-12 text-center">
      <div className="w-14 h-14 rounded-full bg-[#FFC107]/15 text-[#863221] flex items-center justify-center mx-auto mb-4">
        <Icon className="w-7 h-7" />
      </div>
      <h2 className="text-lg font-bold text-[#180200]">{title || 'Access Restricted'}</h2>
      <p className="text-xs text-[#863221] mt-2 max-w-md mx-auto leading-relaxed">
        {message ||
          'Your role does not include the required permission to view or use this screen. Ask a Super Admin to grant it through Roles & Privileges.'}
      </p>
      {!rankOk && minRank != null && (
        <p className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 bg-[#FFC107]/15 border border-[#FFC107]/40 text-[#863221] text-xs font-bold rounded-lg">
          Requires rank {minRank} or better
        </p>
      )}
      {!granted && (
        <div className="flex flex-wrap justify-center gap-1.5 mt-3">
          {missing.filter(Boolean).map((code) => (
            <span
              key={code}
              className="inline-flex items-center px-2.5 py-1 bg-[#FAF7F2] border border-[#E8DFD8] rounded-lg text-[11px] font-mono text-[#180200]/80"
            >
              {code}
            </span>
          ))}
        </div>
      )}
      <Link
        to="/dashboard"
        className="inline-block mt-5 px-5 py-2.5 bg-[#510601] hover:bg-[#8C1801] text-white text-xs font-semibold rounded-xl transition-colors"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}