import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { RequestIdMiddleware } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  it('logs an aborted response exactly once even if finish follows close', () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const response = Object.assign(new EventEmitter(), {
      setHeader: jest.fn(),
      writableFinished: false,
      statusCode: 200,
    });
    const request = {
      header: () => undefined,
      method: 'GET',
      path: '/api/test',
    };
    new RequestIdMiddleware().use(
      request as never,
      response as never,
      jest.fn()
    );
    response.emit('close');
    response.emit('finish');
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      outcome: 'aborted',
      event: 'http_request',
    });
    log.mockRestore();
  });

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
