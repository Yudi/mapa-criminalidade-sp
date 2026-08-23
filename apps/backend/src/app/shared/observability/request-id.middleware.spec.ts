import { RequestIdMiddleware } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  it('preserves a safe incoming request id and emits it on the response', () => {
    const middleware = new RequestIdMiddleware();
    const response = {
      setHeader: jest.fn(),
      once: jest.fn(),
    };
    const request = {
      method: 'GET',
      path: '/api/health/live',
      header: jest.fn().mockReturnValue('trace-123'),
    };
    const next = jest.fn();

    middleware.use(request as never, response as never, next);

    expect(response.setHeader).toHaveBeenCalledWith(
      'x-request-id',
      'trace-123'
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('replaces unsafe ids instead of forwarding log-injection input', () => {
    const middleware = new RequestIdMiddleware();
    const response = {
      setHeader: jest.fn(),
      once: jest.fn(),
    };
    const request = {
      method: 'GET',
      path: '/api/health/live',
      header: jest.fn().mockReturnValue('bad\nrequest-id'),
    };

    middleware.use(request as never, response as never, jest.fn());

    const generatedId = response.setHeader.mock.calls[0][1] as string;
    expect(generatedId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
