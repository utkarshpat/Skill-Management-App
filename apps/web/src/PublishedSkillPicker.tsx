import { useEffect, useState } from 'react';
import { authenticatedFetch } from './auth';
export interface SkillOption {
  id: string;
  name: string;
}
export function PublishedSkillPicker({
  value,
  onChange,
}: {
  value?: SkillOption;
  onChange: (value: SkillOption | undefined) => void;
}) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
      skills: SkillOption[];
      total: number;
      pageSize: number;
    }>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setResult(undefined);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const query = new URLSearchParams({ status: 'PUBLISHED', search, page: String(page) });
          const response = await authenticatedFetch('/api/skills?' + query, {
            signal: controller.signal,
          });
          if (!response.ok) throw Error('Published skills could not be loaded.');
          const data = await response.json();
          if (!controller.signal.aborted) setResult(data);
        } catch (e) {
          if (!controller.signal.aborted)
            setError(e instanceof Error ? e.message : 'Skills unavailable.');
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, page, attempt]);
  return (
    <section aria-label="Target skill" className="access-form">
      <label>
        Search published skills
        <input
          type="search"
          maxLength={100}
          value={search}
          onChange={e => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search by skill name"
        />
      </label>
      <p>
        {value ? 'Selected: ' + value.name : 'No skill linked (optional)'}{' '}
        {value && (
          <button type="button" className="admin-text-button" onClick={() => onChange(undefined)}>
            Remove
          </button>
        )}
      </p>
      {loading && <p role="status">Searching skills…</p>}
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setAttempt(n => n + 1)}>
            Retry
          </button>
        </p>
      )}
      {result && (
        <>
          <div className="learning-actions" role="group" aria-label="Matching skills">
            {result.skills.map(skill => (
              <button
                type="button"
                className="secondary-button"
                key={skill.id}
                aria-pressed={value?.id === skill.id}
                onClick={() => onChange(skill)}
              >
                {skill.name}
              </button>
            ))}
          </div>
          {!result.skills.length && <p>No matching published skills.</p>}
          <div className="learning-actions">
            <button
              type="button"
              disabled={page === 1 || loading}
              onClick={() => setPage(n => n - 1)}
            >
              Previous results
            </button>
            <span>
              Page {page} of {Math.max(1, Math.ceil(result.total / result.pageSize))}
            </span>
            <button
              type="button"
              disabled={page * result.pageSize >= result.total || loading}
              onClick={() => setPage(n => n + 1)}
            >
              Next results
            </button>
          </div>
        </>
      )}
    </section>
  );
}
