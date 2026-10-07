import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    provider: 'sqlserver',
    url:
      process.env.DATABASE_URL ||
      `sqlserver://${process.env.AZURE_SQL_SERVER ?? 'localhost'}:1433;database=${process.env.AZURE_SQL_DATABASE ?? 'capability_db'};encrypt=true;trustServerCertificate=false`,
  },
});
