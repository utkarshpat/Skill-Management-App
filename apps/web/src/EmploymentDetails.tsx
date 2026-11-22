import { PrimaryCapabilitySummary, type PrimaryCapabilityDetails } from './PrimaryCapability';
export interface Employment extends PrimaryCapabilityDetails {
  jobTitle?: string | null;
  grade?: string | null;
}
export function EmploymentFields({
  value,
  onChange,
}: {
  value: Employment;
  onChange: (value: Employment) => void;
}) {
  return (
    <>
      <div className="dialog-field-grid">
        <label>
          Business job title
          <input
            maxLength={100}
            value={value.jobTitle ?? ''}
            onChange={event => onChange({ ...value, jobTitle: event.target.value })}
            aria-describedby="employment-help"
          />
        </label>
        <label>
          Grade
          <input
            maxLength={40}
            value={value.grade ?? ''}
            onChange={event => onChange({ ...value, grade: event.target.value })}
            aria-describedby="employment-help"
          />
        </label>
      </div>
      <p className="access-help" id="employment-help">
        Optional work information maintained by people administrators. Neither field assigns access
        or approval authority. Leave blank to clear a stored value.
      </p>
    </>
  );
}
export function EmploymentSummary({
  value,
  loading = false,
  failed = false,
}: {
  value?: Employment;
  loading?: boolean;
  failed?: boolean;
}) {
  const display = (key: 'jobTitle' | 'grade') =>
    loading
      ? 'Loading work details...'
      : failed
        ? 'Unavailable'
        : !value || value[key] === undefined
          ? 'Unavailable'
          : value[key] || 'Not assigned';
  return (
    <>
      <dl>
        <div>
          <dt>Business job title</dt>
          <dd>{display('jobTitle')}</dd>
        </div>
        <div>
          <dt>Grade</dt>
          <dd>{display('grade')}</dd>
        </div>
      </dl>
      <PrimaryCapabilitySummary value={value} loading={loading} failed={failed} />
      <p>
        Maintained by people administrators. Job title and grade describe your work; they do not
        grant access.
      </p>
    </>
  );
}
