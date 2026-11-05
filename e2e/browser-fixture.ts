import { test as base, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { people, claims, plan, certificates, request as workforceRequest } from './workforce-data';
const require = createRequire(import.meta.url);
const v8toIstanbul = require('v8-to-istanbul');
export const ids = {
  tenant: '11111111-1111-4111-8111-111111111111',
  api: '22222222-2222-4222-8222-222222222222',
  person: '33333333-3333-4333-8333-333333333333',
};
export type State = {
  role: 'employee' | 'manager' | 'admin';
  failure?: number;
  pending?: boolean;
  logoutFailure?: boolean;
  realistic?: boolean;
  mutations?: Record<string, unknown>[];
};
export async function fixture(page: Page, state: State) {
  const practice = {
    session: {
      revision: 1,
      notes: 'Compare joins using representative transaction data.',
      minutes: 40,
      resources: [
        {
          label: 'SQL window functions reference',
          url: 'https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql',
        },
      ],
    },
    quizzes: [],
    attempts: [],
  };
  const currentPlan = structuredClone(plan);
  const currentRequest = structuredClone(workforceRequest);
  const requestEvents = [
    {
      id: 'event-1',
      revision: 1,
      action: 'CREATE',
      body: currentRequest.description,
      actorName: people.employee.displayName,
      at: currentRequest.createdAt,
    },
  ];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/dev-login') return json({}, 404);
    if (path === '/api/auth/config')
      return json({
        enabled: true,
        tenantId: ids.tenant,
        apiClientId: ids.api,
        webClientId: ids.api,
      });
    if (route.request().headers().authorization !== 'Bearer synthetic-e2e-access-token')
      return json({ error: { message: 'Synthetic token required' } }, 401);
    const person = {
      id: ids.person,
      ...people[state.role],
      roles: [state.role],
      active: true,
      roleIds: [],
      overrides: [],
    };
    const method = route.request().method();
    if (state.realistic) {
      if (path.endsWith('/evidence')) return json({ revision: 3, canUpload: false, items: [] });
      if (path.startsWith('/api/skill-reviews/'))
        return json({ history: [], total: 0, pageSize: 25 });
      if (path === '/api/my-skills')
        return json({ claims, total: claims.length, page: 1, pageSize: 25, canClaim: true });
      if (path === '/api/certifications')
        return json({
          snapshotRevision: 1,
          records: certificates(ids.person),
          total: 2,
          page: 1,
          pageSize: 25,
          canManage: true,
          canSubmitNew: true,
          canReview: false,
          canUploadImage: true,
        });
      if (path.startsWith('/api/capability-submissions/links/')) return json({ links: [] });
      if (path.startsWith('/api/capability-submissions/')) return json({ records: [] });
      if (path === '/api/learning') {
        if (method === 'POST') {
          const body = route.request().postDataJSON();
          state.mutations?.push(body);
          if (body.id !== currentPlan.id || body.revision !== currentPlan.revision)
            return json({ error: { message: 'Stale plan' } }, 409);
          if (body.action === 'PAUSE') currentPlan.status = 'PAUSED';
          if (body.action === 'RESUME') currentPlan.status = 'ACTIVE';
          currentPlan.revision++;
          return json({ id: currentPlan.id });
        }
        return json({ actorId: ids.person, plans: [currentPlan], canManage: true });
      }
      if (path.includes('/practice')) {
        if (method === 'POST') {
          const body = route.request().postDataJSON();
          state.mutations?.push(body);
          if (body.revision !== practice.session.revision)
            return json({ error: { message: 'Stale session' } }, 409);
          practice.session = {
            revision: practice.session.revision + 1,
            notes: body.notes,
            minutes: body.minutes,
            resources: body.resources,
          };
        }
        return json(practice);
      }
      if (path.endsWith('/image')) return json({ items: [] });
      if (path.startsWith('/api/certifications/'))
        return json({ record: certificates(ids.person).find(c => path.endsWith(c.id)) });
      if (path === '/api/workflows/options')
        return json({
          canRequest: true,
          canIncident: true,
          categories: ['LEARNING', 'SKILL', 'PROFILE_ACCESS', 'PLATFORM', 'OTHER'].flatMap(code =>
            ['REQUEST', 'INCIDENT'].map(kind => ({ code, kind })),
          ),
          recipients: [
            {
              id: '55555555-5555-4555-8555-000000000001',
              name: people.manager.displayName,
              kind: 'REQUEST',
              reportingManager: true,
            },
          ],
        });
      if (path === '/api/workflows') {
        if (method === 'POST') {
          const body = route.request().postDataJSON();
          state.mutations?.push(body);
          if (body.id !== currentRequest.id || body.revision !== currentRequest.revision)
            return json({ error: { message: 'Stale request' } }, 409);
          currentRequest.revision++;
          if (body.action === 'CANCEL') {
            currentRequest.status = 'CANCELLED';
            currentRequest.canCancel = false;
          }
          requestEvents.push({
            id: body.eventId,
            revision: currentRequest.revision,
            action: body.action,
            body: body.body,
            actorName: people.employee.displayName,
            at: '2026-11-05T03:30:00Z',
          });
          return json({ id: currentRequest.id });
        }
        return json({
          items: [currentRequest],
          total: 1,
          page: 1,
          pageSize: 25,
          summary: {
            total: 1,
            submitted: 1,
            cancelled: 0,
            inProgress: 0,
            resolved: 0,
            incidents: 0,
            highPriority: 0,
            myTotal: 1,
            assignedTotal: 0,
          },
        });
      }
      if (path === '/api/workflows/' + workforceRequest.id)
        return json({ record: currentRequest, events: requestEvents });
    }
    const capabilities = {
      ownProfile: true,
      ownSkills: true,
      claimSkills: true,
      certifications: true,
      learning: true,
      requests: true,
      catalogue: true,
      reviewSkills: state.role === 'manager',
      administration: state.role === 'admin',
      manageCatalogue: state.role === 'admin',
      amendments: state.role !== 'employee',
      approveAmendments: state.role === 'admin',
      businessOperations: false,
    };
    if (path === '/api/workspace')
      return state.failure
        ? json(
            {
              error: {
                code: state.pending ? 'ACCESS_NOT_PROVISIONED' : 'UNAVAILABLE',
                message: state.pending
                  ? 'Workspace access is not assigned.'
                  : 'Synthetic workspace unavailable',
              },
            },
            state.failure,
          )
        : json({ person, capabilities, upcoming: [], authentication: 'microsoft' });
    if (path === '/api/auth/identity') return json({ tenantId: ids.tenant, objectId: ids.person });
    if (path === '/api/me')
      return json({
        profile: { ...person, status: 'ACTIVE', organization: 'Aster Analytics' },
      });
    if (path === '/api/effective-access')
      return json({
        actorId: ids.person,
        revision: 1,
        summaryOnly: false,
        decisions: [],
        unsupportedAssignments: [],
      });
    if (path === '/api/notifications') return json({ personId: ids.person, items: [] });
    if (path === '/api/access')
      return json({
        revision: 1,
        currentPerson: person,
        authentication: 'microsoft',
        roles: [],
        people: [person],
        presets: [],
        catalogue: [],
        audit: [],
        canManageUsers: true,
        canViewSkills: true,
        canViewAudit: true,
      });
    if (path === '/api/skills/certifications')
      return json({
        revision: 1,
        total: 1,
        pageSize: 25,
        certifications: [
          {
            id: 'cert-one',
            name: 'Existing certificate',
            provider: 'Synthetic issuer',
            active: true,
          },
        ],
      });
    if (path === '/api/skills')
      return json({
        revision: 1,
        canManage: state.role === 'admin',
        total: 0,
        page: 1,
        pageSize: 25,
        skills: [],
      });
    if (path === '/api/skill-reviews')
      return json({
        claims: [],
        total: 0,
        pageSize: 25,
        categories: ['Synthetic'],
        canReadHistory: true,
        canViewTeam: true,
        canRecommend: true,
      });
    if (path === '/api/business/context')
      return json({
        actorId: ids.person,
        canView: false,
        canAmend: true,
        canApprove: state.role === 'admin',
        canExport: false,
        scopes: [],
      });
    if (path === '/api/business/workflow/masters')
      return json({
        revision: 1,
        page: 1,
        pageSize: 25,
        providerTotal: 1,
        certificationTotal: 1,
        skillTotal: 1,
        providers: [{ id: 'issuer', name: 'Synthetic issuer', active: true }],
        certifications: [],
        skills: [{ id: 'skill-a', name: 'Skill Alpha', active: true }],
      });
    if (path === '/api/business/workflow/amendments')
      return json({
        revision: 1,
        rows: [],
        total: 0,
        page: 1,
        pageSize: 25,
        canApprove: state.role === 'admin',
      });
    if (path.startsWith('/api/ai/'))
      return json({ error: { message: 'Synthetic AI disconnected' } }, 503);
    return json({ error: { message: 'Synthetic fixture does not implement ' + path } }, 503);
  });
}
export const test = base.extend<{ coverageCapture: void }>({
  coverageCapture: [
    async ({ page }, use, info) => {
      await page.clock.setFixedTime(new Date('2026-11-05T09:00:00+05:30'));
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      await use();
      const entries = await page.coverage.stopJSCoverage();
      const out = join(process.cwd(), 'artifacts/coverage/browser');
      mkdirSync(out, { recursive: true });
      const coverage: Record<string, unknown> = {};
      for (const entry of entries) {
        const url = new URL(entry.url || 'http://invalid');
        if (!url.pathname.startsWith('/src/') || !/\.(ts|tsx)$/.test(url.pathname) || !entry.source)
          continue;
        const path = join(process.cwd(), 'apps/web', decodeURIComponent(url.pathname));
        try {
          const converter = v8toIstanbul(path, 0, { source: entry.source });
          await converter.load();
          converter.applyCoverage(entry.functions);
          for (const [name, value] of Object.entries(converter.toIstanbul())) {
            const normalized = normalize(name);
            (value as any).path = normalized;
            coverage[normalized] = value;
          }
        } catch (error) {
          throw Error('Coverage mapping failed for ' + url.pathname + ': ' + String(error));
        }
      }
      writeFileSync(
        join(out, `${info.project.name}-${info.testId}.json`),
        JSON.stringify(coverage),
      );
    },
    { auto: true },
  ],
});

export { expect };
