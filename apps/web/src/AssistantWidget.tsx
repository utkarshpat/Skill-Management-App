import { businessDraftHandoff, type BusinessDraft } from './business/business-draft-handoff';
import { learningDraftHandoff } from './learning-draft-handoff';
import {
  announcementDraftHandoff,
  type AnnouncementDraftInput,
} from './announcement-draft-handoff';
import { readApiResponse } from './api-response';
import { AssistantSession } from './assistant-session';
import { assistantContextPrompt } from './assistant-context';
import {
  recordFactsSeparator,
  type AssistantRecordAction,
  type AssistantRecordContext,
} from './assistant-record';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { requestRead, type RequestOptions } from './request-model';
import { assistantNavigationTargets, type AssistantPage } from './assistant-actions';
import { Bot, X, Send, RotateCw, History, Trash2, ChevronRight } from 'lucide-react';
import { authenticatedFetch } from './auth';
import { AssistantOutput, type Artifact } from './AssistantOutput';
import { AssistantRichText } from './AssistantRichText';
import { AssistantDocument, type AiDocument } from './AssistantDocument';
import { AssistantPeopleResults, type PeopleQuery } from './business/AssistantPeopleResults';
import { peopleSearchUserText } from './business/people-search-prompt';
// Draft editors are needed only after the employee chooses to review a draft.
const CapabilityComposer = lazy(() =>
  import('./capabilities/CapabilityComposer').then(module => ({
    default: module.CapabilityComposer,
  })),
);
const RequestComposer = lazy(() =>
  import('./RequestComposer').then(module => ({ default: module.RequestComposer })),
);
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: { label: string; url?: string }[];
  artifact?: Artifact;
  peopleSearch?: { query: PeopleQuery };
}
type SkillHandoff = { id?: string; name: string; description: string; intent: 'draft' | 'submit' };
export function AssistantWidget() {
  const navigate = useNavigate(),
    location = useLocation();
  const [arrivingReply, setArrivingReply] = useState<ChatMessage>();
  const [requestDraft, setRequestDraft] = useState<{
    kind: 'REQUEST' | 'INCIDENT';
    title: string;
    description: string;
    options: RequestOptions;
  }>();
  async function reviewRequest(draft: {
    kind: 'REQUEST' | 'INCIDENT';
    title: string;
    description: string;
  }) {
    if (actionBusy || busy || historyBusy) return;
    setActionBusy(true);
    setError('');
    const pending = new AbortController();
    actionController.current = pending;
    try {
      const options = await requestRead<RequestOptions>(
        await authenticatedFetch('/api/workflows/options', { signal: pending.signal }),
      );
      if (pending.signal.aborted) return;
      if (draft.kind === 'REQUEST' ? !options.canRequest : !options.canIncident)
        throw Error('Your current permissions do not allow this draft.');
      setRequestDraft({ ...draft, options });
    } catch (e) {
      if (!pending.signal.aborted)
        setError(e instanceof Error ? e.message : 'Could not open request review.');
    } finally {
      if (actionController.current === pending) {
        actionController.current = null;
        setActionBusy(false);
      }
    }
  }
  const [navigation, setNavigation] = useState<{
    actorId?: string;
    pages: AssistantPage[];
    canReviewOwnSkill: boolean;
    canManageLearning?: boolean;
    canDraftRequest?: boolean;
    canDraftIncident?: boolean;
    canDraftAnnouncement?: boolean;
    canDraftAmendment?: boolean;
    suggestions?: { label: string; destination: string; prompt: string }[];
  }>({ pages: [], canReviewOwnSkill: false });
  async function reviewAnnouncement(draft: AnnouncementDraftInput) {
    if (actionBusy || busy || historyBusy) return;
    setActionBusy(true);
    setError('');
    setActionNotice('');
    const pending = new AbortController();
    actionController.current = pending;
    try {
      const current = await readApiResponse<{ actorId?: string; canDraftAnnouncement?: boolean }>(
        await authenticatedFetch('/api/assistant/navigation', { signal: pending.signal }),
        'Could not verify announcement access.',
      );
      if (pending.signal.aborted) return;
      if (
        !current.actorId ||
        current.actorId !== navigation.actorId ||
        !current.canDraftAnnouncement
      )
        throw Error('Your current access does not allow creating announcements.');
      const ticket = announcementDraftHandoff.offer(current.actorId, draft);
      collapse();
      navigate('/announcements', { state: { announcementDraftTicket: ticket } });
    } catch (error) {
      if (!pending.signal.aborted)
        setError(error instanceof Error ? error.message : 'Could not open announcement draft.');
    } finally {
      if (actionController.current === pending) {
        actionController.current = null;
        setActionBusy(false);
      }
    }
  }
  async function reviewBusiness(draft: BusinessDraft) {
    if (draft.kind !== 'amendment_draft' || actionBusy || busy || historyBusy) return;
    setActionBusy(true);
    setError('');
    const pending = new AbortController();
    actionController.current = pending;
    try {
      const response = await authenticatedFetch('/api/assistant/navigation', {
          signal: pending.signal,
        }),
        current = await response.json();
      if (pending.signal.aborted) return;
      if (!response.ok || current.actorId !== navigation.actorId || !current.canDraftAmendment)
        throw Error('Your current access does not allow this business draft.');
      const ticket = businessDraftHandoff.offer(current.actorId, draft);
      collapse();
      navigate('/skills?tab=amendments&draftTicket=' + encodeURIComponent(ticket));
    } catch (e) {
      if (!pending.signal.aborted) setError((e as Error).message);
    } finally {
      if (actionController.current === pending) {
        actionController.current = null;
        setActionBusy(false);
      }
    }
  }
  async function reviewPlan(planDraft: {
    title: string;
    goal: string;
    tasks: string[];
    dailyMinutes?: number;
  }) {
    if (actionBusy || busy || historyBusy) return;
    setActionBusy(true);
    setError('');
    const pending = new AbortController();
    actionController.current = pending;
    try {
      const response = await authenticatedFetch('/api/assistant/navigation', {
        signal: pending.signal,
      });
      const current = await response.json();
      if (pending.signal.aborted) return;
      if (
        !response.ok ||
        current.canManageLearning !== true ||
        !current.actorId ||
        current.actorId !== navigation.actorId
      )
        throw Error('Your current permissions do not allow learning plan creation.');
      const ticket = learningDraftHandoff.offer(current.actorId, planDraft);
      collapse();
      navigate('/learning?action=draft&draftTicket=' + encodeURIComponent(ticket));
    } catch (e) {
      if (!pending.signal.aborted)
        setError(e instanceof Error ? e.message : 'Could not review learning plan.');
    } finally {
      if (actionController.current === pending) {
        actionController.current = null;
        setActionBusy(false);
      }
    }
  }
  const [actionBusy, setActionBusy] = useState(false),
    [reviewSkill, setReviewSkill] = useState<SkillHandoff>(),
    [actionNotice, setActionNotice] = useState('');
  const [open, setOpen] = useState(false),
    [messages, setMessages] = useState<ChatMessage[]>([]),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [status, setStatus] = useState<{
    configured: boolean;
    provider: string | null;
    mode: string;
  }>();
  const [document, setDocument] = useState<AiDocument>();
  const [chats, setChats] = useState<{ id: string; title: string; updatedAt: string }[]>([]),
    [showHistory, setShowHistory] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [pendingContext, setPendingContext] = useState<string>();
  const [pendingRecord, setPendingRecord] = useState<AssistantRecordContext>();
  const [pendingAnalytics, setPendingAnalytics] = useState<Record<string, string>>();
  const analyticsContext = useRef<Record<string, string>>(undefined);
  const [recordContext, setRecordContext] = useState<
    AssistantRecordContext & { facts: string; locationKey: string }
  >();
  const currentRecord = recordContext?.locationKey === location.key ? recordContext : undefined;
  const peopleContext = useRef<string | undefined>(undefined);
  const conversationId = useRef<string | undefined>(undefined);
  const session = useRef(new AssistantSession());
  const [unread, setUnread] = useState(false);
  function newChat() {
    historyController.current?.abort();
    setHistoryBusy(false);
    session.current.newConversation();
    conversationId.current = undefined;
    setMessages([]);
    setText('');
    setError('');
    setActionNotice('');
    setPendingContext(undefined);
    setPendingRecord(undefined);
    setPendingAnalytics(undefined);
    analyticsContext.current = undefined;
    setRecordContext(undefined);
    peopleContext.current = undefined;
    setShowHistory(false);
    setDocument(undefined);
  }
  function openChat() {
    const restart = session.current.open();
    if (restart) {
      newChat();
      if (unread) setActionNotice('Your previous reply is available in Recent chats.');
    }
    setOpen(true);
    setUnread(false);
  }
  function collapse(restoreFocus = true) {
    session.current.collapse();
    setArrivingReply(undefined);
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => launcher.current?.focus());
  }
  const historyController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const recordActionController = useRef<AbortController | null>(null);
  const controller = useRef<AbortController | null>(null),
    input = useRef<HTMLTextAreaElement>(null),
    launcher = useRef<HTMLButtonElement>(null),
    messageLog = useRef<HTMLDivElement>(null),
    replyStart = useRef<HTMLDivElement>(null),
    closeButton = useRef<HTMLButtonElement>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      actionController.current?.abort();
      historyController.current?.abort();
    },
    [],
  );
  function useRecordPrompt(
    prompt: string,
    record?: AssistantRecordContext,
    analyticsFilters?: Record<string, string>,
  ) {
    analyticsContext.current = analyticsFilters;
    const split = record ? prompt.indexOf(recordFactsSeparator) : -1;
    setRecordContext(
      record && split >= 0
        ? {
            ...record,
            facts: prompt.slice(split + recordFactsSeparator.length),
            locationKey: location.key,
          }
        : undefined,
    );
    setText(split >= 0 ? prompt.slice(0, split) : prompt);
  }
  function prepareContext(
    value: unknown,
    autoSend = false,
    record?: AssistantRecordContext,
    analyticsFilters?: Record<string, string>,
  ) {
    if (busy || actionBusy || historyBusy) return;
    const context = assistantContextPrompt(value, session.current.restartOnOpen ? '' : text);
    if (!context) return;
    openChat();
    setError('');
    setShowHistory(false);
    if (context.needsReplacement) {
      setPendingContext(context.prompt);
      setPendingRecord(record);
      setPendingAnalytics(analyticsFilters);
    } else {
      setPendingContext(undefined);
      setPendingRecord(undefined);
      setPendingAnalytics(undefined);
      if (autoSend) {
        beginPeopleSearch(context.prompt);
      } else {
        peopleContext.current = undefined;
        useRecordPrompt(context.prompt, record, analyticsFilters);
      }
    }
    return true;
  }
  function beginPeopleSearch(prompt: string) {
    newChat();
    peopleContext.current = prompt;
    setMessages([
      {
        role: 'assistant',
        content: `What work or project do you need people for? Tell me the skills or certifications you have in mind, and I’ll clarify the rest.\n\nStarting scope: ${peopleSearchUserText(prompt).replace(/^Find people in /, '')}. You can narrow it within your authorized scopes.`,
      },
    ]);
  }
  useEffect(() => {
    const contextual = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          prompt?: unknown;
          autoSend?: boolean;
          record?: AssistantRecordContext;
          analyticsFilters?: Record<string, string>;
        }>
      ).detail;
      if (
        prepareContext(
          detail?.prompt,
          detail?.autoSend === true,
          detail?.record,
          detail?.analyticsFilters,
        )
      ) {
        event.preventDefault();
        if (event.cancelable)
          requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
      }
    };
    window.addEventListener('assistant-context-request', contextual);
    return () => window.removeEventListener('assistant-context-request', contextual);
  }, [busy, actionBusy, historyBusy, text, location.key]);
  useEffect(() => {
    setPendingContext(undefined);
    setPendingRecord(undefined);
    setPendingAnalytics(undefined);
    setRecordContext(undefined);
    recordActionController.current?.abort();
  }, [location.key]);

  async function runRecordAction(action: AssistantRecordAction) {
    if (busy || actionBusy || historyBusy || actionController.current) return;
    const controller = new AbortController();
    actionController.current = controller;
    recordActionController.current = controller;
    setActionBusy(true);
    setError('');
    try {
      await action.run(controller.signal);
      if (!controller.signal.aborted) collapse(false);
    } catch (reason) {
      if (!controller.signal.aborted) {
        if ([401, 403, 404].includes((reason as { status?: number }).status ?? 0))
          setRecordContext(undefined);
        setError((reason as Error).message);
      }
    } finally {
      if (recordActionController.current === controller) recordActionController.current = null;
      if (actionController.current === controller) {
        actionController.current = null;
        setActionBusy(false);
      }
    }
  }
  useEffect(() => {
    if (open) (status?.configured ? input.current : closeButton.current)?.focus();
  }, [open, status?.configured]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !document &&
        reviewSkill === undefined &&
        !requestDraft &&
        !window.document.querySelector('dialog[open]')
      ) {
        event.preventDefault();
        collapse();
      }
    };
    window.document.addEventListener('keydown', escape);
    return () => window.document.removeEventListener('keydown', escape);
  }, [open, document, messages, reviewSkill, requestDraft]);
  const isReplyArriving = Boolean(arrivingReply && messages.at(-1) === arrivingReply && !busy);
  useEffect(() => {
    if (!open || !arrivingReply) return;
    const timer = window.setTimeout(() => setArrivingReply(undefined), 650);
    return () => window.clearTimeout(timer);
  }, [open, arrivingReply]);
  useEffect(() => {
    const log = messageLog.current;
    if (!open || !log) return;
    const reply = replyStart.current;
    if (reply) {
      const top = reply.getBoundingClientRect().top - log.getBoundingClientRect().top;
      log.scrollTop += top - 16;
    } else {
      log.scrollTop = log.scrollHeight;
    }
  }, [messages, busy, open, showHistory]);
  useEffect(() => {
    if (!open) return;
    let controller: AbortController | undefined;
    const refreshNavigation = () => {
      controller?.abort();
      const pending = new AbortController();
      controller = pending;
      setNavigation({ pages: [], canReviewOwnSkill: false });
      authenticatedFetch('/api/assistant/navigation', { signal: pending.signal })
        .then(async response => {
          const body = await response.json().catch(() => undefined);
          if (!response.ok || !body) throw Error('Assistant actions could not be verified.');
          if (!pending.signal.aborted) {
            setNavigation(body);
            setStatus(body.status);
          }
        })
        .catch(err => {
          if (!pending.signal.aborted) {
            setStatus(undefined);
            setError(err.message);
          }
        });
    };
    refreshNavigation();
    window.addEventListener('workspace-access-updated', refreshNavigation);
    return () => {
      window.removeEventListener('workspace-access-updated', refreshNavigation);
      controller?.abort();
    };
  }, [open, location.pathname, location.search]);
  async function action(
    destination: string,
    kind: 'open_page' | 'review_own_skill',
    skill?: SkillHandoff,
  ) {
    if (actionBusy || busy || historyBusy) return;
    setActionBusy(true);
    setError('');
    setActionNotice('');
    const pending = new AbortController();
    actionController.current = pending;
    try {
      const response = await authenticatedFetch('/api/assistant/navigation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination, action: kind }),
        signal: pending.signal,
      });
      const body = await response.json().catch(() => undefined);
      if (pending.signal.aborted) return;
      if (!response.ok) throw Error(body?.error?.message ?? 'Assistant action is unavailable.');
      if (kind === 'review_own_skill') setReviewSkill(skill);
      else {
        navigate(body.destination);
        setActionNotice('Opened ' + body.label + '. Your chat stays here.');
      }
    } catch (err) {
      if (!pending.signal.aborted)
        setError(err instanceof Error ? err.message : 'Could not open this action.');
    } finally {
      if (actionController.current === pending) {
        actionController.current = null;
        setActionBusy(false);
      }
    }
  }
  async function historyRequest(path = '', method = 'GET', signal?: AbortSignal) {
    const response = await authenticatedFetch('/api/assistant/conversations' + path, {
      method,
      signal,
    });
    const body = await response.json().catch(() => undefined);
    if (!response.ok)
      throw new Error(body?.error?.message ?? 'Chat history is unavailable. Please retry.');
    return body;
  }
  function beginHistory() {
    historyController.current?.abort();
    const pending = new AbortController();
    historyController.current = pending;
    setHistoryBusy(true);
    setError('');
    return pending;
  }
  function endHistory(pending: AbortController) {
    if (historyController.current === pending) {
      historyController.current = null;
      setHistoryBusy(false);
    }
  }
  async function loadHistory() {
    const pending = beginHistory();
    try {
      const body = await historyRequest('', 'GET', pending.signal);
      if (!pending.signal.aborted) setChats(body.conversations);
    } catch (err) {
      if (!pending.signal.aborted)
        setError(err instanceof Error ? err.message : 'Could not load chats.');
    } finally {
      endHistory(pending);
    }
  }
  async function resume(id: string) {
    if (busy || historyBusy || actionBusy) return;
    const pending = beginHistory(),
      epoch = session.current.epoch;
    try {
      const body = await historyRequest('/' + id, 'GET', pending.signal);
      if (pending.signal.aborted || !session.current.completion(epoch).current) return;
      conversationId.current = id;
      peopleContext.current = [...(body.messages as ChatMessage[])]
        .reverse()
        .find(
          m =>
            m.role === 'user' &&
            m.content.startsWith('Find people') &&
            m.content.includes('Use conversational search, not a saved demand form.'),
        )
        ?.content.split('\nThe initial question')[0];
      setMessages(body.messages);
      setError(
        body.contextReset
          ? 'Your access changed. Earlier messages are hidden; continue with your current permissions.'
          : '',
      );
      setPendingContext(undefined);
      setPendingRecord(undefined);
      setPendingAnalytics(undefined);
      analyticsContext.current = undefined;
      setRecordContext(undefined);
      setText('');
      setDocument(undefined);
      setShowHistory(false);
    } catch (err) {
      if (!pending.signal.aborted)
        setError(err instanceof Error ? err.message : 'Could not open chat.');
    } finally {
      endHistory(pending);
    }
  }
  async function deleteChat(id: string) {
    if (busy || historyBusy || actionBusy) return;
    const pending = beginHistory(),
      epoch = session.current.epoch;
    try {
      await historyRequest('/' + id, 'DELETE', pending.signal);
      if (pending.signal.aborted || !session.current.completion(epoch).current) return;
      setChats(current => current.filter(chat => chat.id !== id));
      if (conversationId.current === id) {
        conversationId.current = undefined;
        setMessages([]);
        setText('');
      }
    } catch (err) {
      if (!pending.signal.aborted)
        setError(err instanceof Error ? err.message : 'Could not delete chat.');
    } finally {
      endHistory(pending);
    }
  }
  function close() {
    peopleContext.current = undefined;
    historyController.current?.abort();
    setHistoryBusy(false);
    actionController.current?.abort();
    session.current.close();
    setPendingContext(undefined);
    collapse();
  }
  async function checkRecordForSend() {
    if (!currentRecord?.reload) return true;
    if (actionController.current) return false;
    const pending = new AbortController();
    actionController.current = pending;
    recordActionController.current = pending;
    setActionBusy(true);
    setError('');
    try {
      const latest = await currentRecord.reload(pending.signal);
      if (pending.signal.aborted) return false;
      const split = latest.prompt.indexOf(recordFactsSeparator);
      if (split < 0) throw new Error('Record context could not be refreshed.');
      const facts = latest.prompt.slice(split + recordFactsSeparator.length);
      setRecordContext({
        ...latest.record,
        reload: currentRecord.reload,
        facts,
        locationKey: currentRecord.locationKey,
      });
      if (facts === currentRecord.facts) {
        setActionNotice('');
        return true;
      }
      setActionNotice('The record changed. Review the updated context and send again.');
      return false;
    } catch (error) {
      if (!pending.signal.aborted) {
        if ([401, 403, 404].includes((error as { status?: number }).status ?? 0))
          setRecordContext(undefined);
        setError((error as Error).message);
      }
      return false;
    } finally {
      if (recordActionController.current === pending) recordActionController.current = null;
      if (actionController.current === pending) {
        actionController.current = null;
        setActionBusy(false);
      }
    }
  }
  async function send(prompt?: string) {
    if (busy || historyBusy || actionBusy || !(prompt ?? text).trim() || !status?.configured)
      return;
    const outgoing = peopleContext.current
      ? `${peopleContext.current}\nThe initial question has already been asked. Use these requirements now; clarify only essential missing details.\nUser requirements:\n${(prompt ?? text).trim()}`
      : currentRecord && !prompt
        ? `${text.trim()}${recordFactsSeparator}${currentRecord.facts}\n\nExplain the recorded facts first, then give the next step. Clearly identify anything the record does not establish.`
        : (prompt ?? text).trim();
    if (outgoing.length > 2000) {
      setError('This message is too long. Shorten it before sending.');
      return;
    }
    if (!prompt && currentRecord && !(await checkRecordForSend())) return;
    const analytics = prompt ? undefined : analyticsContext.current;
    input.current?.focus({ preventScroll: true });
    const next: ChatMessage[] = [...messages, { role: 'user', content: (prompt ?? text).trim() }];
    setPendingContext(undefined);
    setPendingRecord(undefined);
    setPendingAnalytics(undefined);
    setMessages(current => [...current, next.at(-1)!]);
    setText('');
    setBusy(true);
    setError('');
    const epoch = session.current.epoch;
    const pending = new AbortController();
    controller.current = pending;
    try {
      const response = await authenticatedFetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: outgoing,
          conversationId: conversationId.current,
          currentPage: location.pathname + location.search,
          analyticsFilters: analytics,
        }),
        signal: pending.signal,
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok)
        throw new Error(body?.error?.message ?? 'AI could not reply. Please try again.');
      if (!pending.signal.aborted) {
        const completion = session.current.completion(epoch);
        if (completion.current) {
          if (analyticsContext.current === analytics) analyticsContext.current = undefined;
          conversationId.current = body.conversationId;
          setShowHistory(false);
          const reply: ChatMessage = {
            role: 'assistant',
            content: body.reply,
            sources: body.sources,
            artifact: body.artifact,
            peopleSearch: body.peopleSearch,
          };
          setMessages(current => [...current, reply]);
          if (!completion.notify) setArrivingReply(reply);
        }
        if (completion.notify) setUnread(true);
      }
    } catch (err) {
      if (!pending.signal.aborted) {
        if (session.current.completion(epoch).current) {
          setError(err instanceof Error ? err.message : 'Could not send message.');
          setText(next.at(-1)!.content);
          setMessages(current => current.slice(0, -1));
        }
        if (!session.current.visible) setUnread(true);
      }
    } finally {
      if (controller.current === pending) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  return (
    <>
      <button
        ref={launcher}
        className="assistant-launcher"
        hidden={open}
        aria-label="Open AI assistant"
        aria-expanded={open}
        aria-controls="assistant-panel"
        onClick={openChat}
      >
        <span className="assistant-launcher-greeting" aria-hidden="true">
          <span className="assistant-greeting-text">May I help you?</span>
        </span>
        <span className="assistant-mascot" aria-hidden="true">
          <img className="assistant-mascot-body" src="/brand/assistant-robot-red.webp" alt="" />
          <span className="assistant-mascot-head">
            <img src="/brand/assistant-robot-red.webp" alt="" />
          </span>
          <span className="assistant-mascot-brand">
            <img src="/brand/skill-genie-badge.webp" alt="" />
          </span>
          <img className="assistant-mascot-hand" src="/brand/assistant-robot-hand.webp" alt="" />
        </span>
        {(unread || busy) && (
          <i
            className={'assistant-reply-badge' + (busy ? ' is-pending' : '')}
            aria-label={busy ? 'AI is replying in the background' : 'AI reply ready'}
          />
        )}
      </button>
      <div className="assistant-drawer">
        <section
          id="assistant-panel"
          className={'assistant-panel' + (open ? ' is-open' : '')}
          role="dialog"
          aria-label="AI assistant"
          aria-hidden={!open}
          inert={!open}
        >
          <span
            className="assistant-side-mascot"
            data-state={busy ? 'thinking' : open && isReplyArriving ? 'reply' : 'idle'}
            aria-hidden="true"
          >
            <span className="assistant-side-peek">
              <span className="assistant-side-genie">
                <img src="/brand/assistant-side-peek.webp" alt="" />
                <img
                  className="assistant-side-thinking"
                  src="/brand/assistant-side-thinking.webp"
                  alt=""
                />
              </span>
            </span>
            {busy && (
              <span className="assistant-thought-cloud">
                <span className="assistant-thinking-dots">
                  <span />
                  <span />
                  <span />
                </span>
              </span>
            )}
          </span>
          <header>
            <Bot size={20} aria-hidden="true" />
            <div className="assistant-header-title">
              <strong>Skill Genie</strong>
              <small>
                {navigation.pages.some(page => page.url === '/requests' || page.url === '/learning')
                  ? 'App workflows, drafts & workspace help'
                  : 'Skills, approvals & workspace help'}
              </small>
            </div>
            <button
              aria-label="Recent AI chats"
              aria-expanded={showHistory}
              disabled={busy || historyBusy || actionBusy}
              onClick={() => {
                setShowHistory(current => !current);
                if (!showHistory) {
                  setUnread(false);
                  void loadHistory();
                }
              }}
            >
              <History size={17} />
              {unread && (
                <i
                  className="assistant-reply-badge"
                  aria-label="A background chat has a new reply"
                />
              )}
            </button>
            <button
              aria-label="New AI conversation"
              disabled={busy || historyBusy || actionBusy}
              onClick={newChat}
            >
              <RotateCw size={17} />
            </button>
            <button
              ref={closeButton}
              title="Close · start a new chat next time"
              aria-label="Close AI assistant"
              onClick={close}
            >
              <X size={19} />
            </button>
          </header>
          {showHistory && (
            <section className="assistant-history" aria-label="Recent conversations">
              <strong>Recent chats</strong>
              <p>
                Only your 2 most recent chats are kept. Each chat keeps up to 20 recent exchanges;
                earlier context is shortened.
              </p>
              {historyBusy && <p role="status">Loading…</p>}
              {!historyBusy && !chats.length && <p>No saved chats yet.</p>}
              {chats.map(chat => (
                <div className="assistant-history-row" key={chat.id}>
                  <button
                    disabled={busy || historyBusy || actionBusy}
                    aria-pressed={conversationId.current === chat.id}
                    onClick={() => void resume(chat.id)}
                  >
                    <strong>{chat.title}</strong>
                    <small>{new Date(chat.updatedAt).toLocaleString()}</small>
                  </button>
                  <button
                    disabled={busy || historyBusy || actionBusy}
                    aria-label={'Delete chat: ' + chat.title}
                    onClick={() => void deleteChat(chat.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </section>
          )}
          <div ref={messageLog} className="assistant-messages" role="log" aria-live="polite">
            {!status && !error && <p>Checking connection…</p>}
            {status && !status.configured && (
              <div className="assistant-empty">
                <Bot size={28} />
                <strong>Model connection pending</strong>
                <p>The assistant is integrated. Connect a model on the server to start chatting.</p>
              </div>
            )}
            {status?.configured && (
              <div className="assistant-message assistant">
                <small>Skill Genie</small>
                <p>Hello, I’m Skill Genie. How can I help you?</p>
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={index}
                ref={isReplyArriving && message === arrivingReply ? replyStart : undefined}
                className={
                  'assistant-message ' +
                  message.role +
                  (isReplyArriving && message === arrivingReply ? ' is-arriving' : '')
                }
              >
                <small>{message.role === 'user' ? 'You' : 'Skill Genie'}</small>
                {message.role === 'assistant' ? (
                  <AssistantRichText>{message.content}</AssistantRichText>
                ) : (
                  <p>{peopleSearchUserText(message.content)}</p>
                )}
                {message.artifact && (
                  <AssistantOutput
                    artifact={message.artifact}
                    onReview={
                      navigation.canReviewOwnSkill
                        ? (description, intent) => {
                            const artifact = message.artifact!;
                            // Older conversation cards included the suggested proficiency in the title.
                            const name =
                              artifact.skill?.name ??
                              artifact.title
                                .replace(
                                  /\s+[—–-]\s+(?:beginner|foundation|autonomous|experienced|expert|level\s+\d)\b.*$/i,
                                  '',
                                )
                                .trim();
                            void action('/my-skills', 'review_own_skill', {
                              id: artifact.skill?.id,
                              name,
                              description,
                              intent,
                            });
                          }
                        : undefined
                    }
                    onReviewBusiness={
                      message.artifact.kind === 'amendment_draft' && navigation.canDraftAmendment
                        ? draft => void reviewBusiness(draft)
                        : undefined
                    }
                    onReviewAnnouncement={
                      navigation.canDraftAnnouncement
                        ? draft => void reviewAnnouncement(draft)
                        : undefined
                    }
                    onReviewRequest={
                      (message.artifact.kind === 'request_draft' && navigation.canDraftRequest) ||
                      (message.artifact.kind === 'incident_draft' && navigation.canDraftIncident)
                        ? draft => void reviewRequest(draft)
                        : undefined
                    }
                    onReviewPlan={
                      navigation.canManageLearning === true
                        ? draft => void reviewPlan(draft)
                        : undefined
                    }
                    onDocument={content => setDocument({ content, sources: message.sources })}
                  />
                )}{' '}
                {message.peopleSearch && (
                  <AssistantPeopleResults query={message.peopleSearch.query} />
                )}
                {message.sources?.map((source, i) => (
                  <small className="assistant-source" key={i}>
                    {source.label}
                  </small>
                ))}
                {message.role === 'assistant' && (
                  <div className="assistant-output-actions">
                    {assistantNavigationTargets(
                      message.content,
                      message.sources ?? [],
                      navigation.pages,
                    ).map(page => (
                      <button
                        key={page.url}
                        type="button"
                        className="secondary-button"
                        disabled={actionBusy || busy || historyBusy}
                        onClick={() => void action(page.url, 'open_page')}
                      >
                        Open {page.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="assistant-thinking" role="status">
                <span className="assistant-thinking-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                {messages.length ? 'Thinking…' : 'Finishing your previous chat…'}
              </div>
            )}
          </div>
          {pendingContext && (
            <section className="assistant-context-choice" aria-label="Keep your unsent message">
              <strong>You have an unsent message</strong>
              <p>Keep it, or replace it with the selected AI shortcut.</p>
              <div>
                <button
                  className="secondary-button"
                  disabled={busy || actionBusy || historyBusy}
                  onClick={() => {
                    if (
                      pendingContext.startsWith('Find people') &&
                      pendingContext.includes('Use conversational search')
                    )
                      beginPeopleSearch(pendingContext);
                    else useRecordPrompt(pendingContext, pendingRecord, pendingAnalytics);
                    setPendingContext(undefined);
                    setPendingRecord(undefined);
                    setPendingAnalytics(undefined);
                    input.current?.focus();
                  }}
                >
                  Replace message
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setPendingContext(undefined);
                    setPendingRecord(undefined);
                    setPendingAnalytics(undefined);
                  }}
                >
                  Keep my message
                </button>
              </div>
            </section>
          )}
          {currentRecord && !showHistory && (
            <section
              className="assistant-context-choice assistant-record-context"
              aria-label="Current record context"
            >
              <details>
                <summary>{currentRecord.label}</summary>
                <small>Included when you send a message</small>
                <p>{currentRecord.facts}</p>
              </details>
              <div>
                {currentRecord.actions.map(action => (
                  <button
                    type="button"
                    className="secondary-button"
                    key={action.label}
                    disabled={busy || actionBusy || historyBusy}
                    onClick={() => void runRecordAction(action)}
                  >
                    {action.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || actionBusy}
                  onClick={() => setRecordContext(undefined)}
                >
                  Remove context
                </button>
              </div>
            </section>
          )}
          {actionNotice && (
            <p className="assistant-action-notice" role="status">
              {actionNotice}
            </p>
          )}
          {error && (
            <p className="assistant-error" role="alert">
              {error}
            </p>
          )}
          {Boolean(navigation.suggestions?.length) && (
            <nav className="assistant-faq" aria-label="AI help shortcuts">
              {navigation.suggestions!.map(s => (
                <button
                  type="button"
                  key={s.label}
                  disabled={busy || actionBusy || historyBusy}
                  onClick={() => {
                    prepareContext(s.prompt);
                    requestAnimationFrame(() => input.current?.focus());
                  }}
                >
                  {s.label}
                </button>
              ))}
            </nav>
          )}
          <form
            onSubmit={event => {
              event.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="assistant-message">
              Message AI assistant
            </label>
            <textarea
              id="assistant-message"
              ref={input}
              value={text}
              maxLength={2000}
              rows={2}
              placeholder="Ask about this workspace…"
              disabled={!status?.configured || historyBusy || actionBusy}
              readOnly={busy}
              onChange={event => {
                if (!event.target.value.trim()) analyticsContext.current = undefined;
                setText(event.target.value);
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button
              aria-label="Send AI message"
              disabled={busy || historyBusy || actionBusy || !text.trim() || !status?.configured}
            >
              <Send size={18} />
            </button>
          </form>
        </section>
        <button
          type="button"
          className="assistant-collapse-handle"
          hidden={!open}
          aria-label="Collapse AI assistant and resume later"
          aria-controls="assistant-panel"
          title="Collapse · resume this chat"
          onClick={() => collapse()}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      {document && <AssistantDocument document={document} onClose={() => setDocument(undefined)} />}{' '}
      {reviewSkill && (
        <Suspense fallback={<div role="status">Opening Add skill…</div>}>
          <CapabilityComposer
            initialSkill={reviewSkill}
            onClose={() => setReviewSkill(undefined)}
            onSaved={() => setReviewSkill(undefined)}
          />
        </Suspense>
      )}{' '}
      {requestDraft && (
        <Suspense fallback={<div role="status">Opening request review…</div>}>
          <RequestComposer
            options={requestDraft.options}
            draft={requestDraft}
            onClose={() => setRequestDraft(undefined)}
            onSaved={() => {
              setRequestDraft(undefined);
              setActionNotice('Request submitted. Your recipient has been notified.');
              window.dispatchEvent(new Event('requests-updated'));
              window.dispatchEvent(new Event('notifications-updated'));
            }}
          />
        </Suspense>
      )}
    </>
  );
}
