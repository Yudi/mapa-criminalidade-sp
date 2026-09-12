import { EventEmitter } from 'node:events';

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class PrismaPg {},
}));

jest.mock('../../generated/prisma/client', () => ({
  PrismaClient: class PrismaClient {},
}));

jest.mock('pg', () => {
  class FakeQuery<T = Record<string, unknown>> {
    readonly text: string;
    readonly values: readonly unknown[];
    readonly callback: (error: Error | null, result: { rows: T[] }) => void;

    constructor(
      config: { text: string; values: readonly unknown[] },
      callback: (error: Error | null, result: { rows: T[] }) => void
    ) {
      this.text = config.text;
      this.values = config.values;
      this.callback = callback;
    }
  }

  class FakeClient extends EventEmitter {
    static readonly instances: FakeClient[] = [];
    readonly cancel = jest.fn((_client: unknown, query: FakeQuery): void =>
      query.callback(new Error('cancelled'), { rows: [] })
    );
    readonly end = jest.fn().mockResolvedValue(undefined);

    constructor() {
      super();
      FakeClient.instances.push(this);
    }
  }

  class FakePool {
    connect(): Promise<unknown> {
      return Promise.reject(new Error('pool.connect was not configured'));
    }
  }

  return {
    Client: FakeClient,
    Pool: FakePool,
    PoolClient: class PoolClient {},
    Query: FakeQuery,
  };
});

import { Client, Query } from 'pg';

import { PrismaService } from './prisma.service';

type MockPoolClient = {
  query: jest.Mock;
  release: jest.Mock;
};

type MockPool = {
  connect: jest.Mock;
};

function createService(poolClient: MockPoolClient): {
  service: PrismaService;
  pool: MockPool;
} {
  const service = Object.create(PrismaService.prototype) as PrismaService;
  const pool: MockPool = {
    connect: jest.fn().mockResolvedValue(poolClient),
  };
  Object.defineProperty(service, 'tilePool', {
    configurable: true,
    value: pool,
  });
  return { service, pool };
}

function createPoolClient(): MockPoolClient {
  return {
    query: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
}

function fakeClientInstances(): Array<{
  cancel: jest.Mock;
  end: jest.Mock;
}> {
  return (
    Client as unknown as {
      instances: Array<{ cancel: jest.Mock; end: jest.Mock }>;
    }
  ).instances;
}

describe('PrismaService bounded read-only queries', () => {
  beforeEach(() => {
    fakeClientInstances().length = 0;
  });

  it('runs stats deadlines and read-only mode before the business query in one transaction', async () => {
    const events: string[] = [];
    const transaction = {
      $executeRawUnsafe: jest.fn(async (sql: string) => {
        events.push(sql);
        return 0;
      }),
      $queryRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
        events.push(sql);
        expect(params).toEqual(['category']);
        return [{ count: 3 }];
      }),
    };
    const service = Object.create(PrismaService.prototype) as PrismaService;
    const transactionRunner = jest
      .fn()
      .mockImplementation(
        async (callback: (tx: typeof transaction) => unknown) =>
          callback(transaction)
      );
    Object.defineProperty(service, '$transaction', {
      configurable: true,
      value: transactionRunner,
    });

    await expect(
      service.executeReadOnlyStatsQuery<{ count: number }[]>(
        'SELECT count(*) FROM map_features WHERE category = $1',
        'category'
      )
    ).resolves.toEqual([{ count: 3 }]);

    expect(events).toEqual([
      "SET LOCAL statement_timeout = '15000ms'",
      "SET LOCAL lock_timeout = '3000ms'",
      'SET TRANSACTION READ ONLY',
      'SELECT count(*) FROM map_features WHERE category = $1',
    ]);
    expect(transactionRunner).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 20_000,
    });
  });

  it('uses an independent cancellation client for an active pooled query', async () => {
    const poolClient = createPoolClient();
    let activeQuery:
      | {
          callback: (error: Error | null, result: { rows: unknown[] }) => void;
        }
      | undefined;
    poolClient.query.mockImplementation((command: unknown) => {
      if (command instanceof Query) {
        activeQuery = command as unknown as {
          callback: (error: Error | null, result: { rows: unknown[] }) => void;
        };
        return undefined;
      }
      return Promise.resolve(undefined);
    });
    const { service } = createService(poolClient);
    const controller = new AbortController();
    const pending = service.executeCancelableReadOnlyQuery(
      'SELECT * FROM occurrences($1, $2, $3, $4::json)',
      [1, 2, 3, '{}'],
      controller.signal
    );

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(activeQuery).toBeDefined();
    controller.abort();

    // node-postgres reports a canceled statement as the query error. The
    // service still releases the pooled client and closes the independent
    // cancellation connection in this path.
    await expect(pending).rejects.toThrow('cancelled');

    const [cancelClient] = fakeClientInstances();
    expect(cancelClient).toBeDefined();
    expect(cancelClient.cancel).toHaveBeenCalledWith(poolClient, activeQuery);
    expect(poolClient).not.toHaveProperty('cancel');
    expect(cancelClient.end).toHaveBeenCalled();
    expect(poolClient.release).toHaveBeenCalledWith(undefined);
  });

  it('does not run a business query when abort wins during pool acquisition', async () => {
    const poolClient = createPoolClient();
    let resolveConnect!: (client: MockPoolClient) => void;
    const connect = jest.fn(
      () =>
        new Promise<MockPoolClient>((resolve) => {
          resolveConnect = resolve;
        })
    );
    const service = Object.create(PrismaService.prototype) as PrismaService;
    Object.defineProperty(service, 'tilePool', {
      configurable: true,
      value: { connect },
    });
    const controller = new AbortController();
    const pending = service.executeCancelableReadOnlyQuery(
      'SELECT * FROM occurrences($1, $2, $3, $4::json)',
      [1, 2, 3, '{}'],
      controller.signal
    );

    controller.abort();
    resolveConnect(poolClient);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(poolClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM occurrences')
    );
    expect(poolClient.query).not.toHaveBeenCalledWith(expect.any(Query));
    expect(poolClient.release).toHaveBeenCalledWith(undefined);
  });

  it('passes rollback failure to pool release while preserving the business error', async () => {
    const businessError = new Error('business query failed');
    const rollbackError = new Error('rollback failed');
    const poolClient = createPoolClient();
    poolClient.query.mockImplementation((command: unknown) => {
      if (command instanceof Query) {
        (
          command as unknown as {
            callback: (
              error: Error | null,
              result: { rows: unknown[] }
            ) => void;
          }
        ).callback(businessError, { rows: [] });
        return undefined;
      }
      if (command === 'ROLLBACK') {
        return Promise.reject(rollbackError);
      }
      return Promise.resolve(undefined);
    });
    const { service } = createService(poolClient);

    await expect(
      service.executeCancelableReadOnlyQuery(
        'SELECT * FROM occurrences($1, $2, $3, $4::json)',
        [1, 2, 3, '{}']
      )
    ).rejects.toBe(businessError);

    expect(poolClient.release).toHaveBeenCalledWith(rollbackError);
  });
});
