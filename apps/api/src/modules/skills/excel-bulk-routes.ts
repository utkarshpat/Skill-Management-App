import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { raw, type ErrorRequestHandler, type Express } from 'express';
import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';
import { AccessError } from '../../shared/errors.js';
import { verifyRequestIdentity } from '../../shared/request-identity.js';
import type { Identity } from '../identity/index.js';
import {
  excelMime,
  excelUploadLimit,
  readExcel,
  writeExcel,
  type ExcelRow,
} from './excel-workbook.js';
import { commonLevels } from './proficiency.js';
import { uuid } from './skill-catalogue.js';

const catalogueSheets = [
  {
    name: 'Skills',
    legacyLeadingColumn: 'Action',
    legacyHeadings: { Beginner: 'Foundation' },
    columns: [
      'ID',
      'Name',
      'Category',
      'Description',
      'Status',
      'Beginner',
      'Autonomous',
      'Experienced',
      'Expert',
    ],
  },
  {
    name: 'Certifications',
    legacyLeadingColumn: 'Action',
    columns: ['ID', 'Name', 'Category', 'Description', 'Issuer', 'Active', 'Related Skill IDs'],
  },
  { name: 'Issuers', legacyLeadingColumn: 'Action', columns: ['ID', 'Name', 'Active'] },
];
const certificateSheets = [
  {
    name: 'Employee Certifications',
    columns: [
      'Employee Code',
      'Certification',
      'Issuer',
      'Category',
      'Issue Date',
      'Expiry Date',
      'Does Not Expire',
      'Credential ID',
      'Status',
      'Source',
      'Source ID',
    ],
  },
];
const employeeSheets = [
  {
    name: 'Employees',
    columns: [
      'Employee Code',
      'Full Name',
      'Work Email',
      'Work Location',
      'Job Title',
      'Grade',
      'Primary Skill',
      'Delivery Unit',
      'Portfolio',
      'Account/Client',
      'Project',
      'Manager Employee Code',
    ],
  },
];
const sheetsByKind = {
  catalogue: catalogueSheets,
  certifications: certificateSheets,
  employees: employeeSheets,
};
const receiptKey = process.env.ENTRA_WEB_CLIENT_SECRET || randomBytes(32);
function previewSignature(
  actor: string,
  kind: Kind,
  digest: string,
  revision: number,
  expires: number,
) {
  return createHmac('sha256', receiptKey)
    .update(JSON.stringify(['excel-preview-v2', actor, kind, digest, revision, expires]))
    .digest();
}
type Kind = keyof typeof sheetsByKind;
type Operation = 'ACCESS' | 'EXPORT' | 'PREVIEW' | 'IMPORT';

interface BulkDependencies {
  verify: (authorization: string | undefined) => Promise<Identity>;
  resolveAccess?: (identity: Identity) => Promise<string | undefined>;
  excelBulk?: Pick<SqlExcelBulkData, 'execute'>;
}

export class SqlExcelBulkData {
  constructor(private accountId: string) {}

  async execute<T>(
    actor: string,
    kind: Kind,
    operation: Operation,
    payload: object = {},
    revision?: number,
  ) {
    try {
      return await withRuntimeDatabase(async pool => {
        const result = await pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.accountId)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('kind', sql.VarChar(20), kind)
          .input('operation', sql.VarChar(12), operation)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .input('revision', sql.Int, revision ?? null)
          .execute(kind === 'employees' ? 'dbo.ExcelEmployeeBulkData' : 'dbo.ExcelBulkData');
        const sets = result.recordsets as sql.IRecordSet<{ json: string }>[];
        const json = sets.at(-1)?.[0]?.json;
        if (typeof json !== 'string') throw new Error('Workbook result was missing.');
        return JSON.parse(json) as T;
      });
    } catch (error) {
      const number = (error as { number?: number })?.number;
      if (number === 51003)
        throw new AccessError(403, 'Workbook action is outside your current access.');
      if (number === 51009)
        throw new AccessError(409, 'Workspace changed. Preview the workbook again.');
      if (number === 51000) throw new AccessError(400, (error as Error).message);
      if (number === 2812 && kind === 'employees')
        throw new AccessError(503, 'Bulk employee import requires database migration 117.');
      throw error;
    }
  }
}

function normalize(kind: Kind, parsed: Awaited<ReturnType<typeof readExcel>>) {
  const rows: NonNullable<ReturnType<typeof normalizeRow>>[] = [];
  const issues: string[] = [];
  const targets = new Set<string>();
  const sources = new Set<string>();
  const ordered =
    kind === 'catalogue'
      ? ['Issuers', 'Skills', 'Certifications']
      : sheetsByKind[kind].map(s => s.name);
  for (const sheet of ordered) {
    for (const row of parsed[sheet] ?? []) {
      try {
        const value = normalizeRow(kind, sheet, row);
        if (!value) continue;
        if (kind === 'employees') {
          const keys = [
            'employee:' + value.employee?.toLowerCase(),
            ...(value.workEmail ? ['email:' + value.workEmail] : []),
          ];
          if (keys.some(key => targets.has(key)))
            throw Error('Duplicate employee code or work email.');
          keys.forEach(key => targets.add(key));
        }
        if ('targetId' in value && value.targetId) {
          const key = sheet + ':' + value.targetId;
          if (targets.has(key)) throw Error('ID occurs more than once.');
          targets.add(key);
        }
        if (value.source && value.sourceId) {
          const key = JSON.stringify([value.source.toLowerCase(), value.sourceId.toLowerCase()]);
          if (sources.has(key)) throw Error('Source and Source ID occur more than once.');
          sources.add(key);
        }
        rows.push(value);
      } catch (error) {
        issues.push(`${sheet}, row ${row.row}: ${(error as Error).message}`);
      }
    }
  }
  if (issues.length) throw new AccessError(400, issues.slice(0, 20).join('\n'));
  if (!rows.length)
    throw new AccessError(
      400,
      kind === 'catalogue'
        ? 'This workbook has no catalogue rows. Add data beneath the headers and select it again.'
        : 'This workbook has no import rows. Add data beneath the headers and select it again.',
    );
  if (rows.length > 1000)
    throw new AccessError(
      400,
      'This workbook has more than 1,000 import rows. Split it into smaller batches.',
    );
  return { rows };
}

function normalizeRow(kind: Kind, sheet: string, { row, values }: ExcelRow) {
  const text = (field: string, max: number, required = false) => {
    const value = String(values[field] ?? '').trim();
    if (value.length > max || (required && !value)) throw Error(`Check ${field}.`);
    return value;
  };
  const date = (field: string, required: boolean) => {
    const value = text(field, 10, required);
    if (!value) return undefined;
    const timestamp = Date.parse(value + 'T00:00:00Z');
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== value
    )
      throw Error(`Use YYYY-MM-DD for ${field}.`);
    return value;
  };
  if (kind === 'employees') {
    const workEmail = text('Work Email', 254).toLowerCase();
    if (workEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail))
      throw Error('Check Work Email.');
    const deliveryUnit = text('Delivery Unit', 100);
    const portfolio = text('Portfolio', 100);
    const client = text('Account/Client', 100);
    const project = text('Project', 100);
    if ((deliveryUnit || portfolio || client || project) && !(deliveryUnit && portfolio && client))
      throw Error(
        'Enter Delivery Unit, Portfolio and Account/Client for an organization placement.',
      );
    return {
      row,
      section: sheet,
      employee: text('Employee Code', 40, true),
      name: text('Full Name', 100, true),
      workEmail,
      workLocation: text('Work Location', 100),
      jobTitle: text('Job Title', 100),
      grade: text('Grade', 40),
      primarySkill: text('Primary Skill', 100),
      deliveryUnit,
      portfolio,
      client,
      project,
      manager: text('Manager Employee Code', 40),
    };
  }
  if (kind === 'certifications') {
    const status = text('Status', 20, true).toUpperCase();
    if (status !== 'APPROVED') throw Error('Only approved history can be imported.');
    const issued = date('Issue Date', true)!;
    const expiry = date('Expiry Date', false);
    const noExpiry = text('Does Not Expire', 5).toLowerCase();
    if (noExpiry && !['true', 'false', 'yes', 'no', '0', '1'].includes(noExpiry))
      throw Error('Use Yes or No for Does Not Expire.');
    const neverExpires = ['true', 'yes', '1'].includes(noExpiry);
    if (!expiry && !neverExpires)
      throw Error('Enter an expiry date or mark Does Not Expire as Yes.');
    if (expiry && neverExpires)
      throw Error('Clear Expiry Date for a certification that does not expire.');
    if (expiry && expiry < issued) throw Error('Expiry Date is earlier than Issue Date.');
    return {
      row,
      section: 'Employee Certifications',
      status,
      issued,
      expiry,
      employee: text('Employee Code', 100, true),
      name: text('Certification', 200, true),
      issuer: text('Issuer', 120, true),
      category: text('Category', 80, true),
      credential: text('Credential ID', 200),
      source: text('Source', 120, true),
      sourceId: text('Source ID', 200, true),
    };
  }
  const targetId = text('ID', 36).toLowerCase();
  if (targetId && !uuid.test(targetId))
    throw Error('Use a catalogue ID from the export, or leave it blank for a new entry.');
  const name = text('Name', 100, true);
  if (sheet === 'Skills') {
    const status = text('Status', 20, true).toUpperCase();
    if (!['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(status)) throw Error('Check Status.');
    const published = status === 'PUBLISHED';
    return {
      row,
      targetId,
      section: 'SKILL',
      definition: {
        name,
        active: status !== 'ARCHIVED',
        status,
        category: text('Category', 80, true),
        description: text('Description', 2000, published),
        levels: commonLevels().map(level => ({
          ...level,
          description: text(level.name, 1000, published),
        })),
      },
    };
  }
  const activeValue = text('Active', 5, true).toLowerCase();
  if (!['true', 'false', '1', '0'].includes(activeValue))
    throw Error('Use TRUE or FALSE for Active.');
  const active = ['true', '1'].includes(activeValue);
  if (sheet === 'Issuers')
    return { row, targetId, section: 'PROVIDER', definition: { name, active } };
  const related = text('Related Skill IDs', 1000);
  const relatedSkillIds =
    related === '[]' ? [] : related.split(',').map(v => v.trim().toLowerCase());
  if (
    related &&
    (relatedSkillIds.length > 20 ||
      relatedSkillIds.some(id => !uuid.test(id)) ||
      new Set(relatedSkillIds).size !== relatedSkillIds.length)
  )
    throw Error('Use up to 20 unique related skill IDs, separated by commas.');
  return {
    row,
    targetId,
    section: 'CERTIFICATION',
    definition: {
      name,
      active,
      category: text('Category', 80, true),
      description: text('Description', 2000),
      providerName: text('Issuer', 100, true),
      ...(related ? { relatedSkillIds } : {}),
    },
  };
}

export function registerExcelBulkRoutes(app: Express, dependencies?: BulkDependencies) {
  if (!dependencies?.excelBulk) return;
  const store = dependencies.excelBulk;
  app.use('/api/excel/:kind', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const kind = req.params.kind;
    if (kind !== 'catalogue' && kind !== 'certifications' && kind !== 'employees')
      return next(new AccessError(404, 'Workbook unavailable.'));
    let identity: Identity;
    try {
      identity = await verifyRequestIdentity(req, dependencies.verify);
    } catch {
      return next(new AccessError(401, 'Sign in to continue.'));
    }
    const actor = await dependencies.resolveAccess?.(identity);
    if (!actor) return next(new AccessError(403, 'Workspace access is unavailable.'));
    res.locals.excelActor = actor;
    next();
  });
  app.get('/api/excel/:kind/access', async (req, res) => {
    res.json(await store.execute(res.locals.excelActor, req.params.kind as Kind, 'ACCESS'));
  });
  app.get('/api/excel/:kind/:file', async (req, res, next) => {
    const kind = req.params.kind as Kind;
    const actor = res.locals.excelActor as string;
    const sheets = sheetsByKind[kind];
    if (kind === 'employees' && req.params.file === 'export')
      return next(new AccessError(404, 'Workbook unavailable.'));
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const scope = req.query.scope;
    const hierarchy = req.query.hierarchy;
    const view = req.query.view ?? 'mine';
    const { category, issuer, status, validity, skillId, from, to } = req.query;
    const day = (value: unknown) => {
      if (value === undefined) return true;
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const timestamp = Date.parse(value);
      return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
    };
    if (
      search.length > 100 ||
      (view !== 'scope' && view !== 'mine') ||
      [scope, hierarchy, skillId].some(
        value => value !== undefined && (typeof value !== 'string' || !uuid.test(value)),
      ) ||
      [
        [category, 80],
        [issuer, 120],
        [status, 20],
        [validity, 10],
      ].some(
        ([value, max]) =>
          value !== undefined && (typeof value !== 'string' || value.length > Number(max)),
      ) ||
      !day(from) ||
      !day(to)
    )
      return next(new AccessError(400, 'Check the workbook export filters.'));
    if (req.params.file !== 'template' && req.params.file !== 'export') return next();
    if (req.params.file === 'template' || kind === 'catalogue' || view === 'mine') {
      const access = await store.execute<{ canImport: boolean }>(actor, kind, 'ACCESS');
      if (!access.canImport)
        return next(new AccessError(403, 'This workbook requires administration access.'));
    }
    const rows =
      req.params.file === 'template'
        ? {}
        : await store.execute<Parameters<typeof writeExcel>[1]>(actor, kind, 'EXPORT', {
            search,
            scope,
            hierarchy,
            view,
            category,
            issuer,
            status,
            validity,
            skillId,
            from,
            to,
          });
    if (Object.values(rows).some(records => records.length > 10000))
      return next(new AccessError(400, 'Too many records for one workbook. Narrow the search.'));
    res
      .type(excelMime)
      .attachment(`${kind}-${req.params.file}.xlsx`)
      .send(await writeExcel(sheets, rows));
  });
  const upload = raw({ type: [excelMime, 'application/octet-stream'], limit: excelUploadLimit });
  app.post(
    '/api/excel/:kind/:action',
    async (req, res, next) => {
      if (req.params.action !== 'preview' && req.params.action !== 'import') return next();
      const kind = req.params.kind as Kind;
      const access = await store.execute<{ canImport: boolean }>(
        res.locals.excelActor,
        kind,
        'ACCESS',
      );
      if (!access.canImport)
        return next(new AccessError(403, 'Bulk import requires administration access.'));
      next();
    },
    upload,
    async (req, res, next) => {
      const kind = req.params.kind as Kind;
      if (!Buffer.isBuffer(req.body))
        return next(new AccessError(400, 'Choose an .xlsx workbook.'));
      const digest = createHash('sha256').update(req.body).digest('hex');
      const importing = req.params.action === 'import';
      const actor = res.locals.excelActor as string;
      const [revisionText, expiresText, signature, extra] = (
        req.get('X-Workbook-Preview') ?? ''
      ).split('.');
      const revision = Number(revisionText);
      const expires = Number(expiresText);
      if (
        importing &&
        (extra !== undefined ||
          !Number.isSafeInteger(revision) ||
          revision < 0 ||
          !Number.isSafeInteger(expires) ||
          expires <= Date.now() ||
          !/^[a-f0-9]{64}$/.test(signature ?? '') ||
          !timingSafeEqual(
            Buffer.from(signature, 'hex'),
            previewSignature(actor, kind, digest, revision, expires),
          ))
      )
        return next(new AccessError(409, 'Preview this workbook before importing.'));
      const payload = normalize(kind, await readExcel(req.body, sheetsByKind[kind]));
      const result = await store.execute<{
        revision: number;
        changed: number;
        duplicates: number;
        unchanged?: number;
        examples?: { row: number; section: string; label: string }[];
      }>(actor, kind, importing ? 'IMPORT' : 'PREVIEW', payload, importing ? revision : undefined);
      if (!importing && kind === 'catalogue' && result.unchanged === undefined)
        return next(
          new AccessError(503, 'Automatic catalogue import requires database migration 100.'),
        );
      const previewExpires = Date.now() + 10 * 60_000;
      const preview = importing
        ? undefined
        : `${result.revision}.${previewExpires}.${previewSignature(actor, kind, digest, result.revision, previewExpires).toString('hex')}`;
      const examples = importing
        ? undefined
        : (result.examples ??
          payload.rows.slice(0, 20).map(row => ({
            row: row.row,
            section: row.section,
            label: row.definition?.name ?? `${row.employee} · ${row.name}`,
          })));
      res.json({ ...result, preview, examples });
    },
  );
  const handleExcelError: ErrorRequestHandler = (error, _req, res, next) => {
    if (!(error instanceof AccessError)) return next(error);
    res.status(error.status).json({ error: { message: error.message } });
  };
  app.use('/api/excel/:kind', handleExcelError);
}
