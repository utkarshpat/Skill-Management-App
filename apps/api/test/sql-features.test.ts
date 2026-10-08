import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyRowversion,
  diffSqlFeatures,
  newRowversionColumns,
  type SqlFeatures,
} from '../src/sql-features.js';

const empty: SqlFeatures = {
  filteredUniqueIndexes: [],
  rowversionColumns: [],
  checkConstraints: [],
};
const index = {
  table: 'Thing',
  name: 'UX_Thing_Code',
  columns: ['account_id', 'code'],
  predicate: 'code IS NOT NULL',
};

test('diffSqlFeatures creates and drops filtered unique indexes', () => {
  const after = { ...empty, filteredUniqueIndexes: [index] };
  assert.deepEqual(diffSqlFeatures(empty, after), [
    'CREATE UNIQUE INDEX [UX_Thing_Code] ON [dbo].[Thing]([account_id], [code]) WHERE code IS NOT NULL;',
  ]);
  assert.deepEqual(diffSqlFeatures(after, empty), ['DROP INDEX [UX_Thing_Code] ON [dbo].[Thing];']);
  assert.deepEqual(diffSqlFeatures(after, after), []);
});

test('diffSqlFeatures recreates a changed index and handles check constraints', () => {
  const before = { ...empty, filteredUniqueIndexes: [index] };
  const after = { ...empty, filteredUniqueIndexes: [{ ...index, predicate: 'code <> 0' }] };
  assert.equal(diffSqlFeatures(before, after).length, 2);
  const check = { table: 'Thing', name: 'CK_Thing_Code', expression: 'LEN(code) > 0' };
  assert.deepEqual(diffSqlFeatures(empty, { ...empty, checkConstraints: [check] }), [
    'ALTER TABLE [dbo].[Thing] ADD CONSTRAINT [CK_Thing_Code] CHECK (LEN(code) > 0);',
  ]);
});

test('diffSqlFeatures rejects unsafe identifiers and statements', () => {
  assert.throws(() =>
    diffSqlFeatures(empty, { ...empty, filteredUniqueIndexes: [{ ...index, table: 'Thing];--' }] }),
  );
  assert.throws(() =>
    diffSqlFeatures(empty, {
      ...empty,
      filteredUniqueIndexes: [{ ...index, predicate: '1=1; DROP TABLE X' }],
    }),
  );
});

test('applyRowversion rewrites only declared columns in their own table', () => {
  const sql = [
    'CREATE TABLE [dbo].[Thing] (\n    [record_version] BINARY(8) NOT NULL,\n    [other] BINARY(8)\n);',
    'CREATE TABLE [dbo].[Other] (\n    [record_version] BINARY(8) NOT NULL\n);',
  ].join('\n\n');
  const out = applyRowversion(sql, [{ table: 'Thing', column: 'record_version' }]);
  assert.match(out, /\[Thing\] \(\n {4}\[record_version\] ROWVERSION,\n {4}\[other\] BINARY\(8\)/);
  assert.match(out, /\[Other\] \(\n {4}\[record_version\] BINARY\(8\) NOT NULL/);
});

test('newRowversionColumns lists only newly declared columns', () => {
  const before = { ...empty, rowversionColumns: [{ table: 'A', column: 'v' }] };
  const after = {
    ...empty,
    rowversionColumns: [
      { table: 'A', column: 'v' },
      { table: 'B', column: 'v' },
    ],
  };
  assert.deepEqual(newRowversionColumns(before, after), [{ table: 'B', column: 'v' }]);
});
