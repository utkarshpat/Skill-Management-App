import { test, expect, fixture, ids } from './browser-fixture';
import { workflowChatShortcut } from '../apps/api/src/modules/ai/workflow-chat-policy';
import {
  catalogueGuidance,
  catalogueGuidanceRequest,
} from '../apps/api/src/modules/ai/catalogue-guidance';
import type { Locator, Page } from '@playwright/test';
import { commonLevels } from '../apps/web/src/proficiency';
import { certificates } from './workforce-data';
import { companyRecoveryPage } from '../apps/api/src/modules/identity/company-recovery-page';
async function assistant(page: Page, role: 'employee' | 'manager' | 'admin' = 'employee') {
  await fixture(page, { role, realistic: true });
  await page.route('**/api/announcements/feed*', route =>
    route.fulfill({
      json: { items: [], canPublish: false, person: { name: 'Test Employee', employeeId: '100' } },
    }),
  );
  if (role === 'admin') {
    await page.route('**/api/access/organization', route =>
      route.fulfill({ json: { nodes: [], assignments: [] } }),
    );
  }
  await page.route('**/api/assistant/navigation', r =>
    r.fulfill({
      json: {
        actorId: ids.person,
        pages: [{ url: '/requests', title: 'Requests', description: 'Requests and incidents' }],
        canReviewOwnSkill: true,
        canManageLearning: true,
        status: { configured: true, provider: 'azure' },
        suggestions: [
          { label: 'What can I do?', prompt: 'Explain my permissions.', destination: '/workspace' },
        ],
      },
    }),
  );
}

async function expectClearOfLauncherAtEnd(page: Page, content: Locator) {
  const launcher = page.getByRole('button', { name: 'Open AI assistant' });
  await expect(launcher).toBeVisible();
  await expect(content).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(async () => {
      const bounds = (await content.boundingBox())!;
      return (await launcher.boundingBox())!.y - (bounds.y + bounds.height);
    })
    .toBeGreaterThanOrEqual(12);
}

test('workspace end content can scroll above the floating Skill Genie launcher', async ({
  page,
}) => {
  await assistant(page);
  for (const path of ['/my-skills', '/certifications']) {
    await page.goto(path);
    await expectClearOfLauncherAtEnd(
      page,
      page.getByRole('heading', { name: 'Your next step' }).locator('..'),
    );

    if (path === '/my-skills') {
      const categories = page.getByRole('heading', { name: 'Top categories' }).locator('..');
      await categories.getByRole('button', { name: /^Databases/ }).click();
      await expect(page.getByLabel('Filter portfolio category')).toHaveValue('Databases');
      await page.getByRole('button', { name: 'Clear portfolio filters' }).click();
    } else {
      const validity = page.getByRole('combobox', { name: 'Filter credential validity' });
      await validity.selectOption('Expired');
      await validity.selectOption('Expires soon');
    }
  }
  await page.goto('/learning');
  const recommendations = page.locator('#learning-recommendations');
  await expect(recommendations.getByRole('heading', { name: 'Recommended for you' })).toBeVisible();
  await expectClearOfLauncherAtEnd(page, recommendations);
});

test('approvals can open team analytics above the floating Skill Genie launcher', async ({
  page,
}) => {
  await assistant(page, 'manager');
  await page.route('**/api/capability-submissions?view=queue', route =>
    route.fulfill({ json: { records: [] } }),
  );
  await page.route('**/api/skill-reviews/team?*', route =>
    route.fulfill({
      json: {
        total: 0,
        pageSize: 25,
        people: [],
        skills: [],
        certifications: [],
        analytics: {
          members: 0,
          reviewed: 0,
          pending: 0,
          coverage: [],
          levels: [],
          categories: [],
        },
      },
    }),
  );
  await page.goto('/skill-reviews');
  const analytics = page.getByRole('button', { name: 'Explore team analytics' });
  await expectClearOfLauncherAtEnd(page, analytics);
  await analytics.click();
  await expect(page).toHaveURL(/tab=analytics/);
});

test('catalogue empty search offers Genie matches and opens the authorized amendment page', async ({
  page,
}) => {
  await assistant(page, 'admin');
  const target = '/skills?tab=amendments';
  const pages = [
    { url: '/skills', label: 'Skill catalogue' },
    { url: target, label: 'Catalogue amendments' },
  ];
  await page.route('**/api/assistant/navigation', route => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({ action: 'open_page', destination: target });
      return route.fulfill({ json: { destination: target } });
    }
    return route.fulfill({ json: { pages, status: { configured: true, provider: 'azure' } } });
  });
  await page.route('**/api/assistant', async route => {
    const request = catalogueGuidanceRequest(route.request().postDataJSON().message);
    expect(request).toEqual({ kind: 'skill', search: 'Oracle Cloud Security' });
    const result = await catalogueGuidance(
      request!,
      async search => ({ skills: search === request!.search ? [] : [{ name: 'Oracle Cloud' }] }),
      { pages, canDraftAmendment: true },
    );
    return route.fulfill({ json: { ...result, conversationId: ids.person } });
  });
  await page.goto('/skills');
  await page.getByLabel('Search skills', { exact: true }).fill('Oracle Cloud Security');
  await page.getByRole('button', { name: 'Find matches with Skill Genie' }).click();
  const chat = page.getByRole('dialog', { name: 'AI assistant' });
  await chat.getByRole('button', { name: 'Send AI message' }).click();
  await expect(chat.getByText('Oracle Cloud', { exact: true })).toBeVisible();
  await chat.getByRole('button', { name: /Catalogue amendments/ }).click();
  await expect(page).toHaveURL(/\/skills\?tab=amendments$/);
});

test('certificate details prepare a fresh editable question and keep private credential fields out', async ({
  page,
}) => {
  await assistant(page);
  const certificate = certificates(ids.person)[0];
  let reads = 0;
  let sent = '';
  await page.route(`**/api/certifications/${certificate.id}`, route =>
    route.fulfill({
      json: {
        record: {
          ...certificate,
          expiryDate: ++reads === 1 ? null : '2028-07-01',
          notes: 'Private certificate note',
        },
      },
    }),
  );
  await page.route('**/api/assistant', route => {
    sent = route.request().postDataJSON().message;
    return route.fulfill({
      json: {
        reply: 'Open the certificate details and check its validity.',
        sources: [],
        conversationId: ids.person,
      },
    });
  });
  await page.goto(`/certifications?record=${certificate.id}`);
  const detail = page.getByRole('dialog', { name: certificate.certificationName });
  await detail.getByRole('button', { name: 'Ask Skill Genie' }).click();
  await expect(page).toHaveURL(/\/certifications$/);
  await expect(detail).not.toBeVisible();
  const chat = page.getByRole('dialog', { name: 'AI assistant' });
  const composer = chat.getByRole('textbox', { name: 'Message AI assistant' });
  await expect(composer).toHaveValue('How do I check or renew this certificate?');
  await expect(composer).toBeFocused();
  const context = chat.getByRole('region', { name: 'Current record context' });
  await context.getByText(certificate.certificationName, { exact: true }).click();
  await expect(context.getByText(/Valid till: 2028-07-01/)).toBeVisible();
  expect(sent).toBe('');
  expect(reads).toBe(2);
  await chat.getByRole('button', { name: 'Send AI message' }).click();
  await expect(
    chat.getByText('Open the certificate details and check its validity.'),
  ).toBeVisible();
  expect(sent).not.toContain('Private certificate note');
  expect(sent).not.toContain(certificate.credentialId);
  expect(sent).toContain('Valid till: 2028-07-01');
  expect(sent).toContain('Explain the recorded facts first');
  await context.getByRole('button', { name: 'Back to this record' }).click();
  await expect(detail).toBeVisible();
  expect(reads).toBe(4);
});

test('revoked certificate access stops the handoff and leaves the details dialog open', async ({
  page,
}) => {
  await assistant(page);
  const certificate = certificates(ids.person)[0];
  let reads = 0;
  await page.route(`**/api/certifications/${certificate.id}`, route =>
    ++reads === 1
      ? route.fulfill({ json: { record: certificate } })
      : route.fulfill({
          status: 403,
          json: { error: { message: 'This certificate is no longer available.' } },
        }),
  );
  await page.goto(`/certifications?record=${certificate.id}`);
  const detail = page.getByRole('dialog', { name: certificate.certificationName });
  await detail.getByRole('button', { name: 'Ask Skill Genie' }).click();
  await expect(detail.locator('span[role="alert"]')).toHaveText(
    'This certificate is no longer available.',
  );
  await expect(page.getByRole('dialog', { name: 'AI assistant' })).not.toBeVisible();
});

test('Genie renewal opens the existing wizard and rechecks certificate access on return', async ({
  page,
}) => {
  await assistant(page);
  const certificate = { ...certificates(ids.person)[0], expiryDate: '2026-01-31' };
  let revoked = false;
  await page.route(`**/api/certifications/${certificate.id}`, route =>
    revoked
      ? route.fulfill({ status: 403, json: { error: { message: 'Certificate access changed.' } } })
      : route.fulfill({ json: { record: certificate } }),
  );
  await page.route('**/api/capability-submissions/availability', route =>
    route.fulfill({ json: { fileAvailable: true } }),
  );
  await page.route('**/api/capability-submissions/options', route =>
    route.fulfill({ json: { claims: [], certifications: [], definitions: [] } }),
  );
  await page.goto(`/certifications?record=${certificate.id}`);
  const detail = page.getByRole('dialog', { name: certificate.certificationName });
  await detail.getByRole('button', { name: 'Ask Skill Genie' }).click();
  const chat = page.getByRole('dialog', { name: 'AI assistant' });
  revoked = true;
  await chat.getByRole('button', { name: 'Back to this record' }).click();
  await expect(chat.getByText('Certificate access changed.', { exact: true })).toBeVisible();
  await expect(detail).not.toBeVisible();
  await expect(chat.getByRole('region', { name: 'Current record context' })).toHaveCount(0);
  revoked = false;
  await page.goto(`/certifications?record=${certificate.id}`);
  await detail.getByRole('button', { name: 'Ask Skill Genie' }).click();
  await chat.getByRole('button', { name: 'Renew certificate', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Renew certificate', exact: true })).toBeVisible();
  await expect(chat).not.toBeVisible();
});

test('Genie blocks sending saved record facts when access is revoked while the question is open', async ({
  page,
}) => {
  await assistant(page);
  const certificate = certificates(ids.person)[0];
  let revoked = false;
  let sent = 0;
  await page.route(`**/api/certifications/${certificate.id}`, route =>
    revoked
      ? route.fulfill({ status: 403, json: { error: { message: 'Certificate access changed.' } } })
      : route.fulfill({ json: { record: certificate } }),
  );
  await page.route('**/api/assistant', route => {
    sent++;
    return route.fulfill({ json: {} });
  });
  await page.goto(`/certifications?record=${certificate.id}`);
  await page
    .getByRole('dialog', { name: certificate.certificationName })
    .getByRole('button', { name: 'Ask Skill Genie' })
    .click();
  const chat = page.getByRole('dialog', { name: 'AI assistant' });
  revoked = true;
  await chat.getByRole('button', { name: 'Send AI message' }).click();
  await expect(chat.getByText('Certificate access changed.', { exact: true })).toBeVisible();
  await expect(chat.getByRole('region', { name: 'Current record context' })).toHaveCount(0);
  await expect(chat.getByRole('textbox', { name: 'Message AI assistant' })).toHaveValue(
    'How do I check or renew this certificate?',
  );
  expect(sent).toBe(0);
});

test('Genie asks for confirmation when certificate facts change before sending', async ({
  page,
}) => {
  await assistant(page);
  const certificate = certificates(ids.person)[0];
  let expiryDate: string | null = null;
  const messages: string[] = [];
  await page.route(`**/api/certifications/${certificate.id}`, route =>
    route.fulfill({ json: { record: { ...certificate, expiryDate } } }),
  );
  await page.route('**/api/assistant', route => {
    messages.push(route.request().postDataJSON().message);
    return route.fulfill({
      json: { reply: 'Reviewed the current validity.', sources: [], conversationId: ids.person },
    });
  });
  await page.goto(`/certifications?record=${certificate.id}`);
  await page
    .getByRole('dialog', { name: certificate.certificationName })
    .getByRole('button', { name: 'Ask Skill Genie' })
    .click();
  const chat = page.getByRole('dialog', { name: 'AI assistant' });
  expiryDate = '2028-07-01';
  await chat.getByRole('button', { name: 'Send AI message' }).click();
  await expect(
    chat.getByText('The record changed. Review the updated context and send again.'),
  ).toBeVisible();
  expect(messages).toHaveLength(0);
  await chat.getByRole('button', { name: 'Send AI message' }).click();
  await expect(chat.getByText('Reviewed the current validity.')).toBeVisible();
  expect(messages[0]).toContain('Valid till: 2028-07-01');
});

test('Genie opens recorded certificate feedback and lets the user remove the context', async ({
  page,
}) => {
  await assistant(page);
  const certificate = {
    ...certificates(ids.person)[0],
    status: 'REJECTED',
    feedback: 'Private feedback for this test.',
  };
  await page.route(`**/api/certifications/${certificate.id}`, route =>
    route.fulfill({ json: { record: certificate } }),
  );
  await page.goto(`/certifications?record=${certificate.id}`);
  const detail = page.getByRole('dialog', { name: certificate.certificationName });
  const chat = page.getByRole('dialog', { name: 'AI assistant' });
  await detail.getByRole('button', { name: 'Ask Skill Genie' }).click();
  await chat.getByRole('button', { name: 'Open feedback' }).click();
  await expect(detail.getByText(certificate.feedback, { exact: true })).toBeFocused();
  await detail.getByRole('button', { name: 'Ask Skill Genie' }).click();
  const replace = chat.getByRole('button', { name: 'Replace message' });
  if (await replace.isVisible()) await replace.click();
  await chat.getByRole('button', { name: 'Remove context' }).click();
  await expect(chat.getByRole('region', { name: 'Current record context' })).toHaveCount(0);
  await expect(chat.getByRole('textbox', { name: 'Message AI assistant' })).not.toHaveValue('');
});

test('Activity Log opens Genie with the recorded change and leaves identities out of the question', async ({
  page,
}) => {
  await assistant(page, 'admin');
  const entry = {
    revision: 7,
    targetId: ids.person,
    actorId: ids.person,
    actorName: 'Private reviewer name',
    targetName: 'Private employee name',
    at: '2026-01-02T00:00:00Z',
    action: 'claim.approved',
    before: { status: 'SUBMITTED', feedback: 'Private feedback' },
    after: { status: 'APPROVED', feedback: 'Private note' },
  };
  await page.route('**/api/access/audit*', route =>
    route.fulfill({ json: { items: [entry], hasMore: false, nextCursor: null } }),
  );
  await page.goto('/access?view=audit');
  await page.getByRole('button', { name: 'Skill claim approved', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Activity details' })
    .getByRole('button', { name: 'Ask Skill Genie' })
    .click();
  const context = page.getByRole('region', { name: 'Current record context' });
  await context.getByText('Skill claim approved', { exact: true }).click();
  await expect(context).toContainText('Status: Pending approval → Approved');
  expect(await context.innerText()).not.toMatch(/Private|[a-f0-9]{8}-[a-f0-9]{4}/);
  await context.getByRole('button', { name: 'Back to this record' }).click();
  await expect(page.getByRole('dialog', { name: 'Activity details' })).toBeVisible();
});

test('combined approval offers evidence guidance and protects unfinished feedback', async ({
  page,
}) => {
  await assistant(page, 'manager');
  const submission = '88888888-8888-4888-8888-000000000001';
  await page.route('**/api/capability-submissions/' + submission, route =>
    route.fulfill({
      json: {
        id: submission,
        revision: 3,
        status: 'SUBMITTED',
        skills: [
          {
            id: ids.person,
            name: 'SQL',
            rank: 2,
            needsReview: true,
            status: 'SUBMITTED',
            projects: 'Private project name',
            evidence: 'Private evidence link',
          },
        ],
        certifications: [],
      },
    }),
  );
  await page.goto(`/skill-reviews?submission=${submission}`);
  const approval = page.getByRole('dialog', { name: 'Skill approval request' });
  const notes = approval.getByRole('textbox', { name: /Feedback notes/ });
  await notes.fill('Unsaved decision feedback');
  await expect(approval.getByRole('button', { name: 'Ask Skill Genie' })).toHaveCount(0);
  await notes.fill('');
  await approval.getByRole('button', { name: 'Ask Skill Genie' }).click();
  const context = page.getByRole('region', { name: 'Current record context' });
  await context.getByText('Skill approval request', { exact: true }).click();
  await expect(context).toContainText('SQL: project details, supporting references');
  expect(await context.innerText()).not.toMatch(/Private|Unsaved/);
  await context.getByRole('button', { name: 'View evidence' }).click();
  await expect(approval).toBeVisible();
  await expect(approval.locator('[data-genie-section="evidence"]').first()).toBeFocused();
});

test('individual certificate approval prepares guidance from the current authorized queue', async ({
  page,
}) => {
  await assistant(page, 'manager');
  const certificate = { ...certificates(ids.person)[0], canReview: true, status: 'SUBMITTED' };
  let queueReads = 0;
  await page.route('**/api/certifications?**', route => {
    queueReads++;
    expect(route.request().headers()['x-certification-view']).toBe('review-only');
    return route.fulfill({
      json: { records: [certificate], page: 1, total: 1, pageSize: 25, canReview: true },
    });
  });
  await page.goto('/skill-reviews?type=certifications');
  await page.getByRole('button', { name: 'Open certification approval', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Open certification approval' })
    .getByRole('button', { name: 'Ask Skill Genie' })
    .click();
  await expect(page.getByRole('textbox', { name: 'Message AI assistant' })).toHaveValue(
    /How should I check this certificate for approval\?/,
  );
  expect(queueReads).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'View evidence', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Open certification approval' })
      .locator('[data-genie-section="evidence"]'),
  ).toBeFocused();
});
test('Skill Genie peeks around the sidebar, thinks, and reveals a reply at its start', async ({
  page,
}, info) => {
  await assistant(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const responseReady = Promise.withResolvers<void>();
  await page.route('**/api/assistant', async route => {
    await responseReady.promise;
    await route.fulfill({
      json: {
        conversationId: 'genie-chat',
        reply:
          '**Here is your skill claim checklist.**\n\n' +
          'Check your claim details.\n\n'.repeat(45),
      },
    });
  });
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  const panel = page.getByRole('dialog', { name: 'AI assistant' });
  const mascot = panel.locator('.assistant-side-mascot');
  const chatPose = mascot.locator('img').first();
  const thinkingPose = mascot.locator('.assistant-side-thinking');
  const cloud = mascot.locator('.assistant-thought-cloud');
  const showMascot = info.project.name === 'desktop';
  if (showMascot) {
    await expect(mascot).toBeVisible();
    const peek = mascot.locator('.assistant-side-peek');
    await expect(peek).toHaveCSS('animation-name', 'assistant-genie-peek');
    const peekStart = await peek.evaluate(element => {
      const animation = element.getAnimations().find(item => item.effect instanceof KeyframeEffect);
      return (animation?.effect as KeyframeEffect | undefined)?.getKeyframes()[0]?.transform;
    });
    expect(peekStart).toBe('translateX(100%)');
    await expect(chatPose).toHaveCSS('height', '126px');
    await expect(mascot.locator('.assistant-side-genie')).toHaveCSS('rotate', 'none');
    await expect
      .poll(() => chatPose.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    const handle = page.getByRole('button', { name: 'Collapse AI assistant and resume later' });
    const [mascotBox, panelBox, handleBox] = await Promise.all([
      mascot.boundingBox(),
      panel.boundingBox(),
      handle.boundingBox(),
    ]);
    expect(mascotBox!.x).toBeLessThan(panelBox!.x);
    expect(mascotBox!.y + mascotBox!.height).toBeCloseTo(handleBox!.y - 8, 0);
  } else {
    await expect(mascot).toBeHidden();
  }
  await expect(panel.getByRole('button', { name: 'Close AI assistant' })).toBeInViewport();
  const shortcut = panel.getByRole('button', { name: 'What can I do?', exact: true });
  await expect(shortcut).toHaveCount(1);
  await expect(
    panel.getByRole('navigation', { name: 'AI help shortcuts' }).getByRole('button', {
      name: 'What can I do?',
    }),
  ).toBeVisible();

  const composer = panel.getByRole('textbox', { name: 'Message AI assistant' });
  await expect(composer).toBeFocused();
  await composer.fill('Help me with a skill claim');
  await panel.getByRole('button', { name: 'Send AI message' }).click();
  try {
    await expect(panel.getByRole('status')).toHaveText('Thinking…');
    await expect(composer).toBeFocused();
    await expect(composer).not.toBeEditable();
    const [logBox, greetingBox, userBox] = await Promise.all([
      panel.getByRole('log').boundingBox(),
      panel.getByText('Hello, I’m Skill Genie. How can I help you?').boundingBox(),
      panel.getByText('Help me with a skill claim', { exact: true }).boundingBox(),
    ]);
    expect(greetingBox!.x - logBox!.x).toBeCloseTo(16, 0);
    const userEndInset = logBox!.x + logBox!.width - userBox!.x - userBox!.width;
    expect(userEndInset).toBeGreaterThanOrEqual(16);
    expect(userEndInset).toBeLessThanOrEqual(34);
    expect(userBox!.x).toBeGreaterThan(greetingBox!.x);
    await expect(mascot).toHaveAttribute('data-state', 'thinking');
    await expect(mascot.locator('.assistant-side-genie')).toHaveCSS('animation-name', 'none');
    if (showMascot) {
      await expect(cloud).toBeVisible();
      await expect(cloud.locator('.assistant-thinking-dots > span')).toHaveCount(3);
      await expect(thinkingPose).toHaveCSS('opacity', '1');
      await expect(chatPose).toHaveCSS('opacity', '1');
      await expect(thinkingPose).toHaveCSS('clip-path', /^polygon\(/);
      await expect
        .poll(() => thinkingPose.evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBeGreaterThan(0);
      await page.screenshot({
        path: info.outputPath('genie-thinking.png'),
        animations: 'disabled',
      });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(mascot.locator('.assistant-side-genie')).toHaveCSS('animation-name', 'none');
    await expect(panel.locator('.assistant-thinking-dots span').first()).toHaveCSS(
      'animation-name',
      'none',
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  } finally {
    responseReady.resolve();
  }

  await expect(mascot).toHaveAttribute('data-state', 'reply');
  await expect(panel.getByRole('status')).toBeHidden();
  await expect(composer).toBeFocused();
  await expect(composer).toBeEditable();
  await expect(cloud).toBeHidden();
  await expect(thinkingPose).toHaveCSS('opacity', '0');
  await expect(
    panel.getByText('Here is your skill claim checklist.', { exact: true }),
  ).toBeInViewport();
  await expect(mascot).toHaveAttribute('data-state', 'idle');
  if (showMascot) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => (document.documentElement.dataset.theme = theme), theme);
      await expect(chatPose).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await page.screenshot({ path: info.outputPath('genie-chat-' + theme + '.png') });
    }
  }
});
test('AI skill actions open Add skill with the published skill and experience prefilled', async ({
  page,
}) => {
  await assistant(page);
  const git = {
    id: '11111111-1111-4111-8111-000000000098',
    name: 'Git',
    category: 'DevOps',
    definitionRevision: 1,
    levels: commonLevels(),
  };
  const description = 'I reviewed pull requests and resolved merge conflicts with my team.';
  let writes = 0;
  await page.route('**/api/assistant/navigation', route =>
    route.request().method() === 'POST'
      ? route.fulfill({ json: { destination: '/my-skills' } })
      : route.fallback(),
  );
  await page.route('**/api/assistant', route =>
    route.fulfill({
      json: {
        conversationId: ids.person,
        reply: 'Here is your draft.',
        artifact: {
          kind: 'skill_draft',
          title: 'Git',
          summary: 'Draft for review',
          body: description,
          steps: [],
          questions: [],
          skill: { id: git.id, name: git.name },
        },
      },
    }),
  );
  await page.route('**/api/capability-submissions/availability', route =>
    route.fulfill({ json: { aiAvailable: false, fileAvailable: true } }),
  );
  await page.route('**/api/capability-submissions/options', route =>
    route.fulfill({ json: { claims: [], certifications: [], definitions: [] } }),
  );
  await page.route('**/api/capability-submissions', route => {
    if (route.request().method() !== 'GET') writes++;
    return route.fulfill({ json: {} });
  });
  await page.route('**/api/my-skills/catalogue?**', route =>
    route.fulfill({ json: { skills: [git], total: 1, page: 1, pageSize: 25 } }),
  );
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Open AI assistant' }).click();
  const panel = page.getByRole('dialog', { name: 'AI assistant' });
  await panel
    .getByRole('textbox', { name: 'Message AI assistant' })
    .fill('Draft my Git skill claim');
  await panel.getByRole('button', { name: 'Send AI message' }).click();
  const card = panel.getByRole('region', { name: 'Git', exact: true });
  await expect(card.getByRole('button')).toHaveCount(2);
  for (const action of ['Save as draft', 'Review and submit']) {
    await card.getByRole('button', { name: action, exact: true }).click();
    const skill = page.getByRole('dialog', { name: 'Git', exact: true });
    await expect(skill.getByLabel('Describe your experience')).toHaveValue(description);
    await expect(skill.getByRole('radio', { checked: true })).toHaveCount(0);
    await skill.getByRole('button', { name: 'Close Git', exact: true }).click();
    const composer = page.getByRole('dialog', { name: 'Add skill', exact: true });
    if (action === 'Save as draft')
      await expect(
        composer.getByRole('button', { name: 'Save as draft', exact: true }),
      ).toBeVisible();
    else {
      await expect(
        composer
          .locator('.form-dialog-footer')
          .getByRole('button', { name: 'Preview', exact: true }),
      ).toBeVisible();
      await expect(composer.getByRole('button', { name: 'Save draft', exact: true })).toHaveCount(
        0,
      );
    }
    await composer.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Discard unsaved changes?' })
      .getByRole('button', { name: 'Discard', exact: true })
      .click();
    await expect(composer).toBeHidden();
  }
  expect(writes).toBe(0);
});
test('company sign-in recovery resumes in place for the original account and keeps its unsent draft', async ({
  page,
  context,
}) => {
  await assistant(page);
  let sessionActive = true;
  let sessionSubject = 'test-subject';
  await context.route('**/api/auth/login?**', async route => {
    const correctAccount = new URL(route.request().url()).searchParams.get('mode') === 'choose';
    sessionActive = true;
    sessionSubject = correctAccount ? 'test-subject' : 'different-subject';
    await route.fulfill({
      contentType: 'text/html',
      body: companyRecoveryPage(false, 'test-nonce'),
    });
  });
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
          sessionSubject,
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
  const signIn = recovery.getByRole('link', { name: 'Sign in with Microsoft' });
  await expect(signIn).toHaveAttribute('target', '_blank');
  const [wrongAccount] = await Promise.all([page.waitForEvent('popup'), signIn.click()]);
  await expect(wrongAccount.getByRole('link', { name: 'Open a new workspace' })).toBeVisible();
  await expect(
    recovery.getByRole('alert').filter({ hasText: 'Choose the same work account' }),
  ).toBeVisible();
  await wrongAccount.close();
  await Promise.all([page.waitForEvent('popup'), signIn.click()]);
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
  await expect(launcher.locator('img')).toHaveCount(5);
  const brand = launcher.locator('.assistant-mascot-brand');
  await expect(brand.locator('img')).toHaveAttribute('src', '/brand/skill-genie-logo.png');
  await expect(brand).toHaveCSS('overflow', 'hidden');
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
test('red mascot stays transparent in both admin themes', async ({ page }, info) => {
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
    for (const layer of ['body', 'shell']) {
      await expect(launcher.locator('.assistant-mascot-' + layer)).toHaveCSS(
        'filter',
        /url\(["']?[^"')]*\/brand\/assistant-shell-red\.svg#shell-red["']?\)/,
      );
    }
    await expect(launcher.locator('.assistant-mascot-face')).toHaveCSS('filter', 'none');
    await expect(launcher.locator('.assistant-mascot-brand img')).toHaveCSS('filter', 'none');
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
  await expect(input).toBeFocused();
  await expect(input).toBeEditable();
  fail = false;
  await input.fill('How do I submit my request?');
  await input.press('Enter');
  await expect(panel).toContainText('Open Requests and choose New request');
  await expect(input).toBeFocused();
  await panel.getByRole('button', { name: 'Close AI assistant', exact: true }).click();
  await expect(panel).not.toBeVisible();
});
