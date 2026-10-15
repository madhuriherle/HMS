import { useState } from 'react';

// Column sorting for a list that reads from the server: asc, then desc, then back to the server's default
// (newest first). `params` goes straight into the list request as sort_by / sort_dir.
export default function useSort() {
  const [sort, setSort] = useState({ by: '', dir: 'asc' });
  const toggle = (field) =>
    setSort((s) => {
      if (s.by !== field) return { by: field, dir: 'asc' };
      if (s.dir === 'asc') return { by: field, dir: 'desc' };
      return { by: '', dir: 'asc' };
    });
  const params = sort.by ? { sort_by: sort.by, sort_dir: sort.dir } : {};
  return { sort, toggle, params };
}
