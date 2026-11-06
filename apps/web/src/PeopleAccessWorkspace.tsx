import { useEffect, useRef, useState, Suspense, lazy } from 'react';
import { Link } from 'react-router';
import { Search, UserRound } from 'lucide-react';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';
import { FormDialog } from './FormDialog';
import { EmploymentFields, type Employment } from './EmploymentDetails';
import { PrimaryCapabilityFields } from './PrimaryCapabilityFields';
import { templateAssignable } from './person-access-model';
import {
  organizationKindLabel,
  organizationPathValid,
  type OrganizationKind,
} from './organization-labels';
import { EffectiveAccess } from './EffectiveAccess';
import { AccessAudit } from './AccessAudit';
import type { ScopedAccessTemplate } from './business/BusinessAdministration';
import './people-access-workspace.css';
const BusinessAdministration = lazy(() =>
  import('./business/BusinessAdministration').then(m => ({ default: m.BusinessAdministration })),
);
const PersonAccessDialog = lazy(() =>
  import('./PersonAccessDialog').then(m => ({ default: m.PersonAccessDialog })),
);
interface Grant {
  permission: string;
  scope: 'OWN' | 'ORGANIZATION';
  effect: 'ALLOW' | 'DENY';
  validUntil?: string;
  reason?: string;
}
interface Role {
  id: string;
  name: string;
  permissions: Grant[];
}
interface Person extends Employment {
  id: string;
  displayName: string;
  employeeCode: string;
  active: boolean;
  roleIds: string[];
  overrides: Grant[];
}
interface Item {
  id: string;
  name: string;
  employeeCode?: string;
  active?: boolean;
  permissions?: Grant[];
  parentId?: string | null;
  kind?: string;
}
interface Page {
  items: Item[];
  total: number;
  page: number;
  pageSize: number;
}
interface Node {
  id: string;
  kind: OrganizationKind;
  name: string;
  parentId: string | null;
  active: boolean;
}
interface Detail {
  revision: number;
  person: Person;
  roles: Role[];
  organization: {
    nodes: Node[];
    assignments: {
      personId: string;
      departmentId: string | null;
      teamId: string | null;
      managerId: string | null;
    }[];
    people: { id: string; displayName: string; active: boolean; employeeCode?: string }[];
  };
}
type Catalogue = {
  code: string;
  label: string;
  implemented?: boolean;
  scopes?: ('OWN' | 'ORGANIZATION')[];
}[];
async function json<T>(url: string, body?: object, signal?: AbortSignal): Promise<T> {
  return readApiResponse<T>(
    await authenticatedFetch(url, {
      ...(body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
      signal,
    }),
    'The current administration data could not be confirmed.',
  );
}
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0] ?? '')
    .join('')
    .toUpperCase();
}
function organizationPathName(nodes: Node[], id: string) {
  const path: Node[] = [];
  const seen = new Set<string>();
  let cursor: string | null = id;
  while (cursor && !seen.has(cursor) && path.length < 4) {
    seen.add(cursor);
    const node = nodes.find(item => item.id === cursor);
    if (!node) return '';
    path.unshift(node);
    cursor = node.parentId;
  }
  return cursor || path.length === 0 ? '' : path.map(node => node.name).join(' → ');
}
function useDirectory(
  endpoint: string,
  kind: string,
  search: string,
  page = 1,
  extra: Record<string, string> = {},
  enabled = true,
) {
  const [result, setResult] = useState<{ key: string; data: Page }>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [retry, setRetry] = useState(0);
  const params = new URLSearchParams({ kind, search, page: String(page), ...extra }).toString();
  useEffect(() => {
    const abort = new AbortController();
    setResult(undefined);
    setError('');
    setLoading(false);
    if (!enabled || (kind === 'people' && search.trim().length < 2)) return;
    setLoading(true);
    const timer = setTimeout(() => {
      void json<Page>(endpoint + '/directory?' + params, undefined, abort.signal)
        .then(v => {
          if (
            !Array.isArray(v.items) ||
            !Number.isSafeInteger(v.total) ||
            v.total < 0 ||
            !v.items.every(i => typeof i.id === 'string' && typeof i.name === 'string')
          )
            throw Error('Directory results could not be confirmed. Retry the search.');
          if (!abort.signal.aborted) setResult({ key: params, data: v });
        })
        .catch(e => {
          if (!abort.signal.aborted) {
            setResult(undefined);
            setError(e.message);
          }
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [endpoint, params, enabled, retry, kind, search]);
  return {
    data: result?.key === params ? result.data : undefined,
    error,
    loading,
    retry: () => setRetry(n => n + 1),
  };
}
function Pager({ data, page, onPage }: { data?: Page; page: number; onPage: (p: number) => void }) {
  return data && data.total > data.pageSize ? (
    <div className="people-search-paging">
      <button
        type="button"
        className="secondary-button"
        disabled={page === 1}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      <span>
        Page {page} of {Math.ceil(data.total / data.pageSize)}
      </span>
      <button
        type="button"
        className="secondary-button"
        disabled={page * data.pageSize >= data.total}
        onClick={() => onPage(page + 1)}
      >
        Next results
      </button>
    </div>
  ) : null;
}
export function PeopleAccessWorkspace({
  endpoint,
  initialPersonId,
  catalogue,
  canViewAudit = false,
  canManageScoped = false,
  onChanged,
}: {
  endpoint: string;
  initialPersonId?: string;
  catalogue: Catalogue;
  canViewAudit?: boolean;
  canManageScoped?: boolean;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(initialPersonId ?? ''),
    [detail, setDetail] = useState<Detail>(),
    [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [personTab, setPersonTab] = useState('profile');
  const selectedPane = useRef<HTMLDivElement>(null);
  const results = useDirectory(endpoint, 'people', search, page);
  const [review, setReview] = useState<{
      endpoint: string;
      body: object;
      receipt: string;
      label: string;
      warnings: string[];
      changes: { action: string; allowed: boolean }[];
      profileChanges: { label: string; before: string; after: string }[];
    }>(),
    [busy, setBusy] = useState(false),
    guard = useRef(false);
  useEffect(() => {
    setDetail(undefined);
    setError('');
    setReview(undefined);
    if (!selected) {
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    void json<Detail>(endpoint + '/people/' + selected, undefined, abort.signal)
      .then(v => {
        if (!abort.signal.aborted) {
          if (v.person.id !== selected) throw Error('Person identity changed. Search again.');
          if (
            !Array.isArray(v.person.roleIds) ||
            !Array.isArray(v.person.overrides) ||
            !Array.isArray(v.roles) ||
            !Array.isArray(v.organization?.nodes) ||
            !Array.isArray(v.organization?.assignments) ||
            !Array.isArray(v.organization?.people)
          )
            throw Error('Person details are unavailable. Reload the person.');
          setDetail(v);
        }
      })
      .catch(e => {
        if (!abort.signal.aborted) {
          setDetail(undefined);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [endpoint, selected, attempt]);
  async function preview(path: string, body: object, label: string, rejectOnError = false) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await json<{
        receipt: string;
        warnings?: string[];
        impacts?: { changes: { action: string; allowed: boolean }[] }[];
        before?: Record<string, unknown>;
        after?: Record<string, unknown>;
      }>(path + '/preview', body);
      if (typeof value.receipt !== 'string' || !value.receipt)
        throw Error('The preview could not be confirmed.');
      const text = (v: unknown) =>
        typeof v === 'boolean'
          ? v
            ? 'Active'
            : 'Inactive'
          : typeof v === 'string'
            ? v
            : v == null
              ? 'Not assigned'
              : 'Unavailable';
      const fields = {
        displayName: 'Full name',
        employeeCode: 'Employee ID',
        jobTitle: 'Business job title',
        grade: 'Grade',
        primaryCapabilityName: 'Primary capability',
        active: 'Status',
      };
      setReview({
        endpoint: path,
        body,
        receipt: value.receipt,
        label,
        warnings: value.warnings?.filter(w => typeof w === 'string') ?? [],
        changes: value.impacts?.flatMap(i => i.changes) ?? [],
        profileChanges:
          value.after && value.before
            ? Object.entries(fields)
                .filter(([key]) => value.before?.[key] !== value.after?.[key])
                .map(([key, label]) => ({
                  label,
                  before: text(value.before?.[key]),
                  after: text(value.after?.[key]),
                }))
            : [],
      });
    } catch (e) {
      setError((e as Error).message);
      if (rejectOnError) throw e;
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  async function personPreview(person: Person, label: string, rejectOnError = false) {
    if (!detail) return;
    await preview(
      endpoint,
      {
        kind: 'person',
        revision: detail.revision,
        id: person.id,
        displayName: person.displayName,
        employeeCode: person.employeeCode,
        active: person.active,
        jobTitle: person.jobTitle ?? null,
        grade: person.grade ?? null,
        primaryCapabilityId: person.primaryCapabilityId ?? null,
        roleIds: person.roleIds,
        overrides: person.overrides,
      },
      label,
      rejectOnError,
    );
  }
  async function confirm() {
    if (!review || guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await json<{ saved: boolean }>(review.endpoint, {
        ...review.body,
        previewReceipt: review.receipt,
      });
      if (value.saved !== true)
        throw Error('Save was not confirmed. Reload the person before trying again.');
      setReview(undefined);
      setAttempt(n => n + 1);
      setNotice('Saved and audited. Current access has been refreshed.');
      onChanged();
    } catch (e) {
      setReview(undefined);
      setError((e as Error).message + ' Reload the person before trying again.');
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="people-access-workspace" aria-label="Find and manage a person">
      <header className="people-access-intro">
        <h2>Find and manage people</h2>
        <p>
          Search by name or employee ID. Only matching people and the selected profile are loaded.
        </p>
      </header>
      {notice && (
        <p role="status" className="people-access-success">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="people-access-error">
          {error}{' '}
          {selected && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setAttempt(n => n + 1)}
            >
              Reload person
            </button>
          )}
        </p>
      )}
      <div className="people-access-layout">
        <aside className="people-access-directory" aria-label="Matching people">
          <div className="people-directory-heading">
            <div>
              <h3>People directory</h3>
              <p>Search by name or employee ID</p>
            </div>
            {results.data && search.trim().length >= 2 && (
              <span className="people-directory-count">{results.data.total}</span>
            )}
          </div>
          <label className="people-access-search">
            <span>Find person</span>
            <span className="people-search-input">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                aria-label="Find person"
                placeholder="Enter at least 2 characters"
                maxLength={100}
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </span>
          </label>
          <div className="people-directory-results">
            {search.trim().length < 2 ? (
              <p className="people-directory-hint">
                Start with a name or employee ID. The full directory is not loaded.
              </p>
            ) : results.error ? (
              <div role="alert" className="people-directory-state">
                {results.error}
                <button type="button" className="secondary-button" onClick={results.retry}>
                  Retry search
                </button>
              </div>
            ) : !results.data || results.loading ? (
              <p role="status" className="people-directory-state">
                Searching people…
              </p>
            ) : (
              <>
                <p className="people-directory-result-label">
                  {results.data.total === 1
                    ? '1 matching person'
                    : `${results.data.total} matching people`}
                </p>
                <ul className="people-search-results">
                  {results.data?.items.map(p => (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={busy}
                        className={selected === p.id ? 'selected' : ''}
                        aria-pressed={selected === p.id}
                        onClick={() => {
                          setSelected(p.id);
                          setPersonTab('profile');
                          setNotice('');
                          setError('');
                          selectedPane.current?.focus();
                        }}
                      >
                        <span className="people-directory-person">
                          <strong>{p.name}</strong>
                          <span className="people-directory-person-meta">
                            <span>{p.employeeCode}</span>
                            <span
                              className={p.active ? 'people-state-active' : 'people-state-inactive'}
                            >
                              {p.active ? 'Active' : 'Inactive'}
                            </span>
                          </span>
                        </span>
                        <span className="people-directory-avatar" aria-hidden="true">
                          {initials(p.name)}
                        </span>
                        <span className="people-directory-open">
                          Manage person <span aria-hidden="true">→</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {!results.data?.items.length && (
                  <p className="people-directory-hint">No people match this search.</p>
                )}
                <Pager data={results.data} page={page} onPage={setPage} />
              </>
            )}
          </div>
        </aside>
        <div
          ref={selectedPane}
          className="people-access-selected"
          role="region"
          aria-label="Selected person"
          aria-busy={loading}
          tabIndex={-1}
        >
          {loading ? (
            <p role="status" className="people-selection-state">
              Opening selected person…
            </p>
          ) : detail?.person.id === selected ? (
            <PersonEditor
              key={detail.person.id + ':' + detail.revision}
              detail={detail}
              tab={personTab}
              onTab={setPersonTab}
              endpoint={endpoint}
              catalogue={catalogue}
              busy={busy}
              reviewOpen={Boolean(review)}
              canViewAudit={canViewAudit}
              canManageScoped={canManageScoped}
              onPreview={personPreview}
              onOrganizationPreview={(body, label) =>
                preview(endpoint + '/organization', body, label)
              }
              onChanged={() => {
                setAttempt(n => n + 1);
                onChanged();
              }}
            />
          ) : (
            !error && (
              <div className="people-selection-empty">
                <span className="people-selection-icon" aria-hidden="true">
                  <UserRound size={23} />
                </span>
                <h3>Select a person</h3>
                <p>Search for someone to review their profile, organization and access.</p>
              </div>
            )
          )}
        </div>
      </div>
      {review && (
        <FormDialog
          title="Review person change"
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
              <button className="microsoft-button" disabled={busy} onClick={() => void confirm()}>
                Confirm & save
              </button>
            </>
          }
        >
          <p>{review.label}</p>
          {review.profileChanges.length > 0 && (
            <dl>
              {review.profileChanges.map(c => (
                <div key={c.label}>
                  <dt>{c.label}</dt>
                  <dd>
                    {c.before} → {c.after}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {review.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
          {review.changes.length > 0 && (
            <ul>
              {review.changes.map((c, i) => (
                <li key={i}>
                  {c.action}: {c.allowed ? 'Allowed' : 'Unavailable or blocked'}
                </li>
              ))}
            </ul>
          )}
          <p>Current permissions and revision are checked again before saving.</p>
        </FormDialog>
      )}
    </section>
  );
}
function PersonEditor({
  detail,
  endpoint,
  catalogue,
  busy,
  reviewOpen,
  canViewAudit,
  canManageScoped,
  onPreview,
  onOrganizationPreview,
  onChanged,
  tab,
  onTab,
}: {
  detail: Detail;
  endpoint: string;
  catalogue: Catalogue;
  busy: boolean;
  reviewOpen?: boolean;
  canViewAudit: boolean;
  canManageScoped: boolean;
  onPreview: (p: Person, label: string, rejectOnError?: boolean) => Promise<void>;
  onOrganizationPreview: (body: object, label: string) => Promise<void>;
  onChanged: () => void;
  tab: string;
  onTab: (tab: string) => void;
}) {
  const [person, setPerson] = useState(detail.person),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1),
    [template, setTemplate] = useState('');
  const [exceptions, setExceptions] = useState(false);
  const [scopedTemplate, setScopedTemplate] = useState<ScopedAccessTemplate>();
  function openScopedTemplate(value: ScopedAccessTemplate) {
    setScopedTemplate(value);
    onTab('scoped');
  }
  const options = useDirectory(endpoint, 'templates', query, page, {}, tab === 'templates');
  const unassignedTemplates = options.data?.items.filter(
    role => !detail.person.roleIds.includes(role.id),
  );
  const tabs = [
    ['profile', 'Profile'],
    ['organization', 'Organization & manager'],
    ['templates', 'Templates'],
    ...(canManageScoped ? [['scoped', 'Scoped access']] : []),
    ['effective', 'Effective access'],
    ...(canViewAudit ? [['activity', 'History']] : []),
  ];
  const { assignments, nodes, people } = detail.organization;
  const assignment = assignments[0];
  const invalidAssignment =
    assignments.length > 1 || (assignment && assignment.personId !== detail.person.id);
  const placementId = assignment?.teamId ?? assignment?.departmentId;
  const validPlacement =
    placementId &&
    !(assignment.teamId && assignment.departmentId) &&
    nodes.some(
      node => node.id === placementId && node.kind === (assignment.teamId ? 'TEAM' : 'DEPARTMENT'),
    ) &&
    organizationPathValid(nodes, placementId);
  const placement =
    invalidAssignment || (placementId && !validPlacement)
      ? 'Needs administrator attention'
      : placementId
        ? organizationPathName(nodes, placementId)
        : 'Not assigned';
  const managers = assignment?.managerId
    ? people.filter(person => person.id === assignment.managerId)
    : [];
  const manager =
    managers.length === 1 && managers[0].active && managers[0].id !== detail.person.id
      ? managers[0]
      : undefined;
  const managerLabel = invalidAssignment
    ? 'Needs administrator attention'
    : manager
      ? `${manager.displayName}${manager.employeeCode ? ` · ${manager.employeeCode}` : ''}`
      : assignment?.managerId
        ? 'Needs administrator attention'
        : 'Not assigned';
  return (
    <>
      <header className="people-person-heading">
        <div className="people-person-identity">
          <span className="people-person-avatar" aria-hidden="true">
            {initials(detail.person.displayName)}
          </span>
          <div className="people-person-title">
            <div className="people-person-title-line">
              <h2>{detail.person.displayName}</h2>
              <span
                className={
                  detail.person.active
                    ? 'people-person-status people-state-active'
                    : 'people-person-status people-state-inactive'
                }
              >
                {detail.person.active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p className="people-person-meta">
              <span>{detail.person.employeeCode}</span>
              {detail.person.jobTitle && <span>{detail.person.jobTitle}</span>}
              {detail.person.grade && <span>{detail.person.grade}</span>}
            </p>
          </div>
        </div>
        <div className="people-person-context">
          <div>
            <span>Organization path</span>
            <strong title={placement}>{placement}</strong>
          </div>
          <div>
            <span>Direct manager</span>
            <strong title={managerLabel}>{managerLabel}</strong>
          </div>
        </div>
      </header>
      <nav className="people-person-tabs" aria-label="Selected person sections">
        {tabs.map(([id, label]) => (
          <button
            className="secondary-button"
            key={id}
            aria-current={tab === id ? 'page' : undefined}
            disabled={busy}
            onClick={() => {
              setScopedTemplate(undefined);
              onTab(id);
            }}
          >
            {label}
            {id === 'templates' ? ` (${detail.person.roleIds.length})` : ''}
          </button>
        ))}
      </nav>
      {tab === 'profile' && (
        <form
          className="people-person-form"
          onSubmit={e => {
            e.preventDefault();
            void onPreview(person, 'Update profile for ' + detail.person.displayName);
          }}
        >
          <fieldset disabled={busy}>
            <div className="people-panel-heading">
              <h3>Profile details</h3>
              <p>Personal and employment information for this workspace account.</p>
            </div>
            <label>
              Full name
              <input
                value={person.displayName}
                required
                maxLength={100}
                onChange={e => setPerson({ ...person, displayName: e.target.value })}
              />
            </label>
            <label>
              Employee ID
              <input
                value={person.employeeCode}
                required
                maxLength={40}
                onChange={e => setPerson({ ...person, employeeCode: e.target.value })}
              />
            </label>
            <EmploymentFields value={person} onChange={v => setPerson({ ...person, ...v })} />
            <PrimaryCapabilityFields
              endpoint={endpoint}
              value={person}
              onChange={v => setPerson({ ...person, ...v })}
            />
            <label className="people-checkbox">
              <input
                type="checkbox"
                checked={person.active}
                onChange={e => setPerson({ ...person, active: e.target.checked })}
              />{' '}
              Active employee
            </label>
            <button
              className="microsoft-button"
              type="submit"
              disabled={JSON.stringify(person) === JSON.stringify(detail.person)}
            >
              Review profile changes
            </button>
          </fieldset>
        </form>
      )}
      {tab === 'organization' && (
        <PersonOrganization
          detail={detail}
          endpoint={endpoint}
          busy={busy}
          onPreview={onOrganizationPreview}
        />
      )}
      {tab === 'templates' && (
        <section aria-label="Assign and remove templates">
          {canManageScoped && (
            <>
              <h3>Built-in access templates</h3>
              <p>Choose a template to review its scope and create an assignment.</p>
              <div className="people-template-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || !detail.person.active}
                  onClick={() => openScopedTemplate('BUSINESS_OPERATIONS')}
                >
                  Assign Business Analytics
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || !detail.person.active}
                  onClick={() => openScopedTemplate('SYSTEM_ADMIN')}
                >
                  Assign Admin
                </button>
              </div>
            </>
          )}
          <h3>Assigned custom templates</h3>
          {detail.roles.length === 0 ? (
            <p>No additional templates assigned.</p>
          ) : (
            <ul className="people-assigned-templates">
              {detail.roles.map(r => (
                <li key={r.id}>
                  <strong>{r.name}</strong>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void onPreview(
                        {
                          ...detail.person,
                          roleIds: detail.person.roleIds.filter(id => id !== r.id),
                        },
                        'Remove ' + r.name + ' from ' + detail.person.displayName,
                      )
                    }
                  >
                    Remove template {r.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p>
            Employee baseline and direct-manager review access are separate from additional
            templates. Unsupported historical templates are retained until explicitly reviewed.
          </p>
          <label>
            Find template
            <input
              type="search"
              value={query}
              maxLength={100}
              onChange={e => {
                setQuery(e.target.value);
                setPage(1);
                setTemplate('');
              }}
            />
          </label>
          {options.error ? (
            <p role="alert">
              {options.error}
              <button onClick={options.retry}>Retry templates</button>
            </p>
          ) : options.loading || !options.data ? (
            <p role="status">Finding templates…</p>
          ) : options.data.total === 0 ? (
            query.trim() ? (
              <p role="status">No templates match your search.</p>
            ) : (
              <p role="status">
                No additional templates are defined for this workspace.{' '}
                <Link to="/access?view=roles">Manage template definitions</Link>
              </p>
            )
          ) : !unassignedTemplates?.length ? (
            <p role="status">No unassigned templates on this page.</p>
          ) : (
            <>
              <label>
                Template to assign
                <select value={template} onChange={e => setTemplate(e.target.value)}>
                  <option value="">Choose a template</option>
                  {unassignedTemplates.map(r => (
                    <option
                      key={r.id}
                      value={r.id}
                      disabled={!templateAssignable(r.permissions ?? [], catalogue)}
                    >
                      {r.name}
                      {!templateAssignable(r.permissions ?? [], catalogue)
                        ? ' · Unavailable for assignment'
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="microsoft-button"
                disabled={
                  busy ||
                  !unassignedTemplates.some(
                    r => r.id === template && templateAssignable(r.permissions ?? [], catalogue),
                  )
                }
                onClick={() =>
                  void onPreview(
                    { ...detail.person, roleIds: [...detail.person.roleIds, template] },
                    'Assign ' +
                      unassignedTemplates.find(r => r.id === template)?.name +
                      ' to ' +
                      detail.person.displayName,
                  )
                }
              >
                Review template assignment
              </button>
            </>
          )}
          <Pager
            data={options.data}
            page={page}
            onPage={p => {
              setPage(p);
              setTemplate('');
            }}
          />
        </section>
      )}
      {tab === 'scoped' && canManageScoped && (
        <Suspense fallback={<p>Opening scoped access…</p>}>
          <BusinessAdministration
            key={scopedTemplate ?? 'scoped'}
            selectedPersonId={detail.person.id}
            initialTemplate={scopedTemplate}
            onSaved={onChanged}
          />
        </Suspense>
      )}
      {tab === 'effective' && (
        <EffectiveAccess
          endpoint={endpoint + '/effective/' + detail.person.id}
          actorId={detail.person.id}
        />
      )}
      {tab === 'activity' && canViewAudit && (
        <AccessAudit endpoint={endpoint} personId={detail.person.id} revision={detail.revision} />
      )}
      <details>
        <summary>Advanced</summary>
        <p>Use exceptions only when a supported template or scoped responsibility is not enough.</p>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => setExceptions(true)}
        >
          Permission exceptions
        </button>
      </details>
      {exceptions && (
        <Suspense fallback={<p>Opening permission exceptions…</p>}>
          <PersonAccessDialog
            person={detail.person}
            roles={detail.roles}
            catalogue={catalogue}
            organization={detail.organization}
            people={[
              detail.person,
              ...detail.organization.people.map(p => ({
                ...p,
                employeeCode: p.employeeCode ?? '',
                roleIds: [],
                overrides: [],
              })),
            ]}
            canManageUsers
            endpoint={endpoint}
            revision={detail.revision}
            busy={busy}
            exceptionsOnly
            open={!reviewOpen}
            onClose={() => setExceptions(false)}
            onApplyChange={p =>
              onPreview(p, 'Update permission exceptions for ' + detail.person.displayName, true)
            }
            onFullEdit={() => {
              onTab('profile');
              setExceptions(false);
            }}
            onReload={async () => {
              setExceptions(false);
              onChanged();
            }}
          />
        </Suspense>
      )}
    </>
  );
}
function NodePicker({
  endpoint,
  kind,
  parentId,
  value,
  selectedName,
  busy,
  onChange,
}: {
  endpoint: string;
  kind: OrganizationKind;
  parentId?: string;
  value: string;
  selectedName?: string;
  busy: boolean;
  onChange: (id: string, name: string) => void;
}) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1);
  const options = useDirectory(
    endpoint,
    'nodes',
    search,
    page,
    { nodeKind: kind, ...(parentId ? { parentId } : {}) },
    kind === 'DELIVERY_UNIT' || Boolean(parentId),
  );
  const items = options.data?.items ?? [];
  const label = kind === 'DELIVERY_UNIT' ? 'Delivery Unit' : organizationKindLabel(kind);
  return (
    <div className="people-node-picker">
      <label>
        {label}
        <select
          disabled={busy || (kind !== 'DELIVERY_UNIT' && !parentId) || options.loading}
          value={value}
          onChange={e =>
            onChange(
              e.target.value,
              e.target.value
                ? (items.find(n => n.id === e.target.value)?.name ?? selectedName ?? '')
                : '',
            )
          }
        >
          <option value="">
            {kind === 'TEAM' ? 'No organizational project' : 'Choose ' + label}
          </option>
          {value && selectedName && !items.some(n => n.id === value) && (
            <option value={value}>{selectedName}</option>
          )}
          {items.map(n => (
            <option value={n.id} key={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Find {label.toLowerCase()}
        <input
          aria-label={'Find ' + label}
          disabled={busy || (kind !== 'DELIVERY_UNIT' && !parentId)}
          maxLength={100}
          value={search}
          onChange={e => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      {options.error && (
        <p role="alert">
          {options.error}
          <button type="button" onClick={options.retry}>
            Retry options
          </button>
        </p>
      )}
      <Pager data={options.data} page={page} onPage={setPage} />
    </div>
  );
}
function PersonOrganization({
  detail,
  endpoint,
  busy,
  onPreview,
}: {
  detail: Detail;
  endpoint: string;
  busy: boolean;
  onPreview: (body: object, label: string) => Promise<void>;
}) {
  const assignment = detail.organization.assignments[0],
    nodes = detail.organization.nodes;
  const valid =
    Boolean(assignment) &&
    !(assignment.departmentId && assignment.teamId) &&
    organizationPathValid(nodes, assignment.teamId ?? assignment.departmentId ?? '');
  const [unit, setUnit] = useState(
      valid ? (nodes.find(n => n.kind === 'DELIVERY_UNIT')?.id ?? '') : '',
    ),
    [portfolio, setPortfolio] = useState(
      valid ? (nodes.find(n => n.kind === 'PORTFOLIO')?.id ?? '') : '',
    ),
    [client, setClient] = useState(
      valid ? (nodes.find(n => n.kind === 'DEPARTMENT')?.id ?? '') : '',
    ),
    [team, setTeam] = useState(valid ? (nodes.find(n => n.kind === 'TEAM')?.id ?? '') : '');
  const [changed, setChanged] = useState(false),
    [manager, setManager] = useState(assignment?.managerId ?? ''),
    [managerQuery, setManagerQuery] = useState(''),
    [managerPage, setManagerPage] = useState(1),
    [chosenName, setChosenName] = useState(
      detail.organization.people.find(
        p => p.id === assignment?.managerId && p.active && p.id !== detail.person.id,
      )?.displayName ?? '',
    ),
    [error, setError] = useState('');
  const [names, setNames] = useState<Record<string, string>>(
    Object.fromEntries(nodes.map(n => [n.kind, n.name])),
  );
  const nextTeamId = changed ? team || null : (assignment?.teamId ?? null);
  const nextDepartmentId = changed
    ? team
      ? null
      : client || null
    : (assignment?.departmentId ?? null);
  const nextManagerId = manager || null;
  const unchanged =
    nextTeamId === (assignment?.teamId ?? null) &&
    nextDepartmentId === (assignment?.departmentId ?? null) &&
    nextManagerId === (assignment?.managerId ?? null);
  const matches = useDirectory(endpoint, 'people', managerQuery, managerPage);
  return (
    <form
      className="people-person-form"
      onSubmit={e => {
        e.preventDefault();
        setError('');
        if (changed && unit && !client) {
          setError(
            'Choose an account/client in the selected Portfolio/Division, or clear the organization assignment.',
          );
          return;
        }
        if (unchanged) {
          setError('Change the organization placement or reporting manager before previewing.');
          return;
        }
        void onPreview(
          {
            kind: 'assignment',
            revision: detail.revision,
            personId: detail.person.id,
            teamId: nextTeamId,
            departmentId: nextDepartmentId,
            managerId: nextManagerId,
          },
          'Update ' +
            detail.person.displayName +
            '. Placement: ' +
            (!changed
              ? valid
                ? ['DELIVERY_UNIT', 'PORTFOLIO', 'DEPARTMENT', 'TEAM']
                    .map(k => names[k])
                    .filter(Boolean)
                    .join(' → ')
                : 'No valid placement'
              : [
                  unit && names.DELIVERY_UNIT,
                  portfolio && names.PORTFOLIO,
                  client && names.DEPARTMENT,
                  team && names.TEAM,
                ]
                  .filter(Boolean)
                  .join(' → ') || 'No organization assignment') +
            '. Manager: ' +
            (manager ? chosenName || 'Current manager' : 'No manager') +
            '.',
        );
      }}
    >
      <fieldset disabled={busy}>
        <p>
          Assign a complete hierarchy, or remove the placement. A reporting manager is a separate
          relationship and never grants authority by title.
        </p>
        {!valid && (assignment?.teamId || assignment?.departmentId) && (
          <p role="alert">
            Current placement needs administrator attention. Choose a complete path or explicitly
            clear it.
          </p>
        )}
        <div className="people-organization-grid">
          <NodePicker
            endpoint={endpoint}
            kind="DELIVERY_UNIT"
            value={unit}
            selectedName={names.DELIVERY_UNIT}
            busy={busy}
            onChange={(v, name) => {
              setNames(n => ({ ...n, DELIVERY_UNIT: name }));
              setUnit(v);
              setPortfolio('');
              setClient('');
              setTeam('');
              setChanged(true);
            }}
          />
          <NodePicker
            key={'portfolio:' + unit}
            endpoint={endpoint}
            kind="PORTFOLIO"
            parentId={unit}
            value={portfolio}
            selectedName={names.PORTFOLIO}
            busy={busy}
            onChange={(v, name) => {
              setNames(n => ({ ...n, PORTFOLIO: name }));
              setPortfolio(v);
              setClient('');
              setTeam('');
              setChanged(true);
            }}
          />
          <NodePicker
            key={'client:' + portfolio}
            endpoint={endpoint}
            kind="DEPARTMENT"
            parentId={portfolio}
            value={client}
            selectedName={names.DEPARTMENT}
            busy={busy}
            onChange={(v, name) => {
              setNames(n => ({ ...n, DEPARTMENT: name }));
              setClient(v);
              setTeam('');
              setChanged(true);
            }}
          />
          <NodePicker
            key={'team:' + client}
            endpoint={endpoint}
            kind="TEAM"
            parentId={client}
            value={team}
            selectedName={names.TEAM}
            busy={busy}
            onChange={(v, name) => {
              setNames(n => ({ ...n, TEAM: name }));
              setTeam(v);
              setChanged(true);
            }}
          />
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setUnit('');
            setPortfolio('');
            setClient('');
            setTeam('');
            setChanged(true);
          }}
        >
          Clear organization assignment
        </button>
        <h3>Direct reporting manager</h3>
        <p>
          {manager
            ? chosenName || 'Current manager needs administrator attention'
            : 'No manager assigned'}
        </p>
        <button
          type="button"
          className="secondary-button"
          disabled={!manager}
          onClick={() => {
            setManager('');
            setChosenName('');
          }}
        >
          Remove manager
        </button>
        <label>
          Find manager
          <input
            type="search"
            value={managerQuery}
            maxLength={100}
            placeholder="Name or employee ID (at least 2 characters)"
            onChange={e => {
              setManagerQuery(e.target.value);
              setManagerPage(1);
            }}
          />
        </label>
        {matches.loading && <p role="status">Finding managers…</p>}
        {matches.error && (
          <p role="alert">
            {matches.error}
            <button type="button" onClick={matches.retry}>
              Retry manager search
            </button>
          </p>
        )}
        <ul className="people-manager-results">
          {matches.data?.items
            .filter(p => p.id !== detail.person.id && p.active)
            .map(p => (
              <li key={p.id}>
                <button
                  type="button"
                  className="secondary-button"
                  aria-pressed={manager === p.id}
                  onClick={() => {
                    setManager(p.id);
                    setChosenName(p.name);
                  }}
                >
                  {p.name} · {p.employeeCode}
                </button>
              </li>
            ))}
        </ul>
        <Pager data={matches.data} page={managerPage} onPage={setManagerPage} />
        {error && <p role="alert">{error}</p>}
        <button className="microsoft-button" type="submit">
          Review organization changes
        </button>
      </fieldset>
    </form>
  );
}
