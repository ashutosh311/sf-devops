import type { JsonValue } from '../contracts/result-envelope';
import type { SnapshotLineRecord } from './snapshot-lines';
import type { SnapshotQuoteRecord } from './snapshot-quote';

export type CompareQuotesInput = {
  quote: SnapshotQuoteRecord;
  lines: SnapshotLineRecord[];
};

export type CompareQuotesMatchBasis =
  | 'line_id'
  | 'quote_action_source_asset_id'
  | 'structural_key'
  | 'structural_key_plus_line_number';

export type CompareQuotesChangedLine = {
  id: string;
  paired_id: string;
  changed_fields: string[];
  before: SnapshotLineRecord;
  after: SnapshotLineRecord;
  match_basis: CompareQuotesMatchBasis;
};

export type CompareQuotesAmbiguousMatch = {
  basis: Extract<CompareQuotesMatchBasis, 'quote_action_source_asset_id' | 'structural_key' | 'structural_key_plus_line_number'>;
  before_line_ids: string[];
  after_line_ids: string[];
};

export type CompareQuotesResult = {
  status: 'changed' | 'no_change';
  changed_fields: string[];
  matching_strategy: {
    mode: 'same_quote_by_line_id' | 'cross_quote_conservative';
    same_quote: boolean;
    default_match_tiers: CompareQuotesMatchBasis[];
  };
  quote_diff: {
    changed_fields: string[];
    before: SnapshotQuoteRecord;
    after: SnapshotQuoteRecord;
  };
  line_diff: {
    added: SnapshotLineRecord[];
    removed: SnapshotLineRecord[];
    changed: CompareQuotesChangedLine[];
    ambiguous: CompareQuotesAmbiguousMatch[];
  };
};

export type CompareQuotesArguments = {
  before: CompareQuotesInput;
  after: CompareQuotesInput;
};

type LineMatch = {
  before: SnapshotLineRecord;
  after: SnapshotLineRecord;
  basis: CompareQuotesMatchBasis;
};

type CrossQuoteLineMatchResult = {
  matches: LineMatch[];
  added: SnapshotLineRecord[];
  removed: SnapshotLineRecord[];
  ambiguous: CompareQuotesAmbiguousMatch[];
};

export function compareQuotes(args: CompareQuotesArguments): CompareQuotesResult {
  const quoteChangedFields = getChangedFields(args.before.quote, args.after.quote);
  const sameQuote = String(args.before.quote.Id) === String(args.after.quote.Id);

  const lineComparison = sameQuote
    ? matchSameQuoteLines(args.before.lines, args.after.lines)
    : matchCrossQuoteLines(args.before.lines, args.after.lines);

  const changed = lineComparison.matches.flatMap(({ before, after, basis }) => {
    const changedFields = getChangedFields(before, after);
    if (changedFields.length === 0) {
      return [];
    }

    return [{
      id: String(before.Id),
      paired_id: String(after.Id),
      changed_fields: changedFields,
      before,
      after,
      match_basis: basis
    } satisfies CompareQuotesChangedLine];
  });

  const changedFields = [
    ...quoteChangedFields.map((fieldName) => `quote.${fieldName}`),
    ...changed.flatMap((line) => {
      const lineIdentifier = formatChangedLineIdentifier(line.id, line.paired_id);
      return line.changed_fields.map((fieldName) => `line.${lineIdentifier}.${fieldName}`);
    }),
    ...lineComparison.removed.map((line) => `line.${String(line.Id)}`),
    ...lineComparison.added.map((line) => `line.${String(line.Id)}`)
  ];

  return {
    status: changedFields.length > 0 ? 'changed' : 'no_change',
    changed_fields: changedFields,
    matching_strategy: {
      mode: sameQuote ? 'same_quote_by_line_id' : 'cross_quote_conservative',
      same_quote: sameQuote,
      default_match_tiers: sameQuote
        ? ['line_id']
        : ['quote_action_source_asset_id', 'structural_key', 'structural_key_plus_line_number']
    },
    quote_diff: {
      changed_fields: quoteChangedFields,
      before: args.before.quote,
      after: args.after.quote
    },
    line_diff: {
      added: lineComparison.added,
      removed: lineComparison.removed,
      changed,
      ambiguous: lineComparison.ambiguous
    }
  };
}

function matchSameQuoteLines(beforeLines: SnapshotLineRecord[], afterLines: SnapshotLineRecord[]): CrossQuoteLineMatchResult {
  const beforeLinesById = indexLinesById(beforeLines, 'before');
  const afterLinesById = indexLinesById(afterLines, 'after');
  const matches: LineMatch[] = [];
  const added: SnapshotLineRecord[] = [];
  const removed: SnapshotLineRecord[] = [];

  for (const beforeLine of beforeLines) {
    const lineId = String(beforeLine.Id);
    const afterLine = afterLinesById.get(lineId);

    if (!afterLine) {
      removed.push(beforeLine);
      continue;
    }

    matches.push({ before: beforeLine, after: afterLine, basis: 'line_id' });
  }

  for (const afterLine of afterLines) {
    if (!beforeLinesById.has(String(afterLine.Id))) {
      added.push(afterLine);
    }
  }

  return {
    matches,
    added,
    removed,
    ambiguous: []
  };
}

function matchCrossQuoteLines(beforeLines: SnapshotLineRecord[], afterLines: SnapshotLineRecord[]): CrossQuoteLineMatchResult {
  indexLinesById(beforeLines, 'before');
  indexLinesById(afterLines, 'after');

  const beforeRemaining = new Map(beforeLines.map((line) => [String(line.Id), line]));
  const afterRemaining = new Map(afterLines.map((line) => [String(line.Id), line]));
  const matches: LineMatch[] = [];
  const matchedAfterIdByBeforeId = new Map<string, string>();
  const matchedBeforeIdByAfterId = new Map<string, string>();

  consumeUniqueKeyMatches({
    beforeRemaining,
    afterRemaining,
    matches,
    matchedAfterIdByBeforeId,
    matchedBeforeIdByAfterId,
    basis: 'quote_action_source_asset_id',
    buildKey: buildSourceAssetMatchKey
  });

  let progressed = true;
  while (progressed) {
    progressed = false;

    if (
      consumeUniqueKeyMatches({
        beforeRemaining,
        afterRemaining,
        matches,
        matchedAfterIdByBeforeId,
        matchedBeforeIdByAfterId,
        basis: 'structural_key',
        buildKey: (line) => buildStructuralMatchKey(line, matchedAfterIdByBeforeId, matchedBeforeIdByAfterId)
      })
    ) {
      progressed = true;
    }

    if (
      consumeStructuralLineNumberTieBreakers({
        beforeRemaining,
        afterRemaining,
        matches,
        matchedAfterIdByBeforeId,
        matchedBeforeIdByAfterId
      })
    ) {
      progressed = true;
    }
  }

  return {
    matches,
    added: Array.from(afterRemaining.values()),
    removed: Array.from(beforeRemaining.values()),
    ambiguous: buildAmbiguousMatches(beforeRemaining, afterRemaining, matchedAfterIdByBeforeId, matchedBeforeIdByAfterId)
  };
}

function consumeUniqueKeyMatches(args: {
  beforeRemaining: Map<string, SnapshotLineRecord>;
  afterRemaining: Map<string, SnapshotLineRecord>;
  matches: LineMatch[];
  matchedAfterIdByBeforeId: Map<string, string>;
  matchedBeforeIdByAfterId: Map<string, string>;
  basis: Extract<CompareQuotesMatchBasis, 'quote_action_source_asset_id' | 'structural_key'>;
  buildKey: (line: SnapshotLineRecord) => string | null;
}): boolean {
  const beforeGroups = groupLinesByKey(Array.from(args.beforeRemaining.values()), args.buildKey);
  const afterGroups = groupLinesByKey(Array.from(args.afterRemaining.values()), args.buildKey);
  let matchedAny = false;

  for (const [key, beforeGroup] of Array.from(beforeGroups.entries())) {
    const afterGroup = afterGroups.get(key);
    if (!afterGroup || beforeGroup.length !== 1 || afterGroup.length !== 1) {
      continue;
    }

    recordMatch({
      before: beforeGroup[0],
      after: afterGroup[0],
      basis: args.basis,
      beforeRemaining: args.beforeRemaining,
      afterRemaining: args.afterRemaining,
      matches: args.matches,
      matchedAfterIdByBeforeId: args.matchedAfterIdByBeforeId,
      matchedBeforeIdByAfterId: args.matchedBeforeIdByAfterId
    });
    matchedAny = true;
  }

  return matchedAny;
}

function consumeStructuralLineNumberTieBreakers(args: {
  beforeRemaining: Map<string, SnapshotLineRecord>;
  afterRemaining: Map<string, SnapshotLineRecord>;
  matches: LineMatch[];
  matchedAfterIdByBeforeId: Map<string, string>;
  matchedBeforeIdByAfterId: Map<string, string>;
}): boolean {
  const beforeGroups = groupLinesByKey(
    Array.from(args.beforeRemaining.values()),
    (line) => buildStructuralMatchKey(line, args.matchedAfterIdByBeforeId, args.matchedBeforeIdByAfterId)
  );
  const afterGroups = groupLinesByKey(
    Array.from(args.afterRemaining.values()),
    (line) => buildStructuralMatchKey(line, args.matchedAfterIdByBeforeId, args.matchedBeforeIdByAfterId)
  );
  let matchedAny = false;

  for (const [key, beforeGroup] of Array.from(beforeGroups.entries())) {
    const afterGroup = afterGroups.get(key);
    if (!afterGroup || beforeGroup.length < 2 || afterGroup.length < 2) {
      continue;
    }

    const beforeByLineNumber = groupLinesByKey(beforeGroup, (line) => {
      const lineNumber = normalizeScalar(line.LineNumber);
      return lineNumber === null ? null : `${key}|line:${lineNumber}`;
    });
    const afterByLineNumber = groupLinesByKey(afterGroup, (line) => {
      const lineNumber = normalizeScalar(line.LineNumber);
      return lineNumber === null ? null : `${key}|line:${lineNumber}`;
    });

    for (const [lineNumberKey, beforeNumberGroup] of Array.from(beforeByLineNumber.entries())) {
      const afterNumberGroup = afterByLineNumber.get(lineNumberKey);
      if (!afterNumberGroup || beforeNumberGroup.length !== 1 || afterNumberGroup.length !== 1) {
        continue;
      }

      recordMatch({
        before: beforeNumberGroup[0],
        after: afterNumberGroup[0],
        basis: 'structural_key_plus_line_number',
        beforeRemaining: args.beforeRemaining,
        afterRemaining: args.afterRemaining,
        matches: args.matches,
        matchedAfterIdByBeforeId: args.matchedAfterIdByBeforeId,
        matchedBeforeIdByAfterId: args.matchedBeforeIdByAfterId
      });
      matchedAny = true;
    }
  }

  return matchedAny;
}

function buildAmbiguousMatches(
  beforeRemaining: Map<string, SnapshotLineRecord>,
  afterRemaining: Map<string, SnapshotLineRecord>,
  matchedAfterIdByBeforeId: Map<string, string>,
  matchedBeforeIdByAfterId: Map<string, string>
): CompareQuotesAmbiguousMatch[] {
  const ambiguousMatches: CompareQuotesAmbiguousMatch[] = [];
  const seen = new Set<string>();

  collectAmbiguousGroups({
    beforeLines: Array.from(beforeRemaining.values()),
    afterLines: Array.from(afterRemaining.values()),
    basis: 'quote_action_source_asset_id',
    buildKey: buildSourceAssetMatchKey,
    push: (match) => pushAmbiguousMatch(match, ambiguousMatches, seen)
  });
  collectAmbiguousGroups({
    beforeLines: Array.from(beforeRemaining.values()),
    afterLines: Array.from(afterRemaining.values()),
    basis: 'structural_key',
    buildKey: (line) => buildStructuralMatchKey(line, matchedAfterIdByBeforeId, matchedBeforeIdByAfterId),
    push: (match) => pushAmbiguousMatch(match, ambiguousMatches, seen)
  });
  collectAmbiguousGroups({
    beforeLines: Array.from(beforeRemaining.values()),
    afterLines: Array.from(afterRemaining.values()),
    basis: 'structural_key_plus_line_number',
    buildKey: (line) => {
      const structuralKey = buildStructuralMatchKey(line, matchedAfterIdByBeforeId, matchedBeforeIdByAfterId);
      const lineNumber = normalizeScalar(line.LineNumber);
      if (structuralKey === null || lineNumber === null) {
        return null;
      }

      return `${structuralKey}|line:${lineNumber}`;
    },
    push: (match) => pushAmbiguousMatch(match, ambiguousMatches, seen)
  });

  return ambiguousMatches;
}

function collectAmbiguousGroups(args: {
  beforeLines: SnapshotLineRecord[];
  afterLines: SnapshotLineRecord[];
  basis: CompareQuotesAmbiguousMatch['basis'];
  buildKey: (line: SnapshotLineRecord) => string | null;
  push: (match: CompareQuotesAmbiguousMatch) => void;
}): void {
  const beforeGroups = groupLinesByKey(args.beforeLines, args.buildKey);
  const afterGroups = groupLinesByKey(args.afterLines, args.buildKey);

  for (const [key, beforeGroup] of Array.from(beforeGroups.entries())) {
    const afterGroup = afterGroups.get(key);
    if (!afterGroup) {
      continue;
    }

    if (beforeGroup.length === 1 && afterGroup.length === 1) {
      continue;
    }

    args.push({
      basis: args.basis,
      before_line_ids: beforeGroup.map((line) => String(line.Id)),
      after_line_ids: afterGroup.map((line) => String(line.Id))
    });
  }
}

function pushAmbiguousMatch(
  match: CompareQuotesAmbiguousMatch,
  ambiguousMatches: CompareQuotesAmbiguousMatch[],
  seen: Set<string>
): void {
  const dedupeKey = [match.basis, match.before_line_ids.join(','), '->', match.after_line_ids.join(',')].join('|');
  if (seen.has(dedupeKey)) {
    return;
  }

  seen.add(dedupeKey);
  ambiguousMatches.push(match);
}

function recordMatch(args: {
  before: SnapshotLineRecord;
  after: SnapshotLineRecord;
  basis: CompareQuotesMatchBasis;
  beforeRemaining: Map<string, SnapshotLineRecord>;
  afterRemaining: Map<string, SnapshotLineRecord>;
  matches: LineMatch[];
  matchedAfterIdByBeforeId: Map<string, string>;
  matchedBeforeIdByAfterId: Map<string, string>;
}): void {
  const beforeId = String(args.before.Id);
  const afterId = String(args.after.Id);

  if (!args.beforeRemaining.has(beforeId) || !args.afterRemaining.has(afterId)) {
    return;
  }

  args.beforeRemaining.delete(beforeId);
  args.afterRemaining.delete(afterId);
  args.matchedAfterIdByBeforeId.set(beforeId, afterId);
  args.matchedBeforeIdByAfterId.set(afterId, beforeId);
  args.matches.push({
    before: args.before,
    after: args.after,
    basis: args.basis
  });
}

function groupLinesByKey(
  lines: SnapshotLineRecord[],
  buildKey: (line: SnapshotLineRecord) => string | null
): Map<string, SnapshotLineRecord[]> {
  const groups = new Map<string, SnapshotLineRecord[]>();

  for (const line of lines) {
    const key = buildKey(line);
    if (key === null) {
      continue;
    }

    const existing = groups.get(key);
    if (existing) {
      existing.push(line);
      continue;
    }

    groups.set(key, [line]);
  }

  return groups;
}

function buildSourceAssetMatchKey(line: SnapshotLineRecord): string | null {
  const sourceAssetId = normalizeScalar(line['QuoteAction.SourceAssetId']);
  const productId = normalizeScalar(line.Product2Id);
  if (sourceAssetId === null || productId === null) {
    return null;
  }

  const actionType = normalizeScalar(line['QuoteAction.Type']) ?? '(null)';
  return ['source_asset', sourceAssetId, productId, actionType].join('|');
}

function buildStructuralMatchKey(
  line: SnapshotLineRecord,
  matchedAfterIdByBeforeId: Map<string, string>,
  matchedBeforeIdByAfterId: Map<string, string>
): string | null {
  const productId = normalizeScalar(line.Product2Id);
  const pricebookEntryId = normalizeScalar(line.PricebookEntryId);
  const sellingModelType = normalizeScalar(line.SellingModelType);
  const startDate = normalizeScalar(line.StartDate) ?? '(null)';
  const endDate = normalizeScalar(line.EndDate) ?? '(null)';
  const parentMatchKey = buildParentMatchKey(line, matchedAfterIdByBeforeId, matchedBeforeIdByAfterId);

  if (productId === null || pricebookEntryId === null || sellingModelType === null || parentMatchKey === null) {
    return null;
  }

  return ['structural', productId, pricebookEntryId, sellingModelType, startDate, endDate, parentMatchKey].join('|');
}

function buildParentMatchKey(
  line: SnapshotLineRecord,
  matchedAfterIdByBeforeId: Map<string, string>,
  matchedBeforeIdByAfterId: Map<string, string>
): string | null {
  const parentId = normalizeScalar(line.ParentQuoteLineItemId);
  if (parentId === null) {
    return 'ROOT';
  }

  const matchedAfterId = matchedAfterIdByBeforeId.get(parentId);
  if (matchedAfterId) {
    return `PAIR:${parentId}->${matchedAfterId}`;
  }

  const matchedBeforeId = matchedBeforeIdByAfterId.get(parentId);
  if (matchedBeforeId) {
    return `PAIR:${matchedBeforeId}->${parentId}`;
  }

  return null;
}

function formatChangedLineIdentifier(beforeId: string, afterId: string): string {
  return beforeId === afterId ? beforeId : `${beforeId}->${afterId}`;
}

function getChangedFields(
  beforeRecord: Record<string, JsonValue>,
  afterRecord: Record<string, JsonValue>
): string[] {
  const fieldNames = Array.from(new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]));

  return fieldNames.filter((fieldName) => !areJsonValuesEqual(beforeRecord[fieldName], afterRecord[fieldName]));
}

function areJsonValuesEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) {
    return true;
  }

  if (left === undefined || right === undefined || left === null || right === null) {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((leftItem, index) => areJsonValuesEqual(leftItem, right[index]));
  }

  if (isJsonObject(left) || isJsonObject(right)) {
    if (!isJsonObject(left) || !isJsonObject(right)) {
      return false;
    }

    const keys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)]));
    return keys.every((key) => areJsonValuesEqual(left[key], right[key]));
  }

  return false;
}

function indexLinesById(lines: SnapshotLineRecord[], snapshotLabel: 'before' | 'after'): Map<string, SnapshotLineRecord> {
  const linesById = new Map<string, SnapshotLineRecord>();
  const duplicateIds = new Set<string>();

  for (const line of lines) {
    const lineId = String(line.Id);
    if (linesById.has(lineId)) {
      duplicateIds.add(lineId);
      continue;
    }

    linesById.set(lineId, line);
  }

  if (duplicateIds.size > 0) {
    throw new Error(
      `compareQuotes received duplicate line Id values in the ${snapshotLabel} snapshot: ${Array.from(duplicateIds).join(', ')}`
    );
  }

  return linesById;
}

function normalizeScalar(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return String(value);
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
