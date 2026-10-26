const test = require('node:test');
const assert = require('node:assert/strict');
const { isImplementationRequest, inferImplementationLanguage } = require('./answer-intent.js');

test('treats second-highest salary in a table as an implementation task and infers SQL', () => {
  const question = 'How will you find the second highest salary in a table?';
  assert.equal(isImplementationRequest(question), true);
  assert.equal(inferImplementationLanguage(question), 'SQL');
});

test('does not infer code for ordinary conceptual interview questions', () => {
  assert.equal(isImplementationRequest('What is a data warehouse?'), false);
  assert.equal(inferImplementationLanguage('What is SQL?'), '');
});

test('recognizes explicit implementation requests in other languages', () => {
  assert.equal(isImplementationRequest('Write a Python function to reverse a linked list.'), true);
  assert.equal(inferImplementationLanguage('Find the second highest salary in a table using Python.'), '');
});
