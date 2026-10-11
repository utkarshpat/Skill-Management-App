import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { FormDialog } from '../FormDialog';
import { Link } from 'react-router';
import type { BusinessContext } from './business-model';
interface Administration {
  revision: number;
  personalBaseline: boolean;
  baselineAffectedPeople: number;
  projects: { id: string; name: string; departmentId: string | null; active: boolean }[];
  memberships: { personId: string; projectId: string; active: boolean }[];
  responsibilities: {
    id: string;
    personId: string;
    bundle: string;
    kind: string;
    scopeId: string | null;
    effect: string;
    active: boolean;
    validUntil: string | null;
    reason: string;
  }[];
  people: {
    id: string;
    name: string;
    employeeCode: string;
    active: boolean;
    employeeAccess?: boolean;
    hasDirectReports?: boolean;
    managerAccess?: boolean;
    analyticsAccess?: boolean;
    adminAccess?: boolean;
  }[];
  nodes: { id: string; name: string; kind: string; active: boolean }[];
  historicalGrantsForReview: unknown[];
}
export function BusinessAdministration({ onSaved }: { onSaved: (value: BusinessContext) => void }) {
  const [state, setState] = useState<Administration>(),
    [error, setError] = useState(''),
    [loadError, setLoadError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [kind, setKind] = useState('RESPONSIBILITY'),
    [search, setSearch] = useState(''),
    [id, setId] = useState(''),
    [person, setPerson] = useState(''),
    [project, setProject] = useState(''),
    [name, setName] = useState(''),
    [department, setDepartment] = useState(''),
    [bundle, setBundle] = useState('BUSINESS_OPERATIONS'),
    [scopeKind, setScopeKind] = useState('DEPARTMENT'),
    [scope, setScope] = useState(''),
    [effect, setEffect] = useState('ALLOW'),
    [active, setActive] = useState(true),
    [until, setUntil] = useState(''),
    [reason, setReason] = useState(''),
    [enabled, setEnabled] = useState(true),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<{
      receipt: string;
      change: Record<string, unknown>;
      before: unknown;
      after: unknown;
      impact: unknown;
      warnings: string[];
    }>(),
    guard = useRef(false),
    previewRequest = useRef<AbortController | undefined>(undefined),
    baselineInitialized = useRef(false);
  const invalidatePreview = () => {
    previewRequest.current?.abort();
    setPreview(undefined);
  };
  useEffect(() => () => previewRequest.current?.abort(), []);
  useEffect(() => {
    const abort = new AbortController();
    setLoadError('');
    authenticatedFetch('/api/business/administration', { signal: abort.signal })
      .then(r =>
        readApiResponse<Administration>(r, 'Project and access configuration is unavailable.'),
      )
      .then(v => {
        if (!abort.signal.aborted) {
          setState(v);
          if (!baselineInitialized.current) {
            setEnabled(v.personalBaseline);
            baselineInitialized.current = true;
          }
        }
      })
      .catch(e => {
        if (!abort.signal.aborted) {
          setState(undefined);
          invalidatePreview();
          setLoadError(e.message);
        }
      });
    return () => abort.abort();
  }, [attempt]);
  const changeKind = (value: string) => {
    invalidatePreview();
    setKind(value);
    setId('');
    setPreview(undefined);
    setReason('');
    setActive(true);
    setName('');
    setScope('');
  };
  const editResponsibility = (r: Administration['responsibilities'][number]) => {
    invalidatePreview();
    setId(r.id);
    setPerson(r.personId);
    setBundle(r.bundle);
    setScopeKind(r.kind);
    setScope(r.scopeId ?? '');
    setEffect(r.effect);
    setActive(r.active);
    setReason('');
    setUntil(
      r.validUntil
        ? new Date(
            new Date(r.validUntil).getTime() - new Date(r.validUntil).getTimezoneOffset() * 60000,
          )
            .toISOString()
            .slice(0, 16)
        : '',
    );
    setPreview(undefined);
    document
      .getElementById('bo-access-assignment-form')
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const selectPerson = (value: string) => {
    invalidatePreview();
    setPerson(value);
    setId('');
    setPreview(undefined);
    setReason('');
    setEffect('ALLOW');
    setActive(true);
    setUntil('');
    setScope('');
    setBundle('BUSINESS_OPERATIONS');
    setScopeKind('DEPARTMENT');
  };
  const payload = () =>
    kind === 'PROJECT'
      ? { name, departmentId: department || null, active, reason }
      : kind === 'MEMBERSHIP'
        ? { personId: person, projectId: project, active, reason }
        : kind === 'RESPONSIBILITY'
          ? {
              personId: person,
              bundle,
              kind: scopeKind,
              scopeId: scopeKind === 'ORGANIZATION' ? null : scope,
              effect,
              active,
              validUntil: until ? new Date(until).toISOString() : null,
              reason,
            }
          : { enabled, reason };
  async function prepare() {
    if (guard.current || !state) return;
    guard.current = true;
    setBusy(true);
    setError('');
    const abort = new AbortController();
    previewRequest.current = abort;
    try {
      const change = {
        revision: state.revision,
        kind,
        id: id || crypto.randomUUID(),
        payload: payload(),
      };
      const prepared = await readApiResponse<NonNullable<typeof preview>>(
        await authenticatedFetch('/api/business/administration/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(change),
          signal: abort.signal,
        }),
        'Preview could not be prepared.',
      );
      if (!abort.signal.aborted) setPreview(prepared);
    } catch (e) {
      if (!abort.signal.aborted) {
        setError((e as Error).message);
        const status = (e as { status?: number }).status;
        if (status === 409) setAttempt(n => n + 1);
        if (status === 401 || status === 403) setState(undefined);
      }
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  async function save() {
    if (guard.current || !preview) return;
    guard.current = true;
    setBusy(true);
    setError('');
    try {
      await readApiResponse(
        await authenticatedFetch('/api/business/administration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...preview.change, previewReceipt: preview.receipt }),
        }),
        'Change could not be saved.',
      );
      setPreview(undefined);
      setId('');
      setReason('');
      setAttempt(n => n + 1);
      window.dispatchEvent(new Event('business-changed'));
      window.dispatchEvent(new Event('workspace-access-updated'));
      try {
        const context = await readApiResponse<BusinessContext>(
          await authenticatedFetch('/api/business/context'),
          'Reload your access context.',
        );
        if (!context.canManage) setState(undefined);
        onSaved(context);
      } catch (e) {
        setState(undefined);
        setError(
          `Change saved. Access refresh failed: ${(e as Error).message} Retry loading configuration.`,
        );
      }
    } catch (e) {
      setError((e as Error).message);
      // A lost response may follow a committed transaction. Keep the assignment ID so
      // rechecking/retrying edits that same record instead of creating another grant.
      if (typeof preview.change.id === 'string') setId(preview.change.id);
      setPreview(undefined);
      setAttempt(n => n + 1);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  const people = state?.people.filter(p => p.active || p.id === person) ?? [],
    projects = state?.projects.filter(p => p.active || p.id === project || p.id === scope) ?? [],
    nodes = state?.nodes.filter(n => n.active || n.id === scope || n.id === department) ?? [];
  return (
    <section className="bo-panel" onChangeCapture={invalidatePreview}>
      <h2>People & access profiles</h2>
      <p className="bo-note">
        A person can belong to multiple projects. Membership, reporting and authority are managed
        separately. Employee and Manager follow the active baseline and current reporting. Business
        Analytics and Admin require explicit scoped assignments.
      </p>
      {error && (
        <p role="alert" className="bo-error">
          {error}
        </p>
      )}
      {loadError && (
        <p role="alert" className="bo-error">
          {loadError}
        </p>
      )}
      {!state ? (
        error || loadError ? (
          <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
            Retry loading configuration
          </button>
        ) : (
          <p>Loading configuration…</p>
        )
      ) : (
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="bo-tabs">
            {[
              ['RESPONSIBILITY', 'People & access'],
              ['PROJECT', 'Projects'],
              ['MEMBERSHIP', 'Memberships'],
              ['PERSONAL_BASELINE', 'Employee baseline'],
            ].map(([k, label]) => (
              <button
                key={k}
                aria-current={kind === k ? 'page' : undefined}
                onClick={() => changeKind(k)}
              >
                {label}
              </button>
            ))}
          </div>
          {kind === 'RESPONSIBILITY' && (
            <>
              <div className="bo-access-profiles">
                {[
                  [
                    'Employee',
                    'Personal profile, skills, certifications and learning. Automatic for active employees when the baseline is enabled.',
                  ],
                  [
                    'Manager',
                    'Reviews, team insights and recommendations for current direct reports. Reporting and review checks apply.',
                  ],
                  [
                    'Business Analytics',
                    'Analytics, exports, demand and matching within an explicitly assigned scope.',
                  ],
                  [
                    'Admin',
                    'People/access, catalogue and audit administration, plus organization-wide Business Analytics.',
                  ],
                ].map(([label, description]) => (
                  <article key={label}>
                    <h3>{label}</h3>
                    <p>{description}</p>
                  </article>
                ))}
              </div>
              <div className="bo-access-toolbar">
                <label>
                  Find person
                  <input
                    type="search"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Name or employee code"
                  />
                </label>
                <Link className="secondary-button" to="/access?view=organization">
                  Manage reporting & organization
                </Link>
                <Link className="secondary-button" to="/access?view=people">
                  People, exceptions & access explanations
                </Link>
              </div>
              <div className="bo-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Automatic access</th>
                      <th>Business access</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.people
                      .filter(p =>
                        (p.name + ' ' + p.employeeCode)
                          .toLowerCase()
                          .includes(search.trim().toLowerCase()),
                      )
                      .map(p => (
                        <tr key={p.id}>
                          <td>
                            {p.name}
                            <small className="bo-access-code">
                              {p.employeeCode}
                              {!p.active ? ' · Inactive' : ''}
                            </small>
                          </td>
                          <td>
                            {p.employeeAccess === undefined
                              ? 'Access details unavailable'
                              : p.employeeAccess
                                ? 'Employee'
                                : 'Employee access blocked'}
                            {p.hasDirectReports && (
                              <small className="bo-access-code">
                                {p.managerAccess
                                  ? 'Manager · current direct reports'
                                  : 'Manager access blocked'}
                              </small>
                            )}
                          </td>
                          <td>
                            {p.analyticsAccess === undefined || p.adminAccess === undefined
                              ? 'Access details unavailable'
                              : p.adminAccess
                                ? p.analyticsAccess
                                  ? 'Admin + Business Analytics'
                                  : 'Admin · analytics blocked'
                                : p.analyticsAccess
                                  ? 'Business Analytics'
                                  : 'No business access'}
                            {state.responsibilities
                              .filter(r => r.personId === p.id)
                              .map(r => (
                                <button
                                  className="bo-access-assignment"
                                  key={r.id}
                                  onClick={() => editResponsibility(r)}
                                >
                                  {r.bundle === 'SYSTEM_ADMIN' ? 'Admin' : 'Business Analytics'} ·{' '}
                                  {state.nodes.find(n => n.id === r.scopeId)?.name ??
                                    state.projects.find(n => n.id === r.scopeId)?.name ??
                                    (r.kind === 'ORGANIZATION'
                                      ? 'Organization'
                                      : 'Unavailable scope')}{' '}
                                  · {r.effect === 'DENY' ? 'Denied' : 'Allowed'} ·{' '}
                                  {!r.active
                                    ? 'Inactive'
                                    : r.validUntil && Date.parse(r.validUntil) <= Date.now()
                                      ? 'Expired'
                                      : 'Active'}
                                </button>
                              ))}
                          </td>
                          <td>
                            <button
                              className="secondary-button"
                              disabled={!p.active || busy}
                              onClick={() => {
                                selectPerson(p.id);
                                document
                                  .getElementById('bo-access-assignment-form')
                                  ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                              }}
                            >
                              Add access
                            </button>
                          </td>
                        </tr>
                      ))}
                    {!state.people.some(p =>
                      (p.name + ' ' + p.employeeCode)
                        .toLowerCase()
                        .includes(search.trim().toLowerCase()),
                    ) && (
                      <tr>
                        <td colSpan={4}>No matching people.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <h3>{id ? 'Edit scoped assignment' : 'Add scoped assignment'}</h3>
              {id && (
                <button className="secondary-button" onClick={() => selectPerson(person)}>
                  New assignment for this person
                </button>
              )}
            </>
          )}
          <form
            id="bo-access-assignment-form"
            className="bo-admin-form"
            onSubmit={e => {
              e.preventDefault();
              void prepare();
            }}
          >
            {kind === 'PROJECT' && (
              <>
                <label>
                  Project
                  <select
                    value={id}
                    onChange={e => {
                      setId(e.target.value);
                      setReason('');
                      const p = state.projects.find(p => p.id === e.target.value);
                      setName(p?.name ?? '');
                      setDepartment(p?.departmentId ?? '');
                      setActive(p?.active ?? true);
                    }}
                  >
                    <option value="">New project</option>
                    {state.projects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {!p.active ? ' (inactive)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Name <span className="bo-required">*</span>
                  <input
                    required
                    maxLength={100}
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </label>
                <label>
                  Project department
                  <select value={department} onChange={e => setDepartment(e.target.value)}>
                    <option value="">No department binding</option>
                    {nodes
                      .filter(n => n.kind === 'DEPARTMENT')
                      .map(n => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
            {(kind === 'MEMBERSHIP' || kind === 'RESPONSIBILITY') && (
              <label>
                Person <span className="bo-required">*</span>
                <select
                  required
                  value={person}
                  onChange={e => selectPerson(e.target.value)}
                  disabled={busy}
                >
                  <option value="">Choose employee</option>
                  {people.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.employeeCode}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {kind === 'MEMBERSHIP' && (
              <label>
                Project <span className="bo-required">*</span>
                <select required value={project} onChange={e => setProject(e.target.value)}>
                  <option value="">Choose project</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {kind === 'RESPONSIBILITY' && (
              <>
                <label>
                  Responsibility
                  <select
                    value={bundle}
                    onChange={e => {
                      setBundle(e.target.value);
                      if (e.target.value === 'SYSTEM_ADMIN') {
                        setScopeKind('ORGANIZATION');
                        setScope('');
                      }
                    }}
                  >
                    <option value="BUSINESS_OPERATIONS">Business Analytics</option>
                    <option value="SYSTEM_ADMIN">Admin</option>
                  </select>
                </label>
                <label>
                  Scope
                  <select
                    disabled={bundle === 'SYSTEM_ADMIN'}
                    value={scopeKind}
                    onChange={e => {
                      setScopeKind(e.target.value);
                      setScope('');
                    }}
                  >
                    {['ORGANIZATION', 'DELIVERY_UNIT', 'DEPARTMENT', 'PROJECT'].map(k => (
                      <option key={k} value={k}>
                        {k === 'ORGANIZATION'
                          ? 'Organization (entire company workspace)'
                          : k.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                </label>
                {scopeKind === 'ORGANIZATION' && (
                  <p className="bo-note">
                    Organization covers active provisioned employees in this company workspace,
                    across its delivery units, departments and projects. Matching denies still
                    apply. It does not grant access to other accounts, private files or unrelated
                    claim reviews.
                  </p>
                )}
                {scopeKind !== 'ORGANIZATION' && (
                  <label>
                    Scope binding <span className="bo-required">*</span>
                    <select required value={scope} onChange={e => setScope(e.target.value)}>
                      <option value="">Choose authorized binding</option>
                      {(scopeKind === 'PROJECT'
                        ? projects
                        : nodes.filter(n => n.kind === scopeKind)
                      ).map(n => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Effect
                  <select value={effect} onChange={e => setEffect(e.target.value)}>
                    <option value="ALLOW">Allow responsibility</option>
                    <option value="DENY">Deny in this scope</option>
                  </select>
                </label>
                <label>
                  Expires {effect === 'DENY' && <span className="bo-required">*</span>}
                  <input
                    type="datetime-local"
                    required={effect === 'DENY' && active}
                    value={until}
                    onChange={e => setUntil(e.target.value)}
                  />
                </label>
                <p className="bo-note">
                  Admin provides catalogue, audit and people/access administration plus
                  organization-wide Business Analytics. Claim reviews still follow the assigned
                  current manager.
                </p>
              </>
            )}
            {kind !== 'PERSONAL_BASELINE' ? (
              <label className="bo-check">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={e => setActive(e.target.checked)}
                />{' '}
                Active
              </label>
            ) : (
              <>
                <label className="bo-check">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={e => setEnabled(e.target.checked)}
                  />{' '}
                  Employee baseline
                </label>
                <p className="bo-note">
                  Applies to {state.baselineAffectedPeople} active provisioned people and future
                  provisioned employees. Existing explicit denies remain effective. Role names and
                  designation do not affect this baseline.
                </p>
              </>
            )}
            <label className="bo-full">
              Reason <span className="bo-required">*</span>
              <textarea
                required
                maxLength={1000}
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Why is this change needed?"
              />
            </label>
            <button className="primary-button" disabled={busy}>
              {busy ? 'Checking…' : 'Preview change'}
            </button>
          </form>
          {kind === 'MEMBERSHIP' && (
            <div className="bo-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Project</th>
                    <th>State</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {state.memberships.map(m => (
                    <tr key={m.personId + m.projectId}>
                      <td>{state.people.find(p => p.id === m.personId)?.name}</td>
                      <td>{state.projects.find(p => p.id === m.projectId)?.name}</td>
                      <td>{m.active ? 'Active' : 'Inactive'}</td>
                      <td>
                        <button
                          onClick={() => {
                            selectPerson(m.personId);
                            setPerson(m.personId);
                            setProject(m.projectId);
                            setActive(m.active);
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details>
            <summary>
              Historical grants needing explicit review ({state.historicalGrantsForReview.length})
            </summary>
            <p>
              These assignments are retained. Their presence does not enable an unsupported workflow
              or widen Business Operations.
            </p>
            <pre>{JSON.stringify(state.historicalGrantsForReview, null, 2)}</pre>
          </details>
        </fieldset>
      )}
      {preview && (
        <FormDialog
          title="Review configuration change"
          onClose={() => setPreview(undefined)}
          busy={busy}
          footer={
            <>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setPreview(undefined)}
              >
                Back
              </button>
              <button className="primary-button" disabled={busy} onClick={() => void save()}>
                Confirm & save
              </button>
            </>
          }
        >
          <p>
            Access revision {String(preview.change.revision)}. The server will recheck access,
            bindings and this revision before saving.
          </p>
          <div className="bo-amendment-comparison">
            <section>
              <h3>Current access</h3>
              <AccessChangeSummary value={preview.before} state={state} />
            </section>
            <section>
              <h3>Proposed access</h3>
              <AccessChangeSummary value={preview.after} state={state} />
            </section>
          </div>
          <h3>Affected actions</h3>
          <ul>
            {((preview.impact as { actions?: string[] }).actions ?? []).map(action => (
              <li key={action}>{action}</li>
            ))}
          </ul>
          {preview.warnings.map(w => (
            <p key={w} className="bo-note">
              {w}
            </p>
          ))}
          {error && (
            <p className="bo-error" role="alert">
              {error}
            </p>
          )}
        </FormDialog>
      )}
    </section>
  );
}

function AccessChangeSummary({ value, state }: { value: unknown; state?: Administration }) {
  if (!value || typeof value !== 'object') return <p>No existing assignment.</p>;
  const labels: Record<string, string> = {
    personId: 'Person',
    bundle: 'Access profile',
    kind: 'Scope',
    scope_kind: 'Scope',
    scopeId: 'Binding',
    scope_id: 'Binding',
    person_id: 'Person',
    projectId: 'Project',
    project_id: 'Project',
    departmentId: 'Department',
    department_id: 'Department',
    name: 'Name',
    effect: 'Effect',
    active: 'State',
    enabled: 'Employee baseline',
    validUntil: 'Expires',
    valid_until: 'Expires',
    reason: 'Reason',
  };
  return (
    <dl className="bo-access-summary">
      {Object.entries(value)
        .filter(([key]) => key in labels)
        .map(([key, raw]) => {
          const resolved =
            typeof raw === 'string'
              ? (state?.people.find(p => p.id.toLowerCase() === raw.toLowerCase())?.name ??
                state?.nodes.find(n => n.id.toLowerCase() === raw.toLowerCase())?.name ??
                state?.projects.find(p => p.id.toLowerCase() === raw.toLowerCase())?.name)
              : undefined;
          const text =
            resolved ??
            (raw === 'BUSINESS_OPERATIONS'
              ? 'Business Analytics'
              : raw === 'SYSTEM_ADMIN'
                ? 'Admin'
                : typeof raw === 'boolean'
                  ? raw
                    ? 'Enabled'
                    : 'Disabled'
                  : raw === null
                    ? 'None'
                    : String(raw).replaceAll('_', ' '));
          return (
            <div key={key}>
              <dt>{labels[key]}</dt>
              <dd>{text}</dd>
            </div>
          );
        })}
    </dl>
  );
}
