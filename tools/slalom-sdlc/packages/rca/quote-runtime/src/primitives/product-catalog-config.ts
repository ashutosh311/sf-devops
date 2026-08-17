import type { EvidenceItem } from '../contracts/evidence';
import type { JsonValue } from '../contracts/result-envelope';
import type { RuntimeStatus } from '../contracts/status';
import {
  invokeSfJson,
  type InvokeSfJsonOptions,
  type SfCliJsonResult,
} from '../integrations/salesforce/sf-cli';
import {
  invokeSfRestWrite,
  type InvokeSfRestWriteOptions,
  type SfRestWriteResult
} from '../integrations/salesforce/rest';
import { buildSoqlSelect, escapeSoqlStringLiteral } from '../integrations/salesforce/soql';
import {
  emptyUsageRateSummary,
  loadUsageRateCatalogSummaries,
  type UsageRateDiscoverySummary
} from './usage-rate-catalog';

export const PRODUCT_DETAILS_ROUTE_PREFIX = '/services/data/v66.0/connect/cpq/products';

export type ProductAttributeSummary = {
  id: string | null;
  name: string;
  code: string | null;
  required: boolean;
  values: ProductAttributeValueSummary[];
};

export type ProductAttributeValueSummary = {
  id: string | null;
  name: string | null;
  display_value: string | null;
  text_value: string | null;
  code: string | null;
};

export type ProductComponentGroupSummary = {
  id: string | null;
  name: string;
  code: string | null;
  min_cardinality: number | null;
  max_cardinality: number | null;
  child_options: ProductChildOptionSummary[];
};

export type ProductChildOptionSummary = {
  product_id: string | null;
  product_name: string;
  product_code: string | null;
  related_component_id: string | null;
  required: boolean;
  default: boolean;
  min_quantity: number | null;
  max_quantity: number | null;
};

export type ProductConfigAttributeValue = {
  id: string | null;
  name: string;
  display_value: string | null;
  text_value: string | null;
  code: string | null;
};

export type ProductConfigAttribute = {
  id: string;
  name: string;
  label: string;
  code: string | null;
  required: boolean;
  values: ProductConfigAttributeValue[];
};

export type ProductConfigComponent = {
  id: string;
  name: string;
  product_code: string | null;
  related_component_id: string | null;
  required: boolean;
  default: boolean;
};

export type ProductConfigComponentGroup = {
  id: string;
  name: string;
  code: string | null;
  min_quantity: number | null;
  max_quantity: number | null;
  components: ProductConfigComponent[];
};

export type ProductCatalogConfigSummary = {
  product: {
    id: string;
    name: string;
    code: string | null;
    type: string | null;
    pricebook_id: string;
    pricebook_entry_id: string | null;
  };
  usage_rate_summary: UsageRateDiscoverySummary;
  attributes: ProductConfigAttribute[];
  component_groups: ProductConfigComponentGroup[];
  runtime_validation_available_pre_quote: false;
};

export type ProductCatalogConfigResult = {
  product_config: ProductCatalogConfigSummary;
  product_identity: {
    product_id: string;
    product_name: string | null;
    product_code: string | null;
    product_type: string | null;
    pricebook_id: string;
    pricebook_entry_id: string | null;
  };
  usage_rate_summary: UsageRateDiscoverySummary;
  config_summary: {
    required_attributes: ProductAttributeSummary[];
    optional_attributes: ProductAttributeSummary[];
    component_groups: ProductComponentGroupSummary[];
    runtime_validation_available_pre_quote: false;
  };
  pst_fields: {
    quote_line_item_attribute_parent_field: 'QuoteLineItemId';
    attribute_value_fields: string[];
  };
  filters: {
    attribute_name: string | null;
    component_group: string | null;
  };
  raw_product_details_response?: JsonValue;
};

export type ProductCatalogConfigPrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'partial' | 'unsupported' | 'error'>;
  result: ProductCatalogConfigResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
  queries: string[];
};

export type ProductCatalogConfigDependencies = {
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
  invokeSfRestWrite?: <T>(options: InvokeSfRestWriteOptions) => Promise<SfRestWriteResult<T>>;
};

export type ExecuteProductCatalogConfigInput = ProductCatalogConfigDependencies & {
  orgAlias: string;
  productId: string;
  pricebookId: string;
  catalogId?: string | null;
  accountId?: string | null;
  productSellingModelId?: string | null;
  attributeName?: string | null;
  componentGroup?: string | null;
  includeRaw?: boolean;
  timeoutMs?: number;
};

type SupplementQueryResponse = {
  records?: unknown[];
};

export async function executeProductCatalogConfig(input: ExecuteProductCatalogConfigInput): Promise<ProductCatalogConfigPrimitiveResult> {
  const route = buildProductDetailsRoute(input.productId);
  const response = await (input.invokeSfRestWrite ?? invokeSfRestWrite)<JsonValue>({
    orgAlias: input.orgAlias,
    path: route,
    method: 'POST',
    body: {
      priceBookId: input.pricebookId,
      catalogId: input.catalogId ?? undefined,
      accountId: input.accountId ?? undefined,
      productSellingModelId: input.productSellingModelId ?? undefined
    },
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.invokeSfJson === undefined ? {} : { invokeSfJson: input.invokeSfJson })
  });

  const baseResult = buildBaseResult(input);
  if (response.ok === false) {
    return {
      status: mapCatalogConfigFailureStatus(response.classification),
      result: baseResult,
      warnings: [],
      errors: [response.message],
      evidence: [],
      queries: []
    };
  }

  const normalized = normalizeProductDetails(response.data, input);
  const supplement = await loadComponentSupplement(input);
  const warnings = [...supplement.warnings];
  const result = applyFocusedFilters({
    ...normalized,
    product_identity: mergeProductIdentity(normalized.product_identity, supplement.pricebookEntryId),
    usage_rate_summary: supplement.usageRateSummary,
    config_summary: {
      ...normalized.config_summary,
      component_groups: mergeComponentSupplements(normalized.config_summary.component_groups, supplement.groups)
    },
    filters: {
      attribute_name: input.attributeName ?? null,
      component_group: input.componentGroup ?? null
    },
    ...(input.includeRaw ? { raw_product_details_response: response.data } : {})
  }, input);

  return {
    status: supplement.errors.length > 0 ? 'partial' : 'ok',
    result,
    warnings,
    errors: supplement.errors,
    evidence: [
      {
        claim: `Inspected Product Details API response for product ${input.productId}.`,
        evidence_level: 'org_proven',
        proof_source: [route],
        limitations: 'Product Details is normalized to compact config fields; raw nested catalog data is omitted unless --include-raw is set.',
        source_refs: []
      },
      {
        claim: 'Supplemented component group and pricebook-entry facts through bounded SOQL queries.',
        evidence_level: 'repo_proven',
        proof_source: supplement.queries,
        limitations: 'Supplementation only fills known compact fields when matching records are returned.',
        source_refs: []
      }
    ],
    queries: supplement.queries
  };
}

export function buildProductDetailsRoute(productId: string): string {
  return `${PRODUCT_DETAILS_ROUTE_PREFIX}/${encodeURIComponent(productId)}`;
}

export function buildProductComponentGroupSoql(productId: string): string {
  return buildSoqlSelect({
    objectName: 'ProductComponentGroup',
    fields: ['Id', 'Name', 'Code', 'ParentProductId', 'MinBundleComponents', 'MaxBundleComponents'],
    where: `ParentProductId = '${escapeSoqlStringLiteral(productId)}'`,
    orderBy: ['Name', 'Id'],
    limit: 50
  });
}

export function buildProductRelatedComponentSoql(productId: string): string {
  return buildSoqlSelect({
    objectName: 'ProductRelatedComponent',
    fields: [
      'Id',
      'ProductComponentGroupId',
      'ChildProductId',
      'ChildProduct.Name',
      'ChildProduct.ProductCode',
      'IsDefaultComponent',
      'IsComponentRequired',
      'MinQuantity',
      'MaxQuantity'
    ],
    where: `ProductComponentGroup.ParentProductId = '${escapeSoqlStringLiteral(productId)}'`,
    orderBy: ['ProductComponentGroupId', 'ChildProduct.Name', 'Id'],
    limit: 200
  });
}

function buildPricebookEntrySoql(productId: string, pricebookId: string): string {
  return buildSoqlSelect({
    objectName: 'PricebookEntry',
    fields: ['Id', 'Pricebook2Id', 'Product2Id'],
    where: `Product2Id = '${escapeSoqlStringLiteral(productId)}' AND Pricebook2Id = '${escapeSoqlStringLiteral(pricebookId)}' AND IsActive = true`,
    orderBy: 'Id',
    limit: 1
  });
}

async function loadComponentSupplement(input: ExecuteProductCatalogConfigInput): Promise<{
  pricebookEntryId: string | null;
  groups: Map<string, Partial<ProductComponentGroupSummary> & { childOptions: ProductChildOptionSummary[] }>;
  usageRateSummary: UsageRateDiscoverySummary;
  queries: string[];
  warnings: string[];
  errors: string[];
}> {
  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const queries = [
    buildPricebookEntrySoql(input.productId, input.pricebookId),
    buildProductComponentGroupSoql(input.productId),
    buildProductRelatedComponentSoql(input.productId)
  ];
  const warnings: string[] = [];
  const errors: string[] = [];

  const [pricebookEntry, groups, related] = await Promise.all(
    queries.map((query) =>
      executeSfJson<SupplementQueryResponse>({
        args: ['data', 'query', '--target-org', input.orgAlias, '--query', query, '--json'],
        orgAlias: input.orgAlias,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
      })
    )
  );
  const usageRate = await loadUsageRateCatalogSummaries({
    orgAlias: input.orgAlias,
    productIds: [input.productId],
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.invokeSfJson === undefined ? {} : { invokeSfJson: input.invokeSfJson })
  });

  const supplementQueries = [
    ...queries,
    ...usageRate.queries
  ];

  for (const queryResult of [pricebookEntry, groups, related]) {
    if (queryResult.ok === false) {
      errors.push(queryResult.message);
    }
  }
  warnings.push(...usageRate.warnings);

  const groupMap = new Map<string, Partial<ProductComponentGroupSummary> & { childOptions: ProductChildOptionSummary[] }>();
  if (groups.ok === true && Array.isArray(groups.data.records)) {
    for (const record of groups.data.records.filter(isRecord)) {
      const id = getString(record, ['Id']);
      if (!id) {
        continue;
      }
      groupMap.set(id, {
        id,
        name: getString(record, ['Name']) ?? id,
        code: getString(record, ['Code']),
        min_cardinality: getNumber(record, ['MinBundleComponents']),
        max_cardinality: getNumber(record, ['MaxBundleComponents']),
        childOptions: []
      });
    }
  } else {
    warnings.push('Component group SOQL supplement returned no usable group records.');
  }

  if (related.ok === true && Array.isArray(related.data.records)) {
    for (const record of related.data.records.filter(isRecord)) {
      const groupId = getString(record, ['ProductComponentGroupId']);
      if (!groupId) {
        continue;
      }
      const child = isRecord(record.ChildProduct) ? record.ChildProduct : {};
      const option: ProductChildOptionSummary = {
        product_id: getString(record, ['ChildProductId']),
        product_name: getString(child, ['Name']) ?? getString(record, ['ChildProductId']) ?? 'unknown child product',
        product_code: getString(child, ['ProductCode']),
        related_component_id: getString(record, ['Id']),
        required: getBoolean(record, ['IsComponentRequired']) ?? false,
        default: getBoolean(record, ['IsDefaultComponent']) ?? false,
        min_quantity: getNumber(record, ['MinQuantity']),
        max_quantity: getNumber(record, ['MaxQuantity'])
      };
      const group = groupMap.get(groupId) ?? { id: groupId, name: groupId, code: null, min_cardinality: null, max_cardinality: null, childOptions: [] };
      group.childOptions.push(option);
      groupMap.set(groupId, group);
    }
  } else {
    warnings.push('Related component SOQL supplement returned no usable child option records.');
  }

  const pricebookEntryId = pricebookEntry.ok === true && Array.isArray(pricebookEntry.data.records)
    ? getString(pricebookEntry.data.records.filter(isRecord)[0] ?? {}, ['Id'])
    : null;
  const usageRateSummary = usageRate.summariesByProductId.get(input.productId) ?? emptyUsageRateSummary();

  return { pricebookEntryId, groups: groupMap, usageRateSummary, queries: supplementQueries, warnings, errors };
}

function normalizeProductDetails(data: JsonValue, input: ExecuteProductCatalogConfigInput): ProductCatalogConfigResult {
  const root = isRecord(data) ? data : {};
  const product = getNestedRecord(root, ['product', 'product2']) ?? root;
  const allAttributes = collectRecordsFromKeys(root, ['attributes', 'productAttributes', 'configurationAttributes']).map(normalizeAttribute);
  const componentGroups = collectRecordsFromKeys(root, ['componentGroups', 'productComponentGroups', 'optionGroups']).map(normalizeComponentGroup);

  const result: Omit<ProductCatalogConfigResult, 'product_config'> = {
    product_identity: {
      product_id: input.productId,
      product_name: getString(product, ['name', 'Name', 'productName']) ?? null,
      product_code: getString(product, ['productCode', 'ProductCode', 'code']) ?? null,
      product_type: getString(product, ['type', 'Type', 'productType', 'Family']) ?? null,
      pricebook_id: input.pricebookId,
      pricebook_entry_id: getString(root, ['pricebookEntryId', 'PricebookEntryId']) ?? null
    },
    usage_rate_summary: emptyUsageRateSummary(),
    config_summary: {
      required_attributes: allAttributes.filter((attribute) => attribute.required),
      optional_attributes: allAttributes.filter((attribute) => !attribute.required),
      component_groups: componentGroups,
      runtime_validation_available_pre_quote: false
    },
    pst_fields: {
      quote_line_item_attribute_parent_field: 'QuoteLineItemId',
      attribute_value_fields: ['AttributeDefinitionId', 'AttributeName', 'AttributeValue', 'TextValue']
    },
    filters: {
      attribute_name: input.attributeName ?? null,
      component_group: input.componentGroup ?? null
    }
  };

  return {
    product_config: toProductCatalogConfigSummary(result),
    ...result
  };
}

function normalizeAttribute(record: Record<string, unknown>): ProductAttributeSummary {
  const values = collectRecordsFromKeys(record, ['values', 'picklistValues', 'allowedValues', 'attributePickList.values']).map((value) => ({
    id: getString(value, ['id', 'Id']),
    name: getString(value, ['name', 'Name']),
    display_value: getString(value, ['displayValue', 'label']),
    text_value: getString(value, ['textValue', 'value']),
    code: getString(value, ['code', 'Code'])
  }));

  return {
    id: getString(record, ['id', 'Id', 'attributeDefinitionId']),
    name: getString(record, ['name', 'Name', 'label', 'displayName']) ?? 'unknown attribute',
    code: getString(record, ['code', 'Code']),
    required: getBoolean(record, ['required', 'isRequired', 'Required']) ?? false,
    values
  };
}

function normalizeComponentGroup(record: Record<string, unknown>): ProductComponentGroupSummary {
  return {
    id: getString(record, ['id', 'Id', 'productComponentGroupId']),
    name: getString(record, ['name', 'Name', 'label']) ?? 'unknown component group',
    code: getString(record, ['code', 'Code']),
    min_cardinality: getNumber(record, ['minCardinality', 'minQuantity', 'MinQuantity']),
    max_cardinality: getNumber(record, ['maxCardinality', 'maxQuantity', 'MaxQuantity']),
    child_options: collectRecordsFromKeys(record, ['childProducts', 'childProductOptions', 'options', 'components']).map(normalizeChildOption)
  };
}

function normalizeChildOption(record: Record<string, unknown>): ProductChildOptionSummary {
  const product = getNestedRecord(record, ['product', 'childProduct']) ?? record;
  return {
    product_id: getString(product, ['id', 'Id', 'productId']) ?? getString(record, ['childProductId', 'ChildProductId']),
    product_name: getString(product, ['name', 'Name', 'productName']) ?? 'unknown child product',
    product_code: getString(product, ['productCode', 'ProductCode', 'code']),
    related_component_id: getString(record, ['id', 'Id', 'relatedComponentId']),
    required: getBoolean(record, ['required', 'isRequired', 'IsRequired']) ?? false,
    default: getBoolean(record, ['default', 'isDefault', 'IsDefault']) ?? false,
    min_quantity: getNumber(record, ['minQuantity', 'MinQuantity']),
    max_quantity: getNumber(record, ['maxQuantity', 'MaxQuantity'])
  };
}

function mergeProductIdentity(
  identity: ProductCatalogConfigResult['product_identity'],
  pricebookEntryId: string | null
): ProductCatalogConfigResult['product_identity'] {
  return {
    ...identity,
    pricebook_entry_id: identity.pricebook_entry_id ?? pricebookEntryId
  };
}

function toProductCatalogConfigSummary(result: Omit<ProductCatalogConfigResult, 'product_config'>): ProductCatalogConfigSummary {
  return {
    product: {
      id: result.product_identity.product_id,
      name: result.product_identity.product_name ?? result.product_identity.product_id,
      code: result.product_identity.product_code,
      type: result.product_identity.product_type,
      pricebook_id: result.product_identity.pricebook_id,
      pricebook_entry_id: result.product_identity.pricebook_entry_id
    },
    usage_rate_summary: result.usage_rate_summary,
    attributes: [
      ...result.config_summary.required_attributes,
      ...result.config_summary.optional_attributes
    ].flatMap((attribute) => attribute.id ? [{
      id: attribute.id,
      name: attribute.name,
      label: attribute.name,
      code: attribute.code,
      required: attribute.required,
      values: attribute.values.map((value) => ({
        id: value.id,
        name: value.name ?? value.display_value ?? value.text_value ?? value.id ?? '',
        display_value: value.display_value,
        text_value: value.text_value,
        code: value.code
      }))
    }] : []),
    component_groups: result.config_summary.component_groups.flatMap((group) => group.id ? [{
      id: group.id,
      name: group.name,
      code: group.code,
      min_quantity: group.min_cardinality,
      max_quantity: group.max_cardinality,
      components: group.child_options.flatMap((option) => option.product_id ? [{
        id: option.product_id,
        name: option.product_name,
        product_code: option.product_code,
        related_component_id: option.related_component_id,
        required: option.required,
        default: option.default
      }] : [])
    }] : []),
    runtime_validation_available_pre_quote: false
  };
}

function mergeComponentSupplements(
  detailsGroups: ProductComponentGroupSummary[],
  supplements: Map<string, Partial<ProductComponentGroupSummary> & { childOptions: ProductChildOptionSummary[] }>
): ProductComponentGroupSummary[] {
  const byId = new Map(detailsGroups.flatMap((group) => group.id ? [[group.id, group] as const] : []));
  for (const [id, supplement] of supplements) {
    const current = byId.get(id);
    byId.set(id, {
      id,
      name: current?.name ?? supplement.name ?? id,
      code: current?.code ?? supplement.code ?? null,
      min_cardinality: current?.min_cardinality ?? supplement.min_cardinality ?? null,
      max_cardinality: current?.max_cardinality ?? supplement.max_cardinality ?? null,
      child_options: mergeChildOptions(current?.child_options ?? [], supplement.childOptions)
    });
  }

  const supplementalOnly = [...byId.values()].filter((group) => !detailsGroups.some((detailsGroup) => detailsGroup.id === group.id));
  return [...detailsGroups.map((group) => group.id && byId.has(group.id) ? byId.get(group.id)! : group), ...supplementalOnly];
}

function mergeChildOptions(left: ProductChildOptionSummary[], right: ProductChildOptionSummary[]): ProductChildOptionSummary[] {
  const byKey = new Map<string, ProductChildOptionSummary>();
  for (const option of [...left, ...right]) {
    byKey.set(option.product_id ?? option.related_component_id ?? option.product_name, option);
  }
  return [...byKey.values()];
}

function applyFocusedFilters(result: ProductCatalogConfigResult, input: ExecuteProductCatalogConfigInput): ProductCatalogConfigResult {
  const attributeFilter = input.attributeName?.trim().toLowerCase();
  const groupFilter = input.componentGroup?.trim().toLowerCase();
  const filterAttributes = (attributes: ProductAttributeSummary[]) =>
    attributeFilter
      ? attributes.filter((attribute) => attribute.name.toLowerCase().includes(attributeFilter) || (attribute.code ?? '').toLowerCase().includes(attributeFilter))
      : attributes;

  const filtered = {
    ...result,
    config_summary: {
      ...result.config_summary,
      required_attributes: filterAttributes(result.config_summary.required_attributes),
      optional_attributes: filterAttributes(result.config_summary.optional_attributes),
      component_groups: groupFilter
        ? result.config_summary.component_groups.filter((group) => group.name.toLowerCase().includes(groupFilter) || (group.code ?? '').toLowerCase().includes(groupFilter))
        : result.config_summary.component_groups
    }
  };

  return {
    ...filtered,
    product_config: toProductCatalogConfigSummary(filtered)
  };
}

function buildBaseResult(input: ExecuteProductCatalogConfigInput): ProductCatalogConfigResult {
  return {
    product_config: {
      product: {
        id: input.productId,
        name: input.productId,
        code: null,
        type: null,
        pricebook_id: input.pricebookId,
        pricebook_entry_id: null
      },
      attributes: [],
      component_groups: [],
      usage_rate_summary: emptyUsageRateSummary(),
      runtime_validation_available_pre_quote: false
    },
    product_identity: {
      product_id: input.productId,
      product_name: null,
      product_code: null,
      product_type: null,
      pricebook_id: input.pricebookId,
      pricebook_entry_id: null
    },
    usage_rate_summary: emptyUsageRateSummary(),
    config_summary: {
      required_attributes: [],
      optional_attributes: [],
      component_groups: [],
      runtime_validation_available_pre_quote: false
    },
    pst_fields: {
      quote_line_item_attribute_parent_field: 'QuoteLineItemId',
      attribute_value_fields: ['AttributeDefinitionId', 'AttributeName', 'AttributeValue', 'TextValue']
    },
    filters: {
      attribute_name: input.attributeName ?? null,
      component_group: input.componentGroup ?? null
    }
  };
}

function mapCatalogConfigFailureStatus(classification: string): ProductCatalogConfigPrimitiveResult['status'] {
  switch (classification) {
    case 'auth':
    case 'unavailable':
    case 'internal_cli_error':
      return 'unsupported';
    default:
      return 'error';
  }
}

function collectRecordsFromKeys(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown>[] {
  for (const key of keys) {
    const value = getPathValue(record, key);
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }
  return [];
}

function getNestedRecord(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) {
      return value;
    }
  }
  return null;
}

function getString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

function getNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function getBoolean(record: Record<string, unknown>, keys: readonly string[]): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return null;
}

function getPathValue(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!isRecord(current)) {
      return undefined;
    }
    return current[key];
  }, record);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
