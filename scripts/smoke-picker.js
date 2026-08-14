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
let sessionDisplayName;
let canCloseSession;
let moveSession;
let duplicateSession;
let closeSessions;
let pickerStartRoot;
let migrateSessions;
let pickerScript;

try {
  const mod = require('../out/services/endpointPicker.js');
  ({
    uniqueFolders,
    filterByQuery,
    branchesForFolder,
    sessionTabLabel,
    sessionDisplayName,
    canCloseSession,
    moveSession,
    duplicateSession,
    closeSessions,
    pickerStartRoot,
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

const folders = uniqueFolders(endpoints, false);
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

const named = migrateSessions(
  { sessions: [{ id: 'x', root1: '/1', ref1: 'a', root2: '/2', ref2: 'b', name: 'api vs main' }], activeId: 'x' },
  undefined
);
assert.strictEqual(named.sessions[0].name, 'api vs main', 'a renamed tab must survive a round trip through storage');
const blankName = migrateSessions(
  { sessions: [{ id: 'x', root1: '/1', ref1: 'a', root2: '/2', ref2: 'b', name: '   ' }], activeId: 'x' },
  undefined
);
assert.ok(!('name' in blankName.sessions[0]), 'a blank name is dropped, not stored');

// --- reordering -----------------------------------------------------------
const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
assert.deepStrictEqual(moveSession(tabs, 2, 0).map((t) => t.id), ['c', 'a', 'b']);
assert.deepStrictEqual(moveSession(tabs, 0, 2).map((t) => t.id), ['b', 'c', 'a']);
assert.deepStrictEqual(moveSession(tabs, 1, 1).map((t) => t.id), ['a', 'b', 'c']);
assert.deepStrictEqual(moveSession(tabs, 5, 0).map((t) => t.id), ['a', 'b', 'c']);
assert.deepStrictEqual(moveSession(tabs, 0, -1).map((t) => t.id), ['a', 'b', 'c']);
assert.deepStrictEqual(tabs.map((t) => t.id), ['a', 'b', 'c'], 'moveSession must not mutate its input');

// --- duplicate ------------------------------------------------------------
const pair = [{ id: 'a', root1: '/1', ref1: 'main', root2: '/1', ref2: 'dev' }, { id: 'b' }];
const dupped = duplicateSession(pair, 'a', 'a2');
assert.deepStrictEqual(dupped.map((t) => t.id), ['a', 'a2', 'b'], 'the copy lands right after its source');
assert.strictEqual(dupped[1].ref2, 'dev', 'the copy carries both endpoints');
assert.ok(!('name' in dupped[1]) || !dupped[1].name, 'an unnamed tab copies without inventing a name');
assert.strictEqual(duplicateSession([{ id: 'a', name: 'api' }], 'a', 'a2')[1].name, 'api (2)');
assert.strictEqual(duplicateSession(pair, 'missing', 'x').length, 2);

// --- close modes ----------------------------------------------------------
const four = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
const others = closeSessions(four, 'a', 'others', 'c');
assert.deepStrictEqual(others.sessions.map((t) => t.id), ['c']);
assert.strictEqual(others.activeId, 'c', 'closing the others makes the survivor active');
const right = closeSessions(four, 'd', 'right', 'b');
assert.deepStrictEqual(right.sessions.map((t) => t.id), ['a', 'b']);
assert.strictEqual(right.activeId, 'b', 'the active tab was closed, so focus falls back');
const rightKeepsActive = closeSessions(four, 'a', 'right', 'b');
assert.strictEqual(rightKeepsActive.activeId, 'a', 'an untouched active tab keeps focus');
const one = closeSessions(four, 'b', 'one', 'b');
assert.deepStrictEqual(one.sessions.map((t) => t.id), ['a', 'c', 'd']);
assert.strictEqual(one.activeId, 'c', 'closing the active tab moves to its right neighbour');
const last = closeSessions([{ id: 'a' }], 'a', 'one', 'a');
assert.deepStrictEqual(last.sessions.map((t) => t.id), ['a'], 'the last tab can never be closed');
assert.deepStrictEqual(closeSessions(four, 'a', 'others', 'nope').sessions.length, 4);

// --- tab names ------------------------------------------------------------
assert.strictEqual(sessionDisplayName('api vs main', 'pdf-next', 'pth-main'), 'api vs main');
assert.strictEqual(sessionDisplayName('  ', 'pdf-next', 'pth-main'), 'pdf-next · pth-main');
assert.strictEqual(sessionDisplayName('', '', ''), 'New compare');

// --- folder carried into the other box ------------------------------------
assert.strictEqual(
  pickerStartRoot(2, '/ws/pdf-next', '', ''),
  '/ws/pdf-next',
  'box 2 opens on the folder box 1 is already using'
);
assert.strictEqual(
  pickerStartRoot(2, '/ws/pdf-next', '/ws/pth-main', ''),
  '/ws/pth-main',
  'an explicit choice on this side is never overridden'
);
assert.strictEqual(
  pickerStartRoot(1, '', '', '/ws/last'),
  '/ws/last',
  'a brand-new tab inherits the folder you were last in'
);
assert.strictEqual(pickerStartRoot(1, '', '', ''), '', 'with nothing to go on, show the folder list');
assert.strictEqual(pickerStartRoot(1, '/ws/a/', '', ''), '/ws/a', 'the start root comes back normalized');

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
const caseFolded = uniqueFolders(
  [ep('A', '/ws/Repo', 'main', 'a'), ep('B', '/ws/repo', 'dev', 'b')],
  true
);
assert.strictEqual(caseFolded.length, 1, 'case-insensitive grouping merges roots that differ only by case');
const caseKept = uniqueFolders(
  [ep('A', '/ws/Repo', 'main', 'a'), ep('B', '/ws/repo', 'dev', 'b')],
  false
);
assert.strictEqual(caseKept.length, 2, 'case-sensitive grouping keeps distinct roots');

for (const [pattern, what] of [
  [/function uniqueFolders\s*\(/, 'uniqueFolders'],
  [/function sessionTabLabel\s*\(/, 'sessionTabLabel'],
  [/function migrateSessions\s*\(/, 'migrateSessions'],
  [/function normalizeRoot\s*\(/, 'normalizeRoot'],
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
for (const name of ['moveSession', 'duplicateSession', 'closeSessions', 'pickerStartRoot', 'sessionDisplayName']) {
  assert.strictEqual(typeof sandboxed[name], 'function', `the panel needs ${name} injected`);
}
assert.deepStrictEqual(sandboxed.moveSession([{ id: 'a' }, { id: 'b' }], 1, 0).map((t) => t.id), ['b', 'a']);
assert.strictEqual(sandboxed.pickerStartRoot(2, '/ws/x', '', ''), '/ws/x');

console.log('smoke-picker: ok');
