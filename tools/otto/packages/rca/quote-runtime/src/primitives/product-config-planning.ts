import { readFileSync } from 'node:fs';

import type { EvidenceItem } from '../contracts/evidence';
import type { JsonValue } from '../contracts/result-envelope';
import type { RuntimeStatus } from '../contracts/status';
import type {
  ProductCatalogConfigSummary,
  ProductConfigAttribute,
  ProductConfigAttributeValue,
  ProductConfigComponent,
  ProductConfigComponentGroup
} from './product-catalog-config';
import type { PstGraphRecord, QuoteLineAttributeInput } from './quote-mutations';
import { buildQuoteLineAttributeGraphRecord } from './quote-mutations';

export type ProductConfigChoices = {
  attributes?: Record<string, string>;
  componentSelections?: Record<string, string[]>;
  sources?: Record<string, string>;
};

export type SelectedConfigAttribute = {
  name: string;
  attribute_definition_id: string;
  value: string;
  display_value: string | null;
  picklist_value_id: string | null;
  source: string | null;
};

export type SelectedConfigComponentGroup = {
  name: string;
  selected_components: ProductConfigComponent[];
  candidate_product_ids: string[];
  min_quantity: number | null;
  max_quantity: number | null;
};

export type ProductConfigPlan = {
  blocked: boolean;
  product_id: string;
  selected_configuration: {
    attributes: SelectedConfigAttribute[];
    component_groups: SelectedConfigComponentGroup[];
  };
  pst_plan: {
    quote_line_attributes: PstGraphRecord[];
  };
  post_create_repair_plan: {
    component_groups: SelectedConfigComponentGroup[];
    actions: JsonValue[];
  };
  unresolved_questions: string[];
};

export type ProductConfigPlanningPrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'error'>;
  result: ProductConfigPlan;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
};

export type ExecutePlanProductConfigInput = {
  productConfigPath: string;
  choicesPath: string;
  parentLineReference?: string | null;
};

export function executePlanProductConfig(input: ExecutePlanProductConfigInput): ProductConfigPlanningPrimitiveResult {
  const productConfig = normalizeProductConfigArtifact(JSON.parse(readFileSync(input.productConfigPath, 'utf8')));
  const choices = JSON.parse(readFileSync(input.choicesPath, 'utf8')) as ProductConfigChoices;
  return planProductConfig(productConfig, choices, input.parentLineReference ?? '@{line1.id}');
}

export function planProductConfig(
  productConfig: ProductCatalogConfigSummary,
  choices: ProductConfigChoices,
  parentLineReference: string
): ProductConfigPlanningPrimitiveResult {
  const errors: string[] = [];
  const unresolvedQuestions: string[] = [];
  const selectedAttributes: SelectedConfigAttribute[] = [];

  for (const attribute of productConfig.attributes.filter((entry) => entry.required)) {
    const rawChoice = findChoice(choices.attributes ?? {}, attribute);
    if (!rawChoice) {
      unresolvedQuestions.push(`Choose required attribute '${attribute.name}'.`);
      continue;
    }

    const value = findAttributeValue(attribute, rawChoice);
    if (!value) {
      errors.push(`Attribute '${attribute.name}' value '${rawChoice}' is not one of the allowed Salesforce values.`);
      continue;
    }

    selectedAttributes.push({
      name: attribute.name,
      attribute_definition_id: attribute.id,
      value: value.text_value ?? value.name,
      display_value: value.display_value,
      picklist_value_id: value.id,
      source: choices.sources?.[attribute.name] ?? choices.sources?.[attribute.code ?? ''] ?? null
    });
  }

  const selectedGroups = planComponentSelections(productConfig.component_groups, choices.componentSelections ?? {}, errors, unresolvedQuestions);
  const blocked = errors.length > 0 || unresolvedQuestions.length > 0;
  const quoteLineAttributes = selectedAttributes.map((attribute, index) => buildQuoteLineAttributeGraphRecord(toAttributeInput(attribute, parentLineReference), index));
  const plan: ProductConfigPlan = {
    blocked,
    product_id: productConfig.product.id,
    selected_configuration: {
      attributes: selectedAttributes,
      component_groups: selectedGroups
    },
    pst_plan: {
      quote_line_attributes: blocked ? [] : quoteLineAttributes
    },
    post_create_repair_plan: {
      component_groups: selectedGroups,
      actions: selectedGroups.flatMap((group) => buildRepairAction(group))
    },
    unresolved_questions: unresolvedQuestions
  };

  return {
    status: blocked ? 'error' : 'ok',
    result: plan,
    warnings: selectedGroups.length === 0 ? ['No explicit component selections were provided. PST default child hydration must be validated after creation.'] : [],
    errors,
    evidence: [
      {
        claim: `Planned deterministic configuration choices for product ${productConfig.product.id}.`,
        evidence_level: 'repo_proven',
        proof_source: ['plan-product-config', inputSummary(productConfig)],
        limitations: 'Semantic transcript mapping is expected to happen outside this deterministic planner.',
        source_refs: []
      }
    ]
  };
}

function planComponentSelections(
  groups: ProductConfigComponentGroup[],
  selections: Record<string, string[]>,
  errors: string[],
  unresolvedQuestions: string[]
): SelectedConfigComponentGroup[] {
  const selectedGroups = Object.entries(selections).flatMap(([groupName, selectedNames]) => {
    const group = groups.find((candidate) => sameToken(candidate.name, groupName) || candidate.id === groupName);
    if (!group) {
      errors.push(`Component group '${groupName}' is not present in the inspected product config.`);
      return [];
    }
    const selectedComponents = selectedNames.flatMap((componentName) => {
      const component = group.components.find((candidate) =>
        sameToken(candidate.name, componentName) ||
        candidate.id === componentName ||
        sameToken(candidate.product_code ?? '', componentName)
      );
      if (!component) {
        errors.push(`Component '${componentName}' is not an allowed option in group '${group.name}'.`);
        return [];
      }
      return [component];
    });
    if (group.min_quantity !== null && selectedComponents.length < group.min_quantity) {
      unresolvedQuestions.push(`Component group '${group.name}' requires at least ${group.min_quantity} selection(s).`);
    }
    if (group.max_quantity !== null && selectedComponents.length > group.max_quantity) {
      errors.push(`Component group '${group.name}' allows at most ${group.max_quantity} selection(s).`);
    }
    return [{
      name: group.name,
      selected_components: selectedComponents,
      candidate_product_ids: group.components.map((component) => component.id),
      min_quantity: group.min_quantity,
      max_quantity: group.max_quantity
    }];
  });

  const selectedNames = new Set(selectedGroups.map((group) => normalizeToken(group.name)));
  for (const group of groups) {
    if ((group.min_quantity ?? 0) > 0 && !selectedNames.has(normalizeToken(group.name))) {
      unresolvedQuestions.push(`Component group '${group.name}' requires at least ${group.min_quantity} selection(s).`);
    }
  }

  return selectedGroups;
}

function findChoice(choices: Record<string, string>, attribute: ProductConfigAttribute): string | null {
  for (const key of [attribute.name, attribute.label, attribute.code ?? '', attribute.id]) {
    if (key && choices[key]) {
      return choices[key];
    }
  }
  return null;
}

function findAttributeValue(attribute: ProductConfigAttribute, rawChoice: string): ProductConfigAttributeValue | null {
  return attribute.values.find((value) =>
    value.id === rawChoice ||
    sameToken(value.name, rawChoice) ||
    sameToken(value.text_value ?? '', rawChoice) ||
    sameToken(value.display_value ?? '', rawChoice) ||
    sameToken(value.code ?? '', rawChoice)
  ) ?? null;
}

function toAttributeInput(attribute: SelectedConfigAttribute, parentLineReference: string): QuoteLineAttributeInput {
  return {
    quoteLineItemReference: parentLineReference,
    attributeDefinitionId: attribute.attribute_definition_id,
    attributePicklistValueId: attribute.picklist_value_id,
    attributeValue: attribute.value
  };
}

function buildRepairAction(group: SelectedConfigComponentGroup): JsonValue[] {
  if (group.selected_components.length === 0) {
    return [];
  }
  return [{
    action: 'enforce_component_selection',
    component_group: group.name,
    keep_product_ids: group.selected_components.map((component) => component.id),
    candidate_product_ids: group.candidate_product_ids,
    min_quantity: group.min_quantity,
    max_quantity: group.max_quantity
  }];
}

function inputSummary(productConfig: ProductCatalogConfigSummary): string {
  return `${productConfig.product.name} (${productConfig.attributes.length} attributes, ${productConfig.component_groups.length} component groups)`;
}

function normalizeProductConfigArtifact(value: unknown): ProductCatalogConfigSummary {
  if (isRecord(value) && isProductConfigSummary(value)) {
    return value;
  }
  if (isRecord(value) && isRecord(value.product_config) && isProductConfigSummary(value.product_config)) {
    return value.product_config;
  }
  if (isRecord(value) && isRecord(value.result) && isRecord(value.result.product_config) && isProductConfigSummary(value.result.product_config)) {
    return value.result.product_config;
  }
  throw new Error('product-config must be a product_config object or a quote-runtime inspect-product-catalog-config envelope.');
}

function isProductConfigSummary(value: Record<string, unknown>): value is ProductCatalogConfigSummary {
  return isRecord(value.product) && Array.isArray(value.attributes) && Array.isArray(value.component_groups);
}

function sameToken(left: string, right: string): boolean {
  return normalizeToken(left) === normalizeToken(right);
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
