import { test, expect, fixture } from './browser-fixture';
import content from '../apps/api/src/modules/knowledge-transfer/content.generated';
const knowledge = { ...content, ai: { configured: true, provider: 'azure' }, temporary: true };

test('handover: search, chapter routing, workflow walkthroughs and handbook export', async ({
  page,
}) => {
  await fixture(page, { role: 'admin' });
  await page.route('**/api/knowledge-transfer', r => r.fulfill({ json: knowledge }));
  await page.goto('/knowledgetransfer');
  await expect(
    page.getByRole('heading', { name: 'Understand the system. Own the next step.' }),
  ).toBeVisible();
  const chapters = page.getByRole('button', { name: 'Chapters', exact: true });
  if (await chapters.isVisible()) await chapters.click();
  await page.getByRole('searchbox', { name: 'Search handover' }).fill('zzzz-no-such-chapter');
  await expect(page.getByText('0 matching chapters', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search handover' }).fill('trust boundaries');
  await page.locator('.kt-results button').first().click();
  await expect(
    page.getByRole('heading', { name: 'One request. Four trust boundaries.' }),
  ).toBeVisible();
  await page.goto('/knowledgetransfer#catalogue-skill-claim-workflow');
  await expect(page.getByRole('heading', { name: 'Walk through a workflow' })).toBeVisible();
  for (const name of [
    'Skill claim',
    'Learning',
    'Recommendation',
    'Request',
    'Access change',
    'Executive Analytics',
    'Certification',
  ]) {
    await page.locator('.kt-flow-tabs').getByRole('button', { name, exact: true }).click();
    await page.locator('.kt-flow button').last().click();
    await expect(page.locator('.kt-walkthrough > p')).toContainText('Step 5:');
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export handbook' }).click();
  expect((await download).suggestedFilename()).toBe('project-handover.md');
});

test('handover: schema explorer filters, relationship map and source-derived API search', async ({
  page,
}) => {
  await fixture(page, { role: 'admin' });
  await page.route('**/api/knowledge-transfer', r => r.fulfill({ json: knowledge }));
  await page.goto('/knowledgetransfer#table-AccessPerson');
  await expect(page.getByRole('heading', { name: 'dbo.AccessPerson', exact: true })).toBeVisible();
  const graph = page.getByRole('img', { name: 'Foreign key neighborhood of AccessPerson' });
  const initial = await graph.getAttribute('width');
  await page.getByRole('button', { name: 'Zoom in relationship map' }).click();
  expect(await graph.getAttribute('width')).not.toBe(initial);
  await page.getByRole('button', { name: 'Zoom out relationship map' }).click();
  await expect(graph).toHaveAttribute('width', initial!);
  await page.getByRole('searchbox', { name: 'Search tables and columns' }).fill('no-such-table');
  await expect(page.getByText('No matching tables.', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search tables and columns' }).fill('');
  const domains = page.getByRole('combobox', { name: 'Schema domain' });
  await domains.selectOption({ index: 1 });
  await domains.selectOption('');
  await page.goto('/knowledgetransfer#api-inventory');
  await page
    .getByRole('searchbox', { name: 'Search API and SQL inventory' })
    .fill('/api/workflows');
  await expect(page.getByText('/api/workflows', { exact: true }).first()).toBeVisible();
  await page
    .getByRole('searchbox', { name: 'Search API and SQL inventory' })
    .fill('ReadOwnSkillClaims');
  await page.locator('.kt-inventory details summary').first().click();
  await expect(page.locator('.kt-inventory details[open]')).toBeVisible();
});

test('handover: failed guide reply restores question; retry cites source; new chat clears context', async ({
  page,
}) => {
  await fixture(page, { role: 'admin' });
  await page.route('**/api/knowledge-transfer', r => r.fulfill({ json: knowledge }));
  let failure = true;
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/knowledge-transfer/explain', r => {
    sent.push(r.request().postDataJSON());
    return failure
      ? r.fulfill({
          status: 503,
          json: { error: { message: 'Project guide temporarily unavailable' } },
        })
      : r.fulfill({
          json: {
            reply: 'Manager review rechecks the current assignment and saved claim version.',
            sources: [
              {
                id: 'review',
                title: 'Skill claim workflow',
                href: '/knowledgetransfer#catalogue-skill-claim-workflow',
              },
            ],
          },
        });
  });
  await page.goto('/knowledgetransfer');
  await page
    .getByRole('button', {
      name: page.viewportSize()!.width < 760 ? 'AI guide' : 'Ask about this chapter',
      exact: true,
    })
    .click();
  const question = page.getByRole('textbox', { name: 'Ask the project guide' });
  await question.fill('How does manager skill review work?');
  await page.getByRole('button', { name: 'Send project question' }).click();
  await expect(
    page.getByRole('complementary', { name: 'Project AI guide' }).getByRole('alert'),
  ).toContainText('Project guide temporarily unavailable');
  await expect(question).toHaveValue('How does manager skill review work?');
  failure = false;
  await page.getByRole('button', { name: 'Send project question' }).click();
  await expect(page.getByRole('log')).toContainText(
    'Manager review rechecks the current assignment',
  );
  await page.getByText('Source context · 1', { exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Skill claim workflow', exact: true }),
  ).toHaveAttribute('href', '/knowledgetransfer#catalogue-skill-claim-workflow');
  expect(sent[0].section).toBe(knowledge.sections[0].id);
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByRole('log')).not.toContainText('Manager review rechecks');
  await expect(question).toHaveValue('');
  await page.getByRole('button', { name: 'Collapse project guide' }).click();
  await expect(question).not.toBeVisible();
});
