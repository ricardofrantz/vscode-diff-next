/**
 * Platform path equality smoke (no VS Code, no git).
 * Run: node scripts/smoke-paths.js
 */
const path = require('path');
const assert = require('assert');

// Load compiled helpers after tsc; fall back to reimplement if out missing.
let normalizeRoot;
let pathsEqual;
let pathIsUnder;
let PATH_CASE_INSENSITIVE;

try {
  const mod = require('../out/services/gitService.js');
  normalizeRoot = mod.normalizeRoot;
  pathsEqual = mod.pathsEqual;
  pathIsUnder = mod.pathIsUnder;
  PATH_CASE_INSENSITIVE = mod.PATH_CASE_INSENSITIVE;
} catch (e) {
  console.error('Compile first (npm run compile).', e.message);
  process.exit(1);
}

assert.strictEqual(PATH_CASE_INSENSITIVE, process.platform === 'win32');

const a = normalizeRoot('C:\\Users\\Test\\repo');
const b = normalizeRoot('C:/Users/Test/repo');
assert.ok(a.includes('/'), 'normalizeRoot uses forward slashes');
assert.ok(!a.endsWith('/'), 'normalizeRoot strips trailing slash');

if (process.platform === 'win32') {
  assert.ok(pathsEqual('C:\\Foo\\Bar', 'c:/foo/bar'), 'Windows case-insensitive equal');
  assert.ok(pathIsUnder('C:/Foo/Bar/sub', 'c:/foo/bar'), 'Windows under');
} else {
  // Distinct case → not equal on POSIX
  const lower = '/tmp/diff-next-case/repo';
  const upper = '/tmp/diff-next-case/Repo';
  assert.strictEqual(pathsEqual(lower, upper), false, 'POSIX case-sensitive');
  assert.ok(pathsEqual('/home/u/proj', '/home/u/proj'), 'POSIX same path');
  assert.ok(pathIsUnder('/home/u/proj/src', '/home/u/proj'), 'POSIX under');
  assert.strictEqual(pathIsUnder('/home/u/other', '/home/u/proj'), false);
}

// Cross-style separators still normalize
assert.ok(
  pathsEqual(path.join('a', 'b', 'c'), path.join('a', 'b', 'c').replace(/\\/g, '/'))
);

console.log(`smoke-paths OK on ${process.platform} (caseInsensitive=${PATH_CASE_INSENSITIVE})`);
