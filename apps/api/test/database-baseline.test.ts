import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baselineIssues,
  filteredUniqueIndexes,
  legacyMigrationBaselineVersion,
  rowversionColumns,
} from '../src/database-baseline.js';

const completeMigrationHistory = Array.from(
  { length: legacyMigrationBaselineVersion },
  (_, index) => index + 1,
);
const completeIndexMetadata = filteredUniqueIndexes.map(index => ({
  table_name: index.table,
  index_name: index.name,
  is_unique: true,
  key_columns: index.columns.join(','),
  filter_definition: `([${index.predicate}])`,
}));
const completeRowversionMetadata = rowversionColumns.map(([table, column]) => ({
  table_name: table,
  column_name: column,
  system_type_id: 189,
  max_length: 8,
}));

test('baseline accepts the complete SQL migration and SQL Server metadata contract', () => {
  assert.deepEqual(
    baselineIssues(completeMigrationHistory, completeIndexMetadata, completeRowversionMetadata),
    [],
  );
});

test('baseline reports missing and duplicate legacy migration versions', () => {
  const issues = baselineIssues(
    [...completeMigrationHistory.filter(version => version !== 37), 1],
    completeIndexMetadata,
    completeRowversionMetadata,
  );
  assert.ok(issues.some(issue => issue.includes('Missing SQL migrations: 37')));
  assert.ok(issues.some(issue => issue.includes('Duplicate SQL migration versions: 1')));
});

test('baseline rejects absent, non-unique, or incorrectly filtered indexes', () => {
  const indexes = completeIndexMetadata.map(index =>
    index.index_name === 'UX_Reporting_Open'
      ? { ...index, is_unique: false, filter_definition: '([valid_until] IS NOT NULL)' }
      : index,
  );
  indexes.pop();
  const issues = baselineIssues(completeMigrationHistory, indexes, completeRowversionMetadata);
  assert.ok(issues.some(issue => issue.includes('UX_Reporting_Open')));
  assert.ok(issues.some(issue => issue.includes('UX_SkillCatalogue_Code')));
});

test('baseline requires exact filtered-index predicates and key columns', () => {
  const indexes = completeIndexMetadata.map(index =>
    index.index_name === 'UX_Reporting_Open'
      ? {
          ...index,
          key_columns: 'account_id,manager_id',
          filter_definition: '([valid_until] IS NULL OR [employee_id] IS NULL)',
        }
      : index,
  );
  const issues = baselineIssues(completeMigrationHistory, indexes, completeRowversionMetadata);
  assert.ok(issues.some(issue => issue.includes('UX_Reporting_Open')));
});

test('baseline requires SQL Server rowversion columns, not merely eight-byte binary', () => {
  const columns = completeRowversionMetadata.map(column =>
    column.table_name === 'AppUser' ? { ...column, system_type_id: 173 } : column,
  );
  const issues = baselineIssues(completeMigrationHistory, completeIndexMetadata, columns);
  assert.ok(issues.some(issue => issue.includes('dbo.AppUser.record_version')));
});
