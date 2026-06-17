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
};

@Injectable()
export class DevelopmentOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (process.env['NODE_ENV'] === 'development') {
      return true;
    }

    const request = this.getRequest(context);
    const operation = request
      ? `${request.method ?? 'REQUEST'} ${request.path ?? request.url ?? ''}`
      : context.getHandler().name;

    throw new ForbiddenException(
      `${operation} is available only outside production`
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
