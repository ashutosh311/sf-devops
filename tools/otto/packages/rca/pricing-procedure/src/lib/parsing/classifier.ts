export interface ExpressionSetClassificationEvidence {
  root_family: 'ExpressionSetDefinition';
  interface_source_types: string[];
  process_types: string[];
  classification_basis: 'interfaceSourceType';
}

export interface ExpressionSetClassification {
  artifact_family: 'pricing_procedure' | 'expression_set_definition';
  is_pricing_procedure: boolean;
  candidate_adjacent_family: string | null;
  classification_evidence: ExpressionSetClassificationEvidence;
}

export function classifyExpressionSet(
  interfaceSourceTypes: readonly (string | null | undefined)[],
  processTypes: readonly (string | null | undefined)[],
): ExpressionSetClassification {
  const normalizedInterfaceSourceTypes = interfaceSourceTypes.filter(
    (value): value is string => Boolean(value),
  );
  const normalizedProcessTypes = processTypes.filter((value): value is string => Boolean(value));
  const isPricingProcedure = normalizedInterfaceSourceTypes.includes('PricingProcedure');
  const artifactFamily = isPricingProcedure ? 'pricing_procedure' : 'expression_set_definition';
  const candidateAdjacentFamily = !isPricingProcedure && normalizedInterfaceSourceTypes.length > 0
    ? normalizedInterfaceSourceTypes[0]
    : null;

  return {
    artifact_family: artifactFamily,
    is_pricing_procedure: isPricingProcedure,
    candidate_adjacent_family: candidateAdjacentFamily,
    classification_evidence: {
      root_family: 'ExpressionSetDefinition',
      interface_source_types: normalizedInterfaceSourceTypes,
      process_types: normalizedProcessTypes,
      classification_basis: 'interfaceSourceType',
    },
  };
}

export const classify_expression_set = classifyExpressionSet;
