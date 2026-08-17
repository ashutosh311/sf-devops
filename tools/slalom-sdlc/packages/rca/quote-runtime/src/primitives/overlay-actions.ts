import type { JsonValue } from '../contracts/result-envelope';
import { QUOTE_ACTION_OVERLAY_FIELDS } from '../contracts/query-fields';
import type { RuntimeStatus } from '../contracts/status';
import type { EvidenceItem } from '../contracts/evidence';
import {
  invokeSfJson,
  type InvokeSfJsonOptions,
  type SfCliErrorClassification,
  type SfCliJsonFailure,
  type SfCliJsonResult
} from '../integrations/salesforce/sf-cli';
import { buildSoqlSelect, quoteSoqlId, quoteSoqlIds } from '../integrations/salesforce/soql';

export type OverlayActionFieldName = (typeof QUOTE_ACTION_OVERLAY_FIELDS)[number];
export type OverlayActionRecord = Record<OverlayActionFieldName, JsonValue>;

export type OverlayActionLineLink = {
  line_id: string;
  quote_action_id: string;
  action_type: string | null;
  source_asset_id: string | null;
};

export type OverlayActionsSummary = Record<string, JsonValue>;

export type OverlayActionsResult = {
  quote_id: string;
  field_set: OverlayActionFieldName[];
  action_rows: OverlayActionRecord[];
  line_action_links: OverlayActionLineLink[];
  provenance_summary: OverlayActionsSummary;
};

export type OverlayActionsPrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'no_match' | 'unsupported' | 'error'>;
  status_detail: 'actions_found' | 'empty_overlay' | 'line_selector_miss' | 'quote_absent' | 'sf_failure' | 'malformed_payload';
  result: OverlayActionsResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
  queries: string[];
};

type QuoteQueryResponse = {
  totalSize?: number;
  done?: boolean;
  records?: unknown[];
};

type LineQueryResponse = {
  totalSize?: number;
  done?: boolean;
  records?: unknown[];
};

type ActionQueryResponse = {
  totalSize?: number;
  done?: boolean;
  records?: unknown[];
};

type OverlayActionLineRecord = {
  Id: string;
  QuoteActionId: string | null;
  QuoteAction: {
    Type: string | null;
    SourceAssetId: string | null;
  } | null;
};

export type OverlayActionsDependencies = {
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

export type ExecuteOverlayActionsInput = OverlayActionsDependencies & {
  orgAlias: string;
  quoteId: string;
  lineIds?: readonly string[];
  timeoutMs?: number;
};

export async function executeOverlayActions(input: ExecuteOverlayActionsInput): Promise<OverlayActionsPrimitiveResult> {
  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const fieldSet = [...QUOTE_ACTION_OVERLAY_FIELDS];
  const lineIds = [...(input.lineIds ?? [])];
  const quoteQuery = buildOverlayActionsQuoteSoql(input.quoteId);
  const lineQuery = buildOverlayActionsLineSoql(input.quoteId, lineIds);
  const baseResult: OverlayActionsResult = {
    quote_id: input.quoteId,
    field_set: fieldSet,
    action_rows: [],
    line_action_links: [],
    provenance_summary: {}
  };

  const quoteResult = await executeSfJson<QuoteQueryResponse>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', quoteQuery, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (quoteResult.ok === false) {
    return buildFailurePrimitiveResult(quoteResult, [quoteQuery], baseResult);
  }

  const quoteRecord = getFirstRecord(quoteResult.data);
  if (quoteRecord === 'malformed') {
    return buildMalformedPrimitiveResult('Salesforce CLI returned an unexpected quote payload.', [quoteQuery], baseResult);
  }

  if (quoteRecord === null) {
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
          [quoteQuery],
          'No rows were returned for the requested quote selector.'
        )
      ],
      queries: [quoteQuery]
    };
  }

  const lineResult = await executeSfJson<LineQueryResponse>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', lineQuery, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (lineResult.ok === false) {
    return buildFailurePrimitiveResult(lineResult, [quoteQuery, lineQuery], baseResult);
  }

  const lineRecords = normalizeLineRecords(lineResult.data);
  if (lineRecords === 'malformed') {
    return buildMalformedPrimitiveResult(
      'Salesforce CLI returned an unexpected quote line overlay payload.',
      [quoteQuery, lineQuery],
      baseResult
    );
  }

  if (lineIds.length > 0 && lineRecords.length === 0) {
    return {
      status: 'no_match',
      status_detail: 'line_selector_miss',
      result: baseResult,
      warnings: [],
      errors: [],
      evidence: [
        buildEvidenceItem(
          `No requested quote lines matched ${input.quoteId}.`,
          'org_proven',
          [lineQuery],
          'Selector narrowing returned no persisted quote lines for the requested line ids.'
        )
      ],
      queries: [quoteQuery, lineQuery]
    };
  }

  const lineActionLinks = buildLineActionLinks(lineRecords);
  const actionIds = uniqueOrdered(lineActionLinks.map((link) => link.quote_action_id));

  if (actionIds.length === 0) {
    return {
      status: 'ok',
      status_detail: 'empty_overlay',
      result: baseResult,
      warnings: [],
      errors: [],
      evidence: [
        buildEvidenceItem(
          `No QuoteAction lifecycle provenance rows matched ${input.quoteId}.`,
          'org_proven',
          ['QuoteLineItem.QuoteActionId', lineQuery],
          'Current persisted line selection had no QuoteAction links; no fallback or shadow provenance was applied.'
        )
      ],
      queries: [quoteQuery, lineQuery]
    };
  }

  const actionQuery = buildOverlayActionsRowSoql(input.quoteId, actionIds);
  const actionResult = await executeSfJson<ActionQueryResponse>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', actionQuery, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (actionResult.ok === false) {
    return buildFailurePrimitiveResult(actionResult, [quoteQuery, lineQuery, actionQuery], baseResult);
  }

  const actionRows = normalizeActionRecords(actionResult.data);
  if (actionRows === 'malformed') {
    return buildMalformedPrimitiveResult(
      'Salesforce CLI returned an unexpected QuoteAction overlay payload.',
      [quoteQuery, lineQuery, actionQuery],
      baseResult
    );
  }

  return {
    status: 'ok',
    status_detail: actionRows.length > 0 ? 'actions_found' : 'empty_overlay',
    result: {
      ...baseResult,
      action_rows: actionRows,
      line_action_links: lineActionLinks,
      provenance_summary: buildProvenanceSummary(actionRows, lineActionLinks)
    },
    warnings: [],
    errors: [],
    evidence: [
      buildEvidenceItem(
        `Retrieved QuoteAction lifecycle provenance overlay for ${input.quoteId}.`,
        'org_proven',
        ['QuoteLineItem.QuoteActionId', 'QuoteAction.Type', 'QuoteAction.SourceAssetId'],
        'QuoteAction is treated as lifecycle provenance only; no structural, bundle, fallback, or shadow semantics are inferred.'
      )
    ],
    queries: [quoteQuery, lineQuery, actionQuery]
  };
}

export function buildOverlayActionsQuoteSoql(quoteId: string): string {
  return buildSoqlSelect({
    objectName: 'Quote',
    fields: ['Id'],
    where: `Id = ${quoteSoqlId(quoteId)}`,
    limit: 1
  });
}

export function buildOverlayActionsLineSoql(quoteId: string, lineIds: readonly string[] = []): string {
  const whereClauses = [`QuoteId = ${quoteSoqlId(quoteId)}`];
  if (lineIds.length > 0) {
    whereClauses.push(`Id IN (${quoteSoqlIds(lineIds)})`);
  }

  return buildSoqlSelect({
    objectName: 'QuoteLineItem',
    fields: ['Id', 'QuoteId', 'QuoteActionId', 'QuoteAction.Type', 'QuoteAction.SourceAssetId'],
    where: whereClauses.join(' AND '),
    orderBy: ['Id']
  });
}

export function buildOverlayActionsRowSoql(quoteId: string, actionIds: readonly string[]): string {
  return buildSoqlSelect({
    objectName: 'QuoteAction',
    fields: QUOTE_ACTION_OVERLAY_FIELDS,
    where: `QuoteId = ${quoteSoqlId(quoteId)} AND Id IN (${quoteSoqlIds(actionIds)})`,
    orderBy: ['Id']
  });
}

export function mapOverlayActionsFailureStatus(
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

function buildFailurePrimitiveResult(
  sfFailure: SfCliJsonFailure,
  queries: string[],
  baseResult: OverlayActionsResult
): OverlayActionsPrimitiveResult {
  return {
    status: mapOverlayActionsFailureStatus(sfFailure.classification),
    status_detail: 'sf_failure',
    result: baseResult,
    warnings: [],
    errors: [sfFailure.message],
    evidence: [],
    queries
  };
}

function buildMalformedPrimitiveResult(
  message: string,
  queries: string[],
  baseResult: OverlayActionsResult
): OverlayActionsPrimitiveResult {
  return {
    status: 'error',
    status_detail: 'malformed_payload',
    result: baseResult,
    warnings: [],
    errors: [message],
    evidence: [],
    queries
  };
}

function normalizeActionRecords(data: ActionQueryResponse): OverlayActionRecord[] | 'malformed' {
  const records = data.records;
  if (!Array.isArray(records)) {
    return 'malformed';
  }

  if (records.length === 0) {
    return [];
  }

  const normalized: OverlayActionRecord[] = [];
  for (const record of records) {
    if (!isRecord(record)) {
      return 'malformed';
    }

    const normalizedRecord = normalizeActionRecord(record);
    if (normalizedRecord === 'malformed') {
      return 'malformed';
    }

    normalized.push(normalizedRecord);
  }

  return normalized;
}

function normalizeActionRecord(record: Record<string, unknown>): OverlayActionRecord | 'malformed' {
  const entries: Array<[OverlayActionFieldName, JsonValue]> = [];

  for (const fieldName of QUOTE_ACTION_OVERLAY_FIELDS) {
    const normalizedValue = normalizeJsonScalar(record[fieldName]);
    if (normalizedValue === 'malformed') {
      return 'malformed';
    }

    entries.push([fieldName, normalizedValue]);
  }

  return Object.fromEntries(entries) as OverlayActionRecord;
}

function normalizeLineRecords(data: LineQueryResponse): OverlayActionLineRecord[] | 'malformed' {
  const records = data.records;
  if (!Array.isArray(records)) {
    return 'malformed';
  }

  if (records.length === 0) {
    return [];
  }

  const normalized: OverlayActionLineRecord[] = [];
  for (const record of records) {
    if (!isRecord(record) || typeof record.Id !== 'string') {
      return 'malformed';
    }

    const quoteActionId = normalizeNullableString(record.QuoteActionId);
    if (quoteActionId === 'malformed') {
      return 'malformed';
    }

    const quoteActionValue = record.QuoteAction;
    let normalizedQuoteAction: OverlayActionLineRecord['QuoteAction'] = null;
    if (quoteActionValue !== null && quoteActionValue !== undefined) {
      if (!isRecord(quoteActionValue)) {
        return 'malformed';
      }

      const actionType = normalizeNullableString(quoteActionValue.Type);
      const sourceAssetId = normalizeNullableString(quoteActionValue.SourceAssetId);
      if (actionType === 'malformed' || sourceAssetId === 'malformed') {
        return 'malformed';
      }

      normalizedQuoteAction = {
        Type: actionType,
        SourceAssetId: sourceAssetId
      };
    }

    normalized.push({
      Id: record.Id,
      QuoteActionId: quoteActionId,
      QuoteAction: normalizedQuoteAction
    });
  }

  return normalized;
}

function buildLineActionLinks(lineRecords: readonly OverlayActionLineRecord[]): OverlayActionLineLink[] {
  const links: OverlayActionLineLink[] = [];

  for (const record of lineRecords) {
    if (!record.QuoteActionId) {
      continue;
    }

    links.push({
      line_id: record.Id,
      quote_action_id: record.QuoteActionId,
      action_type: record.QuoteAction?.Type ?? null,
      source_asset_id: record.QuoteAction?.SourceAssetId ?? null
    });
  }

  return links;
}

function buildProvenanceSummary(
  actionRows: readonly OverlayActionRecord[],
  lineActionLinks: readonly OverlayActionLineLink[]
): OverlayActionsSummary {
  if (actionRows.length === 0 && lineActionLinks.length === 0) {
    return {};
  }

  const actionTypes = uniqueOrdered(
    actionRows
      .map((row) => row.Type)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  );

  return {
    action_types: actionTypes,
    linked_line_count: lineActionLinks.length,
    action_row_count: actionRows.length
  };
}

function getFirstRecord(data: QuoteQueryResponse): Record<string, unknown> | null | 'malformed' {
  const records = data.records;
  if (!Array.isArray(records)) {
    return 'malformed';
  }

  if (records.length === 0) {
    return null;
  }

  const firstRecord = records[0];
  return isRecord(firstRecord) ? firstRecord : 'malformed';
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

function normalizeJsonScalar(value: unknown): JsonValue | 'malformed' {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return 'malformed';
}

function normalizeNullableString(value: unknown): string | null | 'malformed' {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === 'string' ? value : 'malformed';
}

function uniqueOrdered(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      ordered.push(value);
    }
  }

  return ordered;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
