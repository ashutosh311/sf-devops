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
import { buildSoqlSelect, quoteSoqlId, quoteSoqlIds } from '../integrations/salesforce/soql';

export const PRODUCT_CONFIGURE_ROUTE = '/services/data/v66.0/connect/cpq/configurator/actions/configure';

export type ProductConfigRuntimeMessage = {
  category: string | null;
  message_type: string | null;
  message: string;
  primary_record_id: string | null;
  related_record_id: string | null;
};

export type ProductConfigRuntimeSummary = {
  quote_id: string;
  line_id: string;
  context_id: string | null;
  persisted: false;
  messages: ProductConfigRuntimeMessage[];
  catalog_products_count: number;
  load_instance_supported: false;
};

export type ProductConfigRuntimePrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'warn' | 'unsupported' | 'error'>;
  result: ProductConfigRuntimeSummary;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
};

export type ProductConfigValidationSummary = {
  quote_id: string;
  line_ids: string[];
  runtime_messages: ProductConfigRuntimeMessage[];
  persisted_attributes: JsonValue[];
  persisted_relationships: JsonValue[];
  proof_status: 'proven' | 'messages_present' | 'readback_only' | 'error';
};

export type ProductConfigValidationPrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'warn' | 'unsupported' | 'error'>;
  result: ProductConfigValidationSummary;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
};

export type ProductConfigRuntimeDependencies = {
  invokeSfRestWrite?: <T>(options: InvokeSfRestWriteOptions) => Promise<SfRestWriteResult<T>>;
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

export type ExecuteInspectProductConfigInput = ProductConfigRuntimeDependencies & {
  orgAlias: string;
  quoteId: string;
  lineId: string;
  accountId?: string | null;
  timeoutMs?: number;
};

export type ExecuteValidateProductConfigInput = ProductConfigRuntimeDependencies & {
  orgAlias: string;
  quoteId: string;
  lineIds?: string[];
  timeoutMs?: number;
};

type ConfigureResponse = {
  transactionContext?: {
    contextId?: string;
  };
  messages?: unknown;
  catalogProducts?: unknown[];
  errors?: unknown[];
  success?: boolean;
};

export async function executeInspectProductConfig(input: ExecuteInspectProductConfigInput): Promise<ProductConfigRuntimePrimitiveResult> {
  const writeRest = input.invokeSfRestWrite ?? invokeSfRestWrite;
  const response = await writeRest<ConfigureResponse>({
    orgAlias: input.orgAlias,
    path: PRODUCT_CONFIGURE_ROUTE,
    method: 'POST',
    body: buildConfigureBody(input),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  const base = buildRuntimeBase(input.quoteId, input.lineId);
  if (response.ok === false) {
    return {
      status: response.message.includes('IHeadlessConfiguratorFamily') ? 'unsupported' : 'error',
      result: base,
      warnings: [],
      errors: [response.message],
      evidence: []
    };
  }

  const messages = normalizeMessages(response.data.messages, response.data.errors);
  return {
    status: messages.length > 0 ? 'warn' : 'ok',
    result: {
      quote_id: input.quoteId,
      line_id: input.lineId,
      context_id: response.data.transactionContext?.contextId ?? null,
      persisted: false,
      messages,
      catalog_products_count: Array.isArray(response.data.catalogProducts) ? response.data.catalogProducts.length : 0,
      load_instance_supported: false
    },
    warnings: messages.map((message) => message.message),
    errors: [],
    evidence: [
      {
        claim: `Ran Product Configurator configure for quote ${input.quoteId} line ${input.lineId}.`,
        evidence_level: 'org_proven',
        proof_source: [PRODUCT_CONFIGURE_ROUTE],
        limitations: 'Configure results are in-memory until persisted through a supported save path or direct transaction record writes.',
        source_refs: []
      }
    ]
  };
}

export async function executeValidateProductConfig(input: ExecuteValidateProductConfigInput): Promise<ProductConfigValidationPrimitiveResult> {
  const lineIds = input.lineIds ?? [];
  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const attributesQuery = buildQuoteLineAttributesSoql(input.quoteId, lineIds);
  const relationshipsQuery = buildQuoteLineRelationshipsSoql(input.quoteId, lineIds);
  const [attributesResult, relationshipsResult] = await Promise.all([
    executeSfJson<QueryResponse>({
      args: ['data', 'query', '--target-org', input.orgAlias, '--query', attributesQuery, '--json'],
      orgAlias: input.orgAlias,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    }),
    executeSfJson<QueryResponse>({
      args: ['data', 'query', '--target-org', input.orgAlias, '--query', relationshipsQuery, '--json'],
      orgAlias: input.orgAlias,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    })
  ]);

  const errors = [attributesResult, relationshipsResult].flatMap((result) => result.ok ? [] : [result.message]);
  if (errors.length > 0) {
    return {
      status: 'error',
      result: buildValidationBase(input.quoteId, lineIds),
      warnings: [],
      errors,
      evidence: []
    };
  }
  if (attributesResult.ok === false || relationshipsResult.ok === false) {
    throw new Error('Unexpected product config validation narrowing failure.');
  }

  const persistedAttributes = attributesResult.data.records ?? [];
  const persistedRelationships = relationshipsResult.data.records ?? [];
  return {
    status: 'ok',
    result: {
      quote_id: input.quoteId,
      line_ids: lineIds,
      runtime_messages: [],
      persisted_attributes: persistedAttributes as JsonValue[],
      persisted_relationships: persistedRelationships as JsonValue[],
      proof_status: 'readback_only'
    },
    warnings: ['Runtime configure validation requires --line-id scoped inspection; this command also returns persisted readback proof.'],
    errors: [],
    evidence: [
      {
        claim: `Read persisted config attributes and relationships for quote ${input.quoteId}.`,
        evidence_level: 'org_proven',
        proof_source: [attributesQuery, relationshipsQuery],
        limitations: 'Readback proof does not guarantee the Salesforce UI alert surface has refreshed.',
        source_refs: []
      }
    ]
  };
}

export function buildConfigureBody(input: ExecuteInspectProductConfigInput): Record<string, JsonValue> {
  return {
    transactionLineId: input.lineId,
    transactionId: input.quoteId,
    configuratorOptions: {
      executePricing: true,
      returnProductCatalogData: true,
      qualifyAllProductsInTransaction: true,
      validateProductCatalog: true,
      validateAmendRenewCancel: true,
      executeConfigurationRules: true,
      addDefaultConfiguration: true
    },
    contextResponseType: 'Full',
    ...(input.accountId ? { qualificationContext: { accountId: input.accountId } } : {})
  };
}

export function buildQuoteLineAttributesSoql(quoteId: string, lineIds: readonly string[] = []): string {
  const lineFilter = lineIds.length > 0 ? ` AND QuoteLineItemId IN (${quoteSoqlIds(lineIds)})` : '';
  return buildSoqlSelect({
    objectName: 'QuoteLineItemAttribute',
    fields: ['Id', 'QuoteLineItemId', 'AttributeName', 'AttributeValue', 'AttributeDefinitionId', 'AttributePicklistValueId'],
    where: `QuoteLineItem.QuoteId = ${quoteSoqlId(quoteId)}${lineFilter}`,
    orderBy: ['QuoteLineItemId', 'AttributeName']
  });
}

export function buildQuoteLineRelationshipsSoql(quoteId: string, lineIds: readonly string[] = []): string {
  const lineFilter = lineIds.length > 0 ? ` AND MainQuoteLineId IN (${quoteSoqlIds(lineIds)})` : '';
  return buildSoqlSelect({
    objectName: 'QuoteLineRelationship',
    fields: ['Id', 'QuoteId', 'MainQuoteLineId', 'AssociatedQuoteLineId', 'ProductRelatedComponentId', 'AssociatedQuoteLineRole'],
    where: `QuoteId = ${quoteSoqlId(quoteId)}${lineFilter}`,
    orderBy: ['MainQuoteLineId', 'AssociatedQuoteLineId']
  });
}

function normalizeMessages(messages: unknown, errors: unknown): ProductConfigRuntimeMessage[] {
  return [...flattenMessages(messages), ...flattenMessages(errors)];
}

function flattenMessages(value: unknown): ProductConfigRuntimeMessage[] {
  if (Array.isArray(value)) {
    return value.flatMap(flattenMessages);
  }
  if (isRecord(value)) {
    const direct = readString(value.message);
    const nested = Object.values(value).flatMap((entry) => Array.isArray(entry) || isRecord(entry) ? flattenMessages(entry) : []);
    return [
      ...(direct ? [{
        category: readString(value.category),
        message_type: readString(value.messageType),
        message: direct,
        primary_record_id: readString(value.primaryRecordId),
        related_record_id: readString(value.relatedRecordId)
      }] : []),
      ...nested
    ];
  }
  return [];
}

function buildRuntimeBase(quoteId: string, lineId: string): ProductConfigRuntimeSummary {
  return {
    quote_id: quoteId,
    line_id: lineId,
    context_id: null,
    persisted: false,
    messages: [],
    catalog_products_count: 0,
    load_instance_supported: false
  };
}

function buildValidationBase(quoteId: string, lineIds: string[]): ProductConfigValidationSummary {
  return {
    quote_id: quoteId,
    line_ids: lineIds,
    runtime_messages: [],
    persisted_attributes: [],
    persisted_relationships: [],
    proof_status: 'error'
  };
}

type QueryResponse = {
  records?: unknown[];
};

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
