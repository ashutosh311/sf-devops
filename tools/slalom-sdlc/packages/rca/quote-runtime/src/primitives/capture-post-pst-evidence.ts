import type { EvidenceItem } from '../contracts/evidence';
import type { JsonValue } from '../contracts/result-envelope';
import type { RuntimeStatus } from '../contracts/status';
import {
  fetchCorePricingApiExecutionLog,
  fetchPricingProcessExecutionRecordsByExecutionKey,
  type CorePricingResult,
  type PricingProcessExecutionRecord
} from '../integrations/salesforce/core-pricing';
import {
  fetchQuoteLineDetailByLineId,
  fetchQuoteLinePriceAdjustmentsByLineId,
  fetchQuoteLineRateAdjustmentsByRateCardEntryIds,
  fetchQuoteLineRateCardEntriesByLineId,
  fetchQuoteLineUsageResourceGrantsByLineId,
  fetchQuoteLineUsageResourcePoliciesByLineId,
  type QuoteLineArtifactResult,
  type QuoteLineDetailRecord,
  type QuoteLinePriceAdjustmentRecord,
  type QuoteLineRateAdjustmentRecord,
  type QuoteLineRateCardEntryRecord,
  type QuoteLineUsageResourceGrantRecord,
  type QuoteLineUsageResourcePolicyRecord
} from '../integrations/salesforce/quote-line-artifacts';
import {
  executeInspectPricingWaterfall,
  parsePriceWaterfallIdentifier,
  type ExecuteInspectPricingWaterfallInput,
  type InspectPricingWaterfallPrimitiveResult,
  type InspectPricingWaterfallWaterfall
} from './inspect-pricing-waterfall';
import {
  dedupeLineIds,
  executeSnapshotLines,
  type ExecuteSnapshotLinesInput,
  type SnapshotLineRecord,
  type SnapshotLinesPrimitiveResult
} from './snapshot-lines';
import {
  executeSnapshotQuote,
  type ExecuteSnapshotQuoteInput,
  type SnapshotQuotePrimitiveResult,
  type SnapshotQuoteRecord
} from './snapshot-quote';

export type CapturePostPstArtifactStatus = 'not_requested' | 'unsupported' | 'ok' | 'not_found';

export type CapturePostPstTraceAnchor = {
  price_waterfall_identifier: string;
  waterfall_line_item_id: string | null;
  pricing_execution_id: string | null;
  shared_execution_key: string | null;
};

export type CapturePostPstExecutionCorrelation = {
  pricing_process_execution: Record<string, JsonValue> | null;
  pricing_api_execution: Record<string, JsonValue> | null;
  api_execution_log: JsonValue;
  correlation_status: Extract<RuntimeStatus, 'ok' | 'partial' | 'unsupported' | 'error'>;
};

export type CapturePostPstArtifactStatuses = {
  line_detail: CapturePostPstArtifactStatus;
  price_adjustments: CapturePostPstArtifactStatus;
  rate_card_entries: CapturePostPstArtifactStatus;
  rate_adjustments: CapturePostPstArtifactStatus;
  usage_grants: CapturePostPstArtifactStatus;
  usage_policies: CapturePostPstArtifactStatus;
};

export type CapturePostPstLineEvidencePacket = {
  requested_line_id: string;
  resolved_line_id: string | null;
  capture_status: Extract<RuntimeStatus, 'ok' | 'partial' | 'no_match' | 'unsupported' | 'error'>;
  line_snapshot: SnapshotLineRecord | null;
  trace_anchor: CapturePostPstTraceAnchor | null;
  execution_correlation: CapturePostPstExecutionCorrelation | null;
  waterfall: InspectPricingWaterfallWaterfall | null;
  artifact_statuses: CapturePostPstArtifactStatuses;
  warnings: string[];
};

export type CapturePostPstOptionalArtifacts = {
  line_details: JsonValue[];
  price_adjustments: JsonValue[];
  rate_card_entries: JsonValue[];
  rate_adjustments: JsonValue[];
  usage_grants: JsonValue[];
  usage_policies: JsonValue[];
};

export type CapturePostPstCounts = {
  requested_lines: number;
  resolved_line_snapshots: number;
  packets_total: number;
  ok_packets: number;
  partial_packets: number;
  no_match_packets: number;
  unsupported_packets: number;
  error_packets: number;
  line_details_returned: number;
  price_adjustments_returned: number;
  rate_card_entries_returned: number;
  rate_adjustments_returned: number;
  usage_grants_returned: number;
  usage_policies_returned: number;
};

export type CapturePostPstEvidenceResult = {
  quote_snapshot: SnapshotQuoteRecord | null;
  line_snapshots: SnapshotLineRecord[];
  line_evidence_packets: CapturePostPstLineEvidencePacket[];
  optional_artifacts: CapturePostPstOptionalArtifacts;
  counts: CapturePostPstCounts;
  recommended_next_commands: string[];
};

export type CapturePostPstEvidencePrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'partial' | 'no_match' | 'unsupported' | 'error'>;
  result: CapturePostPstEvidenceResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
};

export type ExecuteCapturePostPstEvidenceInput = {
  orgAlias: string;
  quoteId: string;
  lineIds: string[];
  allLines?: boolean;
  includeAdjustments?: boolean;
  includeLineDetail?: boolean;
  includeUsageRating?: boolean;
  timeoutMs?: number;
  executeSnapshotQuote?: (input: ExecuteSnapshotQuoteInput) => Promise<SnapshotQuotePrimitiveResult>;
  executeSnapshotLines?: (input: ExecuteSnapshotLinesInput) => Promise<SnapshotLinesPrimitiveResult>;
  executeInspectPricingWaterfall?: (
    input: ExecuteInspectPricingWaterfallInput
  ) => Promise<InspectPricingWaterfallPrimitiveResult>;
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
  fetchQuoteLineDetailByLineId?: (input: {
    orgAlias: string;
    lineId: string;
    timeoutMs?: number;
  }) => Promise<QuoteLineArtifactResult<QuoteLineDetailRecord>>;
  fetchQuoteLinePriceAdjustmentsByLineId?: (input: {
    orgAlias: string;
    lineId: string;
    timeoutMs?: number;
  }) => Promise<QuoteLineArtifactResult<QuoteLinePriceAdjustmentRecord>>;
  fetchQuoteLineRateCardEntriesByLineId?: (input: {
    orgAlias: string;
    lineId: string;
    timeoutMs?: number;
  }) => Promise<QuoteLineArtifactResult<QuoteLineRateCardEntryRecord>>;
  fetchQuoteLineRateAdjustmentsByRateCardEntryIds?: (input: {
    orgAlias: string;
    quoteLineRateCardEntryIds: readonly string[];
    timeoutMs?: number;
  }) => Promise<QuoteLineArtifactResult<QuoteLineRateAdjustmentRecord>>;
  fetchQuoteLineUsageResourceGrantsByLineId?: (input: {
    orgAlias: string;
    lineId: string;
    timeoutMs?: number;
  }) => Promise<QuoteLineArtifactResult<QuoteLineUsageResourceGrantRecord>>;
  fetchQuoteLineUsageResourcePoliciesByLineId?: (input: {
    orgAlias: string;
    lineId: string;
    timeoutMs?: number;
  }) => Promise<QuoteLineArtifactResult<QuoteLineUsageResourcePolicyRecord>>;
};

export async function executeCapturePostPstEvidence(
  input: ExecuteCapturePostPstEvidenceInput
): Promise<CapturePostPstEvidencePrimitiveResult> {
  let requestedLineIds = dedupeLineIds(input.lineIds);
  const baseResult = buildBaseResult(requestedLineIds);

  if (requestedLineIds.length === 0 && !input.allLines) {
    return {
      status: 'error',
      result: baseResult,
      warnings: [],
      errors: ['capture-post-pst-evidence requires at least one unique line id.'],
      evidence: []
    };
  }

  const runSnapshotQuote = input.executeSnapshotQuote ?? executeSnapshotQuote;
  const quoteSnapshot = await runSnapshotQuote({
    orgAlias: input.orgAlias,
    quoteId: input.quoteId,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (quoteSnapshot.status !== 'ok' || quoteSnapshot.result.quote === null) {
    return {
      status: quoteSnapshot.status === 'unsupported' ? 'unsupported' : 'error',
      result: {
        ...baseResult,
        recommended_next_commands: ['snapshot-quote', 'doctor']
      },
      warnings: [...quoteSnapshot.warnings],
      errors: quoteSnapshot.status === 'no_match'
        ? [`No persisted Quote row matched '${input.quoteId}'.`]
        : [...quoteSnapshot.errors],
      evidence: [...quoteSnapshot.evidence]
    };
  }

  const runSnapshotLines = input.executeSnapshotLines ?? executeSnapshotLines;
  const lineSnapshot = await runSnapshotLines({
    orgAlias: input.orgAlias,
    quoteId: input.quoteId,
    lineIds: input.allLines ? [] : requestedLineIds,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if ((lineSnapshot.status === 'unsupported' || lineSnapshot.status === 'error') && lineSnapshot.result.lines.length === 0) {
    return {
      status: lineSnapshot.status,
      result: {
        ...baseResult,
        quote_snapshot: quoteSnapshot.result.quote,
        recommended_next_commands: ['snapshot-lines', 'doctor']
      },
      warnings: [...quoteSnapshot.warnings, ...lineSnapshot.warnings],
      errors: [...quoteSnapshot.errors, ...lineSnapshot.errors],
      evidence: [...quoteSnapshot.evidence, ...lineSnapshot.evidence]
    };
  }

  if (input.allLines) {
    requestedLineIds = dedupeLineIds(lineSnapshot.result.lines.flatMap((line) =>
      typeof line.Id === 'string' ? [line.Id] : []
    ));
  }

  if (requestedLineIds.length === 0) {
    return {
      status: 'no_match',
      result: {
        ...buildBaseResult([]),
        quote_snapshot: quoteSnapshot.result.quote,
        recommended_next_commands: ['snapshot-lines']
      },
      warnings: [...quoteSnapshot.warnings, ...lineSnapshot.warnings],
      errors: [...quoteSnapshot.errors, ...lineSnapshot.errors],
      evidence: [...quoteSnapshot.evidence, ...lineSnapshot.evidence]
    };
  }

  const resolvedLineIndex = new Map(lineSnapshot.result.lines.map((line) => [String(line.Id), line]));
  const lineEvidencePackets: CapturePostPstLineEvidencePacket[] = [];
  const runInspectPricingWaterfall = input.executeInspectPricingWaterfall ?? executeInspectPricingWaterfall;
  // The shared execution family and its API execution log are quote-level, so per-line
  // inspect calls would repeat identical org reads without memoization.
  const runFetchPricingProcessExecutionRecordsByExecutionKey = memoizeFetchByKey(
    input.fetchPricingProcessExecutionRecordsByExecutionKey ?? fetchPricingProcessExecutionRecordsByExecutionKey,
    (fetchInput) => fetchInput.executionKey
  );
  const runFetchCorePricingApiExecutionLog = memoizeFetchByKey(
    input.fetchCorePricingApiExecutionLog ?? fetchCorePricingApiExecutionLog,
    (fetchInput) => fetchInput.apiExecutionTypeKey
  );
  const runFetchQuoteLineDetailByLineId = input.fetchQuoteLineDetailByLineId ?? fetchQuoteLineDetailByLineId;
  const runFetchQuoteLinePriceAdjustmentsByLineId =
    input.fetchQuoteLinePriceAdjustmentsByLineId ?? fetchQuoteLinePriceAdjustmentsByLineId;
  const runFetchQuoteLineRateCardEntriesByLineId =
    input.fetchQuoteLineRateCardEntriesByLineId ?? fetchQuoteLineRateCardEntriesByLineId;
  const runFetchQuoteLineRateAdjustmentsByRateCardEntryIds =
    input.fetchQuoteLineRateAdjustmentsByRateCardEntryIds ?? fetchQuoteLineRateAdjustmentsByRateCardEntryIds;
  const runFetchQuoteLineUsageResourceGrantsByLineId =
    input.fetchQuoteLineUsageResourceGrantsByLineId ?? fetchQuoteLineUsageResourceGrantsByLineId;
  const runFetchQuoteLineUsageResourcePoliciesByLineId =
    input.fetchQuoteLineUsageResourcePoliciesByLineId ?? fetchQuoteLineUsageResourcePoliciesByLineId;
  const warnings = [...quoteSnapshot.warnings, ...lineSnapshot.warnings];
  const errors = [...quoteSnapshot.errors, ...lineSnapshot.errors];
  const evidence = [...quoteSnapshot.evidence, ...lineSnapshot.evidence];
  const optionalArtifacts: CapturePostPstOptionalArtifacts = {
    line_details: [],
    price_adjustments: [],
    rate_card_entries: [],
    rate_adjustments: [],
    usage_grants: [],
    usage_policies: []
  };

  for (const requestedLineId of requestedLineIds) {
    const lineSnapshotRecord = resolvedLineIndex.get(requestedLineId) ?? null;

    if (lineSnapshotRecord === null) {
      lineEvidencePackets.push({
        requested_line_id: requestedLineId,
        resolved_line_id: null,
        capture_status: 'no_match',
        line_snapshot: null,
        trace_anchor: null,
        execution_correlation: null,
        waterfall: null,
        artifact_statuses: buildMissingLineArtifactStatuses(input),
        warnings: buildMissingLineWarnings(input, requestedLineId, input.quoteId)
      });
      continue;
    }

    const inspectResult = await runInspectPricingWaterfall({
      orgAlias: input.orgAlias,
      quoteId: input.quoteId,
      lineIds: [requestedLineId],
      fetchPricingProcessExecutionRecordsByExecutionKey: runFetchPricingProcessExecutionRecordsByExecutionKey,
      fetchCorePricingApiExecutionLog: runFetchCorePricingApiExecutionLog,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    });

    warnings.push(...inspectResult.warnings);
    errors.push(...inspectResult.errors);
    evidence.push(...inspectResult.evidence);

    const artifactCapture = await collectOptionalArtifactsForLine({
      orgAlias: input.orgAlias,
      requestedLineId,
      resolvedLineId: String(lineSnapshotRecord.Id),
      includeAdjustments: input.includeAdjustments,
      includeLineDetail: input.includeLineDetail,
      includeUsageRating: input.includeUsageRating,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      fetchQuoteLineDetailByLineId: runFetchQuoteLineDetailByLineId,
      fetchQuoteLinePriceAdjustmentsByLineId: runFetchQuoteLinePriceAdjustmentsByLineId,
      fetchQuoteLineRateCardEntriesByLineId: runFetchQuoteLineRateCardEntriesByLineId,
      fetchQuoteLineRateAdjustmentsByRateCardEntryIds: runFetchQuoteLineRateAdjustmentsByRateCardEntryIds,
      fetchQuoteLineUsageResourceGrantsByLineId: runFetchQuoteLineUsageResourceGrantsByLineId,
      fetchQuoteLineUsageResourcePoliciesByLineId: runFetchQuoteLineUsageResourcePoliciesByLineId
    });
    optionalArtifacts.line_details.push(...artifactCapture.artifacts.line_details);
    optionalArtifacts.price_adjustments.push(...artifactCapture.artifacts.price_adjustments);
    optionalArtifacts.rate_card_entries.push(...artifactCapture.artifacts.rate_card_entries);
    optionalArtifacts.rate_adjustments.push(...artifactCapture.artifacts.rate_adjustments);
    optionalArtifacts.usage_grants.push(...artifactCapture.artifacts.usage_grants);
    optionalArtifacts.usage_policies.push(...artifactCapture.artifacts.usage_policies);

    const lineWarnings = [...inspectResult.warnings, ...artifactCapture.warnings];
    if (inspectResult.status === 'no_match') {
      lineWarnings.unshift(
        `Per-line waterfall capture could not re-resolve line '${requestedLineId}' after persisted snapshot resolution; treating later proof layers as incomplete.`
      );
    }

    lineEvidencePackets.push({
      requested_line_id: requestedLineId,
      resolved_line_id: inspectResult.result.selector_resolution.resolved_line_id ?? String(lineSnapshotRecord.Id),
      capture_status: mergePacketStatus(normalizePacketStatus(inspectResult), artifactCapture.statuses),
      line_snapshot: lineSnapshotRecord,
      trace_anchor: buildTraceAnchor(inspectResult),
      execution_correlation: buildExecutionCorrelation(inspectResult),
      waterfall: inspectResult.result.waterfall.fetch_status === 'not_requested' ? null : inspectResult.result.waterfall,
      artifact_statuses: artifactCapture.statuses,
      warnings: dedupeStrings(lineWarnings)
    });
  }

  const resolvedSnapshots = requestedLineIds.flatMap((lineId) => {
    const line = resolvedLineIndex.get(lineId);
    return line ? [line] : [];
  });
  const result: CapturePostPstEvidenceResult = {
    quote_snapshot: quoteSnapshot.result.quote,
    line_snapshots: resolvedSnapshots,
    line_evidence_packets: lineEvidencePackets,
    optional_artifacts: optionalArtifacts,
    counts: buildCounts(requestedLineIds.length, resolvedSnapshots.length, lineEvidencePackets, optionalArtifacts),
    recommended_next_commands: buildRecommendedNextCommands(lineEvidencePackets)
  };

  return {
    status: determineCommandStatus(lineEvidencePackets),
    result,
    warnings: dedupeStrings(warnings.concat(lineEvidencePackets.flatMap((packet) => packet.warnings))),
    errors: dedupeStrings(errors),
    evidence
  };
}

function buildBaseResult(requestedLineIds: readonly string[]): CapturePostPstEvidenceResult {
  return {
    quote_snapshot: null,
    line_snapshots: [],
    line_evidence_packets: requestedLineIds.map((lineId) => ({
      requested_line_id: lineId,
      resolved_line_id: null,
      capture_status: 'no_match' as const,
      line_snapshot: null,
      trace_anchor: null,
      execution_correlation: null,
      waterfall: null,
      artifact_statuses: {
        line_detail: 'not_requested' as const,
        price_adjustments: 'not_requested' as const,
        rate_card_entries: 'not_requested' as const,
        rate_adjustments: 'not_requested' as const,
        usage_grants: 'not_requested' as const,
        usage_policies: 'not_requested' as const
      },
      warnings: []
    })),
    optional_artifacts: {
      line_details: [],
      price_adjustments: [],
      rate_card_entries: [],
      rate_adjustments: [],
      usage_grants: [],
      usage_policies: []
    },
    counts: {
      requested_lines: requestedLineIds.length,
      resolved_line_snapshots: 0,
      packets_total: requestedLineIds.length,
      ok_packets: 0,
      partial_packets: 0,
      no_match_packets: requestedLineIds.length,
      unsupported_packets: 0,
      error_packets: 0,
      line_details_returned: 0,
      price_adjustments_returned: 0,
      rate_card_entries_returned: 0,
      rate_adjustments_returned: 0,
      usage_grants_returned: 0,
      usage_policies_returned: 0
    },
    recommended_next_commands: []
  };
}

function normalizePacketStatus(
  inspectResult: InspectPricingWaterfallPrimitiveResult
): CapturePostPstLineEvidencePacket['capture_status'] {
  if (inspectResult.status === 'ok') {
    return 'ok';
  }

  if (inspectResult.status === 'partial') {
    return 'partial';
  }

  if (inspectResult.status === 'unsupported') {
    return 'partial';
  }

  if (inspectResult.status === 'no_match') {
    return 'partial';
  }

  return 'error';
}

function mergePacketStatus(
  mandatoryStatus: CapturePostPstLineEvidencePacket['capture_status'],
  artifactStatuses: CapturePostPstArtifactStatuses
): CapturePostPstLineEvidencePacket['capture_status'] {
  if (mandatoryStatus === 'error' || mandatoryStatus === 'no_match') {
    return mandatoryStatus;
  }

  if (
    artifactStatuses.line_detail === 'unsupported'
    || artifactStatuses.price_adjustments === 'unsupported'
    || artifactStatuses.rate_card_entries === 'unsupported'
    || artifactStatuses.rate_adjustments === 'unsupported'
    || artifactStatuses.usage_grants === 'unsupported'
    || artifactStatuses.usage_policies === 'unsupported'
  ) {
    return 'partial';
  }

  return mandatoryStatus;
}

function buildTraceAnchor(inspectResult: InspectPricingWaterfallPrimitiveResult): CapturePostPstTraceAnchor | null {
  const identifierValue = inspectResult.result.selector_resolution.price_waterfall_identifier;
  if (typeof identifierValue !== 'string' || identifierValue.trim() === '') {
    return null;
  }

  const parsed = parsePriceWaterfallIdentifier(identifierValue);
  return {
    price_waterfall_identifier: identifierValue,
    waterfall_line_item_id: parsed.kind === 'parsed' ? parsed.lineItemId : null,
    pricing_execution_id: parsed.kind === 'parsed' ? parsed.pricingExecutionId : null,
    shared_execution_key: inspectResult.result.correlation.shared_execution_key
  };
}

function buildExecutionCorrelation(
  inspectResult: InspectPricingWaterfallPrimitiveResult
): CapturePostPstExecutionCorrelation | null {
  const processRecord = pickLatestRecord(inspectResult.result.correlation.pricing_process_execution.records);
  const apiRecord = pickLatestRecord(inspectResult.result.correlation.pricing_api_execution.records);

  if (processRecord === null && apiRecord === null && inspectResult.result.correlation.shared_execution_key === null) {
    return null;
  }

  return {
    pricing_process_execution: processRecord,
    pricing_api_execution: apiRecord,
    api_execution_log: inspectResult.result.correlation.api_execution_log as unknown as JsonValue,
    correlation_status: determineCorrelationStatus(inspectResult)
  };
}

function determineCorrelationStatus(
  inspectResult: InspectPricingWaterfallPrimitiveResult
): CapturePostPstExecutionCorrelation['correlation_status'] {
  const { correlation } = inspectResult.result;
  // api_execution_log is deliberately excluded: it is supplementary evidence that can be
  // absent or fail even when pricing succeeded, so it never demotes correlation status.
  const queryStatuses = [
    correlation.pricing_process_execution.query_status,
    correlation.pricing_api_execution.query_status,
    correlation.pricing_process_family.fetch_status
  ];

  if (queryStatuses.some((status) => status === 'unsupported')) {
    return 'unsupported';
  }

  if (queryStatuses.some((status) => status === 'error')) {
    return 'error';
  }

  if (
    correlation.shared_execution_key !== null
    && correlation.pricing_process_execution.query_status === 'ok'
    && correlation.pricing_api_execution.query_status === 'ok'
    && correlation.pricing_process_family.fetch_status === 'ok'
    && correlation.line_membership_confirmed === true
  ) {
    return 'ok';
  }

  return 'partial';
}

function pickLatestRecord(records: readonly Record<string, JsonValue>[]): Record<string, JsonValue> | null {
  return records.length === 0 ? null : { ...records[records.length - 1] };
}

function buildMissingLineArtifactStatuses(
  input: Pick<ExecuteCapturePostPstEvidenceInput, 'includeAdjustments' | 'includeLineDetail'>
): CapturePostPstArtifactStatuses {
  return {
    line_detail: input.includeLineDetail ? 'not_found' : 'not_requested',
    price_adjustments: input.includeAdjustments ? 'not_found' : 'not_requested',
    rate_card_entries: 'not_requested',
    rate_adjustments: 'not_requested',
    usage_grants: 'not_requested',
    usage_policies: 'not_requested'
  };
}

function buildMissingLineWarnings(
  input: Pick<ExecuteCapturePostPstEvidenceInput, 'includeAdjustments' | 'includeLineDetail'>,
  requestedLineId: string,
  quoteId: string
): string[] {
  const warnings = [`Requested line '${requestedLineId}' did not resolve on quote '${quoteId}'.`];

  if (input.includeLineDetail) {
    warnings.push(
      `QuoteLineDetail was requested for line '${requestedLineId}', but no persisted QuoteLineItem resolved on quote '${quoteId}', so the optional artifact status is recorded as not_found.`
    );
  }

  if (input.includeAdjustments) {
    warnings.push(
      `QuoteLinePriceAdjustment was requested for line '${requestedLineId}', but no persisted QuoteLineItem resolved on quote '${quoteId}', so the optional artifact status is recorded as not_found.`
    );
  }

  return warnings;
}

function buildCounts(
  requestedCount: number,
  resolvedCount: number,
  packets: readonly CapturePostPstLineEvidencePacket[],
  optionalArtifacts: CapturePostPstOptionalArtifacts
): CapturePostPstCounts {
  return {
    requested_lines: requestedCount,
    resolved_line_snapshots: resolvedCount,
    packets_total: packets.length,
    ok_packets: packets.filter((packet) => packet.capture_status === 'ok').length,
    partial_packets: packets.filter((packet) => packet.capture_status === 'partial').length,
    no_match_packets: packets.filter((packet) => packet.capture_status === 'no_match').length,
    unsupported_packets: packets.filter((packet) => packet.capture_status === 'unsupported').length,
    error_packets: packets.filter((packet) => packet.capture_status === 'error').length,
    line_details_returned: optionalArtifacts.line_details.length,
    price_adjustments_returned: optionalArtifacts.price_adjustments.length,
    rate_card_entries_returned: optionalArtifacts.rate_card_entries.length,
    rate_adjustments_returned: optionalArtifacts.rate_adjustments.length,
    usage_grants_returned: optionalArtifacts.usage_grants.length,
    usage_policies_returned: optionalArtifacts.usage_policies.length
  };
}

async function collectOptionalArtifactsForLine(
  input: {
    orgAlias: string;
    requestedLineId: string;
    resolvedLineId: string;
    includeAdjustments?: boolean;
    includeLineDetail?: boolean;
    includeUsageRating?: boolean;
    timeoutMs?: number;
    fetchQuoteLineDetailByLineId: (input: {
      orgAlias: string;
      lineId: string;
      timeoutMs?: number;
    }) => Promise<QuoteLineArtifactResult<QuoteLineDetailRecord>>;
    fetchQuoteLinePriceAdjustmentsByLineId: (input: {
      orgAlias: string;
      lineId: string;
      timeoutMs?: number;
    }) => Promise<QuoteLineArtifactResult<QuoteLinePriceAdjustmentRecord>>;
    fetchQuoteLineRateCardEntriesByLineId: (input: {
      orgAlias: string;
      lineId: string;
      timeoutMs?: number;
    }) => Promise<QuoteLineArtifactResult<QuoteLineRateCardEntryRecord>>;
    fetchQuoteLineRateAdjustmentsByRateCardEntryIds: (input: {
      orgAlias: string;
      quoteLineRateCardEntryIds: readonly string[];
      timeoutMs?: number;
    }) => Promise<QuoteLineArtifactResult<QuoteLineRateAdjustmentRecord>>;
    fetchQuoteLineUsageResourceGrantsByLineId: (input: {
      orgAlias: string;
      lineId: string;
      timeoutMs?: number;
    }) => Promise<QuoteLineArtifactResult<QuoteLineUsageResourceGrantRecord>>;
    fetchQuoteLineUsageResourcePoliciesByLineId: (input: {
      orgAlias: string;
      lineId: string;
      timeoutMs?: number;
    }) => Promise<QuoteLineArtifactResult<QuoteLineUsageResourcePolicyRecord>>;
  }
): Promise<{
  statuses: CapturePostPstArtifactStatuses;
  artifacts: CapturePostPstOptionalArtifacts;
  warnings: string[];
}> {
  const artifacts: CapturePostPstOptionalArtifacts = {
    line_details: [],
    price_adjustments: [],
    rate_card_entries: [],
    rate_adjustments: [],
    usage_grants: [],
    usage_policies: []
  };

  const lineDetail = input.includeLineDetail
    ? await input.fetchQuoteLineDetailByLineId({
        orgAlias: input.orgAlias,
        lineId: input.resolvedLineId,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
      })
    : null;
  const priceAdjustments = input.includeAdjustments
    ? await input.fetchQuoteLinePriceAdjustmentsByLineId({
        orgAlias: input.orgAlias,
        lineId: input.resolvedLineId,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
      })
    : null;
  const rateCardEntries = input.includeUsageRating
    ? await input.fetchQuoteLineRateCardEntriesByLineId({
        orgAlias: input.orgAlias,
        lineId: input.resolvedLineId,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
      })
    : null;
  const quoteLineRateCardEntryIds = rateCardEntries?.ok === true
    ? rateCardEntries.data.flatMap((record) => typeof record.Id === 'string' ? [record.Id] : [])
    : [];
  const rateAdjustments = input.includeUsageRating
    ? await input.fetchQuoteLineRateAdjustmentsByRateCardEntryIds({
        orgAlias: input.orgAlias,
        quoteLineRateCardEntryIds,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
      })
    : null;
  const usageGrants = input.includeUsageRating
    ? await input.fetchQuoteLineUsageResourceGrantsByLineId({
        orgAlias: input.orgAlias,
        lineId: input.resolvedLineId,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
      })
    : null;
  const usagePolicies = input.includeUsageRating
    ? await input.fetchQuoteLineUsageResourcePoliciesByLineId({
        orgAlias: input.orgAlias,
        lineId: input.resolvedLineId,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
      })
    : null;

  if (lineDetail?.ok) {
    artifacts.line_details.push(...lineDetail.data.map((record) => ({ ...record })));
  }

  if (priceAdjustments?.ok) {
    artifacts.price_adjustments.push(...priceAdjustments.data.map((record) => ({ ...record })));
  }
  if (rateCardEntries?.ok) {
    artifacts.rate_card_entries.push(...rateCardEntries.data.map((record) => ({ ...record })));
  }
  if (rateAdjustments?.ok) {
    artifacts.rate_adjustments.push(...rateAdjustments.data.map((record) => ({ ...record })));
  }
  if (usageGrants?.ok) {
    artifacts.usage_grants.push(...usageGrants.data.map((record) => ({ ...record })));
  }
  if (usagePolicies?.ok) {
    artifacts.usage_policies.push(...usagePolicies.data.map((record) => ({ ...record })));
  }

  return {
    statuses: {
      line_detail: determineOptionalArtifactStatus(lineDetail),
      price_adjustments: determineOptionalArtifactStatus(priceAdjustments),
      rate_card_entries: determineOptionalArtifactStatus(rateCardEntries),
      rate_adjustments: determineOptionalArtifactStatus(rateAdjustments),
      usage_grants: determineOptionalArtifactStatus(usageGrants),
      usage_policies: determineOptionalArtifactStatus(usagePolicies)
    },
    artifacts,
    warnings: dedupeStrings([
      ...buildOptionalArtifactWarnings('QuoteLineDetail', input.requestedLineId, input.resolvedLineId, lineDetail),
      ...buildOptionalArtifactWarnings(
        'QuoteLinePriceAdjustment',
        input.requestedLineId,
        input.resolvedLineId,
        priceAdjustments
      ),
      ...buildOptionalArtifactWarnings(
        'QuoteLineRateCardEntry',
        input.requestedLineId,
        input.resolvedLineId,
        rateCardEntries
      ),
      ...buildOptionalArtifactWarnings(
        'QuoteLineRateAdjustment',
        input.requestedLineId,
        input.resolvedLineId,
        rateAdjustments
      ),
      ...buildOptionalArtifactWarnings(
        'QuotLineItmUseRsrcGrant',
        input.requestedLineId,
        input.resolvedLineId,
        usageGrants
      ),
      ...buildOptionalArtifactWarnings(
        'QuotLineItmUsageRsrcPlcy',
        input.requestedLineId,
        input.resolvedLineId,
        usagePolicies
      )
    ])
  };
}

function determineOptionalArtifactStatus(
  result: QuoteLineArtifactResult<
    QuoteLineDetailRecord
    | QuoteLinePriceAdjustmentRecord
    | QuoteLineRateCardEntryRecord
    | QuoteLineRateAdjustmentRecord
    | QuoteLineUsageResourceGrantRecord
    | QuoteLineUsageResourcePolicyRecord
  > | null
): CapturePostPstArtifactStatus {
  if (result === null) {
    return 'not_requested';
  }

  if (result.ok) {
    return result.data.length > 0 ? 'ok' : 'not_found';
  }

  return 'unsupported';
}

function buildOptionalArtifactWarnings(
  label: 'QuoteLineDetail'
    | 'QuoteLinePriceAdjustment'
    | 'QuoteLineRateCardEntry'
    | 'QuoteLineRateAdjustment'
    | 'QuotLineItmUseRsrcGrant'
    | 'QuotLineItmUsageRsrcPlcy',
  requestedLineId: string,
  resolvedLineId: string,
  result: QuoteLineArtifactResult<
    QuoteLineDetailRecord
    | QuoteLinePriceAdjustmentRecord
    | QuoteLineRateCardEntryRecord
    | QuoteLineRateAdjustmentRecord
    | QuoteLineUsageResourceGrantRecord
    | QuoteLineUsageResourcePolicyRecord
  > | null
): string[] {
  if (result === null) {
    return [];
  }

  if (result.ok === true) {
    if (result.data.length > 0) {
      return [];
    }

    return [
      `${label} was requested for line '${requestedLineId}' (resolved as '${resolvedLineId}'), but no rows were returned, so the optional artifact status is recorded as not_found.`
    ];
  }

  return [
    `${label} could not be captured for line '${requestedLineId}' (resolved as '${resolvedLineId}'); the optional artifact status is recorded as unsupported. ${result.message}`
  ];
}

function determineCommandStatus(
  packets: readonly CapturePostPstLineEvidencePacket[]
): CapturePostPstEvidencePrimitiveResult['status'] {
  if (packets.length === 0) {
    return 'error';
  }

  const allNoMatch = packets.every((packet) => packet.capture_status === 'no_match');
  if (allNoMatch) {
    return 'no_match';
  }

  const allOk = packets.every((packet) => packet.capture_status === 'ok');
  if (allOk) {
    return 'ok';
  }

  return 'partial';
}

function buildRecommendedNextCommands(
  packets: readonly CapturePostPstLineEvidencePacket[]
): string[] {
  const ordered: string[] = [];
  const add = (commandName: string) => {
    if (!ordered.includes(commandName)) {
      ordered.push(commandName);
    }
  };

  if (packets.every((packet) => packet.capture_status === 'ok')) {
    add('inspect-rlm-context');
    return ordered;
  }

  if (packets.some((packet) => packet.capture_status === 'no_match')) {
    add('snapshot-lines');
    add('doctor');
  }

  if (packets.some((packet) => packet.capture_status === 'partial' || packet.capture_status === 'error' || packet.capture_status === 'unsupported')) {
    add('inspect-pricing-waterfall');
    add('inspect-rlm-context');
  }

  if (ordered.length === 0) {
    add('inspect-rlm-context');
  }

  return ordered;
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
}

function memoizeFetchByKey<TInput, TResult>(
  fetch: (input: TInput) => Promise<TResult>,
  keyOf: (input: TInput) => string
): (input: TInput) => Promise<TResult> {
  const cache = new Map<string, Promise<TResult>>();
  return (fetchInput) => {
    const key = keyOf(fetchInput);
    const pending = cache.get(key) ?? fetch(fetchInput);
    cache.set(key, pending);
    return pending;
  };
}
