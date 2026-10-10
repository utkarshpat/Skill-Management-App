import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyResponse, toast } from '../src/toast';
import { compressEvidenceImage } from '../src/evidence-image';
test('Shared toast response reader preserves bodies and supports successful business writes', async () => {
  const r = new Response(JSON.stringify({ error: { message: 'Access changed' } }), { status: 403 });
  await notifyResponse('/api/my-skills', 'POST', r);
  assert.equal((await r.json()).error.message, 'Access changed');
  await notifyResponse('/api/my-skills', 'POST', new Response('{}'));
  await notifyResponse('/api/ai/chat', 'POST', new Response('{}'));
});
test('Browser compression rejects unsupported and oversized files before decode', async () => {
  await assert.rejects(
    compressEvidenceImage(new File(['<svg/>'], 'test.svg', { type: 'image/svg+xml' })),
  );
  await assert.rejects(
    compressEvidenceImage(new File([new Uint8Array(10485761)], 'huge.png', { type: 'image/png' })),
  );
});
test('certificate compression enforces the 5 MB original limit while evidence retains 10 MB', async () => {
  const original = globalThis.createImageBitmap;
  let decodes = 0;
  globalThis.createImageBitmap = async () => {
    decodes++;
    throw Error('Synthetic decode failure');
  };
  try {
    await assert.rejects(
      compressEvidenceImage(
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'too-large.png', { type: 'image/png' }),
        5,
      ),
      /up to 5 MB/,
    );
    assert.equal(decodes, 0);
    await assert.rejects(
      compressEvidenceImage(
        new File([new Uint8Array(5 * 1024 * 1024)], 'boundary.png', { type: 'image/png' }),
        5,
      ),
      /could not be opened/,
    );
    await assert.rejects(
      compressEvidenceImage(
        new File([new Uint8Array(6 * 1024 * 1024)], 'evidence.png', { type: 'image/png' }),
      ),
      /could not be opened/,
    );
    assert.equal(decodes, 2);
  } finally {
    globalThis.createImageBitmap = original;
  }
});

test('Toast success does not claim previews, AI responses or navigation are saved', async () => {
  const events: { message: string; kind: string }[] = [];
  const originalWindow = globalThis.window,
    originalEvent = globalThis.CustomEvent;
  class TestEvent {
    detail: unknown;
    constructor(_type: string, init: { detail: unknown }) {
      this.detail = init.detail;
    }
  }
  Object.assign(globalThis, {
    window: {
      dispatchEvent: (event: { detail: { message: string; kind: string } }) => {
        events.push(event.detail);
        return true;
      },
    },
    CustomEvent: TestEvent,
  });
  try {
    for (const path of [
      '/api/access/preview',
      '/api/assistant',
      '/api/assistant/navigation',
      '/api/ai/chat',
      '/api/learning/planner',
    ])
      await notifyResponse(path, 'POST', new Response('{}'));
    assert.equal(events.length, 0);
    await notifyResponse('/api/learning', 'POST', new Response('{}'));
    assert.equal(events[0].message, 'Changes saved.');
    await notifyResponse(
      '/api/my-skills',
      'POST',
      new Response('{"error":{"message":"Access changed"}}', { status: 403 }),
    );
    assert.equal(events[1].kind, 'error');
  } finally {
    Object.assign(globalThis, { window: originalWindow, CustomEvent: originalEvent });
  }
});

test('Explicit feedback shares one typed event contract and covered writes avoid duplicate success', async () => {
  const events: { message: string; kind: string }[] = [];
  const originalWindow = globalThis.window,
    originalEvent = globalThis.CustomEvent;
  class TestEvent {
    detail: unknown;
    constructor(_type: string, init: { detail: unknown }) {
      this.detail = init.detail;
    }
  }
  Object.assign(globalThis, {
    window: {
      dispatchEvent: (event: { detail: { message: string; kind: string } }) => {
        events.push(event.detail);
        return true;
      },
    },
    CustomEvent: TestEvent,
  });
  try {
    for (const path of [
      '/api/my-skills/submit',
      '/api/skill-reviews/decision',
      '/api/workflows',
      '/api/recommendations',
      '/api/certifications',
      '/api/certifications/123/image',
      '/api/certification-recommendations/send',
      '/api/certification-recommendations/respond',
    ])
      await notifyResponse(path, 'POST', new Response('{}'));
    assert.equal(events.length, 0);
    toast.warning('Draft saved; submission failed.');
    toast.success('Submitted.');
    assert.deepEqual(events, [
      { message: 'Draft saved; submission failed.', kind: 'warning' },
      { message: 'Submitted.', kind: 'success' },
    ]);
    await notifyResponse('/api/my-skills/123/evidence', 'POST', new Response('{}'));
    assert.equal(events[2].message, 'Evidence image uploaded.');
  } finally {
    Object.assign(globalThis, { window: originalWindow, CustomEvent: originalEvent });
  }
});
