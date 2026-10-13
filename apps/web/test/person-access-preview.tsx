// Development-only browser fixture. All requests are intercepted; no real grants are changed.
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { AccessAdmin } from '../src/AccessAdmin';
import { initializeAuth } from '../src/auth';
import { ThemeProvider } from '../src/Theme';
import '../src/styles.css';
import '../src/ui.css';
import '../src/theme.css';
import '../src/workspace-pages.css';
import '../src/sidebar-navigation.css';
import '../src/profile-page.css';
import '../src/ui-kit.css';
import '../src/modern-ui.css';
import '../src/effective-access.css';

const admin = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'QA administrator',
  employeeCode: 'QA-001',
  active: true,
  roleIds: [],
  overrides: [],
};
let target = {
  ...admin,
  id: '00000000-0000-4000-8000-000000000002',
  displayName: 'QA suspended person',
  employeeCode: 'QA-002',
  active: false,
};
const roles = [
  {
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Very long additional access template name for verifying mobile layout without granting real access',
    permissions: [
      { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
      { permission: 'users.manage', scope: 'ORGANIZATION', effect: 'DENY' },
      {
        permission: 'audit.view',
        scope: 'ORGANIZATION',
        effect: 'ALLOW',
        validUntil: '2020-01-01T00:00:00Z',
      },
    ],
  },
];
const catalogue = [
  { code: 'profile.view', label: 'View own profile', implemented: true, scopes: ['OWN'] },
  { code: 'users.manage', label: 'Manage people', implemented: true, scopes: ['ORGANIZATION'] },
  { code: 'audit.view', label: 'Read audit', implemented: true, scopes: ['ORGANIZATION'] },
  { code: 'reports.view', label: 'Scoped analytics', implemented: true, scopes: [] },
  { code: 'future.action', label: 'Unavailable action', implemented: false, scopes: ['OWN'] },
];
let revision = 1,
  previews = 0,
  attempts = 0,
  writes = 0;
let receipt = '',
  reviewed = '';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const stats = () => {
  const node = document.getElementById('qa-stats');
  if (node)
    node.textContent = `Local QA only — revision ${revision}; previews ${previews}; save attempts ${attempts}; writes ${writes}`;
};
window.fetch = async (input, init) => {
  const path =
    typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  const method = init?.method ?? 'GET';
  if (path === '/api/dev-login') return json({ mode: 'local-demo', signedIn: true, people: [] });
  if (path.startsWith('/api/dev-access/effective/'))
    return json({ actorId: target.id, revision, decisions: [], unsupportedAssignments: [] });
  if (path === '/api/dev-access' && method === 'GET')
    return json({
      revision,
      presets: [],
      roles,
      people: [admin, target],
      currentPerson: admin,
      canManageUsers: true,
      canViewAudit: false,
      canViewSkills: false,
      audit: [],
      catalogue,
    });
  if (path === '/api/dev-access/preview' && method === 'POST') {
    previews++;
    stats();
    if (previews === 1)
      return json(
        { error: { message: 'QA temporary preview failure. Your inputs are retained.' } },
        503,
      );
    const body = JSON.parse(String(init?.body));
    if (body.revision !== revision)
      return json(
        { error: { message: 'QA revision changed. Reload current configuration.' } },
        409,
      );
    for (const item of body.overrides)
      if (
        !catalogue.some(
          c => c.code === item.permission && c.implemented && c.scopes.includes(item.scope),
        )
      )
        return json({ error: { message: 'QA unsupported permission or scope' } }, 400);
    reviewed = JSON.stringify(body);
    receipt = `qa-receipt-${revision}-${previews}`;
    return json({
      receipt,
      before: target,
      after: body,
      impacts: [
        {
          personId: target.id,
          displayName: target.displayName,
          changes: [],
          unsupportedAssignments: [],
        },
      ],
    });
  }
  if (path === '/api/dev-access' && method === 'POST') {
    attempts++;
    const { previewReceipt, ...body } = JSON.parse(String(init?.body));
    if (attempts === 1) {
      revision++;
      stats();
      return json(
        { error: { message: 'QA revision changed during confirmation. Reload and review again.' } },
        409,
      );
    }
    if (
      body.revision !== revision ||
      previewReceipt !== receipt ||
      JSON.stringify(body) !== reviewed
    )
      return json({ error: { message: 'QA stale or changed receipt' } }, 409);
    target = { ...target, roleIds: body.roleIds, overrides: body.overrides };
    revision++;
    writes++;
    stats();
    return json({ revision });
  }
  return json(
    { error: { message: `Blocked unexpected local QA request: ${method} ${path}` } },
    404,
  );
};
await initializeAuth();
createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <p id="qa-stats" style={{ padding: 8, margin: 0 }}>
      Local QA only — revision 1; previews 0; save attempts 0; writes 0
    </p>
    <MemoryRouter initialEntries={['/access?view=people']}>
      <AccessAdmin />
    </MemoryRouter>
  </ThemeProvider>,
);
