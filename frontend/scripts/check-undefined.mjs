// Fails when a page uses a name that is not defined anywhere ("x is not defined" crashes only when that
// part of the screen is opened, e.g. a tab, so the page-render check cannot see it).
import { spawnSync } from 'node:child_process';

const BROWSER_GLOBALS = new Set([
  'document', 'window', 'localStorage', 'sessionStorage', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'Event', 'CustomEvent', 'URL', 'FormData', 'Blob', 'File', 'FileReader', 'URLSearchParams', 'navigator', 'HTMLElement', 'Node',
  'fetch', 'alert', 'confirm', 'Image', 'requestAnimationFrame', 'cancelAnimationFrame', 'atob', 'btoa', 'history', 'location',
  'performance', 'crypto', 'Intl', 'AbortController', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'TextDecoder',
  'TextEncoder', 'structuredClone', 'queueMicrotask', 'getComputedStyle', 'DOMParser', 'XMLSerializer',
]);

// run oxlint through node itself (no shell), so it starts the same way on Windows and Linux
const run = spawnSync(process.execPath, ['node_modules/oxlint/bin/oxlint', '-D', 'no-undef', 'src'], { encoding: 'utf8' });
const text = `${run.stdout || ''}${run.stderr || ''}`;
if (run.error || (run.status !== 0 && run.status !== 1) || /not recognized|command not found|Cannot find module/i.test(text)) {
  // never pass silently when the checker itself did not run
  console.log('could not run oxlint:', run.error ? run.error.message : text.slice(0, 300));
  process.exit(2);
}

const bad = [];
for (const line of text.split('\n')) {
  const m = line.match(/^(\S+:\d+:\d+):?\s.*no-undef\): '([^']+)' is not defined/);
  if (m && !BROWSER_GLOBALS.has(m[2])) bad.push(`${m[1]}  '${m[2]}' is not defined`);
}
if (bad.length) {
  console.log(`undefined names (${bad.length}):\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log('no undefined names');
