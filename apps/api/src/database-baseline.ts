export const legacyMigrationBaselineVersion = 52;

export const filteredUniqueIndexes = [
  {
    table: 'AccessOrgNode',
    name: 'UX_AccessOrg_Root',
    columns: ['account_id', 'display_name'],
    predicate: 'parent_id IS NULL',
  },
  {
    table: 'AccessOrgNode',
    name: 'UX_AccessOrg_Sibling',
    columns: ['account_id', 'parent_id', 'display_name'],
    predicate: 'parent_id IS NOT NULL',
  },
  {
    table: 'AccessPerson',
    name: 'UX_AccessPerson_Entra',
    columns: ['account_id', 'entra_object_id'],
    predicate: 'entra_object_id IS NOT NULL',
  },
  {
    table: 'ProficiencyFramework',
    name: 'UX_ProficiencyFramework_Common',
    columns: ['framework_key'],
    predicate: 'account_id IS NULL',
  },
  {
    table: 'ReportingRelationship',
    name: 'UX_Reporting_Open',
    columns: ['account_id', 'employee_id'],
    predicate: 'valid_until IS NULL',
  },
  {
    table: 'SkillCatalogue',
    name: 'UX_SkillCatalogue_Code',
    columns: ['account_id', 'business_code'],
    predicate: 'business_code IS NOT NULL',
  },
] as const;

export const rowversionColumns = [
  ['Account', 'record_version'],
  ['AppUser', 'record_version'],
  ['ReportingRelationship', 'record_version'],
  ['UserPermission', 'record_version'],
] as const;

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
