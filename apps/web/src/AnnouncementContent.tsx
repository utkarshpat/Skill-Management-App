import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Pause, Play, X } from 'lucide-react';
import type { Definition, Person } from './announcement-model';
import { AnnouncementSandbox } from './AnnouncementSandbox';

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
        '--announcement-radius':
          design.cornerStyle === 'rounded'
            ? '24px'
            : design.cornerStyle === 'square'
              ? '4px'
              : '12px',
        '--announcement-title-size':
          design.headingScale === 'hero'
            ? '1.85rem'
            : design.headingScale === 'compact'
              ? '1.15rem'
              : '1.45rem',
        '--announcement-button-background':
          design.buttonStyle === 'outline' ? 'transparent' : design.color,
        '--announcement-button-color':
          design.buttonStyle === 'outline' ? design.color : design.background,
        '--announcement-button-border':
          design.buttonStyle === 'outline' ? design.color : 'transparent',
      } as CSSProperties)
    : undefined;
}

export function AnnouncementBannerContent({
  definition,
  image,
  action,
  onDismiss,
}: {
  definition: Definition;
  image?: string;
  action: ReactNode;
  onDismiss: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const [overflow, setOverflow] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const container = viewport.current;
    const text = copy.current;
    if (!container || !text) return;
    const measure = () =>
      setOverflow(Math.max(0, Math.ceil(text.offsetWidth - container.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(text);
    return () => observer.disconnect();
  }, []);
  const scrolls = definition.marquee && overflow > 0;
  return (
    <>
      <button
        type="button"
        className="announcement-strip-icon"
        aria-label="Dismiss announcement"
        onClick={onDismiss}
      >
        <X size={16} aria-hidden="true" />
      </button>
      {image && (
        <img
          src={image}
          alt={definition.imageAlt}
          style={{ objectPosition: definition.imagePosition }}
        />
      )}
      <div
        ref={viewport}
        className="announcement-strip-copy"
        title={[definition.title, definition.message].filter(Boolean).join(' · ')}
      >
        <span
          ref={copy}
          className={scrolls ? 'is-rolling' : undefined}
          style={
            {
              '--announcement-overflow': `-${overflow}px`,
              animationPlayState: paused ? 'paused' : undefined,
            } as CSSProperties
          }
        >
          <strong>{definition.title}</strong>
          {definition.message && ' · ' + definition.message}
        </span>
      </div>
      {scrolls && (
        <button
          type="button"
          className="announcement-strip-icon announcement-strip-pause"
          aria-label={paused ? 'Resume scrolling announcement' : 'Pause scrolling announcement'}
          onClick={() => setPaused(value => !value)}
        >
          {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
        </button>
      )}
      <div className="announcement-strip-action">{action}</div>
    </>
  );
}

export function AnnouncementCard({
  definition,
  image,
  action,
  person,
  busy,
  answered,
  onSubmit,
  onVote,
  onOpen,
}: {
  definition: Definition;
  image?: string;
  action: ReactNode;
  person?: Person;
  busy?: boolean;
  answered?: boolean;
  onSubmit?: (answers: Record<string, string | boolean>) => void;
  onVote?: (vote: string) => void;
  onOpen?: () => void;
}) {
  const design = definition.design;
  if (design?.format === 'sandbox-v1')
    return (
      <AnnouncementSandbox
        definition={definition}
        person={person ?? { name: '', employeeId: '' }}
        image={image}
        busy={busy}
        answered={answered}
        onSubmit={onSubmit}
        onVote={onVote}
        onOpen={onOpen}
      />
    );
  const content: Record<string, ReactNode> = {
    title: (
      <>
        {design?.visualStyle && design.visualStyle !== 'clean' && (
          <p className="announcement-eyebrow">
            {
              {
                EVENT: 'Event registration',
                TRAINING: 'Training',
                SESSION: 'Session',
                SURVEY: 'Have your say',
                GENERAL: 'For your team',
              }[definition.useCase ?? 'GENERAL']
            }
          </p>
        )}
        <h3>{definition.title}</h3>
      </>
    ),
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
      className={
        'announcement-card style-' +
        (design?.visualStyle ?? 'clean') +
        (design?.layout === 'split' ? ' is-split' : '')
      }
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
  initialAnswers,
}: {
  definition: Definition;
  person: Person;
  onSubmit: (answers: Record<string, string | boolean>) => void;
  busy?: boolean;
  initialAnswers?: Record<string, string | boolean>;
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
      <dl className="announcement-identity">
        <div>
          <dt>Name</dt>
          <dd>{person.name}</dd>
        </div>
        <div>
          <dt>Work email</dt>
          <dd>{person.email || 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Employee ID</dt>
          <dd>{person.employeeId}</dd>
        </div>
      </dl>
      {!person.email && (
        <p role="status">
          Sign in again with your work account to confirm your email before submitting.
        </p>
      )}
      <fieldset className="announcement-form-fields" disabled={busy}>
        <legend className="sr-only">Your response</legend>
        {definition.fields.map(field =>
          field.type === 'radio' ? (
            <fieldset className="announcement-radio-group" key={field.id}>
              <legend>
                {field.label}
                {field.required && ' *'}
              </legend>
              {field.options.map(option => (
                <label key={option}>
                  <input
                    type="radio"
                    name={field.id}
                    value={option}
                    required={field.required}
                    defaultChecked={initialAnswers?.[field.id] === option}
                  />
                  {option}
                </label>
              ))}
            </fieldset>
          ) : (
            <label key={field.id}>
              {field.label}
              {field.required && ' *'}
              {field.type === 'longText' ? (
                <textarea
                  name={field.id}
                  maxLength={2000}
                  required={field.required}
                  defaultValue={String(initialAnswers?.[field.id] ?? '')}
                />
              ) : field.type === 'choice' || field.type === 'rating' ? (
                <select
                  name={field.id}
                  required={field.required}
                  defaultValue={String(initialAnswers?.[field.id] ?? '')}
                >
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
                  defaultChecked={
                    field.type === 'checkbox' ? initialAnswers?.[field.id] === true : undefined
                  }
                  defaultValue={
                    field.type === 'checkbox' ? undefined : String(initialAnswers?.[field.id] ?? '')
                  }
                />
              )}
            </label>
          ),
        )}
      </fieldset>
      <button
        type="submit"
        className="admin-primary"
        disabled={busy || !person.email}
        aria-busy={busy}
      >
        {busy ? 'Submitting…' : initialAnswers ? 'Save changes' : definition.cta}
      </button>
    </form>
  );
}

export function PollOptions({
  options,
  onVote,
  disabled,
  selectedVote,
}: {
  options: string[];
  onVote: (vote: string) => void;
  disabled?: boolean;
  selectedVote?: string | boolean;
}) {
  return (
    <div className="announcement-poll" aria-label="Poll options">
      {options.map(option => (
        <button
          key={option}
          type="button"
          className="secondary-button"
          aria-pressed={selectedVote === undefined ? undefined : selectedVote === option}
          disabled={disabled}
          onClick={() => onVote(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
