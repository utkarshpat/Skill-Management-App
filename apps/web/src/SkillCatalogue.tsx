import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, BookOpen } from 'lucide-react';
import { authenticatedFetch } from './auth';
import { FormDialog } from './FormDialog';
import { CommonProficiency } from './CommonProficiency';
import {
  CatalogueCertificationPicker,
  type CatalogueCertification,
} from './CatalogueCertificationPicker';
import './catalogue.css';
import { commonLevels } from './proficiency';
import { useSearchParams } from 'react-router';
import { readApiResponse } from './api-response';
import { BusinessWorkflows } from './business/BusinessWorkflows';
import type { BusinessContext } from './business/business-model';
import './business/business.css';

export function SkillCatalogue({
  actionsContainer,
  onChanged,
  amendmentsAllowed = false,
}: {
  actionsContainer: HTMLElement | null;
  onChanged?: () => void;
  amendmentsAllowed?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const amendments =
    amendmentsAllowed && ['amendments', 'certifications'].includes(params.get('tab') ?? '');
  const certifications = params.get('tab') === 'certifications';
  return (
    <>
      {amendmentsAllowed && (
        <nav className="bo-tabs" aria-label="Catalogue sections">
          <button
            aria-current={!amendments ? 'page' : undefined}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete('tab');
              next.delete('draftTicket');
              setParams(next);
            }}
          >
            Skills
          </button>
          <button
            aria-current={certifications ? 'page' : undefined}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('tab', 'certifications');
              next.delete('request');
              setParams(next);
            }}
          >
            Certifications
          </button>
          <button
            aria-current={amendments && !certifications ? 'page' : undefined}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('tab', 'amendments');
              setParams(next);
            }}
          >
            Amendments
          </button>
        </nav>
      )}
      {amendments ? (
        <CatalogueAmendments
          key={certifications ? 'certifications' : 'amendments'}
          certifications={certifications}
        />
      ) : (
        <SkillDefinitions
          actionsContainer={actionsContainer}
          onChanged={onChanged}
          certificationsAllowed={amendmentsAllowed}
        />
      )}
    </>
  );
}

function CatalogueAmendments({ certifications }: { certifications: boolean }) {
  const [context, setContext] = useState<BusinessContext>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setError('');
    setContext(undefined);
    authenticatedFetch('/api/business/context', { signal: abort.signal })
      .then(response =>
        readApiResponse<BusinessContext>(response, 'Catalogue amendments are unavailable.'),
      )
      .then(current => {
        if (abort.signal.aborted) return;
        if (!current.canAmend && !current.canApprove)
          throw Error('Catalogue amendment access is not assigned.');
        setContext(current);
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [attempt]);
  if (error)
    return (
      <div role="alert" className="access-message">
        {error}
        <button className="secondary-button" onClick={() => setAttempt(v => v + 1)}>
          Retry
        </button>
      </div>
    );
  if (!context) return <p role="status">Loading catalogue amendments…</p>;
  return (
    <div className="bo-page">
      <BusinessWorkflows context={context} view="amendments" catalogueMode={certifications} />
    </div>
  );
}

interface Level {
  rank: number;
  name: string;
  description: string;
}
interface Skill {
  relatedCertifications?: CatalogueCertification[];
  businessCode?: string | null;
  definitionRevision?: number;
  id?: string;
  name: string;
  category: string;
  description: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  levels: Level[];
}
interface State {
  revision: number;
  canManage: boolean;
  total: number;
  page: number;
  pageSize: number;
  skills: Skill[];
}
const blank = (): Skill => ({
  name: '',
  category: '',
  description: '',
  status: 'DRAFT',
  levels: commonLevels(),
  relatedCertifications: [],
});
async function responseBody(response: Response) {
  const body = await response.json().catch(() => undefined);
  if (!response.ok)
    throw new Error(
      body?.error?.message ??
        (response.status === 403
          ? 'Skill catalogue permission is not assigned.'
          : response.status === 401
            ? 'Sign in to view the catalogue.'
            : 'The catalogue could not be loaded. Please try again.'),
    );
  return body as State;
}
function SkillDefinitions({
  actionsContainer,
  onChanged,
  certificationsAllowed,
}: {
  actionsContainer: HTMLElement | null;
  onChanged?: () => void;
  certificationsAllowed: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const [certificationAccess, setCertificationAccess] = useState<BusinessContext>();
  useEffect(() => {
    if (!certificationsAllowed) return;
    const abort = new AbortController();
    authenticatedFetch('/api/business/context', { signal: abort.signal })
      .then(r => readApiResponse<BusinessContext>(r, 'Catalogue actions are unavailable.'))
      .then(c => {
        if (!abort.signal.aborted) setCertificationAccess(c);
      })
      .catch(() => {
        if (!abort.signal.aborted) setCertificationAccess(undefined);
      });
    return () => abort.abort();
  }, [certificationsAllowed]);

  const [state, setState] = useState<State>(),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<Skill>(),
    [draftRevision, setDraftRevision] = useState(0),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const [editorPage, setEditorPage] = useState(0);
  const query = () => new URLSearchParams({ search, status, page: String(page) }).toString();
  const requestedSearch = useRef(search);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = setTimeout(
      () => {
        requestedSearch.current = search;
        authenticatedFetch(
          '/api/skills?' + new URLSearchParams({ search, status, page: String(page) }),
          { signal: controller.signal },
        )
          .then(responseBody)
          .then(body => {
            if (!controller.signal.aborted) setState(body);
          })
          .catch(err => {
            if (!controller.signal.aborted) setError(err.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      search === requestedSearch.current ? 0 : 200,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, status, page, attempt]);
  function create() {
    if (!state?.canManage) return;
    setEditorPage(0);
    setError('');
    setDraft(blank());
    setDraftRevision(state.revision);
    setNotice('');
    requestAnimationFrame(() => nameInput.current?.focus());
  }
  function choose(skill: Skill) {
    setEditorPage(0);
    setDraft({
      ...structuredClone(skill),
      ...(state?.canManage ? { levels: commonLevels() } : {}),
    });
    setDraftRevision(state!.revision);
    setError('');
    setNotice('');
  }
  async function save(nextStatus: Skill['status'] = draft?.status ?? 'DRAFT') {
    if (!draft || !state?.canManage || busy) return;
    if (!draft.name.trim() || !draft.category.trim()) {
      setError('Enter a skill name and category.');
      if (!draft.name.trim()) nameInput.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    let saved = false;
    try {
      await responseBody(
        await authenticatedFetch('/api/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...draft,
            status: nextStatus,
            levels: commonLevels(),
            relatedCertificationIds: (draft.relatedCertifications ?? []).map(c => c.id),
            revision: draftRevision,
          }),
        }),
      );
      saved = true;
      setDraft(undefined);
      setNotice('Skill saved.');
      onChanged?.();
      const fresh = await responseBody(await authenticatedFetch('/api/skills?' + query()));
      setState(fresh);
    } catch (err) {
      setError(
        (saved ? 'The skill was saved, but refreshing failed. ' : '') +
          (err instanceof Error ? err.message : 'The skill could not be saved.'),
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (params.get('add') !== 'skill' || !state || loading) return;
    if (state.canManage) create();
    const next = new URLSearchParams(params);
    next.delete('add');
    setParams(next, { replace: true });
  }, [params, state, loading, setParams]);
  const actions = (
    <>
      {state?.canManage && (
        <button className="admin-primary" disabled={busy || loading} onClick={create}>
          <Plus size={17} />
          Add skill
        </button>
      )}
      {(certificationAccess?.canApprove || certificationAccess?.canAmend) && (
        <button
          className="secondary-button"
          onClick={() => {
            const next = new URLSearchParams(params);
            next.set('tab', 'certifications');
            next.set('add', 'certification');
            setParams(next);
          }}
        >
          {certificationAccess?.canApprove ? 'Add certification' : 'Request certification'}
        </button>
      )}
    </>
  );
  return (
    <>
      {actionsContainer ? createPortal(actions, actionsContainer) : actions}
      {error && (
        <div className="access-message" role="alert">
          {error}
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => setAttempt(value => value + 1)}
          >
            Reload catalogue
          </button>
        </div>
      )}
      {notice && (
        <p className="access-message" role="status">
          {notice}
        </p>
      )}
      <div className="catalogue-layout">
        <section className="profile-panel catalogue-list" aria-label="Skill catalogue">
          <div className="catalogue-filters">
            <label className="list-search">
              <Search size={16} aria-hidden="true" />
              <input
                disabled={busy}
                aria-label="Search skills"
                placeholder="Skill or category…"
                maxLength={100}
                value={search}
                onChange={event => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            {state?.canManage && (
              <label className="department-filter">
                Status
                <select
                  disabled={busy}
                  value={status}
                  onChange={event => {
                    setStatus(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All skills</option>
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </label>
            )}
          </div>
          {loading && <p role="status">Loading skills…</p>}
          {!loading && state && !state.skills.length && (
            <div className="catalogue-empty">
              <BookOpen size={26} aria-hidden="true" />
              <h2>
                {search || status
                  ? 'No matching skills'
                  : state.canManage
                    ? 'Your catalogue is ready'
                    : 'No published skills yet'}
              </h2>
              <p>
                {search || status
                  ? 'Try another search or filter.'
                  : state.canManage
                    ? 'Create a skill and define its proficiency levels.'
                    : 'Published skills will appear here.'}
              </p>
            </div>
          )}
          {!!state?.skills.length && (
            <div className="audit-scroll">
              <table className="catalogue-table">
                <thead>
                  <tr>
                    <th scope="col">Skill</th>
                    <th scope="col">Category</th>
                    <th scope="col">Levels</th>
                    {state.canManage && <th scope="col">Status</th>}
                  </tr>
                </thead>
                <tbody>
                  {state.skills.map(skill => (
                    <tr key={skill.id} className={draft?.id === skill.id ? 'selected' : ''}>
                      <th scope="row">
                        <button
                          className="catalogue-open"
                          disabled={busy || loading}
                          aria-pressed={draft?.id === skill.id}
                          onClick={() => choose(skill)}
                        >
                          {skill.name}
                        </button>
                        {skill.businessCode && (
                          <small className="access-help">{skill.businessCode}</small>
                        )}
                      </th>
                      <td>{skill.category}</td>
                      <td>{skill.levels.length}</td>
                      {state.canManage && (
                        <td>
                          <span className={'skill-status ' + skill.status.toLowerCase()}>
                            {skill.status[0] + skill.status.slice(1).toLowerCase()}
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {state && state.total > 0 && (
            <div className="catalogue-pagination">
              <span>
                {state.total} skills · Page {state.page} of{' '}
                {Math.ceil(state.total / state.pageSize)}
              </span>
              <button
                className="secondary-button"
                disabled={busy || loading || page <= 1}
                onClick={() => setPage(value => value - 1)}
              >
                Previous
              </button>
              <button
                className="secondary-button"
                disabled={busy || loading || page * state.pageSize >= state.total}
                onClick={() => setPage(value => value + 1)}
              >
                Next
              </button>
            </div>
          )}
        </section>
        {draft && (
          <FormDialog
            readOnly={!state?.canManage}
            title={
              state?.canManage
                ? draft.id
                  ? 'Edit catalogue skill'
                  : 'Add catalogue skill'
                : draft.name
            }
            className="catalogue-editor"
            subtitle={
              state?.canManage
                ? 'Define the skill once. Employees claim their own proficiency and supporting certifications separately.'
                : undefined
            }
            busy={busy}
            onClose={() => setDraft(undefined)}
            formId={state?.canManage ? 'skill-editor' : undefined}
            onSubmit={() => void save('PUBLISHED')}
            page={editorPage}
            onPageChange={setEditorPage}
            message={error && <p role="alert">{error}</p>}
            footer={
              state?.canManage ? (
                <>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => setDraft(undefined)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || loading}
                    onClick={() => void save('DRAFT')}
                  >
                    Save draft
                  </button>
                  {draft.id && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || loading}
                      onClick={() => void save('ARCHIVED')}
                    >
                      Archive skill
                    </button>
                  )}
                  <button
                    type="submit"
                    form="skill-editor"
                    className="primary-button"
                    disabled={busy || loading}
                  >
                    {busy ? 'Saving…' : 'Publish skill'}
                  </button>
                </>
              ) : undefined
            }
            pages={
              state?.canManage
                ? [
                    {
                      label: 'Skill details',
                      content: (
                        <>
                          <div className="dialog-field-grid">
                            <label>
                              Skill name
                              <input
                                ref={nameInput}
                                required
                                maxLength={100}
                                placeholder="e.g. Oracle HCM"
                                value={draft.name}
                                onChange={event => setDraft({ ...draft, name: event.target.value })}
                              />
                            </label>
                            <label>
                              Category
                              <input
                                required
                                maxLength={80}
                                list="skill-categories"
                                placeholder="e.g. Enterprise applications"
                                value={draft.category}
                                onChange={event =>
                                  setDraft({ ...draft, category: event.target.value })
                                }
                              />
                              <datalist id="skill-categories">
                                {[...new Set(state.skills.map(skill => skill.category))].map(
                                  category => (
                                    <option key={category} value={category} />
                                  ),
                                )}
                              </datalist>
                            </label>
                          </div>
                          {draft.businessCode && (
                            <p className="access-help">
                              {draft.businessCode} · Definition revision {draft.definitionRevision}
                            </p>
                          )}
                          <label>
                            Description - Optional
                            <textarea
                              maxLength={2000}
                              rows={3}
                              placeholder="e.g. Configure Oracle HCM employee records and core HR workflows."
                              value={draft.description}
                              onChange={event =>
                                setDraft({ ...draft, description: event.target.value })
                              }
                            />
                          </label>
                          <CatalogueCertificationPicker
                            value={draft.relatedCertifications ?? []}
                            disabled={busy}
                            onChange={relatedCertifications =>
                              setDraft({ ...draft, relatedCertifications })
                            }
                          />
                          {draft.id && (
                            <p className="access-help">
                              Saving uses the common four-level criteria. Previous employee claims
                              and historical versions keep their saved criteria.
                            </p>
                          )}
                          <details className="catalogue-framework-reference">
                            <summary>View the common proficiency criteria</summary>
                            <CommonProficiency />
                          </details>
                        </>
                      ),
                    },
                  ]
                : [
                    {
                      label: 'Description',
                      content: (
                        <>
                          <p className="skill-category">{draft.category}</p>
                          <p>{draft.description}</p>
                        </>
                      ),
                    },
                    ...draft.levels.map(level => ({
                      label: 'Level ' + level.rank,
                      content: (
                        <>
                          <h3>{level.name}</h3>
                          <p>{level.description}</p>
                        </>
                      ),
                    })),
                  ]
            }
          />
        )}
      </div>
    </>
  );
}
