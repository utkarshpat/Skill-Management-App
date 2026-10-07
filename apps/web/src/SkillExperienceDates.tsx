import { skillDateError } from './skill-dates';

interface ExperienceDates {
  experienceMonths: number;
  lastUsedOn?: string | null;
}
export function SkillExperienceDates({
  value,
  onChange,
  at = new Date(),
}: {
  value: ExperienceDates;
  onChange: (value: ExperienceDates) => void;
  at?: Date;
}) {
  const error = skillDateError(value.lastUsedOn, at);
  return (
    <>
      <div className="skill-experience-dates">
        <label>
          Experience (months)
          <input
            name="experienceMonths"
            type="number"
            inputMode="numeric"
            min={0}
            max={600}
            step={1}
            value={Number.isNaN(value.experienceMonths) ? '' : value.experienceMonths}
            onChange={event =>
              onChange({
                ...value,
                experienceMonths: event.target.value === '' ? NaN : Number(event.target.value),
              })
            }
          />
        </label>
        <label htmlFor="skill-last-used">
          <span>
            Last used <span className="skill-optional">Optional</span>
          </span>
          <input
            id="skill-last-used"
            name="lastUsedOn"
            type="date"
            min="0001-01-01"
            max={at.toISOString().slice(0, 10)}
            value={value.lastUsedOn ?? ''}
            aria-describedby={'skill-last-used-help' + (error ? ' skill-last-used-error' : '')}
            aria-invalid={Boolean(error)}
            onChange={event => onChange({ ...value, lastUsedOn: event.target.value || null })}
          />
        </label>
      </div>
      <p id="skill-last-used-help" className="skill-helper">
        When did you last apply this skill? Leave blank if unsure. Dates cannot be after today
        (UTC); recency does not verify proficiency.
      </p>
      {error && (
        <p id="skill-last-used-error" className="skill-date-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
