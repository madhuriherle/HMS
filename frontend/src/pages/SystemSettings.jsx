import React from 'react';
import { Link } from 'react-router-dom';
import { Building2, ChevronRight, Database, FileText, Trash2 } from 'lucide-react';
import useAuth from '../hooks/useAuth';
import PermissionGate from '../components/PermissionGate';

// One card per admin tool. Cards the signed-in user may not open are not shown.
const CARDS = [
  {
    to: '/dashboard/master/organisation-settings',
    icon: Building2,
    title: 'Organisation Identity',
    text: 'Manage name, address, logo and contact info for receipts and reports.',
    action: 'Configure',
    allowed: ({ hasPermission }) => hasPermission('masters.organisation.read'),
  },
  {
    to: '/dashboard/system/number-formats',
    icon: FileText,
    title: 'Receipt Settings',
    text: 'Configure receipt ID format and numbering.',
    action: 'Configure',
    allowed: ({ hasPermission }) => hasPermission('system.number_formats.read'),
  },
  {
    to: '/dashboard/settings/recycle-bin',
    icon: Trash2,
    title: 'Recycle Bin',
    text: 'View, restore, or permanently delete soft-deleted records.',
    action: 'Open',
    allowed: ({ hasPermission }) => hasPermission('system.recycle_bin.read'),
  },
  {
    to: '/dashboard/settings/cleanup',
    icon: Database,
    title: 'Data Cleanup',
    text: 'Clear operational history while keeping master setup data protected.',
    action: 'Open',
    allowed: ({ hasPermission, myRank }) => myRank <= 0 && hasPermission('system.cleanup.read'),
  },
];

export default function SystemSettings() {
  const auth = useAuth();
  const cards = CARDS.filter((c) => c.allowed(auth));

  return (
    <PermissionGate required={['masters.organisation.read', 'system.number_formats.read', 'system.recycle_bin.read', 'system.cleanup.read']}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards.map(({ to, icon: Icon, title, text, action }) => (
            <Link
              key={to}
              to={to}
              className="group bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] p-5 flex flex-col gap-4 hover:border-[#510601]/40 transition-colors"
            >
              <div className="flex items-start justify-between">
                <span className="w-12 h-12 rounded-xl bg-[#FAF1EE] text-[#863221] flex items-center justify-center">
                  <Icon className="w-6 h-6" />
                </span>
                <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-[#E8DFD8] text-[11px] font-bold uppercase tracking-wider text-[#180200] group-hover:bg-[#FAF7F2]">
                  {action} <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#180200]">{title}</h2>
                <p className="text-sm text-[#863221] mt-1">{text}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </PermissionGate>
  );
}
