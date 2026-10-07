import { GRAPHQL_REQUEST_TIMEOUT_CODE } from '@mapa-criminalidade/shared-types';
import {
  BadRequestException,
  ForbiddenException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  Args,
  GraphQLModule,
  Int,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { GqlThrottlerGuard } from './guards/gql-throttler.guard';
import { createGraphqlOptions } from './graphql-options';

type GraphqlError = {
  message: string;
  extensions?: Record<string, unknown>;
};

type GraphqlPart = {
  data?: Record<string, unknown>;
  errors?: GraphqlError[];
  incremental?: {
    errors?: GraphqlError[];
    items?: unknown[];
    path?: unknown[];
  }[];
  hasNext?: boolean;
};

type FixtureServer = {
  app: INestApplication;
  url: string;
  resolver: YogaFixtureResolver;
};

const JSON_ACCEPT = 'application/json, text/plain, */*';
const MULTIPART_ACCEPT = 'multipart/mixed, application/json';

@Resolver()
class YogaFixtureResolver {
  private deferredPromise: Promise<string> = Promise.resolve('ready');

  setDeferredPromise(promise: Promise<string>): void {
    this.deferredPromise = promise;
  }

  @Query(() => String)
  ping(): string {
    return 'pong';
  }

  @Query(() => String)
  deferredValue(): Promise<string> {
    return this.deferredPromise;
  }

  @Query(() => String)
  deferredTimeout(): Promise<string> {
    return Promise.reject(
      new Error('canceling statement due to statement timeout: fixture-secret')
    );
  }

  @Query(() => String)
  timeout(): never {
    throw new Error(
      'canceling statement due to statement timeout: fixture-secret'
    );
  }

  @Query(() => String)
  unexpectedFailure(): never {
    throw new Error('private database connection: fixture-secret');
  }

  @Query(() => String)
  unexpectedDeferredFailure(): Promise<string> {
    return Promise.reject(new Error('private deferred connection: fixture-secret'));
  }

  @Query(() => [String])
  items(): string[] {
    return ['first-item', 'second-item', 'third-item'];
  }

  @Query(() => Int)
  echoInteger(@Args('value', { type: () => Int }) value: number): number {
    return value;
  }

  @Query(() => String)
  badRequest(): never {
    throw new BadRequestException('fixture bad request');
  }

  @Query(() => String)
  forbidden(): never {
    throw new ForbiddenException('fixture forbidden');
  }

  @Query(() => String)
  notFound(): never {
    throw new NotFoundException('fixture missing');
  }

  @Query(() => String)
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  throttled(): string {
    return 'allowed';
  }
}

async function startFixtureServer(isProduction: boolean): Promise<FixtureServer> {
  const testingModule = await Test.createTestingModule({
    imports: [
      GraphQLModule.forRoot(createGraphqlOptions(isProduction)),
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1_000 }]),
    ],
    providers: [
      YogaFixtureResolver,
      { provide: APP_GUARD, useClass: GqlThrottlerGuard },
    ],
  }).compile();

  const app = testingModule.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: ['http://localhost:4200'],
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address();
  if (typeof address !== 'object' || address === null) {
    await app.close();
    throw new Error('The GraphQL fixture server did not bind to a TCP port');
  }

  const { port } = address as AddressInfo;
  return {
    app,
    url: `http://127.0.0.1:${port}/api/graphql`,
    resolver: app.get(YogaFixtureResolver),
  };
}

async function postGraphql(
  server: FixtureServer,
  query: string,
  options: {
    accept?: string;
    variables?: Record<string, unknown>;
  } = {}
): Promise<Response> {
  const { accept = JSON_ACCEPT, variables } = options;
  return fetch(server.url, {
    method: 'POST',
    headers: {
      accept,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query,
      ...(variables && { variables }),
    }),
  });
}

async function readGraphqlResponse(response: Response): Promise<GraphqlPart> {
  return JSON.parse(await response.text()) as GraphqlPart;
}

function parseMultipartParts(
  contentType: string | null,
  body: string
): GraphqlPart[] {
  const boundary = contentType?.match(/boundary="?([^";]+)"?/)?.[1];
  if (!boundary) throw new Error('The response did not include a multipart boundary');

  return body
    .split(`--${boundary}`)
    .flatMap((part) => {
      const bodyStart = part.indexOf('\r\n\r\n');
      if (bodyStart < 0) return [];

      const json = part.slice(bodyStart + 4).trim();
      if (!json) return [];
      return [JSON.parse(json) as GraphqlPart];
    });
}

async function readFirstChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<ReadableStreamReadResult<Uint8Array> | null> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    reader.read().then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

async function readRemainingBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  initialText: string
): Promise<string> {
  let body = initialText;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return body;
    body += new TextDecoder().decode(value);
  }
}

describe('Nest GraphQL Yoga integration', () => {
  let development: FixtureServer | undefined;
  let production: FixtureServer | undefined;

  beforeAll(async () => {
    development = await startFixtureServer(false);
    production = await startFixtureServer(true);
  });

  afterAll(async () => {
    await Promise.all([development?.app.close(), production?.app.close()]);
  });

  it('serves code-first JSON queries at the prefixed route with Angular Accept headers', async () => {
    if (!development) throw new Error('Development fixture is not running');

    const response = await postGraphql(development, '{ ping }');
    const payload = await readGraphqlResponse(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(payload.data).toEqual({ ping: 'pong' });
  });

  it('keeps Nest resolver and throttle failures in GraphQL HTTP 200 responses', async () => {
    if (!development) throw new Error('Development fixture is not running');

    const cases = [
      ['{ badRequest }', 'BAD_REQUEST', undefined],
      ['{ forbidden }', 'FORBIDDEN', undefined],
      ['{ notFound }', 'INTERNAL_SERVER_ERROR', 404],
    ] as const;

    for (const [query, code, status] of cases) {
      const response = await postGraphql(development, query);
      const payload = await readGraphqlResponse(response);
      expect(response.status).toBe(200);
      expect(payload.errors?.[0]?.extensions).toMatchObject({
        code,
        ...(status && { status }),
      });
    }

    const allowed = await postGraphql(development, '{ throttled }');
    const throttled = await postGraphql(development, '{ throttled }');
    const allowedPayload = await readGraphqlResponse(allowed);
    const throttledPayload = await readGraphqlResponse(throttled);

    expect(allowed.status).toBe(200);
    expect(allowedPayload.data).toEqual({ throttled: 'allowed' });
    expect(allowed.headers.get('x-ratelimit-limit')).toBe('1');
    expect(allowed.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(throttled.status).toBe(200);
    expect(throttledPayload.errors?.[0]?.extensions).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      status: 429,
    });
    expect(throttled.headers.get('retry-after')).toBeTruthy();
  });

  it('maps timeout errors to a stable code without exposing database details', async () => {
    if (!development) throw new Error('Development fixture is not running');

    const response = await postGraphql(development, '{ timeout }');
    const body = await response.text();
    const payload = JSON.parse(body) as GraphqlPart;

    expect(response.status).toBe(200);
    expect(payload.errors?.[0]).toMatchObject({
      message: 'Request timed out',
      extensions: { code: GRAPHQL_REQUEST_TIMEOUT_CODE },
    });
    expect(body).not.toContain('canceling statement');
    expect(body).not.toContain('fixture-secret');
  });

  it('masks unexpected resolver details', async () => {
    if (!development) throw new Error('Development fixture is not running');
    const response = await postGraphql(development, '{ unexpectedFailure }');
    const body = await response.text();
    const payload = JSON.parse(body) as GraphqlPart;
    expect(payload.errors?.[0]?.message).toBe('Internal server error');
    expect(payload.errors?.[0]?.extensions?.['code']).toBe('INTERNAL_SERVER_ERROR');
    expect(body).not.toContain('fixture-secret');
    expect(body).not.toContain('private database connection');
  });

  it('sends a deferred initial chunk before the controlled value resolves', async () => {
    if (!development) throw new Error('Development fixture is not running');

    let release: ((value: string) => void) | undefined;
    const deferredPromise = new Promise<string>((resolve) => {
      release = resolve;
    });
    development.resolver.setDeferredPromise(deferredPromise);

    const response = await postGraphql(development, 'query { ping ... @defer { deferredValue } }', {
      accept: MULTIPART_ACCEPT,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('multipart/mixed');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('The deferred response has no readable body');

    try {
      let initial = '';
      const deadline = Date.now() + 2_000;
      while (!initial.includes('"hasNext":true')) {
        const firstChunk = await readFirstChunk(reader, deadline - Date.now());
        if (!firstChunk || firstChunk.done) {
          throw new Error('Yoga did not send the deferred initial payload in time');
        }
        initial += new TextDecoder().decode(firstChunk.value);
      }

      expect(initial).toContain('pong');
      expect(initial).not.toContain('controlled-late-value');
      release?.('controlled-late-value');
      const body = await readRemainingBody(reader, initial);
      const parts = parseMultipartParts(response.headers.get('content-type'), body);
      expect(body).toContain('controlled-late-value');
      expect(parts.at(-1)?.hasNext).toBe(false);
    } finally {
      release?.('controlled-late-value');
      await reader.cancel().catch(() => undefined);
    }
  });

  it('formats timeout errors inside deferred incremental patches', async () => {
    if (!development) throw new Error('Development fixture is not running');

    const response = await postGraphql(
      development,
      'query { ping ... @defer { deferredTimeout } }',
      { accept: MULTIPART_ACCEPT }
    );
    const body = await response.text();
    const parts = parseMultipartParts(response.headers.get('content-type'), body);
    const patchErrors = parts.flatMap((part) =>
      part.incremental?.flatMap((patch) => patch.errors ?? []) ?? []
    );

    expect(response.status).toBe(200);
    expect(patchErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Request timed out',
          extensions: { code: GRAPHQL_REQUEST_TIMEOUT_CODE },
        }),
      ])
    );
    expect(body).not.toContain('canceling statement');
    expect(body).not.toContain('fixture-secret');
  });

  it('masks unexpected errors inside deferred patches', async () => {
    if (!development) throw new Error('Development fixture is not running');
    const response = await postGraphql(
      development,
      'query { ping ... @defer { unexpectedDeferredFailure } }',
      { accept: MULTIPART_ACCEPT }
    );
    const body = await response.text();
    const parts = parseMultipartParts(response.headers.get('content-type'), body);
    const patchErrors = parts.flatMap((part) =>
      part.incremental?.flatMap((patch) => patch.errors ?? []) ?? []
    );
    expect(patchErrors[0]?.message).toBe('Internal server error');
    expect(body).not.toContain('fixture-secret');
    expect(body).not.toContain('private deferred connection');
  });

  it('streams list items as patches and signals completion', async () => {
    if (!development) throw new Error('Development fixture is not running');

    const response = await postGraphql(
      development,
      'query { items @stream(initialCount: 1) }',
      { accept: MULTIPART_ACCEPT }
    );
    const body = await response.text();
    const parts = parseMultipartParts(response.headers.get('content-type'), body);
    const patches = parts.flatMap((part) => part.incremental ?? []);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('multipart/mixed');
    expect(parts[0]?.data?.['items']).toEqual(['first-item']);
    expect(patches.flatMap((patch) => patch.items ?? [])).toEqual([
      'second-item',
      'third-item',
    ]);
    expect(patches.map((patch) => patch.path)).toEqual([
      ['items', 1],
      ['items', 2],
    ]);
    expect(parts.at(-1)?.hasNext).toBe(false);
  });

  it('rejects incremental requests when only JSON is acceptable', async () => {
    if (!development) throw new Error('Development fixture is not running');

    const response = await postGraphql(
      development,
      'query { ping ... @defer { deferredValue } }',
      { accept: 'application/json' }
    );

    expect(response.status).toBe(406);
    expect(response.statusText).toBe('Not Acceptable');
  });

  it('blocks simple GET requests while accepting JSON POST requests', async () => {
    if (!development) throw new Error('Development fixture is not running');

    const getResponse = await fetch(
      `${development.url}?query=${encodeURIComponent('{ ping }')}`,
      { headers: { origin: 'http://localhost:4200' } }
    );
    const postResponse = await postGraphql(development, '{ ping }');
    const postPayload = await readGraphqlResponse(postResponse);

    expect(getResponse.status).toBe(403);
    expect(postResponse.status).toBe(200);
    expect(postPayload.data).toEqual({ ping: 'pong' });
  });

  it('allows development introspection and rejects it in production', async () => {
    if (!development || !production) throw new Error('GraphQL fixtures are not running');

    const query = '{ __schema { queryType { name } } }';
    const developmentResponse = await postGraphql(development, query);
    const productionResponse = await postGraphql(production, query);
    const developmentPayload = await readGraphqlResponse(developmentResponse);
    const productionPayload = await readGraphqlResponse(productionResponse);

    expect(developmentResponse.status).toBe(200);
    expect(developmentPayload.data?.['__schema']).toBeDefined();
    expect(productionResponse.status).toBe(400);
    expect(productionPayload.errors?.[0]?.extensions).toMatchObject({
      code: 'GRAPHQL_VALIDATION_FAILED',
    });
  });

  it('rejects excessive aliases and reports parse and validation codes', async () => {
    if (!development) throw new Error('Development fixture is not running');

    const excessiveAliases = Array.from(
      { length: 101 },
      (_, index) => `alias${index}: ping`
    ).join('\n');
    const limitedResponse = await postGraphql(
      development,
      `query { ${excessiveAliases} }`
    );
    const limitedPayload = await readGraphqlResponse(limitedResponse);
    const parseResponse = await postGraphql(development, 'query {');
    const parsePayload = await readGraphqlResponse(parseResponse);
    const validationResponse = await postGraphql(development, '{ missingField }');
    const validationPayload = await readGraphqlResponse(validationResponse);

    expect(limitedResponse.status).toBe(400);
    expect(limitedPayload.errors?.[0]?.message).toContain('aliases exceed the limit');
    expect(limitedPayload.errors?.[0]?.extensions?.['code']).toBe(
      'GRAPHQL_VALIDATION_FAILED'
    );
    expect(parseResponse.status).toBe(400);
    expect(parsePayload.errors?.[0]?.extensions?.['code']).toBe('GRAPHQL_PARSE_FAILED');
    expect(validationResponse.status).toBe(400);
    expect(validationPayload.errors?.[0]?.extensions?.['code']).toBe(
      'GRAPHQL_VALIDATION_FAILED'
    );
  });

  it('reports missing and invalid variable values as BAD_USER_INPUT', async () => {
    if (!development) throw new Error('Development fixture is not running');

    const query = 'query ($value: Int!) { echoInteger(value: $value) }';
    const missing = await postGraphql(development, query);
    const invalid = await postGraphql(development, query, {
      variables: { value: 'not-an-integer' },
    });
    const missingPayload = await readGraphqlResponse(missing);
    const invalidPayload = await readGraphqlResponse(invalid);

    expect(missing.status).toBe(400);
    expect(missingPayload.errors?.[0]?.extensions?.['code']).toBe('BAD_USER_INPUT');
    expect(invalid.status).toBe(400);
    expect(invalidPayload.errors?.[0]?.extensions?.['code']).toBe('BAD_USER_INPUT');
  });
});
