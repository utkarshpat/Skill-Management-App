import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { FormDialog } from '../FormDialog';
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
  people: { id: string; name: string; employeeCode: string; active: boolean }[];
  nodes: { id: string; name: string; kind: string; active: boolean }[];
  historicalGrantsForReview: unknown[];
}
export function BusinessAdministration({ onSaved }: { onSaved: (value: BusinessContext) => void }) {
  const [state, setState] = useState<Administration>(),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [kind, setKind] = useState('PROJECT'),
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
    guard = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    setError('');
    authenticatedFetch('/api/business/administration', { signal: abort.signal })
      .then(r =>
        readApiResponse<Administration>(r, 'Project and access configuration is unavailable.'),
      )
      .then(v => {
        if (!abort.signal.aborted) {
          setState(v);
          setEnabled(v.personalBaseline);
        }
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [attempt]);
  const changeKind = (value: string) => {
    setKind(value);
    setId('');
    setPreview(undefined);
    setReason('');
    setActive(true);
    setName('');
    setScope('');
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
    try {
      const change = {
        revision: state.revision,
        kind,
        id: id || crypto.randomUUID(),
        payload: payload(),
      };
      setPreview(
        await readApiResponse(
          await authenticatedFetch('/api/business/administration/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(change),
          }),
          'Preview could not be prepared.',
        ),
      );
    } catch (e) {
      setError((e as Error).message);
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
      onSaved(
        await readApiResponse<BusinessContext>(
          await authenticatedFetch('/api/business/context'),
          'Reload your access context.',
        ),
      );
      window.dispatchEvent(new Event('business-changed'));
      window.dispatchEvent(new Event('workspace-access-updated'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  const people = state?.people.filter(p => p.active || p.id === person) ?? [],
    projects = state?.projects.filter(p => p.active || p.id === project || p.id === scope) ?? [],
    nodes = state?.nodes.filter(n => n.active || n.id === scope || n.id === department) ?? [];
  return (
    <section className="bo-panel">
      <h2>Projects & responsibilities</h2>
      <p className="bo-note">
        A person can belong to multiple projects. Membership, reporting and authority are managed
        separately. Every change requires a reviewed preview and a current transaction.
      </p>
      {error && (
        <p role="alert" className="bo-error">
          {error}
        </p>
      )}
      {!state ? (
        <p>Loading configuration…</p>
      ) : (
        <>
          <div className="bo-tabs">
            {[
              ['PROJECT', 'Projects'],
              ['MEMBERSHIP', 'Memberships'],
              ['RESPONSIBILITY', 'Responsibilities'],
              ['PERSONAL_BASELINE', 'Personal baseline'],
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
          <form
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
                <select required value={person} onChange={e => setPerson(e.target.value)}>
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
                    <option value="BUSINESS_OPERATIONS">Business Operations</option>
                    <option value="SYSTEM_ADMIN">System Admin</option>
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
                  System Admin provides catalogue, audit and people/access administration plus
                  account-wide Business Operations. It does not authorize unrelated claim approvals.
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
                  Default Personal Workspace
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
          {kind === 'RESPONSIBILITY' && (
            <div className="bo-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Responsibility / scope</th>
                    <th>Effect / state</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {state.responsibilities.map(r => (
                    <tr key={r.id}>
                      <td>{state.people.find(p => p.id === r.personId)?.name}</td>
                      <td>
                        {r.bundle.replaceAll('_', ' ')} · {r.kind} ·{' '}
                        {state.projects.find(p => p.id === r.scopeId)?.name ??
                          state.nodes.find(n => n.id === r.scopeId)?.name ??
                          'Organization'}
                      </td>
                      <td>
                        {r.effect} · {r.active ? 'Active' : 'Inactive'}
                      </td>
                      <td>
                        <button
                          onClick={() => {
                            setId(r.id);
                            setPerson(r.personId);
                            setBundle(r.bundle);
                            setScopeKind(r.kind);
                            setScope(r.scopeId ?? '');
                            setEffect(r.effect);
                            setActive(r.active);
                            setUntil(
                              r.validUntil
                                ? new Date(
                                    new Date(r.validUntil).getTime() -
                                      new Date(r.validUntil).getTimezoneOffset() * 60000,
                                  )
                                    .toISOString()
                                    .slice(0, 16)
                                : '',
                            );
                            setReason(r.reason);
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
        </>
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
          <h3>Before</h3>
          <pre>{JSON.stringify(preview.before, null, 2)}</pre>
          <h3>After</h3>
          <pre>{JSON.stringify(preview.after, null, 2)}</pre>
          <h3>Impact</h3>
          <pre>{JSON.stringify(preview.impact, null, 2)}</pre>
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
