import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, User, Users, CreditCard, FileText, BookOpen, History, Phone, MapPin, Award, TrendingUp, CalendarDays } from 'lucide-react';
import PermissionGate from '../components/PermissionGate';
import api from '../api';
import { formatDate, formatDateTime } from '../utils/dateUtils';
import { apiErrorMessage } from '../utils/apiError';
import { notify } from '../utils/notify';
import { formatMoney } from '../utils/money';

const inr = formatMoney;

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

const phone = (code, number) => (number ? `${code || ''} ${number}`.trim() : '');
const yesNo = (v) => (v === true ? 'Yes' : v === false ? 'No' : '');

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

// ── one tab's data, fetched when the tab is first opened and kept while the member stays the same ──
function useSection(id, section, params) {
  const cache = useRef({});
  const [state, setState] = useState({ loading: true, data: null, error: false });
  const key = `${id}/${section}/${JSON.stringify(params || {})}`;

  useEffect(() => {
    let alive = true;
    if (cache.current[key]) {
      setState({ loading: false, data: cache.current[key], error: false });
      return undefined;
    }
    setState({ loading: true, data: null, error: false });
    api
      .get(`/members/${id}/profile/${section}`, { params })
      .then(({ data }) => {
        cache.current[key] = data;
        if (alive) setState({ loading: false, data, error: false });
      })
      .catch((error) => {
        notify(apiErrorMessage(error, 'Could not load this tab.'), 'error');
        if (alive) setState({ loading: false, data: null, error: true });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

function Loading({ state, children }) {
  if (state.loading) return <Empty>Loading…</Empty>;
  if (state.error || !state.data) return <Empty>This tab could not be loaded.</Empty>;
  return children(state.data);
}

// ── tabs ──
function PersonalTab({ id }) {
  const state = useSection(id, 'personal');
  return (
    <Loading state={state}>
      {(d) => (
        <Card icon={User} title="Personal details">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Field label="Title" value={d.name_title} />
            <Field label="First name" value={d.first_name_en} />
            <Field label="Middle name" value={d.middle_name_en} />
            <Field label="Last name" value={d.last_name_en} />
            <Field label="Name (Kannada)" value={d.full_name_kn} />
            <Field label="Gender" value={d.gender} />
            <Field label="Date of birth" value={d.date_of_birth ? formatDate(d.date_of_birth) : ''} />
            <Field label="Blood group" value={d.blood_group} />
            <Field label="Married" value={yesNo(d.is_married)} />
            <Field label="Gotra" value={d.gotra} />
            <Field label="Qualification" value={d.qualification} />
            <Field label="Occupation" value={d.occupation} />
            <Field label="Company" value={d.company} />
            <Field label="Website" value={d.website} />
            <Field label="Native place" value={d.native_place} />
            <Field label="Category" value={d.category} />
            <Field label="Aadhaar number" value={d.aadhaar_number} />
            <Field label="Applied on behalf of" value={d.applied_on_behalf_of} />
            <Field label="Registered through" value={d.registration_source} />
            <Field label="Registered on" value={d.created_at ? formatDateTime(d.created_at) : ''} />
            <div className="col-span-2 sm:col-span-3">
              <Field label="Remarks" value={d.remarks} />
            </div>
          </div>
        </Card>
      )}
    </Loading>
  );
}

function ContactTab({ id }) {
  const state = useSection(id, 'contact');
  return (
    <Loading state={state}>
      {(d) => (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card icon={Phone} title="Contact">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Mobile" value={phone(d.mobile_country_code, d.mobile)} />
              <Field label="WhatsApp" value={phone(d.whatsapp_country_code, d.whatsapp_number)} />
              <Field label="Alternate mobile" value={d.alternate_mobile} />
              <Field label="Email" value={d.email} />
            </div>
          </Card>
          <Card icon={MapPin} title="Address">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Field label="Address" value={[d.address_line1, d.address_line2].filter(Boolean).join(', ')} />
              </div>
              <div className="col-span-2">
                <Field label="Address (Kannada)" value={[d.address_line1_kn, d.address_line2_kn].filter(Boolean).join(', ')} />
              </div>
              <Field label="Locality" value={d.locality} />
              <Field label="Locality (Kannada)" value={d.locality_kn} />
              <Field label="Area" value={d.area} />
              <Field label="Place" value={d.place} />
              <Field label="Grama" value={d.grama} />
              <Field label="Village" value={d.village} />
              <Field label="Post" value={d.post} />
              <Field label="City" value={d.city} />
              <Field label="Taluk" value={d.taluk_name} />
              <Field label="District" value={d.district_name} />
              <Field label="State" value={d.state_name} />
              <Field label="PIN code" value={d.pincode} />
              <Field label="Country" value={d.country} />
              <Field label="Landmark" value={d.label_point} />
              <div className="col-span-2">
                <Field label="Address remarks" value={d.address_remarks} />
              </div>
            </div>
          </Card>
        </div>
      )}
    </Loading>
  );
}

function FamilyTab({ id }) {
  const state = useSection(id, 'family');
  const [links, setLinks] = useState({}); // membership number -> member id
  const d = state.data;

  // resolve the membership numbers written against parents / spouse / children to real members
  useEffect(() => {
    if (!d) return;
    const numbers = [
      d.father_membership_number,
      d.mother_membership_number,
      d.spouse_membership_number,
      ...(Array.isArray(d.children) ? d.children.map((c) => c.membership_number) : [])
    ].filter(Boolean);
    [...new Set(numbers)].forEach((n) => {
      api
        .get('/members/lookup', { params: { number: n } })
        .then(({ data }) => {
          if (data?.found && data.member?.id) setLinks((prev) => ({ ...prev, [n.toUpperCase()]: data.member.id }));
        })
        .catch(() => {});
    });
  }, [d]);

  return (
    <Loading state={state}>
      {(f) => {
        const children = Array.isArray(f.children) ? f.children : [];
        const hasFamily = f.father_name || f.mother_name || f.spouse_name || children.length > 0;
        const hasOther = f.family_membership_number || f.family_membership_name || f.referred_by_name || f.referred_by_number || f.referred_by;
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card icon={Users} title="Family">
              {!hasFamily ? (
                <Empty>No family details recorded.</Empty>
              ) : (
                <div>
                  {f.father_name && <Relative relation="Father" name={f.father_name} number={f.father_membership_number} links={links} />}
                  {f.mother_name && <Relative relation="Mother" name={f.mother_name} number={f.mother_membership_number} links={links} />}
                  {f.spouse_name && <Relative relation="Spouse" name={f.spouse_name} number={f.spouse_membership_number} links={links} />}
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
            <Card icon={Users} title="Family membership & referral">
              {!hasOther ? (
                <Empty>No family membership or referral recorded.</Empty>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Family membership name" value={f.family_membership_name} />
                  <Field label="Family membership no." value={f.family_membership_number} />
                  <Field label="Referred by" value={f.referred_by?.name || f.referred_by_name} />
                  <Field label="Referrer's number" value={f.referred_by?.member_code || f.referred_by_number} />
                </div>
              )}
            </Card>
          </div>
        );
      }}
    </Loading>
  );
}

function MembershipTab({ id }) {
  const state = useSection(id, 'membership');
  return (
    <Loading state={state}>
      {(d) => (
        <div className="space-y-5">
          <Card icon={CreditCard} title="Memberships">
            {d.memberships.length === 0 ? (
              <Empty>No membership yet.</Empty>
            ) : (
              d.memberships.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0 border-[#E8DFD8]/70 text-sm">
                  <div>
                    <div className="font-semibold text-[#180200]">{m.type_name_en}</div>
                    <div className="text-xs text-[#863221] font-mono">{m.membership_number || 'No number yet'}</div>
                    <div className="text-[11px] text-[#863221]">
                      {m.activated_at ? `Active from ${formatDate(m.activated_at)}` : m.applied_at ? `Applied ${formatDate(m.applied_at)}` : ''}
                    </div>
                  </div>
                  <div className="text-right text-xs text-[#863221]">
                    <div className="font-semibold">{m.status}</div>
                    {m.current_price != null && <div>Price {inr(m.current_price)}</div>}
                    {m.expires_at && <div>Valid till {formatDate(m.expires_at)}</div>}
                  </div>
                </div>
              ))
            )}
          </Card>
          <Card icon={History} title="Type changes">
            {d.type_changes.length === 0 ? (
              <Empty>No type changes recorded.</Empty>
            ) : (
              <div className="space-y-1.5 text-xs">
                {d.type_changes.map((h, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span>
                      <b>{h.old_type || '—'}</b> → <b>{h.new_type || '—'}</b>
                      {h.new_price != null ? ` (${inr(h.new_price)})` : ''}
                      {h.reason ? ` — ${h.reason}` : ''}
                    </span>
                    <span className="text-[#863221] whitespace-nowrap">{h.changed_at ? formatDate(h.changed_at) : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </Loading>
  );
}

function ReceiptsTab({ id }) {
  const [page, setPage] = useState(1);
  const state = useSection(id, 'receipts', { page, limit: 20 });
  return (
    <Loading state={state}>
      {(d) => {
        const pages = Math.max(1, Math.ceil(d.total / d.limit));
        return (
          <Card icon={FileText} title={`Receipts (${d.total})`}>
            {d.data.length === 0 ? (
              <Empty>No receipts mapped to this member.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-[#863221] border-b border-[#E8DFD8]">
                      <th className="py-2 pr-3">Receipt</th>
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Mode</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3 text-right">Receipt total</th>
                      <th className="py-2 text-right">Allocated here</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.data.map((r) => (
                      <tr key={r.receipt_id} className="border-b last:border-b-0 border-[#E8DFD8]/60">
                        <td className="py-2 pr-3 font-mono font-bold">{r.receipt_number}</td>
                        <td className="py-2 pr-3">{formatDate(r.receipt_date)}</td>
                        <td className="py-2 pr-3">{String(r.receipt_type || '').replace(/_/g, ' ')}</td>
                        <td className="py-2 pr-3">{r.payment_mode}</td>
                        <td className="py-2 pr-3">{r.payment_status}</td>
                        <td className="py-2 pr-3 text-right font-mono">{inr(r.net_amount)}</td>
                        <td className="py-2 text-right font-mono font-bold">{inr(r.allocated_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pages > 1 && (
              <div className="mt-4 flex items-center justify-between text-xs text-[#863221]">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((n) => n - 1)}
                  className="px-3 py-1.5 border border-[#E8DFD8] rounded-lg disabled:opacity-40 cursor-pointer"
                >
                  Previous
                </button>
                <span>Page {page} of {pages}</span>
                <button
                  type="button"
                  disabled={page >= pages}
                  onClick={() => setPage((n) => n + 1)}
                  className="px-3 py-1.5 border border-[#E8DFD8] rounded-lg disabled:opacity-40 cursor-pointer"
                >
                  Next
                </button>
              </div>
            )}
          </Card>
        );
      }}
    </Loading>
  );
}

function MagazineTab({ id }) {
  const state = useSection(id, 'magazine');
  return (
    <Loading state={state}>
      {(d) => (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card icon={BookOpen} title="Magazine">
            <div className="grid grid-cols-2 gap-4 mb-3">
              <Field label="Magazine needed" value={d.magazine_needed} />
            </div>
            {d.subscriptions.length === 0 ? (
              <Empty>No magazine subscription.</Empty>
            ) : (
              <div className="space-y-2 text-sm">
                {d.subscriptions.map((s) => (
                  <div key={s.id} className="border-b last:border-b-0 border-[#E8DFD8]/70 pb-2">
                    <div className="flex justify-between">
                      <span>Subscription #{s.id}</span>
                      <span className="text-xs font-semibold text-[#863221]">{s.delivery_status}</span>
                    </div>
                    {s.address_override && <div className="text-xs text-[#863221]">Deliver to: {s.address_override}</div>}
                    {s.notes && <div className="text-xs text-[#863221]">{s.notes}</div>}
                  </div>
                ))}
              </div>
            )}
            {d.returns.length > 0 && (
              <div className="mt-4">
                <div className="text-[10px] uppercase font-bold text-[#863221] tracking-wider mb-1">Returned copies</div>
                <div className="space-y-1 text-xs">
                  {d.returns.map((r) => (
                    <div key={r.id} className="flex justify-between gap-3">
                      <span>{r.issue_month_year} — {r.return_reason || 'returned'}</span>
                      <span className="text-[#863221] whitespace-nowrap">{r.return_date ? formatDate(r.return_date) : ''} · {r.follow_up_status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
          <Card icon={BookOpen} title="Other services">
            {d.services.length === 0 ? (
              <Empty>No services opted.</Empty>
            ) : (
              <div className="space-y-1.5 text-sm">
                {d.services.map((o) => (
                  <div key={o.id} className="flex justify-between">
                    <span>{o.service_name_en}</span>
                    <span className="text-xs font-semibold text-[#863221]">{o.status}{o.opted_at ? ` · ${formatDate(o.opted_at)}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </Loading>
  );
}

function EventsTab({ id }) {
  const state = useSection(id, 'events');
  return (
    <Loading state={state}>
      {(d) => (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card icon={CalendarDays} title="Events attended">
            {d.events.length === 0 ? (
              <Empty>No events recorded.</Empty>
            ) : (
              <div className="space-y-1.5 text-sm">
                {d.events.map((e, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span>{e.title}{e.role ? ` · ${e.role}` : ''}</span>
                    <span className="text-xs text-[#863221] whitespace-nowrap">{e.event_date ? formatDate(e.event_date) : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card icon={Award} title="Guest & honours">
            {d.guests_and_honours.length === 0 ? (
              <Empty>No guest or honour records.</Empty>
            ) : (
              <div className="space-y-1.5 text-sm">
                {d.guests_and_honours.map((g, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span>{g.event_title} — {g.honoured_as || g.role || g.participant_type}{g.location ? ` (${g.location})` : ''}</span>
                    <span className="text-xs text-[#863221] whitespace-nowrap">{g.event_date ? formatDate(g.event_date) : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </Loading>
  );
}

function ActivityTab({ id }) {
  const history = useSection(id, 'history');
  const [timeline, setTimeline] = useState(null);
  useEffect(() => {
    let alive = true;
    setTimeline(null);
    api
      .get(`/activity/members/${id}/timeline`, { params: { limit: 100 } })
      .then(({ data }) => alive && setTimeline(data?.data || []))
      .catch(() => alive && setTimeline([]));
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <div className="space-y-5">
      <Card icon={History} title="Activity timeline">
        {timeline === null ? (
          <Empty>Loading…</Empty>
        ) : timeline.length === 0 ? (
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

      <Card icon={History} title="Change history">
        <Loading state={history}>
          {(h) =>
            h.profile_changes.length === 0 && h.approvals.length === 0 ? (
              <Empty>No changes recorded.</Empty>
            ) : (
              <div className="space-y-1.5 text-xs">
                {h.approvals.map((a, i) => (
                  <div key={`a${i}`} className="flex justify-between gap-3">
                    <span>
                      {a.action || a.status || 'Approval'} {a.reason ? `— ${a.reason}` : ''}
                    </span>
                    <span className="text-[#863221]">{a.acted_at ? formatDate(a.acted_at) : ''}</span>
                  </div>
                ))}
                {h.profile_changes.map((c, i) => (
                  <div key={`h${i}`} className="flex justify-between gap-3">
                    <span>
                      <b>{c.field}</b>: {String(c.old_value ?? '—')} → {String(c.new_value ?? '—')}
                    </span>
                    <span className="text-[#863221]">{c.changed_at ? formatDate(c.changed_at) : ''}</span>
                  </div>
                ))}
              </div>
            )
          }
        </Loading>
      </Card>
    </div>
  );
}

const TABS = [
  { key: 'personal', label: 'Personal', icon: User, Component: PersonalTab },
  { key: 'contact', label: 'Contact & Address', icon: Phone, Component: ContactTab },
  { key: 'family', label: 'Family', icon: Users, Component: FamilyTab, count: 'family' },
  { key: 'membership', label: 'Membership', icon: CreditCard, Component: MembershipTab, count: 'membership' },
  { key: 'receipts', label: 'Receipts', icon: FileText, Component: ReceiptsTab, count: 'receipts' },
  { key: 'magazine', label: 'Magazine & Services', icon: BookOpen, Component: MagazineTab, count: 'magazine' },
  { key: 'events', label: 'Events', icon: CalendarDays, Component: EventsTab, count: 'events' },
  { key: 'activity', label: 'Activity & History', icon: History, Component: ActivityTab }
];

export default function MemberProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [photoUrl, setPhotoUrl] = useState('');

  const tabKey = TABS.some((t) => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'personal';
  const ActiveTab = TABS.find((t) => t.key === tabKey).Component;
  const openTab = useCallback(
    (key) => setSearchParams({ tab: key }, { replace: true }),
    [setSearchParams]
  );

  // the header: name, photo, status, credit and a count for each tab (one small call)
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSummary(null);
    api
      .get(`/members/${id}/profile/summary`)
      .then(({ data }) => alive && setSummary(data))
      .catch((error) => notify(apiErrorMessage(error, 'Could not load this member.'), 'error'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  // photo (a protected file: fetched as an image)
  useEffect(() => {
    setPhotoUrl('');
    if (!summary?.photo_path) return undefined;
    let url = '';
    api
      .get('/system/files', { params: { path: summary.photo_path }, responseType: 'blob' })
      .then(({ data }) => {
        url = URL.createObjectURL(data);
        setPhotoUrl(url);
      })
      .catch(() => {});
    return () => url && URL.revokeObjectURL(url);
  }, [summary?.photo_path]);

  const s = summary;
  const fullName = s ? [s.name_title, s.first_name_en, s.middle_name_en, s.last_name_en].filter(Boolean).join(' ') : '';
  const credit = s?.membership_credit;

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
        </div>

        {loading && <Empty>Loading profile…</Empty>}
        {!loading && !s && <Empty>This member could not be loaded.</Empty>}

        {s && (
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
                {s.full_name_kn && <div className="text-sm text-[#863221]">{s.full_name_kn}</div>}
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
                  {s.member_code && (
                    <span className="px-2 py-0.5 rounded-full bg-[#FAF7F2] border border-[#E8DFD8] font-mono">{s.member_code}</span>
                  )}
                  <span className="px-2 py-0.5 rounded-full bg-[#FAF7F2] border border-[#E8DFD8]">{s.approval_status}</span>
                  {s.active_membership && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800">
                      {s.active_membership.type_name_en} · {s.active_membership.status}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#863221]">
                  {s.mobile && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5" /> {phone(s.mobile_country_code, s.mobile)}
                    </span>
                  )}
                  {(s.city || s.locality) && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" /> {[s.locality, s.city, s.post].filter(Boolean).join(', ')}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase font-bold text-[#863221] tracking-wider">Paid so far</div>
                <div className="text-2xl font-bold font-mono text-[#510601]">{inr(s.paid_so_far)}</div>
                <div className="text-[11px] text-[#863221]">{s.counts.receipts} receipt(s)</div>
              </div>
            </div>

            {/* Milestone & Credit */}
            {credit && (
              <div className="bg-gradient-to-br from-[#FAF7F2] to-white rounded-2xl p-5 border border-[#510601]/20 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-[#510601] text-white">
                      <TrendingUp className="w-4 h-4" />
                    </div>
                    <span className="font-bold text-xs uppercase tracking-wider text-[#510601]">
                      Cumulative Membership Milestone & Credit
                    </span>
                  </div>
                  {credit.upgrade_pending && (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      Eligible for Upgrade
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                  <div className="bg-white p-3 rounded-xl border border-[#E8DFD8]">
                    <span className="text-[10px] uppercase font-bold text-[#863221] block">Total Credit</span>
                    <p className="font-mono font-bold text-base text-[#510601] mt-0.5">{inr(credit.credit_total)}</p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-[#E8DFD8]">
                    <span className="text-[10px] uppercase font-bold text-[#863221] block">Membership Type</span>
                    <p className="font-bold text-sm text-[#180200] mt-0.5 flex items-center gap-1">
                      <Award className="w-3.5 h-3.5 text-[#510601] shrink-0" />
                      <span>{credit.current_type?.name_en || credit.qualified_type?.name_en || 'Basic'}</span>
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-[#E8DFD8]">
                    <span className="text-[10px] uppercase font-bold text-[#863221] block">Next Milestone</span>
                    <p className="font-bold text-xs text-[#180200] mt-0.5">
                      {credit.target_type ? (
                        <span>{credit.target_type.name_en} ({inr(credit.target_type.price)})</span>
                      ) : (
                        <span className="text-emerald-700 font-semibold">Highest Tier Achieved</span>
                      )}
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-[#E8DFD8]">
                    <span className="text-[10px] uppercase font-bold text-[#863221] block">Remaining to Next</span>
                    <p className="font-mono font-bold text-sm text-[#863221] mt-0.5">
                      {credit.amount_to_target ? inr(credit.amount_to_target) : formatMoney(0)}
                    </p>
                  </div>
                </div>

                {credit.target_type && (
                  <div className="space-y-1 pt-1">
                    <div className="flex justify-between text-[10px] text-[#863221]">
                      <span>Progress to {credit.target_type.name_en}</span>
                      <span className="font-mono font-semibold">
                        {Math.min(100, Math.round((credit.credit_total / credit.target_type.price) * 100))}%
                      </span>
                    </div>
                    <div className="w-full bg-[#E8DFD8] rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-[#510601] h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, (credit.credit_total / credit.target_type.price) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tabs */}
            <div className="border-b border-[#E8DFD8] overflow-x-auto">
              <div role="tablist" className="flex gap-1 min-w-max">
                {TABS.map((t) => {
                  const count = t.count ? s.counts[t.count] : null;
                  const selected = t.key === tabKey;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => openTab(t.key)}
                      className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px cursor-pointer whitespace-nowrap transition-colors ${
                        selected
                          ? 'border-[#510601] text-[#510601]'
                          : count === 0
                            ? 'border-transparent text-[#863221]/50 hover:text-[#863221]'
                            : 'border-transparent text-[#863221] hover:text-[#510601]'
                      }`}
                    >
                      <t.icon className="w-3.5 h-3.5" />
                      {t.label}
                      {count > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-[#FAF7F2] border border-[#E8DFD8] text-[10px]">{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <ActiveTab key={`${id}-${tabKey}`} id={id} />
          </>
        )}
      </div>
    </PermissionGate>
  );
}
