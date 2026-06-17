export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return String(error);
}

const REQUEST_TIMEOUT_ERROR_CODES = new Set(['ETIMEDOUT', 'P1008', 'P2024']);
const REQUEST_TIMEOUT_MESSAGE_FRAGMENTS = [
  'statement timeout',
  'timed out fetching a new connection',
  'unable to start a transaction in the given time',
  'connection pool timeout',
  'database request timed out',
];

export function isRequestTimeoutError(error: unknown): boolean {
  let currentError: unknown = error;
  const visited = new Set<unknown>();

  while (currentError && !visited.has(currentError)) {
    visited.add(currentError);

    const code = getErrorStringProperty(currentError, 'code');
    if (code && REQUEST_TIMEOUT_ERROR_CODES.has(code)) {
      return true;
    }

    const message =
      currentError instanceof Error
        ? currentError.message
        : getErrorStringProperty(currentError, 'message');
    const normalizedMessage = message?.toLowerCase();
    if (
      normalizedMessage &&
      REQUEST_TIMEOUT_MESSAGE_FRAGMENTS.some((fragment) =>
        normalizedMessage.includes(fragment)
      )
    ) {
      return true;
    }

    currentError = getErrorProperty(currentError, 'cause');
  }

  return false;
}

export function getErrorNumberProperty(
  error: unknown,
  property: string
): number | undefined {
  if (!isErrorRecord(error)) {
    return undefined;
  }

  const value = error[property];
  return typeof value === 'number' ? value : undefined;
}

export function getErrorStringProperty(
  error: unknown,
  property: string
): string | undefined {
  if (!isErrorRecord(error)) {
    return undefined;
  }

  const value = error[property];
  return typeof value === 'string' ? value : undefined;
}

function isErrorRecord(error: unknown): error is Record<string, unknown> {
  return typeof error === 'object' && error !== null;
}

function getErrorProperty(error: unknown, property: string): unknown {
  return isErrorRecord(error) ? error[property] : undefined;
}
