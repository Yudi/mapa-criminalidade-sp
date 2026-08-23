import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

type RequestLike = {
  method?: string;
  path?: string;
  url?: string;
  ip?: string;
  socket?: { remoteAddress?: string };
};

@Injectable()
export class DevelopmentOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = this.getRequest(context);
    const operation = request
      ? `${request.method ?? 'REQUEST'} ${request.path ?? request.url ?? ''}`
      : context.getHandler().name;

    if (
      process.env['NODE_ENV'] !== 'development' ||
      !this.isLoopbackRequest(request)
    ) {
      throw new ForbiddenException(
        `${operation} is available only from local development`
      );
    }

    if (
      request?.method &&
      request.method !== 'GET' &&
      process.env['ENABLE_MANUAL_DATA_IMPORT'] !== 'true'
    ) {
      throw new ForbiddenException(
        `${operation} requires ENABLE_MANUAL_DATA_IMPORT=true`
      );
    }

    return true;
  }

  private isLoopbackRequest(request: RequestLike | undefined): boolean {
    if (!request) return false;

    const remoteAddress = request.socket?.remoteAddress ?? request.ip;
    if (!remoteAddress) return false;

    return (
      remoteAddress === '::1' ||
      remoteAddress === '0:0:0:0:0:0:0:1' ||
      remoteAddress === '127.0.0.1' ||
      remoteAddress.startsWith('::ffff:127.0.0.1')
    );
  }

  private getRequest(context: ExecutionContext): RequestLike | undefined {
    const type = context.getType<'http' | 'graphql' | 'rpc' | 'ws'>();

    if (type === 'http') {
      return context.switchToHttp().getRequest<RequestLike>();
    }

    if (type === 'graphql') {
      const gqlContext = GqlExecutionContext.create(context).getContext<{
        req?: RequestLike;
        request?: RequestLike;
      }>();

      return gqlContext.req ?? gqlContext.request;
    }

    return undefined;
  }
}
