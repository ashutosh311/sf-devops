import type { JsonValue } from '../contracts/result-envelope';
import { QUOTE_SNAPSHOT_FIELDS } from '../contracts/query-fields';
import type { RuntimeStatus } from '../contracts/status';
import type { EvidenceItem } from '../contracts/evidence';
import {
  invokeSfJson,
  type InvokeSfJsonOptions,
  type SfCliErrorClassification,
  type SfCliJsonFailure,
  type SfCliJsonResult
} from '../integrations/salesforce/sf-cli';
import { buildSoqlSelect, quoteSoqlId } from '../integrations/salesforce/soql';

export type SnapshotQuoteFieldName = (typeof QUOTE_SNAPSHOT_FIELDS)[number];

export type SnapshotQuoteRecord = Record<SnapshotQuoteFieldName, JsonValue>;

export type SnapshotQuoteResult = {
  quote: SnapshotQuoteRecord | null;
  field_set: SnapshotQuoteFieldName[];
  snapshot_type: 'quote';
};

export type SnapshotQuotePrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'no_match' | 'unsupported' | 'error'>;
  result: SnapshotQuoteResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
  query: string;
};

export type SnapshotQuoteQueryResponse = {
  totalSize?: number;
  done?: boolean;
  records?: unknown[];
};

export type SnapshotQuoteDependencies = {
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

export type ExecuteSnapshotQuoteInput = SnapshotQuoteDependencies & {
  orgAlias: string;
  quoteId: string;
  timeoutMs?: number;
};

export async function executeSnapshotQuote(input: ExecuteSnapshotQuoteInput): Promise<SnapshotQuotePrimitiveResult> {
  const query = buildSnapshotQuoteSoql(input.quoteId);
  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const fieldSet = [...QUOTE_SNAPSHOT_FIELDS];
  const baseResult: SnapshotQuoteResult = {
    quote: null,
    field_set: fieldSet,
    snapshot_type: 'quote'
  };

  const sfResult = await executeSfJson<SnapshotQuoteQueryResponse>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', query, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (sfResult.ok === false) {
    return buildFailurePrimitiveResult(sfResult, query, baseResult);
  }

  const firstRecord = getFirstRecord(sfResult.data);
  if (firstRecord === 'malformed') {
    return {
      status: 'error',
      result: baseResult,
      warnings: [],
      errors: ['Salesforce CLI returned an unexpected quote record payload.'],
      evidence: [],
      query
    };
  }

  if (!firstRecord) {
    return {
      status: 'no_match',
      result: baseResult,
      warnings: [],
      errors: [],
      evidence: [
        buildSnapshotQuoteEvidenceItem(
          `No persisted Quote row matched ${input.quoteId}.`,
          'org_proven',
          [query],
          'No rows were returned for the requested quote selector.'
        )
      ],
      query
    };
  }

  return {
    status: 'ok',
    result: {
      ...baseResult,
      quote: normalizeSnapshotQuoteRecord(firstRecord)
    },
    warnings: [],
    errors: [],
    evidence: [
      buildSnapshotQuoteEvidenceItem(
        `Retrieved persisted quote snapshot for ${input.quoteId}.`,
        'org_proven',
        [query],
        'Evidence is limited to the locked quote snapshot field set returned by the current live query.'
      )
    ],
    query
  };
}

export function buildSnapshotQuoteSoql(quoteId: string): string {
  return buildSoqlSelect({
    objectName: 'Quote',
    fields: QUOTE_SNAPSHOT_FIELDS,
    where: `Id = ${quoteSoqlId(quoteId)}`,
    limit: 1
  });
}

export function mapSnapshotQuoteFailureStatus(
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

export function normalizeSnapshotQuoteRecord(record: Record<string, unknown>): SnapshotQuoteRecord {
  return Object.fromEntries(
    QUOTE_SNAPSHOT_FIELDS.map((fieldName) => [fieldName, normalizeSnapshotQuoteValue(record[fieldName])])
  ) as SnapshotQuoteRecord;
}

function buildFailurePrimitiveResult(
  sfFailure: SfCliJsonFailure,
  query: string,
  baseResult: SnapshotQuoteResult
): SnapshotQuotePrimitiveResult {
  return {
    status: mapSnapshotQuoteFailureStatus(sfFailure.classification),
    result: baseResult,
    warnings: [],
    errors: [sfFailure.message],
    evidence: [],
    query
  };
}

function getFirstRecord(data: SnapshotQuoteQueryResponse): Record<string, unknown> | null | 'malformed' {
  const records = data.records;
  if (!Array.isArray(records) || records.length === 0) {
    return null;
  }

  const firstRecord = records[0];
  return isRecord(firstRecord) ? firstRecord : 'malformed';
}

function buildSnapshotQuoteEvidenceItem(
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

function normalizeSnapshotQuoteValue(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
