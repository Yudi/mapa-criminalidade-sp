import { buildSchema, parse, validate } from 'graphql';
import {
  createGraphqlQueryLimitsRule,
  GRAPHQL_QUERY_LIMITS,
} from './graphql-query-limits';

describe('GraphQL query limits', () => {
  const schema = buildSchema(`
    type Query { mapFeaturesMetadata: Metadata }
    type Metadata { categories: [String] nested: Metadata }
  `);

  it('rejects aliases before resolver execution can occur', () => {
    const aliases = Array.from(
      { length: GRAPHQL_QUERY_LIMITS.maxAliases + 1 },
      (_, index) => `a${index}: mapFeaturesMetadata { categories }`
    ).join('\n');

    const errors = validate(
      schema,
      parse(`query { ${aliases} }`),
      [createGraphqlQueryLimitsRule()]
    );

    expect(errors.map((error) => error.message)).toContain(
      `GraphQL query aliases exceed the limit of ${GRAPHQL_QUERY_LIMITS.maxAliases}`
    );
  });

  it('rejects deeply nested selections', () => {
    const nested = 'nested { '.repeat(GRAPHQL_QUERY_LIMITS.maxDepth + 1);
    const closing = ' }'.repeat(GRAPHQL_QUERY_LIMITS.maxDepth + 1);
    const errors = validate(
      schema,
      parse(`query { mapFeaturesMetadata { ${nested}categories${closing} } }`),
      [createGraphqlQueryLimitsRule()]
    );

    expect(errors.map((error) => error.message)).toContain(
      `GraphQL query depth exceeds the limit of ${GRAPHQL_QUERY_LIMITS.maxDepth}`
    );
  });

  it('rejects a repeated expensive field selection when its weighted cost is exceeded', () => {
    const fields = Array.from(
      { length: GRAPHQL_QUERY_LIMITS.maxAliases + 1 },
      () => 'mapFeaturesMetadata { categories }'
    ).join('\n');
    const errors = validate(
      schema,
      parse(`query { ${fields} }`),
      [createGraphqlQueryLimitsRule()]
    );

    expect(errors.map((error) => error.message)).toContain(
      `GraphQL query cost exceeds the limit of ${GRAPHQL_QUERY_LIMITS.maxCost}`
    );
  });
});
