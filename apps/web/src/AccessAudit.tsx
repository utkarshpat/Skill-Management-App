import { useEffect, useState } from 'react';
import { authenticatedFetch } from './auth';
interface Entry {
  revision: number;
  action: string;
  at: string;
  actorId: string;
  targetId: string;
  actorName?: string;
  targetName?: string;
  before?: unknown;
  after?: unknown;
}
interface Page {
  items: Entry[];
  nextCursor: number | null;
  hasMore: boolean;
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
    [attempt, setAttempt] = useState(0);
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
          details: personId ? 'true' : 'false',
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
              <th>Actor</th>
              <th>Target</th>
              {personId && <th>Details</th>}
            </tr>
          </thead>
          <tbody>
            {!page.items.length && (
              <tr>
                <td colSpan={personId ? 5 : 4}>No matching changes recorded.</td>
              </tr>
            )}
            {page.items.map(item => (
              <tr key={item.revision}>
                <td>
                  <time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time>
                </td>
                <td className="audit-action">
                  {item.action.replaceAll('.', ' ').replaceAll('_', ' ')}
                </td>
                <td>{item.actorName ?? item.actorId}</td>
                <td>{item.targetName ?? item.targetId}</td>
                {personId && (
                  <td>
                    <details>
                      <summary>Before / after</summary>
                      <pre>
                        {JSON.stringify({ before: item.before, after: item.after }, null, 2)}
                      </pre>
                    </details>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
