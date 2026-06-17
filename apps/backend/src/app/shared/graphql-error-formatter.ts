import { unwrapResolverError } from '@apollo/server/errors';
import { GRAPHQL_REQUEST_TIMEOUT_CODE } from '@mapa-criminalidade/shared-types';
import type { GraphQLFormattedError } from 'graphql';
import { isRequestTimeoutError } from './error.utils';

export function formatGraphqlError(
  formattedError: GraphQLFormattedError,
  error: unknown
): GraphQLFormattedError {
  if (!isRequestTimeoutError(unwrapResolverError(error))) {
    return formattedError;
  }

  return {
    ...formattedError,
    message: 'Request timed out',
    extensions: {
      ...formattedError.extensions,
      code: GRAPHQL_REQUEST_TIMEOUT_CODE,
    },
  };
}
