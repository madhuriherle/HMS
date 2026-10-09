// Selection rules of the Configure Privileges table, kept free of React so they can be tested.
//
//  * Write and Delete need Read: a screen cannot be used without being able to open it.
//    Ticking Write/Delete also ticks Read; clearing Read also clears Write/Delete.
//  * "approvals.write" (Approve requests) and privileges with no Read twin stand alone.

const WRITE_OR_DELETE = /\.(write|delete)$/;

// The Read privilege a Write/Delete privilege depends on, or null
export const readCodeFor = (code, allIds) => {
  if (code === 'approvals.write' || !WRITE_OR_DELETE.test(code)) return null;
  const read = code.replace(WRITE_OR_DELETE, '.read');
  return allIds.includes(read) ? read : null;
};

// The Write / Delete privileges that depend on a Read privilege
export const dependentsOf = (readCode, allIds) =>
  allIds.filter((c) => c !== 'approvals.write' && WRITE_OR_DELETE.test(c) && c.replace(WRITE_OR_DELETE, '.read') === readCode);

// One checkbox
export const toggleOne = (selected, id, allIds) => {
  if (selected.includes(id)) {
    const drop = new Set([id]);
    if (id.endsWith('.read')) dependentsOf(id, allIds).forEach((c) => drop.add(c));
    return selected.filter((x) => !drop.has(x));
  }
  const read = readCodeFor(id, allIds);
  return Array.from(new Set([...selected, id, ...(read ? [read] : [])]));
};

// Several checkboxes at once (a column, a row, a whole module, or everything)
export const applyBulk = (selected, codes, on, allIds) => {
  const set = new Set(selected);
  if (on) {
    codes.forEach((c) => {
      set.add(c);
      const read = readCodeFor(c, allIds);
      if (read) set.add(read);
    });
  } else {
    codes.forEach((c) => {
      set.delete(c);
      if (c.endsWith('.read')) dependentsOf(c, allIds).forEach((w) => set.delete(w));
    });
  }
  return Array.from(set);
};

// 'all' | 'some' | 'none' | 'na' for a group of privileges
export const stateOf = (codes, isOn) => {
  if (codes.length === 0) return 'na';
  const on = codes.filter(isOn).length;
  if (on === codes.length) return 'all';
  return on > 0 ? 'some' : 'none';
};
