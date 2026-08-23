import {
  ASTNode,
  GraphQLError,
  ValidationContext,
  ValidationRule,
} from 'graphql';

export const GRAPHQL_QUERY_LIMITS = {
  maxDepth: 12,
  maxAliases: 100,
  maxCost: 1_000,
} as const;

const FIELD_COSTS: Record<string, number> = {
  mapFeaturesMetadata: 8,
  mapFeaturesCharts: 12,
  mapFeaturesCategoryPeriodStats: 8,
  mapFeaturesCategories: 5,
  mapFeaturesPeriods: 5,
  mapFeaturesCategoriesForLocation: 8,
  mapFeaturesByBo: 6,
  groupedOccurrenceByBo: 8,
  mapFeatureFull: 12,
  mapFeatureById: 10,
  mapFeaturesCount: 6,
};

/**
 * Rejects pathological GraphQL documents before resolver execution. This is
 * intentionally dependency-free: the project does not ship a cost-analysis
 * package, and a small validation rule keeps the policy visible and testable.
 */
export function createGraphqlQueryLimitsRule(
  limits = GRAPHQL_QUERY_LIMITS
): ValidationRule {
  return (context: ValidationContext) => {
    let depth = 0;
    let aliases = 0;
    let cost = 0;
    let depthReported = false;
    let aliasesReported = false;
    let costReported = false;

    const reportOnce = (
      message: string,
      node: ASTNode,
      reported: 'depth' | 'aliases' | 'cost'
    ): void => {
      if (
        (reported === 'depth' && depthReported) ||
        (reported === 'aliases' && aliasesReported) ||
        (reported === 'cost' && costReported)
      ) {
        return;
      }

      if (reported === 'depth') depthReported = true;
      if (reported === 'aliases') aliasesReported = true;
      if (reported === 'cost') costReported = true;
      context.reportError(new GraphQLError(message, { nodes: [node] }));
    };

    return {
      OperationDefinition: {
        enter: () => {
          depth = 0;
          aliases = 0;
          cost = 0;
          depthReported = false;
          aliasesReported = false;
          costReported = false;
        },
      },
      Field: {
        enter: (node) => {
          if (node.name.value.startsWith('__')) return;

          depth++;
          if (depth > limits.maxDepth) {
            reportOnce(
              `GraphQL query depth exceeds the limit of ${limits.maxDepth}`,
              node,
              'depth'
            );
          }

          if (node.alias) {
            aliases++;
            if (aliases > limits.maxAliases) {
              reportOnce(
                `GraphQL query aliases exceed the limit of ${limits.maxAliases}`,
                node,
                'aliases'
              );
            }
          }

          cost += (FIELD_COSTS[node.name.value] ?? 1) * Math.max(depth, 1);
          if (cost > limits.maxCost) {
            reportOnce(
              `GraphQL query cost exceeds the limit of ${limits.maxCost}`,
              node,
              'cost'
            );
          }
        },
        leave: (node) => {
          if (!node.name.value.startsWith('__')) depth--;
        },
      },
    };
  };
}
