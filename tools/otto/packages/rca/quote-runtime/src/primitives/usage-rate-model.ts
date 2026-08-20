import type { EvidenceItem } from '../contracts/evidence';
import type { JsonValue } from '../contracts/result-envelope';
import type { RuntimeStatus } from '../contracts/status';
import { buildSoqlSelect, quoteSoqlId } from '../integrations/salesforce/soql';
import {
  invokeSfJson,
  type InvokeSfJsonOptions,
  type SfCliJsonResult
} from '../integrations/salesforce/sf-cli';

export const USAGE_RATE_OBJECTS = [
  'UsageResource',
  'ProductUsageResource',
  'ProductUsageGrant',
  'ProductUsageResourcePolicy',
  'UsagePrdGrantBindingPolicy',
  'RateCard',
  'RateCardEntry',
  'RateAdjustmentByTier',
  'RateAdjustmentByAttribute',
  'PriceBookRateCard',
  'QuoteLineRateCardEntry',
  'QuoteLineRateAdjustment',
  'QuotLineItmUseRsrcGrant',
  'QuotLineItmUsageRsrcPlcy',
  'ProductSellingModel',
  'UnitOfMeasureClass',
  'UnitOfMeasure'
] as const;

export type UsageRateObjectName = (typeof USAGE_RATE_OBJECTS)[number];

export type UsageRateObjectCoverage = {
  object_api_name: UsageRateObjectName;
  available: boolean;
  queryable: boolean;
  createable: boolean;
  updateable: boolean;
  key_prefix: string | null;
  field_count: number;
  key_fields_present: string[];
  key_fields_missing: string[];
  count_status: 'ok' | 'not_queryable' | 'error';
  active_or_relevant_count: number | null;
  sample_status: 'not_requested' | 'ok' | 'not_queryable' | 'error';
  samples: Array<Record<string, JsonValue>>;
  warnings: string[];
};

export type UsageRateModelResult = {
  documented: {
    object_families: string[];
    source_urls: string[];
  };
  org_proven: {
    object_coverage: UsageRateObjectCoverage[];
    counts: Record<string, number | null>;
    filters: Record<string, string | null>;
  };
  inferred: {
    model_notes: string[];
  };
  unknown: {
    blockers: string[];
  };
};

export type UsageRateModelPrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'warn' | 'unsupported' | 'error'>;
  result: UsageRateModelResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
};

export type UsageRateModelDependencies = {
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

export type ExecuteInspectUsageRateModelInput = UsageRateModelDependencies & {
  orgAlias: string;
  productId?: string | null;
  pricebookId?: string | null;
  includeSamples?: boolean;
  sampleLimit?: number;
  timeoutMs?: number;
};

type DescribeField = {
  name?: string;
};

type DescribeResult = {
  name?: string;
  queryable?: boolean;
  createable?: boolean;
  updateable?: boolean;
  keyPrefix?: string | null;
  fields?: DescribeField[];
};

type QueryResponse = {
  totalSize?: number;
  records?: Array<Record<string, unknown>>;
};

type ObjectProfile = {
  readonly keyFields: readonly string[];
  readonly sampleFields: readonly string[];
  readonly activeFilterFields: readonly string[];
  readonly productFilterFields: readonly string[];
  readonly pricebookFilterFields: readonly string[];
  readonly orderBy: readonly string[];
};

const DOCUMENTED_SOURCE_URLS = [
  'https://developer.salesforce.com/docs/platform/data-models/guide/rate-management.html',
  'https://developer.salesforce.com/docs/platform/data-models/guide/usage-management.html',
  'https://developer.salesforce.com/docs/platform/data-models/guide/transaction-management-quote.html'
] as const;

const OBJECT_PROFILES: Record<UsageRateObjectName, ObjectProfile> = {
  UsageResource: profile({
    keyFields: ['Id', 'Name', 'Code', 'Category', 'Status', 'DefaultUnitOfMeasureId', 'UnitOfMeasureClassId'],
    sampleFields: ['Id', 'Name', 'Code', 'Category', 'Status', 'DefaultUnitOfMeasureId', 'UnitOfMeasureClassId'],
    activeFilterFields: ['Status', 'Category'],
    productFilterFields: ['UsageDefinitionProductId'],
    orderBy: ['Name ASC']
  }),
  ProductUsageResource: profile({
    keyFields: ['Id', 'ProductId', 'UsageResourceId', 'Status', 'EffectiveStartDate', 'EffectiveEndDate'],
    sampleFields: ['Id', 'ProductId', 'UsageResourceId', 'Status', 'EffectiveStartDate', 'EffectiveEndDate', 'TokenResourceId', 'IsOptional'],
    activeFilterFields: ['Status'],
    productFilterFields: ['ProductId'],
    orderBy: ['CreatedDate DESC']
  }),
  ProductUsageGrant: profile({
    keyFields: ['Id', 'ProductUsageResourceId', 'UsageRsrcId', 'UsageResourceId', 'Status'],
    sampleFields: ['Id', 'ProductUsageResourceId', 'UsageRsrcId', 'UsageResourceId', 'Status', 'GrantQuantity', 'GrantQuantityUomId'],
    activeFilterFields: ['Status'],
    orderBy: ['CreatedDate DESC']
  }),
  ProductUsageResourcePolicy: profile({
    keyFields: ['Id', 'ProductUsageResourceId', 'UsageResourceId', 'Status'],
    sampleFields: ['Id', 'ProductUsageResourceId', 'UsageResourceId', 'Status', 'PolicyType'],
    activeFilterFields: ['Status'],
    orderBy: ['CreatedDate DESC']
  }),
  UsagePrdGrantBindingPolicy: profile({
    keyFields: ['Id', 'ProductUsageGrantId', 'UsageResourceId', 'Status'],
    sampleFields: ['Id', 'ProductUsageGrantId', 'UsageResourceId', 'Status'],
    activeFilterFields: ['Status'],
    orderBy: ['CreatedDate DESC']
  }),
  RateCard: profile({
    keyFields: ['Id', 'Name', 'Type', 'EffectiveFrom', 'EffectiveTo'],
    sampleFields: ['Id', 'Name', 'Type', 'Description', 'EffectiveFrom', 'EffectiveTo'],
    orderBy: ['Name ASC']
  }),
  RateCardEntry: profile({
    keyFields: ['Id', 'Name', 'RateCardId', 'ProductId', 'UsageResourceId', 'ProductSellingModelId', 'Rate', 'Status'],
    sampleFields: [
      'Id',
      'Name',
      'RateCardId',
      'ProductId',
      'UsageProductId',
      'UsageResourceId',
      'ProductSellingModelId',
      'Rate',
      'RateNegotiation',
      'Status',
      'EffectiveStartDate',
      'EffectiveEndDate'
    ],
    activeFilterFields: ['Status'],
    productFilterFields: ['ProductId'],
    orderBy: ['CreatedDate DESC']
  }),
  RateAdjustmentByTier: profile({
    keyFields: ['Id', 'RateCardEntryId', 'RateCardId', 'UsageResourceId', 'Status'],
    sampleFields: ['Id', 'RateCardEntryId', 'RateCardId', 'UsageResourceId', 'LowerBound', 'UpperBound', 'Rate', 'Status'],
    activeFilterFields: ['Status'],
    orderBy: ['CreatedDate DESC']
  }),
  RateAdjustmentByAttribute: profile({
    keyFields: ['Id', 'RateCardEntryId', 'RateCardId', 'UsageResourceId', 'Status'],
    sampleFields: ['Id', 'RateCardEntryId', 'RateCardId', 'UsageResourceId', 'AttributeDefinitionId', 'AdjustmentValue', 'Status'],
    activeFilterFields: ['Status'],
    orderBy: ['CreatedDate DESC']
  }),
  PriceBookRateCard: profile({
    keyFields: ['Id', 'Pricebook2Id', 'RateCardId', 'Status'],
    sampleFields: ['Id', 'Pricebook2Id', 'RateCardId', 'Status'],
    activeFilterFields: ['Status'],
    pricebookFilterFields: ['Pricebook2Id'],
    orderBy: ['CreatedDate DESC']
  }),
  QuoteLineRateCardEntry: profile({
    keyFields: ['Id', 'QuoteLineItemId', 'RateCardEntryId', 'RateCardId', 'UsageResourceId'],
    sampleFields: ['Id', 'QuoteLineItemId', 'RateCardEntryId', 'RateCardId', 'UsageResourceId', 'Rate'],
    orderBy: ['CreatedDate DESC']
  }),
  QuoteLineRateAdjustment: profile({
    keyFields: ['Id', 'QuoteLineItemId', 'RateCardEntryId', 'RateCardId', 'UsageResourceId'],
    sampleFields: ['Id', 'QuoteLineItemId', 'RateCardEntryId', 'RateCardId', 'UsageResourceId', 'AdjustmentValue'],
    orderBy: ['CreatedDate DESC']
  }),
  QuotLineItmUseRsrcGrant: profile({
    keyFields: ['Id', 'QuoteLineItemId', 'UsageResourceId', 'TokenResourceId'],
    sampleFields: ['Id', 'QuoteLineItemId', 'UsageResourceId', 'TokenResourceId', 'GrantQuantity'],
    orderBy: ['CreatedDate DESC']
  }),
  QuotLineItmUsageRsrcPlcy: profile({
    keyFields: ['Id', 'QuoteLineItemId', 'UsageResourceId'],
    sampleFields: ['Id', 'QuoteLineItemId', 'UsageResourceId', 'PolicyType'],
    orderBy: ['CreatedDate DESC']
  }),
  ProductSellingModel: profile({
    keyFields: ['Id', 'Name', 'SellingModelType', 'PricingTerm', 'PricingTermUnit', 'Status'],
    sampleFields: ['Id', 'Name', 'SellingModelType', 'PricingTerm', 'PricingTermUnit', 'Status'],
    activeFilterFields: ['Status'],
    orderBy: ['Name ASC']
  }),
  UnitOfMeasureClass: profile({
    keyFields: ['Id', 'Name', 'Code', 'Status'],
    sampleFields: ['Id', 'Name', 'Code', 'Status'],
    activeFilterFields: ['Status'],
    orderBy: ['Name ASC']
  }),
  UnitOfMeasure: profile({
    keyFields: ['Id', 'Name', 'Code', 'Status', 'UnitOfMeasureClassId'],
    sampleFields: ['Id', 'Name', 'Code', 'Status', 'UnitOfMeasureClassId'],
    activeFilterFields: ['Status'],
    orderBy: ['Name ASC']
  })
};

export async function executeInspectUsageRateModel(
  input: ExecuteInspectUsageRateModelInput
): Promise<UsageRateModelPrimitiveResult> {
  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const coverage: UsageRateObjectCoverage[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const objectName of USAGE_RATE_OBJECTS) {
    const objectCoverage = await inspectObject({
      executeSfJson,
      input,
      objectName
    });
    coverage.push(objectCoverage);
    warnings.push(...objectCoverage.warnings);
  }

  const unavailableObjects = coverage.filter((object) => !object.available).map((object) => object.object_api_name);
  const queryErrorObjects = coverage
    .filter((object) => object.available && (object.count_status === 'error' || object.sample_status === 'error'))
    .map((object) => object.object_api_name);

  if (queryErrorObjects.length > 0) {
    errors.push(`Read-only usage/rate inspection hit query errors for: ${queryErrorObjects.join(', ')}.`);
  }

  const status = coverage.every((object) => !object.available)
    ? 'unsupported'
    : errors.length > 0
      ? 'warn'
      : unavailableObjects.length > 0
        ? 'warn'
        : 'ok';

  return {
    status,
    result: {
      documented: {
        object_families: [
          'Rate Management: usage resources, rate cards, entries, tier and attribute adjustments, pricebook-rate-card links.',
          'Usage Management: product usage resources, grants, policies, units of measure, and usage resources.',
          'Transaction Management Quote: quote-line rate card entries, rate adjustments, usage grants, and usage policies.'
        ],
        source_urls: [...DOCUMENTED_SOURCE_URLS]
      },
      org_proven: {
        object_coverage: coverage,
        counts: Object.fromEntries(coverage.map((object) => [object.object_api_name, object.active_or_relevant_count])),
        filters: Object.fromEntries(coverage.map((object) => [object.object_api_name, buildWhereClauseForObject(object.object_api_name, new Set(object.key_fields_present), input)]))
      },
      inferred: {
        model_notes: buildModelNotes(coverage)
      },
      unknown: {
        blockers: buildUnknownBlockers(coverage, input)
      }
    },
    warnings: dedupeStrings(warnings),
    errors,
    evidence: buildEvidence(coverage)
  };
}

function profile(input: Partial<ObjectProfile> & Pick<ObjectProfile, 'keyFields' | 'sampleFields'>): ObjectProfile {
  return {
    keyFields: input.keyFields,
    sampleFields: input.sampleFields,
    activeFilterFields: input.activeFilterFields ?? [],
    productFilterFields: input.productFilterFields ?? [],
    pricebookFilterFields: input.pricebookFilterFields ?? [],
    orderBy: input.orderBy ?? []
  };
}

async function inspectObject(options: {
  executeSfJson: <T>(input: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
  input: ExecuteInspectUsageRateModelInput;
  objectName: UsageRateObjectName;
}): Promise<UsageRateObjectCoverage> {
  const { executeSfJson, input, objectName } = options;
  const describe = await executeSfJson<DescribeResult>({
    args: ['sobject', 'describe', '--target-org', input.orgAlias, '--sobject', objectName, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (!describe.ok) {
    return {
      object_api_name: objectName,
      available: false,
      queryable: false,
      createable: false,
      updateable: false,
      key_prefix: null,
      field_count: 0,
      key_fields_present: [],
      key_fields_missing: [...OBJECT_PROFILES[objectName].keyFields],
      count_status: 'error',
      active_or_relevant_count: null,
      sample_status: input.includeSamples ? 'error' : 'not_requested',
      samples: [],
      warnings: [`${objectName} describe failed: ${describe.message}`]
    };
  }

  const fieldNames = new Set((describe.data.fields ?? []).flatMap((field) => (field.name ? [field.name] : [])));
  const profileForObject = OBJECT_PROFILES[objectName];
  const keyFieldsPresent = profileForObject.keyFields.filter((fieldName) => fieldNames.has(fieldName));
  const keyFieldsMissing = profileForObject.keyFields.filter((fieldName) => !fieldNames.has(fieldName));
  const baseCoverage = {
    object_api_name: objectName,
    available: true,
    queryable: describe.data.queryable === true,
    createable: describe.data.createable === true,
    updateable: describe.data.updateable === true,
    key_prefix: describe.data.keyPrefix ?? null,
    field_count: fieldNames.size,
    key_fields_present: keyFieldsPresent,
    key_fields_missing: keyFieldsMissing,
    warnings: keyFieldsMissing.length > 0 ? [`${objectName} is missing expected field(s): ${keyFieldsMissing.join(', ')}.`] : []
  };

  if (describe.data.queryable !== true) {
    return {
      ...baseCoverage,
      count_status: 'not_queryable',
      active_or_relevant_count: null,
      sample_status: input.includeSamples ? 'not_queryable' : 'not_requested',
      samples: []
    };
  }

  const whereClause = buildWhereClauseForObject(objectName, fieldNames, input);
  const countQuery = buildSoqlSelect({
    objectName,
    fields: ['count()'],
    ...(whereClause ? { where: whereClause } : {})
  });
  const countResponse = await executeSfJson<QueryResponse>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', countQuery, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  const countStatus = countResponse.ok ? 'ok' : 'error';
  const countWarnings = countResponse.ok ? [] : [`${objectName} count query failed: ${countResponse.message}`];
  const activeOrRelevantCount = countResponse.ok ? readCount(countResponse.data) : null;

  if (input.includeSamples !== true) {
    return {
      ...baseCoverage,
      count_status: countStatus,
      active_or_relevant_count: activeOrRelevantCount,
      sample_status: 'not_requested',
      samples: [],
      warnings: [...baseCoverage.warnings, ...countWarnings]
    };
  }

  const sampleFields = profileForObject.sampleFields.filter((fieldName) => fieldNames.has(fieldName));
  const sampleQuery = buildSoqlSelect({
    objectName,
    fields: sampleFields.length > 0 ? sampleFields : ['Id'],
    ...(whereClause ? { where: whereClause } : {}),
    ...(profileForObject.orderBy.length > 0 ? { orderBy: profileForObject.orderBy.filter((fieldName) => fieldNames.has(fieldName.split(' ')[0] ?? fieldName)) } : {}),
    limit: normalizeSampleLimit(input.sampleLimit)
  });
  const sampleResponse = await executeSfJson<QueryResponse>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', sampleQuery, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  return {
    ...baseCoverage,
    count_status: countStatus,
    active_or_relevant_count: activeOrRelevantCount,
    sample_status: sampleResponse.ok ? 'ok' : 'error',
    samples: sampleResponse.ok ? sanitizeRecords(sampleResponse.data.records ?? []) : [],
    warnings: [
      ...baseCoverage.warnings,
      ...countWarnings,
      ...(sampleResponse.ok ? [] : [`${objectName} sample query failed: ${sampleResponse.message}`])
    ]
  };
}

function buildWhereClauseForObject(
  objectName: UsageRateObjectName,
  fieldNames: ReadonlySet<string>,
  input: Pick<ExecuteInspectUsageRateModelInput, 'productId' | 'pricebookId'>
): string | null {
  const profileForObject = OBJECT_PROFILES[objectName];
  const clauses: string[] = [];

  if (profileForObject.activeFilterFields.includes('Status') && fieldNames.has('Status')) {
    clauses.push("Status = 'Active'");
  }
  if (objectName === 'UsageResource' && fieldNames.has('Category')) {
    clauses.push("Category = 'Usage'");
  }
  if (input.productId) {
    const productField = profileForObject.productFilterFields.find((fieldName) => fieldNames.has(fieldName));
    if (productField) {
      clauses.push(`${productField} = ${quoteSoqlId(input.productId)}`);
    }
  }
  if (input.pricebookId) {
    const pricebookField = profileForObject.pricebookFilterFields.find((fieldName) => fieldNames.has(fieldName));
    if (pricebookField) {
      clauses.push(`${pricebookField} = ${quoteSoqlId(input.pricebookId)}`);
    }
  }

  return clauses.length > 0 ? clauses.join(' AND ') : null;
}

function readCount(response: QueryResponse): number | null {
  if (typeof response.totalSize === 'number' && response.records?.length === 0) {
    return response.totalSize;
  }
  const firstRecord = response.records?.[0];
  const expr0 = firstRecord?.expr0;
  return typeof expr0 === 'number' ? expr0 : response.totalSize ?? null;
}

function sanitizeRecords(records: Array<Record<string, unknown>>): Array<Record<string, JsonValue>> {
  return records.map((record) => {
    const sanitized: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === 'attributes') {
        continue;
      }
      sanitized[key] = toJsonValue(value);
    }
    return sanitized;
  });
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, toJsonValue(entry)]));
  }
  return String(value);
}

function normalizeSampleLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? 5, 1), 25);
}

function buildModelNotes(coverage: UsageRateObjectCoverage[]): string[] {
  const sellingModel = coverage.find((object) => object.object_api_name === 'ProductSellingModel');
  const rateCardEntry = coverage.find((object) => object.object_api_name === 'RateCardEntry');
  const productUsageResource = coverage.find((object) => object.object_api_name === 'ProductUsageResource');
  const notes: string[] = [];

  if ((rateCardEntry?.active_or_relevant_count ?? 0) > 0 && (productUsageResource?.active_or_relevant_count ?? 0) > 0) {
    notes.push('This org represents usage pricing through product usage resources and rate card entries attached to products and selling models.');
  }
  if (sellingModel?.samples.some((sample) => sample.SellingModelType === 'Usage') === false) {
    notes.push('No sampled ProductSellingModel row exposed SellingModelType = Usage; do not assume a dedicated usage selling-model type.');
  }

  return notes;
}

function buildUnknownBlockers(coverage: UsageRateObjectCoverage[], input: ExecuteInspectUsageRateModelInput): string[] {
  const blockers: string[] = [];
  const missing = coverage.filter((object) => !object.available).map((object) => object.object_api_name);
  if (missing.length > 0) {
    blockers.push(`Object availability is incomplete for: ${missing.join(', ')}.`);
  }
  if (input.includeSamples !== true) {
    blockers.push('Sample rows were not requested; object counts are proven but row-level relationships were not sampled.');
  }
  if (!input.productId) {
    blockers.push('No product id was supplied, so product-specific usage/rate attachment resolution was not narrowed.');
  }
  if (!input.pricebookId) {
    blockers.push('No pricebook id was supplied, so pricebook-rate-card visibility was not narrowed.');
  }
  return blockers;
}

function buildEvidence(coverage: UsageRateObjectCoverage[]): EvidenceItem[] {
  const availableObjects = coverage.filter((object) => object.available).map((object) => object.object_api_name);
  return [
    {
      claim: `Official Salesforce data model docs name the usage/rate object families inspected by this command.`,
      evidence_level: 'documented',
      proof_source: [...DOCUMENTED_SOURCE_URLS],
      limitations: 'Data model documentation proves object-family existence, not tenant-specific availability or configured records.',
      source_refs: []
    },
    {
      claim: `Org describe proved ${availableObjects.length} of ${USAGE_RATE_OBJECTS.length} usage/rate objects are available.`,
      evidence_level: 'org_proven',
      proof_source: coverage.map((object) => `sf sobject describe ${object.object_api_name}`),
      limitations: 'Describe proves object metadata availability; record counts and samples are separate query checks.',
      source_refs: []
    }
  ];
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
