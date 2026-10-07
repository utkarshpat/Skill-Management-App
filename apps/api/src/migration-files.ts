import { readdir } from 'node:fs/promises';

export type MigrationFile = { version: number; filename: string };

const migrationName = /^(\d{3})_[a-z0-9_]+\.sql$/;

export function parseMigrationFiles(filenames: string[]): MigrationFile[] {
  const migrations = filenames
    .filter(name => name.endsWith('.sql'))
    .map(filename => {
      const match = migrationName.exec(filename);
      if (!match) throw new Error(`Invalid migration filename: ${filename}`);
      return { version: Number(match[1]), filename };
    })
    .sort((a, b) => a.version - b.version);
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1)
      throw new Error(
        `Migration versions must be contiguous from 001; found ${migration.filename} at position ${index + 1}.`,
      );
  });
  return migrations;
}

export async function listMigrationFiles(directory: URL): Promise<MigrationFile[]> {
  return parseMigrationFiles(await readdir(directory));
}
