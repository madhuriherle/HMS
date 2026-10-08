import React, { useState } from 'react';
import {
  Users, UserCheck, Clock, Activity, UserX, Tag,
  UserPlus, List, CheckCircle, FileText, ArrowRight, Eye, BookOpen, Printer,
  X, MapPin, Phone, Mail, Calendar, Award, ShieldCheck, CheckCircle2, AlertCircle
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { statCards, registrationData, membershipTypeData, districtData, recentActivity } from '../data/dummyData';
import Modal from '../components/Modal';
import clsx from 'clsx';
import { Link } from 'react-router-dom';

const iconMap = {
  'users': Users,
  'user-check': UserCheck,
  'clock': Clock,
  'activity': Activity,
  'user-x': UserX,
  'tag': Tag,
  'book-open': BookOpen,
};

const MEMBERSHIP_COLORS = {
  'Poshaka': '#510601',
  'Mahaposhaka': '#F4AA26',
  'Mahapalaka': '#3D705C',
  'Sahasadasyatva': '#863221',
};

const RECENT_MEMBERS_DETAILS = {
  'MEM-001': {
    id: 'MEM-001',
    name: 'Ramesh Bhat',
    fullName: 'Ramesh Bhat',
    mobile: '9845123456',
    email: 'ramesh.bhat@gmail.com',
    district: 'Dakshina Kannada',
    districtName: 'Dakshina Kannada',
    talukName: 'Mangaluru',
    stateName: 'Karnataka',
    postalCode: '575001',
    address: 'Near Sharavu Temple, Mangaluru',
    type: 'Mahaposhaka',
    membershipType: 'Mahaposhaka',
    category: 'Individual',
    gothra: 'Vishwamitra',
    bloodGroup: 'O+',
    date: '2026-09-28',
    status: 'Approved',
    amount: '₹5,000'
  },
  'MEM-002': {
    id: 'MEM-002',
    name: 'Sujatha Hegde',
    fullName: 'Sujatha Hegde',
    mobile: '9480123456',
    email: 'sujatha.hegde@yahoo.com',
    district: 'Uttara Kannada',
    districtName: 'Uttara Kannada',
    talukName: 'Sirsi',
    stateName: 'Karnataka',
    postalCode: '581401',
    address: 'Car Street, Sirsi',
    type: 'Poshaka',
    membershipType: 'Poshaka',
    category: 'Individual',
    gothra: 'Kashyapa',
    bloodGroup: 'A+',
    date: '2026-09-28',
    status: 'Pending',
    amount: '₹2,000'
  },
  'MEM-003': {
    id: 'MEM-003',
    name: 'Ganesh Sharma',
    fullName: 'Ganesh Sharma',
    mobile: '9741234567',
    email: 'ganesh.sharma@outlook.com',
    district: 'Udupi',
    districtName: 'Udupi',
    talukName: 'Kundapura',
    stateName: 'Karnataka',
    postalCode: '576201',
    address: 'Main Road, Kundapura',
    type: 'Mahapalaka',
    membershipType: 'Mahapalaka',
    category: 'Individual',
    gothra: 'Bharadwaja',
    bloodGroup: 'B+',
    date: '2026-09-27',
    status: 'Approved',
    amount: '₹10,000'
  },
  'MEM-004': {
    id: 'MEM-004',
    name: 'Kavya Shastri',
    fullName: 'Kavya Shastri',
    mobile: '9900112233',
    email: 'kavya.shastri@gmail.com',
    district: 'Bengaluru',
    districtName: 'Bengaluru Urban',
    talukName: 'Bengaluru South',
    stateName: 'Karnataka',
    postalCode: '560004',
    address: '8th Main, Basavanagudi, Bengaluru',
    type: 'Sahasadasyatva',
    membershipType: 'Sahasadasyatva',
    category: 'Individual',
    gothra: 'Vasishta',
    bloodGroup: 'AB+',
    date: '2026-09-26',
    status: 'Inactive',
    amount: '₹1,000'
  },
  'MEM-005': {
    id: 'MEM-005',
    name: 'Narayana Upadhyaya',
    fullName: 'Narayana Upadhyaya',
    mobile: '9632587410',
    email: 'narayana.u@gmail.com',
    district: 'Shivamogga',
    districtName: 'Shivamogga',
    talukName: 'Sagara',
    stateName: 'Karnataka',
    postalCode: '577401',
    address: 'B.H. Road, Sagara',
    type: 'Poshaka',
    membershipType: 'Poshaka',
    category: 'Individual',
    gothra: 'Angirasa',
    bloodGroup: 'O+',
    date: '2026-09-25',
    status: 'Approved',
    amount: '₹2,000'
  }
};

const StatCard = ({ title, value, icon, color, trend }) => {
  const Icon = iconMap[icon] || BookOpen || Users;

  return (
    <div className="bg-white rounded-2xl p-5 border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] hover:shadow-lg transition-all h-full flex flex-col justify-between">
      <div className="flex justify-between items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-[#863221] uppercase tracking-wider mb-1 truncate" title={title}>
            {title}
          </p>
          <h3 className="text-2xl font-bold text-[#180200] tracking-tight">{value}</h3>
        </div>
        <div
          className="p-2.5 rounded-xl shrink-0 flex items-center justify-center"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icon className="h-5 w-5" style={{ color }} />
        </div>
      </div>
    </div>
  );
};

export default function Dashboard() {
  const [viewingMember, setViewingMember] = useState(null);

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const handleOpenMemberView = (item) => {
    const memberDetails = RECENT_MEMBERS_DETAILS[item.id] || {
      ...item,
      fullName: item.name,
      membershipType: item.type,
      districtName: item.district,
      mobile: '—',
      email: '—',
      gothra: '—',
      bloodGroup: '—',
      address: '—',
      stateName: 'Karnataka',
      talukName: item.district,
      postalCode: '—',
      amount: '—'
    };
    setViewingMember(memberDetails);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#180200] tracking-tight">
            Welcome to HMS
          </h1>
          <p className="text-[#863221] mt-1">Membership Management Dashboard</p>
        </div>
        <div className="bg-white px-4 py-2 rounded-lg border border-[#E8DFD8] shadow-sm text-sm font-medium text-[#180200]">
          {currentDate}
        </div>
      </div>

      {/* Stats Grid - 4 cards in a single row on desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {statCards.map((stat) => (
          <StatCard key={stat.id} {...stat} />
        ))}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-sm font-semibold text-[#180200] uppercase tracking-wider mb-4 mt-8">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <Link to="/dashboard/receipts/entry" className="flex flex-col items-center justify-center p-4 bg-white rounded-xl border border-[#E8DFD8] shadow-sm hover:border-[#510601] hover:shadow-md transition-all group h-full">
            <div className="h-10 w-10 rounded-full bg-[#510601]/10 flex items-center justify-center mb-3 group-hover:bg-[#510601] transition-colors">
              <FileText className="h-5 w-5 text-[#510601] group-hover:text-white transition-colors" />
            </div>
            <span className="text-xs font-semibold text-[#180200] text-center">Add Receipt</span>
          </Link>
          <Link to="/dashboard/membership/list" state={{ openAddModal: true }} className="flex flex-col items-center justify-center p-4 bg-white rounded-xl border border-[#E8DFD8] shadow-sm hover:border-[#3D705C] hover:shadow-md transition-all group h-full">
            <div className="h-10 w-10 rounded-full bg-[#3D705C]/10 flex items-center justify-center mb-3 group-hover:bg-[#3D705C] transition-colors">
              <UserPlus className="h-5 w-5 text-[#3D705C] group-hover:text-white transition-colors" />
            </div>
            <span className="text-xs font-semibold text-[#180200] text-center">Add Member</span>
          </Link>
          <Link to="/dashboard/receipts/labels" className="flex flex-col items-center justify-center p-4 bg-white rounded-xl border border-[#E8DFD8] shadow-sm hover:border-[#FFC107] hover:shadow-md transition-all group h-full">
            <div className="h-10 w-10 rounded-full bg-[#FFC107]/15 flex items-center justify-center mb-3 group-hover:bg-[#FFC107] transition-colors">
              <Printer className="h-5 w-5 text-[#863221] group-hover:text-[#180200] transition-colors" />
            </div>
            <span className="text-xs font-semibold text-[#180200] text-center">Print Labels</span>
          </Link>
          <Link to="/dashboard/membership/list" className="flex flex-col items-center justify-center p-4 bg-white rounded-xl border border-[#E8DFD8] shadow-sm hover:border-[#ED4636] hover:shadow-md transition-all group h-full">
            <div className="h-10 w-10 rounded-full bg-[#ED4636]/10 flex items-center justify-center mb-3 group-hover:bg-[#ED4636] transition-colors">
              <List className="h-5 w-5 text-[#ED4636] group-hover:text-white transition-colors" />
            </div>
            <span className="text-xs font-semibold text-[#180200] text-center">Member Directory</span>
          </Link>
        </div>
      </div>

      {/* Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
        {/* Trend Area Chart */}
        <div className="lg:col-span-2 bg-white p-5 sm:p-6 rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)]">
          <h2 className="text-sm font-semibold text-[#180200] uppercase tracking-wider mb-6">Membership Registrations (2026)</h2>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={registrationData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8DFD8" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#863221' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#863221' }} />
                <RechartsTooltip
                  contentStyle={{ borderRadius: '12px', border: '1px solid #E8DFD8', boxShadow: '0 4px 12px rgba(24,2,0,0.1)' }}
                  cursor={{ fill: '#FAF7F2' }}
                />
                <Bar dataKey="members" fill="#510601" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Membership Type Donut Chart */}
        <div className="lg:col-span-1 bg-white p-5 sm:p-6 rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] flex flex-col">
          <h2 className="text-sm font-semibold text-[#180200] uppercase tracking-wider mb-4">Membership by Type</h2>
          <div className="flex-1 h-[260px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={membershipTypeData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={85}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {membershipTypeData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={MEMBERSHIP_COLORS[entry.name] || '#863221'}
                    />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={{ borderRadius: '12px', border: '1px solid #E8DFD8', boxShadow: '0 4px 12px rgba(24,2,0,0.1)' }}
                  formatter={(value, name) => [`${value} Members`, name]}
                />
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#180200' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* District Chart & Recent Activity Row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-6">

        {/* District Chart */}
        <div className="xl:col-span-1 bg-white p-5 sm:p-6 rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)]">
          <h2 className="text-sm font-semibold text-[#180200] uppercase tracking-wider mb-6">District-wise Membership</h2>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={districtData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E8DFD8" />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#863221' }} />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#180200', fontWeight: 500 }} width={100} />
                <RechartsTooltip
                  cursor={{ fill: '#FAF7F2' }}
                  contentStyle={{ borderRadius: '12px', border: '1px solid #E8DFD8' }}
                />
                <Bar dataKey="count" fill="#F4AA26" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Activity Table */}
        <div className="xl:col-span-2 bg-white rounded-2xl border border-[#E8DFD8] shadow-[0_4px_12px_-2px_rgba(24,2,0,0.04)] overflow-hidden flex flex-col">
          <div className="p-5 sm:px-6 sm:py-5 border-b border-[#E8DFD8] flex justify-between items-center bg-white">
            <h2 className="text-sm font-semibold text-[#180200] uppercase tracking-wider">Recent Registrations</h2>
            <Link to="/dashboard/membership/list" className="text-xs font-semibold text-[#510601] hover:text-[#8C1801] flex items-center gap-1">
              View All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-[#FAF7F2] border-b border-[#E8DFD8]">
                  <th className="px-6 py-3.5 text-[11px] font-bold text-[#863221] uppercase tracking-wider">Member Name</th>
                  <th className="px-6 py-3.5 text-[11px] font-bold text-[#863221] uppercase tracking-wider">District</th>
                  <th className="px-6 py-3.5 text-[11px] font-bold text-[#863221] uppercase tracking-wider">Type</th>
                  <th className="px-6 py-3.5 text-[11px] font-bold text-[#863221] uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3.5 text-[11px] font-bold text-[#863221] uppercase tracking-wider text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8DFD8]/60 bg-white">
                {recentActivity.map((item) => (
                  <tr key={item.id} className="hover:bg-[#FAF7F2]/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="h-8 w-8 rounded-full bg-[#510601]/10 flex items-center justify-center text-[#510601] font-bold text-xs mr-3">
                          {item.name.charAt(0)}
                        </div>
                        <div className="text-sm font-medium text-[#180200]">{item.name}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-[#863221]">{item.district}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2.5 py-1 text-[11px] font-medium rounded-full bg-[#FFC107]/15 text-[#8C1801]">
                        {item.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={clsx(
                        "px-2.5 py-1 inline-flex text-[11px] leading-5 font-semibold rounded-full",
                        item.status === 'Approved' ? "bg-green-100 text-green-800" :
                          item.status === 'Pending' ? "bg-orange-100 text-orange-800" :
                            "bg-red-100 text-red-800"
                      )}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                      <button
                        type="button"
                        onClick={() => handleOpenMemberView(item)}
                        className="text-[#3D705C] hover:text-[#180200] transition-colors p-1.5 rounded-lg hover:bg-[#3D705C]/10 cursor-pointer"
                        title={`View ${item.name}'s Profile`}
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ==================================================== */}
      {/* VIEW MEMBER DETAILS MODAL                            */}
      {/* ==================================================== */}
      <Modal isOpen={Boolean(viewingMember)} onClose={() => setViewingMember(null)}>
        {viewingMember && (
          <div
            className="bg-white rounded-2xl max-w-2xl w-full border border-[#E8DFD8] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8DFD8] bg-[#FAF7F2]">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-[#510601] text-white flex items-center justify-center font-bold text-base shadow-sm">
                  {(viewingMember.fullName || viewingMember.name || 'M').charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-[#180200]">
                      {viewingMember.fullName || viewingMember.name}
                    </h3>
                    {viewingMember.membershipNumber && (
                      <span className="font-mono font-bold text-xs bg-white text-[#510601] px-2 py-0.5 rounded-md border border-[#E8DFD8]">
                        #{viewingMember.membershipNumber}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#863221] font-medium">
                    {viewingMember.membershipType || viewingMember.type || 'Standard'} Member
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingMember(null)}
                className="text-[#863221]/60 hover:text-[#180200] p-1.5 rounded-lg hover:bg-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Profile Body */}
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto text-xs text-[#180200]">
              {/* Card 1: Contact & Personal Info */}
              <div className="bg-[#FAF7F2]/60 rounded-xl p-4 border border-[#E8DFD8] grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Mobile</span>
                  <p className="font-mono font-bold text-sm text-[#510601] mt-0.5 flex items-center gap-1">
                    <Phone className="w-3 h-3 text-[#863221]/60" />
                    {viewingMember.mobile || '—'}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Email</span>
                  <p className="font-medium mt-0.5 truncate flex items-center gap-1" title={viewingMember.email}>
                    <Mail className="w-3 h-3 text-[#863221]/60 shrink-0" />
                    {viewingMember.email || '—'}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Status</span>
                  <p className="mt-0.5">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                        viewingMember.status === 'Approved'
                          ? 'bg-green-100 text-green-800 border border-green-200'
                          : viewingMember.status === 'Pending'
                            ? 'bg-orange-100 text-orange-800 border border-orange-200'
                            : 'bg-red-100 text-red-800 border border-red-200'
                      }`}
                    >
                      {viewingMember.status === 'Approved' && <CheckCircle2 className="w-2.5 h-2.5" />}
                      {viewingMember.status === 'Pending' && <Clock className="w-2.5 h-2.5" />}
                      {viewingMember.status === 'Inactive' && <AlertCircle className="w-2.5 h-2.5" />}
                      {viewingMember.status || 'Active'}
                    </span>
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Gotra</span>
                  <p className="font-bold text-[#180200] mt-0.5">{viewingMember.gothra || '—'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Blood Group</span>
                  <p className="font-bold text-[#180200] mt-0.5">{viewingMember.bloodGroup || '—'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Category</span>
                  <p className="font-medium text-[#180200] mt-0.5">{viewingMember.category || 'Individual'}</p>
                </div>
              </div>

              {/* Card 2: Address & Location Details */}
              <div className="bg-white rounded-xl p-4 border border-[#E8DFD8] space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#510601] uppercase tracking-wider">
                  <MapPin className="w-4 h-4" />
                  <span>Address & Geographical Details</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="sm:col-span-2">
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Street Address</span>
                    <p className="font-medium mt-0.5">{viewingMember.address || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Taluk / Area</span>
                    <p className="font-medium mt-0.5">{viewingMember.talukName || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">District & State</span>
                    <p className="font-medium mt-0.5">
                      {viewingMember.districtName || viewingMember.district || '—'}, {viewingMember.stateName || 'Karnataka'}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#863221]">Postal PIN Code</span>
                    <p className="font-mono font-bold mt-0.5 text-[#510601]">{viewingMember.postalCode || '—'}</p>
                  </div>
                </div>
              </div>

              {/* Card 3: Membership Record Details */}
              <div className="bg-[#FAF7F2]/40 rounded-xl p-4 border border-[#E8DFD8] grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Membership Type</span>
                  <p className="font-bold text-[#510601] mt-0.5 flex items-center gap-1">
                    <Award className="w-3.5 h-3.5 text-[#510601]" />
                    {viewingMember.membershipType || viewingMember.type}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Membership Fee</span>
                  <p className="font-bold text-sm text-[#180200] mt-0.5">{viewingMember.amount || '₹2,000'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#863221]">Registration Date</span>
                  <p className="font-mono font-medium mt-0.5 flex items-center gap-1 text-[#863221]">
                    <Calendar className="w-3 h-3 text-[#863221]/60" />
                    {viewingMember.date || '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-3.5 border-t border-[#E8DFD8] bg-[#FAF7F2]">
              <Link
                to="/dashboard/membership/list"
                onClick={() => setViewingMember(null)}
                className="text-xs font-semibold text-[#510601] hover:text-[#8C1801] flex items-center gap-1"
              >
                <span>Go to Membership Directory</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <button
                type="button"
                onClick={() => setViewingMember(null)}
                className="px-4 py-2 bg-[#510601] hover:bg-[#8C1801] active:bg-[#180200] text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}
