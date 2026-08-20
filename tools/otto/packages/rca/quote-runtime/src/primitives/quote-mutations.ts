import type { EvidenceItem } from '../contracts/evidence';
import type { JsonValue } from '../contracts/result-envelope';
import type { RuntimeStatus } from '../contracts/status';
import {
  invokeSfJson,
  type InvokeSfJsonOptions,
  type SfCliJsonResult
} from '../integrations/salesforce/sf-cli';
import {
  invokeSfRestWrite,
  type InvokeSfRestWriteOptions,
  type SfRestWriteResult
} from '../integrations/salesforce/rest';

export const PST_PLACE_ROUTE = '/services/data/v66.0/connect/rev/sales-transaction/actions/place';
export const CREATED_QUOTE_REFERENCE = '@{quote1.id}';

export type MutationMode = 'dry_run' | 'execute';
export type PstGraphMethod = 'POST' | 'PATCH' | 'DELETE';
export type MutationObjectName =
  | 'Quote'
  | 'QuoteLineItem'
  | 'QuoteLineItemAttribute'
  | 'QuoteLineRelationship'
  | 'QuoteLineRateCardEntry'
  | 'QuotLineItmUseRsrcGrant';
export type CatalogRatesPref = 'Fetch' | 'Skip';

export type MutationFieldValue = string | number | boolean | null;
export type MutationFields = Record<string, MutationFieldValue>;

export type PstGraphRecord = {
  referenceId: string;
  record: {
    attributes: {
      type: MutationObjectName;
      method: PstGraphMethod;
      id?: string;
    };
  } & Record<string, unknown>;
};

export type PstGraphPayload = {
  catalogRatesPref?: CatalogRatesPref;
  graph: {
    records: PstGraphRecord[];
  };
};

export type DescribeField = {
  name: string;
  createable: boolean;
  updateable: boolean;
  nillable: boolean;
  defaultedOnCreate: boolean;
  type?: string;
  referenceTo?: string[];
};

export type DescribeResponse = {
  fields?: DescribeField[];
};

export type MutationPlan = {
  mode: MutationMode;
  route: string;
  catalog_rates_pref: CatalogRatesPref | null;
  graph: PstGraphPayload;
  validation: MutationValidationResult[];
  expected_verification_commands: string[];
};

export type MutationExecution = {
  executed: boolean;
  response: JsonValue;
};

export type QuoteMutationResult = {
  plan: MutationPlan;
  execution: MutationExecution;
};

export type QuoteMutationPrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'changed' | 'unsupported' | 'error'>;
  result: QuoteMutationResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
};

export type MutationValidationResult = {
  object: MutationObjectName;
  method: PstGraphMethod;
  reference_id: string;
  valid: boolean;
  checked_fields: string[];
  errors: string[];
};

export type QuoteHeaderInput = {
  name: string;
  quoteAccountId?: string | null;
  opportunityId?: string | null;
  pricebook2Id?: string | null;
  status?: string | null;
  startDate?: string | null;
  expirationDate?: string | null;
  salesTransactionTypeId?: string | null;
  transactionType?: string | null;
  extraFields?: MutationFields;
};

export type QuoteLineInput = {
  lineId?: string | null;
  quoteId?: string | null;
  pricebookEntryId?: string | null;
  product2Id?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  discount?: number | null;
  discountAmount?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  startQuantity?: number | null;
  quoteActionId?: string | null;
  extraFields?: MutationFields;
};

export type QuoteLineAttributeInput = {
  quoteLineItemId?: string | null;
  quoteLineItemReference?: string | null;
  attributeDefinitionId?: string | null;
  attributePicklistValueId?: string | null;
  attributeName?: string | null;
  attributeValue?: string | null;
  isPriceImpacting?: boolean | null;
  extraFields?: MutationFields;
};

export type QuoteLineRateCardEntryInput = {
  quoteLineItemId?: string | null;
  quoteLineItemReference?: string | null;
  rateCardEntryId: string;
  negotiatedRate?: number | null;
  extraFields?: MutationFields;
};

export type QuoteLineUsageResourceGrantInput = {
  quoteLineUsageGrantId?: string | null;
  quoteLineItemId?: string | null;
  quoteLineItemReference?: string | null;
  usageResourceId: string;
  productUsageGrantId?: string | null;
  productUsageResourcePolicyId?: string | null;
  grantType?: string | null;
  grantQuantity?: number | null;
  validityPeriodTerm?: number | null;
  validityPeriodUnit?: string | null;
  extraFields?: MutationFields;
};

export type QuoteMutationDependencies = {
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
  invokeSfRestWrite?: <T>(options: InvokeSfRestWriteOptions) => Promise<SfRestWriteResult<T>>;
};

export type ExecuteCreateQuoteInput = QuoteMutationDependencies & {
  orgAlias: string;
  mode: MutationMode;
  quote: QuoteHeaderInput;
  timeoutMs?: number;
};

export type ExecuteUpsertQuoteLinesInput = QuoteMutationDependencies & {
  orgAlias: string;
  mode: MutationMode;
  quoteId?: string | null;
  lines: QuoteLineInput[];
  timeoutMs?: number;
};

export type ExecutePriceQuoteInput = QuoteMutationDependencies & {
  orgAlias: string;
  mode: MutationMode;
  quoteId: string;
  lines?: QuoteLineInput[];
  timeoutMs?: number;
};

export type ExecuteBuildTestQuoteInput = ExecuteCreateQuoteInput & {
  lines: QuoteLineInput[];
  price?: boolean;
};

export type ExecutePstGraphMutationInput = QuoteMutationDependencies & {
  orgAlias: string;
  mode: MutationMode;
  records: PstGraphRecord[];
  catalogRatesPref?: CatalogRatesPref | null;
  expectedVerificationCommands: string[];
  timeoutMs?: number;
};

export async function executeCreateQuote(input: ExecuteCreateQuoteInput): Promise<QuoteMutationPrimitiveResult> {
  const record = buildQuoteGraphRecord(input.quote);
  return executeMutationPlan({
    orgAlias: input.orgAlias,
    mode: input.mode,
    records: [record],
    expectedVerificationCommands: ['snapshot-quote'],
    dependencies: input,
    timeoutMs: input.timeoutMs
  });
}

export async function executeUpsertQuoteLines(input: ExecuteUpsertQuoteLinesInput): Promise<QuoteMutationPrimitiveResult> {
  const quoteAnchorId = input.quoteId ?? input.lines.find((line) => line.quoteId)?.quoteId ?? null;
  const records = input.lines.map((line, index) => buildQuoteLineGraphRecord(line, input.quoteId ?? null, index));
  return executeMutationPlan({
    orgAlias: input.orgAlias,
    mode: input.mode,
    records: quoteAnchorId ? [buildQuotePatchGraphRecord(quoteAnchorId), ...records] : records,
    expectedVerificationCommands: ['snapshot-lines'],
    dependencies: input,
    timeoutMs: input.timeoutMs
  });
}

export async function executePriceQuote(input: ExecutePriceQuoteInput): Promise<QuoteMutationPrimitiveResult> {
  const records = [
    buildQuotePatchGraphRecord(input.quoteId),
    ...(input.lines ?? []).map((line, index) => buildQuoteLineGraphRecord(line, input.quoteId, index))
  ];

  return executeMutationPlan({
    orgAlias: input.orgAlias,
    mode: input.mode,
    records,
    expectedVerificationCommands: ['snapshot-quote', 'snapshot-lines', 'capture-post-pst-evidence', 'classify-pricing-outcome'],
    dependencies: input,
    timeoutMs: input.timeoutMs
  });
}

export async function executeBuildTestQuote(input: ExecuteBuildTestQuoteInput): Promise<QuoteMutationPrimitiveResult> {
  const records = [
    buildQuoteGraphRecord(input.quote),
    ...input.lines.map((line, index) => buildQuoteLineGraphRecord(line, CREATED_QUOTE_REFERENCE, index))
  ];

  return executeMutationPlan({
    orgAlias: input.orgAlias,
    mode: input.mode,
    records,
    expectedVerificationCommands: ['snapshot-quote', 'snapshot-lines', 'capture-post-pst-evidence'],
    dependencies: input,
    timeoutMs: input.timeoutMs
  });
}

export async function executePstGraphMutation(input: ExecutePstGraphMutationInput): Promise<QuoteMutationPrimitiveResult> {
  return executeMutationPlan({
    orgAlias: input.orgAlias,
    mode: input.mode,
    records: input.records,
    catalogRatesPref: input.catalogRatesPref,
    expectedVerificationCommands: input.expectedVerificationCommands,
    dependencies: input,
    timeoutMs: input.timeoutMs
  });
}

export function buildQuoteGraphRecord(input: QuoteHeaderInput): PstGraphRecord {
  const fields = compactMutationFields({
    Name: input.name,
    QuoteAccountId: input.quoteAccountId,
    OpportunityId: input.opportunityId,
    Pricebook2Id: input.pricebook2Id,
    Status: input.status,
    StartDate: input.startDate,
    ExpirationDate: input.expirationDate,
    SalesTransactionTypeId: input.salesTransactionTypeId,
    TransactionType: input.transactionType,
    ...(input.extraFields ?? {})
  });

  return {
    referenceId: 'quote1',
    record: {
      attributes: {
        type: 'Quote',
        method: 'POST'
      },
      ...fields
    }
  };
}

export function buildQuotePatchGraphRecord(quoteId: string): PstGraphRecord {
  return {
    referenceId: 'quote1',
    record: {
      attributes: {
        type: 'Quote',
        method: 'PATCH',
        id: quoteId
      }
    }
  };
}

export function buildQuoteLineGraphRecord(input: QuoteLineInput, defaultQuoteId: string | null, index: number): PstGraphRecord {
  const method: PstGraphMethod = input.lineId ? 'PATCH' : 'POST';
  const fields = compactMutationFields({
    QuoteId: method === 'POST' ? (input.quoteId ?? defaultQuoteId) : null,
    PricebookEntryId: input.pricebookEntryId,
    Product2Id: input.product2Id,
    Quantity: input.quantity,
    UnitPrice: input.unitPrice,
    Discount: input.discount,
    DiscountAmount: input.discountAmount,
    StartDate: input.startDate,
    EndDate: input.endDate,
    StartQuantity: input.startQuantity,
    QuoteActionId: input.quoteActionId,
    ...(input.extraFields ?? {})
  });

  return {
    referenceId: `line${index + 1}`,
    record: {
      attributes: {
        type: 'QuoteLineItem',
        method,
        ...(method === 'PATCH' ? { id: input.lineId ?? '' } : {})
      },
      ...fields
    }
  };
}

export function buildQuoteLineDeleteGraphRecord(lineId: string, index: number): PstGraphRecord {
  return buildDeleteGraphRecord('QuoteLineItem', lineId, `deleteLine${index + 1}`);
}

export function buildQuoteLineRelationshipDeleteGraphRecord(relationshipId: string, index: number): PstGraphRecord {
  return buildDeleteGraphRecord('QuoteLineRelationship', relationshipId, `deleteRelationship${index + 1}`);
}

export function buildQuoteLineAttributeGraphRecord(input: QuoteLineAttributeInput, index: number): PstGraphRecord {
  const fields = compactMutationFields({
    QuoteLineItemId: input.quoteLineItemId ?? input.quoteLineItemReference,
    AttributeDefinitionId: input.attributeDefinitionId,
    AttributePicklistValueId: input.attributePicklistValueId,
    AttributeName: input.attributeName,
    AttributeValue: input.attributeValue,
    IsPriceImpacting: input.isPriceImpacting,
    ...(input.extraFields ?? {})
  });

  return {
    referenceId: `attribute${index + 1}`,
    record: {
      attributes: {
        type: 'QuoteLineItemAttribute',
        method: 'POST'
      },
      ...fields
    }
  };
}

export function buildQuoteLineRateCardEntryGraphRecord(input: QuoteLineRateCardEntryInput, index: number): PstGraphRecord {
  const fields = compactMutationFields({
    QuoteLineItemId: input.quoteLineItemId ?? input.quoteLineItemReference,
    RateCardEntryId: input.rateCardEntryId,
    ...(input.extraFields ?? {})
  });

  if (input.negotiatedRate !== undefined) {
    fields.NegotiatedRate = input.negotiatedRate;
  }

  return {
    referenceId: `rateCardEntry${index + 1}`,
    record: {
      attributes: {
        type: 'QuoteLineRateCardEntry',
        method: 'POST'
      },
      ...fields
    }
  };
}

export function buildQuoteLineUsageResourceGrantGraphRecord(input: QuoteLineUsageResourceGrantInput, index: number): PstGraphRecord {
  const method: PstGraphMethod = input.quoteLineUsageGrantId ? 'PATCH' : 'POST';
  const fields = compactMutationFields({
    QuoteLineItemId: method === 'POST' ? (input.quoteLineItemId ?? input.quoteLineItemReference) : null,
    UsageResourceId: input.usageResourceId,
    ProductUsageGrantId: input.productUsageGrantId,
    GrantType: input.grantType,
    GrantQuantity: input.grantQuantity,
    ValidityPeriodTerm: input.validityPeriodTerm,
    ValidityPeriodUnit: input.validityPeriodUnit,
    ...(input.extraFields ?? {})
  });

  return {
    referenceId: `usageGrant${index + 1}`,
    record: {
      attributes: {
        type: 'QuotLineItmUseRsrcGrant',
        method,
        ...(method === 'PATCH' ? { id: input.quoteLineUsageGrantId ?? '' } : {})
      },
      ...fields
    }
  };
}

export function buildPstGraphPayload(records: PstGraphRecord[], catalogRatesPref?: CatalogRatesPref | null): PstGraphPayload {
  return {
    ...(catalogRatesPref ? { catalogRatesPref } : {}),
    graph: {
      records
    }
  };
}

function buildDeleteGraphRecord(objectName: 'QuoteLineItem' | 'QuoteLineRelationship', recordId: string, referenceId: string): PstGraphRecord {
  return {
    referenceId,
    record: {
      attributes: {
        type: objectName,
        method: 'DELETE',
        id: recordId
      }
    }
  };
}

async function executeMutationPlan(input: {
  orgAlias: string;
  mode: MutationMode;
  records: PstGraphRecord[];
  catalogRatesPref?: CatalogRatesPref | null;
  expectedVerificationCommands: string[];
  dependencies: QuoteMutationDependencies;
  timeoutMs?: number;
}): Promise<QuoteMutationPrimitiveResult> {
  const validation = await validateRecords(input.orgAlias, input.records, input.dependencies, input.timeoutMs);
  const graph = buildPstGraphPayload(input.records, input.catalogRatesPref);
  const plan: MutationPlan = {
    mode: input.mode,
    route: PST_PLACE_ROUTE,
    catalog_rates_pref: input.catalogRatesPref ?? null,
    graph,
    validation,
    expected_verification_commands: input.expectedVerificationCommands
  };
  const validationErrors = validation.flatMap((entry) => entry.errors);

  if (validationErrors.length > 0) {
    return {
      status: 'error',
      result: {
        plan,
        execution: {
          executed: false,
          response: null
        }
      },
      warnings: [],
      errors: validationErrors,
      evidence: buildMutationEvidence(plan, 'Validation failed before any write was attempted.')
    };
  }

  if (input.mode === 'dry_run') {
    return {
      status: 'ok',
      result: {
        plan,
        execution: {
          executed: false,
          response: null
        }
      },
      warnings: ['Dry run only. Re-run with --execute to submit the PST graph request.'],
      errors: [],
      evidence: buildMutationEvidence(plan, 'Dry-run payload was validated against Salesforce describe metadata but not executed.')
    };
  }

  const writeRest = input.dependencies.invokeSfRestWrite ?? invokeSfRestWrite;
  const response = await writeRest<JsonValue>({
    orgAlias: input.orgAlias,
    path: PST_PLACE_ROUTE,
    method: 'POST',
    body: graph,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.dependencies.invokeSfJson === undefined ? {} : { invokeSfJson: input.dependencies.invokeSfJson })
  });

  if (response.ok === false) {
    return {
      status: mapMutationFailureStatus(response.classification),
      result: {
        plan,
        execution: {
          executed: false,
          response: null
        }
      },
      warnings: [],
      errors: [response.message],
      evidence: buildMutationEvidence(plan, 'PST graph request failed before a successful response was returned.')
    };
  }

  return {
    status: 'changed',
    result: {
      plan,
      execution: {
        executed: true,
        response: response.data
      }
    },
    warnings: [],
    errors: [],
    evidence: buildMutationEvidence(plan, 'PST graph request was submitted; persisted quote and line readback remains required for proof.')
  };
}

async function validateRecords(
  orgAlias: string,
  records: PstGraphRecord[],
  dependencies: QuoteMutationDependencies,
  timeoutMs?: number
): Promise<MutationValidationResult[]> {
  const describeCache = new Map<MutationObjectName, DescribeField[]>();
  const results: MutationValidationResult[] = [];

  for (const record of records) {
    const objectName = record.record.attributes.type;
    let fields = describeCache.get(objectName);
    if (!fields) {
      fields = await describeObject(orgAlias, objectName, dependencies, timeoutMs);
      describeCache.set(objectName, fields);
    }

    results.push(validateRecord(record, fields));
  }

  return results;
}

async function describeObject(
  orgAlias: string,
  objectName: MutationObjectName,
  dependencies: QuoteMutationDependencies,
  timeoutMs?: number
): Promise<DescribeField[]> {
  const executeSfJson = dependencies.invokeSfJson ?? invokeSfJson;
  const result = await executeSfJson<DescribeResponse>({
    args: ['sobject', 'describe', '--target-org', orgAlias, '--sobject', objectName, '--json'],
    orgAlias,
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  });

  if (result.ok === false) {
    throw new Error(`Unable to describe ${objectName}: ${result.message}`);
  }

  if (!Array.isArray(result.data.fields)) {
    throw new Error(`Salesforce describe for ${objectName} did not return a fields array.`);
  }

  return result.data.fields;
}

function validateRecord(record: PstGraphRecord, describeFields: DescribeField[]): MutationValidationResult {
  const method = record.record.attributes.method;
  const objectName = record.record.attributes.type;
  const checkedFields = Object.keys(record.record).filter((fieldName) => fieldName !== 'attributes');
  const fieldMap = new Map(describeFields.map((field) => [field.name, field]));
  const errors: string[] = [];

  if ((method === 'PATCH' || method === 'DELETE') && !record.record.attributes.id) {
    errors.push(`${objectName} ${method} record '${record.referenceId}' requires record.attributes.id.`);
  }

  if (method === 'POST' && record.record.attributes.id) {
    errors.push(`${objectName} POST record '${record.referenceId}' must not include record.attributes.id.`);
  }

  for (const fieldName of checkedFields) {
    const field = fieldMap.get(fieldName);
    if (!field) {
      errors.push(`${objectName}.${fieldName} is not present in describe metadata.`);
      continue;
    }

    if (method === 'POST' && !field.createable) {
      errors.push(`${objectName}.${fieldName} is not createable in this org.`);
    }

    if (method === 'PATCH' && !field.updateable) {
      errors.push(`${objectName}.${fieldName} is not updateable in this org.`);
    }
  }

  for (const field of describeFields) {
    if (method === 'POST' && field.createable && !field.nillable && !field.defaultedOnCreate && !checkedFields.includes(field.name)) {
      errors.push(`${objectName}.${field.name} is required for create in this org.`);
    }
  }

  return {
    object: objectName,
    method,
    reference_id: record.referenceId,
    valid: errors.length === 0,
    checked_fields: checkedFields,
    errors
  };
}

function mapMutationFailureStatus(classification: string): Extract<RuntimeStatus, 'unsupported' | 'error'> {
  switch (classification) {
    case 'auth':
    case 'unavailable':
    case 'internal_cli_error':
      return 'unsupported';
    default:
      return 'error';
  }
}

function buildMutationEvidence(plan: MutationPlan, limitations: string): EvidenceItem[] {
  return [
    {
      claim: `Built Place Sales Transaction graph payload for ${plan.graph.graph.records.length} record(s).`,
      evidence_level: 'repo_proven',
      proof_source: [
        PST_PLACE_ROUTE,
        'tools/salesforce/quote-runtime-cli/src/primitives/quote-mutations.ts',
        'sf sobject describe'
      ],
      limitations,
      source_refs: []
    }
  ];
}

function compactMutationFields(fields: Record<string, MutationFieldValue | undefined>): MutationFields {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== '')
  ) as MutationFields;
}
