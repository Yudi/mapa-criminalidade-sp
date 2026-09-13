import { Test } from '@nestjs/testing';
import { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } from '@nestjs/graphql';
import { parse, validate } from 'graphql';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapFeaturesResolver } from './map-features.resolver';
import { CensusResolver } from '../census/census.resolver';

it('accepts the frontend query selections in the current resolver schema', async () => {
  const module = await Test.createTestingModule({
    imports: [GraphQLSchemaBuilderModule],
  }).compile();
  try {
    const schema = await module.get(GraphQLSchemaFactory).create([
      MapFeaturesResolver,
      CensusResolver,
    ]);
    const frontend = resolve(__dirname, '../../../../frontend/src/app/shared');
    const source = readFileSync(resolve(frontend, 'map-features.graphql.ts'), 'utf8');
    const constants = new Map(
      [...source.matchAll(/(?:export )?const (\w+) = `([\s\S]*?)`;/g)]
        .map((match) => [match[1], match[2]])
    );
    const expand = (value: string): string => value.replace(
      /\$\{(\w+)\}/g,
      (_, name: string) => {
        const fragment = constants.get(name);
        if (!fragment) throw new Error(`Missing query fragment: ${name}`);
        return expand(fragment);
      }
    );
    const queries = [...constants]
      .filter(([name]) => name.endsWith('_QUERY'))
      .map(([, value]) => expand(value));
    const census = readFileSync(resolve(frontend, 'census.service.ts'), 'utf8');
    queries.push(...[...census.matchAll(/(?:`|')(query Census[\s\S]*?)(?:`|')/g)]
      .map((match) => match[1]));
    expect(queries).toHaveLength(11);
    const facets = source.split('const CHART_FACET_FIELDS = {')[1].split('} as const;')[0];
    const facetTemplate = source.split('return `query MapFeaturesCharts')[1].split('`;')[0];
    for (const match of facets.matchAll(/\w+: `([^`]+)`/g)) {
      queries.push('query MapFeaturesCharts' + facetTemplate.replace(
        '${CHART_FACET_FIELDS[facet]}', expand(match[1])
      ));
    }
    const service = readFileSync(resolve(frontend, 'occurrences.service.ts'), 'utf8');
    const temporalFields = new Map(
      [...service.split('const TEMPORAL_FIELDS = {')[1].split('} as const;')[0]
        .matchAll(/(\w+): '([^']+)'/g)].map((match) => [match[1], match[2]])
    );
    const temporalTemplate = service.split('query: `query TemporalStats')[1].split('`;')[0].split('`,')[0];
    for (const fields of [['monthly'], ['datasetRevision', 'total', 'categories']]) {
      queries.push('query TemporalStats' + temporalTemplate.replace(
        /\$\{[^}]+\}/, fields.map((field) => temporalFields.get(field)).join(' ')
      ));
    }
    expect(queries).toHaveLength(19);
    for (const query of queries) {
      expect(validate(schema, parse(query)).map((error) => error.message)).toEqual([]);
    }
  } finally {
    await module.close();
  }
});
