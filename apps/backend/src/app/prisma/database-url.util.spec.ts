import { removePrismaConnectionOptions } from './database-url.util';

describe('database-url.util', () => {
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
