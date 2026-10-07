import { useEffect, useState } from 'react';
import { authenticatedFetch } from './auth';
interface History {
  history: { revision: number; action: string; at: string; actorName: string; feedback: string }[];
  total: number;
  pageSize: number;
}
const labels: Record<string, string> = {
  'claim.submitted': 'Submitted for review',
  'claim.approved': 'Approved',
  'claim.changes_requested': 'Changes requested',
  'claim.rejected': 'Not approved',
};
export function ReviewHistory({ id }: { id: string }) {
  const [data, setData] = useState<History>(),
    [page, setPage] = useState(1),
    [index, setIndex] = useState(0),
    [part, setPart] = useState(0),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setData(undefined);
    setError('');
    setPart(0);
    authenticatedFetch(`/api/skill-reviews/${id}?page=${page}`, { signal: c.signal })
      .then(async r => {
        const body = await r.json();
        if (!r.ok) throw Error(body?.error?.message ?? 'History unavailable.');
        return body as History;
      })
      .then(v => {
        if (!c.signal.aborted) setData(v);
      })
      .catch(e => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [id, page, attempt]);
  const event = data?.history[index],
    parts = event?.feedback.match(/[\s\S]{1,650}/g) ?? ['No decision feedback for this event.'];
  return (
    <section aria-label="Claim decision history">
      <h3>Submission & decision history</h3>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button className="secondary-button" onClick={() => setAttempt(n => n + 1)}>
            Retry
          </button>
        </p>
      ) : !data ? (
        <p role="status">Loading authorized history…</p>
      ) : !event ? (
        <p>No submission or decision events are available.</p>
      ) : (
        <>
          <div className="review-event">
            <strong>{labels[event.action] ?? event.action}</strong>
            <p>
              {event.actorName} · {new Date(event.at).toLocaleString()} · Revision {event.revision}
            </p>
            <p className="claim-level-description">{parts[part]}</p>
            {parts.length > 1 && (
              <div className="review-event-pages">
                <button
                  className="secondary-button"
                  disabled={part === 0}
                  onClick={() => setPart(n => n - 1)}
                >
                  Previous feedback
                </button>
                <span>
                  {part + 1}/{parts.length}
                </span>
                <button
                  className="secondary-button"
                  disabled={part === parts.length - 1}
                  onClick={() => setPart(n => n + 1)}
                >
                  More feedback
                </button>
              </div>
            )}
          </div>
          <div className="catalogue-pagination">
            <span>
              Event {(page - 1) * data.pageSize + index + 1} of {data.total} · newest first
            </span>
            <button
              className="secondary-button"
              disabled={page === 1 && index === 0}
              onClick={() => {
                setPart(0);
                if (index > 0) setIndex(n => n - 1);
                else {
                  setPage(n => n - 1);
                  setIndex(data.pageSize - 1);
                }
              }}
            >
              Newer
            </button>
            <button
              className="secondary-button"
              disabled={(page - 1) * data.pageSize + index + 1 >= data.total}
              onClick={() => {
                setPart(0);
                if (index < data.history.length - 1) setIndex(n => n + 1);
                else {
                  setPage(n => n + 1);
                  setIndex(0);
                }
              }}
            >
              Older
            </button>
          </div>
          <p className="review-scope-note">
            Recorded submissions and decisions only. Employee draft edits are private.
          </p>
        </>
      )}
    </section>
  );
}
