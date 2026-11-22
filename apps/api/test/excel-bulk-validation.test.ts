import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import ExcelJS from 'exceljs';
import {
  registerExcelBulkRoutes,
  type SqlExcelBulkData,
} from '../src/modules/skills/excel-bulk-routes.js';
import { excelMime } from '../src/modules/skills/excel-workbook.js';

test('Excel boundaries reject invalid filters, malformed previews and invalid history before writes', async t => {
  const app = express();
  const operations: { kind: string; operation: string; payload: any }[] = [];
  let canImport = true;
  let legacySchema = false;
  const execute: SqlExcelBulkData['execute'] = async <T>(
    ...[_actor, kind, operation, payload]: Parameters<SqlExcelBulkData['execute']>
  ): Promise<T> => {
    operations.push({ kind, operation, payload });
    return (
      operation === 'ACCESS'
        ? { canImport }
        : operation === 'EXPORT'
          ? {}
          : { revision: 3, changed: 1, ...(!legacySchema ? { unchanged: 0 } : {}) }
    ) as T;
  };
  registerExcelBulkRoutes(app, {
    excelPreviewReceiptSecret: 'excel-test-fixture-key',
    verify: async () => ({ tenantId: 'tenant', objectId: 'object' }),
    resolveAccess: async () => 'person',
    excelBulk: { execute },
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const host = `http://127.0.0.1:${address.port}/api/excel/`;
  assert.equal(
    (
      await fetch(host + 'catalogue/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    400,
  );
  assert.equal((await fetch(host + 'unknown/access')).status, 404);
  assert.equal((await fetch(host + 'catalogue/unknown')).status, 404);
  for (const query of [
    'search=' + 'a'.repeat(101),
    'view=all',
    'scope=bad',
    'hierarchy=bad',
    'skillId=bad',
    'category=' + 'a'.repeat(81),
    'issuer=' + 'a'.repeat(121),
    'status=' + 'a'.repeat(21),
    'validity=' + 'a'.repeat(11),
    'category=a&category=b',
    'from=bad',
    'to=2026-02-30',
  ]) {
    assert.equal((await fetch(host + 'certifications/export?' + query)).status, 400, query);
  }
  canImport = false;
  // Scoped exports rely on the execution-time SQL check rather than admin import access.
  assert.equal(
    (await fetch(host + 'certifications/export?view=scope&from=2026-02-28&to=2026-03-01')).status,
    200,
  );
  assert.ok(operations.some(x => x.operation === 'EXPORT' && x.payload.view === 'scope'));
  canImport = true;
  const template = async (kind: string) => {
    const response = await fetch(host + kind + '/template');
    assert.equal(response.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await response.arrayBuffer()) as unknown as ExcelJS.Buffer);
    return workbook;
  };
  const send = async (
    kind: string,
    workbook: ExcelJS.Workbook,
    action = 'preview',
    receipt?: string,
  ) =>
    fetch(host + kind + '/' + action, {
      method: 'POST',
      headers: { 'Content-Type': excelMime, ...(receipt ? { 'X-Workbook-Preview': receipt } : {}) },
      body: new Uint8Array(await workbook.xlsx.writeBuffer()),
    });
  const catalogue = await template('catalogue');
  assert.equal((await send('catalogue', catalogue)).status, 400);
  const issuer = catalogue.getWorksheet('Issuers')!;
  issuer.addRow(['', 'Microsoft', 'TRUE']);
  for (const receipt of [
    '-1.9999999999999.' + 'a'.repeat(64),
    '1.0.' + 'a'.repeat(64),
    '1.9999999999999.no',
    '1.9999999999999.' + 'a'.repeat(64) + '.extra',
    '1.9999999999999.' + 'a'.repeat(64),
  ])
    assert.equal((await send('catalogue', catalogue, 'import', receipt)).status, 409, receipt);
  legacySchema = true;
  assert.equal((await send('catalogue', catalogue)).status, 503);
  legacySchema = false;
  const skills = catalogue.getWorksheet('Skills')!;
  assert.equal(skills.getRow(1).getCell(6).value, 'Beginner');
  const certificates = catalogue.getWorksheet('Certifications')!;
  const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const rejectCatalogue = async (message: RegExp) => {
    const response = await send('catalogue', catalogue);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, message);
  };
  issuer.getRow(2).getCell(1).value = 'invalid';
  await rejectCatalogue(/catalogue ID/);
  issuer.getRow(2).getCell(1).value = id;
  issuer.addRow([id, 'Duplicate provider', 'TRUE']);
  await rejectCatalogue(/ID occurs/);
  issuer.getRow(3).values = [];
  issuer.getRow(2).getCell(3).value = 'yes';
  await rejectCatalogue(/TRUE or FALSE/);
  issuer.getRow(2).getCell(3).value = 'FALSE';
  skills.getRow(2).values = ['', 'SQL', 'Data', 'Query data', 'UNKNOWN'];
  await rejectCatalogue(/Status/);
  skills.getRow(2).getCell(5).value = 'PUBLISHED';
  await rejectCatalogue(/Beginner/);
  skills.getRow(2).values = [
    '',
    'SQL',
    'Data',
    'Query data',
    'PUBLISHED',
    'Basic',
    'Independent',
    'Advanced',
    'Expert',
  ];
  certificates.getRow(2).values = [
    '',
    'Azure',
    'Cloud',
    'Certification',
    'Microsoft',
    'TRUE',
    'bad',
  ];
  await rejectCatalogue(/related skill IDs/);
  certificates.getRow(2).getCell(7).value = `${id},${id}`;
  await rejectCatalogue(/unique related skill IDs/);
  certificates.getRow(2).getCell(7).value = id;
  assert.equal((await send('catalogue', catalogue)).status, 200);
  const catalogueRows = operations.filter(x => x.operation === 'PREVIEW').at(-1)!.payload.rows;
  assert.deepEqual(
    catalogueRows.map((row: any) => row.section),
    ['PROVIDER', 'SKILL', 'CERTIFICATION'],
  );
  assert.equal(catalogueRows[0].definition.active, false);
  assert.deepEqual(catalogueRows[2].definition.relatedSkillIds, [id]);
  skills.getRow(1).getCell(6).value = 'Foundation';
  assert.equal((await send('catalogue', catalogue)).status, 200);
  assert.equal(
    operations.filter(x => x.operation === 'PREVIEW').at(-1)!.payload.rows[1].definition.levels[0]
      .name,
    'Beginner',
  );
  certificates.getRow(2).getCell(7).value = '[]';
  skills.getRow(2).getCell(5).value = 'ARCHIVED';
  assert.equal((await send('catalogue', catalogue)).status, 200);
  const archived = operations.filter(x => x.operation === 'PREVIEW').at(-1)!.payload.rows;
  assert.equal(archived[1].definition.active, false);
  assert.deepEqual(archived[2].definition.relatedSkillIds, []);
  const base = [
    '007012',
    'Azure',
    'Microsoft',
    'Cloud',
    '2026-01-01',
    '',
    'Yes',
    '',
    'Approved',
    'Legacy',
    'A1',
  ];
  const history = await template('certifications');
  const sheet = history.getWorksheet('Employee Certifications')!;
  const clear = () => {
    for (let row = 2; row <= sheet.rowCount; row++) sheet.getRow(row).values = [];
  };
  const invalid = [
    { field: 9, value: 'Pending', message: /Only approved/ },
    { field: 5, value: '2026-02-30', message: /YYYY-MM-DD/ },
    { field: 7, value: 'maybe', message: /Yes or No/ },
    { field: 7, value: 'No', message: /Enter an expiry date/ },
    { field: 6, value: '2027-01-01', message: /Clear Expiry Date/ },
    { field: 1, value: '', message: /Employee Code/ },
    { field: 2, value: 'a'.repeat(201), message: /Certification/ },
  ];
  for (const { field, value, message } of invalid) {
    clear();
    sheet.getRow(2).values = [...base];
    sheet.getRow(2).getCell(field).value = value;
    const response = await send('certifications', history);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, message);
  }
  clear();
  sheet.getRow(2).values = [...base];
  sheet.getRow(2).getCell(6).value = '2025-01-01';
  sheet.getRow(2).getCell(7).value = 'No';
  assert.match((await (await send('certifications', history)).json()).error.message, /earlier/);
  clear();
  sheet.getRow(2).values = [...base];
  sheet.getRow(3).values = [...base];
  assert.match(
    (await (await send('certifications', history)).json()).error.message,
    /Source and Source ID occur/,
  );
  clear();
  const valid = [...base];
  valid[5] = '2027-01-01';
  valid[6] = 'No';
  sheet.getRow(2).values = valid;
  const response = await send('certifications', history);
  const preview = await response.json();
  assert.equal(response.status, 200, JSON.stringify(preview));
  assert.match(preview.examples[0].label, /007012.*Azure/);
  const payload = operations.filter(x => x.operation === 'PREVIEW').at(-1)!.payload;
  assert.equal(payload.rows[0].expiry, '2027-01-01');
  assert.equal(payload.rows[0].status, 'APPROVED');
  assert.equal(
    operations.some(x => x.operation === 'IMPORT'),
    false,
  );
});

test('Excel identity provisioning and database failures do not masquerade as expired sessions', async t => {
  const app = express();
  let provisioned = false;
  let databaseFailed = false;
  registerExcelBulkRoutes(app, {
    excelPreviewReceiptSecret: 'excel-test-fixture-key',
    verify: async () => ({ tenantId: 'tenant', objectId: 'object' }),
    resolveAccess: async () => {
      if (databaseFailed) throw Error('database unavailable');
      return provisioned ? 'person' : undefined;
    },
    excelBulk: { execute: async <T>() => ({ canImport: true }) as T },
  });
  app.use(((
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(503).json({ error: { message: error.message } });
  }) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/excel/catalogue/access`;
  assert.equal((await fetch(url)).status, 403);
  provisioned = true;
  assert.equal((await fetch(url)).status, 200);
  databaseFailed = true;
  const response = await fetch(url);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error.message, /database unavailable/);
});
