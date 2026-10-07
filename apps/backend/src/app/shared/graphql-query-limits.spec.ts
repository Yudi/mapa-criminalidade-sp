import { buildSchema, parse, specifiedRules, validate } from 'graphql';
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

    const errors = validate(schema, parse(`query { ${aliases} }`), [
      createGraphqlQueryLimitsRule(),
    ]);

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
    const errors = validate(schema, parse(`query { ${fields} }`), [
      createGraphqlQueryLimitsRule(),
    ]);

    expect(errors.map((error) => error.message)).toContain(
      `GraphQL query cost exceeds the limit of ${GRAPHQL_QUERY_LIMITS.maxCost}`
    );
  });

  it('counts nested named fragments at their effective operation depth', () => {
    const errors = validate(
      schema,
      parse(`
        query { mapFeaturesMetadata { ...MetadataFields } }
        fragment MetadataFields on Metadata { ...NestedFields }
        fragment NestedFields on Metadata {
          nested { nested { categories } }
        }
      `),
      [createGraphqlQueryLimitsRule({ ...GRAPHQL_QUERY_LIMITS, maxDepth: 3 })]
    );

    expect(errors.map((error) => error.message)).toContain(
      'GraphQL query depth exceeds the limit of 3'
    );
  });

  it('counts a costly named fragment once per repeated spread', () => {
    const spreads = Array.from(
      { length: GRAPHQL_QUERY_LIMITS.maxCost + 1 },
      () => '...Costly'
    ).join('\n');
    const errors = validate(
      schema,
      parse(`
        query { ${spreads} }
        fragment Costly on Query { mapFeaturesMetadata { categories } }
      `),
      [createGraphqlQueryLimitsRule()]
    );

    expect(errors.map((error) => error.message)).toContain(
      `GraphQL query cost exceeds the limit of ${GRAPHQL_QUERY_LIMITS.maxCost}`
    );
  });

  it('counts aliases inside every repeated fragment spread', () => {
    const spreads = Array.from(
      { length: GRAPHQL_QUERY_LIMITS.maxAliases + 1 },
      () => '...AliasedCategory'
    ).join('\n');
    const errors = validate(
      schema,
      parse(`
        query { mapFeaturesMetadata { ${spreads} } }
        fragment AliasedCategory on Metadata { category: categories }
      `),
      [createGraphqlQueryLimitsRule()]
    );

    expect(errors.map((error) => error.message)).toContain(
      `GraphQL query aliases exceed the limit of ${GRAPHQL_QUERY_LIMITS.maxAliases}`
    );
  });

  it('does not recurse forever on fragment cycles and leaves cycle rejection to standard validation', () => {
    const document = parse(`
      query { ...First }
      fragment First on Query {
        mapFeaturesMetadata { categories }
        ...Second
      }
      fragment Second on Query { ...First }
    `);

    const errors = validate(schema, document, [
      ...specifiedRules,
      createGraphqlQueryLimitsRule(),
    ]);

    expect(errors.some((error) => error.message.includes('Cannot spread fragment'))).toBe(
      true
    );
  });

  it('resets alias budgets for each operation definition', () => {
    const aliases = (prefix: string) =>
      Array.from(
        { length: 60 },
        (_, index) => `${prefix}${index}: categories`
      ).join('\n');
    const errors = validate(
      schema,
      parse(`
        query First { mapFeaturesMetadata { ${aliases('first')} } }
        query Second { mapFeaturesMetadata { ${aliases('second')} } }
      `),
      [createGraphqlQueryLimitsRule()]
    );

    expect(errors.map((error) => error.message)).not.toContain(
      `GraphQL query aliases exceed the limit of ${GRAPHQL_QUERY_LIMITS.maxAliases}`
    );
  });

  it('applies depth limits inside deferred inline fragments', () => {
    const errors = validate(
      schema,
      parse(`
        query {
          mapFeaturesMetadata {
            ... @defer { nested { nested { categories } } }
          }
        }
      `),
      [createGraphqlQueryLimitsRule({ ...GRAPHQL_QUERY_LIMITS, maxDepth: 3 })]
    );

    expect(errors.map((error) => error.message)).toContain(
      'GraphQL query depth exceeds the limit of 3'
    );
  });

  it('bounds exponential fragment expansion when all expanded fields are introspection', () => {
    const fragments = Array.from({ length: 16 }, (_, index) => {
      if (index === 0) return 'fragment F0 on Query { __typename }';
      return `fragment F${index} on Query { ...F${index - 1} ...F${index - 1} }`;
    }).join('\n');
    const errors = validate(
      schema,
      parse(`query { ...F15 } ${fragments}`),
      [createGraphqlQueryLimitsRule()]
    );

    expect(errors.map((error) => error.message)).toContain(
      `GraphQL query cost exceeds the limit of ${GRAPHQL_QUERY_LIMITS.maxCost}`
    );
  });

  it('ignores introspection fields for depth, aliases, and cost', () => {
    const errors = validate(
      schema,
      parse(`query { schema: __schema { types { name } } }`),
      [createGraphqlQueryLimitsRule({ maxDepth: 0, maxAliases: 0, maxCost: 0 })]
    );

    expect(errors).toEqual([]);
  });
});
