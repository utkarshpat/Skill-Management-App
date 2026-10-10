import { useSearchParams } from 'react-router';
import { businessDraftHandoff } from './business-draft-handoff';
import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { FormDialog } from '../FormDialog';
import type { BusinessContext } from './business-model';
interface Master {
  id: string;
  name: string;
  category?: string;
  providerId?: string;
  provider?: string;
  description?: string;
  active?: boolean;
  levels?: { rank: number; description: string }[];
}
interface Masters {
  revision: number;
  providers: Master[];
  certifications: Master[];
  skills: Master[];
  page: number;
  pageSize: number;
  providerTotal: number;
  certificationTotal: number;
  skillTotal: number;
}
interface Amendment {
  id: string;
  type: string;
  employee: string;
  definition: Record<string, unknown>;
  reason: string;
  status: string;
  revision: number;
  decisionNote: string | null;
}
interface Demand {
  id: string;
  title: string;
  description: string;
  revision: number;
  scopeKind: string;
  requirements: { skills: { id: string; minRank: number }[]; certifications: string[] };
}
interface List {
  revision: number;
  rows: (Amendment | Demand)[];
  total: number;
  page: number;
  pageSize: number;
  canApprove?: boolean;
}
interface Matches {
  id: string;
  revision: number;
  asOf: string;
  required: number;
  total: number;
  page: number;
  pageSize: number;
  rows: {
    id: string;
    employee: string;
    employeeCode: string;
    matched: number;
    eligible: boolean;
    shortlisted: boolean;
    criteria: { type: string; name: string; matched: boolean; criterion: string }[];
  }[];
}
interface Preview {
  receipt: string;
  command: { operation: string; payload: Record<string, unknown> };
  details: Record<string, unknown>;
  revision: number;
}
const read = <T,>(operation: string, query = '') =>
  authenticatedFetch('/api/business/workflow/' + operation + query).then(r =>
    readApiResponse<T>(r, 'Business workflow could not be loaded.'),
  );
export function BusinessWorkflows({
  context,
  view,
}: {
  context: BusinessContext;
  view: 'amendments' | 'demand';
}) {
  const [params, setParams] = useSearchParams();
  const [masterSearch, setMasterSearch] = useState(''),
    [masterTerm, setMasterTerm] = useState(''),
    [masterPage, setMasterPage] = useState(1);
  const [list, setList] = useState<List>(),
    [masters, setMasters] = useState<Masters>(),
    [error, setError] = useState(''),
    [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0),
    [composing, setComposing] = useState(false),
    [type, setType] = useState('CERTIFICATION'),
    [target, setTarget] = useState(''),
    [name, setName] = useState(''),
    [category, setCategory] = useState(''),
    [description, setDescription] = useState(''),
    [provider, setProvider] = useState(''),
    [criteria, setCriteria] = useState(['', '', '', '', '']),
    [reason, setReason] = useState(''),
    [active, setActive] = useState(true),
    [scope, setScope] = useState(''),
    [skills, setSkills] = useState<{ id: string; minRank: number }[]>([]),
    [certs, setCerts] = useState<string[]>([]),
    [decision, setDecision] = useState<{ operation: string; payload: Record<string, unknown> }>(),
    [note, setNote] = useState(''),
    [preview, setPreview] = useState<Preview>(),
    [busy, setBusy] = useState(false),
    [matches, setMatches] = useState<Matches>(),
    [matching, setMatching] = useState<string>(),
    [matchPage, setMatchPage] = useState(1),
    [matchAttempt, setMatchAttempt] = useState(0),
    guard = useRef(false),
    intent = useRef('');
  useEffect(() => {
    setPage(1);
    setList(undefined);
    setMatches(undefined);
    setMatching(undefined);
    setError('');
  }, [view]);
  useEffect(() => {
    const abort = new AbortController();
    setError('');
    setList(undefined);
    authenticatedFetch(
      '/api/business/workflow/' +
        (view === 'amendments' ? 'amendments' : 'demands') +
        '?page=' +
        page,
      { signal: abort.signal },
    )
      .then(r => readApiResponse<List>(r, 'Workflow records are unavailable.'))
      .then(records => {
        if (!abort.signal.aborted) setList(records);
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [view, page, attempt]);
  useEffect(() => {
    const abort = new AbortController();
    setMasters(undefined);
    authenticatedFetch(
      '/api/business/workflow/masters?' +
        new URLSearchParams({
          page: String(masterPage),
          search: masterTerm,
          includeInactive: String(view === 'amendments'),
        }),
      { signal: abort.signal },
    )
      .then(r => readApiResponse<Masters>(r, 'Master choices are unavailable.'))
      .then(choices => {
        if (!abort.signal.aborted) setMasters(choices);
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [view, masterPage, masterTerm, attempt]);
  useEffect(() => {
    if (!matching) return;
    const abort = new AbortController();
    setMatches(undefined);
    authenticatedFetch(`/api/business/workflow/matches?id=${matching}&page=${matchPage}`, {
      signal: abort.signal,
    })
      .then(r => readApiResponse<Matches>(r, 'Matching could not be completed.'))
      .then(v => {
        if (!abort.signal.aborted) setMatches(v);
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [matching, matchPage, attempt, matchAttempt]);
  const start = () => {
    intent.current = crypto.randomUUID();
    setComposing(true);
    setPreview(undefined);
    setDecision(undefined);
    setError('');
    setName('');
    setCategory('');
    setDescription('');
    setReason('');
    setTarget('');
    setActive(true);
    setSkills([]);
    setCerts([]);
    setScope('');
    setProvider('');
    setMasterSearch('');
    setMasterTerm('');
    setMasterPage(1);
    setCriteria(['', '', '', '', '']);
  };
  async function prepare(command: { operation: string; payload: Record<string, unknown> }) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    try {
      setPreview(
        await readApiResponse<Preview>(
          await authenticatedFetch('/api/business/workflow/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(command),
          }),
          'This action could not be previewed.',
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  async function submit() {
    if (guard.current || !preview) return;
    guard.current = true;
    setBusy(true);
    setError('');
    try {
      await readApiResponse(
        await authenticatedFetch('/api/business/workflow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...preview.command, previewReceipt: preview.receipt }),
        }),
        'The result is uncertain. Refresh records before retrying.',
      );
      setPreview(undefined);
      setDecision(undefined);
      setComposing(false);
      setAttempt(n => n + 1);
      window.dispatchEvent(new Event('business-changed'));
    } catch (e) {
      setError(
        (e as Error).message + ' Refresh records to check whether it saved before retrying.',
      );
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  function draft() {
    if (!masters) return;
    if (view === 'amendments')
      void prepare({
        operation: 'PROPOSE',
        payload: {
          id: intent.current,
          revision: masters.revision,
          type,
          targetId: target || null,
          name,
          category,
          description,
          providerId: provider,
          criteria,
          reason,
          active,
        },
      });
    else
      void prepare({
        operation: 'SAVE_DEMAND',
        payload: {
          id: intent.current,
          revision: masters.revision,
          scopeId: scope,
          title: name,
          description,
          requirements: { skills, certifications: certs },
        },
      });
  }
  useEffect(() => {
    const ticket = params.get('draftTicket');
    if (!ticket || !masters || !context.actorId) return;
    const draft = businessDraftHandoff.take(context.actorId, ticket);
    const next = new URLSearchParams(params);
    next.delete('draftTicket');
    setParams(next, { replace: true });
    if (!draft) {
      setError('This draft expired or belongs to another session. Ask AI to prepare it again.');
      return;
    }
    if (
      (draft.kind === 'amendment_draft' && !context.canAmend) ||
      (draft.kind === 'demand_draft' && !context.canDemandCreate)
    ) {
      setError('This draft is no longer permitted.');
      return;
    }
    if ((draft.kind === 'amendment_draft') !== (view === 'amendments')) {
      setError('Open the matching draft section and ask AI again.');
      return;
    }
    start();
    setName(draft.title.slice(0, view === 'demand' ? 150 : 100));
    setDescription(draft.body.slice(0, 2000));
    setReason(draft.summary.slice(0, 1000));
    setTarget('');
    setPreview(undefined);
  }, [
    params,
    masters,
    context.actorId,
    context.canAmend,
    context.canDemandCreate,
    view,
    setParams,
  ]);
  const choices =
    type === 'SKILL'
      ? masters?.skills
      : type === 'PROVIDER'
        ? masters?.providers
        : masters?.certifications;
  return (
    <section className="bo-panel">
      <div className="bo-record-heading">
        <div>
          <h2>{view === 'amendments' ? 'Master amendments' : 'Demand & matching'}</h2>
          <p className="bo-note">
            {view === 'amendments'
              ? 'Propose skill, certification or provider changes. System Admin reviews and applies an approved definition atomically.'
              : 'Match explicit requirements against reviewed skills and current reviewed credentials. Missing evidence means “not established”; availability is not assessed.'}
          </p>
        </div>
        <button
          className="primary-button"
          disabled={
            !masters ||
            !list ||
            (view === 'amendments' ? !context.canAmend : !context.canDemandCreate)
          }
          onClick={start}
        >
          {view === 'amendments' ? 'Propose amendment' : 'New demand'}
        </button>
      </div>
      {error && (
        <p className="bo-error" role="alert">
          {error}{' '}
          <button
            onClick={() => {
              setPreview(undefined);
              setDecision(undefined);
              setAttempt(n => n + 1);
            }}
          >
            Refresh records
          </button>
        </p>
      )}
      {!list && !error && <div className="bo-skeleton" aria-label="Loading workflow records" />}
      {list && (
        <>
          <div className="bo-table-wrap">
            <table>
              <thead>
                <tr>
                  {view === 'amendments' ? (
                    <>
                      <th>Definition</th>
                      <th>Proposer</th>
                      <th>Status</th>
                      <th>Reason / feedback</th>
                      <th>Action</th>
                    </>
                  ) : (
                    <>
                      <th>Demand</th>
                      <th>Scope</th>
                      <th>Requirements</th>
                      <th>Action</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {list.rows.map(row =>
                  view === 'amendments'
                    ? (() => {
                        const a = row as Amendment;
                        return (
                          <tr key={a.id}>
                            <td>
                              {String(a.definition.name)}
                              <small> · {a.type}</small>
                            </td>
                            <td>{a.employee}</td>
                            <td>{a.status}</td>
                            <td>
                              {a.reason}
                              {a.decisionNote && <p>{a.decisionNote}</p>}
                              <details>
                                <summary>Definition details</summary>
                                <DefinitionPreview
                                  details={a.definition}
                                  masters={masters}
                                  context={context}
                                />
                              </details>
                            </td>
                            <td>
                              {context.canApprove &&
                                list.canApprove &&
                                a.status === 'SUBMITTED' && (
                                  <>
                                    <button
                                      onClick={() => {
                                        setDecision({
                                          operation: 'APPROVE_AMENDMENT',
                                          payload: { id: a.id, revision: a.revision },
                                        });
                                        setNote('');
                                        setError('');
                                      }}
                                    >
                                      Review & approve
                                    </button>
                                    <button
                                      onClick={() => {
                                        setDecision({
                                          operation: 'REJECT_AMENDMENT',
                                          payload: { id: a.id, revision: a.revision },
                                        });
                                        setNote('');
                                        setError('');
                                      }}
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}
                            </td>
                          </tr>
                        );
                      })()
                    : (() => {
                        const d = row as Demand;
                        return (
                          <tr key={d.id}>
                            <td>
                              <strong>{d.title}</strong>
                              <p className="bo-note">{d.description}</p>
                            </td>
                            <td>{d.scopeKind.replaceAll('_', ' ')}</td>
                            <td>
                              {d.requirements.skills.length} skills ·{' '}
                              {d.requirements.certifications.length} credentials
                            </td>
                            <td>
                              <button
                                className="secondary-button"
                                disabled={!context.canMatch}
                                onClick={() => {
                                  setMatching(d.id);
                                  setMatchPage(1);
                                  setMatches(undefined);
                                  setMatchAttempt(n => n + 1);
                                }}
                              >
                                Find matches
                              </button>
                            </td>
                          </tr>
                        );
                      })(),
                )}
              </tbody>
            </table>
            {!list.rows.length && (
              <p className="bo-empty">
                {view === 'amendments'
                  ? 'No amendments yet. Start with a provider or credential definition.'
                  : 'Create a demand to explore explainable matches in your scope.'}
              </p>
            )}
          </div>
          <footer className="bo-pagination">
            <span>
              {list.total} records · page {page}
            </span>
            <button disabled={page <= 1} onClick={() => setPage(n => n - 1)}>
              Previous
            </button>
            <button
              disabled={page * list.pageSize >= list.total}
              onClick={() => setPage(n => n + 1)}
            >
              Next
            </button>
          </footer>
        </>
      )}
      {matching && (
        <section className="bo-panel">
          <h2>Candidate matches</h2>
          <p className="bo-note">
            {matches
              ? 'As of ' + new Date(matches.asOf).toLocaleString()
              : 'Checking current reviewed records…'}
            . Exact master credential name and provider matching; expired credentials are excluded.
          </p>
          {matches && (
            <>
              <div className="bo-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Coverage</th>
                      <th>Criteria</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.rows.map(p => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.employee}</strong>
                          <p className="bo-note">{p.employeeCode}</p>
                        </td>
                        <td>
                          {p.matched} / {matches.required}
                          <p>
                            {p.eligible
                              ? 'Requirements established'
                              : 'Some requirements not established'}
                          </p>
                        </td>
                        <td>
                          {p.criteria.map(c => (
                            <p key={c.type + c.name}>
                              {c.matched ? '✓' : '—'} {c.name}
                              <small> · {c.criterion}</small>
                            </p>
                          ))}
                        </td>
                        <td>
                          <button
                            disabled={!context.canShortlist || !p.eligible || p.shortlisted}
                            onClick={() => {
                              setDecision({
                                operation: 'SHORTLIST',
                                payload: {
                                  id: matches.id,
                                  revision: matches.revision,
                                  personId: p.id,
                                },
                              });
                              setNote('');
                            }}
                          >
                            {p.shortlisted ? 'Shortlisted' : 'Review shortlist'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!matches.rows.length && (
                  <p className="bo-empty">No current authorized candidates in this demand scope.</p>
                )}
              </div>
              <footer className="bo-pagination">
                <span>
                  {matches.total} candidates · page {matchPage}
                </span>
                <button disabled={matchPage <= 1} onClick={() => setMatchPage(n => n - 1)}>
                  Previous
                </button>
                <button
                  disabled={matchPage * matches.pageSize >= matches.total}
                  onClick={() => setMatchPage(n => n + 1)}
                >
                  Next
                </button>
              </footer>
            </>
          )}
        </section>
      )}
      {composing && !preview && (
        <FormDialog
          title={view === 'amendments' ? 'Propose master amendment' : 'New scoped demand'}
          busy={busy}
          onClose={() => setComposing(false)}
          onSubmit={draft}
          formId="business-compose"
          footer={
            <>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setComposing(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={busy || !masters}
                type="submit"
                form="business-compose"
              >
                Review proposal
              </button>
            </>
          }
        >
          <div className="bo-page bo-admin-form">
            <div className="bo-full bo-record-filters">
              <label>
                Search approved definitions
                <input
                  maxLength={100}
                  value={masterSearch}
                  onChange={e => setMasterSearch(e.target.value)}
                  placeholder="Skill, credential or provider…"
                />
              </label>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setMasterTerm(masterSearch);
                  setMasterPage(1);
                }}
              >
                Search definitions
              </button>
              <button
                type="button"
                disabled={masterPage <= 1}
                onClick={() => setMasterPage(n => n - 1)}
              >
                Previous choices
              </button>
              <button
                type="button"
                disabled={
                  !masters ||
                  masterPage * masters.pageSize >=
                    Math.max(masters.providerTotal, masters.certificationTotal, masters.skillTotal)
                }
                onClick={() => setMasterPage(n => n + 1)}
              >
                Next choices
              </button>
              <p className="bo-note">
                {masters
                  ? `Choices page ${masters.page}. ${view === 'demand' ? `${skills.length} skills and ${certs.length} credentials selected across pages.` : 'Search to find another definition.'}`
                  : 'Loading choices…'}
              </p>
            </div>
            {view === 'amendments' && (
              <>
                <label>
                  Master type
                  <select
                    value={type}
                    onChange={e => {
                      setType(e.target.value);
                      setTarget('');
                      setName('');
                      setCategory('');
                      setDescription('');
                      setProvider('');
                      setCriteria(['', '', '', '', '']);
                      setActive(true);
                    }}
                  >
                    <option value="SKILL">Skill</option>
                    <option value="CERTIFICATION">Certification</option>
                    <option value="PROVIDER">Provider</option>
                  </select>
                </label>
                <label>
                  Definition
                  <select
                    value={target}
                    onChange={e => {
                      setTarget(e.target.value);
                      const item = choices?.find(c => c.id === e.target.value);
                      setName(item?.name ?? '');
                      setCategory(item?.category ?? '');
                      setProvider(item?.providerId ?? '');
                      setDescription(item?.description ?? '');
                      setActive(item?.active ?? true);
                      setCriteria(
                        [1, 2, 3, 4, 5].map(
                          rank => item?.levels?.find(l => l.rank === rank)?.description ?? '',
                        ),
                      );
                    }}
                  >
                    <option value="">Create new definition</option>
                    {target && !choices?.some(c => c.id === target) && (
                      <option value={target}>Selected: {name}</option>
                    )}
                    {choices?.map(c => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label>
              Name <span className="bo-required">*</span>
              <input
                required
                maxLength={view === 'demand' ? 150 : 100}
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </label>
            {view === 'amendments' && type !== 'PROVIDER' && (
              <label>
                Category <span className="bo-required">*</span>
                <input
                  required
                  maxLength={80}
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                />
              </label>
            )}
            {view === 'amendments' && type === 'CERTIFICATION' && (
              <label>
                Provider <span className="bo-required">*</span>
                <select required value={provider} onChange={e => setProvider(e.target.value)}>
                  <option value="">Choose approved provider</option>
                  {provider && !masters?.providers.some(p => p.id === provider) && (
                    <option value={provider}>Selected provider</option>
                  )}
                  {masters?.providers
                    .filter(p => p.active !== false)
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label className="bo-full">
              Description{' '}
              {view === 'amendments' && type === 'SKILL' && <span className="bo-required">*</span>}
              <textarea
                required={view === 'amendments' && type === 'SKILL'}
                maxLength={2000}
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </label>
            {view === 'amendments' ? (
              <>
                <label className="bo-check">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={e => setActive(e.target.checked)}
                  />{' '}
                  Active published definition
                </label>
                {type === 'SKILL' &&
                  ['Awareness', 'Foundation', 'Practitioner', 'Advanced', 'Expert'].map(
                    (label, i) => (
                      <label key={label} className="bo-full">
                        L{i + 1} · {label} <span className="bo-required">*</span>
                        <textarea
                          required
                          maxLength={1000}
                          value={criteria[i]}
                          onChange={e =>
                            setCriteria(values =>
                              values.map((v, index) => (index === i ? e.target.value : v)),
                            )
                          }
                        />
                      </label>
                    ),
                  )}
                <label className="bo-full">
                  Reason <span className="bo-required">*</span>
                  <textarea
                    required
                    maxLength={1000}
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  Demand scope <span className="bo-required">*</span>
                  <select required value={scope} onChange={e => setScope(e.target.value)}>
                    <option value="">Choose an allowed scope</option>
                    {context.scopes
                      .filter(s => s.effect === 'ALLOW')
                      .map(s => (
                        <option key={s.id} value={s.id}>
                          {s.label} · {s.kind}
                        </option>
                      ))}
                  </select>
                </label>
                <fieldset className="bo-full">
                  <legend>
                    Requirements <span className="bo-required">*</span> · choose 1–20 skills /
                    credentials
                  </legend>
                  <p>Reviewed skills</p>
                  {masters?.skills.map(s => (
                    <div key={s.id} className="bo-check">
                      <label className="bo-check">
                        <input
                          type="checkbox"
                          checked={skills.some(r => r.id === s.id)}
                          onChange={e =>
                            setSkills(rows =>
                              e.target.checked
                                ? [...rows, { id: s.id, minRank: 1 }]
                                : rows.filter(r => r.id !== s.id),
                            )
                          }
                        />
                        {s.name}
                      </label>
                      {skills.some(r => r.id === s.id) && (
                        <select
                          aria-label={'Minimum level for ' + s.name}
                          value={skills.find(r => r.id === s.id)?.minRank}
                          onChange={e =>
                            setSkills(rows =>
                              rows.map(r =>
                                r.id === s.id ? { ...r, minRank: Number(e.target.value) } : r,
                              ),
                            )
                          }
                        >
                          {[1, 2, 3, 4, 5].map(n => (
                            <option key={n} value={n}>
                              L{n} or above
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </fieldset>
                <fieldset className="bo-full">
                  <legend>Current credential requirements</legend>
                  {masters?.certifications.map(c => (
                    <label key={c.id} className="bo-check">
                      <input
                        type="checkbox"
                        checked={certs.includes(c.id)}
                        onChange={e =>
                          setCerts(rows =>
                            e.target.checked ? [...rows, c.id] : rows.filter(id => id !== c.id),
                          )
                        }
                      />
                      {c.name} · {c.provider}
                    </label>
                  ))}
                </fieldset>
              </>
            )}
          </div>
          {error && (
            <p className="bo-error" role="alert">
              {error}
            </p>
          )}
        </FormDialog>
      )}
      {decision && !preview && (
        <FormDialog
          title={
            decision.operation === 'SHORTLIST'
              ? 'Review candidate shortlist'
              : 'Review master decision'
          }
          onClose={() => setDecision(undefined)}
          busy={busy}
          onSubmit={() => void prepare({ ...decision, payload: { ...decision.payload, note } })}
          formId="business-decision"
          footer={
            <button
              type="submit"
              form="business-decision"
              className="primary-button"
              disabled={busy}
            >
              Preview decision
            </button>
          }
        >
          <label>
            Decision note <span className="bo-required">*</span>
            <textarea
              required
              maxLength={1000}
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="bo-error">
              {error}
            </p>
          )}
        </FormDialog>
      )}
      {preview && (
        <FormDialog
          title="Review & confirm"
          busy={busy}
          onClose={() => setPreview(undefined)}
          footer={
            <>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setPreview(undefined)}
              >
                Back
              </button>
              <button className="primary-button" disabled={busy} onClick={() => void submit()}>
                {(
                  {
                    PROPOSE: 'Submit amendment request',
                    SAVE_DEMAND: 'Create demand',
                    APPROVE_AMENDMENT: 'Approve amendment',
                    REJECT_AMENDMENT: 'Reject amendment',
                    SHORTLIST: 'Add to shortlist',
                  } as Record<string, string>
                )[preview.command.operation] ?? 'Confirm'}
              </button>
            </>
          }
        >
          <p>
            Review the details before confirming. The app checks that your access and the record are
            still current, and records the change in history.
          </p>
          <DefinitionPreview details={preview.details} masters={masters} context={context} />
          {error && (
            <p role="alert" className="bo-error">
              {error}
            </p>
          )}
        </FormDialog>
      )}
    </section>
  );
}

function DefinitionPreview({
  details,
  masters,
  context,
}: {
  details: Record<string, unknown>;
  masters?: Masters;
  context: BusinessContext;
}) {
  const d = (details.definition ?? details) as Record<string, unknown>;
  const requirements = d.requirements as
    { skills: { id: string; minRank: number }[]; certifications: string[] } | undefined;
  const levels = d.levels as { rank: number; description: string }[] | undefined;
  return (
    <div className="bo-page bo-review">
      <h3>{String(d.name ?? d.title ?? 'Reviewed decision')}</h3>
      <dl>
        {!!details.type && (
          <>
            <dt>Master type</dt>
            <dd>{String(details.type)}</dd>
          </>
        )}
        {!!d.category && (
          <>
            <dt>Category</dt>
            <dd>{String(d.category)}</dd>
          </>
        )}
        {!!d.providerId && (
          <>
            <dt>Provider</dt>
            <dd>
              {masters?.providers.find(p => p.id === d.providerId)?.name ??
                'Selected provider (rechecked before save)'}
            </dd>
          </>
        )}
        {!!d.scopeId && (
          <>
            <dt>Scope</dt>
            <dd>
              {context.scopes.find(s => s.id === d.scopeId)?.label ?? 'Selected authorized scope'}
            </dd>
          </>
        )}
        {typeof d.active === 'boolean' && (
          <>
            <dt>Definition state</dt>
            <dd>{d.active ? 'Active' : 'Retired'}</dd>
          </>
        )}
        {!!d.description && (
          <>
            <dt>Description</dt>
            <dd>{String(d.description)}</dd>
          </>
        )}
        {!!details.reason && (
          <>
            <dt>Reason</dt>
            <dd>{String(details.reason)}</dd>
          </>
        )}
        {!!details.note && (
          <>
            <dt>Decision note</dt>
            <dd>{String(details.note)}</dd>
          </>
        )}
      </dl>
      {levels?.map(l => (
        <p key={l.rank}>
          <strong>L{l.rank}</strong> · {l.description}
        </p>
      ))}
      {requirements && (
        <>
          <h4>Explicit requirements</h4>
          {requirements.skills.map(r => (
            <p key={r.id}>
              {masters?.skills.find(s => s.id === r.id)?.name ?? 'Selected published skill'} · L
              {r.minRank} or above
            </p>
          ))}
          {requirements.certifications.map(id => (
            <p key={id}>
              {masters?.certifications.find(c => c.id === id)?.name ??
                'Selected approved credential'}{' '}
              · current and manager reviewed
            </p>
          ))}
        </>
      )}
    </div>
  );
}
