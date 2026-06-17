import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';

type RequestResponse = {
  req: Record<string, unknown>;
  res: Record<string, unknown>;
};

@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  protected override getRequestResponse(
    context: ExecutionContext
  ): RequestResponse {
    if (context.getType<'http' | 'graphql'>() === 'graphql') {
      const graphqlContext =
        GqlExecutionContext.create(context).getContext<RequestResponse>();

      return {
        req: graphqlContext.req,
        res: graphqlContext.res,
      };
    }

    return super.getRequestResponse(context);
  }
}
