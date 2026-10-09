// Run: node src/utils/menuArrange.test.mjs
import assert from 'node:assert/strict';
import { canDrop, changedItems, isInside, moduleTreeRows, moveNode, moveStep, siblingsOf, sidebarPreview } from './menuArrange.js';

// Dashboard, Masters (Location, Types, Banks), Users (Roles), Reports (switched off, no route)
const BASE = [
  { id: 1, parent_id: null, display_order: 1, name: 'Dashboard', route: '/d', status: true },
  { id: 2, parent_id: null, display_order: 2, name: 'Masters', route: null, status: true },
  { id: 3, parent_id: 2, display_order: 1, name: 'Location', route: '/l', status: true },
  { id: 4, parent_id: 2, display_order: 2, name: 'Types', route: '/t', status: true },
  { id: 5, parent_id: 2, display_order: 3, name: 'Banks', route: '/b', status: true },
  { id: 6, parent_id: null, display_order: 3, name: 'Users', route: null, status: true },
  { id: 7, parent_id: 6, display_order: 1, name: 'Roles', route: '/r', status: true },
  { id: 8, parent_id: null, display_order: 4, name: 'Reports', route: null, status: false },
  { id: 9, parent_id: 8, display_order: 1, name: 'Member Reports', route: null, status: false },
];
const names = (nodes, parent) => siblingsOf(nodes, parent).map((n) => n.name);

// ── reorder among siblings ──
let n = moveNode(BASE, 5, 3, 'before'); // Banks before Location
assert.deepEqual(names(n, 2), ['Banks', 'Location', 'Types']);
assert.deepEqual(siblingsOf(n, 2).map((x) => x.display_order), [1, 2, 3], 'numbers are 1..n with no gaps');
n = moveNode(BASE, 3, 5, 'after'); // Location after Banks
assert.deepEqual(names(n, 2), ['Types', 'Banks', 'Location']);
n = moveNode(BASE, 6, 1, 'before'); // Users above Dashboard
assert.deepEqual(names(n, null), ['Users', 'Dashboard', 'Masters', 'Reports']);

// ── arrows ──
assert.deepEqual(names(moveStep(BASE, 4, -1), 2), ['Types', 'Location', 'Banks']);
assert.deepEqual(names(moveStep(BASE, 4, +1), 2), ['Location', 'Banks', 'Types']);
assert.equal(moveStep(BASE, 3, -1), BASE, 'first row cannot go up');
assert.equal(moveStep(BASE, 5, +1), BASE, 'last row cannot go down');

// ── move a page into another module (the old module closes its gap) ──
n = moveNode(BASE, 4, 6, 'into'); // Types into Users
assert.deepEqual(names(n, 6), ['Roles', 'Types']);
assert.deepEqual(names(n, 2), ['Location', 'Banks']);
assert.deepEqual(siblingsOf(n, 2).map((x) => x.display_order), [1, 2]);
n = moveNode(BASE, 4, 7, 'before'); // Types next to Roles (a page of Users)
assert.deepEqual(names(n, 6), ['Types', 'Roles']);

// ── rules ──
assert.equal(canDrop(BASE, 2, 3, 'after'), false, 'Masters has pages, so it cannot become a page');
assert.equal(canDrop(BASE, 2, 2, 'before'), false, 'not onto itself');
assert.equal(canDrop(BASE, 2, 3, 'into'), false, 'a page cannot hold pages');
assert.equal(canDrop(BASE, 2, 6, 'into'), false, 'a module with pages stays on the top level');
assert.equal(canDrop(BASE, 1, 6, 'into'), true, 'Dashboard (no pages) may go inside Users');
assert.equal(canDrop(BASE, 2, 1, 'before'), true);
assert.equal(moveNode(BASE, 2, 3, 'into'), BASE, 'a rejected drop changes nothing');
assert.equal(isInside(BASE, 3, 2), true);
assert.equal(isInside(BASE, 2, 3), false);

// ── what gets saved ──
assert.deepEqual(changedItems(BASE, BASE), [], 'nothing moved, nothing to save');
const moved = moveNode(BASE, 5, 3, 'before');
const items = changedItems(BASE, moved);
assert.deepEqual(items.map((i) => i.id).sort(), [3, 4, 5], 'only the three pages whose number changed');
assert.ok(items.every((i) => i.parent_id === 2));
assert.deepEqual(changedItems(BASE, moveNode(BASE, 4, 6, 'into')).map((i) => i.id).sort(), [4, 5], 'moved page + the page whose number closed up');

// ── preview of the sidebar ──
const side = sidebarPreview(BASE);
assert.deepEqual(side.map((x) => x.name), ['Dashboard', 'Masters', 'Users'], 'switched-off Reports is not in the sidebar');
assert.deepEqual(side[1].children.map((x) => x.name), ['Location', 'Types', 'Banks']);

// ── Module Master table: tree order, built-only by default, folding, search ──
const label = (rows) => rows.map((r) => ' '.repeat(r.depth * 2) + r.m.name);
const builtOnly = BASE.filter((m) => m.status);
let rows = moduleTreeRows(BASE, builtOnly, () => true);
assert.deepEqual(label(rows), ['Dashboard', 'Masters', '  Location', '  Types', '  Banks', 'Users', '  Roles'],
  'each module followed by its own pages, in order; the switched-off Reports tree is not listed');
assert.equal(rows.find((r) => r.m.name === 'Masters').kids, 3);
rows = moduleTreeRows(BASE, builtOnly, (m) => m.name !== 'Masters'); // Masters folded
assert.deepEqual(label(rows), ['Dashboard', 'Masters', 'Users', '  Roles']);
rows = moduleTreeRows(BASE, BASE.filter((m) => m.name === 'Banks'), () => true); // search for one page
assert.deepEqual(label(rows), ['Masters', '  Banks'], 'a match keeps the module above it');
rows = moduleTreeRows(BASE, BASE, () => true); // "All status": the switched-off ones come back, in their place
assert.deepEqual(label(rows).slice(-2), ['Reports', '  Member Reports']);
assert.equal(rows.length, BASE.length);

console.log('menu arrange: all checks passed');
