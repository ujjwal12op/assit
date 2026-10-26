const test = require('node:test');
const assert = require('node:assert/strict');
const { merge } = require('./speech-buffer.js');

test('joins final snippets split across recognizer boundaries without losing words', () => {
  assert.equal(merge('Can you find the second highest', 'highest salary using SQL?'), 'Can you find the second highest salary using SQL?');
});

test('does not duplicate exact or contained final snippets', () => {
  assert.equal(merge('Can you explain SQL?', 'Can you explain SQL?'), 'Can you explain SQL?');
  assert.equal(merge('Can you explain SQL to me?', 'Can you explain SQL?'), 'Can you explain SQL to me?');
});

test('keeps later words when consecutive snippets do not overlap', () => {
  assert.equal(merge('Can you explain', 'the query?'), 'Can you explain the query?');
});
