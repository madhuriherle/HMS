import React, { useState } from 'react';
import { RotateCcw, Undo2 } from 'lucide-react';
import Modal from './Modal';
import api from '../api';
import { apiErrorMessage } from '../utils/apiError';
import { notify } from '../utils/notify';
import { formatDateTime } from '../utils/dateUtils';

import ModalFooter from './ModalFooter';
// "Recently deleted" for a master (kind = particulars | membership-types | banks | ...): list + restore.
export default function RecentlyDeleted({ kind, label = 'items', onRestored, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/masters/deleted/${kind}`);
      setRows(data?.data || []);
    } catch (error) {
      notify(apiErrorMessage(error, 'Could not load the deleted items.'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const restore = async (row) => {
    try {
      await api.post(`/masters/deleted/${kind}/${row.id}/restore`, null, {
        params: { reason: 'Restored from Recently deleted' }
      });
      notify(`"${row.name}" restored.`);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      onRestored?.();
    } catch (error) {
      notify(apiErrorMessage(error, 'Could not restore this item.'), 'error');
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          load();
        }}
        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-[#E8DFD8] text-[#510601] text-xs sm:text-sm font-semibold rounded-xl hover:bg-[#FAF7F2] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        title="See and restore deleted items"
      >
        <Undo2 className="w-4 h-4" />
        <span>Recently deleted</span>
      </button>

      <Modal isOpen={open} onClose={() => setOpen(false)}>
        {open && (
          <div className="bg-white rounded-2xl max-w-lg w-full border border-[#E8DFD8] shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 h-14 shrink-0 border-b border-[#E8DFD8] bg-[#FAF7F2] flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold text-[#180200] font-serif">Recently Deleted {label}</h3>
            </div>
            <div className="p-6 max-h-80 overflow-y-auto divide-y divide-[#E8DFD8]/70">
              {loading && <p className="py-4 text-xs text-[#863221]">Loading…</p>}
              {!loading && rows.length === 0 && <p className="py-4 text-xs text-[#863221]">Nothing has been deleted.</p>}
              {rows.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[#180200] truncate">{r.name}</div>
                    <div className="text-[11px] text-[#863221]">
                      {r.code ? `${r.code} · ` : ''}
                      {r.deleted_at ? `deleted ${formatDateTime(r.deleted_at)}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => restore(r)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#3D705C] border border-[#3D705C]/30 rounded-lg hover:bg-[#3D705C]/10 cursor-pointer shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restore
                  </button>
                </div>
              ))}
            </div>
            <ModalFooter kind="view" onCancel={() => setOpen(false)} />
          </div>
        )}
      </Modal>
    </>
  );
}
