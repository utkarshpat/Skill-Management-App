import { useEffect, useState } from 'react';
import { authenticatedFetch } from './auth';
import { AccessAuditDetails } from './AccessAuditDetails';
import './access-audit.css';
export interface Entry {
  revision: number;
  action: string;
  at: string;
  actorId: string;
  targetId: string;
  actorName?: string;
  targetName?: string;
  before?: unknown;
  after?: unknown;
  decisionItems?: { kind: string; name?: string; status?: string; feedback?: string }[];
  referenceNames?: { kind: string; id: string; name: string }[];
}
interface Page {
  items: Entry[];
  nextCursor: number | null;
  hasMore: boolean;
}
const actionLabels: Record<string, string> = {
  'capability.save': 'Submission draft saved',
  'capability.submit': 'Submission sent for approval',
  'capability.decide': 'Submission decision recorded',
  'capability.reroute': 'Submission rerouted',
  'capability.discard': 'Submission draft discarded',
  'capability.restore': 'Submission draft restored',
  'capability.publish_links': 'Skill and certificate links saved',
  'capability.intake_file.saved': 'Supporting file added',
  'claim.draft.created': 'Skill claim draft created',
  'claim.draft.updated': 'Skill claim draft updated',
  'claim.submitted': 'Skill claim sent for approval',
  'claim.approved': 'Skill claim approved',
  'claim.rejected': 'Skill claim rejected',
  'claim.changes_requested': 'Changes requested for skill claim',
  'claim.evidence.added': 'Skill claim evidence added',
  'certification.saved': 'Certificate saved',
  'certification.submitted': 'Certificate sent for approval',
  'certification.approved': 'Certificate approved',
  'certification.rejected': 'Certificate rejected',
  'certification.changes_requested': 'Changes requested for certificate',
};

function actionName(item: Entry) {
  return actionLabels[item.action] ?? item.action.replaceAll(/[._]/g, ' ');
}

function recordName(item: Entry) {
  if (item.targetName?.trim()) return item.targetName;
  if (item.action.startsWith('capability.')) return 'Capability submission';
  if (item.action.startsWith('claim.')) return 'Skill claim';
  if (item.action.startsWith('certification.')) return 'Certificate record';
  return 'Record name unavailable';
}

export function AccessAudit({
  endpoint,
  personId,
  query = '',
  recent = false,
  revision,
}: {
  endpoint: string;
  personId?: string;
  query?: string;
  recent?: boolean;
  revision: number;
}) {
  const [page, setPage] = useState<Page>(),
    [error, setError] = useState(''),
    [cursor, setCursor] = useState<number>(),
    [previous, setPrevious] = useState<(number | undefined)[]>([]),
    [attempt, setAttempt] = useState(0),
    [selected, setSelected] = useState<Entry>();
  // Remounting at a filter/revision change makes stale page/history responses impossible.
  useEffect(() => {
    const c = new AbortController();
    setPage(undefined);
    setError('');
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({
          pageSize: recent ? '5' : '25',
          q: query,
          details: 'false',
        });
        if (cursor) params.set('before', String(cursor));
        if (personId) params.set('personId', personId);
        authenticatedFetch(endpoint + '/audit?' + params, { signal: c.signal })
          .then(async r => {
            const data = await r.json().catch(() => undefined);
            if (!r.ok)
              throw Error(
                data?.error?.message ??
                  ([401, 403].includes(r.status)
                    ? 'Activity access is unavailable. Refresh your workspace.'
                    : 'Activity could not be loaded.'),
              );
            if (!data) throw Error('Activity could not be loaded.');
            if (!c.signal.aborted) setPage(data);
          })
          .catch(e => {
            if (!c.signal.aborted)
              setError(e instanceof Error ? e.message : 'Activity could not be loaded.');
          });
      },
      query ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [endpoint, personId, query, recent, revision, cursor, attempt]);
  if (error)
    return (
      <div role="alert">
        <p>{error}</p>
        <button className="secondary-button" onClick={() => setAttempt(a => a + 1)}>
          Retry activity
        </button>
      </div>
    );
  if (!page) return <p role="status">Loading activity…</p>;
  return (
    <>
      <div className="audit-scroll">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Changed by</th>
              <th>Affected record</th>
            </tr>
          </thead>
          <tbody>
            {!page.items.length && (
              <tr>
                <td colSpan={4}>No matching changes recorded.</td>
              </tr>
            )}
            {page.items.map(item => (
              <tr key={item.revision} className="activity-entry" onClick={() => setSelected(item)}>
                <td>
                  <time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time>
                </td>
                <td className="audit-action">
                  <button
                    type="button"
                    className="admin-text-button activity-open"
                    aria-haspopup="dialog"
                    onClick={event => {
                      event.stopPropagation();
                      setSelected(item);
                    }}
                  >
                    {actionName(item)}
                  </button>
                </td>
                <td>{item.actorName?.trim() || 'Actor name unavailable'}</td>
                <td>{recordName(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <AccessAuditDetails
          key={selected.revision}
          endpoint={endpoint}
          personId={personId}
          selected={selected}
          actionName={actionName(selected)}
          recordName={recordName(selected)}
          onClose={() => setSelected(undefined)}
        />
      )}
      {!recent && (
        <div className="compact-pagination">
          <span>Showing {page.items.length} changes · newest first</span>
          <button
            className="secondary-button"
            disabled={!previous.length}
            onClick={() => {
              setCursor(previous.at(-1));
              setPrevious(p => p.slice(0, -1));
            }}
          >
            Newer
          </button>
          <button
            className="secondary-button"
            disabled={!page.hasMore}
            onClick={() => {
              setPrevious(p => [...p, cursor]);
              setCursor(page.nextCursor ?? undefined);
            }}
          >
            Older
          </button>
        </div>
      )}
    </>
  );
}
