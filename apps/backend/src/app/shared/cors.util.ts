const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Parse an explicit CORS allowlist once at startup. Browsers send origins,
 * not arbitrary URLs, so paths, credentials, wildcards, and malformed values
 * are rejected instead of being silently accepted by the framework.
 */
export function parseAllowedOrigins(
  rawOrigins: string | undefined,
  fallbackOrigins: readonly string[]
): string[] {
  const values = rawOrigins === undefined ? fallbackOrigins : rawOrigins.split(',');
  const origins = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (origins.length === 0) {
    throw new Error('ALLOWED_ORIGINS must contain at least one origin');
  }

  const normalized = new Map<string, string>();
  for (const origin of origins) {
    if (origin === '*') {
      throw new Error('ALLOWED_ORIGINS cannot contain a wildcard origin');
    }

    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }

    if (
      !SUPPORTED_PROTOCOLS.has(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(`ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }

    const canonical = parsed.origin.toLowerCase();
    normalized.set(canonical, parsed.origin);
  }

  return [...normalized.values()];
}
