import test from 'node:test';
import assert from 'node:assert/strict';
import { learningPracticeUrl } from '../src/learning-practice-url';

test('practice and attempt URLs preserve values without injecting query parameters or fragments', () => {
  const plan = 'plan&scope=other',
    task = 'task+# fragment',
    id = 'attempt?&id=other';
  const read = new URL(learningPracticeUrl(plan, task), 'https://example.test');
  assert.equal(read.pathname, '/api/learning/practice');
  assert.deepEqual(
    [...read.searchParams],
    [
      ['planId', plan],
      ['taskId', task],
    ],
  );
  assert.equal(read.hash, '');
  const review = new URL(learningPracticeUrl(plan, task, id), 'https://example.test');
  assert.equal(review.pathname, '/api/learning/practice/review');
  assert.deepEqual(
    [...review.searchParams],
    [
      ['planId', plan],
      ['taskId', task],
      ['id', id],
    ],
  );
  assert.equal(review.hash, '');
});
