import type { JsonValue } from '../contracts/result-envelope';
import { QUOTE_LINE_RELATIONSHIP_OVERLAY_FIELDS } from '../contracts/query-fields';
import type { EvidenceItem } from '../contracts/evidence';
import type { RuntimeStatus } from '../contracts/status';
import { normalizeRepeatableIds } from '../selectors/runtime-selectors';
import {
  invokeSfJson,
  type InvokeSfJsonOptions,
  type SfCliErrorClassification,
  type SfCliJsonFailure,
  type SfCliJsonResult
} from '../integrations/salesforce/sf-cli';
import { buildSoqlSelect, quoteSoqlId, quoteSoqlIds } from '../integrations/salesforce/soql';

export type OverlayRelationshipFieldName = (typeof QUOTE_LINE_RELATIONSHIP_OVERLAY_FIELDS)[number];

export type OverlayRelationshipRow = {
  relationship_id: string | null;
  quote_id: string | null;
  main_line_id: string | null;
  main_line_number: JsonValue;
  main_line_total_price: JsonValue;
  associated_line_id: string | null;
  associated_line_number: JsonValue;
  associated_line_total_price: JsonValue;
  main_line_role: string | null;
  associated_line_role: string | null;
  associated_line_pricing: string | null;
  associated_quant_scale_method: string | null;
  root_line_id: string | null;
  product_relationship_type_id: string | null;
  product_related_component_id: string | null;
  is_price_inclusive: boolean | null;
};

export type BundleSummary = {
  targeted_line_count: number;
  relationship_count: number;
  matched_line_ids: string[];
  missing_line_ids: string[];
  distinct_main_line_count: number;
  distinct_associated_line_count: number;
  root_line_count: number;
  main_roles: string[];
  associated_roles: string[];
};

export type PricingInclusionSummary = {
  included_in_bundle_price_count: number;
  other_pricing_count: number;
  unknown_pricing_count: number;
  price_inclusive_true_count: number;
  price_inclusive_false_count: number;
  price_inclusive_unknown_count: number;
  associated_pricing_values: string[];
};

export type OverlayRelationshipsResult = {
  quote_id: string;
  relationship_rows: OverlayRelationshipRow[];
  bundle_summary: BundleSummary;
  pricing_inclusion_summary: PricingInclusionSummary;
};

export type OverlayRelationshipsPrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'partial' | 'no_match' | 'unsupported' | 'error'>;
  status_detail:
    | 'relationships_found'
    | 'empty_overlay'
    | 'empty_overlay_selector_miss'
    | 'partial_selector_match'
    | 'quote_absent'
    | 'sf_failure'
    | 'malformed_payload';
  result: OverlayRelationshipsResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
  queries: {
    quote: string;
    relationships: string;
  };
};

export type OverlayRelationshipsQueryResponse = {
  totalSize?: number;
  done?: boolean;
  records?: unknown[];
};

export type OverlayRelationshipsDependencies = {
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

export type ExecuteOverlayRelationshipsInput = OverlayRelationshipsDependencies & {
  orgAlias: string;
  quoteId: string;
  lineIds?: readonly string[];
  timeoutMs?: number;
};

export async function executeOverlayRelationships(
  input: ExecuteOverlayRelationshipsInput
): Promise<OverlayRelationshipsPrimitiveResult> {
  const lineIds = normalizeLineIds(input.lineIds ?? []);
  const queries = {
    quote: buildOverlayRelationshipsQuoteProbeSoql(input.quoteId),
    relationships: buildOverlayRelationshipsSoql(input.quoteId, lineIds)
  };
  const executeSf = input.invokeSfJson ?? invokeSfJson;
  const baseResult = createOverlayRelationshipsResult(input.quoteId, [], lineIds, []);

  const quoteProbe = await executeSf<OverlayRelationshipsQueryResponse>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', queries.quote, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (quoteProbe.ok === false) {
    return buildFailurePrimitiveResult(quoteProbe, queries, baseResult);
  }

  const quoteProbeRecords = getRecords(quoteProbe.data);
  if (quoteProbeRecords === 'malformed') {
    return buildMalformedPayloadPrimitiveResult(baseResult, queries);
  }

  if (quoteProbeRecords.length === 0) {
    return {
      status: 'no_match',
      status_detail: 'quote_absent',
      result: baseResult,
      warnings: [],
      errors: [],
      evidence: [
        buildEvidenceItem(
          `No persisted Quote row matched ${input.quoteId}.`,
          'org_proven',
          [queries.quote],
          'QuoteLineRelationship overlay requires an existing Quote row before structural bundle joins can load.'
        )
      ],
      queries
    };
  }

  const relationshipResult = await executeSf<OverlayRelationshipsQueryResponse>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', queries.relationships, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (relationshipResult.ok === false) {
    return buildFailurePrimitiveResult(relationshipResult, queries, baseResult);
  }

  const records = getRecords(relationshipResult.data);
  if (records === 'malformed') {
    return buildMalformedPayloadPrimitiveResult(baseResult, queries);
  }

  const relationshipRows = records.map(normalizeOverlayRelationshipRow);
  const matchedLineIds = collectMatchedLineIds(relationshipRows);
  const missingLineIds = lineIds.filter((lineId) => !matchedLineIds.has(lineId));
  const result = createOverlayRelationshipsResult(input.quoteId, relationshipRows, lineIds, missingLineIds);

  if (relationshipRows.length === 0) {
    const status = lineIds.length > 0 ? 'no_match' : 'ok';
    return {
      status,
      status_detail: status === 'ok' ? 'empty_overlay' : 'empty_overlay_selector_miss',
      result,
      warnings: [],
      errors: [],
      evidence: [
        buildEvidenceItem(
          `QuoteLineRelationship overlay stayed in structural and bundle semantics for ${input.quoteId}.`,
          'documented',
          ['specs/quoting-pricing-runtime/quoting-pricing-runtime-node-typescript-wave2-primitives-build-plan.md'],
          'This overlay must not be interpreted as lifecycle provenance in wave 2.'
        ),
        buildEvidenceItem(
          `No QuoteLineRelationship rows were present for ${input.quoteId}.`,
          'org_proven',
          [queries.relationships],
          'Absence of structural relationship rows does not imply lifecycle provenance conclusions.'
        )
      ],
      queries
    };
  }

  const warnings = missingLineIds.length > 0
    ? [`Requested line ids not present in QuoteLineRelationship scope: ${missingLineIds.join(', ')}`]
    : [];

  return {
    status: warnings.length > 0 ? 'partial' : 'ok',
    status_detail: warnings.length > 0 ? 'partial_selector_match' : 'relationships_found',
    result,
    warnings,
    errors: [],
    evidence: [
      buildEvidenceItem(
        `QuoteLineRelationship overlay stayed in structural and bundle semantics for ${input.quoteId}.`,
        'documented',
        ['specs/quoting-pricing-runtime/quoting-pricing-runtime-node-typescript-wave2-primitives-build-plan.md'],
        'This overlay must not be interpreted as lifecycle provenance in wave 2.'
      ),
      buildEvidenceItem(
        `Retrieved ${relationshipRows.length} QuoteLineRelationship row(s) for ${input.quoteId}.`,
        'org_proven',
        [queries.relationships],
        'Observed relationship evidence is bundle-centric and should not be treated as lifecycle provenance.'
      )
    ],
    queries
  };
}

export function buildOverlayRelationshipsQuoteProbeSoql(quoteId: string): string {
  return buildSoqlSelect({
    objectName: 'Quote',
    fields: ['Id'],
    where: `Id = ${quoteSoqlId(quoteId)}`,
    limit: 1
  });
}

export function buildOverlayRelationshipsSoql(quoteId: string, lineIds: readonly string[] = []): string {
  const whereClauses = [`QuoteId = ${quoteSoqlId(quoteId)}`];

  if (lineIds.length > 0) {
    const quotedLineIds = quoteSoqlIds(lineIds);
    whereClauses.push(
      `(MainQuoteLineId IN (${quotedLineIds}) OR AssociatedQuoteLineId IN (${quotedLineIds}) OR RootQuoteLineId IN (${quotedLineIds}))`
    );
  }

  return buildSoqlSelect({
    objectName: 'QuoteLineRelationship',
    fields: QUOTE_LINE_RELATIONSHIP_OVERLAY_FIELDS,
    where: whereClauses.join(' AND '),
    orderBy: ['MainQuoteLineId', 'AssociatedQuoteLineId', 'Id']
  });
}

export function mapOverlayRelationshipsFailureStatus(
  classification: SfCliErrorClassification
): Extract<RuntimeStatus, 'unsupported' | 'error'> {
  switch (classification) {
    case 'auth':
    case 'unavailable':
    case 'internal_cli_error':
      return 'unsupported';
    case 'timeout':
    case 'max_buffer':
    case 'non_json_error':
    case 'cli_error':
      return 'error';
  }
}

export function normalizeOverlayRelationshipRow(record: Record<string, unknown>): OverlayRelationshipRow {
  return {
    relationship_id: normalizeString(record.Id),
    quote_id: normalizeString(record.QuoteId),
    main_line_id: normalizeString(record.MainQuoteLineId),
    main_line_number: normalizeScalar(getNestedRecordValue(record.MainQuoteLine, 'LineNumber')),
    main_line_total_price: normalizeScalar(getNestedRecordValue(record.MainQuoteLine, 'TotalPrice')),
    associated_line_id: normalizeString(record.AssociatedQuoteLineId),
    associated_line_number: normalizeScalar(getNestedRecordValue(record.AssociatedQuoteLine, 'LineNumber')),
    associated_line_total_price: normalizeScalar(getNestedRecordValue(record.AssociatedQuoteLine, 'TotalPrice')),
    main_line_role: normalizeString(record.MainQuoteLineRole),
    associated_line_role: normalizeString(record.AssociatedQuoteLineRole),
    associated_line_pricing: normalizeString(record.AssociatedQuoteLinePricing),
    associated_quant_scale_method: normalizeString(record.AssociatedQuantScaleMethod),
    root_line_id: normalizeString(record.RootQuoteLineId),
    product_relationship_type_id: normalizeString(record.ProductRelationshipTypeId),
    product_related_component_id: normalizeString(record.ProductRelatedComponentId),
    is_price_inclusive: normalizeBoolean(record.IsPriceInclusive)
  };
}

function buildFailurePrimitiveResult(
  sfFailure: SfCliJsonFailure,
  queries: OverlayRelationshipsPrimitiveResult['queries'],
  baseResult: OverlayRelationshipsResult
): OverlayRelationshipsPrimitiveResult {
  return {
    status: mapOverlayRelationshipsFailureStatus(sfFailure.classification),
    status_detail: 'sf_failure',
    result: baseResult,
    warnings: [],
    errors: [sfFailure.message],
    evidence: [],
    queries
  };
}

function buildMalformedPayloadPrimitiveResult(
  baseResult: OverlayRelationshipsResult,
  queries: OverlayRelationshipsPrimitiveResult['queries']
): OverlayRelationshipsPrimitiveResult {
  return {
    status: 'error',
    status_detail: 'malformed_payload',
    result: baseResult,
    warnings: [],
    errors: ['Salesforce CLI returned an unexpected QuoteLineRelationship payload.'],
    evidence: [],
    queries
  };
}

function createOverlayRelationshipsResult(
  quoteId: string,
  relationshipRows: OverlayRelationshipRow[],
  lineIds: readonly string[],
  missingLineIds: readonly string[]
): OverlayRelationshipsResult {
  const matchedLineIds = Array.from(collectMatchedLineIds(relationshipRows)).sort();
  const relationshipCount = relationshipRows.length;

  return {
    quote_id: quoteId,
    relationship_rows: relationshipRows,
    bundle_summary: {
      targeted_line_count: lineIds.length > 0 ? lineIds.length : matchedLineIds.length,
      relationship_count: relationshipCount,
      matched_line_ids: matchedLineIds,
      missing_line_ids: [...missingLineIds],
      distinct_main_line_count: countDistinctStrings(relationshipRows.map((row) => row.main_line_id)),
      distinct_associated_line_count: countDistinctStrings(relationshipRows.map((row) => row.associated_line_id)),
      root_line_count: countDistinctStrings(relationshipRows.map((row) => row.root_line_id)),
      main_roles: collectDistinctSortedStrings(relationshipRows.map((row) => row.main_line_role)),
      associated_roles: collectDistinctSortedStrings(relationshipRows.map((row) => row.associated_line_role))
    },
    pricing_inclusion_summary: {
      included_in_bundle_price_count: relationshipRows.filter(
        (row) => row.associated_line_pricing === 'IncludedInBundlePrice'
      ).length,
      other_pricing_count: relationshipRows.filter(
        (row) => row.associated_line_pricing !== null && row.associated_line_pricing !== 'IncludedInBundlePrice'
      ).length,
      unknown_pricing_count: relationshipRows.filter((row) => row.associated_line_pricing === null).length,
      price_inclusive_true_count: relationshipRows.filter((row) => row.is_price_inclusive === true).length,
      price_inclusive_false_count: relationshipRows.filter((row) => row.is_price_inclusive === false).length,
      price_inclusive_unknown_count: relationshipRows.filter((row) => row.is_price_inclusive === null).length,
      associated_pricing_values: collectDistinctSortedStrings(relationshipRows.map((row) => row.associated_line_pricing))
    }
  };
}

function buildEvidenceItem(
  claim: string,
  evidenceLevel: EvidenceItem['evidence_level'],
  proofSource: string[],
  limitations: string
): EvidenceItem {
  return {
    claim,
    evidence_level: evidenceLevel,
    proof_source: proofSource,
    limitations,
    source_refs: []
  };
}

function getRecords(data: OverlayRelationshipsQueryResponse): Record<string, unknown>[] | 'malformed' {
  if (!Array.isArray(data.records)) {
    return 'malformed';
  }

  const records: Record<string, unknown>[] = [];
  for (const record of data.records) {
    if (!isRecord(record)) {
      return 'malformed';
    }
    records.push(record);
  }

  return records;
}

function normalizeLineIds(lineIds: readonly string[]): string[] {
  return normalizeRepeatableIds(lineIds, 'line-id');
}

function collectMatchedLineIds(relationshipRows: readonly OverlayRelationshipRow[]): Set<string> {
  const matched = new Set<string>();

  for (const row of relationshipRows) {
    for (const value of [row.main_line_id, row.associated_line_id, row.root_line_id]) {
      if (value) {
        matched.add(value);
      }
    }
  }

  return matched;
}

function countDistinctStrings(values: readonly (string | null)[]): number {
  return collectDistinctSortedStrings(values).length;
}

function collectDistinctSortedStrings(values: readonly (string | null)[]): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))).sort();
}

function getNestedRecordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : null;
}

function normalizeScalar(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
