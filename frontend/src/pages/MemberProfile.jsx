import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, User, Users, CreditCard, FileText, BookOpen, History, Phone, MapPin } from 'lucide-react';
import PermissionGate from '../components/PermissionGate';
import useAuth from '../hooks/useAuth';
import api from '../api';
import { formatDate, formatDateTime } from '../utils/dateUtils';
import { apiErrorMessage } from '../utils/apiError';
import { notify } from '../utils/notify';

const inr = (v) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v || 0);

const Card = ({ icon: Icon, title, children, className = '' }) => (
  <section className={`bg-white rounded-2xl border border-[#E8DFD8] shadow-sm ${className}`}>
    <header className="flex items-center gap-2 px-5 py-3 border-b border-[#E8DFD8] bg-[#FAF7F2]/60 rounded-t-2xl">
      <Icon className="w-4 h-4 text-[#863221]" />
      <h2 className="text-sm font-bold text-[#180200]">{title}</h2>
    </header>
    <div className="p-5">{children}</div>
  </section>
);

const Field = ({ label, value }) =>
  value ? (
    <div>
      <div className="text-[10px] uppercase font-bold text-[#863221] tracking-wider">{label}</div>
      <div className="text-sm text-[#180200] mt-0.5 break-words">{value}</div>
    </div>
  ) : null;

const Empty = ({ children }) => <p className="text-xs text-[#863221]/70">{children}</p>;

// A relative named on the profile: link to their own profile when their membership number is a member.
function Relative({ relation, name, number, links }) {
  const linked = number ? links[number.toUpperCase()] : null;
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0 border-[#E8DFD8]/70">
      <div>
        <div className="text-[10px] uppercase font-bold text-[#863221] tracking-wider">{relation}</div>
        <div className="text-sm font-semibold text-[#180200]">
          {name || '—'}
          {number && <span className="ml-2 font-mono text-xs font-normal text-[#863221]">{number}</span>}
        </div>
      </div>
      {linked && (
        <Link
          to={`/dashboard/membership/profile/${linked}`}
          className="text-xs font-semibold text-[#510601] border border-[#E8DFD8] rounded-lg px-2.5 py-1 hover:bg-[#FAF7F2]"
        >
          View profile
        </Link>
      )}
    </div>
  );
}

export default function MemberProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [photoUrl, setPhotoUrl] = useState('');
  const [links, setLinks] = useState({}); // membership number -> member id
  const [timeline, setTimeline] = useState([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setProfile(null);
    api
      .get(`/members/${id}/profile`)
      .then(({ data }) => alive && setProfile(data))
      .catch((error) => notify(apiErrorMessage(error, 'Could not load this member.'), 'error'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  const p = profile?.personal;

  // every recorded action on this member: who did it, when, and what changed
  useEffect(() => {
    setTimeline([]);
    api
      .get(`/activity/members/${id}/timeline`, { params: { limit: 100 } })
      .then(({ data }) => setTimeline(data?.data || []))
      .catch(() => {});
  }, [id]);

  // photo (a protected file: fetched as an image)
  useEffect(() => {
    setPhotoUrl('');
    if (!p?.photo_path) return undefined;
    let url = '';
    api
      .get('/system/files', { params: { path: p.photo_path }, responseType: 'blob' })
      .then(({ data }) => {
        url = URL.createObjectURL(data);
        setPhotoUrl(url);
      })
      .catch(() => {});
    return () => url && URL.revokeObjectURL(url);
  }, [p?.photo_path]);

  // resolve the membership numbers written against parents / spouse / children to real members
  useEffect(() => {
    if (!p) return;
    const numbers = [
      p.father_membership_number,
      p.mother_membership_number,
      p.spouse_membership_number,
      ...(Array.isArray(p.children_details) ? p.children_details.map((c) => c.membership_number) : [])
    ].filter(Boolean);
    [...new Set(numbers)].forEach((n) => {
      api
        .get('/members/lookup', { params: { number: n } })
        .then(({ data }) => {
          if (data?.found && data.member?.id) setLinks((prev) => ({ ...prev, [n.toUpperCase()]: data.member.id }));
        })
        .catch(() => {});
    });
  }, [p]);

  const fullName = p ? [p.first_name_en, p.middle_name_en, p.last_name_en].filter(Boolean).join(' ') : '';
  const children = Array.isArray(p?.children_details) ? p.children_details : [];
  const hasFamily =
    p && (p.father_name || p.mother_name || p.spouse_name || children.length > 0 || p.father_husband_name);
  const active = profile?.memberships?.find((m) => m.status === 'ACTIVE') || profile?.memberships?.[0];
  const receipts = profile?.financial?.receipts || [];
  const totalPaid = receipts.reduce((sum, r) => sum + (r.payment_status === 'CANCELLED' ? 0 : r.allocated_amount || 0), 0);

  return (
    <PermissionGate required="members.list.read">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#863221] hover:text-[#510601] cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          {p && hasPermission('members.list.write') && (
            <Link
              to={`/dashboard/membership/edit/${p.id}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#510601] rounded-xl hover:bg-[#3D0400]"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit member
            </Link>
          )}
        </div>

        {loading && <Empty>Loading profile…</Empty>}
        {!loading && !profile && <Empty>This member could not be loaded.</Empty>}

        {profile && (
          <>
            {/* Header */}
            <div className="bg-white rounded-2xl border border-[#E8DFD8] shadow-sm p-5 flex flex-wrap items-center gap-5">
              <div className="w-24 h-28 rounded-xl bg-[#FAF7F2] border border-[#E8DFD8] overflow-hidden flex items-center justify-center shrink-0">
                {photoUrl ? (
                  <img src={photoUrl} alt={fullName} className="w-full h-full object-cover" />
                ) : (
                  <User className="w-10 h-10 text-[#863221]/40" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-xl sm:text-2xl font-bold text-[#180200] tracking-tight">{fullName}</h1>
                {p.full_name_kn && <div className="text-sm text-[#863221]">{p.full_name_kn}</div>}
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
                  {p.member_code && (
                    <span className="px-2 py-0.5 rounded-full bg-[#FAF7F2] border border-[#E8DFD8] font-mono">{p.member_code}</span>
                  )}
                  <span className="px-2 py-0.5 rounded-full bg-[#FAF7F2] border border-[#E8DFD8]">{p.approval_status}</span>
                  {active && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800">
                      {active.type_name_en} · {active.status}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#863221]">
                  {p.mobile && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5" /> {p.mobile}
                    </span>
                  )}
                  {(p.city || p.district_id) && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" /> {[p.locality, p.city, p.post].filter(Boolean).join(', ')}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase font-bold text-[#863221] tracking-wider">Paid so far</div>
                <div className="text-2xl font-bold font-mono text-[#510601]">{inr(totalPaid)}</div>
                <div className="text-[11px] text-[#863221]">{receipts.length} receipt(s)</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Card icon={User} title="Personal details">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Gender" value={p.gender} />
                  <Field label="Date of birth" value={p.date_of_birth ? formatDate(p.date_of_birth) : ''} />
                  <Field label="Blood group" value={p.blood_group} />
                  <Field label="Email" value={p.email} />
                  <Field label="Occupation" value={p.occupation} />
                  <Field label="Address" value={[p.address_line1, p.address_line2, p.locality, p.city, p.post, p.pincode].filter(Boolean).join(', ')} />
                </div>
              </Card>

              <Card icon={Users} title="Family">
                {!hasFamily ? (
                  <Empty>No family details recorded.</Empty>
                ) : (
                  <div>
                    {(p.father_name || p.father_husband_name) && (
                      <Relative relation="Father" name={p.father_name || p.father_husband_name} number={p.father_membership_number} links={links} />
                    )}
                    {p.mother_name && <Relative relation="Mother" name={p.mother_name} number={p.mother_membership_number} links={links} />}
                    {p.spouse_name && <Relative relation="Spouse" name={p.spouse_name} number={p.spouse_membership_number} links={links} />}
                    {children.map((c, i) => (
                      <Relative
                        key={i}
                        relation={`Child ${i + 1}${c.gender ? ` · ${c.gender}` : ''}`}
                        name={c.name}
                        number={c.membership_number}
                        links={links}
                      />
                    ))}
                  </div>
                )}
              </Card>

              <Card icon={CreditCard} title="Memberships">
                {profile.memberships.length === 0 ? (
                  <Empty>No membership yet.</Empty>
                ) : (
                  profile.memberships.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0 border-[#E8DFD8]/70 text-sm">
                      <div>
                        <div className="font-semibold text-[#180200]">{m.type_name_en}</div>
                        <div className="text-xs text-[#863221] font-mono">{m.membership_number || 'No number yet'}</div>
                      </div>
                      <div className="text-right text-xs text-[#863221]">
                        <div className="font-semibold">{m.status}</div>
                        {m.expires_at && <div>Valid till {formatDate(m.expires_at)}</div>}
                      </div>
                    </div>
                  ))
                )}
              </Card>

              <Card icon={BookOpen} title="Magazine & services">
                {profile.services.magazine.length === 0 && profile.services.opted.length === 0 ? (
                  <Empty>No magazine subscription or services.</Empty>
                ) : (
                  <div className="space-y-1.5 text-sm">
                    {profile.services.magazine.map((s) => (
                      <div key={`m${s.id}`} className="flex justify-between">
                        <span>Magazine</span>
                        <span className="text-xs font-semibold text-[#863221]">{s.delivery_status}</span>
                      </div>
                    ))}
                    {profile.services.opted.map((o) => (
                      <div key={`o${o.id}`} className="flex justify-between">
                        <span>{o.service_name_en}</span>
                        <span className="text-xs font-semibold text-[#863221]">{o.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card icon={FileText} title="Receipts" className="lg:col-span-2">
                {receipts.length === 0 ? (
                  <Empty>No receipts mapped to this member.</Empty>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-[#863221] border-b border-[#E8DFD8]">
                          <th className="py-2 pr-3">Receipt</th>
                          <th className="py-2 pr-3">Date</th>
                          <th className="py-2 pr-3">Type</th>
                          <th className="py-2 pr-3 text-right">Receipt total</th>
                          <th className="py-2 text-right">Allocated here</th>
                        </tr>
                      </thead>
                      <tbody>
                        {receipts.map((r) => (
                          <tr key={r.receipt_id} className="border-b last:border-b-0 border-[#E8DFD8]/60">
                            <td className="py-2 pr-3 font-mono font-bold">{r.receipt_number}</td>
                            <td className="py-2 pr-3">{formatDate(r.receipt_date)}</td>
                            <td className="py-2 pr-3">{String(r.receipt_type || '').replace(/_/g, ' ')}</td>
                            <td className="py-2 pr-3 text-right font-mono">{inr(r.net_amount)}</td>
                            <td className="py-2 text-right font-mono font-bold">{inr(r.allocated_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card icon={History} title="Activity timeline" className="lg:col-span-2">
                {timeline.length === 0 ? (
                  <Empty>No activity recorded yet.</Empty>
                ) : (
                  <ol className="relative border-l border-[#E8DFD8] ml-2 space-y-3">
                    {timeline.map((e) => {
                      const changes = Object.entries(e.details?.changes || {}).filter(
                        ([k]) => !['updated_at', 'updated_by', 'created_at', 'created_by', 'is_deleted'].includes(k)
                      );
                      return (
                        <li key={e.id} className="ml-4">
                          <span className="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full bg-[#510601] border-2 border-white" />
                          <div className="text-xs font-semibold text-[#180200]">{e.description || e.action}</div>
                          <div className="text-[11px] text-[#863221]">
                            {e.acted_by_name || 'System'} · {e.created_at ? formatDateTime(e.created_at) : ''}
                            {e.module ? ` · ${e.module}` : ''}
                          </div>
                          {changes.length > 0 && (
                            <ul className="mt-1 text-[11px] text-[#180200] space-y-0.5">
                              {changes.slice(0, 6).map(([field, v]) => (
                                <li key={field}>
                                  <b>{field.replace(/_/g, ' ')}</b>: {String(v.from ?? '—')} → {String(v.to ?? '—')}
                                </li>
                              ))}
                            </ul>
                          )}
                          {e.details?.reason && <div className="text-[11px] italic text-[#863221]">Reason: {e.details.reason}</div>}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Card>

              <Card icon={History} title="History" className="lg:col-span-2">
                {profile.history.profile_changes.length === 0 && profile.history.approvals.length === 0 ? (
                  <Empty>No changes recorded.</Empty>
                ) : (
                  <div className="space-y-1.5 text-xs">
                    {profile.history.approvals.slice(0, 8).map((a, i) => (
                      <div key={`a${i}`} className="flex justify-between gap-3">
                        <span>
                          {a.action || a.status || 'Approval'} {a.reason ? `— ${a.reason}` : ''}
                        </span>
                        <span className="text-[#863221]">{a.acted_at ? formatDate(a.acted_at) : ''}</span>
                      </div>
                    ))}
                    {profile.history.profile_changes.slice(0, 12).map((h, i) => (
                      <div key={`h${i}`} className="flex justify-between gap-3">
                        <span>
                          <b>{h.field}</b>: {String(h.old_value ?? '—')} → {String(h.new_value ?? '—')}
                        </span>
                        <span className="text-[#863221]">{h.changed_at ? formatDate(h.changed_at) : ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </>
        )}
      </div>
    </PermissionGate>
  );
}
