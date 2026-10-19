import { useEffect, useState } from 'react';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';

export interface CatalogueCertification {
  id: string;
  name: string;
  provider: string;
  active: boolean;
}
interface Choices {
  total: number;
  pageSize: number;
  certifications: CatalogueCertification[];
}
export function CatalogueCertificationPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: CatalogueCertification[];
  onChange: (value: CatalogueCertification[]) => void;
  disabled?: boolean;
}) {
  const [enabled, setEnabled] = useState(value.length > 0);
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [attempt, setAttempt] = useState(0);
  const [choices, setChoices] = useState<Choices>(),
    [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    setChoices(undefined);
    setError('');
    const timer = setTimeout(
      () => {
        authenticatedFetch(
          '/api/skills/certifications?' + new URLSearchParams({ search, page: String(page) }),
          { signal: abort.signal },
        )
          .then(r => readApiResponse<Choices>(r, 'Certification choices could not be loaded.'))
          .then(v => {
            if (!abort.signal.aborted) setChoices(v);
          })
          .catch(e => {
            if (!abort.signal.aborted) setError(e.message);
          });
      },
      search ? 200 : 0,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [enabled, search, page, attempt]);
  return (
    <fieldset className="catalogue-association" disabled={disabled}>
      <legend>
        Associated certifications <span className="bo-note">· Optional</span>
      </legend>
      <p>
        Suggest certifications alongside this skill. Employees can choose other published skills and
        are never required to claim these suggestions.
      </p>
      <div className="catalogue-choice-row">
        <label>
          <input
            type="radio"
            name="catalogue-cert-association"
            checked={!enabled}
            onChange={() => {
              setEnabled(false);
              onChange([]);
            }}
          />{' '}
          No associated certifications
        </label>
        <label>
          <input
            type="radio"
            name="catalogue-cert-association"
            checked={enabled}
            onChange={() => setEnabled(true)}
          />{' '}
          Associate certifications
        </label>
      </div>
      {enabled && (
        <>
          <label>
            Find a catalogue certification
            <input
              type="search"
              value={search}
              maxLength={100}
              placeholder="Search certification or provider"
              onChange={e => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <div className="catalogue-selected" aria-label="Selected certifications">
            {value.map(c => (
              <button
                key={c.id}
                type="button"
                className="secondary-button"
                onClick={() => onChange(value.filter(v => v.id !== c.id))}
                aria-label={'Remove ' + c.name}
              >
                {c.name}
                {!c.active ? ' (retired)' : ''} ×
              </button>
            ))}
            <span>{value.length}/20 selected</span>
          </div>
          {error ? (
            <p role="alert">
              {error}{' '}
              <button type="button" onClick={() => setAttempt(v => v + 1)}>
                Retry
              </button>
            </p>
          ) : !choices ? (
            <p role="status">Loading certifications…</p>
          ) : (
            <>
              <div className="catalogue-option-list">
                {choices.certifications.map(c => (
                  <label key={c.id}>
                    <input
                      type="checkbox"
                      checked={value.some(v => v.id === c.id)}
                      disabled={!value.some(v => v.id === c.id) && value.length >= 20}
                      onChange={e =>
                        onChange(
                          e.target.checked ? [...value, c] : value.filter(v => v.id !== c.id),
                        )
                      }
                    />
                    <span>
                      <strong>{c.name}</strong>
                      <small>{c.provider}</small>
                    </span>
                  </label>
                ))}
              </div>
              {!choices.certifications.length && (
                <p>
                  No matching certifications. Add a certification through the catalogue amendment
                  workflow.
                </p>
              )}
              <div className="catalogue-picker-pagination">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={page <= 1}
                  onClick={() => setPage(v => v - 1)}
                >
                  Previous
                </button>
                <span>Page {page}</span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={page * choices.pageSize >= choices.total}
                  onClick={() => setPage(v => v + 1)}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </>
      )}
    </fieldset>
  );
}
