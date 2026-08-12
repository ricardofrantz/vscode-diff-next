/**
 * File-status vocabulary smoke (no VS Code, no git).
 * Run: node scripts/smoke-status.js
 *
 * This runs the status table rather than matching the source that declares it.
 * The panel and the extension used to keep separate copies of the letters,
 * the group order and the labels; a test that only read one of them could not
 * have noticed the other drifting.
 */
const assert = require('assert');

let FILE_STATUSES;
let STATUS_MAP;
let statusInfo;
let statusRank;
let statusTableScript;

try {
  const mod = require('../out/services/fileStatus.js');
  ({ FILE_STATUSES, STATUS_MAP, statusInfo, statusRank, statusTableScript } = mod);
} catch (e) {
  console.error('Compile first (npm run compile).', e.message);
  process.exit(1);
}

const fs = require('fs');
const path = require('path');

// --- the table itself -------------------------------------------------------

assert.ok(FILE_STATUSES.length > 0, 'status table must not be empty');

const values = FILE_STATUSES.map((info) => info.value);
assert.strictEqual(
  new Set(values).size,
  values.length,
  'each status may appear once in the table'
);

const letters = FILE_STATUSES.map((info) => info.letter);
assert.strictEqual(
  new Set(letters).size,
  letters.length,
  'two statuses sharing a letter would be indistinguishable in the file list'
);

for (const info of FILE_STATUSES) {
  assert.ok(info.label, `${info.value} needs a group label`);
  assert.ok(info.letter, `${info.value} needs a letter`);
  assert.strictEqual(
    statusRank(info.value),
    FILE_STATUSES.indexOf(info),
    `${info.value} must sort at its position in the table`
  );
}

// --- git's letters map onto it ---------------------------------------------

// Every code `git diff --name-status` can report, and what it must mean.
for (const [code, expected] of Object.entries({
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange',
})) {
  assert.strictEqual(
    STATUS_MAP[code],
    expected,
    `git's ${code} must map to ${expected}`
  );
}
assert.strictEqual(
  STATUS_MAP.X,
  undefined,
  'unknown git codes must not resolve to a status'
);

// --- behaviour that follows from a status ----------------------------------

// These three flags replaced predicates that were written out at each call
// site in both the extension and the panel.
assert.strictEqual(
  statusInfo('added').addedInTarget2,
  true,
  'added means the discard action deletes from disk'
);
assert.strictEqual(
  statusInfo('modified').addedInTarget2,
  false,
  'modified means the discard action restores, never deletes'
);
assert.strictEqual(
  statusInfo('deleted').presentInTarget2,
  false,
  'a deleted file has nothing on disk to open'
);
assert.strictEqual(
  statusInfo('modified').presentInTarget2,
  true,
  'a modified file is on disk and can be opened'
);
for (const status of ['renamed', 'copied']) {
  assert.strictEqual(
    statusInfo(status).carriesOldPath,
    true,
    `${status} takes its Target 1 side from oldPath`
  );
}
for (const status of ['modified', 'added', 'deleted', 'typechange']) {
  assert.strictEqual(
    statusInfo(status).carriesOldPath,
    false,
    `${status} has no old path`
  );
}

// Anything unrecognised must still render rather than throw.
for (const junk of ['', 'bogus', undefined, null]) {
  const info = statusInfo(junk);
  assert.strictEqual(info.value, 'unknown', `${junk} must fall back to unknown`);
  assert.ok(info.letter && info.label, 'the fallback must still be displayable');
  assert.strictEqual(
    statusRank(junk),
    FILE_STATUSES.length,
    'unrecognised statuses sort last'
  );
}

// --- the panel reads this table instead of keeping its own ------------------

const webviewDir = path.join(__dirname, '..', 'src', 'webview');
const mainJs = fs.readFileSync(path.join(webviewDir, 'main.js'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(webviewDir, 'index.html'), 'utf-8');

assert.ok(
  indexHtml.includes('/* INJECT_STATUS_TABLE */'),
  'the page needs a slot for the injected status table'
);
assert.ok(
  mainJs.includes('FILE_STATUSES'),
  'the panel must build its status vocabulary from the injected table'
);
for (const [pattern, what] of [
  [/const STATUS_LETTER\s*=/, 'letters'],
  [/const STATUS_GROUP_ORDER\s*=/, 'group order'],
  [/const STATUS_GROUP_LABEL\s*=/, 'group labels'],
]) {
  assert.ok(
    !pattern.test(mainJs),
    `the panel must not keep its own copy of the ${what}; that is how they drifted`
  );
}

// The injected fragment has to be valid, self-contained script.
const script = statusTableScript();
const sandboxed = new Function(`${script}; return FILE_STATUSES;`)();
assert.deepStrictEqual(
  sandboxed.map((info) => info.value),
  values,
  'the injected table must match the compiled one'
);

// The page DiffHost renders must parse, with the table declared before the
// panel script that reads it. A redeclaration or a bad fragment would only
// show up as a blank panel at runtime otherwise.
const vm = require('vm');
const pageScript = indexHtml
  .replace('/* INJECT_STATUS_TABLE */', script)
  .replace('/* INJECT_JS */', mainJs)
  .match(/<script nonce="INJECT_NONCE">([\s\S]*?)<\/script>/)[1];
assert.ok(
  pageScript.indexOf('const FILE_STATUSES') < pageScript.indexOf('acquireVsCodeApi'),
  'the status table must be declared before the panel script runs'
);
new vm.Script(pageScript, { filename: 'webview-page.js' });

// Every status needs a CSS class, or its letter renders unstyled.
const css = fs.readFileSync(path.join(webviewDir, 'styles.css'), 'utf-8');
for (const info of FILE_STATUSES) {
  assert.ok(
    css.includes(`status-${info.value}`),
    `styles.css has no rule for status-${info.value}`
  );
}

console.log(
  `smoke-status OK (${FILE_STATUSES.length} statuses: ${values.join(', ')})`
);
