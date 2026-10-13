import { useSearchParams } from 'react-router';
import { businessDraftHandoff } from './business-draft-handoff';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { FormDialog } from '../FormDialog';
import type { BusinessContext } from './business-model';
interface Master {
  catalogueRevision?: number;
  id: string;
  name: string;
  category?: string;
  providerId?: string;
  provider?: string;
  description?: string;
  active?: boolean;
  levels?: { rank: number; description: string }[];
  relatedSkillIds?: string[];
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
  isNew?: boolean;
  createdAt?: string;
  decidedAt?: string;
  currentDefinition?: Record<string, unknown>;
  targetChanged?: boolean;
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
  const [requestDetail, setRequestDetail] = useState<Amendment>();
  const [requestError, setRequestError] = useState('');
  const [amendmentStep, setAmendmentStep] = useState(0);
  const [amendmentMode, setAmendmentMode] = useState<'new' | 'edit'>('new');
  const [selectedMaster, setSelectedMaster] = useState<Master>();
  const [providerName, setProviderName] = useState('');
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
    [criteria, setCriteria] = useState(['', '', '', '']),
    [relatedSkillIds, setRelatedSkillIds] = useState<string[]>([]),
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
  const requestId =
    view === 'amendments'
      ? params.get('request') ||
        (decision?.operation !== 'SHORTLIST' ? String(decision?.payload.id ?? '') : '')
      : '';
  useEffect(() => {
    setRequestDetail(undefined);
    setRequestError('');
    if (!requestId) return;
    const abort = new AbortController();
    authenticatedFetch('/api/business/workflow/amendment?id=' + encodeURIComponent(requestId), {
      signal: abort.signal,
    })
      .then(r => readApiResponse<Amendment>(r, 'This request could not be loaded.'))
      .then(r => {
        if (!abort.signal.aborted) setRequestDetail(r);
      })
      .catch(e => {
        if (!abort.signal.aborted) setRequestError(e.message);
      });
    return () => abort.abort();
  }, [requestId, attempt]);
  const closeRequest = () => {
    const next = new URLSearchParams(params);
    next.delete('request');
    setParams(next, { replace: true });
  };
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
    const refresh = () => setAttempt(n => n + 1);
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('business-changed', refresh);
    window.addEventListener('notifications-remote-updated', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('business-changed', refresh);
      window.removeEventListener('notifications-remote-updated', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
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
    setAmendmentStep(0);
    setAmendmentMode('new');
    setSelectedMaster(undefined);
    setProviderName('');
    setType('CERTIFICATION');
    setRelatedSkillIds([]);
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
    setCriteria(['', '', '', '']);
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
      const saved = await readApiResponse<{ id: string }>(
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
      setPage(1);
      if (preview.command.operation === 'PROPOSE' && saved.id) {
        const next = new URLSearchParams(params);
        next.set('request', saved.id);
        setParams(next);
      }
      setAttempt(n => n + 1);
      window.dispatchEvent(new Event('business-changed'));
      window.dispatchEvent(new Event('notifications-updated'));
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
          revision: selectedMaster?.catalogueRevision ?? masters.revision,
          type,
          targetId: target || null,
          name,
          category,
          description,
          providerId: provider,
          criteria,
          ...(type === 'CERTIFICATION' ? { relatedSkillIds } : {}),
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
  const masterTotal =
    view === 'demand'
      ? Math.max(
          masters?.providerTotal ?? 0,
          masters?.certificationTotal ?? 0,
          masters?.skillTotal ?? 0,
        )
      : amendmentStep === 1 || type === 'PROVIDER'
        ? (masters?.providerTotal ?? 0)
        : type === 'SKILL'
          ? (masters?.skillTotal ?? 0)
          : (masters?.certificationTotal ?? 0);
  const typeLabel = type === 'SKILL' ? 'Skill' : type === 'PROVIDER' ? 'Provider' : 'Certification';
  function resetSelection(nextType: string, nextMode: 'new' | 'edit') {
    if (nextType === type && nextMode === amendmentMode) return;
    setType(nextType);
    setAmendmentMode(nextMode);
    setTarget('');
    setSelectedMaster(undefined);
    setName('');
    setCategory('');
    setDescription('');
    setProvider('');
    setProviderName('');
    setCriteria(['', '', '', '']);
    setRelatedSkillIds([]);
    setActive(true);
    setMasterSearch('');
    setMasterTerm('');
    setMasterPage(1);
    setError('');
  }
  function selectMaster(id: string) {
    const item = choices?.find(c => c.id === id);
    setTarget(id);
    setSelectedMaster(item ? { ...item, catalogueRevision: masters?.revision } : undefined);
    setName(item?.name ?? '');
    setCategory(item?.category ?? '');
    setProvider(item?.providerId ?? '');
    setProviderName(item?.provider ?? '');
    setDescription(item?.description ?? '');
    setRelatedSkillIds((item?.relatedSkillIds ?? []).map(id => id.toLowerCase()));
    setActive(item?.active ?? true);
    setCriteria(
      [1, 2, 3, 4].map(rank =>
        item?.levels?.length === 4
          ? (item.levels.find(l => l.rank === rank)?.description ?? '')
          : '',
      ),
    );
  }
  function nextAmendmentStep() {
    if (amendmentMode === 'edit' && !target) {
      setError('Choose the catalogue entry you want to update.');
      return;
    }
    setMasterSearch('');
    setMasterTerm('');
    setMasterPage(1);
    setError('');
    setAmendmentStep(1);
  }
  return (
    <section className="bo-panel">
      <div className="bo-record-heading">
        <div>
          <h2>{view === 'amendments' ? 'Catalogue requests' : 'Demand & matching'}</h2>
          <p className="bo-note">
            {view === 'amendments'
              ? 'Request a new skill, certification or provider, or suggest an update to an existing entry. System Admin reviews requests before the catalogue changes.'
              : 'Match explicit requirements against reviewed skills and current reviewed credentials. Missing evidence means “not established”; availability is not assessed.'}
          </p>
        </div>
        <button
          type="button"
          className="primary-button"
          disabled={
            !masters ||
            !list ||
            (view === 'amendments' ? !context.canAmend : !context.canDemandCreate)
          }
          onClick={start}
        >
          <Plus size={15} aria-hidden="true" />
          {view === 'amendments' ? 'New catalogue request' : 'New demand'}
        </button>
      </div>
      {error && (
        <p className="bo-error" role="alert">
          {error}{' '}
          <button
            type="button"
            className="secondary-button bo-btn-sm"
            onClick={() => {
              setPreview(undefined);
              setDecision(undefined);
              setAttempt(n => n + 1);
            }}
          >
            <RotateCcw size={13} aria-hidden="true" />
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
                              <button
                                type="button"
                                className="secondary-button bo-btn-sm"
                                onClick={() => {
                                  const next = new URLSearchParams(params);
                                  next.set('request', a.id);
                                  setParams(next);
                                }}
                              >
                                View request
                              </button>
                              {String(a.definition.name)}
                              <small> · {a.type}</small>
                            </td>
                            <td>{a.employee}</td>
                            <td>
                              {(
                                {
                                  SUBMITTED: 'Awaiting admin review',
                                  APPROVED: 'Approved',
                                  REJECTED: 'Not approved',
                                } as Record<string, string>
                              )[a.status] ?? a.status}
                            </td>
                            <td>
                              <p>
                                <strong>Reason:</strong> {a.reason}
                              </p>
                              {a.decisionNote && (
                                <p>
                                  <strong>Admin feedback:</strong> {a.decisionNote}
                                </p>
                              )}
                              {a.createdAt && (
                                <small>
                                  Submitted {new Date(a.createdAt).toLocaleDateString()}
                                </small>
                              )}
                              {a.decidedAt && (
                                <small>
                                  {' '}
                                  · Decided {new Date(a.decidedAt).toLocaleDateString()}
                                </small>
                              )}
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
                                      type="button"
                                      className="secondary-button bo-btn-sm bo-btn-approve"
                                      onClick={() => {
                                        setDecision({
                                          operation: 'APPROVE_AMENDMENT',
                                          payload: { id: a.id, revision: a.revision },
                                        });
                                        setNote('');
                                        setError('');
                                      }}
                                    >
                                      <Check size={13} aria-hidden="true" />
                                      Review & approve
                                    </button>
                                    <button
                                      type="button"
                                      className="secondary-button bo-btn-sm bo-btn-reject"
                                      onClick={() => {
                                        setDecision({
                                          operation: 'REJECT_AMENDMENT',
                                          payload: { id: a.id, revision: a.revision },
                                        });
                                        setNote('');
                                        setError('');
                                      }}
                                    >
                                      <X size={13} aria-hidden="true" />
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
                                type="button"
                                className="secondary-button bo-btn-sm"
                                disabled={!context.canMatch}
                                onClick={() => {
                                  setMatching(d.id);
                                  setMatchPage(1);
                                  setMatches(undefined);
                                  setMatchAttempt(n => n + 1);
                                }}
                              >
                                <Search size={13} aria-hidden="true" />
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
                  ? 'No catalogue requests yet. Use New catalogue request to suggest an addition or correction.'
                  : 'Create a demand to explore explainable matches in your scope.'}
              </p>
            )}
          </div>
          <footer className="bo-pagination">
            <span>
              {list.total} records · page {page}
            </span>
            <button
              type="button"
              className="secondary-button"
              disabled={page <= 1}
              onClick={() => setPage(n => n - 1)}
            >
              <ChevronLeft size={14} aria-hidden="true" />
              Previous
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={page * list.pageSize >= list.total}
              onClick={() => setPage(n => n + 1)}
            >
              Next
              <ChevronRight size={14} aria-hidden="true" />
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
                            type="button"
                            className="secondary-button bo-btn-sm"
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
                            <Plus size={13} aria-hidden="true" />
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
                <button
                  type="button"
                  className="secondary-button"
                  disabled={matchPage <= 1}
                  onClick={() => setMatchPage(n => n - 1)}
                >
                  <ChevronLeft size={14} aria-hidden="true" />
                  Previous
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={matchPage * matches.pageSize >= matches.total}
                  onClick={() => setMatchPage(n => n + 1)}
                >
                  Next
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </footer>
            </>
          )}
        </section>
      )}
      {composing && !preview && (
        <FormDialog
          title={view === 'amendments' ? 'New catalogue request' : 'New scoped demand'}
          className={view === 'amendments' ? 'bo-amendment-dialog' : ''}
          subtitle={
            view === 'amendments'
              ? 'Suggest a catalogue change. This does not add a credential to your personal profile.'
              : undefined
          }
          page={view === 'amendments' ? amendmentStep : undefined}
          busy={busy}
          onClose={() => setComposing(false)}
          onSubmit={view === 'amendments' && amendmentStep === 0 ? nextAmendmentStep : draft}
          formId="business-compose"
          footer={
            <>
              {view === 'amendments' && amendmentStep === 1 && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    setMasterSearch('');
                    setMasterTerm('');
                    setMasterPage(1);
                    setError('');
                    setAmendmentStep(0);
                  }}
                >
                  <ChevronLeft size={14} aria-hidden="true" /> Back
                </button>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setComposing(false)}
              >
                Cancel
              </button>
              {view === 'amendments' && amendmentStep === 0 ? (
                <button
                  key="next-amendment-step"
                  type="button"
                  className="primary-button"
                  disabled={busy || (amendmentMode === 'edit' && (!target || !masters))}
                  onClick={nextAmendmentStep}
                >
                  Next: request details <ArrowRight size={14} aria-hidden="true" />
                </button>
              ) : (
                <button
                  key="preview-proposal"
                  className="primary-button"
                  disabled={busy || !masters}
                  type="submit"
                  form="business-compose"
                >
                  {view === 'amendments' ? 'Preview request' : 'Review proposal'}{' '}
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              )}
            </>
          }
        >
          {view === 'amendments' && (
            <div className="bo-amendment-progress" aria-label="Request steps">
              <span aria-current={amendmentStep === 0 ? 'step' : undefined}>1 · Choose change</span>
              <span aria-current={amendmentStep === 1 ? 'step' : undefined}>
                2 · Request details
              </span>
              <span>3 · Preview & submit</span>
            </div>
          )}
          <div className="bo-page bo-admin-form">
            {view === 'amendments' && amendmentStep === 0 && (
              <section className="bo-full bo-amendment-choice">
                <h3>What would you like to change?</h3>
                <div
                  className="bo-amendment-options"
                  role="group"
                  aria-label="Catalogue entry type"
                >
                  {['SKILL', 'CERTIFICATION', 'PROVIDER'].map(value => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={type === value}
                      onClick={() => resetSelection(value, amendmentMode)}
                    >
                      {value === 'SKILL'
                        ? 'Skill'
                        : value === 'PROVIDER'
                          ? 'Provider'
                          : 'Certification'}
                    </button>
                  ))}
                </div>
                <h3>What needs to happen?</h3>
                <div className="bo-amendment-options" role="group" aria-label="Request action">
                  <button
                    type="button"
                    aria-pressed={amendmentMode === 'new'}
                    onClick={() => resetSelection(type, 'new')}
                  >
                    <strong>Add a new entry</strong>
                    <span>Something is missing from the catalogue.</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={amendmentMode === 'edit'}
                    onClick={() => resetSelection(type, 'edit')}
                  >
                    <strong>Update an existing entry</strong>
                    <span>Correct details or retire an outdated entry.</span>
                  </button>
                </div>
                {amendmentMode === 'new' && (
                  <p className="bo-note">
                    Next, enter the new {typeLabel.toLowerCase()} details and explain why it should
                    be added.
                  </p>
                )}
              </section>
            )}
            {view === 'amendments' && amendmentStep === 1 && (
              <section className="bo-full bo-amendment-summary">
                <strong>
                  {amendmentMode === 'edit'
                    ? `Update ${typeLabel.toLowerCase()}: ${selectedMaster?.name ?? name}`
                    : `Add a new ${typeLabel.toLowerCase()}`}
                </strong>
                <p>
                  {amendmentMode === 'edit'
                    ? 'The existing catalogue entry stays unchanged until an administrator approves your request.'
                    : 'Your request will be reviewed before this entry appears in the catalogue.'}
                </p>
              </section>
            )}
            {(view === 'demand' ||
              (amendmentStep === 0 && amendmentMode === 'edit') ||
              (amendmentStep === 1 && type === 'CERTIFICATION')) && (
              <div className="bo-full bo-record-filters bo-choice-search">
                <div className="bo-filter-search-label">
                  <label htmlFor="bo-definition-search">
                    {view === 'demand'
                      ? 'Search approved definitions'
                      : amendmentStep === 1
                        ? 'Find an approved provider'
                        : `Find an existing ${typeLabel.toLowerCase()}`}
                  </label>
                  <div className="bo-search-field-wrap">
                    <Search size={15} className="bo-search-icon" aria-hidden="true" />
                    <input
                      id="bo-definition-search"
                      maxLength={100}
                      value={masterSearch}
                      onChange={e => setMasterSearch(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          setMasterTerm(masterSearch);
                          setMasterPage(1);
                        }
                      }}
                      placeholder={
                        view === 'demand'
                          ? 'Skill, credential or provider…'
                          : amendmentStep === 1
                            ? 'Search provider name…'
                            : `Search ${typeLabel.toLowerCase()} name…`
                      }
                    />
                    {masterSearch && (
                      <button
                        type="button"
                        className="bo-search-clear"
                        aria-label="Clear search"
                        onClick={() => {
                          setMasterSearch('');
                          setMasterTerm('');
                          setMasterPage(1);
                        }}
                      >
                        <X size={13} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="secondary-button bo-filter-action-btn"
                  onClick={() => {
                    setMasterTerm(masterSearch);
                    setMasterPage(1);
                  }}
                >
                  <Search size={14} aria-hidden="true" />
                  Search
                </button>
                {(view === 'demand' ||
                  masterPage > 1 ||
                  masterTotal > (masters?.pageSize ?? 20)) && (
                  <>
                    <button
                      type="button"
                      className="secondary-button bo-filter-action-btn"
                      disabled={masterPage <= 1}
                      onClick={() => setMasterPage(n => n - 1)}
                    >
                      <ChevronLeft size={14} aria-hidden="true" />
                      Previous results
                    </button>
                    <button
                      type="button"
                      className="secondary-button bo-filter-action-btn"
                      disabled={!masters || masterPage * masters.pageSize >= masterTotal}
                      onClick={() => setMasterPage(n => n + 1)}
                    >
                      Next results
                      <ChevronRight size={14} aria-hidden="true" />
                    </button>
                  </>
                )}
                <p className="bo-note">
                  {masters
                    ? `Page ${masters.page} · ${masterTotal} matching entries. ${view === 'demand' ? `${skills.length} skills and ${certs.length} credentials selected across pages.` : ''}`
                    : 'Loading choices…'}
                </p>
              </div>
            )}
            {view === 'amendments' && amendmentStep === 0 && amendmentMode === 'edit' && (
              <label className="bo-full">
                Existing {typeLabel.toLowerCase()} <span className="bo-required">*</span>
                <select
                  value={target}
                  onChange={e => selectMaster(e.target.value)}
                  disabled={!masters}
                >
                  <option value="">Choose an entry to update</option>
                  {target && !choices?.some(c => c.id === target) && (
                    <option value={target}>{selectedMaster?.name ?? name}</option>
                  )}
                  {choices?.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.active === false ? ' (retired)' : ''}
                    </option>
                  ))}
                </select>
                {masters && !choices?.length && (
                  <span className="bo-note">
                    No matching entries. Try another search or choose Add a new entry.
                  </span>
                )}
              </label>
            )}
            {(view === 'demand' || amendmentStep === 1) && (
              <>
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
                  <fieldset className="bo-panel">
                    <legend>Related catalogue skills</legend>
                    <p className="bo-note">
                      Suggest these skills when this credential is selected. Employees confirm each
                      skill and its proficiency. Use the catalogue search above for more skills.
                    </p>
                    <span>{relatedSkillIds.length}/20 selected</span>
                    <div className="bo-mapping-options">
                      {(masters?.skills ?? [])
                        .filter(skill => skill.active !== false)
                        .map(skill => (
                          <label key={skill.id}>
                            <input
                              type="checkbox"
                              checked={relatedSkillIds.includes(skill.id.toLowerCase())}
                              disabled={
                                busy ||
                                (!relatedSkillIds.includes(skill.id.toLowerCase()) &&
                                  relatedSkillIds.length >= 20)
                              }
                              onChange={e =>
                                setRelatedSkillIds(previous =>
                                  e.target.checked
                                    ? [...previous, skill.id.toLowerCase()]
                                    : previous.filter(id => id !== skill.id.toLowerCase()),
                                )
                              }
                            />
                            {skill.name}
                          </label>
                        ))}
                    </div>
                  </fieldset>
                )}
                {view === 'amendments' && type === 'CERTIFICATION' && (
                  <label>
                    Provider <span className="bo-required">*</span>
                    <select
                      required
                      value={provider}
                      onChange={e => {
                        setProvider(e.target.value);
                        setProviderName(
                          masters?.providers.find(p => p.id === e.target.value)?.name ?? '',
                        );
                      }}
                    >
                      <option value="">Choose approved provider</option>
                      {provider && !masters?.providers.some(p => p.id === provider) && (
                        <option value={provider}>
                          {providerName || 'Previously selected provider'}
                        </option>
                      )}
                      {masters?.providers
                        .filter(p => p.active !== false)
                        .map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                    <span className="bo-note">
                      Use the provider search above if it is not listed. If the provider is missing
                      from the catalogue, request that provider first.
                    </span>
                  </label>
                )}
                <label className="bo-full">
                  Description{' '}
                  {view === 'amendments' && type === 'SKILL' && (
                    <span className="bo-required">*</span>
                  )}
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
                      Keep this entry available in the catalogue
                    </label>
                    {type === 'SKILL' &&
                      ['Foundation', 'Autonomous', 'Experienced', 'Expert'].map((label, i) => (
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
                      ))}
                    <label className="bo-full">
                      Why is this change needed? <span className="bo-required">*</span>
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
                              {[1, 2, 3, 4].map(n => (
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
              disabled={
                busy ||
                (decision.operation !== 'SHORTLIST' &&
                  (!requestDetail ||
                    (decision.operation === 'APPROVE_AMENDMENT' &&
                      requestDetail.targetChanged === true)))
              }
            >
              Preview decision
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          }
        >
          {decision.operation !== 'SHORTLIST' &&
            (() => {
              const request = list?.rows.find(row => row.id === decision.payload.id) as
                Amendment | undefined;
              return request ? (
                <section className="bo-amendment-summary">
                  <strong>
                    {request.type === 'SKILL'
                      ? 'Skill'
                      : request.type === 'PROVIDER'
                        ? 'Provider'
                        : 'Certification'}{' '}
                    request
                  </strong>
                  <p>Requested by {request.employee}</p>
                  <p>Reason: {request.reason}</p>
                  {requestDetail ? (
                    <AmendmentComparison
                      request={requestDetail}
                      masters={masters}
                      context={context}
                    />
                  ) : (
                    <p>{requestError || 'Loading current catalogue details…'}</p>
                  )}
                </section>
              ) : null;
            })()}
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
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setPreview(undefined)}
              >
                Back
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => void submit()}
              >
                <Check size={14} aria-hidden="true" />
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
          {preview.command.operation === 'PROPOSE' && (
            <section className="bo-amendment-summary">
              <strong>
                {preview.command.payload.targetId
                  ? 'Request to update an existing entry'
                  : 'Request to add a new entry'}
              </strong>
              <p>
                Submitting sends this request to System Admin. The catalogue changes only after
                approval.
              </p>
              {type === 'CERTIFICATION' && providerName && <p>Provider: {providerName}</p>}
              {selectedMaster && (
                <details>
                  <summary>Current catalogue details</summary>
                  <p>
                    <strong>{selectedMaster.name}</strong>
                  </p>
                  {selectedMaster.category && <p>Category: {selectedMaster.category}</p>}
                  {selectedMaster.description && <p>{selectedMaster.description}</p>}
                  <p>{selectedMaster.active === false ? 'Retired' : 'Active'}</p>
                </details>
              )}
            </section>
          )}
          {['APPROVE_AMENDMENT', 'REJECT_AMENDMENT'].includes(preview.command.operation) ? (
            <AmendmentComparison
              request={preview.details as unknown as Amendment}
              masters={masters}
              context={context}
            />
          ) : (
            <DefinitionPreview details={preview.details} masters={masters} context={context} />
          )}
          {error && (
            <p role="alert" className="bo-error">
              {error}
            </p>
          )}
        </FormDialog>
      )}
      {view === 'amendments' && params.get('request') && !decision && !preview && !composing && (
        <FormDialog
          title="Catalogue request details"
          onClose={closeRequest}
          footer={
            <button type="button" className="secondary-button" onClick={closeRequest}>
              Close
            </button>
          }
        >
          {!requestDetail ? (
            <p role={requestError ? 'alert' : undefined}>{requestError || 'Loading request…'}</p>
          ) : (
            <>
              <p>
                <strong>
                  {requestDetail.status === 'SUBMITTED'
                    ? 'Awaiting admin review'
                    : requestDetail.status === 'APPROVED'
                      ? 'Approved — catalogue updated'
                      : 'Not approved — catalogue unchanged'}
                </strong>
              </p>
              <p>
                <strong>Reason:</strong> {requestDetail.reason}
              </p>
              {requestDetail.decisionNote && (
                <p>
                  <strong>Admin feedback:</strong> {requestDetail.decisionNote}
                </p>
              )}
              {requestDetail.createdAt && (
                <p>Submitted: {new Date(requestDetail.createdAt).toLocaleString()}</p>
              )}
              {requestDetail.decidedAt && (
                <p>Decision: {new Date(requestDetail.decidedAt).toLocaleString()}</p>
              )}
              <AmendmentComparison request={requestDetail} masters={masters} context={context} />
            </>
          )}
        </FormDialog>
      )}
    </section>
  );
}

function AmendmentComparison({
  request,
  masters,
  context,
}: {
  request: Amendment;
  masters?: Masters;
  context: BusinessContext;
}) {
  return (
    <>
      {request.targetChanged && request.status === 'SUBMITTED' && (
        <p role="alert" className="bo-error">
          The catalogue entry changed after this request. Approval is blocked. Reject with feedback
          and ask for a fresh request.
        </p>
      )}
      <div className="bo-amendment-comparison">
        {!request.isNew && (
          <section>
            <h3>Current catalogue entry</h3>
            {request.currentDefinition ? (
              <DefinitionPreview
                details={request.currentDefinition}
                masters={masters}
                context={context}
              />
            ) : (
              <p>This entry is no longer available.</p>
            )}
          </section>
        )}
        <section>
          <h3>{request.isNew ? 'Requested new entry' : 'Requested changes'}</h3>
          <DefinitionPreview details={request.definition} masters={masters} context={context} />
        </section>
      </div>
    </>
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
  const mappings = d.relatedSkillIds as string[] | undefined;
  return (
    <div className="bo-page bo-review">
      <h3>{String(d.name ?? d.title ?? 'Reviewed decision')}</h3>
      <dl>
        {mappings && (
          <>
            <dt>Related skills</dt>
            <dd>
              {mappings.length
                ? mappings
                    .map(
                      id =>
                        masters?.skills.find(skill => skill.id.toLowerCase() === id.toLowerCase())
                          ?.name ?? 'Catalogue skill (rechecked before approval)',
                    )
                    .join(', ')
                : 'No default skill suggestions'}
            </dd>
          </>
        )}
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
              {String(
                d.provider ??
                  masters?.providers.find(p => p.id === d.providerId)?.name ??
                  'Selected provider (rechecked before save)',
              )}
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
