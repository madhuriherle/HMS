import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, RotateCcw, Save } from 'lucide-react';
import api from '../api';
import { notify } from '../utils/notify';
import { apiErrorMessage } from '../utils/apiError';
import { canDrop, changedItems, moveNode, siblingsOf, sidebarPreview } from '../utils/menuArrange';

const toNodes = (modules) =>
  modules.map((m) => ({
    id: m.id,
    parent_id: m.parent_id ?? null,
    display_order: m.display_order ?? 0,
    name: m.name_en || m.name,
    code: m.code,
    route: m.route || null,
    status: m.status !== false,
  }));

// where on the row the pointer is: a top-level row has an "into" band in the middle, a page row only before / after
const zoneFor = (e, node) => {
  const r = e.currentTarget.getBoundingClientRect();
  const ratio = (e.clientY - r.top) / r.height;
  if (node.parent_id === null) return ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'into';
  return ratio < 0.5 ? 'before' : 'after';
};

export default function MenuArranger({ modules, onSaved }) {
  const original = useMemo(() => toNodes(modules), [modules]);
  const [nodes, setNodes] = useState(original);
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null); // { id, zone } while dragging over a row
  const [saving, setSaving] = useState(false);
  const [showOff, setShowOff] = useState(false); // show the switched-off (not built yet) modules too

  useEffect(() => setNodes(original), [original]);

  const changes = useMemo(() => changedItems(original, nodes), [original, nodes]);
  const preview = useMemo(() => sidebarPreview(nodes), [nodes]);
  const visibleSiblings = (parentId) => siblingsOf(nodes, parentId).filter((n) => showOff || n.status);
  const roots = visibleSiblings(null);
  const offCount = nodes.filter((n) => !n.status).length;

  const endDrag = () => {
    setDragId(null);
    setOver(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/users/modules/reorder', { items: changes });
      notify('Sidebar order saved.');
      window.dispatchEvent(new Event('hms-menu-change')); // the sidebar reloads itself
      if (onSaved) await onSaved();
    } catch (err) {
      notify(apiErrorMessage(err, 'Could not save the order.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // a plain function, not a component: a component defined here would be replaced on every re-render
  // and the browser would cancel the drag that is in progress
  const renderRow = (node, depth) => {
    const line = visibleSiblings(node.parent_id);
    const index = line.findIndex((n) => n.id === node.id);
    const isOver = over && over.id === node.id;
    const dropStyle = !isOver ? '' : over.zone === 'before'
      ? 'shadow-[inset_0_3px_0_#510601]'
      : over.zone === 'after'
        ? 'shadow-[inset_0_-3px_0_#510601]'
        : 'ring-2 ring-inset ring-[#510601]/60 bg-[#510601]/5';
    return (
      <div
        draggable
        onDragStart={(e) => {
          setDragId(node.id);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(node.id));
        }}
        onDragOver={(e) => {
          if (dragId === null) return;
          const zone = zoneFor(e, node);
          if (canDrop(nodes, dragId, node.id, zone)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!over || over.id !== node.id || over.zone !== zone) setOver({ id: node.id, zone });
          } else if (over) {
            setOver(null);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId !== null && over && over.id === node.id) setNodes((prev) => moveNode(prev, dragId, node.id, over.zone));
          endDrag();
        }}
        onDragEnd={endDrag}
        className={`flex items-center gap-2 pr-2 py-2 border-b border-[#F0E8E0] bg-white transition-colors cursor-grab active:cursor-grabbing ${dragId === node.id ? 'opacity-40' : 'hover:bg-[#FAF7F2]'} ${dropStyle}`}
        style={{ paddingLeft: `${10 + depth * 28}px` }}
      >
        <GripVertical className="w-4 h-4 text-[#C9BCB0] shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`truncate ${depth === 0 ? 'text-sm font-bold text-[#180200]' : 'text-sm font-medium text-[#180200]'}`}>{node.name}</span>
            {!node.status && <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold">Switched off</span>}
            {!node.route && node.status && depth > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold">No page yet</span>}
          </div>
          <div className="text-[10px] font-mono text-[#863221]/60 truncate">{node.code}{node.route ? `  ·  ${node.route}` : ''}</div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            disabled={index <= 0}
            onClick={() => setNodes((prev) => moveNode(prev, node.id, line[index - 1].id, 'before'))}
            title="Move up"
            className="p-1.5 rounded-lg text-[#510601] hover:bg-[#F1E7DE] disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={index === line.length - 1}
            onClick={() => setNodes((prev) => moveNode(prev, node.id, line[index + 1].id, 'after'))}
            title="Move down"
            className="p-1.5 rounded-lg text-[#510601] hover:bg-[#F1E7DE] disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
      <div className="xl:col-span-2 bg-white rounded-2xl border border-[#E8DFD8] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-[#FAF7F2] border-b border-[#E8DFD8]">
          <p className="text-xs text-[#863221] leading-relaxed max-w-xl">
            Drag a row (or use the arrows) to change the order of the sidebar. Drop on the <b>top or bottom edge</b> of a row to place it next to that row,
            or in the <b>middle</b> of a top-level module to put it inside. Nothing changes for anyone until you press Save.
          </p>
          <div className="flex items-center gap-2">
            {offCount > 0 && (
              <label className="inline-flex items-center gap-1.5 text-xs text-[#863221] cursor-pointer">
                <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />
                <span>Show {offCount} switched-off</span>
              </label>
            )}
            <button
              type="button"
              disabled={changes.length === 0 || saving}
              onClick={() => setNodes(original)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-[#E8DFD8] rounded-xl text-xs font-semibold text-[#510601] hover:bg-[#FAF7F2] disabled:opacity-40 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
            <button
              type="button"
              disabled={changes.length === 0 || saving}
              onClick={save}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#510601] hover:bg-[#8C1801] text-white rounded-xl text-xs font-semibold disabled:opacity-40 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : changes.length ? `Save order (${changes.length} changed)` : 'Save order'}</span>
            </button>
          </div>
        </div>
        <div>
          {roots.map((root) => (
            <div key={root.id}>
              {renderRow(root, 0)}
              {visibleSiblings(root.id).map((child) => (
                <React.Fragment key={child.id}>{renderRow(child, 1)}</React.Fragment>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-[#200200] rounded-2xl p-4 text-[#FAF7F2] xl:sticky xl:top-4">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[#FFC107] mb-3">Sidebar preview</div>
        {preview.length === 0 ? (
          <p className="text-xs text-white/60">Nothing would show.</p>
        ) : (
          <ul className="space-y-1">
            {preview.map((m) => (
              <li key={m.id}>
                <div className="px-3 py-2 rounded-lg bg-white/5 text-sm font-semibold">{m.name}</div>
                {m.children.length > 0 && (
                  <ul className="ml-4 mt-1 space-y-0.5 border-l border-white/10 pl-3">
                    {m.children.map((c) => (
                      <li key={c.id} className="px-2 py-1 text-xs text-white/80">{c.name}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[10px] text-white/50 leading-relaxed">
          Shows the modules that are switched on and have a page. A person only sees the ones their privileges allow.
        </p>
      </div>
    </div>
  );
}
