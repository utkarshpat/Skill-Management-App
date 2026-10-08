import { sqlFeatures } from './sql-features.js';

export const legacyMigrationBaselineVersion = 52;

export const filteredUniqueIndexes = sqlFeatures.filteredUniqueIndexes;
export const checkConstraints = sqlFeatures.checkConstraints;
export const rowversionColumns = sqlFeatures.rowversionColumns.map(
  ({ table, column }) => [table, column] as const,
);

type FilteredIndex = {
  table_name: string;
  index_name: string;
  is_unique: boolean;
  key_columns: string;
  filter_definition: string | null;
};

type SqlColumn = {
  table_name: string;
  column_name: string;
  system_type_id: number;
  max_length: number;
};

function normalizeSql(expression: string): string {
  return expression.replace(/[\[\]\s()]/g, '').toUpperCase();
}

export function baselineIssues(
  appliedVersions: number[],
  indexes: FilteredIndex[],
  columns: SqlColumn[],
): string[] {
  const issues: string[] = [];
  const applied = new Set(appliedVersions);
  const missingVersions = Array.from(
    { length: legacyMigrationBaselineVersion },
    (_, index) => index + 1,
  ).filter(version => !applied.has(version));
  if (missingVersions.length) issues.push(`Missing SQL migrations: ${missingVersions.join(', ')}.`);

  const duplicateVersions = appliedVersions.filter(
    (version, index) => appliedVersions.indexOf(version) !== index,
  );
  if (duplicateVersions.length)
    issues.push(`Duplicate SQL migration versions: ${[...new Set(duplicateVersions)].join(', ')}.`);

  for (const expected of filteredUniqueIndexes) {
    const actual = indexes.find(
      index => index.table_name === expected.table && index.index_name === expected.name,
    );
    if (
      !actual ||
      !actual.is_unique ||
      actual.key_columns !== expected.columns.join(',') ||
      !actual.filter_definition ||
      normalizeSql(actual.filter_definition) !== normalizeSql(expected.predicate)
    ) {
      issues.push(
        `Missing or incorrect filtered unique index dbo.${expected.name} on dbo.${expected.table} (WHERE ${expected.predicate}).`,
      );
    }
  }

  for (const [table, column] of rowversionColumns) {
    const actual = columns.find(item => item.table_name === table && item.column_name === column);
    if (!actual || actual.system_type_id !== 189 || actual.max_length !== 8)
      issues.push(`dbo.${table}.${column} must be SQL Server rowversion (8 bytes).`);
  }

  return issues;
}
