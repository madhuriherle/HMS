// Renders every page once (server-side) with a stand-in all-access login: a crash while rendering
// ("Cannot access 'x' before initialization", undefined values, ...) shows up here.
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = process.cwd().split('\\').join('/'); // run from the frontend folder: npm run smoke
const require = createRequire(ROOT + '/package.json');
const { createServer } = require('vite');
const React = require('react');
const { renderToString } = require('react-dom/server');
const { MemoryRouter } = require('react-router-dom');

// minimal browser stand-ins
const store = {
  access_token: 'x',
  hms_user_profile: JSON.stringify({ id: 1, name: 'Admin', username: 'admin', is_all_access: true, role_rank_level: 1, privileges: [] }),
};
const ls = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
globalThis.localStorage = ls;
globalThis.window = Object.assign(globalThis, {
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  location: { pathname: '/', search: '', hash: '', href: 'http://x/' },
  innerWidth: 1280, innerHeight: 800,
});
const el0 = { style: {}, appendChild() {}, insertBefore() {}, setAttribute() {} };
const el = () => ({ style: {}, classList: { add() {}, remove() {}, contains: () => false }, setAttribute() {}, appendChild() {}, removeChild() {}, addEventListener() {}, removeEventListener() {}, getElementsByTagName: () => [el0], querySelector: () => null, querySelectorAll: () => [], insertBefore() {} });
globalThis.document = { ...el(), head: el(), body: el(), documentElement: el(), createElement: el, createTextNode: () => ({}), getElementById: () => null, getElementsByTagName: () => [el0], querySelector: () => null, querySelectorAll: () => [], cookie: '', readyState: 'complete' };
globalThis.CustomEvent = class { constructor(t) { this.type = t; } };
globalThis.Event = globalThis.Event || class { constructor(t) { this.type = t; } };

const server = await createServer({
  root: ROOT, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true },
});

const pages = process.argv.slice(2).length ? process.argv.slice(2) : [
  'LocationSetup', 'MembershipTypeManagement', 'ReceiptTypeManagement', 'BankDetailsManagement', 'MasterLists',
  'MembershipList', 'UnapprovedMembership', 'RegisterNewMember', 'ReceiptEntry', 'ReceiptTracking', 'Approvals',
  'RolesAndPrivileges', 'UserManagement', 'ModulesManagement', 'OrganisationSettings', 'Dashboard', 'LabelList', 'NotFound',
  'components/MenuArranger',
];

// components that need props to render
const SAMPLE_PROPS = {
  'components/MenuArranger': {
    modules: [
      { id: 1, parent_id: null, display_order: 1, name_en: 'Masters', code: 'masters', route: null, status: true },
      { id: 2, parent_id: 1, display_order: 1, name_en: 'Banks', code: 'masters.banks', route: '/b', status: true },
      { id: 3, parent_id: null, display_order: 2, name_en: 'Reports', code: 'reports', route: null, status: false },
    ],
  },
};
let failed = 0;
for (const name of pages) {
  try {
    const mod = await server.ssrLoadModule(name.includes('/') ? `/src/${name}.jsx` : `/src/pages/${name}.jsx`);
    const Page = mod.default;
    const html = renderToString(React.createElement(MemoryRouter, null, React.createElement(Page, SAMPLE_PROPS[name] || null)));
    console.log(`ok     ${name.padEnd(28)} ${html.length} chars`);
  } catch (e) {
    failed += 1;
    console.log(`CRASH  ${name.padEnd(28)} ${String(e && e.message).split('\n')[0].slice(0, 140)}`);
  }
}
await server.close();
console.log(failed ? `\n${failed} page(s) crash while rendering` : '\nevery page renders');
process.exit(failed ? 1 : 0);
