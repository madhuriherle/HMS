import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, User, FileText } from 'lucide-react';
import api from '../api';
import { formatMoney } from '../utils/money';

// One search box in the top bar: members (name, code, membership no., mobile) and receipts (no., payer, reference).
export default function GlobalSearch() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [results, setResults] = useState({ members: [], receipts: [] });
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setResults({ members: [], receipts: [] });
      return undefined;
    }
    const mine = (seq.current += 1);
    const timer = setTimeout(() => {
      api
        .get('/dashboard/search', { params: { q } })
        .then(({ data }) => mine === seq.current && setResults(data))
        .catch(() => mine === seq.current && setResults({ members: [], receipts: [] }));
    }, 300);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const close = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const go = (path) => {
    setOpen(false);
    setText('');
    navigate(path);
  };
  const any = results.members.length + results.receipts.length > 0;

  return (
    <div ref={boxRef} className="relative hidden sm:block w-64 lg:w-80">
      <Search className="w-4 h-4 text-[#863221]/50 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search members, receipts, mobile…"
        className="w-full pl-9 pr-3 py-2 bg-[#FAF7F2] border border-[#E8DFD8] rounded-xl text-xs text-[#180200] focus:outline-none focus:border-[#510601] focus:bg-white"
      />
      {open && text.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-40 bg-white border border-[#E8DFD8] rounded-xl shadow-xl max-h-96 overflow-y-auto">
          {!any && <p className="px-4 py-3 text-xs text-[#863221]">No matches.</p>}
          {results.members.length > 0 && (
            <div>
              <p className="px-4 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#863221]">Members</p>
              {results.members.map((m) => (
                <button
                  key={`m${m.id}`}
                  type="button"
                  onClick={() => go(`/dashboard/membership/profile/${m.id}`)}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-[#FAF7F2] cursor-pointer"
                >
                  <User className="w-4 h-4 text-[#863221]" />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-[#180200] truncate">{m.name}</span>
                    <span className="block text-[11px] text-[#863221]">
                      {m.membership_number || m.member_code || 'Applicant'} {m.mobile ? `· ${m.mobile}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {results.receipts.length > 0 && (
            <div>
              <p className="px-4 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#863221]">Receipts</p>
              {results.receipts.map((r) => (
                <button
                  key={`r${r.id}`}
                  type="button"
                  onClick={() => go(`/dashboard/receipts/tracking?search=${encodeURIComponent(r.receipt_number)}`)}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-[#FAF7F2] cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-[#863221]" />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-[#180200] truncate font-mono">{r.receipt_number}</span>
                    <span className="block text-[11px] text-[#863221] truncate">
                      {r.payer_name || '—'} · {formatMoney(r.amount)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
