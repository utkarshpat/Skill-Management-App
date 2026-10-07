import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, BookOpen } from 'lucide-react';
import { authenticatedFetch } from './auth';
import { FormDialog } from './FormDialog';
import { ProficiencyEditor } from './ProficiencyEditor';
import { isStandardFramework, standardLevels } from './proficiency';

interface Level {
  rank: number;
  name: string;
  description: string;
}
interface Skill {
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
  levels: standardLevels(),
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
export function SkillCatalogue({
  actionsContainer,
  onChanged,
}: {
  actionsContainer: HTMLElement | null;
  onChanged?: () => void;
}) {
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
  const [editorPage, setEditorPage] = useState(0),
    [levelIndex, setLevelIndex] = useState(0);
  const query = () => new URLSearchParams({ search, status, page: String(page) }).toString();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
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
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, status, page, attempt]);
  function create() {
    if (!state?.canManage) return;
    setEditorPage(0);
    setLevelIndex(0);
    setError('');
    setDraft(blank());
    setDraftRevision(state.revision);
    setNotice('');
    requestAnimationFrame(() => nameInput.current?.focus());
  }
  function choose(skill: Skill) {
    setEditorPage(0);
    setLevelIndex(0);
    setDraft(structuredClone(skill));
    setDraftRevision(state!.revision);
    setError('');
    setNotice('');
  }
  function levels(next: Level[]) {
    if (draft)
      setDraft({ ...draft, levels: next.map((level, index) => ({ ...level, rank: index + 1 })) });
  }
  async function save() {
    if (!draft || !state?.canManage || busy) return;
    if (!isStandardFramework(draft.levels)) {
      setEditorPage(1);
      setError('Align this definition to the five-level proficiency model before saving.');
      return;
    }
    const invalid = draft.levels.findIndex(
      level => !level.name.trim() || (draft.status === 'PUBLISHED' && !level.description.trim()),
    );
    if (invalid >= 0) {
      setEditorPage(1);
      setLevelIndex(invalid);
      setError('Enter skill-specific criteria for every proficiency level before publishing.');
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
          body: JSON.stringify({ ...draft, revision: draftRevision }),
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
  const actions = state?.canManage ? (
    <button className="admin-primary" disabled={busy || loading} onClick={create}>
      <Plus size={17} />
      New skill
    </button>
  ) : null;
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
            title={state?.canManage ? (draft.id ? 'Edit skill' : 'Create skill') : draft.name}
            busy={busy}
            onClose={() => setDraft(undefined)}
            formId={state?.canManage ? 'skill-editor' : undefined}
            onSubmit={() => void save()}
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
                    type="submit"
                    form="skill-editor"
                    className="microsoft-button"
                    disabled={busy || loading}
                  >
                    {busy ? 'Saving…' : 'Save skill'}
                  </button>
                </>
              ) : undefined
            }
            pages={
              state?.canManage
                ? [
                    {
                      label: 'Details',
                      content: (
                        <>
                          <div className="dialog-field-grid">
                            <label>
                              Skill name
                              <input
                                ref={nameInput}
                                required
                                maxLength={100}
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
                            Description
                            <textarea
                              required={draft.status === 'PUBLISHED'}
                              maxLength={2000}
                              rows={3}
                              value={draft.description}
                              onChange={event =>
                                setDraft({ ...draft, description: event.target.value })
                              }
                            />
                          </label>
                          <label>
                            Status
                            <select
                              value={draft.status}
                              onChange={event =>
                                setDraft({
                                  ...draft,
                                  status: event.target.value as Skill['status'],
                                })
                              }
                            >
                              <option value="DRAFT">Draft</option>
                              <option value="PUBLISHED">Published</option>
                              <option value="ARCHIVED">Archived</option>
                            </select>
                          </label>
                        </>
                      ),
                    },
                    {
                      label: 'Proficiency levels',
                      content: (
                        <ProficiencyEditor
                          levels={draft.levels}
                          original={state.skills.find(skill => skill.id === draft.id)?.levels}
                          selected={levelIndex}
                          onSelect={setLevelIndex}
                          onChange={levels}
                          published={draft.status === 'PUBLISHED'}
                        />
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
