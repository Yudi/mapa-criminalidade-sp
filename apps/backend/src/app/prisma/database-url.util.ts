const DEFAULT_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5432/postgres?schema=public';

export function getDatabaseUrl(): string {
  return process.env['DATABASE_URL'] ?? DEFAULT_DATABASE_URL;
}

export function getRustPostgresDatabaseUrl(): string {
  return removePrismaConnectionOptions(getDatabaseUrl());
}

export function removePrismaConnectionOptions(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    url.searchParams.delete('schema');
    return url.toString();
  } catch {
    return databaseUrl;
  }
}
