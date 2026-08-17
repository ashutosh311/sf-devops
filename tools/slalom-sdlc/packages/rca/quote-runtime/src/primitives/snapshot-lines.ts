import type { JsonValue } from '../contracts/result-envelope';
import type { EvidenceItem } from '../contracts/evidence';
import { QUOTE_LINE_ITEM_SNAPSHOT_FIELDS } from '../contracts/query-fields';
import type { RuntimeStatus } from '../contracts/status';
import {
  invokeSfJson,
  type InvokeSfJsonOptions,
  type SfCliErrorClassification,
  type SfCliJsonFailure,
  type SfCliJsonResult
} from '../integrations/salesforce/sf-cli';
import { buildSoqlSelect, quoteSoqlId } from '../integrations/salesforce/soql';

export type SnapshotLineFieldName = (typeof QUOTE_LINE_ITEM_SNAPSHOT_FIELDS)[number];

export type SnapshotLineRecord = Record<SnapshotLineFieldName, JsonValue>;

export type SnapshotLinesSelection = {
  mode: 'all_lines' | 'line_id_filter';
  requested_line_ids: string[];
  missing_line_ids: string[];
};

export type SnapshotLinesCounts = {
  returned: number;
  requested: number;
  available_on_quote: number;
  missing: number;
};

export type SnapshotLinesResult = {
  quote_id: string;
  lines: SnapshotLineRecord[];
  field_set: SnapshotLineFieldName[];
  counts: SnapshotLinesCounts;
  selection: SnapshotLinesSelection;
};

export type SnapshotLinesPrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'partial' | 'no_match' | 'unsupported' | 'error'>;
  result: SnapshotLinesResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
  query: string;
};

export type SnapshotLinesQueryResponse = {
  totalSize?: number;
  done?: boolean;
  records?: unknown[];
};

export type SnapshotLinesDependencies = {
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

export type ExecuteSnapshotLinesInput = SnapshotLinesDependencies & {
  orgAlias: string;
  quoteId: string;
  lineIds?: string[];
  timeoutMs?: number;
};

export async function executeSnapshotLines(input: ExecuteSnapshotLinesInput): Promise<SnapshotLinesPrimitiveResult> {
  const requestedLineIds = dedupeLineIds(input.lineIds ?? []);
  const query = buildSnapshotLinesSoql(input.quoteId);
  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const baseResult = buildBaseResult(input.quoteId, requestedLineIds);

  const sfResult = await executeSfJson<SnapshotLinesQueryResponse>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', query, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (sfResult.ok === false) {
    return buildFailurePrimitiveResult(sfResult, query, baseResult);
  }

  const normalizedLines = normalizeSnapshotLineRecords(sfResult.data);
  if (normalizedLines === 'malformed') {
    return {
      status: 'error',
      result: baseResult,
      warnings: [],
      errors: ['Salesforce CLI returned an unexpected quote line record payload.'],
      evidence: [],
      query
    };
  }

  const lineIndex = new Map(normalizedLines.map((line) => [String(line.Id), line]));
  const selectedLines = requestedLineIds.length === 0
    ? normalizedLines
    : requestedLineIds.flatMap((lineId) => {
        const line = lineIndex.get(lineId);
        return line ? [line] : [];
      });
  const missingLineIds = requestedLineIds.filter((lineId) => !lineIndex.has(lineId));
  const result: SnapshotLinesResult = {
    quote_id: input.quoteId,
    lines: selectedLines,
    field_set: [...QUOTE_LINE_ITEM_SNAPSHOT_FIELDS],
    counts: {
      returned: selectedLines.length,
      requested: requestedLineIds.length,
      available_on_quote: normalizedLines.length,
      missing: missingLineIds.length
    },
    selection: {
      mode: requestedLineIds.length === 0 ? 'all_lines' : 'line_id_filter',
      requested_line_ids: requestedLineIds,
      missing_line_ids: missingLineIds
    }
  };

  const warnings = missingLineIds.length === 0
    ? []
    : [`Requested line ids not found on quote '${input.quoteId}': ${missingLineIds.join(', ')}.`];

  return {
    status: determineSnapshotLinesStatus(selectedLines.length, requestedLineIds.length),
    result,
    warnings,
    errors: [],
    evidence: [
      buildSnapshotLinesEvidenceItem(
        `Retrieved ${selectedLines.length} persisted quote lines for ${input.quoteId}.`,
        'org_proven',
        [query],
        'Evidence is limited to the locked QuoteLineItem snapshot field set returned by the current live query.'
      )
    ],
    query
  };
}

export function buildSnapshotLinesSoql(quoteId: string): string {
  return buildSoqlSelect({
    objectName: 'QuoteLineItem',
    fields: QUOTE_LINE_ITEM_SNAPSHOT_FIELDS,
    where: `QuoteId = ${quoteSoqlId(quoteId)}`,
    orderBy: ['LineNumber', 'Id']
  });
}

export function mapSnapshotLinesFailureStatus(
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

export function dedupeLineIds(lineIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const rawLineId of lineIds) {
    const lineId = String(rawLineId).trim();
    if (!lineId || seen.has(lineId)) {
      continue;
    }

    seen.add(lineId);
    deduped.push(lineId);
  }

  return deduped;
}

export function normalizeSnapshotLineRecord(record: Record<string, unknown>): SnapshotLineRecord {
  return Object.fromEntries(
    QUOTE_LINE_ITEM_SNAPSHOT_FIELDS.map((fieldName) => [fieldName, normalizeSnapshotLineValue(fieldName, record)])
  ) as SnapshotLineRecord;
}

function normalizeSnapshotLineRecords(data: SnapshotLinesQueryResponse): SnapshotLineRecord[] | 'malformed' {
  const records = data.records;
  if (!Array.isArray(records)) {
    return 'malformed';
  }

  const normalizedRecords: SnapshotLineRecord[] = [];
  for (const record of records) {
    if (!isRecord(record)) {
      return 'malformed';
    }

    normalizedRecords.push(normalizeSnapshotLineRecord(record));
  }

  return normalizedRecords;
}

function determineSnapshotLinesStatus(
  returnedCount: number,
  requestedCount: number
): SnapshotLinesPrimitiveResult['status'] {
  if (requestedCount === 0) {
    return 'ok';
  }

  if (returnedCount === 0) {
    return 'no_match';
  }

  if (returnedCount < requestedCount) {
    return 'partial';
  }

  return 'ok';
}

function buildBaseResult(quoteId: string, requestedLineIds: string[]): SnapshotLinesResult {
  return {
    quote_id: quoteId,
    lines: [],
    field_set: [...QUOTE_LINE_ITEM_SNAPSHOT_FIELDS],
    counts: {
      returned: 0,
      requested: requestedLineIds.length,
      available_on_quote: 0,
      missing: requestedLineIds.length
    },
    selection: {
      mode: requestedLineIds.length === 0 ? 'all_lines' : 'line_id_filter',
      requested_line_ids: requestedLineIds,
      missing_line_ids: [...requestedLineIds]
    }
  };
}

function buildFailurePrimitiveResult(
  sfFailure: SfCliJsonFailure,
  query: string,
  baseResult: SnapshotLinesResult
): SnapshotLinesPrimitiveResult {
  return {
    status: mapSnapshotLinesFailureStatus(sfFailure.classification),
    result: baseResult,
    warnings: [],
    errors: [sfFailure.message],
    evidence: [],
    query
  };
}

function buildSnapshotLinesEvidenceItem(
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

function normalizeSnapshotLineValue(fieldName: SnapshotLineFieldName, record: Record<string, unknown>): JsonValue {
  const value = fieldName.startsWith('QuoteAction.')
    ? readNestedRecordValue(record, fieldName)
    : record[fieldName];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return null;
}

function readNestedRecordValue(record: Record<string, unknown>, fieldPath: string): unknown {
  const [relationshipName, relationshipField] = fieldPath.split('.', 2);
  if (!relationshipName || !relationshipField) {
    return undefined;
  }

  const relationshipValue = record[relationshipName];
  if (!isRecord(relationshipValue)) {
    return undefined;
  }

  return relationshipValue[relationshipField];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
