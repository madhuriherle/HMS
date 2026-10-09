// Run: node src/utils/privilegeSelection.test.mjs
import assert from 'node:assert/strict';
import { applyBulk, dependentsOf, readCodeFor, stateOf, toggleOne } from './privilegeSelection.js';

// a small tree shaped like the real one: a module with pages, a screen with no Read, and a stand-alone code
const ALL = [
  'masters.read', 'masters.write', 'masters.delete',
  'masters.banks.read', 'masters.banks.write', 'masters.banks.delete',
  'masters.location.read', 'masters.location.write', 'masters.location.delete',
  'members.register.write',
  'approvals.read', 'approvals.write',
];
const has = (sel, ...codes) => codes.every((c) => sel.includes(c));
const none = (sel, ...codes) => codes.every((c) => !sel.includes(c));

// ── dependencies ──
assert.equal(readCodeFor('masters.banks.write', ALL), 'masters.banks.read');
assert.equal(readCodeFor('members.register.write', ALL), null, 'a screen with no Read twin');
assert.equal(readCodeFor('approvals.write', ALL), null, 'Approve requests stands alone');
assert.deepEqual(dependentsOf('masters.banks.read', ALL).sort(), ['masters.banks.delete', 'masters.banks.write']);

// ── one checkbox ──
let s = toggleOne([], 'masters.banks.delete', ALL);
assert.ok(has(s, 'masters.banks.delete', 'masters.banks.read'), 'Delete ticks Read');
s = toggleOne(s, 'masters.banks.write', ALL);
assert.ok(has(s, 'masters.banks.write'));
s = toggleOne(s, 'masters.banks.read', ALL);
assert.ok(none(s, 'masters.banks.read', 'masters.banks.write', 'masters.banks.delete'), 'clearing Read clears Write and Delete');
s = toggleOne([], 'approvals.write', ALL);
assert.deepEqual(s, ['approvals.write'], 'Approve requests does not drag anything in');

// ── select all for one column of a module (every Write below "Masters") ──
const writes = ALL.filter((c) => c.endsWith('.write') && c.startsWith('masters'));
s = applyBulk([], writes, true, ALL);
assert.ok(has(s, ...writes) && has(s, 'masters.read', 'masters.banks.read', 'masters.location.read'), 'column Write also ticks each Read');
assert.ok(none(s, 'masters.delete', 'masters.banks.delete'), 'other columns untouched');
s = applyBulk(s, writes, false, ALL);
assert.ok(none(s, ...writes) && has(s, 'masters.banks.read'), 'clearing a column keeps the Reads');

// ── select all for one module / one row ──
const masters = ALL.filter((c) => c.startsWith('masters'));
s = applyBulk([], masters, true, ALL);
assert.equal(stateOf(masters, (c) => s.includes(c)), 'all');
s = applyBulk(s, ['masters.banks.read', 'masters.banks.write', 'masters.banks.delete'], false, ALL);
assert.equal(stateOf(masters, (c) => s.includes(c)), 'some', 'one row cleared -> module shows partly ticked');
assert.ok(has(s, 'masters.location.write'), 'the other rows keep their ticks');

// ── select all for the whole screen, and clear ──
s = applyBulk([], ALL, true, ALL);
assert.equal(s.length, ALL.length);
assert.equal(stateOf(ALL, (c) => s.includes(c)), 'all');
s = applyBulk(s, ALL, false, ALL);
assert.equal(s.length, 0);
assert.equal(stateOf(ALL, (c) => s.includes(c)), 'none');
assert.equal(stateOf([], () => true), 'na', 'a cell that does not exist');

// ── read-only roles show everything ticked ──
assert.equal(stateOf(ALL, () => true), 'all');

console.log('privilege selection: all checks passed');
