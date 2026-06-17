import { GRAPHQL_REQUEST_TIMEOUT_CODE } from '@mapa-criminalidade/shared-types';
import { GraphQLError } from 'graphql';
import { formatGraphqlError } from './graphql-error-formatter';

describe('formatGraphqlError', () => {
  it('exposes a stable timeout code without leaking database details', () => {
    const originalError = new Error(
      'canceling statement due to statement timeout'
    );
    const error = new GraphQLError('Internal server error', {
      path: ['mapFeaturesCharts'],
      originalError,
    });

    expect(formatGraphqlError(error.toJSON(), error)).toMatchObject({
      message: 'Request timed out',
      extensions: {
        code: GRAPHQL_REQUEST_TIMEOUT_CODE,
      },
    });
  });

  it('leaves unrelated GraphQL errors unchanged', () => {
    const formattedError = new GraphQLError('Invalid filter').toJSON();

    expect(
      formatGraphqlError(formattedError, new Error('Invalid filter'))
    ).toBe(formattedError);
  });
});
