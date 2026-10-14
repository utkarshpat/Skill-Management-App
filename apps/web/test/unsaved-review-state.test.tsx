import test from 'node:test';
import assert from 'node:assert/strict';
import { warnUnsavedUnload } from '../src/unsaved-unload';
import { submissionReviewSummary } from '../src/capabilities/capability-model';

test('unload is prevented only for pending changes, uploads or uncertain save state', () => {
  for (const pending of [false, true]) {
    const event = new Event('beforeunload', { cancelable: true });
    warnUnsavedUnload(event as BeforeUnloadEvent, pending);
    assert.equal(event.defaultPrevented, pending);
  }
});

test('completed requests from stale queues retain outcomes without claiming outstanding decisions', () => {
  const items = [{ needsReview: true }, { needsReview: true }, { needsReview: false }];
  for (const readOnly of [false, true]) {
    assert.deepEqual(submissionReviewSummary('REVIEWED', items, readOnly), {
      pendingCount: 0,
      canDecide: false,
      label: 'Review completed',
    });
    assert.deepEqual(submissionReviewSummary('LINKED', items, readOnly), {
      pendingCount: 0,
      canDecide: false,
      label: 'Links saved',
    });
  }
  assert.deepEqual(submissionReviewSummary('SUBMITTED', items, false), {
    pendingCount: 2,
    canDecide: true,
    label: '2 awaiting decision',
  });
  assert.deepEqual(submissionReviewSummary('SUBMITTED', items, true), {
    pendingCount: 2,
    canDecide: false,
    label: 'View only',
  });
  assert.equal(submissionReviewSummary('DRAFT', items, false).pendingCount, 0);
});
