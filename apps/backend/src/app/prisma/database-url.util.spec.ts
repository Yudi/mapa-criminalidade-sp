import {
  getDatabaseUrl,
  removePrismaConnectionOptions,
} from './database-url.util';

describe('database-url.util', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('uses default internal credentials when production has no database URL', () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = 'production';

    expect(getDatabaseUrl()).toContain('postgres:postgres@localhost:5432');
  });

  it('keeps the local development fallback for developer tooling', async () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = 'development';
    expect(getDatabaseUrl()).toContain('localhost:5432/postgres');
  });

  it('removes the Prisma schema option from PostgreSQL URLs', () => {
    expect(
      removePrismaConnectionOptions(
        'postgresql://postgres:postgres@localhost:5432/postgres?schema=public'
      )
    ).toBe('postgresql://postgres:postgres@localhost:5432/postgres');
  });

  it('preserves non-Prisma connection options', () => {
    expect(
      removePrismaConnectionOptions(
        'postgresql://postgres:postgres@localhost:5432/postgres?schema=raw&sslmode=disable'
      )
    ).toBe(
      'postgresql://postgres:postgres@localhost:5432/postgres?sslmode=disable'
    );
  });

  it('leaves non-URL connection strings unchanged', () => {
    expect(removePrismaConnectionOptions('host=localhost user=postgres')).toBe(
      'host=localhost user=postgres'
    );
  });
});
