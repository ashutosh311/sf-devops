import type { JsonValue } from '../../contracts/result-envelope';
import { buildSoqlSelect, quoteSoqlId } from './soql';
import { invokeSfJson, type InvokeSfJsonOptions, type SfCliErrorClassification, type SfCliJsonResult } from './sf-cli';
import { invokeSfRestGet, type InvokeSfRestGetOptions, type SfRestGetFailure, type SfRestGetResult } from './rest';

const PRICING_PROCESS_EXECUTION_FIELDS = [
  'Id',
  'ExecutionKey',
  'ExecutionType',
  'ExecutionTypeKey',
  'Status',
  'Message',
  'CreatedDate'
] as const;

const PRICING_API_EXECUTION_FIELDS = [
  'Id',
  'ExecutionKey',
  'ApiEndpoint',
  'ApiType',
  'Status',
  'ReferenceKey',
  'CreatedDate'
] as const;

const CORE_PRICING_REST_API_PREFIX = '/services/data/v66.0/connect/core-pricing';

export const CORE_PRICING_ERROR_CLASSIFICATIONS = [
  'unavailable',
  'auth',
  'timeout',
  'non_json_error',
  'internal_cli_error',
  'cli_error',
  'malformed_payload'
] as const;

export type CorePricingErrorClassification = SfCliErrorClassification | 'malformed_payload';

export type PricingProcessExecutionFieldName = (typeof PRICING_PROCESS_EXECUTION_FIELDS)[number];
export type PricingApiExecutionFieldName = (typeof PRICING_API_EXECUTION_FIELDS)[number];

export type PricingProcessExecutionRecord = Record<PricingProcessExecutionFieldName, string | null>;
export type PricingApiExecutionRecord = Record<PricingApiExecutionFieldName, string | null>;
export type CorePricingJsonObject = { readonly [key: string]: JsonValue };

export type CorePricingSuccess<T> = {
  readonly ok: true;
  readonly classification: 'ok';
  readonly source: 'soql' | 'rest';
  readonly query?: string;
  readonly path?: string;
  readonly data: T;
};

export type CorePricingFailure = {
  readonly ok: false;
  readonly classification: CorePricingErrorClassification;
  readonly source: 'soql' | 'rest';
  readonly query?: string;
  readonly path?: string;
  readonly message: string;
};

export type CorePricingResult<T> = CorePricingSuccess<T> | CorePricingFailure;

export type PricingProcessExecutionByExecutionTypeKeyDependencies = {
  readonly invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

export type PricingProcessExecutionFamilyDependencies = {
  readonly invokeSfRestGet?: <T>(options: InvokeSfRestGetOptions) => Promise<SfRestGetResult<T>>;
};

export type PricingProcessExecutionRecordsByExecutionKeyDependencies = {
  readonly invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

export type PricingApiExecutionFamilyDependencies = {
  readonly invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

export type WaterfallDependencies = {
  readonly invokeSfRestGet?: <T>(options: InvokeSfRestGetOptions) => Promise<SfRestGetResult<T>>;
};

export type ApiExecutionLogDependencies = {
  readonly invokeSfRestGet?: <T>(options: InvokeSfRestGetOptions) => Promise<SfRestGetResult<T>>;
};

type SoqlQueryResponse = {
  readonly records?: unknown[];
};

export async function fetchPricingProcessExecutionByExecutionTypeKey(
  input: PricingProcessExecutionByExecutionTypeKeyDependencies & {
    readonly orgAlias: string;
    readonly executionTypeKey: string;
    readonly timeoutMs?: number;
  }
): Promise<CorePricingResult<readonly PricingProcessExecutionRecord[]>> {
  const query = buildPricingProcessExecutionByExecutionTypeKeySoql(input.executionTypeKey);
  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const sfResult = await executeSfJson<SoqlQueryResponse>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', query, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (sfResult.ok === false) {
    return buildSoqlFailure(sfResult.classification, sfResult.message, query);
  }

  const records = normalizeQueryRecords(sfResult.data, PRICING_PROCESS_EXECUTION_FIELDS);
  if (records === 'malformed') {
    return buildSoqlFailure('malformed_payload', 'Salesforce CLI returned an unexpected PricingProcessExecution payload.', query);
  }

  return {
    ok: true,
    classification: 'ok',
    source: 'soql',
    query,
    data: records
  };
}

export async function fetchPricingProcessExecutionFamilyByExecutionKey(
  input: PricingProcessExecutionFamilyDependencies & {
    readonly orgAlias: string;
    readonly executionKey: string;
    readonly timeoutMs?: number;
  }
): Promise<CorePricingResult<CorePricingJsonObject>> {
  const path = buildPricingProcessExecutionFamilyPath(input.executionKey);
  const executeRest = input.invokeSfRestGet ?? invokeSfRestGet;
  const restResult = await executeRest<unknown>({
    orgAlias: input.orgAlias,
    path,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  return normalizeRestObjectResult(restResult, path, 'Salesforce CLI returned an unexpected pricing-process-execution family payload.');
}

export async function fetchPricingProcessExecutionRecordsByExecutionKey(
  input: PricingProcessExecutionRecordsByExecutionKeyDependencies & {
    readonly orgAlias: string;
    readonly executionKey: string;
    readonly timeoutMs?: number;
  }
): Promise<CorePricingResult<readonly PricingProcessExecutionRecord[]>> {
  const query = buildPricingProcessExecutionRecordsByExecutionKeySoql(input.executionKey);
  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const sfResult = await executeSfJson<SoqlQueryResponse>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', query, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (sfResult.ok === false) {
    return buildSoqlFailure(sfResult.classification, sfResult.message, query);
  }

  const records = normalizeQueryRecords(sfResult.data, PRICING_PROCESS_EXECUTION_FIELDS);
  if (records === 'malformed') {
    return buildSoqlFailure('malformed_payload', 'Salesforce CLI returned an unexpected PricingProcessExecution family payload.', query);
  }

  return {
    ok: true,
    classification: 'ok',
    source: 'soql',
    query,
    data: records
  };
}

export async function fetchPricingApiExecutionFamilyByExecutionKey(
  input: PricingApiExecutionFamilyDependencies & {
    readonly orgAlias: string;
    readonly executionKey: string;
    readonly timeoutMs?: number;
  }
): Promise<CorePricingResult<readonly PricingApiExecutionRecord[]>> {
  const query = buildPricingApiExecutionFamilyByExecutionKeySoql(input.executionKey);
  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const sfResult = await executeSfJson<SoqlQueryResponse>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', query, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (sfResult.ok === false) {
    return buildSoqlFailure(sfResult.classification, sfResult.message, query);
  }

  const records = normalizeQueryRecords(sfResult.data, PRICING_API_EXECUTION_FIELDS);
  if (records === 'malformed') {
    return buildSoqlFailure('malformed_payload', 'Salesforce CLI returned an unexpected PricingApiExecution payload.', query);
  }

  return {
    ok: true,
    classification: 'ok',
    source: 'soql',
    query,
    data: records
  };
}

export async function fetchCorePricingWaterfall(
  input: WaterfallDependencies & {
    readonly orgAlias: string;
    readonly lineId: string;
    readonly pricingExecutionId: string;
    readonly timeoutMs?: number;
  }
): Promise<CorePricingResult<CorePricingJsonObject>> {
  const path = buildCorePricingWaterfallPath(input.lineId, input.pricingExecutionId);
  const executeRest = input.invokeSfRestGet ?? invokeSfRestGet;
  const restResult = await executeRest<unknown>({
    orgAlias: input.orgAlias,
    path,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  return normalizeRestObjectResult(restResult, path, 'Salesforce CLI returned an unexpected core-pricing waterfall payload.');
}

export async function fetchCorePricingApiExecutionLog(
  input: ApiExecutionLogDependencies & {
    readonly orgAlias: string;
    readonly apiExecutionTypeKey: string;
    readonly timeoutMs?: number;
  }
): Promise<CorePricingResult<JsonValue>> {
  const path = buildCorePricingApiExecutionLogPath(input.apiExecutionTypeKey);
  const executeRest = input.invokeSfRestGet ?? invokeSfRestGet;
  const restResult = await executeRest<unknown>({
    orgAlias: input.orgAlias,
    path,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  return normalizeRestJsonResult(restResult, path, 'Salesforce CLI returned an unexpected core-pricing API execution log payload.');
}

export function buildPricingLineExecutionTypeKey(pricingExecutionTypeKey: string, lineId: string): string {
  const normalizedExecutionTypeKey = normalizeRequiredIdentifier(pricingExecutionTypeKey, 'pricingExecutionTypeKey');
  const normalizedLineId = normalizeRequiredIdentifier(lineId, 'lineId');
  return `${normalizedExecutionTypeKey}_${normalizedLineId}`;
}

export function buildPricingProcessExecutionByExecutionTypeKeySoql(executionTypeKey: string): string {
  return buildSoqlSelect({
    objectName: 'PricingProcessExecution',
    fields: PRICING_PROCESS_EXECUTION_FIELDS,
    where: `ExecutionTypeKey = ${quoteSoqlId(executionTypeKey)}`,
    orderBy: ['CreatedDate', 'Id']
  });
}

export function buildPricingProcessExecutionRecordsByExecutionKeySoql(executionKey: string): string {
  return buildSoqlSelect({
    objectName: 'PricingProcessExecution',
    fields: PRICING_PROCESS_EXECUTION_FIELDS,
    where: `ExecutionKey = ${quoteSoqlId(executionKey)}`,
    orderBy: ['CreatedDate', 'Id']
  });
}

export function buildPricingApiExecutionFamilyByExecutionKeySoql(executionKey: string): string {
  return buildSoqlSelect({
    objectName: 'PricingApiExecution',
    fields: PRICING_API_EXECUTION_FIELDS,
    where: `ExecutionKey = ${quoteSoqlId(executionKey)}`,
    orderBy: ['CreatedDate', 'Id']
  });
}

export function buildPricingProcessExecutionFamilyPath(executionKey: string): string {
  return `${CORE_PRICING_REST_API_PREFIX}/pricing-process-execution/${encodeURIComponent(normalizeRequiredIdentifier(executionKey, 'executionKey'))}`;
}

export function buildCorePricingWaterfallPath(lineId: string, pricingExecutionId: string): string {
  return `${CORE_PRICING_REST_API_PREFIX}/waterfall/${encodeURIComponent(normalizeRequiredIdentifier(lineId, 'lineId'))}/${encodeURIComponent(normalizeRequiredIdentifier(pricingExecutionId, 'pricingExecutionId'))}`;
}

export function buildCorePricingApiExecutionLogPath(apiExecutionTypeKey: string): string {
  return `${CORE_PRICING_REST_API_PREFIX}/apiexecutionlogs/${encodeURIComponent(normalizeRequiredIdentifier(apiExecutionTypeKey, 'apiExecutionTypeKey'))}`;
}

function buildSoqlFailure(classification: CorePricingErrorClassification, message: string, query: string): CorePricingFailure {
  return {
    ok: false,
    classification,
    source: 'soql',
    query,
    message
  };
}

function buildRestFailure(classification: CorePricingErrorClassification, message: string, path: string): CorePricingFailure {
  return {
    ok: false,
    classification,
    source: 'rest',
    path,
    message
  };
}

function normalizeRestObjectResult(
  restResult: SfRestGetResult<unknown>,
  path: string,
  malformedMessage: string
): CorePricingResult<CorePricingJsonObject> {
  if (restResult.ok === false) {
    return buildRestFailure(restResult.classification, restResult.message, path);
  }

  const normalized = normalizeJsonObject(restResult.data);
  if (normalized === null) {
    return buildRestFailure('malformed_payload', malformedMessage, path);
  }

  return {
    ok: true,
    classification: 'ok',
    source: 'rest',
    path,
    data: normalized
  };
}

function normalizeRestJsonResult(
  restResult: SfRestGetResult<unknown>,
  path: string,
  malformedMessage: string
): CorePricingResult<JsonValue> {
  if (restResult.ok === false) {
    return buildRestFailure(restResult.classification, restResult.message, path);
  }

  const normalized = normalizeJsonValue(restResult.data);
  if (normalized === undefined) {
    return buildRestFailure('malformed_payload', malformedMessage, path);
  }

  return {
    ok: true,
    classification: 'ok',
    source: 'rest',
    path,
    data: normalized
  };
}

function normalizeQueryRecords<TField extends string>(
  data: SoqlQueryResponse,
  fields: readonly TField[]
): Record<TField, string | null>[] | 'malformed' {
  if (!Array.isArray(data.records)) {
    return 'malformed';
  }

  const normalizedRecords: Record<TField, string | null>[] = [];
  for (const record of data.records) {
    if (!isRecord(record)) {
      return 'malformed';
    }

    const normalizedRecord = {} as Record<TField, string | null>;
    for (const fieldName of fields) {
      const value = record[fieldName];
      if (typeof value === 'string') {
        normalizedRecord[fieldName] = value;
      } else if (value === null || value === undefined) {
        normalizedRecord[fieldName] = null;
      } else {
        return 'malformed';
      }
    }
    normalizedRecords.push(normalizedRecord);
  }

  return normalizedRecords;
}

function normalizeRequiredIdentifier(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} must not be blank.`);
  }

  return normalized;
}

function normalizeJsonObject(value: unknown): CorePricingJsonObject | null {
  if (!isRecord(value)) {
    return null;
  }

  const normalized: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedEntry = normalizeJsonValue(entry);
    if (normalizedEntry === undefined) {
      return null;
    }

    normalized[key] = normalizedEntry;
  }

  return normalized;
}

function normalizeJsonValue(value: unknown): JsonValue | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const normalizedArray: JsonValue[] = [];
    for (const entry of value) {
      const normalizedEntry = normalizeJsonValue(entry);
      if (normalizedEntry === undefined) {
        return undefined;
      }

      normalizedArray.push(normalizedEntry);
    }
    return normalizedArray;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const normalizedRecord: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedEntry = normalizeJsonValue(entry);
    if (normalizedEntry === undefined) {
      return undefined;
    }

    normalizedRecord[key] = normalizedEntry;
  }

  return normalizedRecord;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
