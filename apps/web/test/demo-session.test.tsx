import test from 'node:test';
import assert from 'node:assert/strict';
import { startDemoSession, type DemoSessionNotice } from '../src/demo-session';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let now = 1_000,
    expires = now + 30 * 60_000,
    absolute = now + 8 * 60 * 60_000;
  let status = 200,
    expired = 0,
    tick = () => {};
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    hasFocus: () => true,
  });
  const calls: string[] = [],
    notices: DemoSessionNotice[] = [];
  const session = startDemoSession(
    n => notices.push(n),
    () => {
      expired++;
    },
    {
      window: win,
      document: doc,
      now: () => now,
      transport: async input => {
        calls.push(String(input));
        if (String(input).endsWith('/renew') && status === 200)
          expires = Math.min(now + 30 * 60_000, absolute);
        return Response.json({ expiresAt: expires, absoluteExpiresAt: absolute }, { status });
      },
      schedule: fn => {
        tick = fn;
        return 1;
      },
      cancel: () => {},
    },
  );
  return {
    session,
    win,
    doc,
    calls,
    notices,
    tick: () => tick(),
    advance: (ms: number) => {
      now += ms;
    },
    status: (n: number) => {
      status = n;
    },
    expired: () => expired,
    extendInOtherTab: () => {
      expires = now + 30 * 60_000;
    },
  };
}

test('demo sessions renew from recent interaction, never idle/background polling or event storms', async () => {
  const f = fixture();
  await settle();
  assert.deepEqual(f.calls, ['/api/dev-login/session']);
  f.advance(5 * 60_000);
  f.tick();
  await settle();
  assert.equal(f.calls.length, 1, 'Idle polling does not renew');
  f.win.dispatchEvent(new Event('keydown'));
  await settle();
  assert.equal(f.calls.at(-1), '/api/dev-login/renew');
  const count = f.calls.length;
  for (let i = 0; i < 100; i++) f.win.dispatchEvent(new Event('scroll'));
  await settle();
  assert.equal(f.calls.length, count);
  f.advance(6 * 60_000);
  f.doc.visibilityState = 'hidden';
  f.win.dispatchEvent(new Event('keydown'));
  f.tick();
  await settle();
  assert.equal(f.calls.length, count);
  f.session.stop();
});

test('an expiry recheck adopts a session already renewed in another tab', async () => {
  const f = fixture();
  await settle();
  f.advance(31 * 60_000);
  f.extendInOtherTab();
  f.tick();
  await settle();
  assert.equal(f.calls.at(-1), '/api/dev-login/session');
  assert.equal(f.expired(), 0);
  assert.equal(f.notices.at(-1)!.warning, false);
  f.session.stop();
});

test('sign-out waits for pending renewal headers before clearing the cookie', async () => {
  const source = await fs.readFile(new URL('../src/auth.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function signOut()');
  const code = transformSync(
    source
      .slice(start, source.indexOf('export async function profileToken', start))
      .replace('export ', '') + '\nsignOut();',
    { loader: 'ts' },
  ).code;
  let release!: (value: Response) => void;
  const trace: string[] = [];
  const scope = {
    reads: { invalidate: () => {} },
    learningDraftHandoff: { clear: () => {} },
    businessDraftHandoff: { clear: () => {} },
    sessionStorage: { removeItem: () => {} },
    initializeAuth: async () => {},
    demoSession: true,
    demoSigningOut: false,
    pendingDemoRenewal: new Promise<Response>(resolve => {
      release = resolve;
    }),
    fetch: async (_path: string, init: RequestInit) => {
      trace.push(init.method!);
      return new Response(null, { status: 204 });
    },
    demoSessionSync: () => ({ changed: () => trace.push('sync') }),
    window: { location: { assign: () => trace.push('navigate') } },
  };
  const pending = vm.runInNewContext(code, scope);
  await settle();
  assert.equal(scope.demoSigningOut, true);
  assert.deepEqual(trace, []);
  release(Response.json({}));
  await pending;
  assert.deepEqual(trace, ['DELETE', 'sync', 'navigate']);
  assert.equal(scope.demoSession, false);
});

test('idle warning and explicit continue preserve the session; 401 ends it once', async () => {
  const f = fixture();
  await settle();
  f.advance(28 * 60_000);
  f.tick();
  await settle();
  assert.equal(f.notices.at(-1)!.warning, true);
  assert.equal(f.notices.at(-1)!.minutes, 2);
  await f.session.continueSession();
  assert.equal(f.notices.at(-1)!.warning, false);
  f.advance(30 * 60_000);
  f.status(401);
  f.tick();
  await settle();
  assert.equal(f.expired(), 1);
  f.tick();
  await settle();
  assert.equal(f.expired(), 1);
  f.session.stop();
});

test('temporary failures do not log out or retry on every scroll; cleanup stops late work', async () => {
  const f = fixture();
  await settle();
  f.status(503);
  f.advance(5 * 60_000);
  f.win.dispatchEvent(new Event('pointerdown'));
  await settle();
  assert.equal(f.expired(), 0);
  assert.match(f.notices.at(-1)!.error, /connection/);
  const count = f.calls.length;
  for (let i = 0; i < 100; i++) f.win.dispatchEvent(new Event('scroll'));
  await settle();
  assert.equal(f.calls.length, count);
  f.session.stop();
  f.advance(60_000);
  f.tick();
  f.win.dispatchEvent(new Event('keydown'));
  await settle();
  assert.equal(f.calls.length, count);
});
