import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import type { Definition, Person } from './announcement-model';

const slots = ['title', 'message', 'image', 'action'];

export function announcementStyle({ design }: Definition) {
  return design
    ? ({
        '--announcement-accent': design.color,
        '--announcement-surface': design.background,
        textAlign: design.align,
        '--announcement-form-columns':
          design.formLayout === 'two-column'
            ? 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))'
            : 'minmax(0, 1fr)',
        '--announcement-gap': design.density === 'compact' ? '8px' : '14px',
        '--announcement-padding': design.density === 'compact' ? '14px' : '24px',
        '--announcement-button-width': design.buttonWidth === 'full' ? '100%' : 'auto',
      } as CSSProperties)
    : undefined;
}

export function AnnouncementBannerContent({
  definition,
  image,
  action,
}: {
  definition: Definition;
  image?: string;
  action: ReactNode;
}) {
  const [paused, setPaused] = useState(false);
  return (
    <>
      {image && (
        <img
          src={image}
          alt={definition.imageAlt}
          style={{ objectPosition: definition.imagePosition }}
        />
      )}
      <div
        className={'announcement-strip-copy' + (definition.marquee && !paused ? ' is-rolling' : '')}
      >
        <span>
          <strong>{definition.title}</strong>
          {definition.message && ' · ' + definition.message}
        </span>
      </div>
      {definition.marquee && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => setPaused(value => !value)}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      )}
      {action}
    </>
  );
}

export function AnnouncementCard({
  definition,
  image,
  action,
}: {
  definition: Definition;
  image?: string;
  action: ReactNode;
}) {
  const design = definition.design;
  const content: Record<string, ReactNode> = {
    title: <h3>{definition.title}</h3>,
    message: definition.message && <p>{definition.message}</p>,
    image: image && (
      <img
        src={image}
        alt={definition.imageAlt}
        style={{ objectPosition: definition.imagePosition }}
      />
    ),
    action,
  };
  return (
    <section
      className={'announcement-card' + (design?.layout === 'split' ? ' is-split' : '')}
      style={announcementStyle(definition)}
    >
      {(design?.order ?? slots).map(
        slot =>
          content[slot] && (
            <div key={slot} className={'announcement-slot slot-' + slot}>
              {content[slot]}
            </div>
          ),
      )}
    </section>
  );
}

export function AnnouncementForm({
  definition,
  person,
  onSubmit,
  busy,
}: {
  definition: Definition;
  person: Person;
  onSubmit: (answers: Record<string, string | boolean>) => void;
  busy?: boolean;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit(
      Object.fromEntries(
        definition.fields.map(field => [
          field.id,
          field.type === 'checkbox' ? data.has(field.id) : String(data.get(field.id) ?? ''),
        ]),
      ),
    );
  };
  return (
    <form className="announcement-form" onSubmit={submit}>
      <div className="announcement-identity">
        <label>
          Name
          <input readOnly value={person.name} />
        </label>
        <label>
          Work email
          <input readOnly value={person.email ?? ''} />
        </label>
        <label>
          Employee ID
          <input readOnly value={person.employeeId} />
        </label>
      </div>
      {!person.email && (
        <p role="status">
          Sign in again with your work account to confirm your email before submitting.
        </p>
      )}
      <fieldset className="announcement-form-fields" disabled={busy}>
        <legend className="sr-only">Your response</legend>
        {definition.fields.map(field => (
          <label key={field.id}>
            {field.label}
            {field.required && ' *'}
            {field.type === 'longText' ? (
              <textarea name={field.id} maxLength={2000} required={field.required} />
            ) : field.type === 'choice' || field.type === 'rating' ? (
              <select name={field.id} required={field.required} defaultValue="">
                <option value="">Select an option</option>
                {(field.type === 'choice' ? field.options : ['1', '2', '3', '4', '5']).map(
                  option => (
                    <option key={option}>{option}</option>
                  ),
                )}
              </select>
            ) : (
              <input
                name={field.id}
                type={field.type === 'date' || field.type === 'checkbox' ? field.type : 'text'}
                maxLength={240}
                required={field.required}
              />
            )}
          </label>
        ))}
      </fieldset>
      <button
        type="submit"
        className="admin-primary"
        disabled={busy || !person.email}
        aria-busy={busy}
      >
        {busy ? 'Submitting…' : definition.cta}
      </button>
    </form>
  );
}

export function PollOptions({
  options,
  onVote,
  disabled,
}: {
  options: string[];
  onVote: (vote: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="announcement-poll" aria-label="Poll options">
      {options.map(option => (
        <button
          key={option}
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={() => onVote(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
