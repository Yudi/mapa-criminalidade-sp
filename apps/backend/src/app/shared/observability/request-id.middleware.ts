import { Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export type RequestWithId = Request & { requestId?: string };

export function getRequestId(request: Request): string | undefined {
  return (request as RequestWithId).requestId;
}

export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestIdMiddleware.name);

  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const incoming = request.header(REQUEST_ID_HEADER);
    const requestId =
      incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();

    request.requestId = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);
    const startedAt = performance.now();

    let logged = false;
    const logTerminal = (outcome: 'finished' | 'aborted') => {
      if (logged) return;
      logged = true;
      this.logger.log(
        JSON.stringify({
          event: 'http_request',
          outcome,
          requestId,
          method: request.method,
          path: request.path,
          statusCode: response.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
        })
      );
    };
    response.once('finish', () => logTerminal('finished'));
    response.once('close', () =>
      logTerminal(response.writableFinished ? 'finished' : 'aborted')
    );

    next();
  }
}
