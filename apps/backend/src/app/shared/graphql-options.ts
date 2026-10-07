import { YogaDriver, YogaDriverConfig } from '@graphql-yoga/nestjs';
import { useCSRFPrevention } from '@graphql-yoga/plugin-csrf-prevention';
import { useDeferStream } from '@graphql-yoga/plugin-defer-stream';
import { NoSchemaIntrospectionCustomRule } from 'graphql';
import { Plugin } from 'graphql-yoga';
import { createGraphqlQueryLimitsRule } from './graphql-query-limits';
import { useGraphqlErrors } from './graphql-error-formatter';

export function createGraphqlOptions(
  isProduction = process.env.NODE_ENV === 'production'
): YogaDriverConfig {
  return {
    driver: YogaDriver,
    path: '/api/graphql',
    autoSchemaFile: true,
    sortSchema: true,
    graphiql: !isProduction,
    landingPage: false,
    // Nest owns the origin allowlist and supplies Express req/res to guards.
    cors: false,
    batching: false,
    multipart: false,
    // Format both ordinary results and incremental patches below.
    maskedErrors: false,
    plugins: [
      useCSRFPrevention({
        requestHeaders: [
          'x-graphql-yoga-csrf',
          'apollo-require-preflight',
          'x-apollo-operation-name',
        ],
      }),
      useDeferStream(),
      {
        onValidate({ addValidationRule }) {
          addValidationRule(createGraphqlQueryLimitsRule());
          if (isProduction) addValidationRule(NoSchemaIntrospectionCustomRule);
        },
      } satisfies Plugin,
      useGraphqlErrors(),
    ],
  };
}
