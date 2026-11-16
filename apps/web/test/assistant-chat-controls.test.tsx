import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRequire } from 'node:module';
const { useLocation } = createRequire(import.meta.url)(
  'react-router',
) as typeof import('react-router');
function LocationProbe() {
  const location = useLocation();
  return <output data-location>{location.pathname + location.search}</output>;
}
import type { Artifact } from '../src/AssistantOutput';
const { learningDraftHandoff } = component<typeof import('../src/learning-draft-handoff')>(
  'learning-draft-handoff.ts',
);
const { businessDraftHandoff } = component<typeof import('../src/business/business-draft-handoff')>(
  'business/business-draft-handoff.ts',
);
import { render, settle, closeBrowser, demoResponse, deferred } from './support/browser';
import {
  component,
  MemoryRouter,
  refreshDevelopmentLogin,
  click,
  change,
} from './support/interactions';
const { AssistantWidget } =
  component<typeof import('../src/AssistantWidget')>('AssistantWidget.tsx');
let view: Awaited<ReturnType<typeof render>> | undefined;
let navigationFailure = false,
  configured = true,
  historyFailure = false,
  chatFailure = false,
  contextReset = false;
let outgoing: any[] = [],
  deleted: string[] = [];
let artifact: Artifact | undefined;
let grants = false,
  navActor = 'aditi',
  actionFailure = false;
let actions: any[] = [];
let pending: ReturnType<typeof deferred<Response>> | undefined;
const navigation = () => ({
  actorId: navActor,
  pages: grants ? [{ label: 'Requests', url: '/requests' }] : [],
  canReviewOwnSkill: false,
  canManageLearning: grants,
  canDraftDemand: grants,
  canDraftAmendment: grants,
  status: { configured, provider: 'azure', mode: 'workflows' },
  suggestions: [
    {
      label: 'Check request progress',
      destination: '/requests',
      prompt: 'Show my request progress',
    },
  ],
});
beforeEach(async () => {
  artifact = undefined;
  grants = false;
  navActor = 'aditi';
  actionFailure = false;
  actions = [];
  learningDraftHandoff.clear();
  businessDraftHandoff.clear();
  navigationFailure = false;
  configured = true;
  historyFailure = false;
  chatFailure = false;
  contextReset = false;
  outgoing = [];
  deleted = [];
  pending = undefined;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/dev-login') return demoResponse();
    if (url === '/api/assistant/navigation' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      actions.push(body);
      return actionFailure
        ? Response.json({ error: { message: 'Current action denied' } }, { status: 403 })
        : Response.json({ destination: body.destination, label: 'Requests' });
    }
    if (url === '/api/workflows/options')
      return Response.json({ canRequest: false, canIncident: false });
    if (url === '/api/assistant/navigation')
      return navigationFailure ? Response.json({}, { status: 403 }) : Response.json(navigation());
    if (url === '/api/assistant/conversations')
      return historyFailure
        ? Response.json(
            { error: { message: 'Chat history temporarily unavailable' } },
            { status: 503 },
          )
        : Response.json({
            conversations: [
              {
                id: 'chat-reporting',
                title: 'Reporting assignment',
                updatedAt: '2026-11-08T10:00:00Z',
              },
            ],
          });
    if (url === '/api/assistant/conversations/chat-reporting') {
      if (init?.method === 'DELETE') {
        deleted.push('chat-reporting');
        return Response.json({ ok: true });
      }
      return Response.json({
        contextReset,
        messages: [
          { role: 'user', content: 'Where is my request?' },
          { role: 'assistant', content: 'Open My requests to check its current status.' },
        ],
      });
    }
    if (url === '/api/assistant') {
      outgoing.push(JSON.parse(String(init?.body)));
      if (pending) return pending.promise;
      return chatFailure
        ? Response.json(
            { error: { message: 'AI quota exhausted. Try again later.' } },
            { status: 429 },
          )
        : Response.json({
            conversationId: 'chat-reporting',
            reply: 'Open Requests to review the current request status.',
            artifact,
            sources: grants ? [{ label: 'Requests', url: '/requests' }] : [],
          });
    }
    throw Error('Unexpected request ' + url);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);
async function mount() {
  view = await render(
    <MemoryRouter>
      <AssistantWidget />
      <LocationProbe />
    </MemoryRouter>,
  );
  await click('Open AI assistant');
}
const input = () => document.querySelector<HTMLTextAreaElement>('#assistant-message')!;

test('assistant quota failure restores unsent text, retry sends once and new chat clears context', async () => {
  await mount();
  await change(input(), 'Where can I see my request progress?');
  chatFailure = true;
  await click('Send AI message');
  assert.match(document.body.textContent!, /AI quota exhausted/);
  assert.equal(input().value, 'Where can I see my request progress?');
  assert.equal(document.querySelectorAll('.assistant-messages .assistant-user').length, 0);
  chatFailure = false;
  await click('Send AI message');
  assert.deepEqual(outgoing[0], outgoing[1]);
  assert.match(document.body.textContent!, /Open Requests to review/);
  await click('New AI conversation');
  await change(input(), 'How do I update my profile?');
  await click('Send AI message');
  assert.equal(outgoing[2].conversationId, undefined);
});

test('history resume keeps conversation identity, reports access reset and deletes only the selected chat', async () => {
  await mount();
  await click('Recent AI chats');
  await click('Reporting assignment');
  assert.match(document.body.textContent!, /Open My requests/);
  await change(input(), 'Who can review this?');
  await click('Send AI message');
  assert.equal(outgoing[0].conversationId, 'chat-reporting');
  contextReset = true;
  await click('Recent AI chats');
  await click('Reporting assignment');
  assert.match(document.body.textContent!, /Your access changed/);
  await click('Recent AI chats');
  await click('Delete chat: Reporting assignment');
  assert.deepEqual(deleted, ['chat-reporting']);
  assert.match(document.body.textContent!, /No saved chats yet/);
  await change(input(), 'Check my new request');
  await click('Send AI message');
  assert.equal(outgoing[1].conversationId, undefined);
});

test('history failure remains recoverable and unsent shortcut replacement requires a choice', async () => {
  await mount();
  historyFailure = true;
  await click('Recent AI chats');
  assert.match(document.body.textContent!, /Chat history temporarily unavailable/);
  await click('Recent AI chats');
  historyFailure = false;
  await click('Recent AI chats');
  assert.match(document.body.textContent!, /Reporting assignment/);
  await click('Recent AI chats');
  await change(input(), 'Keep my profile question');
  await click('Check request progress');
  assert.match(document.body.textContent!, /You have an unsent message/);
  assert.equal(outgoing.length, 0);
  await click('Keep my message');
  assert.equal(input().value, 'Keep my profile question');
  await click('Check request progress');
  await click('Replace message');
  assert.equal(input().value, 'Show my request progress');
  assert.equal(outgoing.length, 0);
});

test('collapsed background reply does not block navigation and can be resumed after completion', async () => {
  await mount();
  pending = deferred<Response>();
  await change(input(), 'Check request status');
  await click('Send AI message');
  await click('Collapse AI assistant and resume later');
  assert.ok(document.querySelector('[aria-label="AI is replying in the background"]'));
  await act(async () =>
    pending!.resolve(
      Response.json({
        conversationId: 'chat-reporting',
        reply: 'Your request progress is available in My requests.',
      }),
    ),
  );
  await settle();
  assert.ok(document.querySelector('[aria-label="AI reply ready"]'));
  await click('Open AI assistant');
  assert.equal(document.querySelector('#assistant-panel')!.getAttribute('aria-hidden'), 'false');
  await click('Close AI assistant');
  assert.equal(document.querySelector('#assistant-panel')!.getAttribute('aria-hidden'), 'true');
});

test('unverified navigation and unconfigured model disable sending', async () => {
  navigationFailure = true;
  await mount();
  assert.match(document.body.textContent!, /Assistant actions could not be verified/);
  assert.equal(input().disabled, true);
  await click('Close AI assistant');
  navigationFailure = false;
  configured = false;
  await click('Open AI assistant');
  assert.match(document.body.textContent!, /Model connection pending/);
  assert.equal(input().disabled, true);
  assert.equal(outgoing.length, 0);
});

const suggestion = (kind: Artifact['kind']): Artifact => ({
  kind,
  title: 'Client reporting workflow',
  summary: 'Review delivery reporting',
  body: 'Improve SQL reporting for the assigned project.',
  steps: ['Validate report totals'],
  questions: [],
});
const location = () =>
  new URL(document.querySelector('[data-location]')!.textContent!, 'http://localhost');
async function replyWith(kind: Artifact['kind']) {
  artifact = suggestion(kind);
  await change(input(), 'Help me with my reporting workflow');
  await click('Send AI message');
}

test('assistant page action rechecks current permission and never navigates after a denied recheck', async () => {
  grants = true;
  await mount();
  await replyWith('request_draft');
  actionFailure = true;
  await click('Open Requests');
  assert.equal(location().pathname, '/');
  assert.match(document.body.textContent!, /Current action denied/);
  actionFailure = false;
  await click('Open Requests');
  assert.equal(location().pathname, '/requests');
  assert.deepEqual(actions, [
    { destination: '/requests', action: 'open_page' },
    { destination: '/requests', action: 'open_page' },
  ]);
  assert.match(document.body.textContent!, /Your chat stays here/);
});

test('assistant learning handoff requires the same current actor and remains an unsaved single-use draft', async () => {
  grants = true;
  await mount();
  await replyWith('task_draft');
  navActor = 'rohan';
  await click('Review plan & add to calendar');
  assert.equal(location().pathname, '/');
  assert.match(document.body.textContent!, /current permissions do not allow/);
  navActor = 'aditi';
  await click('Review plan & add to calendar');
  assert.equal(location().pathname, '/learning');
  assert.equal(location().searchParams.get('action'), 'draft');
  const ticket = location().searchParams.get('draftTicket')!;
  assert.deepEqual(learningDraftHandoff.take('aditi', ticket), {
    title: 'Client reporting workflow',
    goal: 'Improve SQL reporting for the assigned project.',
    tasks: ['Validate report totals'],
    dailyMinutes: 30,
  });
  assert.equal(learningDraftHandoff.take('aditi', ticket), undefined);
  assert.equal(actions.length, 0);
});

test('business draft handoffs recheck revoked access and preserve demand versus catalogue destinations', async () => {
  for (const kind of ['amendment_draft', 'demand_draft'] as const) {
    await view?.unmount();
    view = undefined;
    grants = true;
    await mount();
    await replyWith(kind);
    grants = false;
    await click('Review business draft');
    assert.equal(location().pathname, '/');
    assert.match(document.body.textContent!, /current access does not allow/);
    grants = true;
    await click('Review business draft');
    assert.equal(location().pathname, kind === 'amendment_draft' ? '/skills' : '/business');
    assert.equal(
      location().searchParams.get('tab'),
      kind === 'amendment_draft' ? 'amendments' : 'demand',
    );
    const ticket = location().searchParams.get('draftTicket')!;
    assert.equal(businessDraftHandoff.take('aditi', ticket)?.kind, kind);
    assert.equal(businessDraftHandoff.take('aditi', ticket), undefined);
  }
});

test('request and incident drafts cannot open a composer after current options deny creation', async () => {
  await mount();
  for (const kind of ['request_draft', 'incident_draft'] as const) {
    await replyWith(kind);
    const labels = kind === 'request_draft' ? 'Review request draft' : 'Review incident draft';
    await click(labels);
    assert.match(document.body.textContent!, /current permissions do not allow this draft/);
    assert.equal(document.querySelector('.request-composer'), null);
    assert.equal(actions.length, 0);
  }
});

test('contextual people search asks for requirements locally and includes the exact narrowing prompt on send', async () => {
  grants = true;
  await mount();
  const prompt =
    'Find people in Customer Insights Modernisation. Use conversational search, not a saved demand form.';
  await act(async () =>
    window.dispatchEvent(
      new CustomEvent('assistant-context-request', { detail: { prompt, autoSend: true } }),
    ),
  );
  await settle();
  assert.equal(outgoing.length, 0);
  assert.match(document.body.textContent!, /What work or project/);
  await change(input(), 'SQL reporting and current Oracle credentials');
  await click('Send AI message');
  assert.match(outgoing[0].message, /Customer Insights Modernisation/);
  assert.match(outgoing[0].message, /User requirements:\nSQL reporting/);
  assert.equal(actions.length, 0);
});
