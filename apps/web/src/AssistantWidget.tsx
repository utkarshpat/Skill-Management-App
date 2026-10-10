import { businessDraftHandoff, type BusinessDraft } from './business/business-draft-handoff';
import { learningDraftHandoff } from './learning-draft-handoff';
import { AssistantSession } from './assistant-session';
import { assistantContextPrompt } from './assistant-context';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router';
import { RequestComposer } from './RequestComposer';
import { requestRead, type RequestOptions } from './request-model';
import { MySkills, type SkillSaveResult } from './MySkills';
import { assistantNavigationTargets, type AssistantPage } from './assistant-actions';
import { Bot, X, Send, RotateCcw, History, Trash2, ChevronRight } from 'lucide-react';
import { authenticatedFetch } from './auth';
import { AssistantOutput, type Artifact } from './AssistantOutput';
import { AssistantRichText } from './AssistantRichText';
import { AssistantDocument, type AiDocument } from './AssistantDocument';
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: { label: string; url: string }[];
  artifact?: Artifact;
}
export function AssistantWidget() {
  const navigate = useNavigate(),
    location = useLocation();
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
    canDraftDemand?: boolean;
    canDraftAmendment?: boolean;
    suggestions?: { label: string; destination: string; prompt: string }[];
  }>({ pages: [], canReviewOwnSkill: false });
  async function reviewBusiness(draft: BusinessDraft) {
    if (actionBusy || busy || historyBusy) return;
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
      if (
        !response.ok ||
        current.actorId !== navigation.actorId ||
        !(draft.kind === 'amendment_draft' ? current.canDraftAmendment : current.canDraftDemand)
      )
        throw Error('Your current access does not allow this business draft.');
      const ticket = businessDraftHandoff.offer(current.actorId, draft);
      collapse();
      navigate(
        '/business?tab=' +
          (draft.kind === 'amendment_draft' ? 'amendments' : 'demand') +
          '&draftTicket=' +
          encodeURIComponent(ticket),
      );
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
    [reviewDescription, setReviewDescription] = useState<string>(),
    [actionNotice, setActionNotice] = useState('');
  const [skillSubmissionFailure, setSkillSubmissionFailure] =
    useState<Extract<SkillSaveResult, { status: 'SUBMISSION_FAILED' }>>();
  function skillSaved(result: SkillSaveResult) {
    setReviewDescription(undefined);
    if (result.status === 'SUBMISSION_FAILED') {
      setSkillSubmissionFailure(result);
      setActionNotice('');
    } else
      setActionNotice(
        result.status === 'SUBMITTED'
          ? 'Skill submitted to your assigned reporting manager.'
          : 'Skill draft saved. It remains unverified.',
      );
  }
  useEffect(() => {
    const submitted = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      setSkillSubmissionFailure(current => (current?.id === id ? undefined : current));
    };
    window.addEventListener('own-skill-submitted', submitted);
    return () => window.removeEventListener('own-skill-submitted', submitted);
  }, []);
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
  function collapse() {
    session.current.collapse();
    setOpen(false);
    requestAnimationFrame(() => launcher.current?.focus());
  }
  const historyController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const controller = useRef<AbortController | null>(null),
    input = useRef<HTMLTextAreaElement>(null),
    launcher = useRef<HTMLButtonElement>(null),
    latest = useRef<HTMLDivElement>(null),
    closeButton = useRef<HTMLButtonElement>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      actionController.current?.abort();
      historyController.current?.abort();
    },
    [],
  );
  function prepareContext(value: unknown) {
    if (busy || actionBusy || historyBusy) return;
    const context = assistantContextPrompt(value, session.current.restartOnOpen ? '' : text);
    if (!context) return;
    openChat();
    setError('');
    setShowHistory(false);
    if (context.needsReplacement) setPendingContext(context.prompt);
    else {
      setPendingContext(undefined);
      setText(context.prompt);
    }
  }
  useEffect(() => {
    const contextual = (event: Event) =>
      prepareContext((event as CustomEvent<{ prompt?: unknown }>).detail?.prompt);
    window.addEventListener('assistant-context-request', contextual);
    return () => window.removeEventListener('assistant-context-request', contextual);
  }, [busy, actionBusy, historyBusy, text]);
  useEffect(() => {
    if (open) (status?.configured ? input.current : closeButton.current)?.focus();
  }, [open, status?.configured]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document && reviewDescription === undefined && !requestDraft) {
        event.preventDefault();
        collapse();
      }
    };
    window.document.addEventListener('keydown', escape);
    return () => window.document.removeEventListener('keydown', escape);
  }, [open, document, messages, reviewDescription, requestDraft]);
  useEffect(() => {
    if (open) latest.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, busy, open]);
  useEffect(() => {
    if (!open) return;
    const pending = new AbortController();
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
    return () => pending.abort();
  }, [open, location.pathname, location.search]);
  async function action(
    destination: string,
    kind: 'open_page' | 'review_own_skill',
    description?: string,
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
      if (kind === 'review_own_skill') setReviewDescription(description);
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
      setMessages(body.messages);
      setError(
        body.contextReset
          ? 'Your access changed. Earlier messages are hidden; continue with your current permissions.'
          : '',
      );
      setPendingContext(undefined);
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
    historyController.current?.abort();
    setHistoryBusy(false);
    actionController.current?.abort();
    session.current.close();
    setPendingContext(undefined);
    collapse();
  }
  async function send(prompt?: string) {
    if (busy || historyBusy || actionBusy || !(prompt ?? text).trim() || !status?.configured)
      return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: (prompt ?? text).trim() }];
    setPendingContext(undefined);
    setMessages(next);
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
          message: next.at(-1)!.content,
          conversationId: conversationId.current,
        }),
        signal: pending.signal,
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok)
        throw new Error(body?.error?.message ?? 'AI could not reply. Please try again.');
      if (!pending.signal.aborted) {
        if (session.current.completion(epoch).current) {
          conversationId.current = body.conversationId;
          setShowHistory(false);
          setMessages(current => [
            ...current,
            {
              role: 'assistant',
              content: body.reply,
              sources: body.sources,
              artifact: body.artifact,
            },
          ]);
        }
        if (session.current.completion(epoch).notify) setUnread(true);
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
        <Bot size={25} />
        <span>AI</span>
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
          <header>
            <Bot size={20} />
            <div>
              <strong>AI assistant</strong>
              <small>Answers, drafts & learning practice</small>
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
              <RotateCcw size={17} />
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
          <div className="assistant-messages" role="log" aria-live="polite">
            {!status && !error && <p>Checking connection…</p>}
            {status && !status.configured && (
              <div className="assistant-empty">
                <Bot size={28} />
                <strong>Model connection pending</strong>
                <p>The assistant is integrated. Connect a model on the server to start chatting.</p>
              </div>
            )}
            {status?.configured && !messages.length && (
              <div className="assistant-empty">
                <strong>How can I help?</strong>
                <p>Ask for guidance on features available to you, or prepare a draft for review.</p>
                <div className="assistant-output-actions">
                  {navigation.suggestions
                    ?.filter(
                      s =>
                        s.destination === '/workspace' ||
                        s.destination === location.pathname + location.search ||
                        s.destination === location.pathname,
                    )
                    .map(s => (
                      <button
                        key={s.label}
                        className="secondary-button"
                        disabled={busy || actionBusy || historyBusy}
                        onClick={() => prepareContext(s.prompt)}
                      >
                        {s.label}
                      </button>
                    ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={index} className={'assistant-message ' + message.role}>
                <small>{message.role === 'user' ? 'You' : 'Assistant'}</small>
                {message.role === 'assistant' ? (
                  <AssistantRichText>{message.content}</AssistantRichText>
                ) : (
                  <p>{message.content}</p>
                )}
                {message.artifact && (
                  <AssistantOutput
                    artifact={message.artifact}
                    onReview={
                      navigation.canReviewOwnSkill
                        ? description => void action('/my-skills', 'review_own_skill', description)
                        : undefined
                    }
                    onReviewBusiness={
                      (
                        message.artifact.kind === 'amendment_draft'
                          ? navigation.canDraftAmendment
                          : navigation.canDraftDemand
                      )
                        ? draft => void reviewBusiness(draft)
                        : undefined
                    }
                    onReviewRequest={draft => void reviewRequest(draft)}
                    onReviewPlan={
                      navigation.canManageLearning === true
                        ? draft => void reviewPlan(draft)
                        : undefined
                    }
                    onDocument={content => setDocument({ content, sources: message.sources })}
                  />
                )}{' '}
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
              <p role="status">{messages.length ? 'Thinking…' : 'Finishing your previous chat…'}</p>
            )}
            <div ref={latest} />
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
                    setText(pendingContext);
                    setPendingContext(undefined);
                    input.current?.focus();
                  }}
                >
                  Replace message
                </button>
                <button className="secondary-button" onClick={() => setPendingContext(undefined)}>
                  Keep my message
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
          {skillSubmissionFailure && (
            <div className="assistant-error" role="alert">
              <p>{skillSubmissionFailure.message}</p>
              <Link
                className="secondary-button"
                to={'/my-skills?submitClaim=' + encodeURIComponent(skillSubmissionFailure.id)}
                onClick={collapse}
              >
                Review saved draft and retry submission
              </Link>
              <button
                className="secondary-button"
                onClick={() => setSkillSubmissionFailure(undefined)}
              >
                Dismiss
              </button>
            </div>
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
              placeholder="Ask a question…"
              disabled={!status?.configured || busy || historyBusy || actionBusy}
              onChange={event => setText(event.target.value)}
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
          onClick={collapse}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      {document && <AssistantDocument document={document} onClose={() => setDocument(undefined)} />}{' '}
      {reviewDescription !== undefined && (
        <MySkills
          reviewRequest={{
            description: reviewDescription,
            onClose: () => setReviewDescription(undefined),
            onSaved: skillSaved,
          }}
        />
      )}{' '}
      {requestDraft && (
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
      )}
    </>
  );
}
