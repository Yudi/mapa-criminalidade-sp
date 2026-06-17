import { isRequestTimeoutError } from './error.utils';

describe('isRequestTimeoutError', () => {
  it.each([
    new Error('canceling statement due to statement timeout'),
    { code: 'P2024', message: 'Timed out fetching a new connection' },
    { code: 'ETIMEDOUT' },
    {
      cause: new Error(
        'Transaction API error: Unable to start a transaction in the given time.'
      ),
    },
  ])('detects timeout errors', (error) => {
    expect(isRequestTimeoutError(error)).toBe(true);
  });

  it('does not classify unrelated errors as timeouts', () => {
    expect(isRequestTimeoutError(new Error('Database connection refused'))).toBe(
      false
    );
  });
});
