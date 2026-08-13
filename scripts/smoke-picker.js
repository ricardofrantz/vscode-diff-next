/**
 * Folder-then-branch picker smoke (no VS Code, no git).
 * Run: node scripts/smoke-picker.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let uniqueFolders;
let filterByQuery;
let branchesForFolder;
let sessionTabLabel;
let canCloseSession;
let migrateSessions;
let pickerScript;

try {
  const mod = require('../out/services/endpointPicker.js');
  ({
    uniqueFolders,
    filterByQuery,
    branchesForFolder,
    sessionTabLabel,
    canCloseSession,
    migrateSessions,
    pickerScript,
  } = mod);
} catch (e) {
  console.error('Compile first (npm run compile).', e.message);
  process.exit(1);
}

function ep(folder, root, ref, id) {
  return {
    id: id || `${folder}@${ref}`,
    folder,
    root,
    ref,
    label: `${folder} · ${ref}`,
    isHead: ref === 'main',
  };
}

const endpoints = [
  ep('pth-main', '/ws/pth-main', 'main'),
  ep('pth-main', '/ws/pth-main', '1.2.0'),
  ep('pdf-next', '/ws/pdf-next', 'main'),
  ep('pdf-next', '/ws/pdf-next', 'release'),
  ep('vscode-pdf-next', '/ws/vscode-pdf-next', 'main'),
];

const folders = uniqueFolders(endpoints);
assert.strictEqual(folders.length, 3, 'two folders with two branches each plus one must not flatten to five rows');
assert.deepStrictEqual(
  folders.map((f) => f.folder),
  ['pth-main', 'pdf-next', 'vscode-pdf-next']
);
assert.strictEqual(folders[0].branchCount, 2);
assert.strictEqual(folders[2].branchCount, 1);

const filtered = filterByQuery(folders, 'pdf', (f) => f.folder);
assert.deepStrictEqual(
  filtered.map((f) => f.folder),
  ['pdf-next', 'vscode-pdf-next']
);
assert.strictEqual(filterByQuery(folders, 'pth-main', (f) => f.folder).length, 1);
assert.strictEqual(filterByQuery(folders, '', (f) => f.folder).length, 3);

const pthBranches = branchesForFolder(endpoints, '/ws/pth-main', '', false);
assert.strictEqual(pthBranches.length, 2);
assert.ok(pthBranches.every((b) => b.folder === 'pth-main'));
assert.ok(!pthBranches.some((b) => b.folder === 'pdf-next'));
assert.ok(pthBranches.find((b) => b.ref === 'main').isHead);

const withoutPeer = branchesForFolder(endpoints, '/ws/pth-main', 'pth-main@main', false);
assert.strictEqual(withoutPeer.length, 1);
assert.strictEqual(withoutPeer[0].ref, '1.2.0');

assert.strictEqual(sessionTabLabel('pdf-next', 'pdf-next'), 'pdf-next');
assert.strictEqual(sessionTabLabel('pdf-next', 'pth-main'), 'pdf-next · pth-main');
assert.strictEqual(sessionTabLabel('', ''), 'New compare');

assert.strictEqual(canCloseSession(1), false);
assert.strictEqual(canCloseSession(2), true);

const migrated = migrateSessions(undefined, {
  root1: '/ws/a',
  ref1: 'main',
  root2: '/ws/b',
  ref2: 'dev',
});
assert.strictEqual(migrated.sessions.length, 1);
assert.strictEqual(migrated.sessions[0].root1, '/ws/a');
assert.strictEqual(migrated.activeId, 'migrated');

const kept = migrateSessions(
  {
    sessions: [
      { id: 'x', root1: '/1', ref1: 'a', root2: '/2', ref2: 'b' },
      { id: 'y', root1: '/3', ref1: 'c', root2: '/4', ref2: 'd' },
    ],
    activeId: 'y',
  },
  { root1: '/old', ref1: 'm', root2: '/old2', ref2: 'n' }
);
assert.strictEqual(kept.sessions.length, 2);
assert.strictEqual(kept.activeId, 'y');

const empty = migrateSessions(undefined, undefined);
assert.strictEqual(empty.sessions.length, 1);
assert.strictEqual(empty.sessions[0].root1, '');

const webviewDir = path.join(__dirname, '..', 'src', 'webview');
const mainJs = fs.readFileSync(path.join(webviewDir, 'main.js'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(webviewDir, 'index.html'), 'utf-8');

assert.ok(
  indexHtml.includes('/* INJECT_PICKER */'),
  'the page needs a slot for the injected picker helpers'
);
assert.ok(
  mainJs.includes('EndpointPicker'),
  'the panel must use the injected EndpointPicker helpers'
);
for (const [pattern, what] of [
  [/function uniqueFolders\s*\(/, 'uniqueFolders'],
  [/function sessionTabLabel\s*\(/, 'sessionTabLabel'],
  [/function migrateSessions\s*\(/, 'migrateSessions'],
]) {
  assert.ok(
    !pattern.test(mainJs),
    `the panel must not keep its own ${what}; that is how they drifted`
  );
}

const script = pickerScript();
const sandboxed = new Function(`${script}; return EndpointPicker;`)();
assert.strictEqual(typeof sandboxed.uniqueFolders, 'function');
assert.strictEqual(sandboxed.uniqueFolders(endpoints).length, 3);
assert.strictEqual(sandboxed.sessionTabLabel('a', 'a'), 'a');
assert.strictEqual(sandboxed.canCloseSession(1), false);

console.log('smoke-picker: ok');
