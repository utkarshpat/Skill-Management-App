import { test, expect, fixture, ids } from './browser-fixture';
import { workflowChatShortcut } from '../apps/api/src/modules/ai/workflow-chat-policy';
import type { Page } from '@playwright/test';
async function assistant(page: Page) {
  await fixture(page, { role: 'employee', realistic: true });
  await page.route('**/api/assistant/navigation', r =>
    r.fulfill({
      json: {
        actorId: ids.person,
        pages: [{ url: '/requests', title: 'Requests', description: 'Requests and incidents' }],
        canReviewOwnSkill: true,
        canManageLearning: true,
        status: { configured: true, provider: 'azure' },
        suggestions: [],
      },
    }),
  );
}
test('assistant: workflow scope, local coding refusal and configured deployment are displayed without code blocks', async ({
  page,
}) => {
  await assistant(page);
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/assistant', r => {
    const body = r.request().postDataJSON();
    sent.push(body);
    return r.fulfill({
      json: {
        reply: workflowChatShortcut([{ role: 'user', content: body.message }], {
          name: 'azure',
          deployment: 'team-deployment',
        }),
        sources: [],
        conversationId: ids.person,
        usage: { modelCalls: 0, totalTokens: 0 },
      },
    });
  });
  await page.goto('/requests');
  await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'AI assistant' }),
    input = panel.getByRole('textbox', { name: 'Message AI assistant' });
  await expect(
    panel.getByText('App workflows, drafts & learning practice', { exact: true }),
  ).toBeVisible();
  await input.fill('tum mujhe factorial ka js code do');
  await panel.getByRole('button', { name: 'Send AI message' }).click();
  await expect(panel).toContainText('General coding ke liye code generate nahi kar sakta');
  await expect(panel.locator('pre')).toHaveCount(0);
  await input.fill('konsa ai model se response kr rhe ho');
  await panel.getByRole('button', { name: 'Send AI message' }).click();
  await expect(panel).toContainText('Deployment: team-deployment');
  expect(sent[1].conversationId).toBe(ids.person);
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
  await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click();
  await expect(panel).toContainText('Deployment: team-deployment');
});
test('assistant: quota errors preserve the user message and allow a later workflow question', async ({
  page,
}) => {
  await assistant(page);
  let fail = true;
  await page.route('**/api/assistant', r =>
    fail
      ? r.fulfill({
          status: 429,
          json: {
            error: { message: 'Azure AI quota is exhausted. Wait or check the deployment quota.' },
          },
        })
      : r.fulfill({
          json: {
            reply: 'Open Requests and choose New request, then review your recipient.',
            sources: [],
            conversationId: ids.person,
          },
        }),
  );
  await page.goto('/requests');
  await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'AI assistant' }),
    input = panel.getByRole('textbox', { name: 'Message AI assistant' });
  await input.fill('Help me submit a learning request');
  await panel.getByRole('button', { name: 'Send AI message' }).click();
  await expect(panel).toContainText('Azure AI quota is exhausted');
  await expect(panel).toContainText('Help me submit a learning request');
  await expect(input).toBeEnabled();
  fail = false;
  await input.fill('How do I submit my request?');
  await panel.getByRole('button', { name: 'Send AI message' }).click();
  await expect(panel).toContainText('Open Requests and choose New request');
  await panel.getByRole('button', { name: 'Close AI assistant', exact: true }).click();
  await expect(panel).not.toBeVisible();
});
