/**
 * Compare-window prefs smoke (no VS Code).
 * Run: node scripts/smoke-diff-view.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let normalizeDiffView;
let neighborPath;
let DEFAULT_DIFF_VIEW;
let diffViewScript;

try {
  const mod = require('../out/services/diffView.js');
  ({ normalizeDiffView, neighborPath, DEFAULT_DIFF_VIEW, diffViewScript } = mod);
} catch (e) {
  console.error('Compile first (npm run compile).', e.message);
  process.exit(1);
}

assert.strictEqual(DEFAULT_DIFF_VIEW.wordWrap, true);
assert.strictEqual(DEFAULT_DIFF_VIEW.pinTab, false);
assert.strictEqual(DEFAULT_DIFF_VIEW.showMoves, false);
assert.strictEqual(DEFAULT_DIFF_VIEW.sideBySide, true);

const empty = normalizeDiffView(undefined);
assert.strictEqual(empty.wordWrap, true, 'missing prefs default wrap on');
assert.strictEqual(empty.ignoreTrimWhitespace, false);

const custom = normalizeDiffView({
  wordWrap: false,
  ignoreTrimWhitespace: true,
  sideBySide: false,
  collapseUnchanged: true,
  pinTab: false,
  showMoves: false,
});
assert.deepStrictEqual(custom, {
  wordWrap: false,
  ignoreTrimWhitespace: true,
  sideBySide: false,
  collapseUnchanged: true,
  pinTab: false,
  showMoves: false,
});

const paths = ['a.ts', 'b.ts', 'c.ts'];
assert.strictEqual(neighborPath(paths, 'b.ts', 1), 'c.ts');
assert.strictEqual(neighborPath(paths, 'b.ts', -1), 'a.ts');
assert.strictEqual(neighborPath(paths, 'c.ts', 1), '');
assert.strictEqual(neighborPath(paths, 'a.ts', -1), '');
assert.strictEqual(neighborPath(paths, 'missing.ts', 1), 'a.ts');
assert.strictEqual(neighborPath([], 'a.ts', 1), '');

const webviewDir = path.join(__dirname, '..', 'src', 'webview');
const mainJs = fs.readFileSync(path.join(webviewDir, 'main.js'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(webviewDir, 'index.html'), 'utf-8');
assert.ok(indexHtml.includes('/* INJECT_DIFF_VIEW */'), 'page needs the injected diff-view helpers');
assert.ok(mainJs.includes('normalizeDiffView'), 'panel must use injected normalizeDiffView');
assert.ok(mainJs.includes('neighborPath'), 'panel must use injected neighborPath');
assert.ok(
  !/function normalizeDiffView\s*\(/.test(mainJs),
  'panel must not keep its own normalizeDiffView'
);

const sandboxed = new Function(
  `${diffViewScript()}; return { normalizeDiffView, neighborPath, DEFAULT_DIFF_VIEW };`
)();
assert.strictEqual(sandboxed.neighborPath(['a', 'b'], 'a', 1), 'b');
assert.strictEqual(sandboxed.normalizeDiffView({}).wordWrap, true);

console.log('smoke-diff-view: ok');
