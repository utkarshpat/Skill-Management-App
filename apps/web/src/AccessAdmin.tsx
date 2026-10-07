import { AccessAudit } from './AccessAudit';
import { EffectiveAccess, type Decision } from './EffectiveAccess';
import {
  EmploymentFields,
  EmploymentSummary,
  EmploymentChange,
  type Employment,
} from './EmploymentDetails';
import { PrimaryCapabilityFields } from './PrimaryCapabilityFields';
import { SidebarNavigation } from './SidebarNavigation';
import { AccessDirectory } from './AccessDirectory';
import { OrganizationSetup } from './OrganizationSetup';
import { Workspace, type WorkspaceState } from './Workspace';
import { personalNavigationItems, personalPageTitle } from './WorkspaceNavigation';
import { readOrganizationSummary, type OrganizationSummary } from './organization-summary';
import { SkillCatalogue } from './SkillCatalogue';
import { FormDialog } from './FormDialog';
import { NavigationDrawer } from './NavigationDrawer';
import { Sidebar } from './Sidebar';
import { NavbarAccount } from './NavbarAccount';
import { RoleAssignments } from './RoleAssignments';
import { PermissionEditor } from './PermissionEditor';
import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router';
import { authenticatedFetch, isDemoSession } from './auth';
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  History,
  ArrowUpRight,
  Plus,
  BookOpen,
  ChevronRight,
  FolderTree,
  Search,
  Menu,
} from 'lucide-react';
interface Assignment {
  permission: string;
  scope: 'OWN' | 'ORGANIZATION';
  effect: 'ALLOW' | 'DENY';
  validUntil?: string;
  reason?: string;
}
interface Role {
  id: string;
  name: string;
  permissions: Assignment[];
}
interface Person extends Employment {
  id: string;
  displayName: string;
  employeeCode: string;
  active: boolean;
  roleIds: string[];
  overrides: Assignment[];
}
interface Preset {
  key: string;
  name: string;
  description: string;
  permissions: Assignment[];
  pending: { permission: string; scope: string }[];
}
interface State {
  presets: Preset[];
  revision: number;
  storage?: string;
  currentPerson?: Person;
  authentication?: string;
  roles: Role[];
  people: Person[];
  catalogue: {
    code: string;
    label: string;
    implemented?: boolean;
    scopes?: ('OWN' | 'ORGANIZATION')[];
  }[];
  canManageUsers: boolean;
  canViewSkills?: boolean;
  canViewAudit?: boolean;
  audit: {
    actorId: string;
    action: string;
    targetId: string;
    at: string;
    revision: number;
    after?: { name?: string };
  }[];
}
const emptyRole = (): Role => ({ id: '', name: '', permissions: [] });
const emptyPerson = (): Person => ({
  id: '',
  displayName: '',
  employeeCode: '',
  jobTitle: null,
  grade: null,
  primaryCapabilityId: null,
  primaryCapabilityName: null,
  primaryCapabilityStatus: null,
  active: true,
  roleIds: [],
  overrides: [],
});
type View = 'overview' | 'roles' | 'people' | 'audit' | 'organization' | 'assignments' | 'skills';
const currentView = (params: URLSearchParams): View => {
  const view = params.get('view');
  return view &&
    ['overview', 'roles', 'people', 'audit', 'organization', 'assignments', 'skills'].includes(view)
    ? (view as View)
    : 'overview';
};
const actionLabel = (action: string) =>
  ({
    'organization.person.assigned': 'Assignment updated',
    'organization.node.created': 'Organization added',
    'organization.node.updated': 'Organization updated',
    'person.created': 'Person added',
    'person.updated': 'Person updated',
    'claim.draft.created': 'Skill draft added',
    'claim.draft.updated': 'Skill draft updated',
    'skill.created': 'Skill created',
    'skill.updated': 'Skill updated',
    'role.created': 'Role created',
    'role.updated': 'Role updated',
  })[action] ?? action.replaceAll('.', ' ').replaceAll('_', ' ');
export function AccessAdmin({
  personalPath,
  personalCapabilities,
  workspaceContext,
}: {
  personalPath?: string;
  personalCapabilities?: WorkspaceState['capabilities'];
  workspaceContext?: WorkspaceState;
}) {
  const navigate = useNavigate();
  const personalTitle = personalPageTitle(personalPath);
  const [state, setState] = useState<State>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [role, setRole] = useState<Role>(emptyRole);
  const [person, setPerson] = useState<Person>(emptyPerson);
  const [editor, setEditor] = useState<'role' | 'person'>(),
    [editorPage, setEditorPage] = useState(0),
    [editorRevision, setEditorRevision] = useState(0),
    [rolePage, setRolePage] = useState(0);
  const [search, setSearch] = useState('');
  const [navigationOpen, setNavigationOpen] = useState(false);
  useEffect(() => {
    setNavigationOpen(false);
    setEditor(undefined);
  }, [personalPath]);
  const [pageActions, setPageActions] = useState<HTMLDivElement | null>(null);
  const [organization, setOrganization] = useState<OrganizationSummary>();
  const [organizationError, setOrganizationError] = useState('');
  const [organizationAttempt, setOrganizationAttempt] = useState(0);
  const [organizationLoading, setOrganizationLoading] = useState(false);
  const [assignmentDraft, setAssignmentDraft] = useState<Record<string, string[]>>({});
  const [department, setDepartment] = useState('');
  useEffect(() => {
    if (!state?.canManageUsers || isDemoSession()) {
      setOrganization(undefined);
      setOrganizationError('');
      setOrganizationLoading(false);
      return;
    }
    const controller = new AbortController();
    setOrganization(undefined);
    setOrganizationError('');
    setOrganizationLoading(true);
    authenticatedFetch('/api/access/organization', { signal: controller.signal })
      .then(readOrganizationSummary)
      .then(value => {
        if (!controller.signal.aborted) setOrganization(value);
      })
      .catch(reason => {
        if (!controller.signal.aborted)
          setOrganizationError(
            reason instanceof Error
              ? reason.message
              : 'Organization details could not be loaded. Try again.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setOrganizationLoading(false);
      });
    return () => controller.abort();
  }, [state?.revision, organizationAttempt]);
  const [bulkReview, setBulkReview] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<string>(),
    [personSection, setPersonSection] = useState('effective');
  const [review, setReview] = useState<{
    body: Record<string, unknown>;
    receipt: string;
    before?: Employment;
    after?: Employment;
    impacts: {
      personId: string;
      displayName: string;
      changes: Decision[];
      unsupportedAssignments: unknown[];
    }[];
  }>();
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  const tab = currentView(params);
  function setTab(view: View) {
    if (personalPath) {
      navigate('/access?view=' + view);
      return;
    }
    setParams(current => {
      const next = new URLSearchParams(current);
      next.set('view', view);
      return next;
    });
  }
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab, personalPath]);
  const endpoint = isDemoSession() ? '/api/dev-access' : '/api/access';
  function createRecord(kind: 'person' | 'role') {
    setTab(kind === 'person' ? 'people' : 'roles');
    setSearch('');
    setNotice('');
    setError('');
    setEditor(kind);
    setEditorPage(0);
    setRolePage(0);
    setEditorRevision(state?.revision ?? 0);
    if (kind === 'person') setPerson(emptyPerson());
    else setRole(emptyRole());
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>(`#${kind}-editor input`)?.focus(),
    );
  }
  async function load() {
    const response = await authenticatedFetch(endpoint);
    if (!response.ok)
      throw new Error(
        response.status === 403
          ? 'Your ID does not have permission to administer access.'
          : response.status === 401
            ? 'Sign in with an assigned administrator ID.'
            : 'Local access administration is unavailable.',
      );
    const data: State = await response.json();
    setState(data);
    window.dispatchEvent(new Event('workspace-access-updated'));
    return data;
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    authenticatedFetch(endpoint, { signal: controller.signal })
      .then(async response => {
        if (!response.ok)
          throw new Error(
            response.status === 403
              ? 'Your ID does not have permission to administer access.'
              : 'Sign in with your assigned Microsoft administrator account.',
          );
        const data: State = await response.json();
        if (active) setState(data);
      })
      .catch(err => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [endpoint]);
  async function save(kind: 'role' | 'person') {
    if (!state) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = kind === 'role' ? role : person;
      const body = { ...value, id: value.id || undefined, kind, revision: editorRevision };
      const response = await authenticatedFetch(endpoint + '/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result?.error?.message ?? 'Preview could not be loaded.');
      setReview({
        body,
        receipt: result.receipt,
        before: result.before,
        after: result.after,
        impacts: result.impacts,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The change could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  async function confirmSave() {
    if (!review || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await authenticatedFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...review.body, previewReceipt: review.receipt }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result?.error?.message ?? 'Save failed.');
      await load();
      setReview(undefined);
      setEditor(undefined);
      setNotice('Saved and audited. Effective access has been refreshed.');
    } catch (err) {
      setReview(undefined);
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }
  async function saveAssignments() {
    if (!state || busy) return;
    const pending = state.people.filter(
      item =>
        assignmentDraft[item.id] &&
        JSON.stringify([...item.roleIds].sort()) !==
          JSON.stringify([...assignmentDraft[item.id]].sort()),
    );
    setBulkReview(false);
    setBusy(true);
    setError('');
    setNotice('');
    let saved = 0;
    try {
      for (const item of pending) {
        const body = {
          ...item,
          roleIds: assignmentDraft[item.id],
          kind: 'person',
          revision: state.revision + saved,
        };
        const previewResponse = await authenticatedFetch(endpoint + '/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const preview = await previewResponse.json();
        if (!previewResponse.ok) throw Error(preview?.error?.message ?? 'Preview failed.');
        const response = await authenticatedFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, previewReceipt: preview.receipt }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => undefined);
          throw new Error(body?.error?.message ?? 'Assignments could not be saved.');
        }
        saved++;
        setAssignmentDraft(current => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
      }
      await load();
      setNotice('Saved ' + saved + ' people.');
    } catch (err) {
      await load().catch(() => {});
      setError(
        (err instanceof Error ? err.message : 'Save failed.') +
          ' ' +
          saved +
          ' people saved. Review remaining selections before saving again.',
      );
    } finally {
      setBusy(false);
    }
  }
  const name = state?.currentPerson?.displayName ?? 'Workspace administrator';
  const greetingName = state?.currentPerson ? name.trim().split(/\s+/)[0] || 'there' : 'there';
  const sections = [
    { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'organization', label: 'Organization', icon: FolderTree },
    { id: 'skills', label: 'Skill catalogue', icon: BookOpen },
    { id: 'people', label: 'People & Access', icon: Users },
    { id: 'roles', label: 'Access templates', icon: ShieldCheck },
    { id: 'assignments', label: 'Role assignments', icon: Users },
    { id: 'audit', label: 'Activity log', icon: History },
  ] as const;
  const sidebarContent = (close: () => void = () => {}) => (
    <>
      <Link className="admin-brand" to="/access">
        <img src="/brand/sopra-steria.svg" alt="Sopra Steria" />
      </Link>
      <p className="nav-caption">WORKSPACE</p>
      <SidebarNavigation
        actorId={workspaceContext?.person.id ?? state?.currentPerson?.id}
        label="Administration sections"
        onNavigate={close}
        items={[
          ...sections
            .filter(
              section =>
                section.id === 'overview' ||
                section.id === 'roles' ||
                (section.id === 'skills'
                  ? state?.canViewSkills
                  : section.id === 'audit'
                    ? state?.canViewAudit
                    : state?.canManageUsers),
            )
            .map(({ id, label, icon }) => ({
              id: id === 'overview' ? 'dashboard' : id,
              label,
              icon,
              active: !personalTitle && tab === id,
              onSelect: () => {
                setTab(id);
                setEditor(undefined);
                setSearch('');
                setNotice('');
              },
            })),
          ...personalNavigationItems(personalCapabilities, personalPath),
        ]}
      />
    </>
  );

  return (
    <div className="admin-shell">
      <a className="skip-link" href="#access-main">
        Skip to content
      </a>
      <Sidebar className="desktop-sidebar">{sidebarContent()}</Sidebar>
      {navigationOpen && (
        <NavigationDrawer onClose={() => setNavigationOpen(false)}>
          {close => <Sidebar>{sidebarContent(close)}</Sidebar>}
        </NavigationDrawer>
      )}
      <div className="admin-content">
        <header className="admin-topbar">
          <button
            className="navigation-toggle secondary-button"
            aria-label="Open navigation"
            aria-expanded={navigationOpen}
            aria-controls="workspace-navigation"
            onClick={() => setNavigationOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="page-location navbar-context">
            <div className="navbar-greeting">
              <span className="greeting-hello">Hello,</span>
              <strong className="greeting-name" title={name}>
                {greetingName}
              </strong>
            </div>
            <h1>{personalTitle ?? sections.find(section => section.id === tab)?.label}</h1>
          </div>
          <div className="page-actions" role="group" aria-label="Page actions" ref={setPageActions}>
            {state && !personalTitle && tab === 'overview' && (
              <>
                {state.canManageUsers && (
                  <button className="admin-primary" onClick={() => createRecord('person')}>
                    <Plus size={17} />
                    Add person
                  </button>
                )}
                <button className="secondary-button" onClick={() => createRecord('role')}>
                  Create template
                </button>
              </>
            )}
            {state && !personalTitle && tab === 'people' && state.canManageUsers && (
              <>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => createRecord('person')}
                >
                  <Plus size={16} />
                  New person
                </button>
              </>
            )}
            {state && !personalTitle && tab === 'roles' && (
              <>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => createRecord('role')}
                >
                  <Plus size={16} />
                  New template
                </button>
              </>
            )}
            {state && !personalTitle && tab === 'audit' && (
              <label className="list-search">
                <Search size={16} aria-hidden="true" />
                <input
                  aria-label="Search activity"
                  placeholder="Search activity…"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                />
              </label>
            )}
          </div>
          <NavbarAccount
            name={name}
            identity={
              state?.authentication === 'microsoft' ? 'Microsoft account' : 'Development session'
            }
            workspaceLink={{ href: '/workspace', label: 'Personal workspace' }}
          />
        </header>
        <main id="access-main" className="access-main">
          {error && (
            <div className="access-message" role="alert">
              {error}
              <button
                className="secondary-button"
                onClick={() => {
                  setError('');
                  load().catch(err => setError(err.message));
                }}
              >
                Reload current configuration
              </button>
            </div>
          )}
          {organizationLoading && <p role="status">Loading organization details…</p>}
          {organizationError && (
            <div className="access-message" role="alert">
              {organizationError}
              <button
                className="secondary-button"
                onClick={() => setOrganizationAttempt(value => value + 1)}
              >
                Retry organization details
              </button>
            </div>
          )}
          {notice && (
            <p className="access-message" role="status">
              {notice}
            </p>
          )}
          {!state && !error && (
            <div className="admin-loading" role="status">
              Loading your administration workspace…
            </div>
          )}
          {state && (
            <>
              {personalTitle && (
                <Workspace
                  embedded
                  actionsContainer={pageActions}
                  initialWorkspace={workspaceContext}
                />
              )}
              {!personalTitle && tab === 'overview' && (
                <>
                  <div className="admin-metrics">
                    {[
                      {
                        label: 'People',
                        value: state.people.length,
                        detail: state.people.filter(person => person.active).length + ' active',
                        icon: Users,
                        target: 'people',
                      },
                      {
                        label: 'Roles',
                        value: state.roles.length,
                        detail: 'Manage permissions',
                        icon: ShieldCheck,
                        target: 'roles',
                      },
                      {
                        label: 'Departments',
                        value: organization
                          ? organization.nodes.filter(
                              node => node.kind === 'DEPARTMENT' && node.active,
                            ).length
                          : '…',
                        detail: 'View organization',
                        icon: FolderTree,
                        target: 'organization',
                      },
                    ].map(({ label, value, detail, icon: Icon, target }) => (
                      <button
                        className="metric-card"
                        key={label}
                        onClick={() => setTab(target as typeof tab)}
                      >
                        <span className="metric-label">
                          {label}
                          <Icon size={19} aria-hidden="true" />
                        </span>
                        <strong>{value}</strong>
                        <span className="metric-detail">
                          {detail}
                          <ArrowUpRight size={16} aria-hidden="true" />
                        </span>
                      </button>
                    ))}
                  </div>
                  {state.canViewAudit && (
                    <section className="profile-panel overview-activity">
                      <div className="panel-title">
                        <h2>Recent activity</h2>
                        <button className="admin-text-button" onClick={() => setTab('audit')}>
                          View all <ArrowUpRight size={16} />
                        </button>
                      </div>
                      <AccessAudit
                        key={state.revision}
                        endpoint={endpoint}
                        recent
                        revision={state.revision}
                      />
                    </section>
                  )}
                </>
              )}

              {!personalTitle && tab === 'skills' && (
                <SkillCatalogue
                  actionsContainer={pageActions}
                  onChanged={() => {
                    load().catch(err => setError(err.message));
                  }}
                />
              )}
              {!personalTitle && tab === 'organization' && (
                <OrganizationSetup
                  actionsContainer={pageActions}
                  onChanged={() => {
                    load().catch(err => setError(err.message));
                  }}
                  onEditPerson={id => {
                    const selected = state.people.find(item => item.id === id);
                    if (selected) {
                      setPerson(structuredClone(selected));
                      setTab('people');
                      setEditor('person');
                      setEditorPage(1);
                      setRolePage(0);
                      setEditorRevision(state.revision);
                      setError('');
                    }
                  }}
                  onAssignDepartment={id => {
                    setDepartment(id);
                    setTab('assignments');
                  }}
                  roleNames={Object.fromEntries(
                    state.people.map(item => [
                      item.id,
                      state.roles
                        .filter(role => item.roleIds.includes(role.id))
                        .map(role => role.name),
                    ]),
                  )}
                />
              )}
              {!personalTitle && tab === 'roles' && (
                <>
                  <details className="profile-panel role-presets">
                    <summary>Start from a permission set</summary>
                    <div className="preset-buttons">
                      {state.presets.map(preset => (
                        <button
                          type="button"
                          className="secondary-button"
                          key={preset.key}
                          onClick={() => {
                            setRole(
                              structuredClone(
                                state.roles.find(item => item.name === preset.name) ?? {
                                  id: '',
                                  name: preset.name,
                                  permissions: preset.permissions,
                                },
                              ),
                            );
                            setEditor('role');
                            setEditorPage(0);
                            setEditorRevision(state.revision);
                            setError('');
                          }}
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                    {state.presets
                      .filter(preset => preset.name === role.name)
                      .map(preset => (
                        <div key={preset.key} className="preset-detail">
                          <p>{preset.description}</p>
                          {preset.pending.length > 0 && (
                            <p>
                              Pending organization setup:{' '}
                              {preset.pending
                                .map(
                                  item =>
                                    (state.catalogue.find(entry => entry.code === item.permission)
                                      ?.label ?? item.permission) +
                                    ' (' +
                                    item.scope.toLowerCase().replaceAll('_', ' ') +
                                    ')',
                                )
                                .join(', ')}
                              . These proposals do not grant access yet.
                            </p>
                          )}
                        </div>
                      ))}
                  </details>
                  <AccessDirectory
                    key="roles"
                    kind="roles"
                    people={state.people}
                    roles={state.roles}
                    busy={busy}
                    onPerson={() => {}}
                    onRole={id => {
                      const item = state.roles.find(role => role.id === id);
                      if (item) {
                        setRole(structuredClone(item));
                        setEditor('role');
                        setEditorPage(0);
                        setEditorRevision(state.revision);
                        setError('');
                      }
                    }}
                  />
                </>
              )}
              {!personalTitle && tab === 'people' && (
                <AccessDirectory
                  key="people"
                  kind="people"
                  people={state.people}
                  roles={state.roles}
                  busy={busy}
                  onRole={() => {}}
                  onPerson={id => {
                    const item = state.people.find(person => person.id === id);
                    if (item) {
                      setSelectedPerson(item.id);
                      setPersonSection('effective');
                      setError('');
                    }
                  }}
                />
              )}
              {!personalTitle &&
                tab === 'people' &&
                selectedPerson &&
                (() => {
                  const selected = state.people.find(item => item.id === selectedPerson);
                  if (!selected) return null;
                  const edge = organization?.assignments.find(
                    item => item.personId === selected.id,
                  );
                  const manager = state.people.find(item => item.id === edge?.managerId);
                  return (
                    <section className="profile-panel">
                      <div className="panel-title">
                        <div>
                          <h2>{selected.displayName}</h2>
                          <p>
                            {selected.employeeCode} · {selected.active ? 'Active' : 'Inactive'}
                          </p>
                        </div>
                        <div>
                          {state.canManageUsers && (
                            <button
                              className="secondary-button"
                              onClick={() => {
                                setPerson(structuredClone(selected));
                                setEditor('person');
                                setEditorPage(0);
                                setEditorRevision(state.revision);
                              }}
                            >
                              Edit person
                            </button>
                          )}
                          <button
                            className="secondary-button"
                            onClick={() => setSelectedPerson(undefined)}
                          >
                            Close person
                          </button>
                        </div>
                      </div>
                      <div className="access-person-tabs">
                        {['effective', 'organization', 'assignments', 'exceptions', 'history'].map(
                          section => (
                            <button
                              className="secondary-button"
                              key={section}
                              aria-pressed={personSection === section}
                              onClick={() => setPersonSection(section)}
                            >
                              {
                                (
                                  {
                                    effective: 'Effective access',
                                    organization: 'Organization',
                                    assignments: 'Assigned access',
                                    exceptions: 'Exceptions',
                                    history: 'History',
                                  } as Record<string, string>
                                )[section]
                              }
                            </button>
                          ),
                        )}
                      </div>
                      {personSection === 'effective' && (
                        <EffectiveAccess
                          key={state.revision}
                          endpoint={endpoint + '/effective/' + selected.id}
                          actorId={selected.id}
                        />
                      )}
                      {personSection === 'organization' && (
                        <>
                          <EmploymentSummary value={selected} />
                          <div className="access-person-context">
                            <div>
                              <small>Direct manager</small>
                              <strong>
                                {manager?.displayName ??
                                  (organization
                                    ? 'Not assigned'
                                    : 'Organization details unavailable')}
                              </strong>
                            </div>
                            <div>
                              <small>Department / team</small>
                              <strong>
                                {organization?.nodes.find(
                                  node => node.id === (edge?.teamId ?? edge?.departmentId),
                                )?.name ?? (organization ? 'Not assigned' : 'Unavailable')}
                              </strong>
                            </div>
                          </div>
                          {state.canManageUsers && (
                            <button
                              className="secondary-button"
                              onClick={() => setTab('organization')}
                            >
                              Manage reporting & membership
                            </button>
                          )}
                        </>
                      )}
                      {personSection === 'assignments' && (
                        <>
                          <p>
                            Templates grant only their supported actions and scopes.
                            Reporting-derived skill review is explained under Effective access.
                          </p>
                          <ul>
                            {selected.roleIds.map(id => (
                              <li key={id}>
                                {state.roles.find(role => role.id === id)?.name ?? id}
                              </li>
                            ))}
                          </ul>
                          {state.canManageUsers && (
                            <button
                              className="secondary-button"
                              onClick={() => {
                                setPerson(structuredClone(selected));
                                setEditor('person');
                                setEditorPage(1);
                                setEditorRevision(state.revision);
                              }}
                            >
                              Change assigned access
                            </button>
                          )}
                        </>
                      )}
                      {personSection === 'exceptions' && (
                        <>
                          <p>
                            Specific scoped Allow / Block with reason and expiry. Existing entries
                            without these details need review.
                          </p>
                          {selected.overrides.length ? (
                            <ul>
                              {selected.overrides.map(item => (
                                <li key={item.permission + item.scope}>
                                  {item.permission} · {item.effect} · {item.scope}
                                  <p>
                                    {item.reason ?? 'Legacy exception: reason missing'} ·{' '}
                                    {item.validUntil
                                      ? new Date(item.validUntil).toLocaleString()
                                      : 'Legacy exception: expiry missing'}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>No individual exceptions.</p>
                          )}
                          {state.canManageUsers && (
                            <button
                              className="secondary-button"
                              onClick={() => {
                                setPerson(structuredClone(selected));
                                setEditor('person');
                                setEditorPage(2);
                                setEditorRevision(state.revision);
                              }}
                            >
                              Manage exceptions
                            </button>
                          )}
                        </>
                      )}
                      {personSection === 'history' && (
                        <>
                          {!state.canViewAudit ? (
                            <p>Audit viewing is not assigned.</p>
                          ) : (
                            <AccessAudit
                              key={selected.id + state.revision}
                              endpoint={endpoint}
                              personId={selected.id}
                              revision={state.revision}
                            />
                          )}
                        </>
                      )}
                    </section>
                  );
                })()}
              {bulkReview && (
                <FormDialog
                  title="Review template assignments"
                  busy={busy}
                  onClose={() => setBulkReview(false)}
                  footer={
                    <>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => setBulkReview(false)}
                      >
                        Back to edit
                      </button>
                      <button
                        className="microsoft-button"
                        disabled={busy}
                        onClick={() => void saveAssignments()}
                      >
                        Confirm assignments
                      </button>
                    </>
                  }
                >
                  <p>
                    Each person is rechecked and saved separately. A failure may leave earlier
                    changes saved; the result will show how many succeeded.
                  </p>
                  {state.people
                    .filter(
                      item =>
                        assignmentDraft[item.id] &&
                        JSON.stringify([...item.roleIds].sort()) !==
                          JSON.stringify([...assignmentDraft[item.id]].sort()),
                    )
                    .map(item => (
                      <section key={item.id} className="access-review-change">
                        <h3>{item.displayName}</h3>
                        <p>
                          Before:{' '}
                          {item.roleIds
                            .map(id => state.roles.find(role => role.id === id)?.name ?? id)
                            .join(', ') || 'No templates'}
                        </p>
                        <p>
                          After:{' '}
                          {assignmentDraft[item.id]
                            .map(id => state.roles.find(role => role.id === id)?.name ?? id)
                            .join(', ') || 'No templates'}
                        </p>
                      </section>
                    ))}
                </FormDialog>
              )}
              {review && (
                <FormDialog
                  title="Review access change"
                  busy={busy}
                  onClose={() => setReview(undefined)}
                  footer={
                    <>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => setReview(undefined)}
                      >
                        Back to edit
                      </button>
                      <button
                        className="microsoft-button"
                        disabled={busy}
                        onClick={() => void confirmSave()}
                      >
                        {busy ? 'Rechecking and saving…' : 'Confirm & save'}
                      </button>
                    </>
                  }
                >
                  <p>
                    The server will recheck current permissions and revision before saving this
                    change and its audit.
                  </p>
                  <h3>{String(review.body.displayName ?? review.body.name)}</h3>
                  {review.body.kind === 'person' && (
                    <EmploymentChange before={review.before} after={review.after} />
                  )}
                  <details>
                    <summary>Review exact assignments and details</summary>
                    <pre>{JSON.stringify(review.body, null, 2)}</pre>
                  </details>
                  {review.impacts.length ? (
                    review.impacts.map(impact => (
                      <section key={impact.personId}>
                        <h3>{impact.displayName}</h3>
                        {impact.changes.length ? (
                          impact.changes.map(change => (
                            <p
                              className="access-review-change"
                              key={change.action + change.resolvedScope.kind}
                            >
                              {change.action} · {change.resolvedScope.kind} →{' '}
                              {change.allowed ? 'Allowed' : 'Blocked'} · {change.reasonCode}
                            </p>
                          ))
                        ) : (
                          <p>No effective decision changes.</p>
                        )}
                        {impact.unsupportedAssignments.length > 0 && (
                          <p>
                            {impact.unsupportedAssignments.length} unsupported assignments preserved
                            for review.
                          </p>
                        )}
                      </section>
                    ))
                  ) : (
                    <p>This template has no assigned people.</p>
                  )}
                </FormDialog>
              )}
              {editor === 'role' && (
                <FormDialog
                  title={role.id ? 'Edit access template' : 'Create access template'}
                  onClose={() => setEditor(undefined)}
                  busy={busy}
                  formId="role-editor"
                  onSubmit={() => void save('role')}
                  page={editorPage}
                  onPageChange={setEditorPage}
                  message={error && <p role="alert">{error}</p>}
                  footer={
                    <>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => setEditor(undefined)}
                      >
                        Cancel
                      </button>
                      <button
                        className="microsoft-button"
                        form="role-editor"
                        type="submit"
                        disabled={busy}
                      >
                        {busy ? 'Checking…' : 'Preview change'}
                      </button>
                    </>
                  }
                  pages={[
                    {
                      label: 'Details',
                      content: (
                        <label>
                          Template name
                          <input
                            required
                            maxLength={100}
                            value={role.name}
                            onChange={event => setRole({ ...role, name: event.target.value })}
                          />
                        </label>
                      ),
                    },
                    {
                      label: 'Permissions',
                      content: (
                        <PermissionEditor
                          label="Template permissions"
                          value={role.permissions}
                          onChange={permissions => setRole({ ...role, permissions })}
                          catalogue={state.catalogue}
                        />
                      ),
                    },
                  ]}
                />
              )}
              {editor === 'person' && state.canManageUsers && (
                <FormDialog
                  title={person.id ? 'Edit person' : 'Create person'}
                  onClose={() => setEditor(undefined)}
                  busy={busy}
                  formId="person-editor"
                  onSubmit={() => void save('person')}
                  page={editorPage}
                  onPageChange={setEditorPage}
                  message={error && <p role="alert">{error}</p>}
                  footer={
                    <>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => setEditor(undefined)}
                      >
                        Cancel
                      </button>
                      <button
                        className="microsoft-button"
                        form="person-editor"
                        type="submit"
                        disabled={busy}
                      >
                        {busy ? 'Checking…' : 'Preview change'}
                      </button>
                    </>
                  }
                  pages={[
                    {
                      label: 'Details',
                      content: (
                        <>
                          <div className="dialog-field-grid">
                            <label>
                              Display name
                              <input
                                required
                                maxLength={100}
                                value={person.displayName}
                                onChange={event =>
                                  setPerson({ ...person, displayName: event.target.value })
                                }
                              />
                            </label>
                            <label>
                              Person ID
                              <input
                                required
                                maxLength={40}
                                value={person.employeeCode}
                                onChange={event =>
                                  setPerson({ ...person, employeeCode: event.target.value })
                                }
                              />
                            </label>
                          </div>
                          <EmploymentFields
                            value={person}
                            onChange={details => setPerson({ ...person, ...details })}
                          />
                          <PrimaryCapabilityFields
                            key={person.id || 'new'}
                            endpoint={endpoint}
                            value={person}
                            disabled={busy}
                            onChange={details => setPerson({ ...person, ...details })}
                          />
                          <label className="access-check">
                            <input
                              type="checkbox"
                              checked={person.active}
                              onChange={event =>
                                setPerson({ ...person, active: event.target.checked })
                              }
                            />
                            Active account
                          </label>
                        </>
                      ),
                    },
                    {
                      label: 'Access templates',
                      content: (
                        <>
                          <table className="role-checkbox-table dialog-table">
                            <thead>
                              <tr>
                                <th>Assign</th>
                                <th>Role</th>
                                <th>Permissions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {state.roles.slice(rolePage * 5, rolePage * 5 + 5).map(item => (
                                <tr key={item.id}>
                                  <td>
                                    <input
                                      type="checkbox"
                                      aria-label={
                                        'Assign ' +
                                        item.name +
                                        ' to ' +
                                        (person.displayName || 'new person')
                                      }
                                      checked={person.roleIds.includes(item.id)}
                                      disabled={
                                        !person.roleIds.includes(item.id) &&
                                        item.permissions.some(
                                          grant =>
                                            !state.catalogue
                                              .find(action => action.code === grant.permission)
                                              ?.scopes?.includes(grant.scope),
                                        )
                                      }
                                      onChange={event =>
                                        setPerson({
                                          ...person,
                                          roleIds: event.target.checked
                                            ? [...person.roleIds, item.id]
                                            : person.roleIds.filter(id => id !== item.id),
                                        })
                                      }
                                    />
                                  </td>
                                  <td>{item.name}</td>
                                  <td>
                                    {item.permissions.length}
                                    {item.permissions.some(
                                      grant =>
                                        !state.catalogue
                                          .find(action => action.code === grant.permission)
                                          ?.scopes?.includes(grant.scope),
                                    ) && (
                                      <small>
                                        {' '}
                                        · Contains unsupported assignments; review before assigning
                                      </small>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="compact-pagination">
                            <span>
                              Roles {rolePage * 5 + 1}–
                              {Math.min(rolePage * 5 + 5, state.roles.length)} of{' '}
                              {state.roles.length}
                            </span>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={rolePage === 0}
                              onClick={() => setRolePage(value => value - 1)}
                            >
                              Previous
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={(rolePage + 1) * 5 >= state.roles.length}
                              onClick={() => setRolePage(value => value + 1)}
                            >
                              Next
                            </button>
                          </div>
                        </>
                      ),
                    },
                    {
                      label: 'Exceptions',
                      content: (
                        <>
                          <PermissionEditor
                            individual
                            label="Individual permission overrides"
                            value={person.overrides}
                            onChange={overrides => setPerson({ ...person, overrides })}
                            catalogue={state.catalogue}
                          />
                        </>
                      ),
                    },
                  ]}
                />
              )}
              {!personalTitle && tab === 'assignments' && (
                <RoleAssignments
                  people={state.people}
                  roles={state.roles}
                  departments={
                    organization?.nodes.filter(node => node.kind === 'DEPARTMENT' && node.active) ??
                    []
                  }
                  membership={Object.fromEntries(
                    (organization?.assignments ?? []).map(edge => [
                      edge.personId,
                      edge.departmentId ??
                        organization?.nodes.find(node => node.id === edge.teamId)?.parentId ??
                        undefined,
                    ]),
                  )}
                  department={department}
                  onDepartmentChange={setDepartment}
                  draft={assignmentDraft}
                  setDraft={setAssignmentDraft}
                  busy={busy}
                  canManage={state.canManageUsers}
                  onSave={() => setBulkReview(true)}
                  message={
                    error ? (
                      <p role="alert">{error}</p>
                    ) : notice ? (
                      <p role="status">{notice}</p>
                    ) : undefined
                  }
                  actionsContainer={pageActions}
                />
              )}
              {!personalTitle && tab === 'audit' && state.canViewAudit && (
                <section className="profile-panel">
                  <AccessAudit
                    key={search + state.revision}
                    endpoint={endpoint}
                    query={search}
                    revision={state.revision}
                  />
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
