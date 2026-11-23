import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import ExcelJS from 'exceljs';
import express from 'express';
import {
  registerExcelBulkRoutes,
  type SqlExcelBulkData,
} from '../src/modules/skills/excel-bulk-routes.js';
import { excelMime, readExcel, writeExcel } from '../src/modules/skills/excel-workbook.js';
import { registerCompanySessions } from '../src/modules/identity/company-session.js';

const people = [
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

test('Excel exports preserve text identifiers and reject formula cells on upload', async () => {
  const textValues = ['=1+1', '+005', '-001', '@example'];
  const data = {
    'Employee Certifications': textValues.map(Certification => ({
      'Employee Code': '007012',
      Certification,
    })),
  };
  const output = await writeExcel(people, data);
  const parsed = await readExcel(output, people);
  assert.deepEqual(
    parsed['Employee Certifications'].map(row => row.values.Certification),
    textValues,
  );
  assert.equal(parsed['Employee Certifications'][0].values['Employee Code'], '007012');
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(output as unknown as ExcelJS.Buffer);
  for (const [index, value] of textValues.entries()) {
    const cell = exported
      .getWorksheet(people[0].name)!
      .getRow(index + 2)
      .getCell(2);
    assert.equal(cell.type, ExcelJS.ValueType.String);
    assert.equal(cell.value, value);
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(people[0].name);
  sheet.addRow(people[0].columns);
  sheet.addRow(['007012', { formula: '1+1', result: 2 }]);
  await assert.rejects(
    readExcel(Buffer.from(await workbook.xlsx.writeBuffer()), people),
    /use plain cell values/,
  );

  const errors = new ExcelJS.Workbook();
  const errorsSheet = errors.addWorksheet(people[0].name);
  errorsSheet.addRow(people[0].columns);
  errorsSheet.addRow(['007012', { error: '#VALUE!' as const }]);
  await assert.rejects(
    readExcel(Buffer.from(await errors.xlsx.writeBuffer()), people),
    /use plain cell values/,
  );
});

test('Excel imports display text from email links, URL links and formatted text', async () => {
  const columns = ['Work Email', 'Credential URL', 'Certification', 'Formatted Link'];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Import');
  sheet.addRow(columns);
  sheet.addRow([
    { text: 'sample@example.test', hyperlink: 'mailto:other@example.test' },
    { text: 'https://example.test/certificate', hyperlink: 'https://example.test/other' },
    { richText: [{ font: { bold: true }, text: 'Azure' }, { text: ' Fundamentals' }] },
    {
      text: { richText: [{ font: { bold: true }, text: 'ada' }, { text: '@example.test' }] },
      hyperlink: 'mailto:ada@example.test',
    },
  ]);
  const result = await readExcel(Buffer.from(await workbook.xlsx.writeBuffer()), [
    { name: 'Import', columns },
  ]);
  assert.deepEqual(result.Import, [
    {
      row: 2,
      values: {
        'Work Email': 'sample@example.test',
        'Credential URL': 'https://example.test/certificate',
        Certification: 'Azure Fundamentals',
        'Formatted Link': 'ada@example.test',
      },
    },
  ]);
});

test('Excel import requires current access and a preview for the exact workbook', async t => {
  const app = express();
  const origin = 'https://skills.example.test';
  const identity = { tenantId: 'test-tenant', objectId: 'test-object' };
  const session = registerCompanySessions(app, origin, undefined);
  app.post('/__test/session', async (req, res) => {
    assert.ok(await session.issueFromOidc(req, res, identity, Date.now() + 60000));
    res.sendStatus(204);
  });
  let canImport = false;
  const operations: string[] = [];
  let employeeRows: unknown;
  const execute: SqlExcelBulkData['execute'] = async <T>(
    _actor: string,
    kind: unknown,
    operation: string,
    payload?: object,
  ) => {
    operations.push(operation);
    if (kind === 'employees' && operation === 'IMPORT') employeeRows = payload;
    return (
      operation === 'ACCESS'
        ? { canImport }
        : { revision: 42, changed: 1, duplicates: 0, added: 1, updated: 0, unchanged: 0 }
    ) as T;
  };
  registerExcelBulkRoutes(app, {
    excelPreviewReceiptSecret: 'excel-test-fixture-key',
    verify: async () => {
      throw Error('Expected company cookie.');
    },
    resolveAccess: async verified => {
      assert.deepEqual(verified, identity);
      return 'test-person';
    },
    excelBulk: { execute },
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const host = 'http://127.0.0.1:' + address.port;
  const url = host + '/api/excel/certifications';
  assert.equal((await fetch(url + '/access')).status, 401);
  const issued = await fetch(host + '/__test/session', { method: 'POST' });
  const cookie = issued.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await fetch(url + '/access', { headers: { Cookie: cookie } })).status, 200);
  for (const path of [
    '/api/excel/catalogue/export',
    '/api/excel/catalogue/export?view=scope',
    '/api/excel/certifications/export',
  ]) {
    assert.equal((await fetch(host + path, { headers: { Cookie: cookie } })).status, 403);
  }
  assert.equal(operations.includes('EXPORT'), false);
  const record = {
    'Employee Code': '007012',
    Certification: 'Azure Fundamentals',
    Issuer: 'Microsoft',
    Category: 'Cloud',
    'Issue Date': '2025-04-19',
    'Does Not Expire': 'Yes',
    Status: 'Approved',
    Source: 'Legacy Learning',
    'Source ID': 'AZ-001',
  };
  const workbook = await writeExcel(people, { 'Employee Certifications': [record] });
  const send = (action: string, body: Buffer, preview?: string) =>
    fetch(url + '/' + action, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': excelMime,
        ...(preview ? { 'X-Workbook-Preview': preview } : {}),
      },
      body: new Uint8Array(body),
    });
  assert.equal((await send('preview', workbook)).status, 403);
  canImport = true;
  assert.equal((await send('import', workbook)).status, 409);
  const previewResponse = await send('preview', workbook);
  assert.equal(previewResponse.status, 200);
  const { preview } = (await previewResponse.json()) as { preview: string };
  const altered = await writeExcel(people, {
    'Employee Certifications': [{ ...record, 'Source ID': 'AZ-002' }],
  });
  assert.equal((await send('import', altered, preview)).status, 409);
  canImport = false;
  assert.equal((await send('import', workbook, preview)).status, 403);
  canImport = true;
  assert.equal((await send('import', workbook, preview)).status, 200);
  assert.equal(operations.filter(operation => operation === 'IMPORT').length, 1);

  const catalogue = host + '/api/excel/catalogue';
  const template = await fetch(catalogue + '/template', { headers: { Cookie: cookie } });
  assert.equal(template.status, 200);
  const unmarked = new ExcelJS.Workbook();
  await unmarked.xlsx.load((await template.arrayBuffer()) as unknown as ExcelJS.Buffer);
  const skills = unmarked.getWorksheet('Skills')!;
  assert.equal(skills.getRow(1).getCell(1).value, 'ID');
  skills.spliceColumns(1, 0, ['Action']);
  skills.addRow([null, null, 'Platform Engineering', 'Cloud', 'Platform operations', 'DRAFT']);
  const result = await fetch(catalogue + '/preview', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin, 'Content-Type': excelMime },
    body: new Uint8Array(await unmarked.xlsx.writeBuffer()),
  });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).added, 1);

  const employees = host + '/api/excel/employees';
  const employeeTemplate = await fetch(employees + '/template', { headers: { Cookie: cookie } });
  assert.equal(employeeTemplate.status, 200);
  const employeeWorkbook = new ExcelJS.Workbook();
  await employeeWorkbook.xlsx.load(
    (await employeeTemplate.arrayBuffer()) as unknown as ExcelJS.Buffer,
  );
  const employeeSheet = employeeWorkbook.getWorksheet('Employees')!;
  assert.equal(employeeSheet.getColumn(1).numFmt, '@');
  employeeSheet.addRow([
    '007012',
    'Sample Employee',
    'SAMPLE@EXAMPLE.TEST',
    'Noida Campus',
    'Engineer',
    'G2',
    'SQL',
    'DU UK',
    'UK Portfolio',
    'NHS SBS IT',
    'NHS Project',
    '001000',
  ]);
  const employeeUpload = new Uint8Array(await employeeWorkbook.xlsx.writeBuffer());
  const submitEmployee = (action: string, body: Uint8Array<ArrayBuffer>, receipt?: string) =>
    fetch(employees + '/' + action, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': excelMime,
        ...(receipt ? { 'X-Workbook-Preview': receipt } : {}),
      },
      body,
    });
  const approvedEmployeePreview = await submitEmployee('preview', employeeUpload);
  assert.equal(approvedEmployeePreview.status, 200);
  const employeeReceipt = (await approvedEmployeePreview.json()).preview;
  assert.equal((await submitEmployee('import', employeeUpload, employeeReceipt)).status, 200);
  assert.deepEqual(employeeRows, {
    rows: [
      {
        row: 2,
        section: 'Employees',
        employee: '007012',
        name: 'Sample Employee',
        workEmail: 'sample@example.test',
        workLocation: 'Noida Campus',
        jobTitle: 'Engineer',
        grade: 'G2',
        primarySkill: 'SQL',
        deliveryUnit: 'DU UK',
        portfolio: 'UK Portfolio',
        client: 'NHS SBS IT',
        project: 'NHS Project',
        manager: '001000',
      },
    ],
  });
  employeeSheet.addRow(['007012', 'Duplicate Employee']);
  const duplicateUpload = new Uint8Array(await employeeWorkbook.xlsx.writeBuffer());
  const duplicate = await submitEmployee('preview', duplicateUpload);
  assert.equal(duplicate.status, 400);
  assert.match((await duplicate.json()).error.message, /row 3.*Duplicate employee code/);
  assert.equal((await submitEmployee('import', duplicateUpload, employeeReceipt)).status, 409);
});
