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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Download,
  FileText,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Monitor,
  Smartphone,
} from 'lucide-react';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';
import { FormDialog } from './FormDialog';
import {
  announcementDraftHandoff,
  resolveAnnouncementAudience,
} from './announcement-draft-handoff';
import {
  announcementStyle,
  AnnouncementBannerContent,
  AnnouncementCard,
  AnnouncementPoster,
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
  allowResponseUpdates: false,
  imageAlt: '',
  imagePosition: 'center',
};

function withCanonicalExportFields(value: Definition): Definition {
  return {
    ...value,
    exports: [...new Set(value.exports.map(key => (key === 'primarySkill' ? 'capability' : key)))],
  };
}
const scopeLabels: Record<string, string> = {
  DELIVERY_UNIT: 'Delivery Unit',
  PORTFOLIO: 'Portfolio',
  DEPARTMENT: 'Account / Client',
  PROJECT: 'Business project',
  ORGANIZATION: 'Workspace access · choose an audience',
};
const localDate = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
function announcementSchedule(start: string, end: string) {
  const startsAt = new Date(start);
  const endsAt = new Date(end);
  if (!Number.isFinite(startsAt.getTime())) throw Error('Enter a valid start date and time.');
  if (!Number.isFinite(endsAt.getTime())) throw Error('Enter a valid end date and time.');
  if (endsAt <= startsAt) throw Error('The end date and time must be after the start.');
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}
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

export function AnnouncementManager({
  view,
  onViewChange,
  onUpdated,
  draftTicket,
  children,
}: {
  view: 'announcements' | 'responses';
  onViewChange: (view: 'announcements' | 'responses') => void;
  onUpdated: () => void;
  draftTicket?: string;
  children?: ReactNode;
}) {
  const [data, setData] = useState<Management>();
  const [draft, setDraft] = useState<Draft>();
  const [definition, setDefinition] = useState<Definition>(empty);
  const [grantId, setGrantId] = useState('');
  const [start, setStart] = useState(() => localDate(new Date()));
  const [end, setEnd] = useState(() => localDate(new Date(Date.now() + 86_400_000)));
  const [page, setPage] = useState<'list' | 'edit' | 'preview'>('list');
  const [assistantEditing, setAssistantEditing] = useState(false);
  const handledTicket = useRef<string | undefined>(undefined);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  const [designing, setDesigning] = useState(false);
  const [designError, setDesignError] = useState('');
  const previewPane = useRef<HTMLDivElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const detailsPane = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<{ base64: string; url: string }>();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [audienceCount, setAudienceCount] = useState<number>();
  const [previewImage, setPreviewImage] = useState<string>();
  const previewAsset = previewImage ?? image?.url;
  const [receipt, setReceipt] = useState<{ id: string; token: string }>();
  const [previewForm, setPreviewForm] = useState(false);
  const [previewView, setPreviewView] = useState<'banner' | 'popup' | 'form'>('banner');
  const [previewBannerDismissed, setPreviewBannerDismissed] = useState(false);
  const [responses, setResponses] = useState<{
    id: string;
    page?: number;
    hasMore?: boolean;
    definition: Definition;
    responses: {
      name: string;
      email?: string;
      employeeId: string;
      answers: Record<string, string | boolean>;
    }[];
  }>();
  const [responseId, setResponseId] = useState('');
  const [responseLoading, setResponseLoading] = useState(false);
  const [responseError, setResponseError] = useState('');
  const [responseAttempt, setResponseAttempt] = useState(0);
  const [managementAttempt, setManagementAttempt] = useState(0);
  const [managementPage, setManagementPage] = useState(1);
  const [responsePage, setResponsePage] = useState(1);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (page !== 'list') return;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [page]);
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
    if (!actor || page === 'list' || !grantId || assistantEditing) return;
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
      step: page === 'preview' ? 'design' : 'details',
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
  }, [
    actor,
    page,
    grantId,
    draft?.id,
    draft?.revision,
    definition,
    start,
    end,
    image,
    prompt,
    assistantEditing,
  ]);
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
  const resumeLocal = () =>
    work(async () => {
      if (!localDraft || !data?.grants.some(grant => grant.id === localDraft.grantId)) {
        setError('The saved publishing scope is unavailable.');
        return;
      }
      const existing = localDraft.draftId
        ? await api<Draft>('/' + localDraft.draftId + '/draft')
        : undefined;
      if (localDraft.draftId && (!existing || existing.state !== 'DRAFT')) {
        setError('The saved announcement is already published, closed or unavailable.');
        return;
      }
      if (existing && existing.revision !== localDraft.revision) {
        setError(
          'This draft changed on the server. Open the saved draft from Your announcements. Your local copy is still on this device.',
        );
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
      setAssistantEditing(false);
      setGrantId(localDraft.grantId);
      setDefinition(withCanonicalExportFields(localDraft.definition));
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
      setPage(localDraft.step === 'design' ? 'preview' : 'edit');
    });
  const refresh = () => setManagementAttempt(value => value + 1);
  useEffect(() => {
    let active = true;
    api<Management>('/manage' + (managementPage > 1 ? '?page=' + managementPage : ''))
      .then(value => {
        if (active) setData(value);
      })
      .catch(error => {
        if (active) {
          if ([401, 403].includes((error as { status?: number }).status ?? 0)) {
            setData(undefined);
            setResponses(undefined);
            setReceipt(undefined);
            setPage('list');
          }
          setError(error.message);
        }
      });
    return () => {
      active = false;
    };
  }, [managementAttempt, managementPage]);
  useEffect(() => {
    setReceipt(undefined);
  }, [definition, grantId, start, end, image?.base64]);
  useEffect(() => {
    setPreviewImage(undefined);
  }, [image?.base64]);
  useEffect(() => {
    if (conversation.current) conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [definition.versions.length, designing, designError, page]);
  const responseEntries = data?.items.filter(entry => entry.state !== 'DRAFT') ?? [];
  const selectedResponse =
    responseEntries.find(entry => entry.id === responseId)?.id ?? responseEntries[0]?.id ?? '';
  useEffect(() => {
    if (view !== 'responses' || !selectedResponse) {
      setResponses(undefined);
      setResponseLoading(false);
      return;
    }
    const controller = new AbortController();
    setResponses(undefined);
    setResponseError('');
    setResponseLoading(true);
    authenticatedFetch(
      endpoint +
        '/' +
        selectedResponse +
        '/responses' +
        (responsePage > 1 ? '?page=' + responsePage : ''),
      {
        signal: controller.signal,
      },
    )
      .then(response =>
        readApiResponse<NonNullable<typeof responses>>(response, 'Responses could not be loaded.'),
      )
      .then(value => {
        if (!controller.signal.aborted) setResponses({ ...value, id: selectedResponse });
      })
      .catch(error => {
        if (!controller.signal.aborted) setResponseError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setResponseLoading(false);
      });
    return () => controller.abort();
  }, [view, selectedResponse, responseAttempt, responsePage]);
  const work = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      await operation();
    } catch (error) {
      if ([401, 403].includes((error as { status?: number }).status ?? 0)) {
        setData(undefined);
        setResponses(undefined);
        setReceipt(undefined);
        setPage('list');
      }
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const backToList = () =>
    work(async () => {
      setPage('list');
      refresh();
    });
  const update = (changes: Partial<Definition>) =>
    setDefinition(previous => ({
      ...previous,
      ...changes,
      ...(changes.fields || changes.options || changes.kind
        ? { selectedVersion: undefined, design: undefined }
        : {}),
    }));
  const selectVersion = (version?: Version) =>
    update({
      selectedVersion: version?.id,
      design: version?.design,
    });
  const columns = orderAudienceScopes(
    data?.scopes.filter(scope => scope.grantId === grantId) ?? [],
  );
  const configure = (entry?: Draft, copy = false) => {
    setAssistantEditing(false);
    setError('');
    setDesignError('');
    setNote('');
    setConfirmClose(undefined);
    const grant = entry?.grantId ?? data?.grants[0]?.id ?? '';
    setGrantId(grant);
    setDraft(copy ? undefined : entry);
    const own = data?.grants.find(entry => entry.id === grant);
    const root = data?.scopes.find(
      scope => scope.grantId === grant && scope.id === own?.scopeId && scope.kind === own.kind,
    );
    setDefinition(
      entry
        ? withCanonicalExportFields(entry.definition)
        : { ...empty, audience: root ? [{ kind: root.kind, id: root.id }] : [] },
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
    setAudienceCount(undefined);
    setPreviewImage(undefined);
    setPreviewForm(false);
    setPreviewView('banner');
    setPreviewBannerDismissed(false);
    setLocalStatus('');
    setPage('edit');
  };
  useEffect(() => {
    if (!draftTicket || handledTicket.current === draftTicket || !data || busy) return;
    // Leave an open editor alone; the handoff can be picked up when it is closed.
    if (page !== 'list') return;
    handledTicket.current = draftTicket;
    const incoming = data.actorId && announcementDraftHandoff.take(data.actorId, draftTicket);
    if (!incoming || !data.grants.length) {
      setError(
        data.grants.length
          ? 'This announcement handoff expired. Open the draft again from Skill Genie.'
          : 'Your current access does not allow creating announcements.',
      );
      return;
    }
    const selection = resolveAnnouncementAudience(data, incoming.audienceLabel);
    configure();
    setAssistantEditing(true);
    onViewChange('announcements');
    setGrantId(selection?.grantId ?? data.grants[0].id);
    setDefinition({
      ...empty,
      title: incoming.title,
      message: incoming.message,
      cta: incoming.cta,
      audience: selection?.audience ?? [],
    });
    if (selection) {
      setPreviewView('form');
      setPage('preview');
    } else {
      setNote(
        incoming.audienceLabel
          ? `“${incoming.audienceLabel}” did not uniquely match an audience you can publish to. Select the intended audience below.`
          : 'Select an audience below before previewing the announcement.',
      );
    }
  }, [draftTicket, data, busy, page, onViewChange]);
  const payload = () => ({
    id: draft?.id,
    revision: draft?.revision ?? 0,
    grantId,
    ...announcementSchedule(start, end),
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
        setPreviewView(definition.imagePopup ? 'popup' : 'form');
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
        onUpdated();
        if (!assistantEditing) clearLocal();
        setManagementPage(1);
        refresh();
        setNote('Announcement published for the selected schedule.');
      } else {
        setAssistantEditing(false);
        setReceipt(undefined);
        setDraft({ ...payload(), ...saved });
        setNote('Draft saved.');
      }
    });
  const initialPrompt =
    'Create a polished, compact ' +
    (definition.kind === 'POLL' ? 'poll' : 'form') +
    ' for this announcement using the configured details. Use our branding, clear labels and a prominent primary action. Explain the design briefly.';
  const generateDesign = async (request: string) => {
    setPrompt(request);
    setDesignError('');
    setDesigning(true);
    try {
      const version = await api<Version>('/design', {
        id: draft?.id,
        grantId,
        prompt: request,
        ...announcementSchedule(start, end),
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          previewWidth: mobile ? 390 : previewPane.current?.clientWidth || undefined,
          hasImage: !!image,
        },
        definition: { ...definition, designViewport: 'both', image: undefined },
      });
      update({
        versions: [...definition.versions.slice(-14), version],
        selectedVersion: version.id,
        design: version.design,
      });
      setPrompt('');
      setNote('Design updated. Try it in the preview or continue refining.');
    } catch (error) {
      if ([401, 403].includes((error as { status?: number }).status ?? 0)) throw error;
      setDesignError((error as Error).message);
    } finally {
      setDesigning(false);
    }
  };
  const generate = (request = prompt) =>
    work(async () => {
      if (request.trim()) await generateDesign(request.trim());
    });
  const continueToDesign = () =>
    work(async () => {
      const invalid = Array.from(
        detailsPane.current?.querySelectorAll<HTMLInputElement>(
          'input[required],textarea[required]',
        ) ?? [],
      ).find(field => !field.validity.valid);
      if (invalid) {
        invalid.focus();
        invalid.reportValidity();
        throw Error('Complete the highlighted field before continuing.');
      }
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
      setPreviewView(definition.imagePopup ? 'popup' : 'form');
      setPage('preview');
      if (data?.aiAvailable && !definition.design && !definition.imagePopup)
        await generateDesign(prompt.trim() || initialPrompt);
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
  const viewResponses = (entry: Pick<JournalEntry, 'id'>) => {
    setResponseId(entry.id);
    setResponsePage(1);
    onViewChange('responses');
  };
  const closeAnnouncement = (entry: JournalEntry) =>
    work(async () => {
      await api('/' + entry.id + '/close', { revision: entry.revision });
      setConfirmClose(undefined);
      onUpdated();
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
      if (!image) update({ imagePopup: true, popup: true });
    });
  };
  const field = (key: string, changes: Partial<AnswerField>) =>
    update({
      fields: definition.fields.map(field => (field.id === key ? { ...field, ...changes } : field)),
    });

  const managementPagination = (managementPage > 1 || data?.hasMore) && (
    <div role="group" aria-label="Your announcement pages" className="announcement-editor-actions">
      <button
        className="secondary-button"
        disabled={busy || !data || managementPage === 1}
        onClick={() => {
          setManagementPage(p => p - 1);
          setResponsePage(1);
        }}
      >
        Previous announcements
      </button>
      <span>Announcement page {managementPage}</span>
      <button
        className="secondary-button"
        disabled={busy || !data?.hasMore}
        onClick={() => {
          setManagementPage(p => p + 1);
          setResponsePage(1);
        }}
      >
        More announcements
      </button>
    </div>
  );
  return (
    <>
      {page === 'list' && error && (
        <div className="announcement-feedback" role="alert">
          <p>{error}</p>
          {
            <button
              className="secondary-button"
              onClick={() => {
                setError('');
                setManagementAttempt(value => value + 1);
              }}
            >
              Retry
            </button>
          }
        </div>
      )}
      {page === 'list' && note && <p role="status">{note}</p>}
      <div
        role="tabpanel"
        id="announcement-panel-announcements"
        aria-labelledby="announcement-tab-announcements"
        hidden={view !== 'announcements'}
      >
        {view === 'announcements' && (
          <>
            <div className="announcement-list-toolbar">
              <h3>Your announcements</h3>
              {Boolean(data?.grants.length) && (
                <button className="admin-primary" disabled={busy} onClick={() => configure()}>
                  <Plus size={18} aria-hidden="true" /> New announcement
                </button>
              )}
            </div>
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
            {data && data.items.length === 0 && (
              <div className="announcement-empty">
                <FileText size={28} strokeWidth={1.5} aria-hidden="true" />
                <h3>Start with an announcement</h3>
                <p>Create an event, training form or quick poll for your audience.</p>
              </div>
            )}
            {data?.items.map(entry => (
              <article className="announcement-list-item" key={entry.id}>
                <div className="announcement-list-copy">
                  <strong>{entry.title}</strong>
                  <p>
                    {new Date(entry.startsAt).toLocaleString()} –{' '}
                    {new Date(entry.endsAt).toLocaleString()}
                  </p>
                </div>
                <span
                  className={
                    'announcement-state state-' +
                    (entry.state !== 'DRAFT' && Date.parse(entry.endsAt) <= clock
                      ? 'expired'
                      : entry.state.toLowerCase())
                  }
                >
                  {entry.state === 'DRAFT'
                    ? 'Draft'
                    : Date.parse(entry.endsAt) <= clock
                      ? 'Expired'
                      : entry.state === 'CLOSED'
                        ? 'Closed'
                        : Date.parse(entry.startsAt) > clock
                          ? 'Scheduled'
                          : 'Live'}
                </span>
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
                ) : (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => viewResponses(entry)}
                  >
                    Responses
                  </button>
                )}
                {entry.state !== 'DRAFT' && Date.parse(entry.endsAt) <= clock && (
                  <button
                    className="admin-primary"
                    disabled={busy}
                    onClick={() =>
                      void work(async () =>
                        configure(await api<Draft>('/' + entry.id + '/draft'), true),
                      )
                    }
                  >
                    Republish
                  </button>
                )}
                {entry.state !== 'DRAFT' && (
                  <details className="announcement-row-menu">
                    <summary aria-label={'More actions for ' + entry.title}>
                      <MoreHorizontal size={20} aria-hidden="true" />
                    </summary>
                    <div className="announcement-row-menu-actions">
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
                      {entry.state === 'PUBLISHED' &&
                        Date.parse(entry.endsAt) > clock &&
                        (confirmClose === entry.id ? (
                          <>
                            <button
                              className="secondary-button"
                              disabled={busy}
                              onClick={() => void closeAnnouncement(entry)}
                            >
                              Confirm close
                            </button>
                            <button
                              className="secondary-button"
                              onClick={() => setConfirmClose(undefined)}
                            >
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
                    </div>
                  </details>
                )}
              </article>
            ))}
            {managementPagination}
            <p className="announcement-note">
              Expired announcements and their responses are deleted 45 days after expiry. Republish
              creates a new announcement and keeps existing responses separate.
            </p>
            {children}
          </>
        )}
      </div>
      <div
        role="tabpanel"
        id="announcement-panel-responses"
        aria-labelledby="announcement-tab-responses"
        hidden={view !== 'responses'}
      >
        {view === 'responses' && (
          <section className="announcement-responses" aria-label="Recent responses">
            <div className="announcement-response-toolbar">
              <label>
                Announcement
                <select
                  value={selectedResponse}
                  disabled={!responseEntries.length}
                  onChange={event => {
                    setResponseId(event.target.value);
                    setResponsePage(1);
                  }}
                >
                  {!responseEntries.length && <option value="">No published announcements</option>}
                  {responseEntries.map(entry => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="announcement-editor-actions">
                <button
                  className="secondary-button"
                  disabled={busy || responseLoading || !selectedResponse}
                  onClick={() => setResponseAttempt(value => value + 1)}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  Refresh responses
                </button>
                {data?.canExport && (
                  <button
                    className="secondary-button"
                    disabled={busy || responseLoading || responses?.id !== selectedResponse}
                    onClick={() => void exportResponses({ id: selectedResponse })}
                  >
                    <Download size={16} aria-hidden="true" />
                    Download responses
                  </button>
                )}
              </div>
            </div>
            {!data && !error && <p role="status">Loading announcements…</p>}
            {data && !selectedResponse && (
              <div className="announcement-empty">
                <MessageSquare size={28} strokeWidth={1.5} aria-hidden="true" />
                <h3>No responses to view yet</h3>
                <p>Publish an announcement to start collecting responses.</p>
              </div>
            )}
            {selectedResponse && responseLoading && <p role="status">Loading responses…</p>}
            {selectedResponse && responseError && (
              <div className="announcement-feedback" role="alert">
                <p>{responseError}</p>
                <button
                  className="secondary-button"
                  onClick={() => setResponseAttempt(value => value + 1)}
                >
                  Retry responses
                </button>
              </div>
            )}
            {!responseLoading &&
              responses?.id === selectedResponse &&
              !responseError &&
              (responses.responses.length === 0 ? (
                <div className="announcement-empty">
                  <MessageSquare size={28} strokeWidth={1.5} aria-hidden="true" />
                  <h3>No responses yet</h3>
                  <p>No responses are available in your current scope for this announcement.</p>
                </div>
              ) : (
                <div className="my-skills-table-wrap">
                  <table className="my-skills-table">
                    <caption className="sr-only">{responses.definition.title} responses</caption>
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
              ))}
            {responses?.id === selectedResponse &&
              !responseError &&
              (responsePage > 1 || responses.hasMore) && (
                <div
                  role="group"
                  aria-label="Response pages"
                  className="announcement-editor-actions"
                >
                  <button
                    className="secondary-button"
                    disabled={responseLoading || responsePage === 1}
                    onClick={() => setResponsePage(p => p - 1)}
                  >
                    Previous responses
                  </button>
                  <span>Response page {responsePage}</span>
                  <button
                    className="secondary-button"
                    disabled={responseLoading || !responses.hasMore}
                    onClick={() => setResponsePage(p => p + 1)}
                  >
                    More responses
                  </button>
                </div>
              )}
            {managementPagination}
          </section>
        )}
      </div>
      {page !== 'list' && (
        <FormDialog
          title={draft ? 'Edit announcement' : 'New announcement'}
          subtitle={
            <span
              className="announcement-header-step"
              aria-label={
                page === 'edit' ? 'Step 1 of 2 - Basic details' : 'Step 2 of 2 - Design & preview'
              }
            >
              <strong>Step {page === 'edit' ? 1 : 2} / 2</strong>
              <span>{page === 'edit' ? 'Basic details' : 'Design & preview'}</span>
            </span>
          }
          className="announcement-manager"
          page={page === 'edit' ? 0 : 1}
          onClose={() => void backToList()}
          busy={busy}
          footer={
            <div className="announcement-builder-footer">
              <div>
                {page === 'preview' ? (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => {
                        setPage('edit');
                        setNote('');
                      }}
                    >
                      Basic details
                    </button>
                    <span role="status">
                      {receipt
                        ? `${audienceCount ?? 0} eligible employees in the selected audience.`
                        : 'Check the audience before publishing.'}
                    </span>
                  </>
                ) : (
                  <span>
                    {assistantEditing
                      ? 'Use Save draft to keep these edits.'
                      : 'You can save a draft at any time.'}
                  </span>
                )}
              </div>
              <div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void save('draft')}
                >
                  Save draft
                </button>
                {page === 'edit' ? (
                  <button
                    type="button"
                    className="admin-primary"
                    disabled={busy}
                    onClick={() => void continueToDesign()}
                  >
                    {definition.imagePopup ? 'Continue to preview' : 'Continue to AI design'}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void save('preview')}
                    >
                      Check audience
                    </button>
                    <button
                      type="button"
                      className="admin-primary"
                      disabled={busy || !receipt || !audienceCount}
                      onClick={() => void save('publish')}
                    >
                      {Date.parse(start) > Date.now()
                        ? 'Schedule announcement'
                        : 'Publish announcement'}
                    </button>
                  </>
                )}
              </div>
            </div>
          }
        >
          {localStatus && (
            <p className="announcement-draft-status" role="status">
              {localStatus}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {note && <p role="status">{note}</p>}
          {page === 'edit' && (
            <div className="announcement-editor announcement-details" ref={detailsPane}>
              <button className="secondary-button" onClick={() => void backToList()}>
                Back to announcements
              </button>
              <fieldset disabled={busy}>
                <legend>Message and schedule</legend>
                <label>
                  Title
                  <input
                    required
                    maxLength={120}
                    value={definition.title}
                    onChange={event => update({ title: event.target.value })}
                  />
                </label>
                <label>
                  Use case
                  <select
                    value={definition.useCase ?? 'EVENT'}
                    onChange={event =>
                      update({ useCase: event.target.value as Definition['useCase'] })
                    }
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
                      update({
                        audience:
                          !assistantEditing && root ? [{ id: root.id, kind: root.kind }] : [],
                      });
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
                <label className="announcement-check">
                  <input
                    type="checkbox"
                    checked={definition.allowResponseUpdates === true}
                    onChange={event => update({ allowResponseUpdates: event.target.checked })}
                  />
                  Allow people to edit their response while the announcement is active
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
                      Name, work email and employee ID are shown from the signed-in profile and are
                      read-only.
                    </p>
                    {definition.fields.map((entry, index) => (
                      <div className="announcement-editor-grid announcement-field" key={entry.id}>
                        <label>
                          Field {index + 1} label
                          <input
                            required
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
                        {(entry.type === 'choice' || entry.type === 'radio') && (
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
                            update({
                              fields: definition.fields.filter(item => item.id !== entry.id),
                            })
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
                          required
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
              <details className="announcement-optional">
                <summary>Export columns (optional)</summary>
                <fieldset disabled={busy}>
                  <legend className="sr-only">Excel export columns</legend>
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
              </details>
              <details className="announcement-optional">
                <summary>Announcement image (optional)</summary>
                <fieldset disabled={busy}>
                  <legend className="sr-only">Announcement image</legend>
                  <label>
                    Upload image
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
                      <label className="announcement-check">
                        <input
                          type="checkbox"
                          checked={definition.imagePopup === true}
                          onChange={event =>
                            update({
                              imagePopup: event.target.checked,
                              ...(event.target.checked ? { popup: true } : {}),
                            })
                          }
                        />{' '}
                        Show image before the form or poll
                      </label>
                      <label>
                        Image description
                        <input
                          placeholder="e.g. Wide training poster; keep all text visible"
                          maxLength={140}
                          value={definition.imageAlt}
                          onChange={event => update({ imageAlt: event.target.value })}
                        />
                      </label>
                      {!definition.imagePopup && (
                        <label>
                          Image crop focus
                          <select
                            value={definition.imagePosition}
                            onChange={event =>
                              update({
                                imagePosition: event.target.value as Definition['imagePosition'],
                              })
                            }
                          >
                            <option value="left">Left</option>
                            <option value="center">Centre</option>
                            <option value="right">Right</option>
                          </select>
                        </label>
                      )}
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          setImage(undefined);
                          update({ imagePopup: false });
                        }}
                      >
                        Remove image
                      </button>
                    </>
                  )}
                </fieldset>
              </details>
            </div>
          )}
          {page === 'preview' && (
            <div className="announcement-studio">
              <section
                className="announcement-studio-preview"
                ref={previewPane}
                aria-label="Live announcement preview"
              >
                <div className="announcement-studio-heading">
                  <h3>Live preview</h3>
                  <span>Try the form and buttons here</span>
                </div>
                <div className="announcement-preview-toolbar" aria-label="Preview controls">
                  <div
                    className="announcement-preview-devices"
                    role="group"
                    aria-label="Preview device"
                  >
                    <button
                      type="button"
                      className="secondary-button"
                      aria-label="Desktop"
                      title="Desktop preview"
                      aria-pressed={!mobile}
                      onClick={() => setMobile(false)}
                    >
                      <Monitor size={17} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      aria-label="Mobile"
                      title="Mobile preview"
                      aria-pressed={mobile}
                      onClick={() => setMobile(true)}
                    >
                      <Smartphone size={17} aria-hidden="true" />
                    </button>
                  </div>
                  <nav className="announcement-preview-tabs" aria-label="Announcement preview">
                    <button
                      type="button"
                      className="secondary-button"
                      aria-label="Banner preview"
                      aria-pressed={previewView === 'banner'}
                      onClick={() => setPreviewView('banner')}
                    >
                      Banner
                    </button>
                    {definition.popup && (
                      <button
                        type="button"
                        className="secondary-button"
                        aria-label="Popup preview"
                        aria-pressed={previewView === 'popup'}
                        onClick={() => {
                          setPreviewView('popup');
                          setPreviewForm(false);
                        }}
                      >
                        Popup
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary-button"
                      aria-label={definition.kind === 'POLL' ? 'Poll preview' : 'Form preview'}
                      aria-pressed={previewView === 'form'}
                      onClick={() => setPreviewView('form')}
                    >
                      {definition.kind === 'POLL' ? 'Poll' : 'Form'}
                    </button>
                  </nav>
                </div>
                <div className={'announcement-preview-stage' + (mobile ? ' is-mobile' : '')}>
                  <div className="announcement-preview-topbar">
                    <span>Skill Management App</span>
                    <small>{mobile ? 'Mobile' : 'Desktop'} · Preview</small>
                  </div>
                  {previewView === 'banner' ? (
                    <>
                      {!previewBannerDismissed && (
                        <div className="announcement-strip" style={announcementStyle(definition)}>
                          <AnnouncementBannerContent
                            definition={definition}
                            onDismiss={() => setPreviewBannerDismissed(true)}
                            action={
                              <button
                                className="admin-primary"
                                onClick={() =>
                                  setPreviewView(definition.imagePopup ? 'popup' : 'form')
                                }
                              >
                                {definition.kind === 'POLL' ? 'Open poll' : definition.cta}
                              </button>
                            }
                          />
                        </div>
                      )}
                      <div className="announcement-preview-page">
                        <h3>Your workspace</h3>
                        {previewBannerDismissed ? (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => setPreviewBannerDismissed(false)}
                          >
                            Restore banner
                          </button>
                        ) : (
                          <p>The announcement banner appears below the page header.</p>
                        )}
                      </div>
                    </>
                  ) : (
                    <div
                      className={
                        'announcement-preview-body' + (previewView === 'popup' ? ' is-popup' : '')
                      }
                    >
                      <div className="announcement-preview-window">
                        {previewView === 'popup' && definition.imagePopup && previewAsset ? (
                          <AnnouncementPoster
                            definition={definition}
                            image={previewAsset}
                            onOpen={() => setPreviewView('form')}
                          />
                        ) : (
                          <AnnouncementCard
                            definition={definition}
                            person={sample}
                            onSubmit={() =>
                              setNote('Preview response accepted. Nothing was submitted.')
                            }
                            onVote={() => setNote('Preview vote accepted. Nothing was submitted.')}
                            onOpen={() => setPreviewForm(true)}
                            image={definition.imagePopup ? undefined : previewAsset}
                            action={
                              definition.kind === 'POLL' ? (
                                <PollOptions
                                  options={definition.options}
                                  onVote={() =>
                                    setNote('Preview vote accepted. Nothing was submitted.')
                                  }
                                />
                              ) : previewView === 'form' || previewForm ? (
                                <AnnouncementForm
                                  definition={definition}
                                  person={sample}
                                  onSubmit={() =>
                                    setNote('Preview response accepted. Nothing was submitted.')
                                  }
                                />
                              ) : (
                                <button
                                  className="admin-primary"
                                  onClick={() => setPreviewForm(true)}
                                >
                                  {definition.cta}
                                </button>
                              )
                            }
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <p className="announcement-note">
                  Preview uses sample details. Responses here are not saved.
                </p>
              </section>
              <section className="announcement-design-chat" aria-label="AI design chat">
                <div className="announcement-studio-heading">
                  <h3>Design with AI</h3>
                  <span>
                    {definition.versions.length
                      ? 'Refine the selected design'
                      : 'Your details are ready'}
                  </span>
                </div>
                <div
                  className="announcement-design-conversation"
                  role="log"
                  aria-label="Design conversation"
                  aria-live="polite"
                  aria-relevant="additions text"
                  ref={conversation}
                >
                  <div className="announcement-chat-message is-assistant">
                    <strong>Design assistant</strong>
                    <p>
                      {data?.aiAvailable
                        ? 'I use your configured form or poll and keep the buttons connected. Tell me what to change in the preview. Change questions, audience or timing in Basic details.'
                        : 'AI design is unavailable. You can still preview, save and publish your configured form or poll.'}
                    </p>
                  </div>
                  {definition.versions.map((version, index) => (
                    <div className="announcement-chat-turn" key={version.id}>
                      <div className="announcement-chat-message is-user">
                        <strong>You</strong>
                        <p>{version.feedback}</p>
                      </div>
                      <div className="announcement-chat-message is-assistant">
                        <strong>Design assistant - version {index + 1}</strong>
                        <p>
                          {version.reply ||
                            'Design updated. Try the preview or tell me what to refine next.'}
                        </p>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busy || definition.selectedVersion === version.id}
                          onClick={() => selectVersion(version)}
                        >
                          {definition.selectedVersion === version.id
                            ? 'Current design'
                            : 'Use this version'}
                        </button>
                      </div>
                    </div>
                  ))}
                  {designing && (
                    <div className="announcement-chat-message is-assistant" role="status">
                      Designing your announcement. Detailed designs can take about a minute.
                    </div>
                  )}
                </div>
                {designError && (
                  <div className="announcement-chat-message is-assistant" role="alert">
                    {designError} You can keep using the current preview.
                  </div>
                )}
                {data?.aiAvailable && (
                  <>
                    <div
                      className="announcement-design-suggestions"
                      aria-label="Design suggestions"
                    >
                      {[
                        ['Premium look', 'Give it a premium spotlight style with rounded corners'],
                        ['More compact', 'Make the layout more compact'],
                        ['Two-column fields', 'Use two columns for form fields'],
                        ['Full-width button', 'Make the primary button full width'],
                        ...(image
                          ? [
                              [
                                'Use uploaded image',
                                'Use the uploaded image prominently; follow its description and keep important content visible',
                              ],
                            ]
                          : []),
                      ].map(([label, suggestion]) => (
                        <button
                          type="button"
                          key={suggestion}
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => void generate(suggestion)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <form
                      className="announcement-design-composer"
                      onSubmit={event => {
                        event.preventDefault();
                        if (!busy) void generate();
                      }}
                    >
                      <label htmlFor="announcement-design-prompt">
                        Message the design assistant
                      </label>
                      <textarea
                        id="announcement-design-prompt"
                        maxLength={1000}
                        rows={2}
                        value={prompt}
                        onChange={event => setPrompt(event.target.value)}
                        placeholder="Make it more compact, use teal accents and keep the button full width..."
                        onKeyDown={event => {
                          if (
                            event.key === 'Enter' &&
                            !event.shiftKey &&
                            !event.nativeEvent.isComposing
                          ) {
                            event.preventDefault();
                            if (!busy && prompt.trim()) void generate();
                          }
                        }}
                      />
                      <div>
                        <small>Enter to send - Shift + Enter for a new line</small>
                        <button
                          type="submit"
                          className="admin-primary"
                          disabled={busy || !prompt.trim()}
                        >
                          {designing ? 'Designing...' : designError ? 'Retry design' : 'Send'}
                        </button>
                      </div>
                    </form>
                  </>
                )}
                {Boolean(definition.versions.length) && (
                  <details className="announcement-design-history">
                    <summary>Design versions ({definition.versions.length})</summary>
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
                            Version {index + 1} - {version.feedback.slice(0, 48)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {definition.selectedVersion && (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          update({
                            versions: definition.versions.filter(
                              version => version.id !== definition.selectedVersion,
                            ),
                            selectedVersion: undefined,
                            design: undefined,
                          })
                        }
                      >
                        Discard selected design
                      </button>
                    )}
                  </details>
                )}
              </section>
            </div>
          )}
        </FormDialog>
      )}
    </>
  );
}
