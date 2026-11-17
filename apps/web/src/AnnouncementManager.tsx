import {
  ancestorSelected,
  orderAudienceScopes,
  sameScope,
  selectAudienceScope,
} from './announcement-audience';
import {
  readLocalAnnouncement,
  writeLocalAnnouncement,
  removeLocalAnnouncement,
  type LocalAnnouncementDraft,
} from './announcement-local-draft';
import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';
import { FormDialog } from './FormDialog';
import {
  announcementStyle,
  AnnouncementBannerContent,
  AnnouncementCard,
  AnnouncementForm,
  PollOptions,
} from './AnnouncementContent';
import {
  endpoint,
  exportColumns,
  fields,
  type AnswerField,
  type Draft,
  type JournalEntry,
  type Management,
  type Definition,
  type Version,
} from './announcement-model';

const empty: Definition = {
  kind: 'FORM',
  useCase: 'EVENT',
  designViewport: 'both',
  title: '',
  message: '',
  cta: 'Register',
  fields: [],
  options: ['', ''],
  exports: [],
  audience: [],
  versions: [],
  popup: true,
  marquee: false,
  imageAlt: '',
  imagePosition: 'center',
};
const scopeLabels: Record<string, string> = {
  DELIVERY_UNIT: 'Delivery Unit',
  PORTFOLIO: 'Portfolio',
  DEPARTMENT: 'Account / Client',
  PROJECT: 'Business project',
  ORGANIZATION: 'Workspace access · choose an audience',
};
const localDate = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const sample = { name: 'Preview Employee', email: 'employee@example.com', employeeId: '000001' };
async function api<T>(url: string, data?: object) {
  return readApiResponse<T>(
    await authenticatedFetch(
      endpoint + url,
      data
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          }
        : undefined,
    ),
    'The announcement action could not be completed.',
  );
}

export function AnnouncementManager({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Management>();
  const [draft, setDraft] = useState<Draft>();
  const [definition, setDefinition] = useState<Definition>(empty);
  const [grantId, setGrantId] = useState('');
  const [start, setStart] = useState(() => localDate(new Date()));
  const [end, setEnd] = useState(() => localDate(new Date(Date.now() + 86_400_000)));
  const [page, setPage] = useState<'list' | 'edit' | 'preview'>('list');
  const [mobile, setMobile] = useState(false);
  const [image, setImage] = useState<{ base64: string; url: string }>();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [audienceCount, setAudienceCount] = useState<number>();
  const [previewImage, setPreviewImage] = useState<string>();
  const [receipt, setReceipt] = useState<{ id: string; token: string }>();
  const [previewForm, setPreviewForm] = useState(false);
  const [previewView, setPreviewView] = useState<'banner' | 'popup' | 'form'>('banner');
  const [responses, setResponses] = useState<{
    id: string;
    definition: Definition;
    responses: {
      name: string;
      email?: string;
      employeeId: string;
      answers: Record<string, string | boolean>;
    }[];
  }>();
  const [confirmClose, setConfirmClose] = useState<string>();

  const [localDraft, setLocalDraft] = useState<LocalAnnouncementDraft>();
  const [localStatus, setLocalStatus] = useState('');
  const localSnapshot = useRef<{ actor: string; value: LocalAnnouncementDraft } | undefined>(
    undefined,
  );
  const actor = data?.actorId;
  useEffect(() => {
    if (actor) setLocalDraft(readLocalAnnouncement(actor));
  }, [actor]);
  useEffect(() => {
    if (!actor || page === 'list' || !grantId) return;
    const value: LocalAnnouncementDraft = {
      schema: 1,
      grantId,
      draftId: draft?.id,
      revision: draft?.revision ?? 0,
      definition: { ...definition, image: undefined },
      start,
      end,
      image: image?.base64,
      prompt,
      savedAt: Date.now(),
    };
    localSnapshot.current = { actor, value };
    const persist = () => {
      const saved = writeLocalAnnouncement(actor, value);
      setLocalStatus(
        saved
          ? 'Draft saved on this device.'
          : 'Local draft storage is unavailable. Use Save draft.',
      );
      if (saved) setLocalDraft(value);
    };
    const timer = setTimeout(persist, 250);
    return () => {
      clearTimeout(timer);
      if (localSnapshot.current?.value === value) writeLocalAnnouncement(actor, value);
    };
  }, [actor, page, grantId, draft?.id, draft?.revision, definition, start, end, image, prompt]);
  useEffect(() => {
    const persist = () => {
      const snapshot = localSnapshot.current;
      if (snapshot) writeLocalAnnouncement(snapshot.actor, snapshot.value);
    };
    window.addEventListener('pagehide', persist);
    return () => {
      window.removeEventListener('pagehide', persist);
      persist();
    };
  }, []);
  function clearLocal() {
    localSnapshot.current = undefined;
    if (actor) removeLocalAnnouncement(actor);
    setLocalDraft(undefined);
    setLocalStatus('');
  }
  function resumeLocal() {
    if (!localDraft || !data?.grants.some(grant => grant.id === localDraft.grantId)) {
      setError('The saved publishing scope is unavailable.');
      return;
    }
    const existing = data.items.find(entry => entry.id === localDraft.draftId);
    if (localDraft.draftId && (!existing || existing.state !== 'DRAFT')) {
      setError('The saved announcement is already published, closed or unavailable.');
      return;
    }
    setDraft(
      localDraft.draftId
        ? {
            id: localDraft.draftId,
            revision: localDraft.revision,
            state: 'DRAFT',
            grantId: localDraft.grantId,
            startsAt: existing!.startsAt,
            endsAt: existing!.endsAt,
            definition: localDraft.definition,
          }
        : undefined,
    );
    setGrantId(localDraft.grantId);
    setDefinition(localDraft.definition);
    setStart(localDraft.start);
    setEnd(localDraft.end);
    setPrompt(localDraft.prompt);
    setImage(
      localDraft.image
        ? { base64: localDraft.image, url: 'data:image/webp;base64,' + localDraft.image }
        : undefined,
    );
    setReceipt(undefined);
    setError('');
    setPage('edit');
  }
  const refresh = () => api<Management>('/manage').then(setData);
  useEffect(() => {
    let active = true;
    api<Management>('/manage')
      .then(value => {
        if (active) setData(value);
      })
      .catch(error => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const work = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      await operation();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const update = (changes: Partial<Definition>) =>
    setDefinition(previous => ({ ...previous, ...changes }));
  const selectVersion = (version?: Version) =>
    update({
      selectedVersion: version?.id,
      design: version?.design,
    });
  const columns = orderAudienceScopes(
    data?.scopes.filter(scope => scope.grantId === grantId) ?? [],
  );
  const configure = (entry?: Draft, copy = false) => {
    const grant = entry?.grantId ?? data?.grants[0]?.id ?? '';
    setGrantId(grant);
    setDraft(copy ? undefined : entry);
    const own = data?.grants.find(entry => entry.id === grant);
    const root = data?.scopes.find(
      scope => scope.grantId === grant && scope.id === own?.scopeId && scope.kind === own.kind,
    );
    setDefinition(
      entry?.definition ?? { ...empty, audience: root ? [{ kind: root.kind, id: root.id }] : [] },
    );
    setStart(entry && !copy ? localDate(new Date(entry.startsAt)) : localDate(new Date()));
    setEnd(
      entry && !copy
        ? localDate(new Date(entry.endsAt))
        : localDate(new Date(Date.now() + 86_400_000)),
    );
    setImage(
      entry?.definition.image
        ? {
            base64: entry.definition.image,
            url: 'data:image/webp;base64,' + entry.definition.image,
          }
        : undefined,
    );
    setPrompt('');
    setReceipt(undefined);
    setLocalStatus('');
    setPage('edit');
  };
  const payload = () => ({
    id: draft?.id,
    revision: draft?.revision ?? 0,
    grantId,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    definition: { ...definition, image: undefined },
    image: image?.base64,
  });
  const save = (mode: 'draft' | 'publish' | 'preview') =>
    work(async () => {
      if (mode === 'preview') {
        const value = await api<{
          id: string;
          audienceCount: number;
          image?: string;
          receipt: string;
        }>('/draft', {
          ...payload(),
          preview: true,
        });
        setAudienceCount(value.audienceCount);
        setPreviewImage(value.image ? 'data:image/webp;base64,' + value.image : undefined);
        setReceipt({ id: value.id, token: value.receipt });
        setPreviewForm(false);
        setPreviewView('banner');
        setPage('preview');
        return;
      }
      const saved = await api<{ id: string; revision: number; state: Draft['state'] }>('/draft', {
        ...payload(),
        publish: mode === 'publish',
        ...(mode === 'publish' && { id: receipt?.id, receipt: receipt?.token }),
      });
      if (mode === 'publish') {
        localSnapshot.current = undefined;
        setPage('list');
        await refresh();
        clearLocal();
        setNote('Announcement published for the selected schedule.');
      } else {
        setDraft({ ...payload(), ...saved });
        setNote('Draft saved.');
      }
    });
  const generate = () =>
    work(async () => {
      const version = await api<Version>('/design', {
        id: draft?.id,
        grantId,
        prompt,
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        viewport: { width: window.innerWidth, height: window.innerHeight, hasImage: !!image },
        definition: { ...definition, image: undefined },
      });
      update({
        versions: [...definition.versions.slice(-14), version],
        selectedVersion: version.id,
        design: version.design,
      });
      setPrompt('');
      setNote('Design generated. Preview it or continue refining.');
    });
  const exportResponses = (entry: Pick<JournalEntry, 'id'>) =>
    work(async () => {
      const response = await authenticatedFetch(endpoint + '/' + entry.id + '/export');
      if (!response.ok) await readApiResponse(response, 'Response export failed.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'announcement-responses.xlsx';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const viewResponses = (entry: Pick<JournalEntry, 'id'>) =>
    work(async () => {
      const result = await api<NonNullable<typeof responses>>('/' + entry.id + '/responses');
      setResponses({ ...result, id: entry.id });
    });
  const closeAnnouncement = (entry: JournalEntry) =>
    work(async () => {
      await api('/' + entry.id + '/close', { revision: entry.revision });
      setConfirmClose(undefined);
      await refresh();
      setNote('Announcement closed.');
    });
  const upload = async (file?: File) => {
    if (!file) return;
    await work(async () => {
      if (file.size > 650_000 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        throw Error('Choose a JPEG, PNG or WebP image up to 650 KB.');
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(Error('Image could not be read.'));
        reader.readAsDataURL(file);
      });
      setImage({ url, base64: url.split(',')[1] });
    });
  };
  const field = (key: string, changes: Partial<AnswerField>) =>
    update({
      fields: definition.fields.map(field => (field.id === key ? { ...field, ...changes } : field)),
    });

  return (
    <FormDialog
      title="Announcements"
      className="announcement-manager"
      onClose={onClose}
      busy={busy}
    >
      {page !== 'list' && localStatus && (
        <p className="announcement-draft-status" role="status">
          {localStatus}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {note && <p role="status">{note}</p>}
      {page === 'list' && (
        <>
          {!data && !error && <p role="status">Loading announcements…</p>}
          {data && !data.grants.length && <p>Publishing access is unavailable.</p>}
          {localDraft && (
            <section className="announcement-local-draft" aria-label="Local announcement draft">
              <strong>{localDraft.definition.title || 'Untitled announcement'}</strong>
              <p>Saved on this device · {new Date(localDraft.savedAt).toLocaleString()}</p>
              <button className="admin-primary" onClick={resumeLocal}>
                Resume local draft
              </button>
              <button className="secondary-button" onClick={clearLocal}>
                Discard local draft
              </button>
            </section>
          )}
          {Boolean(data?.grants.length) && (
            <button className="admin-primary" onClick={() => configure()}>
              New announcement
            </button>
          )}
          {data?.items.map(entry => (
            <article className="announcement-list-item" key={entry.id}>
              <div>
                <strong>{entry.title}</strong>
                <p>
                  {entry.state === 'DRAFT'
                    ? 'Draft'
                    : entry.state === 'CLOSED'
                      ? 'Closed'
                      : new Date(entry.endsAt) <= new Date()
                        ? 'Ended'
                        : new Date(entry.startsAt) > new Date()
                          ? 'Scheduled'
                          : 'Live'}{' '}
                  · {new Date(entry.startsAt).toLocaleString()} –{' '}
                  {new Date(entry.endsAt).toLocaleString()}
                </p>
              </div>
              {entry.state === 'DRAFT' ? (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void work(async () => configure(await api<Draft>('/' + entry.id + '/draft')))
                  }
                >
                  Edit draft
                </button>
              ) : data.canExport ? (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void exportResponses(entry)}
                >
                  Download responses
                </button>
              ) : null}
              {entry.state !== 'DRAFT' && (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void work(async () =>
                      configure(await api<Draft>('/' + entry.id + '/draft'), true),
                    )
                  }
                >
                  Copy to new draft
                </button>
              )}
              {entry.state !== 'DRAFT' && (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void viewResponses(entry)}
                >
                  View responses
                </button>
              )}
              {entry.state === 'PUBLISHED' &&
                (confirmClose === entry.id ? (
                  <>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void closeAnnouncement(entry)}
                    >
                      Confirm close
                    </button>
                    <button className="secondary-button" onClick={() => setConfirmClose(undefined)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => setConfirmClose(entry.id)}
                  >
                    Close announcement
                  </button>
                ))}
            </article>
          ))}
        </>
      )}
      {page === 'list' && responses && (
        <section className="announcement-responses" aria-label="Recent responses">
          <h3>{responses.definition.title} · Recent responses</h3>
          <div className="announcement-editor-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void viewResponses(responses)}
            >
              Refresh responses
            </button>
            {data?.canExport && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void exportResponses(responses)}
              >
                Download responses
              </button>
            )}
          </div>
          <button className="secondary-button" onClick={() => setResponses(undefined)}>
            Hide responses
          </button>
          {responses.responses.length === 0 ? (
            <p>No responses in your current scope.</p>
          ) : (
            <div className="my-skills-table-wrap">
              <table className="my-skills-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Employee ID</th>
                    <th>Work email</th>
                    {(responses.definition.kind === 'POLL'
                      ? [{ id: 'vote', label: 'Vote' }]
                      : responses.definition.fields
                    ).map(field => (
                      <th key={field.id}>{field.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {responses.responses.map(row => (
                    <tr key={row.employeeId}>
                      <td>{row.name}</td>
                      <td>{row.employeeId}</td>
                      <td>{row.email || '—'}</td>
                      {(responses.definition.kind === 'POLL'
                        ? [{ id: 'vote' }]
                        : responses.definition.fields
                      ).map(field => (
                        <td key={field.id}>
                          {row.answers[field.id] === true
                            ? 'Yes'
                            : row.answers[field.id] === false
                              ? 'No'
                              : row.answers[field.id]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {responses.responses.length === 100 && (
            <p>Showing the 100 most recent eligible responses.</p>
          )}
        </section>
      )}
      {page === 'edit' && (
        <div className="announcement-editor">
          <button
            className="secondary-button"
            onClick={() =>
              void work(async () => {
                await refresh();
                setPage('list');
              })
            }
          >
            Back to announcements
          </button>
          <fieldset disabled={busy}>
            <legend>Message and schedule</legend>
            <label>
              Title
              <input
                maxLength={120}
                value={definition.title}
                onChange={event => update({ title: event.target.value })}
              />
            </label>
            <label>
              Use case
              <select
                value={definition.useCase ?? 'EVENT'}
                onChange={event => update({ useCase: event.target.value as Definition['useCase'] })}
              >
                <option value="EVENT">Event registration</option>
                <option value="TRAINING">Training application</option>
                <option value="SESSION">Session registration</option>
                <option value="SURVEY">Survey</option>
                <option value="GENERAL">General announcement or poll</option>
              </select>
            </label>
            <label>
              Message
              <textarea
                maxLength={1000}
                value={definition.message}
                onChange={event => update({ message: event.target.value })}
              />
            </label>
            <div className="announcement-editor-grid">
              <label>
                Starts at
                <input
                  type="datetime-local"
                  value={start}
                  onChange={event => setStart(event.target.value)}
                />
              </label>
              <label>
                Ends at
                <input
                  type="datetime-local"
                  value={end}
                  onChange={event => setEnd(event.target.value)}
                />
              </label>
            </div>
            <p className="announcement-note">Times are shown in your browser’s time zone.</p>
            <label className="announcement-check">
              <input
                type="checkbox"
                checked={definition.popup}
                onChange={event => update({ popup: event.target.checked })}
              />{' '}
              Show a one-time popup
            </label>
            <label className="announcement-check">
              <input
                type="checkbox"
                checked={definition.marquee}
                onChange={event => update({ marquee: event.target.checked })}
              />{' '}
              Scroll the banner text
            </label>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Audience</legend>
            <label>
              Publishing scope
              <select
                disabled={!!draft}
                value={grantId}
                onChange={event => {
                  const selected = data?.grants.find(grant => grant.id === event.target.value);
                  const root = data?.scopes.find(
                    scope =>
                      scope.grantId === selected?.id &&
                      scope.id === selected.scopeId &&
                      scope.kind === selected.kind,
                  );
                  setGrantId(event.target.value);
                  update({ audience: root ? [{ id: root.id, kind: root.kind }] : [] });
                }}
              >
                {data?.grants.map(grant => (
                  <option value={grant.id} key={grant.id}>
                    {data.scopes.find(
                      scope => scope.id === grant.scopeId && scope.kind === grant.kind,
                    )?.label ?? scopeLabels[grant.kind]}
                  </option>
                ))}
              </select>
            </label>
            <p className="announcement-note">
              Selecting a parent includes every eligible employee in its covered scopes.
            </p>
            <div className="announcement-scopes">
              {columns.map(scope => {
                const included = ancestorSelected(scope, definition.audience, columns);
                return (
                  <label
                    className={'announcement-check scope-level-' + scope.kind.toLowerCase()}
                    key={scope.kind + scope.id}
                  >
                    <input
                      type="checkbox"
                      checked={
                        included || definition.audience.some(entry => sameScope(entry, scope))
                      }
                      disabled={included}
                      onChange={event =>
                        update({
                          audience: selectAudienceScope(
                            scope,
                            definition.audience,
                            columns,
                            event.target.checked,
                          ),
                        })
                      }
                    />
                    <span>
                      {scope.label}{' '}
                      <small>
                        {scopeLabels[scope.kind]}
                        {included ? ' · Included by parent scope' : ''}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Form or poll</legend>
            <label>
              Interaction
              <select
                value={definition.kind}
                onChange={event =>
                  update({ kind: event.target.value === 'POLL' ? 'POLL' : 'FORM' })
                }
              >
                <option value="FORM">Form</option>
                <option value="POLL">Quick poll</option>
              </select>
            </label>
            {definition.kind === 'FORM' ? (
              <>
                <label>
                  Button label
                  <input
                    value={definition.cta}
                    maxLength={45}
                    onChange={event => update({ cta: event.target.value })}
                  />
                </label>
                <p className="announcement-note">
                  Name, Work Email and Employee ID are prefilled from the signed-in profile.
                </p>
                {definition.fields.map((entry, index) => (
                  <div className="announcement-editor-grid announcement-field" key={entry.id}>
                    <label>
                      Field {index + 1} label
                      <input
                        maxLength={120}
                        value={entry.label}
                        onChange={event => field(entry.id, { label: event.target.value })}
                      />
                    </label>
                    <label>
                      Field type
                      <select
                        value={entry.type}
                        onChange={event =>
                          field(entry.id, { type: event.target.value as AnswerField['type'] })
                        }
                      >
                        {fields.map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {entry.type === 'choice' && (
                      <label>
                        Options (one per line)
                        <textarea
                          value={entry.options.join('\n')}
                          onChange={event =>
                            field(entry.id, { options: event.target.value.split('\n') })
                          }
                        />
                      </label>
                    )}
                    <label className="announcement-check">
                      <input
                        type="checkbox"
                        checked={entry.required}
                        onChange={event => field(entry.id, { required: event.target.checked })}
                      />{' '}
                      Required
                    </label>
                    <button
                      className="secondary-button"
                      onClick={() =>
                        update({ fields: definition.fields.filter(item => item.id !== entry.id) })
                      }
                    >
                      Remove field
                    </button>
                    {index > 0 && (
                      <button
                        className="secondary-button"
                        onClick={() => {
                          const next = [...definition.fields];
                          [next[index - 1], next[index]] = [next[index], next[index - 1]];
                          update({ fields: next });
                        }}
                      >
                        Move field up
                      </button>
                    )}
                  </div>
                ))}
                <button
                  className="secondary-button"
                  disabled={definition.fields.length >= 20}
                  onClick={() =>
                    update({
                      fields: [
                        ...definition.fields,
                        {
                          id: crypto.randomUUID(),
                          label: '',
                          type: 'text',
                          required: false,
                          options: [],
                        },
                      ],
                    })
                  }
                >
                  Add field
                </button>
              </>
            ) : (
              <>
                {definition.options.map((option, index) => (
                  <label key={index}>
                    Option {index + 1}
                    <input
                      maxLength={100}
                      value={option}
                      onChange={event =>
                        update({
                          options: definition.options.map((old, i) =>
                            i === index ? event.target.value : old,
                          ),
                        })
                      }
                    />
                    {definition.options.length > 2 && (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() =>
                          update({ options: definition.options.filter((_, i) => i !== index) })
                        }
                      >
                        Remove option {index + 1}
                      </button>
                    )}
                  </label>
                ))}
                <button
                  className="secondary-button"
                  disabled={definition.options.length >= 12}
                  onClick={() => update({ options: [...definition.options, ''] })}
                >
                  Add option
                </button>
              </>
            )}
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Excel export columns</legend>
            {exportColumns.map(([key, label]) => (
              <label className="announcement-check" key={key}>
                <input
                  type="checkbox"
                  checked={definition.exports.includes(key)}
                  onChange={event =>
                    update({
                      exports: event.target.checked
                        ? [...definition.exports, key]
                        : definition.exports.filter(column => column !== key),
                    })
                  }
                />{' '}
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Banner image and design</legend>
            <label>
              Banner image
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={event => void upload(event.target.files?.[0])}
              />
            </label>
            {image && (
              <>
                <img
                  className="announcement-image-thumbnail"
                  src={image.url}
                  alt={definition.imageAlt}
                />
                <label>
                  Image description
                  <input
                    maxLength={140}
                    value={definition.imageAlt}
                    onChange={event => update({ imageAlt: event.target.value })}
                  />
                </label>
                <label>
                  Image crop focus
                  <select
                    value={definition.imagePosition}
                    onChange={event =>
                      update({ imagePosition: event.target.value as Definition['imagePosition'] })
                    }
                  >
                    <option value="left">Left</option>
                    <option value="center">Centre</option>
                    <option value="right">Right</option>
                  </select>
                </label>
                <button className="secondary-button" onClick={() => setImage(undefined)}>
                  Remove image
                </button>
              </>
            )}
            {data?.aiAvailable && (
              <>
                <label>
                  Design viewport
                  <select
                    value={definition.designViewport ?? 'both'}
                    onChange={event =>
                      update({ designViewport: event.target.value as Definition['designViewport'] })
                    }
                  >
                    <option value="both">Desktop and mobile</option>
                    <option value="desktop">Desktop focus</option>
                    <option value="mobile">Mobile focus</option>
                  </select>
                </label>
                <label>
                  Design prompt
                  <textarea
                    maxLength={1000}
                    value={prompt}
                    onChange={event => setPrompt(event.target.value)}
                    placeholder="For this training form, use a compact mobile layout, full-width submit button and teal accents."
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={!prompt.trim()}
                  onClick={() => void generate()}
                >
                  {definition.versions.length ? 'Refine with AI' : 'Generate with AI'}
                </button>
              </>
            )}
            {Boolean(definition.versions.length) && (
              <>
                <label>
                  Design version
                  <select
                    value={definition.selectedVersion ?? ''}
                    onChange={event =>
                      selectVersion(
                        definition.versions.find(version => version.id === event.target.value),
                      )
                    }
                  >
                    <option value="">Default design</option>
                    {definition.versions.map((version, index) => (
                      <option key={version.id} value={version.id}>
                        Version {index + 1} · {version.feedback.slice(0, 48)}
                      </option>
                    ))}
                  </select>
                </label>
                {definition.selectedVersion && (
                  <button
                    className="secondary-button"
                    onClick={() => {
                      update({
                        versions: definition.versions.filter(
                          version => version.id !== definition.selectedVersion,
                        ),
                        selectedVersion: undefined,
                        design: undefined,
                      });
                    }}
                  >
                    Discard selected design
                  </button>
                )}
              </>
            )}
          </fieldset>
          <div className="announcement-editor-actions">
            <button className="secondary-button" disabled={busy} onClick={() => void save('draft')}>
              Save draft
            </button>
            <button className="admin-primary" disabled={busy} onClick={() => void save('preview')}>
              Preview
            </button>
          </div>
        </div>
      )}
      {page === 'preview' && (
        <>
          <p role="status">{audienceCount ?? 0} eligible employees in the selected audience.</p>
          <div className="announcement-editor-actions">
            <button
              className="secondary-button"
              aria-pressed={!mobile}
              onClick={() => setMobile(false)}
            >
              Desktop
            </button>
            <button
              className="secondary-button"
              aria-pressed={mobile}
              onClick={() => setMobile(true)}
            >
              Mobile
            </button>
          </div>
          <nav className="announcement-preview-tabs" aria-label="Announcement preview">
            <button
              className="secondary-button"
              aria-pressed={previewView === 'banner'}
              onClick={() => setPreviewView('banner')}
            >
              Banner preview
            </button>
            {definition.popup && (
              <button
                className="secondary-button"
                aria-pressed={previewView === 'popup'}
                onClick={() => {
                  setPreviewView('popup');
                  setPreviewForm(false);
                }}
              >
                Popup preview
              </button>
            )}
            <button
              className="secondary-button"
              aria-pressed={previewView === 'form'}
              onClick={() => setPreviewView('form')}
            >
              {definition.kind === 'POLL' ? 'Poll preview' : 'Form preview'}
            </button>
          </nav>
          <div className={'announcement-preview-stage' + (mobile ? ' is-mobile' : '')}>
            <div className="announcement-preview-topbar">
              <span>Cognitive Intelligence Lab</span>
              <small>{mobile ? 'Mobile' : 'Desktop'} · Preview</small>
            </div>
            {previewView === 'banner' ? (
              <>
                <div className="announcement-strip" style={announcementStyle(definition)}>
                  <AnnouncementBannerContent
                    definition={definition}
                    image={previewImage}
                    action={
                      definition.kind === 'POLL' ? (
                        <PollOptions
                          options={definition.options}
                          onVote={() => setNote('Preview vote accepted.')}
                        />
                      ) : (
                        <button className="admin-primary" onClick={() => setPreviewView('form')}>
                          {definition.cta}
                        </button>
                      )
                    }
                  />
                </div>
                <div className="announcement-preview-page">
                  <h3>Your workspace</h3>
                  <p>The announcement banner appears below the page header.</p>
                </div>
              </>
            ) : (
              <div
                className={
                  'announcement-preview-body' + (previewView === 'popup' ? ' is-popup' : '')
                }
              >
                <div className="announcement-preview-window">
                  <header>
                    <strong>
                      {previewView === 'popup'
                        ? 'Announcement popup'
                        : definition.kind === 'POLL'
                          ? 'Quick poll'
                          : 'Registration form'}
                    </strong>
                  </header>
                  <AnnouncementCard
                    definition={definition}
                    image={previewImage}
                    action={
                      definition.kind === 'POLL' ? (
                        <PollOptions
                          options={definition.options}
                          onVote={() => setNote('Preview vote accepted.')}
                        />
                      ) : previewView === 'form' || previewForm ? (
                        <AnnouncementForm
                          definition={definition}
                          person={sample}
                          onSubmit={() => setNote('Preview response accepted.')}
                        />
                      ) : (
                        <button className="admin-primary" onClick={() => setPreviewForm(true)}>
                          {definition.cta}
                        </button>
                      )
                    }
                  />
                </div>
              </div>
            )}
          </div>
          <div className="announcement-editor-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setPage('edit');
                setNote('');
              }}
            >
              Back to edit
            </button>
            <button
              className="admin-primary"
              disabled={busy || !audienceCount}
              onClick={() => void save('publish')}
            >
              {Date.parse(start) > Date.now() ? 'Schedule announcement' : 'Publish announcement'}
            </button>
          </div>
        </>
      )}
    </FormDialog>
  );
}
