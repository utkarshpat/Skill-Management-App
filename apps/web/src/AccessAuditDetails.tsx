import { useEffect, useState } from 'react';
import { readApiResponse } from './api-response';
import { authenticatedFetch } from './auth';
import { FormDialog } from './FormDialog';
import { AskSkillGenie, recordQuestion } from './AskSkillGenie';
import { displayProficiencyName } from './proficiency';
import type { Entry } from './AccessAudit';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function words(value: string) {
  const result = value.toLowerCase().replaceAll(/[._]+/g, ' ');
  return result.charAt(0).toUpperCase() + result.slice(1);
}

function valueLabel(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return '—';
}

function statusLabel(value: unknown) {
  if (typeof value !== 'string') return '—';
  if (value === 'SUBMITTED') return 'Pending approval';
  if (value === 'CHANGES_REQUESTED') return 'Changes requested';
  return words(value);
}

function proficiency(snapshot: Record<string, unknown>) {
  const rank = Number(snapshot.claimed_rank ?? snapshot.rank);
  const name = snapshot.level_name ?? snapshot.levelName;
  return displayProficiencyName(rank, typeof name === 'string' ? name : undefined) || undefined;
}

const fields = [
  { label: 'Status', keys: ['status', 'state'], format: statusLabel },
  { label: 'Feedback', keys: ['feedback', 'comment'] },
  { label: 'Employee name', keys: ['displayName', 'display_name'] },
  { label: 'Employee ID', keys: ['employeeCode', 'employee_code'] },
  { label: 'Job title', keys: ['jobTitle', 'job_title'] },
  { label: 'Grade', keys: ['grade'] },
  { label: 'Active', keys: ['active'] },
  { label: 'Name', keys: ['name', 'title'] },
  { label: 'Skill', keys: ['skill_name', 'skillName'] },
  { label: 'Certificate', keys: ['certification_name', 'certificationName'] },
  { label: 'Issuer', keys: ['provider', 'issuer'] },
  { label: 'Category', keys: ['category'] },
  { label: 'Experience in months', keys: ['experience_months', 'experienceMonths'] },
  { label: 'Issue date', keys: ['issue_date', 'certificationDate'] },
  { label: 'Valid till', keys: ['expiry_date', 'expiryDate'] },
  {
    label: 'Effect',
    keys: ['effect'],
    format: (value: unknown) => (typeof value === 'string' ? words(value) : '—'),
  },
  {
    label: 'Scope',
    keys: ['scope_kind', 'scopeKind', 'scope'],
    format: (value: unknown) => (typeof value === 'string' ? words(value) : '—'),
  },
  { label: 'Reason', keys: ['reason'] },
  { label: 'Expires', keys: ['valid_until', 'validUntil'] },
  { label: 'Source', keys: ['source'] },
];

function changes(entry: Entry) {
  const old = record(entry.before);
  const saved = record(entry.after);
  const hasBefore = Object.keys(old).length > 0;
  const rows = fields.flatMap(({ label, keys, format = valueLabel }) => {
    const previous = keys.map(key => old[key]).find(value => value !== undefined);
    const next = keys.map(key => saved[key]).find(value => value !== undefined);
    const before = format(previous);
    const after = format(next);
    return before === after ? [] : [{ label, before, after }];
  });
  if (entry.action.startsWith('claim.')) {
    const previous = proficiency(old);
    const next = proficiency(saved);
    if (previous !== next)
      rows.push({ label: 'Proficiency', before: valueLabel(previous), after: valueLabel(next) });
  }
  const names = new Map(
    entry.referenceNames?.map(ref => [ref.kind + ':' + ref.id.toLowerCase(), ref.name]),
  );
  const resolve = (kind: string, id: unknown) =>
    typeof id === 'string' ? names.get(kind + ':' + id.toLowerCase()) : undefined;
  for (const [key, nameKey, label, kind] of [
    ['managerId', 'managerName', 'Reporting manager', 'person'],
    ['departmentId', 'departmentName', 'Account or client', 'organization'],
    ['teamId', 'teamName', 'Project', 'organization'],
    ['primaryCapabilityId', 'primaryCapabilityName', 'Primary skill', 'skill'],
    ['reviewer_id', 'reviewerName', 'Assigned reviewer', 'person'],
  ]) {
    if ((old[key] ?? null) === (saved[key] ?? null)) continue;
    rows.push({
      label,
      before: old[key]
        ? valueLabel(old[nameKey] ?? resolve(kind, old[key]) ?? 'Previous assignment')
        : 'Unassigned',
      after: saved[key]
        ? valueLabel(saved[nameKey] ?? resolve(kind, saved[key]) ?? 'New assignment')
        : 'Unassigned',
    });
  }
  const templates = (snapshot: Record<string, unknown>) => {
    const values = snapshot.roles ?? snapshot.roleIds;
    return Array.isArray(values)
      ? values
          .flatMap(value => {
            const { id, name } = record(value);
            const key = typeof value === 'string' ? value : id;
            return typeof key === 'string'
              ? [
                  {
                    id: key.toLowerCase(),
                    label: valueLabel(
                      name ?? resolve('template', key) ?? 'Template name unavailable',
                    ),
                  },
                ]
              : [];
          })
          .sort((a, b) => a.id.localeCompare(b.id))
      : [];
  };
  const beforeTemplates = templates(old);
  const afterTemplates = templates(saved);
  if (JSON.stringify(beforeTemplates) !== JSON.stringify(afterTemplates)) {
    rows.push({
      label: 'Assigned templates',
      before: beforeTemplates.map(template => template.label).join('\n') || 'None',
      after: afterTemplates.map(template => template.label).join('\n') || 'None',
    });
  }
  for (const [key, label] of [
    ['permissions', 'Permissions'],
    ['overrides', 'Individual exceptions'],
  ]) {
    const grants = (value: unknown) =>
      Array.isArray(value)
        ? value
            .flatMap(item => {
              const { permission, scope, effect, validUntil, reason } = record(item);
              return typeof permission === 'string'
                ? [
                    [
                      words(permission),
                      ...[effect, scope]
                        .filter((part): part is string => typeof part === 'string')
                        .map(words),
                      typeof validUntil === 'string' ? `Expires ${validUntil}` : '',
                      reason,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  ]
                : [];
            })
            .sort()
            .join('\n')
        : '';
    const before = grants(old[key]);
    const after = grants(saved[key]);
    if (before !== after) rows.push({ label, before: before || 'None', after: after || 'None' });
  }
  return { rows, hasBefore };
}

function recordedDecisions(entry: Entry) {
  if (entry.action !== 'capability.decide') return [];
  if (entry.decisionItems?.length) return entry.decisionItems;
  const items = record(entry.after).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap(item => {
    const { kind, needsReview, name, decision } = record(item);
    const { status, feedback } = record(decision);
    return (needsReview !== true && needsReview !== 1) || typeof kind !== 'string'
      ? []
      : [
          {
            kind,
            name: typeof name === 'string' ? name : undefined,
            status: typeof status === 'string' ? status : undefined,
            feedback: typeof feedback === 'string' ? feedback : undefined,
          },
        ];
  });
}

export function AccessAuditDetails({
  endpoint,
  personId,
  selected,
  actionName,
  recordName,
  onClose,
  onReopen,
}: {
  endpoint: string;
  personId?: string;
  selected: Entry;
  actionName: string;
  recordName: string;
  onClose: () => void;
  onReopen: (entry: Entry) => void;
}) {
  const [entry, setEntry] = useState<Entry>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  async function readEntry(signal: AbortSignal) {
    const params = new URLSearchParams({ pageSize: '1', details: 'true' });
    if (selected.revision < 2147483647) params.set('before', String(selected.revision + 1));
    if (personId) params.set('personId', personId);
    const data = await readApiResponse<{ items: Entry[] }>(
      await authenticatedFetch(endpoint + '/audit?' + params, { signal }),
      'Activity details could not be loaded.',
    );
    const item = data.items?.[0];
    if (
      item?.revision !== selected.revision ||
      item.targetId !== selected.targetId ||
      item.action !== selected.action
    )
      throw Object.assign(new Error('This activity entry is no longer available.'), {
        status: 404,
      });
    return item;
  }

  useEffect(() => {
    const controller = new AbortController();
    void readEntry(controller.signal)
      .then(item => {
        if (!controller.signal.aborted) setEntry(item);
      })
      .catch(reason => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : 'Activity details could not be loaded.',
          );
      });
    return () => controller.abort();
  }, [endpoint, personId, selected, attempt]);

  const { rows, hasBefore } = entry ? changes(entry) : { rows: [], hasBefore: false };
  const decisions = entry ? recordedDecisions(entry) : [];
  return (
    <FormDialog
      title="Activity details"
      subtitle={actionName}
      onClose={onClose}
      readOnly
      className="activity-dialog"
    >
      <dl className="activity-metadata">
        <div>
          <dt>Affected record</dt>
          <dd>{recordName}</dd>
        </div>
        <div>
          <dt>Changed by</dt>
          <dd>{selected.actorName?.trim() || 'Actor name unavailable'}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>
            <time dateTime={selected.at}>{new Date(selected.at).toLocaleString()}</time>
          </dd>
        </div>
      </dl>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setError('');
              setAttempt(a => a + 1);
            }}
          >
            Retry details
          </button>
        </div>
      ) : !entry ? (
        <p role="status">Loading activity details…</p>
      ) : (
        <>
          <AskSkillGenie
            onOpen={onClose}
            load={async signal => {
              const current = await readEntry(signal);
              const summary = changes(current);
              const status = summary.rows.find(row => row.label === 'Status');
              const prompt = recordQuestion('What changed in this activity entry?', [
                `Action: ${actionName}.`,
                status ? `Status: ${status.before} → ${status.after}.` : '',
                summary.rows.length
                  ? `Recorded fields: ${summary.rows.map(row => row.label).join(', ')}.`
                  : 'No field-level changes were saved.',
                ...recordedDecisions(current).map(
                  decision =>
                    `Recorded ${decision.kind === 'SKILL' ? 'skill' : 'certificate'} decision: ${statusLabel(decision.status)}.`,
                ),
              ]);
              return {
                prompt,
                record: {
                  label: actionName,
                  actions: [
                    {
                      label: 'Back to this record',
                      run: async signal => {
                        const latest = await readEntry(signal);
                        if (!signal.aborted) onReopen(latest);
                      },
                    },
                  ],
                },
              };
            }}
          />
          {decisions.length > 0 && (
            <section className="activity-decisions">
              <h3>Recorded decisions</h3>
              <ul>
                {decisions.map(({ kind, name, status, feedback }, index) => (
                  <li key={index}>
                    <strong>
                      {name ||
                        (kind === 'SKILL'
                          ? 'Skill claim'
                          : kind === 'CERTIFICATION'
                            ? 'Certificate'
                            : 'Record')}
                    </strong>
                    {' · '}
                    {status ? statusLabel(status) : 'Decision unavailable'}
                    {feedback?.trim() && <p>{feedback}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {rows.length > 0 && (
            <div className="activity-changes">
              <table>
                <thead>
                  <tr>
                    <th>Field</th>
                    {hasBefore && <th>Before</th>}
                    <th>{hasBefore ? 'After' : 'Recorded value'}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ label, before, after }) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      {hasBefore && <td>{before}</td>}
                      <td>{after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!rows.length && !decisions.length && (
            <p>No field-level changes were saved for this event.</p>
          )}
        </>
      )}
    </FormDialog>
  );
}
