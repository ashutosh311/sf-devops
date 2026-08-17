import type { JsonValue } from '../../contracts/result-envelope';
import { buildSoqlSelect, quoteSoqlId, quoteSoqlIds } from './soql';
import { invokeSfJson, type InvokeSfJsonOptions, type SfCliErrorClassification, type SfCliJsonResult } from './sf-cli';

const QUOTE_LINE_DETAIL_FIELDS = [
  'Id',
  'QuoteLineItemId',
  'PriceWaterfallIdentifier',
  'UnitPrice',
  'NetUnitPrice',
  'TotalPrice',
  'TotalLineAmount',
  'EffectiveFrom',
  'EffectiveTo',
  'ReferenceNumber',
  'ReferenceDate'
] as const;

const QUOTE_LINE_PRICE_ADJUSTMENT_FIELDS = [
  'Id',
  'QuoteLineItemId',
  'AdjustmentSource',
  'AdjustmentType',
  'AdjustmentValue',
  'TotalAmount',
  'Description',
  'Priority',
  'PriceAdjustmentCauseId'
] as const;

const QUOTE_LINE_RATE_CARD_ENTRY_FIELDS = [
  'Id',
  'QuoteLineItemId',
  'RateCardEntryId',
  'RateCardId',
  'UsageResourceId'
] as const;

const QUOTE_LINE_RATE_ADJUSTMENT_FIELDS = [
  'Id',
  'QuoteLineRateCardEntryId',
  'AdjustmentType',
  'AdjustmentValue',
  'LowerBound',
  'UpperBound',
  'Name'
] as const;

const QUOTE_LINE_USAGE_RESOURCE_GRANT_FIELDS = [
  'Id',
  'QuoteLineItemId',
  'UsageResourceId',
  'TokenResourceId'
] as const;

const QUOTE_LINE_USAGE_RESOURCE_POLICY_FIELDS = [
  'Id',
  'QuoteLineItemId',
  'UsageResourceId'
] as const;

export type QuoteLineArtifactErrorClassification = SfCliErrorClassification | 'malformed_payload';
export type QuoteLineDetailFieldName = (typeof QUOTE_LINE_DETAIL_FIELDS)[number];
export type QuoteLinePriceAdjustmentFieldName = (typeof QUOTE_LINE_PRICE_ADJUSTMENT_FIELDS)[number];
export type QuoteLineRateCardEntryFieldName = (typeof QUOTE_LINE_RATE_CARD_ENTRY_FIELDS)[number];
export type QuoteLineRateAdjustmentFieldName = (typeof QUOTE_LINE_RATE_ADJUSTMENT_FIELDS)[number];
export type QuoteLineUsageResourceGrantFieldName = (typeof QUOTE_LINE_USAGE_RESOURCE_GRANT_FIELDS)[number];
export type QuoteLineUsageResourcePolicyFieldName = (typeof QUOTE_LINE_USAGE_RESOURCE_POLICY_FIELDS)[number];
export type QuoteLineDetailRecord = Record<QuoteLineDetailFieldName, JsonValue>;
export type QuoteLinePriceAdjustmentRecord = Record<QuoteLinePriceAdjustmentFieldName, JsonValue>;
export type QuoteLineRateCardEntryRecord = Record<QuoteLineRateCardEntryFieldName, JsonValue>;
export type QuoteLineRateAdjustmentRecord = Record<QuoteLineRateAdjustmentFieldName, JsonValue>;
export type QuoteLineUsageResourceGrantRecord = Record<QuoteLineUsageResourceGrantFieldName, JsonValue>;
export type QuoteLineUsageResourcePolicyRecord = Record<QuoteLineUsageResourcePolicyFieldName, JsonValue>;

export type QuoteLineArtifactSuccess<T> = {
  readonly ok: true;
  readonly classification: 'ok';
  readonly query: string;
  readonly data: readonly T[];
};

export type QuoteLineArtifactFailure = {
  readonly ok: false;
  readonly classification: QuoteLineArtifactErrorClassification;
  readonly query: string;
  readonly message: string;
};

export type QuoteLineArtifactResult<T> = QuoteLineArtifactSuccess<T> | QuoteLineArtifactFailure;

type SoqlQueryResponse = {
  readonly records?: unknown[];
};

type QuoteLineArtifactDependencies = {
  readonly invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

export async function fetchQuoteLineDetailByLineId(
  input: QuoteLineArtifactDependencies & {
    readonly orgAlias: string;
    readonly lineId: string;
    readonly timeoutMs?: number;
  }
): Promise<QuoteLineArtifactResult<QuoteLineDetailRecord>> {
  const query = buildQuoteLineDetailSoql(input.lineId);
  return runArtifactQuery({
    orgAlias: input.orgAlias,
    query,
    fields: QUOTE_LINE_DETAIL_FIELDS,
    malformedMessage: 'Salesforce CLI returned an unexpected QuoteLineDetail payload.',
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.invokeSfJson ? { invokeSfJson: input.invokeSfJson } : {})
  });
}

export async function fetchQuoteLinePriceAdjustmentsByLineId(
  input: QuoteLineArtifactDependencies & {
    readonly orgAlias: string;
    readonly lineId: string;
    readonly timeoutMs?: number;
  }
): Promise<QuoteLineArtifactResult<QuoteLinePriceAdjustmentRecord>> {
  const query = buildQuoteLinePriceAdjustmentSoql(input.lineId);
  return runArtifactQuery({
    orgAlias: input.orgAlias,
    query,
    fields: QUOTE_LINE_PRICE_ADJUSTMENT_FIELDS,
    malformedMessage: 'Salesforce CLI returned an unexpected QuoteLinePriceAdjustment payload.',
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.invokeSfJson ? { invokeSfJson: input.invokeSfJson } : {})
  });
}

export async function fetchQuoteLineRateCardEntriesByLineId(
  input: QuoteLineArtifactDependencies & {
    readonly orgAlias: string;
    readonly lineId: string;
    readonly timeoutMs?: number;
  }
): Promise<QuoteLineArtifactResult<QuoteLineRateCardEntryRecord>> {
  const query = buildQuoteLineRateCardEntrySoql(input.lineId);
  return runArtifactQuery({
    orgAlias: input.orgAlias,
    query,
    fields: QUOTE_LINE_RATE_CARD_ENTRY_FIELDS,
    malformedMessage: 'Salesforce CLI returned an unexpected QuoteLineRateCardEntry payload.',
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.invokeSfJson ? { invokeSfJson: input.invokeSfJson } : {})
  });
}

export async function fetchQuoteLineRateAdjustmentsByRateCardEntryIds(
  input: QuoteLineArtifactDependencies & {
    readonly orgAlias: string;
    readonly quoteLineRateCardEntryIds: readonly string[];
    readonly timeoutMs?: number;
  }
): Promise<QuoteLineArtifactResult<QuoteLineRateAdjustmentRecord>> {
  const query = buildQuoteLineRateAdjustmentSoql(input.quoteLineRateCardEntryIds);
  if (input.quoteLineRateCardEntryIds.length === 0) {
    return {
      ok: true,
      classification: 'ok',
      query,
      data: []
    };
  }
  return runArtifactQuery({
    orgAlias: input.orgAlias,
    query,
    fields: QUOTE_LINE_RATE_ADJUSTMENT_FIELDS,
    malformedMessage: 'Salesforce CLI returned an unexpected QuoteLineRateAdjustment payload.',
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.invokeSfJson ? { invokeSfJson: input.invokeSfJson } : {})
  });
}

export async function fetchQuoteLineUsageResourceGrantsByLineId(
  input: QuoteLineArtifactDependencies & {
    readonly orgAlias: string;
    readonly lineId: string;
    readonly timeoutMs?: number;
  }
): Promise<QuoteLineArtifactResult<QuoteLineUsageResourceGrantRecord>> {
  const query = buildQuoteLineUsageResourceGrantSoql(input.lineId);
  return runArtifactQuery({
    orgAlias: input.orgAlias,
    query,
    fields: QUOTE_LINE_USAGE_RESOURCE_GRANT_FIELDS,
    malformedMessage: 'Salesforce CLI returned an unexpected QuotLineItmUseRsrcGrant payload.',
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.invokeSfJson ? { invokeSfJson: input.invokeSfJson } : {})
  });
}

export async function fetchQuoteLineUsageResourcePoliciesByLineId(
  input: QuoteLineArtifactDependencies & {
    readonly orgAlias: string;
    readonly lineId: string;
    readonly timeoutMs?: number;
  }
): Promise<QuoteLineArtifactResult<QuoteLineUsageResourcePolicyRecord>> {
  const query = buildQuoteLineUsageResourcePolicySoql(input.lineId);
  return runArtifactQuery({
    orgAlias: input.orgAlias,
    query,
    fields: QUOTE_LINE_USAGE_RESOURCE_POLICY_FIELDS,
    malformedMessage: 'Salesforce CLI returned an unexpected QuotLineItmUsageRsrcPlcy payload.',
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.invokeSfJson ? { invokeSfJson: input.invokeSfJson } : {})
  });
}

export function buildQuoteLineDetailSoql(lineId: string): string {
  return buildSoqlSelect({
    objectName: 'QuoteLineDetail',
    fields: QUOTE_LINE_DETAIL_FIELDS,
    where: `QuoteLineItemId = ${quoteSoqlId(lineId)}`,
    orderBy: ['EffectiveFrom', 'Id']
  });
}

export function buildQuoteLinePriceAdjustmentSoql(lineId: string): string {
  return buildSoqlSelect({
    objectName: 'QuoteLinePriceAdjustment',
    fields: QUOTE_LINE_PRICE_ADJUSTMENT_FIELDS,
    where: `QuoteLineItemId = ${quoteSoqlId(lineId)}`,
    orderBy: ['Priority', 'Id']
  });
}

export function buildQuoteLineRateCardEntrySoql(lineId: string): string {
  return buildSoqlSelect({
    objectName: 'QuoteLineRateCardEntry',
    fields: QUOTE_LINE_RATE_CARD_ENTRY_FIELDS,
    where: `QuoteLineItemId = ${quoteSoqlId(lineId)}`,
    orderBy: ['Id']
  });
}

export function buildQuoteLineRateAdjustmentSoql(quoteLineRateCardEntryIds: readonly string[]): string {
  return buildSoqlSelect({
    objectName: 'QuoteLineRateAdjustment',
    fields: QUOTE_LINE_RATE_ADJUSTMENT_FIELDS,
    where: quoteLineRateCardEntryIds.length === 0
      ? 'Id = null'
      : `QuoteLineRateCardEntryId IN (${quoteSoqlIds(quoteLineRateCardEntryIds)})`,
    orderBy: ['QuoteLineRateCardEntryId', 'LowerBound', 'Id']
  });
}

export function buildQuoteLineUsageResourceGrantSoql(lineId: string): string {
  return buildSoqlSelect({
    objectName: 'QuotLineItmUseRsrcGrant',
    fields: QUOTE_LINE_USAGE_RESOURCE_GRANT_FIELDS,
    where: `QuoteLineItemId = ${quoteSoqlId(lineId)}`,
    orderBy: ['UsageResourceId', 'Id']
  });
}

export function buildQuoteLineUsageResourcePolicySoql(lineId: string): string {
  return buildSoqlSelect({
    objectName: 'QuotLineItmUsageRsrcPlcy',
    fields: QUOTE_LINE_USAGE_RESOURCE_POLICY_FIELDS,
    where: `QuoteLineItemId = ${quoteSoqlId(lineId)}`,
    orderBy: ['UsageResourceId', 'Id']
  });
}

async function runArtifactQuery<TField extends string>(
  input: QuoteLineArtifactDependencies & {
    readonly orgAlias: string;
    readonly query: string;
    readonly fields: readonly TField[];
    readonly malformedMessage: string;
    readonly timeoutMs?: number;
  }
): Promise<QuoteLineArtifactResult<Record<TField, JsonValue>>> {
  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const sfResult = await executeSfJson<SoqlQueryResponse>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', input.query, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (sfResult.ok === false) {
    return {
      ok: false,
      classification: sfResult.classification,
      query: input.query,
      message: sfResult.message
    };
  }

  const normalized = normalizeArtifactRecords(sfResult.data, input.fields);
  if (normalized === 'malformed') {
    return {
      ok: false,
      classification: 'malformed_payload',
      query: input.query,
      message: input.malformedMessage
    };
  }

  return {
    ok: true,
    classification: 'ok',
    query: input.query,
    data: normalized
  };
}

function normalizeArtifactRecords<TField extends string>(
  data: SoqlQueryResponse,
  fields: readonly TField[]
): Record<TField, JsonValue>[] | 'malformed' {
  if (!Array.isArray(data.records)) {
    return 'malformed';
  }

  const normalizedRecords: Record<TField, JsonValue>[] = [];
  for (const record of data.records) {
    if (!isRecord(record)) {
      return 'malformed';
    }

    const normalizedRecord = {} as Record<TField, JsonValue>;
    for (const fieldName of fields) {
      const value = normalizeFieldValue(record[fieldName]);
      if (value === undefined) {
        return 'malformed';
      }

      normalizedRecord[fieldName] = value;
    }

    normalizedRecords.push(normalizedRecord);
  }

  return normalizedRecords;
}

function normalizeFieldValue(value: unknown): JsonValue | undefined {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
