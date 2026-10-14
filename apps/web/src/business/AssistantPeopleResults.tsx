import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { FormDialog } from '../FormDialog';
import type { BusinessContext } from './business-model';
import { peopleCriterionLabel } from './people-search-prompt';
import './people-search.css';
export interface PeopleQuery {
  scopeId?: string;
  skills: { id: string; minRank: number }[];
  certifications: string[];
  headcount: number;
  onlyEligible: boolean;
  page: number;
}
interface Results {
  context: BusinessContext;
  query: PeopleQuery;
  requirements: { type: string; name: string; criterion: string }[];
  total: number;
  eligibleTotal: number;
  required: number;
  page: number;
  pageSize: number;
  rows: {
    id: string;
    employee: string;
    employeeCode: string;
    matched: number;
    eligible: boolean;
    criteria: { name: string; criterion: string; matched: boolean }[];
  }[];
}
export function AssistantPeopleResults({ query }: { query: PeopleQuery }) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(1),
    [onlyEligible, setOnlyEligible] = useState(query.onlyEligible),
    [loaded, setLoaded] = useState<{ key: string; value: Results }>(),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [exporting, setExporting] = useState(false);
  const guard = useRef(false),
    exportAbort = useRef<AbortController | undefined>(undefined);
  const key = JSON.stringify({ ...query, page, onlyEligible });
  const data = loaded?.key === key ? loaded.value : undefined;
  useEffect(() => {
    const abort = new AbortController();
    setLoaded(undefined);
    setError('');
    exportAbort.current?.abort();
    guard.current = false;
    setExporting(false);
    authenticatedFetch('/api/business/people-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: key,
      signal: abort.signal,
    })
      .then(r => readApiResponse<Results>(r, 'People matching could not be loaded. Try again.'))
      .then(r => {
        if (!abort.signal.aborted) setLoaded({ key, value: r });
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => {
      abort.abort();
      exportAbort.current?.abort();
    };
  }, [key, attempt]);
  async function download(format: 'csv' | 'xlsx') {
    if (guard.current || !data?.context.canExport) return;
    guard.current = true;
    setExporting(true);
    setError('');
    const abort = new AbortController();
    exportAbort.current = abort;
    try {
      const response = await authenticatedFetch('/api/business/people-search/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(key), format }),
        signal: abort.signal,
      });
      if (!response.ok) await readApiResponse(response, 'Matching report could not be downloaded.');
      const blob = await response.blob();
      if (abort.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = 'people-matching.' + format;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
    } finally {
      if (exportAbort.current === abort) {
        guard.current = false;
        setExporting(false);
      }
    }
  }
  const actions = (
    <div className="people-search-actions">
      {data?.context.canExport && (
        <>
          <button disabled={exporting} onClick={() => void download('csv')}>
            CSV
          </button>
          <button disabled={exporting} onClick={() => void download('xlsx')}>
            {exporting ? 'Preparing…' : 'Excel'}
          </button>
        </>
      )}
    </div>
  );
  const details = (
    <>
      {error && (
        <p role="alert">
          {error} <button onClick={() => setAttempt(n => n + 1)}>Retry</button>
        </p>
      )}
      {!data && !error && <p role="status">Checking current matching records…</p>}
      <label>
        <input
          type="checkbox"
          checked={onlyEligible}
          disabled={!data}
          onChange={e => {
            setOnlyEligible(e.target.checked);
            setPage(1);
          }}
        />{' '}
        Show only people meeting all requirements
      </label>
      {data && (
        <>
          <p>
            <strong>{data.eligibleTotal} people meet every requirement</strong>
            {query.headcount > 1 ? ` · ${query.headcount} requested` : ''}
          </p>
          <p className="people-search-note">
            {query.scopeId
              ? (data.context.scopes.find(s => s.id === query.scopeId)?.label ??
                'Selected authorized scope')
              : 'All authorized scopes'}{' '}
            · Updated {new Date(data.context.asOf).toLocaleString()}
          </p>
          <div className="people-search-requirements">
            {data.requirements.map((r, i) => (
              <span key={i} title={r.criterion}>
                {r.name} · {peopleCriterionLabel(r.criterion)}
              </span>
            ))}
          </div>
          {open ? (
            <>
              <div className="people-search-table">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Requirements matched</th>
                      <th>Match reasons & gaps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(row => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.employee}</strong>
                          <small>{row.employeeCode}</small>
                        </td>
                        <td>
                          {row.matched}/{data.required}
                          <small>{row.eligible ? 'Meets all requirements' : 'Partial match'}</small>
                        </td>
                        <td>
                          {row.criteria.map((c, i) => (
                            <div key={i}>
                              {c.matched ? '✓' : '—'} {c.name}:{' '}
                              {c.matched ? 'Matched' : 'Not established'}
                              <small title={c.criterion}>{peopleCriterionLabel(c.criterion)}</small>
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.rows.length && (
                <p>No people match these filters. Refine the requirements in chat.</p>
              )}
            </>
          ) : (
            <>
              <ul>
                {data.rows.slice(0, 3).map(row => (
                  <li key={row.id}>
                    {row.employee} · {row.matched}/{data.required} requirements
                  </li>
                ))}
              </ul>
              <div className="people-search-actions">
                <button
                  onClick={() => {
                    setLoaded(undefined);
                    setAttempt(n => n + 1);
                    setOpen(true);
                  }}
                >
                  View results
                </button>
                {actions}
              </div>
            </>
          )}
          <p className="people-search-note">
            Matching uses reviewed skills and current approved certificates. Missing evidence is not
            established; staffing availability is not assessed. Refine your requirements in chat.
          </p>
        </>
      )}
    </>
  );
  return (
    <section className="people-search-card" aria-label="Verified people matching results">
      {!open && details}
      {open && (
        <FormDialog
          title="People matching results"
          onClose={() => setOpen(false)}
          readOnly
          footer={
            <div className="people-search-actions people-search-footer">
              <button disabled={!data || page <= 1} onClick={() => setPage(n => n - 1)}>
                Previous
              </button>
              <span>{data ? `Page ${page} · ${data.total} people` : 'Updating results…'}</span>
              <button
                disabled={!data || page * data.pageSize >= data.total}
                onClick={() => setPage(n => n + 1)}
              >
                Next
              </button>
              {actions}
            </div>
          }
        >
          {details}
        </FormDialog>
      )}
    </section>
  );
}
