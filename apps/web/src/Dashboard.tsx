import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router';
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  CheckCircle2,
  Clock3,
  Inbox,
  Layers,
  Plus,
  Sparkles,
} from 'lucide-react';
import { authenticatedFetch } from './auth';
import { startActivityRefresh, type RefreshStatus } from './activity-refresh';
import { RefreshIndicator } from './RefreshIndicator';
import './dashboard.css';
import { DashboardQuickActions } from './DashboardQuickActions';
import {
  readDashboardOverview,
  type DashboardCardDefinition as Card,
  type DashboardOverview,
  type DashboardCardResult as CardResult,
} from './dashboard-overview';
import {
  DashboardRequests,
  type DashboardRequestsData,
  type RequestPreview,
} from './DashboardRequests';
import {
  DashboardCapability,
  type DashboardCapabilityData,
  type RecentCapabilityClaim,
} from './DashboardCapability';
import {
  DashboardLearning,
  learningTaskPrompt,
  type DashboardLearningData,
  type NextLearningTask,
} from './DashboardLearning';
import { DashboardAttention, type AttentionGroup } from './DashboardAttention';
type Manifest = DashboardOverview<CardData>;
interface Item {
  id: string;
  title: string;
  description: string;
  href: string;
  label: string;
  priority: number;
  urgency?: string;
}
interface CardData {
  canCreate?: boolean;
  recentRecords?: RequestPreview[];
  canClaim?: boolean;
  recentClaims?: RecentCapabilityClaim[];
  nextTask?: NextLearningTask | null;
  loggedMinutes?: number;
  groups?: AttentionGroup[];
  items?: Item[];
  total: number;
  partial?: boolean;
  verified?: number;
  pending?: number;
  draft?: number;
  changesRequested?: number;
  rejected?: number;
  activePlans?: number;
  progress?: number;
  completed?: number;
  overdue?: number;
  today?: number;
  submitted?: number;
  inProgress?: number;
  resolved?: number;
  cancelled?: number;
  canManage?: boolean;
}
async function read<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => undefined);
  if (!r.ok)
    throw Object.assign(Error(body?.error?.message ?? 'This information could not be loaded.'), {
      status: r.status,
    });
  return body;
}
export function openDashboardAssistant(card: Card['id']) {
  const prompts = {
    attention:
      'Help me prioritize my currently assigned requests, skill reviews and overdue learning tasks. Retrieve current authorized facts before advising.',
    learning:
      'Help me choose the next task in my own learning plans. Check my current progress and backlog first.',
    capability:
      'Help me improve my skill profile. Check my own reviewed, pending and draft claims; explain what I can update.',
    requests:
      'Help me check my own requests and their latest status. Retrieve current records and suggest permitted next steps.',
  };
  window.dispatchEvent(
    new CustomEvent('assistant-context-request', { detail: { prompt: prompts[card] } }),
  );
}
export function Dashboard() {
  const [manifest, setManifest] = useState<Manifest>(),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const [freshness, setFreshness] = useState<RefreshStatus>();
  useEffect(() => {
    const c = new AbortController();
    let generation = 0,
      running = false;
    const load = async () => {
      if (running) return;
      running = true;
      const n = ++generation;
      return authenticatedFetch('/api/dashboard/overview', { signal: c.signal })
        .then(readDashboardOverview<CardData>)
        .then(value => {
          if (!c.signal.aborted && n === generation) {
            setManifest(value);
            setError('');
          }
        })
        .catch(e => {
          if (!c.signal.aborted && n === generation) {
            setError(e.message);
            if ([401, 403, 409].includes(e.status)) setManifest(undefined);
          }
          return false;
        })
        .finally(() => {
          running = false;
        });
    };
    const stop = startActivityRefresh(
      load,
      [
        'notifications-updated',
        'notifications-remote-updated',
        'own-skills-updated',
        'requests-updated',
        'learning-updated',
        'workspace-access-updated',
      ],
      undefined,
      { pollMs: 300_000, onStatus: setFreshness },
    );
    return () => {
      stop();
      c.abort();
    };
  }, [attempt]);
  const renderCard = (card: Card) => (
    <DashboardCard
      key={manifest!.actorId + card.id}
      card={card}
      revision={manifest!.revision}
      snapshot={manifest!.cardData[card.id]!}
      ai={manifest!.ai}
      onAccessChanged={() => setAttempt(n => n + 1)}
    />
  );
  const leftCards =
    manifest?.cards.filter(card => card.id === 'learning' || card.id === 'requests') ?? [];
  const rightCards = manifest?.cards.filter(card => card.id === 'capability') ?? [];
  return (
    <div className="dashboard-workspace">
      <div className="dashboard-heading">
        <div>
          <h2>Your day, in focus</h2>
          <p>Move work forward, build skills and keep track of what changes.</p>
        </div>
      </div>
      <RefreshIndicator status={freshness} />
      {error && (
        <section className="dashboard-card" role="alert">
          <h3>{manifest ? 'Dashboard refresh failed' : 'Dashboard could not be loaded'}</h3>
          <p>
            {error}
            {manifest ? ' The values below may be out of date.' : ''}
          </p>
          <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
            Retry
          </button>
        </section>
      )}
      {!manifest && !error && (
        <div className="dashboard-grid" role="status" aria-label="Loading your dashboard">
          {[1, 2, 3].map(id => (
            <div key={id} className="dashboard-card dashboard-skeleton">
              <i />
              <i />
              <i />
            </div>
          ))}
        </div>
      )}
      {manifest && (
        <>
          <div className="dashboard-grid dashboard-flow">
            {manifest.cards.filter(card => card.id === 'attention').map(renderCard)}
            {leftCards.length > 0 && (
              <div className="dashboard-column">{leftCards.map(renderCard)}</div>
            )}
            {(rightCards.length > 0 || manifest.actions.length > 0) && (
              <div className="dashboard-column">
                {rightCards.map(renderCard)}
                <DashboardQuickActions
                  actions={manifest.actions}
                  onAssist={prompt =>
                    window.dispatchEvent(
                      new CustomEvent('assistant-context-request', { detail: { prompt } }),
                    )
                  }
                />
              </div>
            )}
          </div>
          {!manifest.cards.length && (
            <section className="dashboard-card">
              <h3>Your workspace is ready</h3>
              <p>Your assigned features will appear here when access is available.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
function DashboardCard({
  card,
  revision,
  snapshot,
  ai,
  onAccessChanged,
}: {
  card: Card;
  revision: number;
  snapshot: CardResult<CardData>;
  ai: boolean;
  onAccessChanged: () => void;
}) {
  const lastRevision = useRef(revision);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<CardData | undefined>(snapshot.data),
    [error, setError] = useState(snapshot.error?.message ?? ''),
    [retry, setRetry] = useState<{ snapshot: CardResult<CardData>; attempt: number }>(),
    [denied, setDenied] = useState(false),
    [requestStatus, setRequestStatus] = useState('');
  const attempt = retry?.snapshot === snapshot ? retry.attempt : 0;
  const retryCard = () => setRetry({ snapshot, attempt: attempt + 1 });
  useEffect(() => {
    const c = new AbortController();
    if (lastRevision.current !== revision) setData(undefined);
    lastRevision.current = revision;
    setRefreshing(true);
    setError('');
    setDenied(false);
    if (!attempt) {
      setData(snapshot.data);
      setError(snapshot.error?.message ?? '');
      setRefreshing(false);
      return () => c.abort();
    }
    authenticatedFetch(card.endpoint, { signal: c.signal })
      .then(read<CardData>)
      .then(value => {
        if (!c.signal.aborted) setData(value);
      })
      .catch(e => {
        if (!c.signal.aborted) {
          if ([401, 403, 409].includes(e.status)) {
            setData(undefined);
            setDenied(true);
            onAccessChanged();
          } else setError(e.message);
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setRefreshing(false);
      });
    return () => c.abort();
  }, [card.endpoint, revision, snapshot, attempt]);
  const Icon = { attention: Bell, learning: BookOpen, capability: Layers, requests: Inbox }[
    card.id
  ];
  if (denied) return null;
  const href = {
    attention: '/requests?inbox=true',
    learning: '/learning',
    capability: '/my-skills',
    requests: '/requests',
  }[card.id];
  return (
    <section
      className={
        'dashboard-card dashboard-' +
        card.id +
        (card.id === 'attention' && data?.total === 0 && !data.partial
          ? ' dashboard-caught-up'
          : '')
      }
      aria-label={card.title}
    >
      <header>
        <span className="dashboard-icon">
          <Icon size={20} />
        </span>
        <div>
          <h3>{card.title}</h3>
          <p>{card.description}</p>
        </div>
      </header>
      {refreshing && data && <small role="status">Refreshing...</small>}
      {error && (
        <div className="dashboard-error" role="alert">
          <p>
            {error}
            {data ? ' Displayed values may be out of date.' : ''}
          </p>
          <button className="secondary-button" onClick={retryCard}>
            Retry
          </button>
        </div>
      )}
      {!data ? (
        error ? null : (
          <div className="dashboard-skeleton" role="status" aria-label={'Loading ' + card.title}>
            <i />
            <i />
            <i />
          </div>
        )
      ) : (
        <>
          {card.id === 'attention' && (
            <DashboardAttention
              total={data.total}
              partial={data.partial}
              groups={data.groups}
              onRetry={retryCard}
            />
          )}
          {card.id === 'learning' && (
            <DashboardLearning
              data={data as DashboardLearningData}
              ai={ai}
              onHelp={task =>
                window.dispatchEvent(
                  new CustomEvent('assistant-context-request', {
                    detail: { prompt: learningTaskPrompt(task) },
                  }),
                )
              }
            />
          )}
          {card.id === 'capability' && (
            <DashboardCapability data={data as DashboardCapabilityData} />
          )}
          {card.id === 'requests' && (
            <DashboardRequests
              status={requestStatus}
              onStatusChange={setRequestStatus}
              fetcher={authenticatedFetch}
              data={data as DashboardRequestsData}
              onAccessChanged={() => {
                setData(undefined);
                setDenied(true);
                onAccessChanged();
              }}
            />
          )}
          {card.id === 'attention' && Boolean(data.items?.length) && (
            <p className="dashboard-learning-caption">
              Recent actionable items · Open a queue for the complete list.
            </p>
          )}
          {card.id === 'attention' && Boolean(data.items?.length) && (
            <ul className="dashboard-items">
              {data.items!.map(item => (
                <li key={item.id}>
                  <div>
                    {(item.urgency || item.priority >= 100) && (
                      <span className="dashboard-urgent">
                        <Clock3 size={12} />
                        {item.urgency ?? (card.id === 'learning' ? 'Overdue' : 'High priority')}
                      </span>
                    )}
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                  </div>
                  <Link className="dashboard-item-action" to={item.href}>
                    {item.label}
                    <ArrowUpRight size={15} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <footer>
            {card.id !== 'attention' && (
              <Link className="dashboard-link" to={href}>
                View{' '}
                {card.id === 'capability'
                  ? 'my skills'
                  : card.id === 'learning'
                    ? 'learning plans'
                    : 'all requests'}
                <ArrowUpRight size={15} />
              </Link>
            )}
            {ai && card.id !== 'learning' && (
              <button className="dashboard-ai" onClick={() => openDashboardAssistant(card.id)}>
                <Sparkles size={15} />
                {card.id === 'attention'
                  ? 'Help me prioritize'
                  : card.id === 'capability'
                    ? 'Help improve my profile'
                    : 'Help with my requests'}
              </button>
            )}
          </footer>
        </>
      )}
    </section>
  );
}
