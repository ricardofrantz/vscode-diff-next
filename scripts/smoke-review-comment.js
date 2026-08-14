/**
 * Slim sibling-revision JSON smoke (no VS Code).
 * Run: node scripts/smoke-review-comment.js
 */
const assert = require('assert');
const path = require('path');

let makeAgentComment;
let commentRange;
let parseCommentRange;
let revisionFilePath;
let mergeAgentComments;
let removeAgentComment;
let AGENT_TAGS;
let isAgentTag;

try {
  const mod = require('../out/services/reviewComment.js');
  ({
    makeAgentComment,
    commentRange,
    parseCommentRange,
    revisionFilePath,
    mergeAgentComments,
    removeAgentComment,
    AGENT_TAGS,
    isAgentTag,
  } = mod);
} catch (e) {
  console.error('Compile first (npm run compile).', e.message);
  process.exit(1);
}

assert.deepStrictEqual([...AGENT_TAGS], ['fix', 'improve', 'explain', 're-check', 'discuss']);
assert.strictEqual(isAgentTag('fix'), true);
assert.strictEqual(isAgentTag('re-checl'), false);

assert.strictEqual(commentRange(18, 18), '18-18');
assert.strictEqual(commentRange(18, 21), '18-21');
assert.strictEqual(commentRange(21, 18), '18-21');
assert.deepStrictEqual(parseCommentRange('18-21'), { startLine: 18, endLine: 21 });
assert.deepStrictEqual(parseCommentRange('21-18'), { startLine: 18, endLine: 21 });
assert.strictEqual(parseCommentRange('nope'), undefined);
assert.strictEqual(parseCommentRange('0-2'), undefined);

const entry = makeAgentComment({
  selectedText: 'const x = 1\nconst y = 2',
  range: '10-11',
  tag: 'fix',
  comment: '  rename this  ',
});
assert.deepStrictEqual(entry, {
  selected_text: 'const x = 1\nconst y = 2',
  range: '10-11',
  tag: 'fix',
  comment: 'rename this',
});
assert.deepStrictEqual(Object.keys(entry), ['selected_text', 'range', 'tag', 'comment']);

assert.strictEqual(revisionFilePath(path.join('src', 'myfile.md')), path.join('src', 'myfile-rev.json'));
assert.strictEqual(revisionFilePath(path.join('src', 'foo.ts')), path.join('src', 'foo-rev.json'));
assert.strictEqual(revisionFilePath('Makefile'), 'Makefile-rev.json');
assert.strictEqual(revisionFilePath(path.join('src', '.env')), path.join('src', '.env-rev.json'));

const first = mergeAgentComments(undefined, entry);
assert.ok(Array.isArray(first));
assert.strictEqual(first.length, 1);
assert.deepStrictEqual(first[0], entry);
assert.deepStrictEqual(mergeAgentComments({ selectedText: 'old', comment: 'x' }, entry), first);

const second = makeAgentComment({
  selectedText: 'y',
  range: '12-14',
  tag: 'discuss',
  comment: 'why',
});
const both = mergeAgentComments(first, second);
assert.strictEqual(both.length, 2);
assert.deepStrictEqual(both[1], second);
assert.deepStrictEqual(removeAgentComment(both, second), first);
assert.deepStrictEqual(removeAgentComment(first, entry), []);

console.log('smoke-review-comment: ok');
