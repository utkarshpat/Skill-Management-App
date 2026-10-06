import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { DashboardAttention } from '../src/DashboardAttention';
test('attention renders real destinations and distinguishes unknown counts from zero', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <DashboardAttention
        total={3}
        partial
        onRetry={() => {}}
        groups={[
          {
            id: 'request-SUBMITTED',
            title: 'Requests to start',
            description: 'Assigned to you',
            href: '/requests?inbox=true&kind=REQUEST&status=SUBMITTED',
            label: 'Start work',
            tone: 'teal',
            count: 3,
          },
          {
            id: 'learning',
            title: 'Overdue learning',
            description: 'Active plans',
            href: '/learning?tab=backlog',
            label: 'Open backlog',
            tone: 'amber',
            count: null,
          },
        ]}
      />
    </MemoryRouter>,
  );
  assert.match(html, /inbox=true&amp;kind=REQUEST&amp;status=SUBMITTED/);
  assert.match(html, /Queue unavailable · count unknown/);
  assert.match(html, /Retry queue/);
  assert.doesNotMatch(html, /href="\/learning/);
  assert.doesNotMatch(html, /caught up/);
});
test('empty attention is compact and never adds decorative work queues', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <DashboardAttention total={0} onRetry={() => {}} groups={[]} />
    </MemoryRouter>,
  );
  assert.match(html, /You’re caught up/);
  assert.doesNotMatch(html, /dashboard-attention-group |href=/);
});
