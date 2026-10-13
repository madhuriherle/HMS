import api from '../api';

/**
 * The first page this role can actually open, from GET /users/modules/menu —
 * the endpoint already returns only the pages the role is entitled to, in the
 * sidebar's order, so the answer needs no duplicated privilege logic here.
 * Returns null when the menu is unreadable or the role has no page at all.
 */
export async function resolveLandingPath() {
  try {
    const res = await api.get('/users/modules/menu');
    const pick = (nodes) => {
      for (const node of nodes || []) {
        if (typeof node.route === 'string' && node.route.startsWith('/dashboard')) return node.route;
        const sub = pick(node.submodules);
        if (sub) return sub;
      }
      return null;
    };
    return pick(Array.isArray(res.data) ? res.data : []);
  } catch {
    return null;
  }
}
