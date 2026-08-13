/**
 * Review-comment JSON smoke (no VS Code).
 * Run: node scripts/smoke-review-comment.js
 */
const assert = require('assert');

let makeReviewComment;
let commentFileName;
let mergeReviewIndex;

try {
  const mod = require('../out/services/reviewComment.js');
  ({ makeReviewComment, commentFileName, mergeReviewIndex } = mod);
} catch (e) {
  console.error('Compile first (npm run compile).', e.message);
  process.exit(1);
}

const now = new Date('2026-08-13T20:15:03.000Z');
const entry = makeReviewComment({
  file: 'src/foo.ts',
  side: 'right',
  root: '/ws/app',
  ref: 'main',
  startLine: 10,
  endLine: 12,
  startCharacter: 2,
  endCharacter: 8,
  selectedText: 'const x = 1',
  comment: '  rename this  ',
  compare: { root1: '/ws/a', ref1: 'old', root2: '/ws/app', ref2: 'main' },
  now,
});

assert.strictEqual(entry.comment, 'rename this');
assert.strictEqual(entry.startLine, 10);
assert.strictEqual(entry.selectedText, 'const x = 1');
assert.strictEqual(entry.side, 'right');
assert.ok(entry.createdAt);
assert.strictEqual(commentFileName(entry), '2026-08-13T20-15-03-000Z-foo.ts.json');

const index = mergeReviewIndex({ comments: [entry] }, { ...entry, id: 'second', comment: 'again' });
assert.strictEqual(index.comments.length, 2);
assert.strictEqual(index.comments[1].comment, 'again');
assert.strictEqual(mergeReviewIndex(undefined, entry).comments.length, 1);

console.log('smoke-review-comment: ok');
