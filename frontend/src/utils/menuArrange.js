// Rearranging the sidebar: pure functions over a flat list of modules { id, parent_id, display_order, ... }.
// The menu has two levels: a module on the top level, and pages inside a module.
//
//   zone 'before' / 'after' : put the dragged module next to the target (same parent)
//   zone 'into'             : put it inside the target, at the end (target must be a top-level module)

const keyOf = (id) => (id === null || id === undefined ? null : id);

export const siblingsOf = (nodes, parentId) =>
  nodes
    .filter((n) => keyOf(n.parent_id) === keyOf(parentId))
    .sort((a, b) => (a.display_order - b.display_order) || (a.id - b.id));

export const hasChildren = (nodes, id) => nodes.some((n) => n.parent_id === id);

export const isTopLevel = (nodes, id) => keyOf(nodes.find((n) => n.id === id)?.parent_id) === null;

// is `id` at or below `ancestorId`?
export const isInside = (nodes, id, ancestorId) => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let cur = byId.get(id);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    if (cur.id === ancestorId) return true;
    seen.add(cur.id);
    cur = cur.parent_id == null ? null : byId.get(cur.parent_id);
  }
  return false;
};

// the parent the dragged module would end up with, or undefined when the drop is not allowed
export const dropParent = (nodes, dragId, targetId, zone) => {
  if (dragId === targetId) return undefined;
  const drag = nodes.find((n) => n.id === dragId);
  const target = nodes.find((n) => n.id === targetId);
  if (!drag || !target) return undefined;
  if (isInside(nodes, targetId, dragId)) return undefined; // never inside itself or its own pages
  const parentId = zone === 'into' ? target.id : keyOf(target.parent_id);
  if (zone === 'into' && keyOf(target.parent_id) !== null) return undefined; // pages cannot hold pages
  if (parentId !== null && hasChildren(nodes, dragId)) return undefined; // a module with pages stays on the top level
  return parentId;
};

export const canDrop = (nodes, dragId, targetId, zone) => dropParent(nodes, dragId, targetId, zone) !== undefined;

const renumber = (nodes, parentId) => {
  const order = new Map(siblingsOf(nodes, parentId).map((n, i) => [n.id, i + 1]));
  return nodes.map((n) => (order.has(n.id) ? { ...n, display_order: order.get(n.id) } : n));
};

// drop `dragId` on `targetId`; returns the new list (the same list when the drop is not allowed)
export const moveNode = (nodes, dragId, targetId, zone) => {
  const parentId = dropParent(nodes, dragId, targetId, zone);
  if (parentId === undefined) return nodes;
  const drag = nodes.find((n) => n.id === dragId);
  const oldParent = keyOf(drag.parent_id);

  const line = siblingsOf(nodes, parentId).filter((n) => n.id !== dragId); // the new parent's pages without the dragged one
  let at = line.length; // 'into': at the end
  if (zone !== 'into') {
    const i = line.findIndex((n) => n.id === targetId);
    at = zone === 'before' ? i : i + 1;
  }
  const placed = [...line.slice(0, at), { ...drag, parent_id: parentId }, ...line.slice(at)];
  let out = nodes.map((n) => (n.id === dragId ? { ...n, parent_id: parentId } : n));
  const order = new Map(placed.map((n, i) => [n.id, i + 1]));
  out = out.map((n) => (order.has(n.id) ? { ...n, display_order: order.get(n.id) } : n));
  if (oldParent !== parentId) out = renumber(out, oldParent); // close the gap it left behind
  return out;
};

// arrow buttons: one step up (-1) or down (+1) among the siblings
export const moveStep = (nodes, id, step) => {
  const node = nodes.find((n) => n.id === id);
  if (!node) return nodes;
  const line = siblingsOf(nodes, node.parent_id);
  const i = line.findIndex((n) => n.id === id);
  const j = i + step;
  if (j < 0 || j >= line.length) return nodes;
  return moveNode(nodes, id, line[j].id, step < 0 ? 'before' : 'after');
};

// what has to be saved: only modules whose parent or position changed
export const changedItems = (original, current) => {
  const was = new Map(original.map((n) => [n.id, n]));
  return current
    .filter((n) => {
      const o = was.get(n.id);
      return !o || keyOf(o.parent_id) !== keyOf(n.parent_id) || o.display_order !== n.display_order;
    })
    .map((n) => ({ id: n.id, parent_id: keyOf(n.parent_id), display_order: n.display_order }));
};

// what the sidebar will show: switched-on modules that have a page or a switched-on page below them
export const sidebarPreview = (nodes) => {
  const live = nodes.filter((n) => n.status !== false);
  const show = (n) => Boolean(n.route) || siblingsOf(live, n.id).some(show);
  const build = (parentId) =>
    siblingsOf(live, parentId).filter(show).map((n) => ({ ...n, children: build(n.id) }));
  return build(null);
};

// Module Master table: the modules in tree order (each module, then its pages indented below it).
// `matches` are the modules that pass the search / status filter; a match keeps the modules above it.
// `isOpen(module)` says whether a group is unfolded.
export const moduleTreeRows = (modules, matches, isOpen) => {
  const ids = new Set(modules.map((m) => m.id));
  const byParent = new Map();
  modules.forEach((m) => {
    const key = m.parent_id != null && ids.has(m.parent_id) ? m.parent_id : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(m);
  });
  byParent.forEach((list) => list.sort((a, b) => (a.display_order - b.display_order) || (a.id - b.id)));
  const keep = new Set(matches.map((m) => m.id));
  const parentOf = new Map(modules.map((m) => [m.id, m.parent_id]));
  [...keep].forEach((id) => {
    let cur = parentOf.get(id);
    while (cur != null && !keep.has(cur)) {
      keep.add(cur);
      cur = parentOf.get(cur);
    }
  });
  const rows = [];
  const walk = (parentId, depth) => {
    (byParent.get(parentId) || []).forEach((m) => {
      if (!keep.has(m.id)) return;
      const kids = (byParent.get(m.id) || []).filter((k) => keep.has(k.id)).length;
      rows.push({ m, depth, kids });
      if (isOpen(m)) walk(m.id, depth + 1);
    });
  };
  walk(null, 0);
  return rows;
};

// 'section' = a heading of the side menu that groups pages; 'page' = opens a screen.
// A module with pages inside is a section; a module inside a section is a page; a top-level module is a
// page when it has a route and a section when it has none.
export const moduleKind = (modules, m) => {
  if (modules.some((x) => x.parent_id === m.id)) return 'section';
  if (m.parent_id != null) return 'page';
  return m.route ? 'page' : 'section';
};
