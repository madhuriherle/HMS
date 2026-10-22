import React, { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  User,
  Users,
  CreditCard,
  FileText,
  BookOpen,
  History,
  Phone,
  MapPin,
  Briefcase,
  Award,
  TrendingUp,
  CalendarDays,
  Pencil,
} from 'lucide-react';
import useAuth from '../hooks/useAuth';
import PermissionGate from '../components/PermissionGate';
import Modal from '../components/Modal';
import ModalFooter from '../components/ModalFooter';
import api from '../api';
import { formatDate, formatDateTime } from '../utils/dateUtils';
import { apiErrorMessage } from '../utils/apiError';
import { notify } from '../utils/notify';
import { formatMoney } from '../utils/money';
import { memberName } from '../utils/memberName';
import { fetchReceiptRow } from '../utils/apiAdapters';
import ReceiptViewModal from '../components/ReceiptViewModal';

const inr = formatMoney;

// every card on the profile has the same look: an icon chip and an uppercase title on the left, a small tag (or a
// status chip) on the right, a thin line under the header
const Card = ({ icon: Icon, title, badge = null, children, className = '' }) => (
  <section className={`bg-white rounded-2xl border border-[#EFE6DE] shadow-xs p-5 ${className}`}>
    <div className="flex items-center justify-between gap-3 border-b border-[#EFE6DE]/70 pb-3 mb-3">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-[#F7EDE6] text-[#8D4C32] flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5" />
        </div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#241B16] truncate">{title}</h3>
      </div>
      {badge}
    </div>
    {children}
  </section>
);

// a label on the left, the value on the right, a thin line between rows; an empty value is not drawn
// `stack` puts a long value (an address) under its label, left-aligned and wrapping, instead of at the right
const Field = ({ label, value, stack = false }) =>
  value ? (
    stack ? (
      <div className="py-2.5 text-xs border-b last:border-b-0 border-[#EFE6DE]/60 min-w-0">
        <span className="block text-[#7D7068] font-medium">{label}</span>
        <span className="block mt-1 font-semibold text-[#180200] break-words leading-snug">{value}</span>
      </div>
    ) : (
      <div className="py-2.5 flex items-start justify-between gap-4 text-xs border-b last:border-b-0 border-[#EFE6DE]/60 min-w-0">
        <span className="text-[#7D7068] font-medium shrink-0">{label}</span>
        <span className="font-semibold text-[#180200] text-right min-w-0 break-words">{value}</span>
      </div>
    )
  ) : null;

const Empty = ({ children }) => <p className="text-xs text-[#863221]/70">{children}</p>;

const phone = (code, number) => (number ? `${code || ''} ${number}`.trim() : '');

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
  const [version, setVersion] = useState(0);
  const key = `${id}/${section}/${JSON.stringify(params || {})}`;

  const reload = useCallback(() => {
    delete cache.current[key];
    setVersion((v) => v + 1);
  }, [key]);

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

  useEffect(() => { /* refetches after a local change when cache was cleared */
    if (!cache.current[key]) {
      api
        .get(`/members/${id}/profile/${section}`, { params })
        .then(({ data }) => {
          cache.current[key] = data;
          setState({ loading: false, data, error: false });
        })
        .catch((error) => notify(apiErrorMessage(error, 'Could not load this tab.'), 'error'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return { ...state, reload };
}

function Loading({ state, children }) {
  if (state.loading) return <Empty>Loading…</Empty>;
  if (state.error || !state.data) return <Empty>This tab could not be loaded.</Empty>;
  return children(state.data);
}

// The credit and next-milestone box.
function CreditBanner({ credit }) {
  if (!credit) return null;
  return (
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
                      <span>{credit.current_type?.name_en || ''}</span>
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
            
  );
}

// ── tabs ──

// ── Overview: one neat card per section ──
const initialOf = (name) => String(name || '?').trim().charAt(0).toUpperCase();


function OverviewTab({ id }) {
  const state = useSection(id, 'overview');
  return (
    <Loading state={state}>
      {(d) => {
        const b = d.basic;
        const c = d.contact;
        const m = d.membership;
        const f = d.family;
        const credit = m.credit;
        const target = credit?.target_type;
        const pct = target?.price ? Math.min(100, Math.round((credit.credit_total / target.price) * 100)) : 100;
        const since = m.current?.activated_at || m.current?.applied_at;
        const personal = [
          ['Gender', b.gender],
          ['Date of birth', b.date_of_birth ? formatDate(b.date_of_birth) : ''],
          ['Blood group', b.blood_group],
          ['Gotra', b.gotra],
          ['Qualification', b.qualification],
          ['Occupation', b.occupation],
          ['Native place', b.native_place]
        ];
        const contact = [
          ['Mobile', phone(c.mobile_country_code, c.mobile)],
          ['WhatsApp', phone(c.whatsapp_country_code, c.whatsapp_number)],
          ['Email', c.email],
          ['Address', c.address]
        ];
        const relatives = [
          ['Father', f.father_name, f.father_membership_number],
          ['Mother', f.mother_name, f.mother_membership_number],
          ['Spouse', f.spouse_name, f.spouse_membership_number]
        ].filter(([, name]) => name);
        const hasMagazine = d.magazine.magazine_needed || d.magazine.subscriptions.length > 0 || d.magazine.services.length > 0;

        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <Panel
              icon={CreditCard}
              title="Membership"
              tag={m.current ? <span className={`chip ${m.current.status === 'ACTIVE' ? 'chip-on' : 'chip-off'}`}>{m.current.status}</span> : 'Plan'}
            >
              {!m.current ? (
                <Row label="Status">No membership yet</Row>
              ) : (
                <>
                  <Row label="Type">{m.current.type_name_en}</Row>
                  <Row label="Membership number">{m.current.membership_number || 'Given on approval'}</Row>
                  <Row label="Member since">{since ? formatDate(since) : ''}</Row>
                  <Row label="Valid till">{m.current.expires_at ? formatDate(m.current.expires_at) : ''}</Row>
                  <Row label="Receipts">{d.receipts.total ? `${d.receipts.total} · last ${formatDate(d.receipts.latest[0]?.receipt_date)}` : 'None yet'}</Row>
                  <div className="py-2.5 text-xs">
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-[#7D7068] font-medium">Credit</span>
                      <span className="font-semibold font-mono text-[#180200]">
                        {inr(credit?.credit_total || 0)}
                        {target && <span className="font-normal text-[#863221]"> / {inr(target.price)}</span>}
                      </span>
                    </div>
                    <div className="mt-1.5 w-full bg-[#E8DFD8] rounded-full h-1.5 overflow-hidden">
                      <div className="bg-[#510601] h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="block mt-1 text-[11px] text-[#863221]">{target ? `${pct}% to ${target.name_en}` : 'Highest tier reached'}</span>
                  </div>
                </>
              )}
            </Panel>

            <Panel icon={User} title="Personal" tag="Core data">
              {personal.map(([label, value]) => <Row key={label} label={label}>{value}</Row>)}
            </Panel>

            <Panel icon={Phone} title="Contact" tag="Reach">
              {contact.filter(([label]) => label !== 'Address').map(([label, value]) => <Row key={label} label={label}>{value}</Row>)}
            </Panel>

            <Panel icon={MapPin} title="Address" tag="Location">
              <Row label="Address" stack>{c.address}</Row>
            </Panel>

            <Panel icon={Users} title="Family" tag="Relations">
              {relatives.length === 0 && f.children_count === 0 ? (
                <Row label="Family">Not provided yet</Row>
              ) : (
                <>
                  {relatives.map(([relation, name, number]) => (
                    <Row key={relation} label={relation}>{[name, number].filter(Boolean).join(' · ')}</Row>
                  ))}
                  {f.children_count > 0 && <Row label="Children">{`${f.children_count} ${f.children_count === 1 ? 'child' : 'children'}`}</Row>}
                </>
              )}
            </Panel>

            {hasMagazine && (
              <Panel icon={BookOpen} title="Magazine & services" tag="Subscriptions">
                {d.magazine.subscriptions.map((st, i) => (
                  <Row key={`s${i}`} label="Magazine">
                    <span className={`chip ${String(st).toUpperCase() === 'ACTIVE' ? 'chip-on' : 'chip-off'}`}>{st}</span>
                  </Row>
                ))}
                {d.magazine.services.map((sv, i) => <Row key={`v${i}`} label="Service">{sv}</Row>)}
              </Panel>
            )}

            <Panel icon={History} title="Recent activity" tag="Latest" className="lg:col-span-2">
              {d.activity.length === 0 ? (
                <Row label="Activity">No activity recorded yet</Row>
              ) : (
                d.activity.map((e) => (
                  <div key={e.id} className="py-2.5 flex items-start justify-between gap-4 text-xs">
                    <span className="font-semibold text-[#180200] min-w-0 break-words">{e.description}</span>
                    <span className="text-[#7D7068] font-mono shrink-0 text-right">
                      {e.acted_by_name || 'System'} · {e.created_at ? formatDateTime(e.created_at) : ''}
                    </span>
                  </div>
                ))
              )}
            </Panel>
          </div>
        );
      }}
    </Loading>
  );
}

// a label / value row for the key-value panels; an empty value is not drawn
const Row = ({ label, children, stack = false }) =>
  children ? (
    stack ? (
      <div className="py-2.5 text-xs">
        <dt className="text-[#7D7068] font-medium">{label}</dt>
        <dd className="mt-1 font-semibold text-[#180200] break-words leading-snug">{children}</dd>
      </div>
    ) : (
      <div className="py-2.5 flex items-start justify-between gap-4 text-xs">
        <dt className="text-[#7D7068] font-medium shrink-0">{label}</dt>
        <dd className="font-semibold text-[#180200] text-right min-w-0 break-words">{children}</dd>
      </div>
    )
  ) : null;

const Panel = ({ icon: Icon, title, tag, children, className = '' }) => (
  <section className={`bg-white rounded-2xl border border-[#EFE6DE] shadow-xs p-5 ${className}`}>
    <div className="flex items-center justify-between border-b border-[#EFE6DE]/70 pb-3 mb-1">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-[#F7EDE6] text-[#8D4C32] flex items-center justify-center">
          <Icon className="w-3.5 h-3.5" />
        </div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-[#241B16]">{title}</h4>
      </div>
      {tag && <span className="text-[10px] text-[#A89B92] font-medium">{tag}</span>}
    </div>
    <dl className="divide-y divide-[#EFE6DE]/50">{children}</dl>
  </section>
);

const ageOf = (iso) => {
  const born = iso ? new Date(iso) : null;
  if (!born || Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  if (now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())) age -= 1;
  return age >= 0 ? age : null;
};

// who the mobile number belongs to (the form's "Belongs To / Relation"); nothing is shown for Self
const belongsTo = (v) => (v && String(v).trim().toLowerCase() !== 'self' ? v : '');

const groupAadhaar = (v) => (/^\d{12}$/.test(String(v || '')) ? String(v).replace(/(\d{4})(?=\d)/g, '$1 ') : v);

// Personal details, contact & address and family on one screen
function PersonalTab({ id }) {
  const personal = useSection(id, 'personal');
  const contact = useSection(id, 'contact');
  const family = useSection(id, 'family');
  const [links, setLinks] = useState({}); // membership number -> member id
  const fam = family.data;

  // resolve the membership numbers written against parents / spouse / children to real members
  useEffect(() => {
    if (!fam) return;
    const numbers = [
      fam.father_membership_number,
      fam.mother_membership_number,
      fam.spouse_membership_number,
      ...(Array.isArray(fam.children) ? fam.children.map((c) => c.membership_number) : [])
    ].filter(Boolean);
    [...new Set(numbers)].forEach((n) => {
      api
        .get('/members/lookup', { params: { number: n } })
        .then(({ data }) => {
          if (data?.found && data.member?.id) setLinks((prev) => ({ ...prev, [n.toUpperCase()]: data.member.id }));
        })
        .catch(() => {});
    });
  }, [fam]);

  const p = personal.data;
  const c = contact.data;
  const children = Array.isArray(fam?.children) ? fam.children : [];
  const hasFamily = fam && (fam.father_name || fam.mother_name || fam.spouse_name || children.length > 0);
  const age = p ? ageOf(p.date_of_birth) : null;
  const chip = 'px-2 py-0.5 rounded text-[11px] bg-[#F7EDE6] text-[#8D4C32]';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel icon={User} title="Identity & Bio" tag="Core data">
          {personal.loading ? <Empty>Loading…</Empty> : !p ? <Empty>This section could not be loaded.</Empty> : (
            <>
              <Row label="Full name">{[p.name_title, p.first_name_en, p.middle_name_en, p.last_name_en].filter(Boolean).join(' ')}</Row>
              <Row label="Name (Kannada)">{p.full_name_kn}</Row>
              <Row label="Gender">{p.gender}</Row>
              <Row label="Date of birth">
                {p.date_of_birth && (
                  <>{formatDate(p.date_of_birth)}{age !== null && <span className="ml-1 font-normal text-[#A89B92]">({age} yrs)</span>}</>
                )}
              </Row>
              <Row label="Blood group">
                {p.blood_group && <span className="px-2 py-0.5 rounded-md bg-red-50 border border-red-100 text-red-600 font-bold">{p.blood_group}</span>}
              </Row>
              <Row label="Marital status">{p.is_married === true ? 'Married' : p.is_married === false ? 'Unmarried' : ''}</Row>
              <Row label="Aadhaar number">
                {p.aadhaar_number && <span className="font-mono text-[11px] px-2 py-0.5 rounded border border-stone-200 bg-stone-50">{groupAadhaar(p.aadhaar_number)}</span>}
              </Row>
            </>
          )}
        </Panel>

        <Panel icon={Briefcase} title="Community & Vocation" tag="Affiliation">
          {personal.loading ? <Empty>Loading…</Empty> : !p ? null : (
            <>
              <Row label="Gotra">{p.gotra}</Row>
              <Row label="Native place">{p.native_place}</Row>
              <Row label="Qualification">{p.qualification}</Row>
              <Row label="Occupation">{p.occupation}</Row>
              <Row label="Company">{p.company}</Row>
              <Row label="Website">{p.website}</Row>
              <Row label="Category">{p.category}</Row>
            </>
          )}
        </Panel>

        <Panel icon={Phone} title="Contact" tag="Reach">
          {contact.loading ? <Empty>Loading…</Empty> : !c ? <Empty>This section could not be loaded.</Empty> : (
            <>
              <Row label="Mobile">{phone(c.mobile_country_code, c.mobile)}</Row>
              {/* whose number it is ("Belongs To / Relation" on the form); "Self" is the normal case and says nothing */}
              <Row label="Mobile belongs to">{belongsTo(p?.applied_on_behalf_of)}</Row>
              <Row label="WhatsApp">{phone(c.whatsapp_country_code, c.whatsapp_number)}</Row>
              <Row label="Alternate mobile">{c.alternate_mobile}</Row>
              <Row label="Email">{c.email}</Row>
            </>
          )}
        </Panel>

        <Panel icon={MapPin} title="Address" tag="Location">
          {contact.loading ? <Empty>Loading…</Empty> : !c ? null : (
            <>
              <Row label="Address" stack>{[c.address_line1, c.address_line2].filter(Boolean).join(', ')}</Row>
              <Row label="Address (Kannada)">{[c.address_line1_kn, c.address_line2_kn].filter(Boolean).join(', ')}</Row>
              <Row label="Locality">{[c.locality, c.locality_kn].filter(Boolean).join(' / ')}</Row>
              <Row label="Area">{c.area}</Row>
              <Row label="Place">{c.place}</Row>
              <Row label="Grama">{c.grama}</Row>
              <Row label="Village">{c.village}</Row>
              <Row label="Post">{c.post}</Row>
              <Row label="City">{c.city}</Row>
              <Row label="Taluk">{c.taluk_name}</Row>
              <Row label="District">{c.district_name}</Row>
              <Row label="State">{c.state_name}</Row>
              <Row label="PIN code">{c.pincode}</Row>
              <Row label="Country">{c.country}</Row>
              <Row label="Landmark">{c.label_point}</Row>
              <Row label="Address remarks">{c.address_remarks}</Row>
            </>
          )}
        </Panel>
      </div>

      <Card icon={Users} title="Family">
        {family.loading ? (
          <Empty>Loading…</Empty>
        ) : !fam ? (
          <Empty>This section could not be loaded.</Empty>
        ) : !hasFamily ? (
          <Empty>No family details recorded.</Empty>
        ) : (
          <div>
            {fam.father_name && <Relative relation="Father" name={fam.father_name} number={fam.father_membership_number} links={links} />}
            {fam.mother_name && <Relative relation="Mother" name={fam.mother_name} number={fam.mother_membership_number} links={links} />}
            {fam.spouse_name && <Relative relation="Spouse" name={fam.spouse_name} number={fam.spouse_membership_number} links={links} />}
            {children.map((ch, i) => (
              <Relative
                key={i}
                relation={`Child ${i + 1}${ch.gender ? ` · ${ch.gender}` : ''}`}
                name={ch.name}
                number={ch.membership_number}
                links={links}
              />
            ))}
          </div>
        )}
      </Card>

      {p && (p.registration_source || p.created_at || p.remarks) && (
        <div className="bg-white rounded-2xl border border-[#EFE6DE] shadow-xs p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#7D7068]">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <span>
              Registration: <strong className="text-[#241B16]">{p.registration_source || '—'}</strong>
              {p.created_at && <> on <strong className="text-[#241B16]">{formatDateTime(p.created_at)}</strong></>}
            </span>
          </div>
          {p.remarks && <span className="text-[11px] text-[#A89B92]">Remarks: {p.remarks}</span>}
        </div>
      )}
    </div>
  );
}

function MembershipTab({ id }) {
  const state = useSection(id, 'membership');
  return (
    <Loading state={state}>
      {(d) => (
        <div className="space-y-5">
          <CreditBanner credit={d.membership_credit} />
          {d.approval && (
            <Card icon={User} title="Registration & approval">
              <dl className="divide-y divide-[#EFE6DE]/50 text-xs">
                <Row label="Status">{d.approval.status}</Row>
                <Row label="Registered on">{d.approval.registered_at ? formatDateTime(d.approval.registered_at) : '—'}</Row>
                <Row label="Registered by">{d.approval.registered_by || '—'}</Row>
                <Row label="Approved on">{d.approval.approved_at ? formatDateTime(d.approval.approved_at) : '—'}</Row>
                <Row label="Approved by">{d.approval.approved_by || '—'}</Row>
              </dl>
            </Card>
          )}
          <Card icon={CreditCard} title="Memberships">
            {d.memberships.length === 0 ? (
              <Empty>No membership yet.</Empty>
            ) : (
              d.memberships.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0 border-[#E8DFD8]/70 text-sm">
                  <div>
                    <div className="font-semibold text-[#180200]">{m.type_name_en}</div>
                    <div className="text-xs text-[#863221] font-mono">{m.membership_number || 'No number yet'}</div>
                    {m.family_membership_number && <div className="text-[11px] text-[#863221]">Family no. {m.family_membership_number}</div>}
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
                      {h.receipt_number ? ` · Receipt ${h.receipt_number}` : ''}
                      {h.changed_by ? ` · by ${h.changed_by}` : ''}
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
  const [viewing, setViewing] = useState(null); // the receipt open in the view popup
  const [opening, setOpening] = useState(null); // the receipt whose details are being read
  // the popup shows the same details as Receipt Tracking: read that receipt (with its particulars) from the server
  const openReceipt = async (r) => {
    setOpening(r.receipt_id);
    try {
      const row = await fetchReceiptRow({ id: r.receipt_id, number: r.receipt_number, memberId: id });
      if (!row) throw new Error('not found');
      setViewing(row);
    } catch (error) {
      notify(apiErrorMessage(error, 'Could not open this receipt.'), 'error');
    } finally {
      setOpening(null);
    }
  };
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
                      <th className="py-2 pr-3 text-right">Allocated here</th>
                      <th className="py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.data.map((r) => {
                      const bits = [
                        r.transaction_reference && `Ref ${r.transaction_reference}`,
                        r.bank_account && `Bank ${r.bank_account}`,
                        r.cheque_number && `Cheque ${r.cheque_number}${r.cheque_date ? ` (${formatDate(r.cheque_date)})` : ''}`,
                        r.transaction_date && `Paid on ${formatDate(r.transaction_date)}`,
                        r.period_from_date && `Period ${formatDate(r.period_from_date)}${r.period_to_date ? ` to ${formatDate(r.period_to_date)}` : ''}`,
                        r.discount_amount > 0 && `Discount ${inr(r.discount_amount)}`,
                        r.receipt_status && `Receipt ${String(r.receipt_status).replace(/_/g, ' ').toLowerCase()}`,
                        r.notes && `Note: ${r.notes}`,
                      ].filter(Boolean);
                      return (
                      <Fragment key={r.receipt_id}>
                      <tr className="border-b last:border-b-0 border-[#E8DFD8]/60">
                        <td className="py-2 pr-3 font-mono font-bold">{r.receipt_number}</td>
                        <td className="py-2 pr-3">{formatDate(r.receipt_date)}</td>
                        <td className="py-2 pr-3">{String(r.receipt_type || '').replace(/_/g, ' ')}</td>
                        <td className="py-2 pr-3">{r.payment_mode}</td>
                        <td className="py-2 pr-3">{r.payment_status}</td>
                        <td className="py-2 pr-3 text-right font-mono">{inr(r.net_amount)}</td>
                        <td className="py-2 pr-3 text-right font-mono font-bold">{inr(r.allocated_amount)}</td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() => openReceipt(r)}
                            disabled={opening === r.receipt_id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#E8DFD8] text-[#510601] font-semibold hover:bg-[#FAF7F2] disabled:opacity-50 cursor-pointer"
                            title="View this receipt"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>{opening === r.receipt_id ? 'Opening…' : 'View'}</span>
                          </button>
                        </td>
                      </tr>
                      {bits.length > 0 && (
                        <tr className="border-b last:border-b-0 border-[#E8DFD8]/60">
                          <td colSpan={8} className="pb-2 pr-3 text-[11px] text-[#863221]">{bits.join(' · ')}</td>
                        </tr>
                      )}
                      </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <ReceiptViewModal receipt={viewing} onClose={() => setViewing(null)} />
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
  const { hasPermission } = useAuth();
  const section = useSection(id, 'magazine');
  return (
    <Loading state={section}>
      {(d) => (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <KycUpdateCard id={id} kyc={d.kyc} reload={section.reload} canSend={hasPermission('magazines.write')} />
          {(() => {
            // active when any subscription is running; the delivery address is the one set for the magazine, else a subscription's own
            const isActive = d.subscriptions.some((s) => s.delivery_status === 'ACTIVE');
            const address = d.magazine_delivery_address || d.subscriptions.find((s) => s.address_override)?.address_override || '';
            return (
          <Card
            icon={BookOpen}
            title="Magazine"
            className="lg:col-span-2"
            badge={<span className={`chip ${isActive ? 'chip-on' : 'chip-off'}`}>{isActive ? 'Active' : 'Inactive'}</span>}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 mb-3">
              {d.magazine_kind && (
                <Field
                  label="Magazine type"
                  value={{ PHYSICAL: 'Physical copy', EMAIL: 'E-copy' }[d.magazine_kind] || d.magazine_kind}
                />
              )}
              {d.magazine_email && <Field label="E-copy email" value={d.magazine_email} />}
              <div className="lg:col-span-2">
                <Field label="Delivery address" value={address || d.member_address || 'No address on record'} stack />
                {!address && d.member_address && <p className="text-[11px] text-[#863221] -mt-1 mb-2">Same as the member address (no separate delivery address set).</p>}
              </div>
            </div>
            {(d.subscriptions || []).length > 0 && (
              <div className="mt-4">
                <div className="text-[10px] uppercase font-bold text-[#863221] tracking-wider mb-1">Subscription</div>
                <div className="space-y-1 text-xs">
                  {d.subscriptions.map((sb) => (
                    <div key={sb.id} className="flex justify-between gap-3">
                      <span>{sb.delivery_status}{sb.notes ? ` — ${sb.notes}` : ''}</span>
                      <span className="text-[#863221] whitespace-nowrap">
                        {sb.started_on ? `Started ${formatDate(sb.started_on)}` : ''}{sb.started_by ? ` by ${sb.started_by}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4">
              <div className="text-[10px] uppercase font-bold text-[#863221] tracking-wider mb-1">Start / stop history</div>
              <div className="space-y-1 text-xs">
                {(d.subscription_log || []).length === 0 && <p className="text-[#863221]/70">No changes recorded.</p>}
                {(d.subscription_log || []).map((l, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span>{l.what}{l.reason ? ` — ${l.reason}` : ''}{l.by ? ` · by ${l.by}` : ''}</span>
                    <span className="text-[#863221] whitespace-nowrap">{l.at ? formatDateTime(l.at) : ''}</span>
                  </div>
                ))}
              </div>
            </div>
            {(
              <div className="mt-4">
                <div className="text-[10px] uppercase font-bold text-[#863221] tracking-wider mb-1">Delivery history</div>
                <div className="space-y-1 text-xs">
                  {(d.issues || []).length === 0 && <p className="text-[#863221]/70">No deliveries yet.</p>}
                  {d.issues.map((i) => (
                    <div key={i.issue_month_year}>
                      <div className="flex justify-between gap-3">
                        <span>{i.issue_month_year} — {{ SENT: 'Sent', RETURNED: 'Returned', PAUSED: 'Paused', LISTED: 'On label list', NOT_LISTED: 'Not listed' }[i.result] || i.result}</span>
                        <span className="text-[#863221] whitespace-nowrap">{[i.date ? formatDate(i.date) : '', i.detail].filter(Boolean).join(' · ')}</span>
                      </div>
                      {i.label_address && <div className="text-[11px] text-[#863221] whitespace-pre-line pl-3">Label address: {i.label_address}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(
              <div className="mt-4">
                <div className="text-[10px] uppercase font-bold text-[#863221] tracking-wider mb-1">Delivery pauses</div>
                <div className="space-y-1 text-xs">
                  {(d.pauses || []).length === 0 && <p className="text-[#863221]/70">No pauses.</p>}
                  {d.pauses.map((p) => (
                    <div key={p.id} className="flex justify-between gap-3">
                      <span>{p.reason || 'paused'}{p.recorded_by ? ` · by ${p.recorded_by}` : ''}</span>
                      <span className="text-[#863221] whitespace-nowrap">
                        {formatDate(p.pause_start_date)} – {p.pause_end_date ? formatDate(p.pause_end_date) : 'open'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(
              <div className="mt-4">
                <div className="text-[10px] uppercase font-bold text-[#863221] tracking-wider mb-1">Returned copies</div>
                <div className="space-y-1 text-xs">
                  {d.returns.length === 0 && <p className="text-[#863221]/70">No returns.</p>}
                  {d.returns.map((r) => (
                    <div key={r.id} className="flex justify-between gap-3">
                      <span>{r.issue_month_year} — {r.return_reason || 'returned'}{r.recorded_by ? ` · by ${r.recorded_by}` : ''}</span>
                      <span className="text-[#863221] whitespace-nowrap">{r.return_date ? formatDate(r.return_date) : ''} · {r.follow_up_status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
            );
          })()}
        </div>
      )}
    </Loading>
  );
}

// ── Services tab: what the member is opted into and what they have actually used ──
function ServicesTab({ id }) {
  const { hasPermission } = useAuth();
  const section = useSection(id, 'services');
  return (
    <Loading state={section}>
      {(d) => (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <ServiceOptinsCard id={id} data={d} reload={section.reload} canWrite={hasPermission('members.write')} />
          <Card icon={FileText} title="Services used">
            <UsedServicesBlock usage_summary={d.usage_summary} usage={d.usage} />
          </Card>
        </div>
      )}
    </Loading>
  );
}

// one card: the service opt-ins of this member, and the opt-in action (members.write)
function ServiceOptinsCard({ id, data, reload, canWrite }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(null); // optin row
  const [cancelReason, setCancelReason] = useState('');

  const active = data.optins.filter((o) => o.status === 'ACTIVE');
  const cancelled = data.optins.filter((o) => o.status !== 'ACTIVE');

  const optIn = () => {
    if (!serviceTypeId) return;
    setBusy(true);
    api
      .post(`/members/${id}/service-optins`, { service_type_id: Number(serviceTypeId), notes: notes.trim() || undefined })
      .then(({ data: res }) => {
        setModalOpen(false);
        notify(res?.status === 'PENDING' ? 'Sent for approval.' : 'Member opted into the service.', 'success');
        setServiceTypeId('');
        setNotes('');
        if (reload) reload();
      })
      .catch((error) => notify(apiErrorMessage(error, 'The opt-in could not be saved.'), 'error'))
      .finally(() => setBusy(false));
  };

  // Withdraw = PUT status CANCELLED (keeps the history and shows as Cancelled);
  // the typed reason is recorded in the opt-in's notes.
  const cancelOptIn = () => {
    if (!cancelling) return;
    setBusy(true);
    const reason = cancelReason.trim();
    const newNotes = [cancelling.notes, reason && `Cancelled: ${reason}`].filter(Boolean).join(' | ');
    api
      .put(`/members/${id}/service-optins/${cancelling.id}`, { status: 'CANCELLED', notes: newNotes || undefined })
      .then(({ data: res }) => {
        setCancelling(null);
        setCancelReason('');
        notify(res?.status === 'PENDING' ? 'Cancellation sent for approval.' : 'Service cancelled.', 'success');
        if (reload) reload();
      })
      .catch((error) => notify(apiErrorMessage(error, 'The cancellation could not be saved.'), 'error'))
      .finally(() => setBusy(false));
  };

  const row = (o, done = false) => (
    <div key={o.id} className={`flex items-center justify-between gap-3 border-b last:border-b-0 border-[#E8DFD8]/70 pb-2 ${done ? 'opacity-60' : ''}`}>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[#180200] truncate">{o.service_name_en}</div>
        <div className="text-xs text-[#863221]">
          {o.status}{o.opted_at ? ` · ${formatDate(o.opted_at)}` : ''}{o.opted_via ? ` · via ${o.opted_via}` : ''}{o.notes ? ` · ${o.notes}` : ''}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        <span className={`chip ${o.status === 'ACTIVE' ? 'chip-on' : 'chip-off'}`}>{o.status === 'ACTIVE' ? 'Active' : 'Cancelled'}</span>
        {canWrite && o.status === 'ACTIVE' && (
          <button
            type="button"
            onClick={() => { setCancelling(o); setCancelReason(''); }}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-[#ED4636] text-[#ED4636] hover:bg-[#ED4636]/5 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );

  const needsReason = (value) => (value || '').trim().length >= 3;

  return (
    <Card icon={MapPin} title="Services opted" badge={<span className="chip chip-on">{active.length} active</span>}>
      {data.optins.length === 0 ? (
        <Empty>No services opted.</Empty>
      ) : (
        <div className="space-y-2">
          {active.map((o) => row(o))}
          {cancelled.length > 0 && (
            <div className="pt-2 mt-1 border-t border-[#E8DFD8]">
              <div className="text-[10px] uppercase font-bold text-[#863221]/70 tracking-wider mb-1">Cancelled</div>
              <div className="space-y-2">{cancelled.map((o) => row(o, true))}</div>
            </div>
          )}
        </div>
      )}
      <Modal isOpen={modalOpen} onClose={() => !busy && setModalOpen(false)}>
        <div className="bg-white rounded-2xl max-w-md w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col">
          <div className="h-14 shrink-0 flex items-center justify-between px-6 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
            <span className="text-sm font-bold text-[#180200]">Opt into a Service</span>
            <button type="button" onClick={() => setModalOpen(false)} disabled={busy} className="text-[#863221] hover:text-[#510601]" aria-label="Close">✕</button>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); optIn(); }}
            className="p-6 space-y-4"
          >
            <label className="block">
              <span className="block text-[11px] font-semibold text-[#180200] mb-1">Service</span>
              <select
                value={serviceTypeId}
                onChange={(e) => setServiceTypeId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm border border-[#E8DFD8] bg-white focus:border-[#510601] outline-none"
              >
                <option value="">Choose a service…</option>
                {data.available.map((s) => (
                  <option key={s.id} value={s.id}>{s.name_en}{s.name_kn ? ` · ${s.name_kn}` : ''}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-[#180200] mb-1">Notes (optional)</span>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm border border-[#E8DFD8] bg-white focus:border-[#510601] outline-none"
              />
            </label>
            <ModalFooter kind="add" busy={busy} inForm onCancel={() => setModalOpen(false)} />
          </form>
        </div>
      </Modal>

      <Modal isOpen={Boolean(cancelling)} onClose={() => !busy && setCancelling(null)}>
        <div className="bg-white rounded-2xl max-w-md w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col">
          <div className="h-14 shrink-0 flex items-center justify-between px-6 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
            <span className="text-sm font-bold text-[#180200]">Cancel {cancelling?.service_name_en}?</span>
            <button type="button" onClick={() => setCancelling(null)} disabled={busy} className="text-[#863221] hover:text-[#510601]" aria-label="Close">✕</button>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); cancelOptIn(); }}
            className="p-6 space-y-4"
          >
            <p className="text-xs text-[#863221]">
              The member stops receiving this service. What they already paid stays on record.
            </p>
            <label className="block">
              <span className="block text-[11px] font-semibold text-[#180200] mb-1">Reason</span>
              <input
                type="text"
                autoFocus
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm border border-[#E8DFD8] bg-white focus:border-[#ED4636] outline-none"
              />
            </label>
            <ModalFooter kind="delete" submitLabel="Cancel Service" disabled={!needsReason(cancelReason)} title={needsReason(cancelReason) ? undefined : 'Give a short reason first'} busy={busy} inForm onCancel={() => setCancelling(null)} />
          </form>
        </div>
      </Modal>
    </Card>
  );
}

// the receipt-sourced "what they used" block (shared by the Services tab layout)
function UsedServicesBlock({ usage_summary, usage }) {
  return (
    <>
      {(!usage_summary || usage_summary.length === 0) ? (
        <Empty>No paid service on record yet.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            {usage_summary.map((s) => (
              <span key={s.service_code} className="chip chip-on" title={`${s.times} time(s)`}>
                {s.service_name_en} · {s.times} · {formatMoney(s.total_amount)}{s.last_used ? ` · till ${formatDate(s.last_used)}` : ''}
              </span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-[#863221]">
                  <th className="py-2 pr-3 font-bold">Service</th>
                  <th className="py-2 pr-3 font-bold">Particular</th>
                  <th className="py-2 pr-3 font-bold">Receipt</th>
                  <th className="py-2 pr-3 font-bold">Date</th>
                  <th className="py-2 pr-3 font-bold text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u, i) => (
                  <tr key={`${u.receipt_id}-${i}`} className="border-t border-[#E8DFD8]/70">
                    <td className="py-2 pr-3">{u.service_name_en}</td>
                    <td className="py-2 pr-3">{u.particular_name}{u.description ? ` — ${u.description}` : ''}</td>
                    <td className="py-2 pr-3">{u.receipt_number}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{u.receipt_date ? formatDate(u.receipt_date) : ''}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">{formatMoney(u.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

// KYC update: one card with the request status and the Send action (magazines.write).
function KycUpdateCard({ id, kyc, reload, canSend }) {
  const [sending, setSending] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [channel, setChannel] = useState('LINK');

  const statusChip = kyc ? (
    <span className={`chip ${kyc.status === 'SUBMITTED' ? 'chip-on' : kyc.status === 'REJECTED' ? 'chip-bad' : 'chip-warn'}`}>
      {kyc.status === 'SUBMITTED' ? 'Submitted · awaiting approval' : kyc.status === 'SENT' ? 'Sent · waiting for member' : kyc.status}
    </span>
  ) : (
    <span className="chip chip-off">Not asked yet</span>
  );

  const send = () => {
    setSending(true);
    api
      .post(`/members/${id}/send-kyc-link`, null, { params: { channel } })
      .then(({ data }) => {
        setModalOpen(false);
        notify(data.message || 'KYC request sent.', 'success');
        if (reload) reload();
      })
      .catch((error) => {
        notify(apiErrorMessage(error, 'Could not send the KYC request.'), 'error');
      })
      .finally(() => setSending(false));
  };

  return (
    <Card icon={Phone} title="KYC update">
      <div className="mb-3">{statusChip}</div>
      {kyc ? (
        <div className="space-y-1 text-xs text-[#863221]">
          {kyc.sent_at && <div>Sent: {formatDateTime(kyc.sent_at)}</div>}
          {kyc.expires_at && kyc.status === 'SENT' && <div>Link valid till: {formatDateTime(kyc.expires_at)}</div>}
          {kyc.submitted_at && <div>Submitted: {formatDateTime(kyc.submitted_at)}</div>}
        </div>
      ) : (
        <Empty>No KYC request sent to this member yet.</Empty>
      )}
      {canSend && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="mt-3 px-4 py-2 text-xs font-semibold rounded-xl bg-[#510601] hover:bg-[#863221] text-white transition-colors"
        >
          Send KYC Update
        </button>
      )}
      <p className="mt-2 text-xs text-[#863221]/80">
        The member updates their details through the link or the app; the change reaches you as a request on the Approvals screen.
      </p>

      <Modal isOpen={modalOpen} onClose={() => !sending && setModalOpen(false)}>
        <div className="bg-white rounded-2xl max-w-md w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
          <div className="h-14 shrink-0 flex items-center justify-between px-6 border-b border-[#E8DFD8] bg-[#FAF7F2] rounded-t-2xl">
            <span className="text-sm font-bold text-[#180200]">Send KYC Update Request</span>
            <button type="button" onClick={() => setModalOpen(false)} disabled={sending} className="text-[#863221] hover:text-[#510601]" aria-label="Close">✕</button>
          </div>
          <div className="p-6 space-y-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" name="kyc-channel" checked={channel === 'LINK'} onChange={() => setChannel('LINK')} className="mt-1" />
              <span className="text-xs">
                <span className="font-semibold text-[#180200] block">WhatsApp link</span>
                For members without the app: opens a form where they update mobile, email and address. Valid till tonight.
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" name="kyc-channel" checked={channel === 'APP'} onChange={() => setChannel('APP')} className="mt-1" />
              <span className="text-xs">
                <span className="font-semibold text-[#180200] block">App nudge</span>
                For members who have the app: a WhatsApp nudge to open the KYC screen in the HMS MMA app.
              </span>
            </label>
          </div>
          <ModalFooter kind="confirm" submitLabel="Send" busyLabel="Sending..." busy={sending} onSubmit={send} onCancel={() => setModalOpen(false)} />
        </div>
      </Modal>
    </Card>
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
                    <span>{e.title}{e.role ? ` · ${e.role}` : ''}{e.location ? ` (${e.location})` : ''}</span>
                    <span className="text-xs text-[#863221] whitespace-nowrap">
                      {e.event_date ? formatDate(e.event_date) : ''}{e.end_date ? ` to ${formatDate(e.end_date)}` : ''}
                    </span>
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
                    <span className="text-xs text-[#863221] whitespace-nowrap">
                      {g.event_date ? formatDate(g.event_date) : ''}{g.end_date ? ` to ${formatDate(g.end_date)}` : ''}
                    </span>
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
                      {a.action || a.status || 'Approval'}
                      {a.old_status && a.new_status ? ` (${a.old_status} → ${a.new_status})` : ''}
                      {a.reason ? ` — ${a.reason}` : ''}
                      {a.acted_by_name ? ` · by ${a.acted_by_name}` : ''}
                    </span>
                    <span className="text-[#863221]">{a.acted_at ? formatDate(a.acted_at) : ''}</span>
                  </div>
                ))}
                {h.profile_changes.map((c, i) => (
                  <div key={`h${i}`} className="flex justify-between gap-3">
                    <span>
                      <b>{c.field}</b>: {String(c.old_value ?? '—')} → {String(c.new_value ?? '—')}
                      {c.changed_by ? ` · by ${c.changed_by}` : ''}
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
  { key: 'overview', label: 'Overview', icon: User, Component: OverviewTab },
  { key: 'personal', label: 'Personal Details', icon: User, Component: PersonalTab },
  { key: 'membership', label: 'Membership', icon: CreditCard, Component: MembershipTab, count: 'membership' },
  { key: 'receipts', label: 'Receipts', icon: FileText, Component: ReceiptsTab, count: 'receipts' },
  { key: 'magazine', label: 'Magazine', icon: BookOpen, Component: MagazineTab, count: 'magazine' },
  { key: 'services', label: 'Services', icon: MapPin, Component: ServicesTab, count: 'services' },
  { key: 'events', label: 'Events', icon: CalendarDays, Component: EventsTab, count: 'events' },
  { key: 'activity', label: 'Activity & History', icon: History, Component: ActivityTab }
];

// An application that is not approved yet opens as a read-only popup with the basic details entered.
export function UnapprovedPopup({ id, s, name, onClose }) {
  const personal = useSection(id, 'personal');
  const contact = useSection(id, 'contact');
  const p = personal.data;
  const c = contact.data;
  const age = p ? ageOf(p.date_of_birth) : null;
  const status = String(s.approval_status || '').toUpperCase();
  const statusChip = status === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200';
  return (
    <Modal
      isOpen
      onClose={onClose}
      maxWidthClass="max-w-3xl"
      title={
        <span className="flex items-center gap-2.5">
          <span className="truncate">{name || 'Application'}</span>
          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusChip}`}>{status || 'UNAPPROVED'}</span>
        </span>
      }
      footer={
        <div className="h-14 shrink-0 px-6 border-t border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-between">
          <span className="text-[11px] text-[#863221]">Read-only view of the details entered</span>
          <button type="button" onClick={onClose} className="px-5 py-2 rounded-xl bg-[#510601] hover:bg-[#863221] text-white text-xs font-semibold transition-colors">
            Close
          </button>
        </div>
      }
    >
      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel icon={User} title="Basic details" tag={s.member_code || `ID ${s.id}`}>
          {personal.loading ? <Empty>Loading…</Empty> : !p ? <Empty>Could not be loaded.</Empty> : (
            <>
              <Row label="Full name">{[p.name_title, p.first_name_en, p.middle_name_en, p.last_name_en].filter(Boolean).join(' ')}</Row>
              <Row label="Name (Kannada)">{p.full_name_kn}</Row>
              <Row label="Gender">{p.gender}</Row>
              <Row label="Date of birth">
                {p.date_of_birth && <>{formatDate(p.date_of_birth)}{age !== null && <span className="ml-1 font-normal text-[#A89B92]">({age} yrs)</span>}</>}
              </Row>
              <Row label="Blood group">{p.blood_group}</Row>
              <Row label="Marital status">{p.is_married === true ? 'Married' : p.is_married === false ? 'Unmarried' : ''}</Row>
              <Row label="Gotra">{p.gotra}</Row>
              <Row label="Qualification">{p.qualification}</Row>
              <Row label="Occupation">{p.occupation}</Row>
              <Row label="Registered through">{p.registration_source}</Row>
              <Row label="Registered on">{p.created_at ? formatDateTime(p.created_at) : ''}</Row>
            </>
          )}
        </Panel>
        <Panel icon={Phone} title="Contact & address" tag="Entered">
          {contact.loading ? <Empty>Loading…</Empty> : !c ? <Empty>Could not be loaded.</Empty> : (
            <>
              <Row label="Mobile">{phone(c.mobile_country_code, c.mobile)}</Row>
              <Row label="Mobile belongs to">{belongsTo(p?.applied_on_behalf_of)}</Row>
              <Row label="WhatsApp">{phone(c.whatsapp_country_code, c.whatsapp_number)}</Row>
              <Row label="Email">{c.email}</Row>
              <Row label="Address">{[c.address_line1, c.address_line2].filter(Boolean).join(', ')}</Row>
              <Row label="Locality">{c.locality}</Row>
              <Row label="City">{c.city}</Row>
              <Row label="Taluk">{c.taluk_name}</Row>
              <Row label="District">{c.district_name}</Row>
              <Row label="State">{c.state_name}</Row>
              <Row label="PIN code">{c.pincode}</Row>
            </>
          )}
        </Panel>
      </div>
    </Modal>
  );
}

export default function MemberProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [photoUrl, setPhotoUrl] = useState('');

  const requestedTab = ['contact', 'family'].includes(searchParams.get('tab')) ? 'personal' : searchParams.get('tab'); // old links
  const tabKey = TABS.some((t) => t.key === requestedTab) ? requestedTab : 'overview';
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
  const fullName = s ? memberName(s, true) : '';

  return (
    <PermissionGate required="members.list.read">
      <div className="space-y-5">
        {loading && <Empty>Loading profile…</Empty>}
        {!loading && !s && <Empty>This member could not be loaded.</Empty>}

        {s && String(s.approval_status).toUpperCase() !== 'APPROVED' && (
          <UnapprovedPopup
            id={id}
            s={s}
            name={fullName}
            onClose={() => (window.history.length > 1 ? navigate(-1) : navigate('/dashboard/membership/unapproved'))}
          />
        )}

        {s && String(s.approval_status).toUpperCase() === 'APPROVED' && (
          <>
            {/* Header strip */}
            <div className="bg-white border border-[#E8DFD8] text-[#180200] rounded-2xl shadow-sm p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-14 h-14 rounded-xl bg-[#FAF1EE] border border-[#E8DFD8] overflow-hidden flex items-center justify-center font-semibold text-xl text-[#510601] shrink-0">
                  {photoUrl ? <img src={photoUrl} alt={fullName} className="w-full h-full object-cover" /> : initialOf(fullName)}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-lg sm:text-xl font-semibold text-[#180200] tracking-tight truncate">{fullName}</h1>
                    <span className="chip chip-on">{s.approval_status}</span>
                  </div>
                  {s.full_name_kn && <div className="text-xs text-[#863221]">{s.full_name_kn}</div>}
                  <p className="text-xs text-[#863221] mt-0.5 truncate">
                    {[
                      s.member_code ? `${s.member_code}` : `ID ${s.id}`,
                      s.active_membership?.type_name_en,
                      [s.locality, s.city].filter(Boolean).join(', '),
                      phone(s.mobile_country_code, s.mobile)
                    ].filter(Boolean).join(' • ')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                {hasPermission('members.list.write') && (
                  <Link
                    to={`/dashboard/membership/edit/${s.id}`}
                    className="text-xs bg-white hover:bg-[#FAF7F2] border border-[#E8DFD8] text-[#510601] px-3.5 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5 transition"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </Link>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
              {/* Section menu: a vertical list on desktop, one dropdown on a phone (nothing scrolls sideways) */}
              <div className="md:hidden">
                <select
                  value={tabKey}
                  onChange={(e) => openTab(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-[#E8DFD8] rounded-xl text-sm font-semibold text-[#180200]"
                  aria-label="Section"
                >
                  {TABS.map((t) => {
                    const count = t.count ? s.counts[t.count] : 0;
                    return <option key={t.key} value={t.key}>{t.label}{count > 0 ? ` (${count})` : ''}</option>;
                  })}
                </select>
              </div>
              <nav className="hidden md:block md:col-span-3 bg-white rounded-2xl border border-[#E8DFD8] shadow-sm p-2 space-y-1 md:sticky md:top-2">
                <div className="px-3 py-2 text-[10px] font-bold text-[#863221]/70 uppercase tracking-wider">Sections</div>
                {TABS.map((t) => {
                  const count = t.count ? s.counts[t.count] : null;
                  const selected = t.key === tabKey;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      aria-current={selected ? 'page' : undefined}
                      onClick={() => openTab(t.key)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                        selected ? 'bg-[#FAF1EE] text-[#510601] border border-[#E8DFD8]' : 'text-[#863221] border border-transparent hover:text-[#180200] hover:bg-[#FAF7F2]'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <t.icon className={`w-4 h-4 ${selected ? '' : 'text-[#863221]/60'}`} />
                        <span>{t.label}</span>
                      </span>
                      {count > 0 && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${selected ? 'bg-white border border-[#E8DFD8] text-[#510601]' : 'bg-[#FAF7F2] border border-[#E8DFD8] text-[#863221]'}`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>

              <div className="md:col-span-9 min-w-0">
            <ActiveTab key={`${id}-${tabKey}`} id={id} onOpen={openTab} />
              </div>
            </div>
          </>
        )}
      </div>
    </PermissionGate>
  );
}
