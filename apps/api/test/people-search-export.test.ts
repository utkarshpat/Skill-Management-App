import test from 'node:test';
import assert from 'node:assert/strict';
import { businessCsv, businessXlsx } from '../src/modules/business/export.js';
import { businessQuery, type BusinessDashboard } from '../src/modules/business/index.js';
import { unzipSync, strFromU8 } from 'fflate';
test('empty matching exports retain criteria and headers; spreadsheet data and metadata are escaped', () => {
  const data: BusinessDashboard = {
    context: {
      revision: 1,
      asOf: '2026-10-14',
      canView: true,
      canExport: true,
      canManage: false,
      canAmend: false,
      personalBaseline: true,
      scopes: [],
    },
    summary: { employees: 0, certified: 0, skilled: 0, pending: 0, expired: 0, expiring: 0 },
    coverage: [],
    distribution: [],
    expiry: [],
    activity: [],
    rows: [],
    total: 0,
    page: 1,
    pageSize: 5000,
  };
  const q = businessQuery({ dataset: 'people' }),
    options = {
      columns: ['employee', 'employeeCode', 'requirements'],
      metadata: [['Requirement', '=Untrusted, quoted "skill"']],
    };
  const csv = businessCsv(data, q, options);
  assert.match(csv, /"employee","employeeCode","requirements"/);
  assert.match(csv, /Requirement/);
  assert.match(csv, /'=Untrusted/);
  data.rows = [{ employee: '=Formula', employeeCode: 'EMP-1', requirements: 'A & <B>' }];
  data.total = 1;
  const zip = unzipSync(businessXlsx(data, q, options));
  const sheet = strFromU8(zip['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /&apos;=Formula/);
  assert.match(sheet, /A &amp; &lt;B&gt;/);
  const context = strFromU8(zip['xl/worksheets/sheet2.xml']);
  assert.match(context, /&apos;=Untrusted/);
});
