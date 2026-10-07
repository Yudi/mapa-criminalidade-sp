import {
  ASTNode,
  FragmentDefinitionNode,
  GraphQLError,
  SelectionSetNode,
  ValidationContext,
  ValidationRule,
} from 'graphql';

export const GRAPHQL_QUERY_LIMITS = {
  maxDepth: 12,
  maxAliases: 100,
  maxCost: 1_000,
} as const;

type GraphqlQueryLimits = {
  maxDepth: number;
  maxAliases: number;
  maxCost: number;
};

const FIELD_COSTS: Record<string, number> = {
  censusCrimeStats: 12,
  censusAreas: 5,
  censusArea: 5,
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
  limits: GraphqlQueryLimits = GRAPHQL_QUERY_LIMITS
): ValidationRule {
  return (context: ValidationContext) => {
    const fragments = new Map<string, FragmentDefinitionNode>(
      context
        .getDocument()
        .definitions.filter(
          (definition): definition is FragmentDefinitionNode =>
            definition.kind === 'FragmentDefinition'
        )
        .map((fragment) => [fragment.name.value, fragment])
    );

    return {
      OperationDefinition: {
        enter: (operation) => {
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

          const maxExpandedSelections =
            limits.maxCost + limits.maxAliases + limits.maxDepth;
          const activeFragments = new Set<string>();
          const selections: {
            selectionSet: SelectionSetNode;
            depth: number;
            index: number;
            fragmentName?: string;
          }[] = [{ selectionSet: operation.selectionSet, depth: 0, index: 0 }];
          let expandedSelections = 0;

          // Expand fragments at each spread site so their fields inherit the
          // operation's actual depth and repeated spreads count repeatedly.
          // The active path prevents cycles; GraphQL's standard validation
          // rule still reports them as invalid documents.
          while (selections.length > 0) {
            if (depthReported || costReported) break;

            const frame = selections[selections.length - 1];
            const selection = frame.selectionSet.selections[frame.index];

            if (!selection) {
              selections.pop();
              if (frame.fragmentName) {
                activeFragments.delete(frame.fragmentName);
              }
              continue;
            }
            frame.index++;

            // Introspection is intentionally excluded from all limits,
            // including the traversal safety bound below.
            if (
              selection.kind === 'Field' &&
              selection.name.value.startsWith('__')
            ) {
              continue;
            }

            expandedSelections++;
            if (expandedSelections > maxExpandedSelections) {
              reportOnce(
                `GraphQL query cost exceeds the limit of ${limits.maxCost}`,
                selection,
                'cost'
              );
              break;
            }

            if (selection.kind === 'Field') {
              const depth = frame.depth + 1;
              if (depth > limits.maxDepth) {
                reportOnce(
                  `GraphQL query depth exceeds the limit of ${limits.maxDepth}`,
                  selection,
                  'depth'
                );
              }

              if (selection.alias) {
                aliases++;
                if (aliases > limits.maxAliases) {
                  reportOnce(
                    `GraphQL query aliases exceed the limit of ${limits.maxAliases}`,
                    selection,
                    'aliases'
                  );
                }
              }

              cost += (FIELD_COSTS[selection.name.value] ?? 1) * depth;
              if (cost > limits.maxCost) {
                reportOnce(
                  `GraphQL query cost exceeds the limit of ${limits.maxCost}`,
                  selection,
                  'cost'
                );
              }

              if (!depthReported && !costReported && selection.selectionSet) {
                selections.push({
                  selectionSet: selection.selectionSet,
                  depth,
                  index: 0,
                });
              }
              continue;
            }

            if (selection.kind === 'InlineFragment') {
              selections.push({
                selectionSet: selection.selectionSet,
                depth: frame.depth,
                index: 0,
              });
              continue;
            }

            const fragmentName = selection.name.value;
            const fragment = fragments.get(fragmentName);
            if (!fragment || activeFragments.has(fragmentName)) continue;

            activeFragments.add(fragmentName);
            selections.push({
              selectionSet: fragment.selectionSet,
              depth: frame.depth,
              index: 0,
              fragmentName,
            });
          }
        },
      },
    };
  };
}
