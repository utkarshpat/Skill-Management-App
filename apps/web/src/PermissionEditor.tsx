import { useEffect, useId, useRef, useState } from 'react';
import { Settings2, ArrowLeft } from 'lucide-react';

interface Assignment {
  permission: string;
  scope: 'OWN' | 'ORGANIZATION';
  effect: 'ALLOW' | 'DENY';
  validUntil?: string;
  reason?: string;
}
interface Permission {
  code: string;
  label: string;
  implemented?: boolean;
  scopes?: ('OWN' | 'ORGANIZATION')[];
}
const groups = [
  { id: 'profile', label: 'Profiles', prefixes: ['profile.'] },
  { id: 'skills', label: 'Skills & catalogue', prefixes: ['skill.'] },
  { id: 'assessment', label: 'Assessments & evidence', prefixes: ['assessment.', 'evidence.'] },
  { id: 'learning', label: 'Learning', prefixes: ['learning.'] },
  { id: 'resourcing', label: 'Demand & matching', prefixes: ['demand.', 'matching.'] },
  { id: 'reports', label: 'Reports', prefixes: ['reports.'] },
  { id: 'administration', label: 'Administration', prefixes: ['users.', 'permissions.', 'audit.'] },
  { id: 'requests', label: 'Requests', prefixes: ['request.'] },
  { id: 'incidents', label: 'Incidents', prefixes: ['incident.'] },
];
const categoryOf = (code: string) =>
  groups.find(group => group.prefixes.some(prefix => code.startsWith(prefix)))?.id ?? 'other';
const keyOf = (item: Assignment) => item.permission + ':' + item.scope;

export function PermissionEditor({
  label,
  value,
  onChange,
  catalogue,
  individual = false,
}: {
  label: string;
  value: Assignment[];
  onChange: (value: Assignment[]) => void;
  catalogue: Permission[];
  individual?: boolean;
}) {
  const [category, setCategory] = useState('all'),
    [scope, setScope] = useState<Assignment['scope']>('OWN'),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(0),
    [editing, setEditing] = useState<string>();
  const pickerId = useId();
  const categories = [
    ...groups,
    ...(catalogue.some(item => categoryOf(item.code) === 'other')
      ? [{ id: 'other', label: 'Other', prefixes: [] }]
      : []),
  ].filter(group => catalogue.some(item => categoryOf(item.code) === group.id));
  const filtered = catalogue.filter(
    item =>
      (category === 'all' || categoryOf(item.code) === category) &&
      item.label.toLowerCase().includes(search.toLowerCase()),
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 6) - 1));
  const selected = value.find(item => keyOf(item) === editing);
  const container = useRef<HTMLFieldSetElement>(null),
    previousEditing = useRef<string | undefined>(undefined);
  const configuring = Boolean(selected);
  useEffect(() => {
    if (configuring && !previousEditing.current)
      container.current?.querySelector<HTMLButtonElement>('.permission-back')?.focus();
    else if (!configuring && previousEditing.current)
      Array.from(container.current?.querySelectorAll<HTMLButtonElement>('[data-assignment]') ?? [])
        .find(button => button.dataset.assignment === previousEditing.current)
        ?.focus();
    previousEditing.current = editing;
  }, [configuring, editing]);
  const scopeLabel = scope === 'OWN' ? 'Own records' : 'Entire workspace';
  function update(next: Assignment) {
    setScope(next.scope);
    onChange(value.map(item => (keyOf(item) === editing ? next : item)));
    setEditing(keyOf(next));
  }

  return (
    <fieldset ref={container} className="permission-picker">
      <legend>{label}</legend>
      {selected ? (
        <>
          <button
            type="button"
            className="secondary-button permission-back"
            onClick={() => setEditing(undefined)}
          >
            <ArrowLeft size={15} />
            Back to permissions
          </button>
          <h3 className="permission-detail-title">
            {catalogue.find(item => item.code === selected.permission)?.label ??
              selected.permission}
          </h3>
          <div className="permission-detail-grid">
            <label>
              Effect
              <select
                value={selected.effect}
                onChange={event =>
                  update({ ...selected, effect: event.target.value as Assignment['effect'] })
                }
              >
                <option value="ALLOW">Allow</option>
                <option value="DENY">Block</option>
              </select>
            </label>
            <label>
              Scope
              <select
                value={selected.scope}
                onChange={event =>
                  update({ ...selected, scope: event.target.value as Assignment['scope'] })
                }
              >
                {(['OWN', 'ORGANIZATION'] as const).map(option => (
                  <option
                    key={option}
                    value={option}
                    disabled={
                      option !== selected.scope &&
                      (!catalogue
                        .find(item => item.code === selected.permission)
                        ?.scopes?.includes(option) ||
                        value.some(
                          item => item.permission === selected.permission && item.scope === option,
                        ))
                    }
                  >
                    {option === 'OWN'
                      ? 'Own records'
                      : selected.permission === 'skill.verify'
                        ? 'Current direct reports (review policy)'
                        : 'Entire workspace'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {individual ? 'Expires (required)' : 'Expires (optional)'}
              <input
                type="datetime-local"
                required={individual}
                value={
                  selected.validUntil
                    ? new Date(
                        Date.parse(selected.validUntil) -
                          new Date(selected.validUntil).getTimezoneOffset() * 60000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ''
                }
                onInput={event => {
                  const date = event.currentTarget.valueAsNumber;
                  update({
                    ...selected,
                    validUntil: Number.isFinite(date)
                      ? new Date(event.currentTarget.value).toISOString()
                      : undefined,
                  });
                }}
              />
            </label>
            {individual && (
              <label>
                Reason (required)
                <input
                  required
                  maxLength={500}
                  value={selected.reason ?? ''}
                  onChange={event => update({ ...selected, reason: event.target.value })}
                />
              </label>
            )}
          </div>
          <p className="permission-picker-help">
            Block denies this permission within its scope, including an inherited Allow. Changes
            apply when you save.
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              onChange(value.filter(item => keyOf(item) !== editing));
              setEditing(undefined);
            }}
          >
            Remove assignment
          </button>
        </>
      ) : (
        <>
          <p className="permission-picker-help">
            Only implemented actions and supported scopes can be assigned. Existing unsupported
            grants remain visible for review.
          </p>
          <div className="permission-picker-filters">
            <label>
              Category
              <select
                value={category}
                onChange={event => {
                  setCategory(event.target.value);
                  setPage(0);
                }}
              >
                <option value="all">All categories</option>
                {categories.map(group => (
                  <option key={group.id} value={group.id}>
                    {group.label} (
                    {
                      value.filter(
                        item => item.scope === scope && categoryOf(item.permission) === group.id,
                      ).length
                    }
                    )
                  </option>
                ))}
              </select>
            </label>
            <label>
              Scope
              <select
                value={scope}
                onChange={event => {
                  setScope(event.target.value as Assignment['scope']);
                  setPage(0);
                }}
              >
                <option value="OWN">Own records</option>
                <option value="ORGANIZATION">Entire workspace</option>
              </select>
            </label>
            <label>
              Search
              <input
                type="search"
                placeholder="Find a permission…"
                value={search}
                onChange={event => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </label>
          </div>
          <p className="permission-picker-help">
            {individual
              ? 'Uncheck removes an override; inherited role access remains. Check adds Allow. Settings: Block/expiry.'
              : 'Check adds Allow; uncheck removes the assignment. Settings: Block/expiry.'}
          </p>
          <div
            className="permission-card-grid"
            role="group"
            aria-label={scopeLabel + ' permissions'}
          >
            {filtered.slice(currentPage * 6, currentPage * 6 + 6).map(permission => {
              const assigned = value.find(
                item => item.permission === permission.code && item.scope === scope,
              );
              const unavailable =
                permission.implemented === false ||
                Boolean(permission.scopes && !permission.scopes.includes(scope));
              return (
                <div
                  key={permission.code}
                  className={
                    'permission-card' +
                    (assigned ? ' selected' : '') +
                    (assigned?.effect === 'DENY' ? ' blocked' : '')
                  }
                >
                  <label className="permission-card-choice">
                    <input
                      type="checkbox"
                      aria-label={permission.label + ' · ' + scopeLabel}
                      aria-describedby={pickerId + permission.code}
                      checked={Boolean(assigned)}
                      disabled={unavailable && !assigned}
                      onChange={event => {
                        if (event.target.checked) {
                          const next: Assignment = {
                            permission: permission.code,
                            scope,
                            effect: 'ALLOW',
                          };
                          onChange([...value, next]);
                          if (individual) setEditing(keyOf(next));
                        } else onChange(value.filter(item => item !== assigned));
                      }}
                    />
                    <span>
                      <strong>{permission.label}</strong>
                      {permission.code === 'skill.verify' && (
                        <small>
                          Current direct reports only; current manager and assigned reviewer
                          required.
                        </small>
                      )}
                      <small id={pickerId + permission.code}>
                        {assigned
                          ? (assigned.effect === 'DENY' ? 'Block' : 'Allow') +
                            (assigned.validUntil ? ' · Expires' : '')
                          : unavailable
                            ? 'Unavailable for this scope'
                            : 'Not assigned'}
                      </small>
                    </span>
                  </label>
                  {assigned && (
                    <button
                      type="button"
                      className="permission-card-settings"
                      data-assignment={keyOf(assigned)}
                      aria-label={'Configure ' + permission.label + ' · ' + scopeLabel}
                      onClick={() => setEditing(keyOf(assigned))}
                    >
                      <Settings2 size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!filtered.length && <p className="permission-picker-help">No matching permissions.</p>}
          <div className="compact-pagination">
            <span>
              {filtered.length ? currentPage * 6 + 1 : 0}–
              {Math.min(currentPage * 6 + 6, filtered.length)} of {filtered.length} · {value.length}{' '}
              assignments total
            </span>
            <button
              type="button"
              className="secondary-button"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous permissions
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={(currentPage + 1) * 6 >= filtered.length}
              onClick={() => setPage(currentPage + 1)}
            >
              Next permissions
            </button>
          </div>
        </>
      )}
    </fieldset>
  );
}
