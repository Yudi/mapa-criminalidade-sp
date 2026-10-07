import { GRAPHQL_REQUEST_TIMEOUT_CODE } from '@mapa-criminalidade/shared-types';
import { HttpException } from '@nestjs/common';
import { GraphQLError, GraphQLErrorExtensions, GraphQLFormattedError } from 'graphql';
import { isAsyncIterable, mapAsyncIterator, Plugin } from 'graphql-yoga';
import { isRequestTimeoutError } from './error.utils';

export function formatGraphqlError(
  formattedError: GraphQLFormattedError,
  error: unknown
): GraphQLFormattedError {
  const originalError = error instanceof GraphQLError
    ? error.originalError ?? error
    : error;
  if (!isRequestTimeoutError(originalError)) {
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

const HTTP_ERROR_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  422: 'BAD_USER_INPUT',
};

function formatExecutionError(error: GraphQLError): GraphQLError {
  const originalError = error.originalError ?? error;
  const isExpectedHttpError =
    originalError instanceof HttpException &&
    HTTP_ERROR_CODES[originalError.getStatus()] !== undefined;
  const isUnexpectedResolverError =
    error.path !== undefined &&
    !isExpectedHttpError &&
    !isRequestTimeoutError(originalError) &&
    originalError !== error;
  let extensions: GraphQLErrorExtensions = {
    code: error.path ? 'INTERNAL_SERVER_ERROR' : 'BAD_USER_INPUT',
    ...error.extensions,
  };
  if (originalError instanceof HttpException) {
    const status = originalError.getStatus();
    extensions = {
      ...extensions,
      code: HTTP_ERROR_CODES[status] ?? 'INTERNAL_SERVER_ERROR',
      ...(HTTP_ERROR_CODES[status] ? {} : { status }),
      ...(isExpectedHttpError ? { originalError: originalError.getResponse() } : {}),
    };
  }
  if (isUnexpectedResolverError) {
    extensions = {
      code: extensions['code'] ?? 'INTERNAL_SERVER_ERROR',
      ...(extensions['status'] ? { status: extensions['status'] } : {}),
    };
  }
  if (
    extensions['code'] === 'GRAPHQL_PARSE_FAILED' ||
    extensions['code'] === 'GRAPHQL_VALIDATION_FAILED'
  ) {
    // Preserve HTTP 400 for invalid documents even with Accept: application/json.
    extensions.http = { ...extensions.http, status: 400, spec: false };
  }
  const formatted = formatGraphqlError({
    ...error.toJSON(),
    message: isUnexpectedResolverError ? 'Internal server error' : error.message,
    extensions,
  }, error);
  return new GraphQLError(formatted.message, {
    nodes: error.nodes,
    source: error.source,
    positions: error.positions,
    path: error.path,
    extensions: formatted.extensions,
  });
}

type ErrorResult = {
  errors?: readonly GraphQLError[];
  incremental?: readonly ErrorResult[];
};

function formatResult<T extends ErrorResult>(result: T): T {
  return {
    ...result,
    ...(result.errors && { errors: result.errors.map(formatExecutionError) }),
    ...(result.incremental && {
      incremental: result.incremental.map(formatResult),
    }),
  };
}

/** Keep Nest error codes and timeout notifications, including deferred failures. */
export function useGraphqlErrors(): Plugin {
  return {
    onParse() {
      return ({ result }) => {
        if (result instanceof GraphQLError) {
          result.extensions['code'] = 'GRAPHQL_PARSE_FAILED';
        }
      };
    },
    onValidate() {
      return ({ result }) => {
        for (const error of result) {
          error.extensions['code'] = 'GRAPHQL_VALIDATION_FAILED';
        }
      };
    },
    onExecutionResult({ result, setResult }) {
      if (!result) return;
      setResult(isAsyncIterable(result)
        ? mapAsyncIterator(result, formatResult)
        : formatResult(result));
    },
  };
}
