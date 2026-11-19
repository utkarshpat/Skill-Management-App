import { test, expect, fixture, ids } from './browser-fixture';
import { workflowChatShortcut } from '../apps/api/src/modules/ai/workflow-chat-policy';
import type { Page } from '@playwright/test';
async function assistant(page: Page, role: 'employee' | 'admin' = 'employee') {
  await fixture(page, { role, realistic: true });
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
test('company sign-in recovery keeps an unsent draft in the original tab', async ({ page }) => {
  await assistant(page);
  let sessionActive = true;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/config')
      return route.fulfill({
        json: {
          enabled: true,
          tenantId: ids.tenant,
          apiClientId: ids.api,
          webClientId: ids.api,
          cookieSession: true,
          backendSignIn: true,
          sessionActive,
          sessionSubject: 'test-subject',
        },
      });
    if (!sessionActive && path === '/api/workspace')
      return route.fulfill({ status: 401, json: { error: { message: 'Session expired' } } });
    return route.fallback({
      headers: { ...route.request().headers(), authorization: 'Bearer synthetic-e2e-access-token' },
    });
  });
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  const input = page.getByPlaceholder('Ask about this workspace…');
  await input.fill('Help me check my draft skill');
  sessionActive = false;
  await page.evaluate(() => window.dispatchEvent(new Event('workspace-access-updated')));
  const recovery = page.getByRole('dialog', { name: 'Sign in to resume your work' });
  await expect(recovery).toBeVisible();
  await expect(recovery.getByRole('link', { name: 'Sign in with Microsoft' })).toHaveAttribute(
    'target',
    '_blank',
  );
  sessionActive = true;
  await recovery.getByRole('button', { name: 'Resume workspace' }).click();
  await expect(recovery).toBeHidden();
  await expect(input).toHaveValue('Help me check my draft skill');
});
test('assistant mascot loads its artwork and respects reduced motion', async ({
  page,
}, testInfo) => {
  await assistant(page);
  await page.goto('/requests');
  const launcher = page.getByRole('button', { name: 'Open AI assistant' });
  const hand = launcher.locator('.assistant-mascot-hand');
  const head = launcher.locator('.assistant-mascot-head');
  const body = launcher.locator('.assistant-mascot-body');
  const greeting = launcher.getByText('May I help you?');
  await expect(greeting).toBeVisible();
  await expect(body).toHaveCSS('width', '104px');
  await expect(greeting).toHaveCSS('animation-name', 'assistant-type-greeting');
  await expect(launcher.locator('img')).toHaveCount(4);
  const brand = launcher.locator('.assistant-mascot-brand');
  await expect(brand).toHaveAttribute('src', '/brand/skill-genie-logo.png');
  await expect(brand).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect
    .poll(() =>
      launcher
        .locator('img')
        .evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0)),
    )
    .toBe(true);
  await expect(hand).toHaveCSS('animation-name', 'assistant-wave');
  await expect(head).toHaveCSS('animation-name', 'assistant-head-tilt');
  await expect(body).toHaveCSS('animation-name', 'none');
  await expect(hand).toHaveCSS('animation-iteration-count', 'infinite');
  await expect(head).toHaveCSS('animation-iteration-count', 'infinite');
  await expect(greeting).toHaveCSS('animation-iteration-count', 'infinite');
  const timing = await launcher.evaluate(button => {
    const animations = button.getAnimations({ subtree: true });
    for (const animation of animations) animation.pause();
    function frame(time: number) {
      for (const animation of animations) animation.currentTime = time;
      return {
        text: getComputedStyle(button.querySelector('.assistant-greeting-text')!).clipPath,
        hand: getComputedStyle(button.querySelector('.assistant-mascot-hand')!).transform,
        head: getComputedStyle(button.querySelector('.assistant-mascot-head')!).transform,
        body: getComputedStyle(button.querySelector('.assistant-mascot-body')!).transform,
      };
    }
    return { early: frame(600), settled: frame(2500), next: frame(8600) };
  });
  expect(timing.next).toEqual(timing.early);
  expect(timing.early.text).not.toBe(timing.settled.text);
  expect(timing.early.hand).not.toBe(timing.settled.hand);
  expect(timing.early.head).not.toBe(timing.settled.head);
  expect(timing.early.body).toBe(timing.settled.body);
  const viewport = page.viewportSize()!;
  const clip = { x: viewport.width - 305, y: viewport.height - 170, width: 305, height: 170 };
  await page.screenshot({ path: testInfo.outputPath('mascot-moving.png'), clip });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(greeting).toHaveCSS('animation-name', 'none');
  await expect(hand).toHaveCSS('animation-name', 'none');
  await expect(head).toHaveCSS('animation-name', 'none');
  const bodyBounds = await body.boundingBox();
  const brandBounds = await brand.boundingBox();
  expect(bodyBounds!.y + bodyBounds!.height).toBeCloseTo(viewport.height);
  expect(brandBounds!.y).toBeGreaterThan(bodyBounds!.y + bodyBounds!.height * 0.7);
  expect(brandBounds!.y + brandBounds!.height).toBeLessThan(viewport.height);
  await page.screenshot({
    path: testInfo.outputPath('mascot.png'),
    clip,
  });
  await launcher.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog', { name: 'AI assistant' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('.assistant-message').first()).toContainText(
    'Hello, I’m Skill Genie. How can I help you?',
  );
});
test('blue mascot stays transparent in both admin themes', async ({ page }, info) => {
  await assistant(page, 'admin');
  await page.goto('/access?view=assignments');
  const launcher = page.getByRole('button', { name: 'Open AI assistant' });
  await expect(launcher).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const viewport = page.viewportSize()!;
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => (document.documentElement.dataset.theme = theme), theme);
    await expect(launcher).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    for (const image of await launcher.locator('img').all()) {
      await expect(image).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(image).toHaveCSS('padding', '0px');
    }
    await expect(launcher.locator('.assistant-mascot-body')).toHaveCSS('filter', 'none');
    await expect(launcher.locator('.assistant-mascot-brand')).toHaveCSS('filter', 'none');
    await page.screenshot({
      path: info.outputPath('mascot-' + theme + '.png'),
      clip: { x: viewport.width - 305, y: viewport.height - 170, width: 305, height: 170 },
    });
  }
});

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
