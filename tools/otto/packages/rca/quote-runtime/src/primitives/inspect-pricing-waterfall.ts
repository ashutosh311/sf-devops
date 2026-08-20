import type { JsonValue } from '../contracts/result-envelope';
import type { EvidenceItem } from '../contracts/evidence';
import type { RuntimeStatus } from '../contracts/status';
import {
  buildPricingLineExecutionTypeKey,
  fetchCorePricingApiExecutionLog,
  fetchCorePricingWaterfall,
  fetchPricingApiExecutionFamilyByExecutionKey,
  fetchPricingProcessExecutionByExecutionTypeKey,
  fetchPricingProcessExecutionFamilyByExecutionKey,
  fetchPricingProcessExecutionRecordsByExecutionKey,
  type ApiExecutionLogDependencies,
  type CorePricingFailure,
  type CorePricingJsonObject,
  type CorePricingResult,
  type PricingApiExecutionRecord,
  type PricingProcessExecutionRecord,
  type PricingApiExecutionFamilyDependencies,
  type PricingProcessExecutionByExecutionTypeKeyDependencies,
  type PricingProcessExecutionFamilyDependencies,
  type PricingProcessExecutionRecordsByExecutionKeyDependencies,
  type WaterfallDependencies
} from '../integrations/salesforce/core-pricing';
import {
  dedupeLineIds,
  executeSnapshotLines,
  type ExecuteSnapshotLinesInput,
  type SnapshotLineRecord,
  type SnapshotLinesPrimitiveResult
} from './snapshot-lines';

export type InspectPricingWaterfallSelectorResolution = {
  quote_id: string;
  requested_line_id: string;
  resolved_line_id: string | null;
  price_waterfall_identifier: string | null;
  waterfall_line_item_id: string | null;
  pricing_execution_id: string | null;
  resolution_mode: 'persisted_price_waterfall_identifier';
};

export type InspectPricingWaterfallPersistedAnchor = {
  quote_id: JsonValue;
  line_id: JsonValue;
  line_number: JsonValue;
  product_id: JsonValue;
  parent_line_id: JsonValue;
  unit_price: JsonValue;
  net_unit_price: JsonValue;
  total_price: JsonValue;
  total_line_amount: JsonValue;
  price_waterfall_identifier: JsonValue;
  quote_action_id: JsonValue;
  quote_action_type: JsonValue;
  quote_action_source_asset_id: JsonValue;
  created_date: JsonValue;
  last_modified_date: JsonValue;
};

export type InspectPricingWaterfallCorrelationQuery<TRecord extends JsonValue> = {
  query_status: 'not_requested' | 'ok' | 'unsupported' | 'error';
  execution_type_key: string | null;
  execution_key: string | null;
  record_count: number;
  records: TRecord[];
};

export type InspectPricingWaterfallProcessFamily = {
  fetch_status: 'not_requested' | 'ok' | 'unsupported' | 'error';
  path: string | null;
  execution_key: string | null;
  execution_types_present: string[];
  line_membership_confirmed: boolean | null;
  raw_payload: CorePricingJsonObject | null;
};

export type InspectPricingApiExecutionLog = {
  fetch_status: 'not_requested' | 'ok' | 'unsupported' | 'error';
  endpoint: string | null;
  api_execution_type_key: string | null;
  raw_payload: JsonValue | null;
};

export type InspectPricingWaterfallWaterfallElement = {
  sequence: number;
  name: string | null;
  filter_rules: JsonValue[];
  inputs: JsonValue[];
  outputs: JsonValue[];
  calculation_formula: string | null;
  writes: string[];
};

export type InspectPricingWaterfallWaterfall = {
  endpoint: string | null;
  fetch_status: 'not_requested' | 'ok' | 'unsupported' | 'error';
  summary: {
    element_count: number;
    formula_count: number;
    output_targets: string[];
    overwrite_candidates: string[];
  };
  normalized_elements: InspectPricingWaterfallWaterfallElement[];
  raw_payload: CorePricingJsonObject | null;
};

export type InspectPricingWaterfallCorrelation = {
  pricing_process_execution: InspectPricingWaterfallCorrelationQuery<Record<string, JsonValue>>;
  pricing_line_execution: InspectPricingWaterfallCorrelationQuery<Record<string, JsonValue>>;
  pricing_process_family: InspectPricingWaterfallProcessFamily;
  pricing_api_execution: {
    query_status: 'not_requested' | 'ok' | 'unsupported' | 'error';
    execution_key: string | null;
    record_count: number;
    records: Record<string, JsonValue>[];
  };
  api_execution_log: InspectPricingApiExecutionLog;
  shared_execution_key: string | null;
  execution_types_present: string[];
  line_membership_confirmed: boolean | null;
};

export type InspectPricingWaterfallResult = {
  selector_resolution: InspectPricingWaterfallSelectorResolution;
  persisted_anchor: InspectPricingWaterfallPersistedAnchor | null;
  correlation: InspectPricingWaterfallCorrelation;
  waterfall: InspectPricingWaterfallWaterfall;
  recommended_next_commands: string[];
};

export type InspectPricingWaterfallPrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'partial' | 'no_match' | 'unsupported' | 'error'>;
  result: InspectPricingWaterfallResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
};

export type InspectPricingWaterfallDependencies = SnapshotLinesDependencyBundle
  & PricingProcessExecutionByExecutionTypeKeyDependencies
  & PricingProcessExecutionFamilyDependencies
  & PricingProcessExecutionRecordsByExecutionKeyDependencies
  & PricingApiExecutionFamilyDependencies
  & ApiExecutionLogDependencies
  & WaterfallDependencies
  & CorePricingFetchOverrides;

type SnapshotLinesDependencyBundle = {
  executeSnapshotLines?: (input: ExecuteSnapshotLinesInput) => Promise<SnapshotLinesPrimitiveResult>;
};

export type CorePricingFetchOverrides = {
  fetchPricingProcessExecutionRecordsByExecutionKey?: (input: {
    orgAlias: string;
    executionKey: string;
    timeoutMs?: number;
  }) => Promise<CorePricingResult<readonly PricingProcessExecutionRecord[]>>;
  fetchCorePricingApiExecutionLog?: (input: {
    orgAlias: string;
    apiExecutionTypeKey: string;
    timeoutMs?: number;
  }) => Promise<CorePricingResult<JsonValue>>;
};

export type ExecuteInspectPricingWaterfallInput = InspectPricingWaterfallDependencies & {
  orgAlias: string;
  quoteId: string;
  lineIds: string[];
  timeoutMs?: number;
};

export async function executeInspectPricingWaterfall(
  input: ExecuteInspectPricingWaterfallInput
): Promise<InspectPricingWaterfallPrimitiveResult> {
  const normalizedLineIds = dedupeLineIds(input.lineIds);
  const requestedLineId = normalizedLineIds[0] ?? null;
  const baseResult = buildBaseResult(input.quoteId, requestedLineId);

  if (normalizedLineIds.length !== 1 || requestedLineId === null) {
    return {
      status: 'error',
      result: baseResult,
      warnings: [],
      errors: ['inspect-pricing-waterfall requires exactly one unique line id.'],
      evidence: []
    };
  }

  const runSnapshotLines = input.executeSnapshotLines ?? executeSnapshotLines;
  const lineSnapshot = await runSnapshotLines({
    orgAlias: input.orgAlias,
    quoteId: input.quoteId,
    lineIds: [requestedLineId],
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  const lineRecord = lineSnapshot.result.lines[0] ?? null;
  const persistedAnchor = lineRecord ? buildPersistedAnchor(lineRecord) : null;
  const selectorResolution: InspectPricingWaterfallSelectorResolution = {
    ...baseResult.selector_resolution,
    resolved_line_id: typeof lineRecord?.Id === 'string' ? lineRecord.Id : null,
    price_waterfall_identifier:
      typeof lineRecord?.PriceWaterfallIdentifier === 'string' ? lineRecord.PriceWaterfallIdentifier : null,
    pricing_execution_id: null
  };

  if (lineRecord === null) {
    return {
      status: 'no_match',
      result: {
        ...baseResult,
        selector_resolution: {
          ...selectorResolution,
          resolved_line_id: null
        },
        recommended_next_commands: ['snapshot-lines', 'doctor']
      },
      warnings: lineSnapshot.warnings,
      errors: [],
      evidence: lineSnapshot.evidence
    };
  }

  const parsedIdentifier = parsePriceWaterfallIdentifier(lineRecord.PriceWaterfallIdentifier);
  if (parsedIdentifier.kind === 'missing') {
    return {
      status: 'partial',
      result: {
        ...baseResult,
        selector_resolution: selectorResolution,
        persisted_anchor: persistedAnchor,
        recommended_next_commands: ['compare-quote-pricing', 'test-pricing-change']
      },
      warnings: [
        ...lineSnapshot.warnings,
        `Persisted line '${requestedLineId}' does not currently expose PriceWaterfallIdentifier.`
      ],
      errors: [],
      evidence: buildEvidence(lineSnapshot, requestedLineId, input.quoteId, 'missing_identifier')
    };
  }

  if (parsedIdentifier.kind === 'malformed') {
    selectorResolution.price_waterfall_identifier = parsedIdentifier.raw;

    return {
      status: 'error',
      result: {
        ...baseResult,
        selector_resolution: selectorResolution,
        persisted_anchor: persistedAnchor,
        recommended_next_commands: ['snapshot-lines']
      },
      warnings: lineSnapshot.warnings,
      errors: [
        `PriceWaterfallIdentifier '${parsedIdentifier.raw}' did not match the expected <lineItemId>:<pricingExecutionId> format.`
      ],
      evidence: buildEvidence(lineSnapshot, requestedLineId, input.quoteId, 'malformed_identifier')
    };
  }

  selectorResolution.price_waterfall_identifier = parsedIdentifier.raw;
  selectorResolution.waterfall_line_item_id = parsedIdentifier.lineItemId;
  selectorResolution.pricing_execution_id = parsedIdentifier.pricingExecutionId;

  if (parsedIdentifier.lineItemId !== requestedLineId && isSalesforceQuoteLineId(parsedIdentifier.lineItemId)) {
    return {
      status: 'error',
      result: {
        ...baseResult,
        selector_resolution: selectorResolution,
        persisted_anchor: persistedAnchor,
        recommended_next_commands: ['snapshot-lines']
      },
      warnings: lineSnapshot.warnings,
      errors: [
        `PriceWaterfallIdentifier line id '${parsedIdentifier.lineItemId}' did not match requested line id '${requestedLineId}'.`
      ],
      evidence: buildEvidence(lineSnapshot, requestedLineId, input.quoteId, 'identifier_mismatch')
    };
  }

  const waterfallLineItemId = parsedIdentifier.lineItemId;
  const identifierWarnings = parsedIdentifier.lineItemId === requestedLineId
    ? []
    : [`PriceWaterfallIdentifier line token '${parsedIdentifier.lineItemId}' does not match requested Salesforce line id '${requestedLineId}'; treating it as a PST graph line reference for pricing waterfall lookup.`];
  const pricingExecutionQuery = await fetchPricingProcessExecutionByExecutionTypeKey({
    orgAlias: input.orgAlias,
    executionTypeKey: parsedIdentifier.pricingExecutionId,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.invokeSfJson ? { invokeSfJson: input.invokeSfJson } : {})
  });
  const pricingLineExecutionTypeKey = buildPricingLineExecutionTypeKey(parsedIdentifier.pricingExecutionId, waterfallLineItemId);
  const pricingLineQuery = await fetchPricingProcessExecutionByExecutionTypeKey({
    orgAlias: input.orgAlias,
    executionTypeKey: pricingLineExecutionTypeKey,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.invokeSfJson ? { invokeSfJson: input.invokeSfJson } : {})
  });

  const sharedExecutionKey = pickSharedExecutionKey(pricingLineQuery, pricingExecutionQuery);

  const processFamilyResult = sharedExecutionKey === null
    ? buildNotRequestedProcessFamily()
    : await fetchPricingProcessExecutionFamilyByExecutionKey({
        orgAlias: input.orgAlias,
        executionKey: sharedExecutionKey,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(input.invokeSfRestGet ? { invokeSfRestGet: input.invokeSfRestGet } : {})
      });

  const apiExecutionResult = sharedExecutionKey === null
    ? buildNotRequestedApiExecutionFamily()
    : await fetchPricingApiExecutionFamilyByExecutionKey({
        orgAlias: input.orgAlias,
        executionKey: sharedExecutionKey,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(input.invokeSfJson ? { invokeSfJson: input.invokeSfJson } : {})
      });

  const runFetchProcessExecutionRecords =
    input.fetchPricingProcessExecutionRecordsByExecutionKey ?? fetchPricingProcessExecutionRecordsByExecutionKey;
  const runFetchApiExecutionLog = input.fetchCorePricingApiExecutionLog ?? fetchCorePricingApiExecutionLog;
  const processExecutionRecordsResult = sharedExecutionKey === null
    ? null
    : await runFetchProcessExecutionRecords({
        orgAlias: input.orgAlias,
        executionKey: sharedExecutionKey,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(input.invokeSfJson ? { invokeSfJson: input.invokeSfJson } : {})
      });
  const apiExecutionTypeKey = pickLatestApiExecutionTypeKey(processExecutionRecordsResult);
  const apiExecutionLogResult = apiExecutionTypeKey === null
    ? null
    : await runFetchApiExecutionLog({
        orgAlias: input.orgAlias,
        apiExecutionTypeKey,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(input.invokeSfRestGet ? { invokeSfRestGet: input.invokeSfRestGet } : {})
      });

  const waterfallResult = await fetchCorePricingWaterfall({
    orgAlias: input.orgAlias,
    lineId: waterfallLineItemId,
    pricingExecutionId: parsedIdentifier.pricingExecutionId,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.invokeSfRestGet ? { invokeSfRestGet: input.invokeSfRestGet } : {})
  });

  const correlation = buildCorrelation(
    pricingExecutionQuery,
    pricingLineQuery,
    sharedExecutionKey,
    processFamilyResult,
    apiExecutionResult,
    apiExecutionTypeKey,
    apiExecutionLogResult,
    waterfallLineItemId
  );
  const waterfall = buildWaterfall(waterfallResult);

  if (waterfall.fetch_status !== 'ok') {
    return {
      status: mapCorePricingFailureStatus(waterfallResult.ok === false ? waterfallResult : null),
      result: {
        selector_resolution: selectorResolution,
        persisted_anchor: persistedAnchor,
        correlation,
        waterfall,
        recommended_next_commands: ['snapshot-lines', 'doctor']
      },
      warnings: [...lineSnapshot.warnings, ...identifierWarnings],
      errors: collectFailureMessages(pricingExecutionQuery, pricingLineQuery, processFamilyResult, apiExecutionResult, processExecutionRecordsResult, apiExecutionLogResult, waterfallResult),
      evidence: buildEvidence(lineSnapshot, requestedLineId, input.quoteId, 'waterfall_failed')
    };
  }

  const correlationComplete = isCorrelationComplete(correlation);
  return {
    status: correlationComplete ? 'ok' : 'partial',
    result: {
      selector_resolution: selectorResolution,
      persisted_anchor: persistedAnchor,
      correlation,
      waterfall,
      recommended_next_commands: ['inspect-rlm-context']
    },
    warnings: [
      ...lineSnapshot.warnings,
      ...identifierWarnings,
      ...buildCorrelationWarnings(correlation, requestedLineId, waterfallLineItemId)
    ],
    errors: [],
    evidence: buildEvidence(lineSnapshot, requestedLineId, input.quoteId, correlationComplete ? 'waterfall_ok' : 'waterfall_ok_partial')
  };
}

export function parsePriceWaterfallIdentifier(
  value: JsonValue
):
  | { kind: 'missing' }
  | { kind: 'malformed'; raw: string }
  | { kind: 'parsed'; raw: string; lineItemId: string; pricingExecutionId: string } {
  if (typeof value !== 'string' || value.trim() === '') {
    return { kind: 'missing' };
  }

  const raw = value.trim();
  const firstSeparatorIndex = raw.indexOf(':');
  const lastSeparatorIndex = raw.lastIndexOf(':');
  if (firstSeparatorIndex <= 0 || firstSeparatorIndex !== lastSeparatorIndex || firstSeparatorIndex === raw.length - 1) {
    return { kind: 'malformed', raw };
  }

  const lineItemId = raw.slice(0, firstSeparatorIndex).trim();
  const pricingExecutionId = raw.slice(firstSeparatorIndex + 1).trim();
  if (lineItemId === '' || pricingExecutionId === '') {
    return { kind: 'malformed', raw };
  }

  return {
    kind: 'parsed',
    raw,
    lineItemId,
    pricingExecutionId
  };
}

export function mapCorePricingFailureStatus(
  failure: CorePricingFailure | null
): Extract<RuntimeStatus, 'unsupported' | 'error'> {
  if (failure === null) {
    return 'error';
  }

  switch (failure.classification) {
    case 'auth':
    case 'unavailable':
    case 'internal_cli_error':
      return 'unsupported';
    case 'timeout':
    case 'max_buffer':
    case 'non_json_error':
    case 'cli_error':
    case 'malformed_payload':
      return 'error';
  }
}

function buildBaseResult(quoteId: string, requestedLineId: string | null): InspectPricingWaterfallResult {
  return {
    selector_resolution: {
      quote_id: quoteId,
      requested_line_id: requestedLineId ?? '',
      resolved_line_id: null,
      price_waterfall_identifier: null,
      waterfall_line_item_id: null,
      pricing_execution_id: null,
      resolution_mode: 'persisted_price_waterfall_identifier'
    },
    persisted_anchor: null,
    correlation: {
      pricing_process_execution: buildEmptyCorrelationQuery(null),
      pricing_line_execution: buildEmptyCorrelationQuery(null),
      pricing_process_family: buildNotRequestedProcessFamily(),
      pricing_api_execution: {
        query_status: 'not_requested',
        execution_key: null,
        record_count: 0,
        records: []
      },
      api_execution_log: buildNotRequestedApiExecutionLog(),
      shared_execution_key: null,
      execution_types_present: [],
      line_membership_confirmed: null
    },
    waterfall: {
      endpoint: null,
      fetch_status: 'not_requested',
      summary: {
        element_count: 0,
        formula_count: 0,
        output_targets: [],
        overwrite_candidates: []
      },
      normalized_elements: [],
      raw_payload: null
    },
    recommended_next_commands: []
  };
}

function buildPersistedAnchor(line: SnapshotLineRecord): InspectPricingWaterfallPersistedAnchor {
  return {
    quote_id: line.QuoteId,
    line_id: line.Id,
    line_number: line.LineNumber,
    product_id: line.Product2Id,
    parent_line_id: line.ParentQuoteLineItemId,
    unit_price: line.UnitPrice,
    net_unit_price: line.NetUnitPrice,
    total_price: line.TotalPrice,
    total_line_amount: line.TotalLineAmount,
    price_waterfall_identifier: line.PriceWaterfallIdentifier,
    quote_action_id: line.QuoteActionId,
    quote_action_type: line['QuoteAction.Type'],
    quote_action_source_asset_id: line['QuoteAction.SourceAssetId'],
    created_date: line.CreatedDate,
    last_modified_date: line.LastModifiedDate
  };
}

function buildEmptyCorrelationQuery(executionTypeKey: string | null): InspectPricingWaterfallCorrelationQuery<Record<string, JsonValue>> {
  return {
    query_status: 'not_requested',
    execution_type_key: executionTypeKey,
    execution_key: null,
    record_count: 0,
    records: []
  };
}

function buildCorrelation(
  pricingExecutionQuery: CorePricingResult<readonly PricingProcessExecutionRecord[]>,
  pricingLineQuery: CorePricingResult<readonly PricingProcessExecutionRecord[]>,
  sharedExecutionKey: string | null,
  processFamilyResult: ReturnType<typeof buildNotRequestedProcessFamily> | CorePricingResult<CorePricingJsonObject>,
  apiExecutionResult:
    | ReturnType<typeof buildNotRequestedApiExecutionFamily>
    | CorePricingResult<readonly PricingApiExecutionRecord[]>,
  apiExecutionTypeKey: string | null,
  apiExecutionLogResult: CorePricingResult<JsonValue> | null,
  requestedLineId: string
): InspectPricingWaterfallCorrelation {
  const normalizedProcessFamily = normalizeProcessFamily(processFamilyResult, requestedLineId, sharedExecutionKey);
  const normalizedApiExecution = normalizeApiExecution(apiExecutionResult, sharedExecutionKey);

  return {
    pricing_process_execution: normalizeCorrelationQuery(pricingExecutionQuery),
    pricing_line_execution: normalizeCorrelationQuery(pricingLineQuery),
    pricing_process_family: normalizedProcessFamily,
    pricing_api_execution: normalizedApiExecution,
    api_execution_log: normalizeApiExecutionLog(apiExecutionLogResult, apiExecutionTypeKey),
    shared_execution_key: sharedExecutionKey,
    execution_types_present: normalizedProcessFamily.execution_types_present,
    line_membership_confirmed: normalizedProcessFamily.line_membership_confirmed
  };
}

function normalizeCorrelationQuery(
  result: CorePricingResult<readonly PricingProcessExecutionRecord[]>
): InspectPricingWaterfallCorrelationQuery<Record<string, JsonValue>> {
  if (result.ok === false) {
    return {
      query_status: mapCorePricingFailureStatus(result),
      execution_type_key: null,
      execution_key: null,
      record_count: 0,
      records: []
    };
  }

  const latestRecord = result.data[result.data.length - 1] ?? null;
  return {
    query_status: 'ok',
    execution_type_key: latestRecord?.ExecutionTypeKey ?? null,
    execution_key: latestRecord?.ExecutionKey ?? null,
    record_count: result.data.length,
    records: result.data.map(recordToJson)
  };
}

function buildNotRequestedProcessFamily(): InspectPricingWaterfallProcessFamily {
  return {
    fetch_status: 'not_requested',
    path: null,
    execution_key: null,
    execution_types_present: [],
    line_membership_confirmed: null,
    raw_payload: null
  };
}

function buildNotRequestedApiExecutionFamily() {
  return {
    ok: true as const,
    classification: 'ok' as const,
    source: 'soql' as const,
    data: [] as readonly PricingApiExecutionRecord[]
  };
}

function buildNotRequestedApiExecutionLog(): InspectPricingApiExecutionLog {
  return {
    fetch_status: 'not_requested',
    endpoint: null,
    api_execution_type_key: null,
    raw_payload: null
  };
}

function normalizeApiExecutionLog(
  result: CorePricingResult<JsonValue> | null,
  apiExecutionTypeKey: string | null
): InspectPricingApiExecutionLog {
  if (result === null) {
    return buildNotRequestedApiExecutionLog();
  }
  if (result.ok === false) {
    return {
      fetch_status: mapCorePricingFailureStatus(result),
      endpoint: result.path ?? null,
      api_execution_type_key: apiExecutionTypeKey,
      raw_payload: null
    };
  }
  return {
    fetch_status: 'ok',
    endpoint: result.path ?? null,
    api_execution_type_key: apiExecutionTypeKey,
    raw_payload: result.data
  };
}

function normalizeProcessFamily(
  result: ReturnType<typeof buildNotRequestedProcessFamily> | CorePricingResult<CorePricingJsonObject>,
  requestedLineId: string,
  sharedExecutionKey: string | null
): InspectPricingWaterfallProcessFamily {
  if ('fetch_status' in result) {
    return result;
  }

  if (result.ok === false) {
    return {
      fetch_status: mapCorePricingFailureStatus(result),
      path: result.path ?? null,
      execution_key: sharedExecutionKey,
      execution_types_present: [],
      line_membership_confirmed: null,
      raw_payload: null
    };
  }

  const executionTypesPresent = extractStringArray(result.data, ['executionTypes', 'execution_types']);
  return {
    fetch_status: 'ok',
    path: result.path ?? null,
    execution_key: sharedExecutionKey,
    execution_types_present: executionTypesPresent,
    line_membership_confirmed: extractLineMembership(result.data, requestedLineId),
    raw_payload: result.data
  };
}

function normalizeApiExecution(
  result: ReturnType<typeof buildNotRequestedApiExecutionFamily> | CorePricingResult<readonly PricingApiExecutionRecord[]>,
  sharedExecutionKey: string | null
): InspectPricingWaterfallCorrelation['pricing_api_execution'] {
  if (result.ok === false) {
    return {
      query_status: mapCorePricingFailureStatus(result),
      execution_key: sharedExecutionKey,
      record_count: 0,
      records: []
    };
  }

  return {
    query_status: sharedExecutionKey === null ? 'not_requested' : 'ok',
    execution_key: sharedExecutionKey,
    record_count: result.data.length,
    records: result.data.map(recordToJson)
  };
}

function buildWaterfall(result: CorePricingResult<CorePricingJsonObject>): InspectPricingWaterfallWaterfall {
  if (result.ok === false) {
    return {
      endpoint: result.path ?? null,
      fetch_status: mapCorePricingFailureStatus(result),
      summary: {
        element_count: 0,
        formula_count: 0,
        output_targets: [],
        overwrite_candidates: []
      },
      normalized_elements: [],
      raw_payload: null
    };
  }

  const normalizedElements = normalizeWaterfallElements(result.data);
  const allOutputTargets = normalizedElements.flatMap((element) =>
    element.writes.length > 0 ? element.writes : extractTargetsFromValues(element.outputs)
  );
  const outputTargets = Array.from(new Set(allOutputTargets));
  const overwriteCandidates = Array.from(
    new Set(allOutputTargets.filter((target, index) => allOutputTargets.indexOf(target) !== index))
  );

  return {
    endpoint: result.path ?? null,
    fetch_status: 'ok',
    summary: {
      element_count: normalizedElements.length,
      formula_count: normalizedElements.filter((element) => element.calculation_formula !== null).length,
      output_targets: outputTargets,
      overwrite_candidates: overwriteCandidates
    },
    normalized_elements: normalizedElements,
    raw_payload: result.data
  };
}

function normalizeWaterfallElements(payload: CorePricingJsonObject): InspectPricingWaterfallWaterfallElement[] {
  const candidates = ['waterfallElements', 'waterfall', 'elements'];
  const rawElements = candidates
    .map((key) => payload[key])
    .find((value): value is JsonValue[] => Array.isArray(value));

  if (!Array.isArray(rawElements)) {
    return [];
  }

  return rawElements.flatMap((entry, index) => {
    if (!isJsonRecord(entry)) {
      return [];
    }

    const filterRules = normalizeParameterCollection(entry.filterRules ?? entry.filter_rules ?? entry.filters);
    const inputs = normalizeParameterCollection(entry.inputParameters ?? entry.input_parameters ?? entry.inputs);
    const outputs = normalizeParameterCollection(entry.outputParameters ?? entry.output_parameters ?? entry.outputs);
    const writes = Array.from(new Set([
      ...extractTargetsFromValues(outputs),
      ...extractTargetsFromValues(normalizeParameterCollection(entry.writes))
    ]));
    const pricingElement = isJsonRecord(entry.pricingElement) ? entry.pricingElement : null;

    return [{
      sequence: typeof entry.sequence === 'number'
        ? entry.sequence
        : typeof entry.order === 'number'
          ? entry.order
          : index + 1,
      name: typeof entry.name === 'string'
        ? entry.name
        : typeof entry.elementName === 'string'
          ? entry.elementName
          : pricingElement && typeof pricingElement.name === 'string'
            ? pricingElement.name
            : null,
      filter_rules: filterRules,
      inputs,
      outputs,
      calculation_formula: extractCalculationFormula(entry),
      writes
    } satisfies InspectPricingWaterfallWaterfallElement];
  });
}

function extractCalculationFormula(entry: { [key: string]: JsonValue }): string | null {
  if (typeof entry.calculationFormula === 'string') {
    return entry.calculationFormula;
  }
  if (typeof entry.calculation_formula === 'string') {
    return entry.calculation_formula;
  }

  const inputParameters = isJsonRecord(entry.inputParameters)
    ? entry.inputParameters
    : isJsonRecord(entry.input_parameters)
      ? entry.input_parameters
      : null;
  if (inputParameters) {
    for (const [key, value] of Object.entries(inputParameters)) {
      if (typeof value === 'string' && key.toLowerCase().includes('formula')) {
        return value;
      }
    }
  }

  return null;
}

function extractTargetsFromValues(values: JsonValue[]): string[] {
  return values.flatMap((entry) => {
    if (typeof entry === 'string') {
      return [entry];
    }
    if (!isJsonRecord(entry)) {
      return [];
    }

    const target = entry.target ?? entry.name ?? entry.fieldName ?? entry.field;
    return typeof target === 'string' ? [target] : [];
  });
}

function normalizeParameterCollection(value: JsonValue | undefined): JsonValue[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || !isJsonRecord(value)) {
    return [];
  }

  return Object.entries(value).map(([key, entryValue]) => ({ target: key, value: entryValue }));
}

function extractStringArray(payload: CorePricingJsonObject, keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = payload[key];
    if (!Array.isArray(value)) {
      continue;
    }

    const strings = value.filter((entry): entry is string => typeof entry === 'string');
    if (strings.length > 0 || value.length === 0) {
      return strings;
    }
  }

  return [];
}

function extractLineMembership(payload: CorePricingJsonObject, requestedLineId: string): boolean | null {
  const rawLineItems = payload.lineItems ?? payload.line_items;
  if (!Array.isArray(rawLineItems)) {
    return null;
  }

  for (const entry of rawLineItems) {
    if (!isJsonRecord(entry)) {
      continue;
    }

    const candidateLineId = entry.lineItemId ?? entry.lineId ?? entry.id;
    if (candidateLineId === requestedLineId) {
      return true;
    }
  }

  return false;
}

function buildCorrelationWarnings(correlation: InspectPricingWaterfallCorrelation, requestedLineId: string, waterfallLineItemId: string): string[] {
  const warnings: string[] = [];
  const lineLabel = waterfallLineItemId === requestedLineId
    ? requestedLineId
    : `${requestedLineId} (waterfall token ${waterfallLineItemId})`;

  if (correlation.shared_execution_key === null) {
    warnings.push(`Could not derive a shared execution key for line '${lineLabel}' from PricingProcessExecution correlation.`);
  }
  if (correlation.pricing_process_family.fetch_status !== 'ok') {
    warnings.push(`Pricing process family correlation was incomplete for line '${lineLabel}'.`);
  }
  if (correlation.pricing_api_execution.query_status !== 'ok') {
    warnings.push(`Pricing API execution correlation was incomplete for line '${lineLabel}'.`);
  }
  if (correlation.api_execution_log.fetch_status === 'unsupported' || correlation.api_execution_log.fetch_status === 'error') {
    warnings.push(`Pricing API execution log retrieval was incomplete for line '${lineLabel}'.`);
  }
  if (correlation.line_membership_confirmed === false) {
    warnings.push(`Pricing process family did not confirm line '${lineLabel}' as a participating line item.`);
  }

  return dedupeStrings(warnings);
}

function isSalesforceQuoteLineId(value: string): boolean {
  return /^0QL[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(value);
}

// The api-execution-log surface can legitimately be absent or empty even when pricing
// succeeded, so it is supplementary evidence and never gates correlation completeness.
function isCorrelationComplete(correlation: InspectPricingWaterfallCorrelation): boolean {
  return correlation.shared_execution_key !== null
    && correlation.pricing_process_execution.query_status === 'ok'
    && correlation.pricing_line_execution.query_status === 'ok'
    && correlation.pricing_process_family.fetch_status === 'ok'
    && correlation.pricing_api_execution.query_status === 'ok'
    && correlation.line_membership_confirmed !== false;
}

function pickLatestApiExecutionTypeKey(
  result: CorePricingResult<readonly PricingProcessExecutionRecord[]> | null
): string | null {
  if (result === null || result.ok === false) {
    return null;
  }

  for (let index = result.data.length - 1; index >= 0; index -= 1) {
    const record = result.data[index];
    if (record?.ExecutionType === 'Api_Execution' && record.ExecutionTypeKey) {
      return record.ExecutionTypeKey;
    }
  }
  return null;
}

function pickSharedExecutionKey(
  pricingLineQuery: CorePricingResult<readonly PricingProcessExecutionRecord[]>,
  pricingExecutionQuery: CorePricingResult<readonly PricingProcessExecutionRecord[]>
): string | null {
  const lineExecutionKey = pickLatestExecutionKey(pricingLineQuery);
  if (lineExecutionKey !== null) {
    return lineExecutionKey;
  }

  return pickLatestExecutionKey(pricingExecutionQuery);
}

function pickLatestExecutionKey(result: CorePricingResult<readonly PricingProcessExecutionRecord[]>): string | null {
  if (result.ok === false || result.data.length === 0) {
    return null;
  }

  return result.data[result.data.length - 1]?.ExecutionKey ?? null;
}

function collectFailureMessages(...results: Array<unknown>): string[] {
  return dedupeStrings(results.flatMap((result) => {
    if (!result || typeof result !== 'object' || !('ok' in result) || (result as { ok: boolean }).ok !== false) {
      return [];
    }

    const message = (result as { message?: unknown }).message;
    return typeof message === 'string' ? [message] : [];
  }));
}

function buildEvidence(
  lineSnapshot: SnapshotLinesPrimitiveResult,
  requestedLineId: string,
  quoteId: string,
  outcome: 'missing_identifier' | 'malformed_identifier' | 'identifier_mismatch' | 'waterfall_failed' | 'waterfall_ok' | 'waterfall_ok_partial'
): EvidenceItem[] {
  const claims: Record<typeof outcome, string> = {
    missing_identifier: `Persisted line '${requestedLineId}' resolved on quote '${quoteId}', but PriceWaterfallIdentifier was blank or null.`,
    malformed_identifier: `Persisted line '${requestedLineId}' resolved on quote '${quoteId}', but PriceWaterfallIdentifier was malformed and could not be parsed into <lineItemId>:<pricingExecutionId>.`,
    identifier_mismatch: `Persisted line '${requestedLineId}' resolved on quote '${quoteId}', but PriceWaterfallIdentifier pointed at a different line id.`,
    waterfall_failed: `Persisted line '${requestedLineId}' resolved on quote '${quoteId}' and target waterfall lookup was attempted from PriceWaterfallIdentifier.`,
    waterfall_ok: `Persisted line '${requestedLineId}' resolved on quote '${quoteId}' and the core-pricing waterfall payload was fetched successfully.`,
    waterfall_ok_partial: `Persisted line '${requestedLineId}' resolved on quote '${quoteId}' and the core-pricing waterfall payload was fetched successfully, but correlation evidence stayed incomplete.`
  };

  return [
    ...lineSnapshot.evidence,
    {
      claim: claims[outcome],
      evidence_level: 'org_proven',
      proof_source: ['QuoteLineItem.PriceWaterfallIdentifier', 'PricingProcessExecution', 'PricingApiExecution', 'core-pricing waterfall'],
      limitations: 'Correlation objects are supportive evidence; the waterfall payload is the richer causal runtime surface.',
      source_refs: []
    }
  ];
}

function recordToJson(record: Record<string, string | null>): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(record)) as Record<string, JsonValue>;
}

function arrayOrEmpty(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function isJsonRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}
