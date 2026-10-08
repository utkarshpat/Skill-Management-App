import features from './sql-features.json' with { type: 'json' };

export type FilteredUniqueIndex = {
  table: string;
  name: string;
  columns: string[];
  predicate: string;
};
export type RowversionColumn = { table: string; column: string };
export type CheckConstraint = { table: string; name: string; expression: string };
export type SqlFeatures = {
  filteredUniqueIndexes: FilteredUniqueIndex[];
  rowversionColumns: RowversionColumn[];
  checkConstraints: CheckConstraint[];
};

export const sqlFeatures: SqlFeatures = features;

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const safeSql = /^[^;]*$/;
const quote = (value: string) => {
  if (!identifier.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `[${value}]`;
};
const table = (value: string) => `[dbo].${quote(value)}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function createIndex(index: FilteredUniqueIndex): string {
  if (!safeSql.test(index.predicate)) throw new Error(`Unsafe predicate for ${index.name}.`);
  return `CREATE UNIQUE INDEX ${quote(index.name)} ON ${table(index.table)}(${index.columns.map(quote).join(', ')}) WHERE ${index.predicate};`;
}
const dropIndex = (index: FilteredUniqueIndex) =>
  `DROP INDEX ${quote(index.name)} ON ${table(index.table)};`;

function addCheck(check: CheckConstraint): string {
  if (!safeSql.test(check.expression)) throw new Error(`Unsafe expression for ${check.name}.`);
  return `ALTER TABLE ${table(check.table)} ADD CONSTRAINT ${quote(check.name)} CHECK (${check.expression});`;
}
const dropCheck = (check: CheckConstraint) =>
  `ALTER TABLE ${table(check.table)} DROP CONSTRAINT ${quote(check.name)};`;

function diffNamed<T extends { name: string }>(
  before: T[],
  after: T[],
  create: (item: T) => string,
  drop: (item: T) => string,
): string[] {
  const statements: string[] = [];
  for (const old of before) {
    const next = after.find(item => item.name === old.name);
    if (!next || !same(old, next)) statements.push(drop(old));
  }
  for (const next of after) {
    const old = before.find(item => item.name === next.name);
    if (!old || !same(old, next)) statements.push(create(next));
  }
  return statements;
}

// Prisma maps Bytes to BINARY(8); declared rowversion columns must be emitted as ROWVERSION.
export function applyRowversion(prismaSql: string, columns: RowversionColumn[]): string {
  return prismaSql
    .split(/\n\s*\n/)
    .map(chunk => {
      let result = chunk;
      for (const { table: tableName, column } of columns) {
        if (!new RegExp(`(CREATE|ALTER) TABLE \\[dbo\\]\\.\\[${tableName}\\]`).test(chunk))
          continue;
        result = result.replace(
          new RegExp(`\\[${column}\\] BINARY\\(8\\)[^,\\n)]*`, 'g'),
          `[${column}] ROWVERSION`,
        );
      }
      return result;
    })
    .join('\n\n');
}

export function diffSqlFeatures(before: SqlFeatures, after: SqlFeatures): string[] {
  return [
    ...diffNamed(before.filteredUniqueIndexes, after.filteredUniqueIndexes, createIndex, dropIndex),
    ...diffNamed(before.checkConstraints, after.checkConstraints, addCheck, dropCheck),
  ];
}

// A rowversion declaration is only generatable when Prisma is adding that column in the same diff.
export function newRowversionColumns(before: SqlFeatures, after: SqlFeatures): RowversionColumn[] {
  const existing = new Set(before.rowversionColumns.map(item => `${item.table}.${item.column}`));
  return after.rowversionColumns.filter(item => !existing.has(`${item.table}.${item.column}`));
}
