import { ExecutionContext } from '@nestjs/common';
import { DevelopmentOnlyGuard } from './development-only.guard';

function httpContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({ name: 'handler' }),
  } as unknown as ExecutionContext;
}

describe('DevelopmentOnlyGuard', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFlag = process.env.ENABLE_MANUAL_DATA_IMPORT;
  const guard = new DevelopmentOnlyGuard();

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalFlag === undefined)
      delete process.env.ENABLE_MANUAL_DATA_IMPORT;
    else process.env.ENABLE_MANUAL_DATA_IMPORT = originalFlag;
  });

  it('allows local read-only operational checks in development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ENABLE_MANUAL_DATA_IMPORT;

    expect(
      guard.canActivate(
        httpContext({ method: 'GET', path: '/api/data-import/status', socket: { remoteAddress: '::1' } })
      )
    ).toBe(true);
  });

  it('requires an explicit flag for local mutating operations', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ENABLE_MANUAL_DATA_IMPORT;
    const request = {
      method: 'POST',
      path: '/api/data-import/trigger',
      socket: { remoteAddress: '127.0.0.1' },
    };

    expect(() => guard.canActivate(httpContext(request))).toThrow(
      'ENABLE_MANUAL_DATA_IMPORT=true'
    );

    process.env.ENABLE_MANUAL_DATA_IMPORT = 'true';
    expect(guard.canActivate(httpContext(request))).toBe(true);
  });

  it.each(['production', 'test', undefined])(
    'rejects remotely reachable profile %s',
    (nodeEnv) => {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;

      expect(() =>
        guard.canActivate(
          httpContext({
            method: 'GET',
            path: '/api/data-import/status',
            socket: { remoteAddress: '10.0.0.5' },
          })
        )
      ).toThrow(/local development/);
    }
  );
});
