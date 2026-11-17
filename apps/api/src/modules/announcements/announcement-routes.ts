import { announcementNotifications } from './announcement-notifications.js';
import {
  announcementDesignContext,
  announcementDesignSystemPrompt,
} from './announcement-design.js';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Express } from 'express';
import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';
import { AccessError } from '../../shared/errors.js';
import { verifyRequestIdentity } from '../../shared/request-identity.js';
import type { Identity } from '../identity/index.js';
import type { AiBudget, Provider } from '../ai/index.js';
import { excelMime, writeExcel } from '../skills/index.js';
import {
  answers,
  definition,
  design,
  exportFields,
  id,
  record,
  schedule,
  text,
  type Definition,
} from './announcement-definition.js';

const base = '/api/announcements';
const previewKey = process.env.ENTRA_WEB_CLIENT_SECRET || randomBytes(32);

function seal(actor: string, key: string | undefined, definition: object, expiry: number) {
  return createHmac('sha256', previewKey)
    .update(JSON.stringify(['announcement-preview', actor, key, definition, expiry]))
    .digest();
}

function checkReceipt(receipt: unknown, actor: string, key: string | undefined, payload: object) {
  const match = typeof receipt === 'string' && /^(\d{13})\.([a-f0-9]{64})$/.exec(receipt);
  if (
    !match ||
    Number(match[1]) <= Date.now() ||
    !timingSafeEqual(seal(actor, key, payload, Number(match[1])), Buffer.from(match[2], 'hex'))
  )
    throw new AccessError(409, 'Preview the current announcement again before publishing.');
}

const workEmail = /^[^@\s]+@soprasteria\.com$/i;
type Operation =
  | 'FEED'
  | 'MANAGE'
  | 'OWNER'
  | 'DRAFT'
  | 'PREVIEW'
  | 'DESIGN'
  | 'DETAIL'
  | 'ANSWER'
  | 'IMAGE'
  | 'EXPORT'
  | 'RESPONSES'
  | 'CLOSE';

export class SqlAnnouncements {
  constructor(
    private account: string,
    readonly provider?: Provider,
    readonly budget?: AiBudget,
  ) {}

  async notifications(actor: string) {
    const feed = await this.execute<{ items: Parameters<typeof announcementNotifications>[0] }>(
      actor,
      'FEED',
    );
    return announcementNotifications(feed.items);
  }

  async execute<T>(
    actor: string,
    operation: Operation,
    key?: string,
    payload = {},
    email?: string,
  ) {
    try {
      return await withRuntimeDatabase(async pool => {
        const data = await pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('operation', sql.VarChar(16), operation)
          .input('id', sql.UniqueIdentifier, key ?? null)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .input('email', sql.NVarChar(254), email ?? null)
          .execute<{ json: string }>('dbo.AnnouncementWorkspace');
        if (!data.recordset?.[0]?.json) throw Error('Announcement result was missing.');
        return JSON.parse(data.recordset[0].json) as T;
      });
    } catch (error) {
      const number = (error as { number?: number })?.number;
      const status = { 51000: 400, 51003: 403, 51004: 404, 51009: 409 }[number as 51000];
      if (status) throw new AccessError(status, (error as Error).message);
      throw error;
    }
  }
}

async function image(value: unknown) {
  if (value === undefined) return undefined;
  const source = text(value, 900_000);
  if (!/^[\w+/]+={0,2}$/.test(source))
    throw new AccessError(400, 'Upload a JPEG, PNG or WebP image.');
  const { default: sharp } = await import('sharp');
  try {
    const input = sharp(Buffer.from(source, 'base64'), { limitInputPixels: 12_000_000 });
    const { format } = await input.metadata();
    if (!format || !['jpeg', 'png', 'webp'].includes(format)) throw Error('Unsupported image type');
    const output = await input
      .rotate()
      .resize({ width: 1200, height: 640, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    if (output.length > 250_000) throw Error('Image exceeds optimized size limit');
    return output.toString('base64');
  } catch {
    throw new AccessError(400, 'Upload a smaller JPEG, PNG or WebP image.');
  }
}
function revision(value: unknown) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= 2_147_483_647
  )
    throw new AccessError(400, 'Invalid revision.');
  return value;
}

interface Dependencies {
  verify: (authorization: string | undefined) => Promise<Identity>;
  resolveAccess?: (identity: Identity) => Promise<string | undefined>;
  announcements?: Pick<SqlAnnouncements, 'execute' | 'provider' | 'budget'>;
}
interface OwnerRecord {
  definition: Definition;
  revision: number;
}
export function registerAnnouncementRoutes(app: Express, dependencies?: Dependencies) {
  const store = dependencies?.announcements;
  if (!store || !dependencies) return;
  app.use(base, async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    let identity: Identity;
    try {
      identity = await verifyRequestIdentity(req, dependencies.verify);
    } catch {
      return next(new AccessError(401, 'Sign in to continue.'));
    }
    const actor = await dependencies.resolveAccess?.(identity);
    if (!actor) return next(new AccessError(403, 'Workspace access is unavailable.'));
    res.locals.actor = actor;
    const email = identity.workEmail;
    res.locals.workEmail =
      email && email.length <= 254 && workEmail.test(email) ? email : undefined;
    next();
  });
  app.get('/api/announcements/feed', async (_req, res) => {
    res.json(await store.execute(res.locals.actor, 'FEED', undefined, {}, res.locals.workEmail));
  });
  app.get('/api/announcements/manage', async (_req, res) => {
    res.json({
      ...(await store.execute<object>(res.locals.actor, 'MANAGE')),
      aiAvailable: !!store.provider && !!store.budget,
    });
  });
  app.get('/api/announcements/:id/draft', async (req, res) => {
    res.json(await store.execute(res.locals.actor, 'OWNER', id(req.params.id)));
  });
  app.get('/api/announcements/:id/image', async (req, res) => {
    const data = await store.execute<{ image?: string }>(
      res.locals.actor,
      'IMAGE',
      id(req.params.id),
    );
    if (!data.image) throw new AccessError(404, 'Image unavailable.');
    res.type('image/webp').send(Buffer.from(data.image, 'base64'));
  });
  app.post('/api/announcements/draft', async (req, res) => {
    const input = record(req.body);
    const draftId = input.id ? id(input.id) : undefined;
    const key = draftId ?? randomUUID();
    const actor = res.locals.actor as string;
    const grantId = id(input.grantId);
    await store.execute(actor, 'DESIGN', draftId, { grantId });
    const payload = {
      grantId,
      revision: revision(input.revision),
      ...schedule(input.startsAt, input.endsAt),
      definition: definition(input.definition, await image(input.image)),
    };
    if (input.preview === true) {
      const preview = await store.execute<object>(actor, 'PREVIEW', key, payload);
      const expiry = Date.now() + 15 * 60_000;
      res.json({
        ...preview,
        id: key,
        image: payload.definition.image,
        receipt: expiry + '.' + seal(actor, key, payload, expiry).toString('hex'),
      });
      return;
    }
    const publish = input.publish === true;
    if (publish) checkReceipt(input.receipt, actor, draftId, payload);
    res.json(await store.execute(actor, 'DRAFT', key, { ...payload, publish }));
  });
  app.post('/api/announcements/design', async (req, res) => {
    if (!store.provider || !store.budget) throw new AccessError(503, 'AI design is unavailable.');
    const input = record(req.body),
      def = definition(input.definition);
    const key = input.id ? id(input.id) : undefined;
    const grantId = id(input.grantId),
      actor = res.locals.actor as string;
    await store.execute(actor, 'DESIGN', key, { grantId });
    const prompt = text(input.prompt, 1000);
    const release = await store.budget.acquire(actor);
    try {
      const result = await store.provider.complete(
        [
          {
            role: 'system',
            content: announcementDesignSystemPrompt,
          },
          {
            role: 'user',
            content: JSON.stringify({
              ...announcementDesignContext(def, input.viewport),
              schedule:
                input.startsAt !== undefined && input.endsAt !== undefined
                  ? schedule(input.startsAt, input.endsAt)
                  : undefined,
              prompt,
            }),
          },
        ],
        [],
        AbortSignal.timeout(25000),
        { maxOutputTokens: 1600 },
      );
      await store.execute(actor, 'DESIGN', key, { grantId });
      if (result.calls.length) throw new AccessError(502, 'AI returned an unsupported design.');
      let validated;
      try {
        validated = design(
          JSON.parse(result.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')),
        );
      } catch {
        throw new AccessError(
          422,
          'AI design did not pass validation. Revise the prompt and try again.',
        );
      }
      res.json({ id: randomUUID(), feedback: prompt, design: validated });
    } finally {
      await release();
    }
  });
  app.post('/api/announcements/:id/respond', async (req, res) => {
    const key = id(req.params.id),
      actor = res.locals.actor as string;
    const current = await store.execute<OwnerRecord>(actor, 'DETAIL', key);
    const input = record(req.body);
    if (revision(input.revision) !== current.revision)
      throw new AccessError(409, 'Announcement changed.');
    res.json(
      await store.execute(
        actor,
        'ANSWER',
        key,
        {
          revision: current.revision,
          answers: answers(current.definition, input.answers),
        },
        res.locals.workEmail,
      ),
    );
  });
  app.post('/api/announcements/:id/close', async (req, res) => {
    res.json(
      await store.execute(res.locals.actor, 'CLOSE', id(req.params.id), {
        revision: revision(record(req.body).revision),
      }),
    );
  });
  app.get('/api/announcements/:id/responses', async (req, res) => {
    const { definition, responses } = await store.execute<{
      definition: Definition;
      responses: { name: string; employeeId: string; answers: Record<string, string | boolean> }[];
    }>(res.locals.actor, 'RESPONSES', id(req.params.id));
    res.json({
      definition: { title: definition.title, kind: definition.kind, fields: definition.fields },
      responses: responses.map(({ name, employeeId, answers }) => ({ name, employeeId, answers })),
    });
  });
  app.get('/api/announcements/:id/export', async (req, res) => {
    const { definition: def, responses } = await store.execute<{
      definition: Definition;
      responses: (Record<string, string> & { answers: Record<string, string | boolean> })[];
    }>(res.locals.actor, 'EXPORT', id(req.params.id));
    if (responses.length > 10000)
      throw new AccessError(400, 'Too many responses for one workbook.');
    const baseColumns = [
      { source: 'name', name: 'Name' },
      { source: 'email', name: 'Work Email' },
      { source: 'employeeId', name: 'Employee ID' },
      ...def.exports.map(source => ({ source, name: exportFields[source] })),
    ];
    const custom =
      def.kind === 'POLL'
        ? [{ name: 'Vote', id: 'vote' }]
        : def.fields.map((field, index) => ({
            name: 'Answer ' + (index + 1) + ' — ' + field.label,
            id: field.id,
          }));
    const columns = [...baseColumns.map(x => x.name), ...custom.map(x => x.name)];
    const rows = responses.map(response =>
      Object.fromEntries([
        ...baseColumns.map(({ source, name }) => [name, response[source] ?? null]),
        ...custom.map(({ name, id }) => [name, response.answers[id] ?? null]),
      ]),
    );
    res
      .type(excelMime)
      .attachment('announcement-responses.xlsx')
      .send(await writeExcel([{ name: 'Responses', columns }], { Responses: rows }));
  });
}
