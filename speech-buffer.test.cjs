const test = require('node:test');
const assert = require('node:assert/strict');
const { merge, looksLikeReadback, looksLikeCandidateAcknowledgment, isActionableInterviewerPrompt } = require('./speech-buffer.js');

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

test('recognizes answer readbacks even when speech recognition splits them into short chunks', () => {
  const answer = 'SQL is a language used to query relational databases';
  assert.equal(looksLikeReadback('SQL is a language', answer), true);
  assert.equal(looksLikeReadback('query relational databases', answer), true);
  assert.equal(looksLikeReadback('Can you explain the query?', answer), false);
});

test('recognizes candidate acknowledgements without swallowing follow-up questions', () => {
  assert.equal(looksLikeCandidateAcknowledgment('Right, you are saying it is correct.'), true);
  assert.equal(looksLikeCandidateAcknowledgment('Right, can you explain that?'), false);
});

test('keeps the current answer for interviewer acknowledgements and statements', () => {
  for (const phrase of ['Hmm', 'Hmm, okay', 'Okay', 'Right', 'I see', 'Got it', 'Makes sense', 'That is correct.']) {
    assert.equal(isActionableInterviewerPrompt(phrase), false, phrase);
  }
});

test('recognizes direct questions and actionable follow-up instructions', () => {
  for (const phrase of [
    'Could you explain how you cleaned the data?',
    'Okay, can you use a window function approach?',
    'Apply the window function and give me the query.',
    'Let’s use a window function for this one.',
    'On the same question, apply a window function.',
    'I want you to show me the query using a window function.',
    'Same query, but using a window function.',
    'Your thoughts on that trade-off?'
  ]) {
    assert.equal(isActionableInterviewerPrompt(phrase), true, phrase);
  }
});
