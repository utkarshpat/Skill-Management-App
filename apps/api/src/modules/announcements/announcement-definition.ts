import { AccessError } from '../../shared/errors.js';
import { sandboxDesign, type DesignBinding } from './announcement-sandbox.js';

export const exportFields = {
  du: 'Delivery Unit',
  account: 'Account / Client',
  portfolio: 'Portfolio',
  grade: 'Grade',
  capability: 'Primary Capability',
  primarySkill: 'Primary Skill',
} as const;

export function canonicalExportFields(fields: readonly (keyof typeof exportFields)[]) {
  return [...new Set(fields.map(key => (key === 'primarySkill' ? 'capability' : key)))];
}

const scopeKinds = ['DELIVERY_UNIT', 'PORTFOLIO', 'DEPARTMENT', 'PROJECT'] as const;
const fieldTypes = ['text', 'longText', 'choice', 'radio', 'checkbox', 'date', 'rating'] as const;
const slots = ['title', 'message', 'image', 'action'] as const;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fieldId = /^[\w-]{1,36}$/;

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function requireValue(test: unknown, message: string): asserts test {
  if (!test) throw new AccessError(400, message);
}
export function id(value: unknown) {
  requireValue(typeof value === 'string' && uuid.test(value), 'Choose a valid record.');
  return value.toLowerCase();
}
export function text(value: unknown, max: number, required = true) {
  requireValue(typeof value === 'string' && value.length <= max, 'Check the text length.');
  const normalized = value.trim();
  requireValue(!required || normalized, 'Complete the required text.');
  return normalized;
}
function choices(value: unknown, minimum = 2) {
  requireValue(
    Array.isArray(value) && value.length >= minimum && value.length <= 12,
    'Add 2 to 12 options.',
  );
  const items = value.map(option => text(option, 100));
  requireValue(new Set(items).size === items.length, 'Options must be unique.');
  return items;
}
export function schedule(start: unknown, end: unknown) {
  const parse = (value: unknown) => {
    const time = text(value, 30);
    const parsed = new Date(time);
    requireValue(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(time) &&
        Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 19) === time.slice(0, 19),
      'Choose a valid date and time.',
    );
    return parsed.toISOString();
  };
  const startsAt = parse(start),
    endsAt = parse(end);
  requireValue(startsAt < endsAt, 'End time must follow start time.');
  return { startsAt, endsAt };
}

export function design(value: unknown) {
  const candidate = record(value);
  if (candidate.format === 'sandbox-v1' || candidate.bindings !== undefined) {
    return {
      ...sandboxDesign(candidate),
      order: [],
      color: '#126b70',
      background: '#ffffff',
      align: 'left',
      layout: 'stack',
      formLayout: 'single',
      density: 'comfortable',
      buttonWidth: 'full',
      visualStyle: 'clean',
      headingScale: 'balanced',
      cornerStyle: 'soft',
      buttonStyle: 'solid',
    };
  }
  const html = text(candidate.html, 2000);
  const css = text(candidate.css, 1000);
  // Interpret a tiny HTML/CSS grammar. The client renders trusted React slots and tokens.
  const match =
    /^<section>\s*((?:<div data-slot="(?:title|message|image|action)"><\/div>\s*){4})<\/section>$/.exec(
      html,
    );
  requireValue(match, 'Design must use the supported HTML slots.');
  const order = [...match[1].matchAll(/data-slot="(\w+)"/g)].map(item => item[1]);
  requireValue(new Set(order).size === slots.length, 'Use each design slot exactly once.');
  const style = /^section\s*\{([^{}]+)\}$/.exec(css);
  requireValue(style, 'Design CSS must use one section rule.');
  const tokens = {
    color: '#126b70',
    background: '#f7f8f6',
    align: 'left',
    layout: 'stack',
    formLayout: 'single',
    density: 'comfortable',
    buttonWidth: 'content',
    visualStyle: 'clean',
    headingScale: 'balanced',
    cornerStyle: 'soft',
    buttonStyle: 'solid',
  };
  const seen = new Set();
  for (const line of style[1]
    .split(';')
    .map(item => item.trim())
    .filter(Boolean)) {
    const [property, value, ...extra] = line.split(':').map(item => item.trim());
    requireValue(!extra.length && !seen.has(property), 'Invalid design CSS declaration.');
    seen.add(property);
    if ((property === 'color' || property === 'background-color') && /^#[\da-f]{6}$/i.test(value)) {
      tokens[property === 'color' ? 'color' : 'background'] = value;
    } else if (property === 'text-align' && (value === 'left' || value === 'center')) {
      tokens.align = value;
    } else if (property === '--layout' && (value === 'stack' || value === 'split')) {
      tokens.layout = value;
    } else if (property === '--form-layout' && ['single', 'two-column'].includes(value)) {
      tokens.formLayout = value;
    } else if (property === '--density' && ['comfortable', 'compact'].includes(value)) {
      tokens.density = value;
    } else if (property === '--button-width' && ['content', 'full'].includes(value)) {
      tokens.buttonWidth = value;
    } else if (property === '--visual-style' && ['clean', 'soft', 'spotlight'].includes(value)) {
      tokens.visualStyle = value;
    } else if (property === '--heading-scale' && ['compact', 'balanced', 'hero'].includes(value)) {
      tokens.headingScale = value;
    } else if (property === '--corner-style' && ['soft', 'rounded', 'square'].includes(value)) {
      tokens.cornerStyle = value;
    } else if (property === '--button-style' && ['solid', 'outline'].includes(value)) {
      tokens.buttonStyle = value;
    } else throw new AccessError(400, 'Design CSS contains an unsupported declaration.');
  }
  return {
    html,
    css,
    order,
    ...tokens,
    format: undefined as 'sandbox-v1' | undefined,
    bindings: undefined as DesignBinding[] | undefined,
  };
}

export function definition(value: unknown, image?: string) {
  const input = record(value);
  requireValue(input.kind === 'FORM' || input.kind === 'POLL', 'Choose a form or poll.');
  requireValue(
    Array.isArray(input.audience) && input.audience.length > 0 && input.audience.length <= 20,
    'Choose 1 to 20 audience scopes.',
  );
  const audience = input.audience.map(raw => {
    const entry = record(raw);
    const kind = scopeKinds.find(kind => kind === entry.kind);
    requireValue(kind, 'Choose an eligible audience scope.');
    return { kind, id: id(entry.id) };
  });
  requireValue(
    new Set(audience.map(item => item.kind + item.id)).size === audience.length,
    'Remove duplicate scopes.',
  );
  requireValue(
    Array.isArray(input.exports) &&
      input.exports.every(key => typeof key === 'string' && Object.hasOwn(exportFields, key)),
    'Check export fields.',
  );
  requireValue(
    Array.isArray(input.fields) && input.fields.length <= 20,
    'Choose up to 20 form fields.',
  );
  const fields =
    input.kind === 'FORM'
      ? input.fields.map(raw => {
          const entry = record(raw);
          const type = fieldTypes.find(type => type === entry.type);
          requireValue(
            type &&
              typeof entry.id === 'string' &&
              fieldId.test(entry.id) &&
              !Object.hasOwn(Object.prototype, entry.id),
            'Check form field type.',
          );
          return {
            id: entry.id,
            label: text(entry.label, 120),
            type,
            required: entry.required === true,
            options: type === 'choice' || type === 'radio' ? choices(entry.options) : [],
          };
        })
      : [];
  requireValue(
    new Set(fields.map(field => field.id)).size === fields.length,
    'Remove duplicate fields.',
  );
  const versions = Array.isArray(input.versions) ? input.versions : [];
  requireValue(versions.length <= 15, 'Keep up to 15 design versions.');
  const history = versions.map(raw => {
    const entry = record(raw);
    return {
      id: id(entry.id),
      feedback: text(entry.feedback, 1000),
      ...(entry.reply === undefined ? {} : { reply: text(entry.reply, 600, false) }),
      design: design(entry.design),
    };
  });
  const selected = history.find(version => version.id === input.selectedVersion);
  requireValue(!input.selectedVersion || selected, 'Choose a saved design version.');
  return {
    kind: input.kind,
    useCase:
      ['EVENT', 'TRAINING', 'SESSION', 'SURVEY', 'GENERAL'].find(
        useCase => useCase === input.useCase,
      ) ?? (input.kind === 'POLL' ? 'GENERAL' : 'EVENT'),
    designViewport:
      ['desktop', 'mobile', 'both'].find(viewport => viewport === input.designViewport) ?? 'both',
    title: text(input.title, 120),
    message: text(input.message ?? '', 1000, false),
    cta: input.kind === 'FORM' ? text(input.cta, 45) : '',
    fields,
    options: input.kind === 'POLL' ? choices(input.options) : [],
    audience,
    exports: canonicalExportFields(input.exports as (keyof typeof exportFields)[]),
    versions: history,
    selectedVersion: selected?.id,
    design: selected?.design,
    popup: input.popup === true,
    marquee: input.marquee === true,
    allowResponseUpdates: input.allowResponseUpdates === true,
    ...(input.imagePopup === true ? { imagePopup: true } : {}),
    imageAlt: text(input.imageAlt ?? '', 140, false),
    imagePosition:
      ['left', 'center', 'right'].find(position => position === input.imagePosition) ?? 'center',
    image,
  };
}
export type Definition = ReturnType<typeof definition>;

export function answers(def: Definition, value: unknown) {
  const input = record(value);
  if (def.kind === 'POLL') {
    requireValue(
      Object.keys(input).length === 1 && def.options.some(option => option === input.vote),
      'Choose a poll option.',
    );
    return { vote: input.vote };
  }
  const result: Record<string, string | boolean> = Object.create(null);
  requireValue(
    Object.keys(input).every(key => def.fields.some(field => field.id === key)),
    'Unexpected response field.',
  );
  for (const field of def.fields) {
    const answer = input[field.id];
    if (field.type === 'checkbox') {
      requireValue(
        (answer === undefined || typeof answer === 'boolean') &&
          (!field.required || answer === true),
        'Check the required fields.',
      );
      result[field.id] = answer === true;
      continue;
    }
    const value = text(answer ?? '', field.type === 'longText' ? 2000 : 240, field.required);
    requireValue(
      !value || !['choice', 'radio'].includes(field.type) || field.options.includes(value),
      'Choose a valid option.',
    );
    requireValue(
      !value || field.type !== 'rating' || /^[1-5]$/.test(value),
      'Choose a rating from 1 to 5.',
    );
    requireValue(
      !value ||
        field.type !== 'date' ||
        (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
          Number.isFinite(Date.parse(value)) &&
          new Date(value).toISOString().slice(0, 10) === value),
      'Choose a valid day.',
    );
    result[field.id] = value;
  }
  return result;
}
