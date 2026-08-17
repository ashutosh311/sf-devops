import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import type { EvidenceItem } from '../contracts/evidence';
import type { RuntimeStatus } from '../contracts/status';
import { compareQuotes, type CompareQuotesResult } from '../primitives/compare-quotes';
import {
  executeSnapshotLines,
  type ExecuteSnapshotLinesInput,
  type SnapshotLineRecord,
  type SnapshotLinesPrimitiveResult
} from '../primitives/snapshot-lines';
import {
  executeSnapshotQuote,
  type ExecuteSnapshotQuoteInput,
  type SnapshotQuotePrimitiveResult,
  type SnapshotQuoteRecord
} from '../primitives/snapshot-quote';

const PRICING_RELEVANT_QUOTE_FIELDS = new Set([
  'Pricebook2Id',
  'CalculationStatus',
  'StartDate',
  'ExpirationDate',
  'Subtotal',
  'TotalPrice',
  'TotalTaxAmount',
  'TotalPriceWithTax',
  'GrandTotal',
  'LineItemCount',
  'OriginalActionType'
]);

const PRICING_RELEVANT_LINE_FIELDS = new Set([
  'LineNumber',
  'Product2Id',
  'PricebookEntryId',
  'ParentQuoteLineItemId',
  'Quantity',
  'StartQuantity',
  'EndQuantity',
  'UnitPrice',
  'ListPrice',
  'NetUnitPrice',
  'NetTotalPrice',
  'Subtotal',
  'TotalPrice',
  'TotalLineAmount',
  'TotalAdjustmentAmount',
  'SellingModelType',
  'StartDate',
  'EndDate',
  'PriceWaterfallIdentifier',
  'QuoteActionId',
  'QuoteAction.Type',
  'QuoteAction.SourceAssetId'
]);

export const COMPARE_QUOTE_PRICING_HELP_TEXT = [
  'quote-runtime compare-quote-pricing',
  '',
  'Usage:',
  '  quote-runtime compare-quote-pricing --org-alias <alias> --before-quote-id <id> --after-quote-id <id>',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Compare-quote-pricing flags:',
  '  --before-quote-id <id>',
  '  --after-quote-id <id>',
  '',
  'Notes:',
  '  compare-quote-pricing composes persisted quote snapshots, line snapshots, and compare-quotes.',
  '  compare-quote-pricing is the persisted before/after pricing comparison lane in V1.',
  '  same-quote comparisons pair lines by raw QuoteLineItem.Id.',
  '  cross-quote comparisons use conservative staged matching and abstain on ambiguity rather than forcing risky matches.',
  '  line quantity and pricing values are comparison payload, not identity keys.',
  '',
  'Example:',
  '  quote-runtime compare-quote-pricing --org-alias <alias> --before-quote-id <id> --after-quote-id <id>'
].join('\n');

const COMPARE_QUOTE_PRICING_FLAG_DEFINITIONS = {
  'before-quote-id': Flags.string({
    required: true,
    helpValue: '<id>',
    summary: 'Target before quote id for the persisted comparison baseline.'
  }),
  'after-quote-id': Flags.string({
    required: true,
    helpValue: '<id>',
    summary: 'Target after quote id for the persisted comparison target.'
  })
};

export type CompareQuotePricingCommandFlags = {
  beforeQuoteId: string;
  afterQuoteId: string;
};

export type CompareQuotePricingSnapshot = {
  quote: SnapshotQuoteRecord | null;
  lines: SnapshotLineRecord[];
};

export type CompareQuotePricingResult = {
  before_snapshot: CompareQuotePricingSnapshot;
  after_snapshot: CompareQuotePricingSnapshot;
  matching_strategy: CompareQuotesResult['matching_strategy'];
  quote_diff: {
    changed_fields: string[];
    before: SnapshotQuoteRecord | null;
    after: SnapshotQuoteRecord | null;
  };
  line_diff: CompareQuotesResult['line_diff'];
  changed_fields: string[];
  recommended_next_commands: string[];
};

export type CompareQuotePricingExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type BuildCompareQuotePricingEnvelopeInput = {
  globalFlags: GlobalFlags;
  commandFlags: CompareQuotePricingCommandFlags;
  beforeQuote: SnapshotQuotePrimitiveResult;
  beforeLines: SnapshotLinesPrimitiveResult;
  afterQuote: SnapshotQuotePrimitiveResult;
  afterLines: SnapshotLinesPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
};

export type CompareQuotePricingCommandDependencies = {
  executeSnapshotQuote?: (input: ExecuteSnapshotQuoteInput) => Promise<SnapshotQuotePrimitiveResult>;
  executeSnapshotLines?: (input: ExecuteSnapshotLinesInput) => Promise<SnapshotLinesPrimitiveResult>;
};

export async function parseCompareQuotePricingFlags(argv: string[]): Promise<CompareQuotePricingCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: COMPARE_QUOTE_PRICING_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'before-quote-id': string;
      'after-quote-id': string;
    };
  };

  return {
    beforeQuoteId: parsed.flags['before-quote-id'],
    afterQuoteId: parsed.flags['after-quote-id']
  };
}

export function renderCompareQuotePricingHelp(): string {
  return COMPARE_QUOTE_PRICING_HELP_TEXT;
}

export function buildCompareQuotePricingEnvelope(input: BuildCompareQuotePricingEnvelopeInput): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('compare-quote-pricing envelope requires a resolved org alias.');
  }

  const scenarioResult = buildScenarioResult(input);
  const scenarioStatus = determineScenarioStatus(input, scenarioResult);

  return makeEnvelope({
    command: 'compare-quote-pricing',
    status: scenarioStatus,
    summary: {
      primary_subject: `${input.commandFlags.beforeQuoteId} -> ${input.commandFlags.afterQuoteId}`,
      status_reason: buildCompareQuotePricingStatusReason(scenarioStatus),
      primary_lane: 'persisted_comparison',
      verification_anchor: `compare:${input.commandFlags.beforeQuoteId}:${input.commandFlags.afterQuoteId}`,
      next_suggested_command: buildRecommendedNextCommands(scenarioStatus)[0] ?? null,
      key_counts: {
        changed_fields: scenarioResult.changed_fields.length,
        quote_changed_fields: scenarioResult.quote_diff.changed_fields.length,
        changed_lines: scenarioResult.line_diff.changed.length,
        added_lines: scenarioResult.line_diff.added.length,
        removed_lines: scenarioResult.line_diff.removed.length,
        ambiguous_line_matches: scenarioResult.line_diff.ambiguous.length
      }
    } satisfies Record<string, JsonValue>,
    result: compareQuotePricingResultToJsonRecord(scenarioResult),
    warnings: [
      ...buildCompareQuotePricingMatcherWarnings(scenarioResult, scenarioStatus),
      ...input.beforeQuote.warnings,
      ...input.beforeLines.warnings,
      ...input.afterQuote.warnings,
      ...input.afterLines.warnings
    ],
    errors: [
      ...input.beforeQuote.errors,
      ...input.beforeLines.errors,
      ...input.afterQuote.errors,
      ...input.afterLines.errors
    ],
    evidence: buildCompareQuotePricingEvidence(input, scenarioResult, scenarioStatus),
    meta: {
      org_alias: input.globalFlags.orgAlias,
      generated_at: input.generatedAt ?? new Date().toISOString(),
      duration_ms: input.durationMs ?? 0,
      source_files: []
    }
  });
}

export function renderCompareQuotePricingText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as CompareQuotePricingResult;
  const lines = [
    'quote-runtime compare-quote-pricing',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `before quote id: ${String(result.before_snapshot.quote?.Id ?? '(none)')}`,
    `after quote id: ${String(result.after_snapshot.quote?.Id ?? '(none)')}`,
    `matching mode: ${result.matching_strategy.mode}`,
    `changed fields: ${result.changed_fields.length}`,
    `quote changed fields: ${formatStringList(result.quote_diff.changed_fields)}`,
    `line diff counts: changed=${result.line_diff.changed.length} added=${result.line_diff.added.length} removed=${result.line_diff.removed.length} ambiguous=${result.line_diff.ambiguous.length}`,
    `recommended next commands: ${formatStringList(result.recommended_next_commands)}`
  ];

  if (envelope.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of envelope.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  if (envelope.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const error of envelope.errors) {
      lines.push(`- ${error}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

const COMPARE_QUOTE_PRICING_SPEC: EnvelopeCommandSpec<CompareQuotePricingCommandDependencies> = {
  commandName: 'compare-quote-pricing',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseCompareQuotePricingFlags(argv);
    const runSnapshotQuote = deps.executeSnapshotQuote ?? executeSnapshotQuote;
    const runSnapshotLines = deps.executeSnapshotLines ?? executeSnapshotLines;

    const beforeQuote = await runSnapshotQuote({
      orgAlias: globalFlags.orgAlias!,
      quoteId: commandFlags.beforeQuoteId
    });
    const beforeLines = await runSnapshotLines({
      orgAlias: globalFlags.orgAlias!,
      quoteId: commandFlags.beforeQuoteId,
      lineIds: []
    });
    const afterQuote = await runSnapshotQuote({
      orgAlias: globalFlags.orgAlias!,
      quoteId: commandFlags.afterQuoteId
    });
    const afterLines = await runSnapshotLines({
      orgAlias: globalFlags.orgAlias!,
      quoteId: commandFlags.afterQuoteId,
      lineIds: []
    });

    return buildCompareQuotePricingEnvelope({
      globalFlags,
      commandFlags,
      beforeQuote,
      beforeLines,
      afterQuote,
      afterLines,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderCompareQuotePricingText
};

export async function runCompareQuotePricingCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: CompareQuotePricingCommandDependencies = {}
): Promise<CompareQuotePricingExecution> {
  return runEnvelopeCommand(COMPARE_QUOTE_PRICING_SPEC, argv, globalFlags, io, dependencies);
}

function buildScenarioResult(input: BuildCompareQuotePricingEnvelopeInput): CompareQuotePricingResult {
  const beforeSnapshot: CompareQuotePricingSnapshot = {
    quote: input.beforeQuote.result.quote,
    lines: input.beforeLines.result.lines
  };
  const afterSnapshot: CompareQuotePricingSnapshot = {
    quote: input.afterQuote.result.quote,
    lines: input.afterLines.result.lines
  };

  if (
    input.beforeQuote.status !== 'ok' ||
    input.afterQuote.status !== 'ok' ||
    input.beforeQuote.result.quote === null ||
    input.afterQuote.result.quote === null ||
    input.beforeLines.status !== 'ok' ||
    input.afterLines.status !== 'ok'
  ) {
    const sameQuote = input.commandFlags.beforeQuoteId === input.commandFlags.afterQuoteId;

    return {
      before_snapshot: beforeSnapshot,
      after_snapshot: afterSnapshot,
      matching_strategy: {
        mode: sameQuote ? 'same_quote_by_line_id' : 'cross_quote_conservative',
        same_quote: sameQuote,
        default_match_tiers: sameQuote
          ? ['line_id']
          : ['quote_action_source_asset_id', 'structural_key', 'structural_key_plus_line_number']
      },
      quote_diff: {
        changed_fields: [],
        before: input.beforeQuote.result.quote,
        after: input.afterQuote.result.quote
      },
      line_diff: {
        added: [],
        removed: [],
        changed: [],
        ambiguous: []
      },
      changed_fields: [],
      recommended_next_commands: buildRecommendedNextCommands(
        determineFailureStatus([
          input.beforeQuote.status,
          input.beforeLines.status,
          input.afterQuote.status,
          input.afterLines.status
        ])
      )
    };
  }

  const comparison = compareQuotes({
    before: {
      quote: input.beforeQuote.result.quote,
      lines: input.beforeLines.result.lines
    },
    after: {
      quote: input.afterQuote.result.quote,
      lines: input.afterLines.result.lines
    }
  });

  const quoteChangedFields = comparison.quote_diff.changed_fields.filter((fieldName) =>
    PRICING_RELEVANT_QUOTE_FIELDS.has(fieldName)
  );
  const changedLines = comparison.line_diff.changed
    .map((line) => ({
      ...line,
      changed_fields: line.changed_fields.filter((fieldName) => PRICING_RELEVANT_LINE_FIELDS.has(fieldName))
    }))
    .filter((line) => line.changed_fields.length > 0);
  const changedFields = [
    ...quoteChangedFields.map((fieldName) => `quote.${fieldName}`),
    ...changedLines.flatMap((line) => {
      const lineIdentifier = line.id === line.paired_id ? line.id : `${line.id}->${line.paired_id}`;
      return line.changed_fields.map((fieldName) => `line.${lineIdentifier}.${fieldName}`);
    }),
    ...comparison.line_diff.removed.map((line) => `line.${String(line.Id)}`),
    ...comparison.line_diff.added.map((line) => `line.${String(line.Id)}`)
  ];
  const comparisonStatus: RuntimeStatus = changedFields.length > 0 ? 'changed' : 'no_change';

  return {
    before_snapshot: beforeSnapshot,
    after_snapshot: afterSnapshot,
    matching_strategy: comparison.matching_strategy,
    quote_diff: {
      changed_fields: quoteChangedFields,
      before: comparison.quote_diff.before,
      after: comparison.quote_diff.after
    },
    line_diff: {
      added: comparison.line_diff.added,
      removed: comparison.line_diff.removed,
      changed: changedLines,
      ambiguous: comparison.line_diff.ambiguous
    },
    changed_fields: changedFields,
    recommended_next_commands: buildRecommendedNextCommands(comparisonStatus)
  };
}

function determineScenarioStatus(
  input: BuildCompareQuotePricingEnvelopeInput,
  scenarioResult: CompareQuotePricingResult
): RuntimeStatus {
  if (
    input.beforeQuote.status !== 'ok' ||
    input.afterQuote.status !== 'ok' ||
    input.beforeLines.status !== 'ok' ||
    input.afterLines.status !== 'ok' ||
    input.beforeQuote.result.quote === null ||
    input.afterQuote.result.quote === null
  ) {
    return determineFailureStatus([
      input.beforeQuote.result.quote === null || input.afterQuote.result.quote === null ? 'no_match' : 'ok',
      input.beforeQuote.status,
      input.beforeLines.status,
      input.afterQuote.status,
      input.afterLines.status
    ]);
  }

  return scenarioResult.changed_fields.length > 0 ? 'changed' : 'no_change';
}

function determineFailureStatus(statuses: RuntimeStatus[]): RuntimeStatus {
  if (statuses.includes('error')) {
    return 'error';
  }

  if (statuses.includes('unsupported')) {
    return 'unsupported';
  }

  if (statuses.includes('no_match')) {
    return 'no_match';
  }

  if (statuses.includes('partial')) {
    return 'partial';
  }

  return 'ok';
}

function buildCompareQuotePricingStatusReason(status: RuntimeStatus): string {
  switch (status) {
    case 'changed':
      return 'Persisted before/after pricing snapshots changed across the targeted quotes.';
    case 'no_change':
      return 'Persisted before/after pricing snapshots are identical for the targeted quotes.';
    case 'no_match':
      return 'Persisted before/after pricing comparison could not find one or both targeted quotes.';
    case 'partial':
      return 'Persisted before/after pricing comparison completed with partial snapshot coverage.';
    case 'unsupported':
      return 'Persisted before/after pricing comparison is unsupported in the current environment.';
    case 'error':
      return 'Persisted before/after pricing comparison failed before a normalized diff could be produced.';
    case 'ok':
    case 'warn':
      return 'Persisted before/after pricing comparison completed.';
  }
}

function buildRecommendedNextCommands(status: RuntimeStatus): string[] {
  switch (status) {
    case 'changed':
      return ['inspect-pricing-waterfall', 'inspect-rlm-context'];
    case 'no_change':
      return [];
    case 'no_match':
      return ['snapshot-quote'];
    case 'partial':
      return ['snapshot-lines'];
    case 'unsupported':
    case 'error':
      return ['doctor'];
    case 'ok':
    case 'warn':
      return [];
  }
}

function buildCompareQuotePricingEvidence(
  input: BuildCompareQuotePricingEnvelopeInput,
  scenarioResult: CompareQuotePricingResult,
  scenarioStatus: RuntimeStatus
): EvidenceItem[] {
  const primitiveEvidence = [
    ...input.beforeQuote.evidence,
    ...input.beforeLines.evidence,
    ...input.afterQuote.evidence,
    ...input.afterLines.evidence
  ];

  if (scenarioStatus !== 'changed' && scenarioStatus !== 'no_change') {
    return primitiveEvidence;
  }

  return [
    {
      claim:
        scenarioStatus === 'changed'
          ? 'Persisted before/after quote snapshots show pricing-relevant changes across the targeted quotes.'
          : 'Persisted before/after quote snapshots show no pricing-relevant changes across the targeted quotes.',
      evidence_level: 'org_proven',
      proof_source: [
        `quote:${input.commandFlags.beforeQuoteId}`,
        `quote:${input.commandFlags.afterQuoteId}`,
        `matching_mode:${scenarioResult.matching_strategy.mode}`,
        ...scenarioResult.changed_fields
      ],
      limitations: scenarioResult.matching_strategy.same_quote
        ? 'Comparison evidence is limited to the locked quote and line snapshot field sets.'
        : 'Cross-quote comparison evidence is limited to the locked snapshot field set and conservative line matching tiers that abstain instead of guessing.',
      source_refs: []
    },
    ...primitiveEvidence
  ];
}

function buildCompareQuotePricingMatcherWarnings(
  scenarioResult: CompareQuotePricingResult,
  scenarioStatus: RuntimeStatus
): string[] {
  if (scenarioStatus !== 'changed' && scenarioStatus !== 'no_change') {
    return [];
  }

  if (scenarioResult.matching_strategy.same_quote) {
    return [];
  }

  const warnings = [
    'Cross-quote line matching is conservative: same-quote comparisons use line Ids, while cross-quote comparisons only pair lines through unique QuoteAction.SourceAssetId or structural business keys and otherwise abstain.'
  ];

  if (scenarioResult.line_diff.ambiguous.length > 0) {
    warnings.push(
      `Cross-quote comparison left ${scenarioResult.line_diff.ambiguous.length} ambiguous line match group(s) unresolved; those lines remain reported as added/removed instead of forced matches.`
    );
  }

  return warnings;
}

function compareQuotePricingResultToJsonRecord(result: CompareQuotePricingResult): Record<string, JsonValue> {
  return {
    before_snapshot: {
      quote: result.before_snapshot.quote,
      lines: result.before_snapshot.lines
    },
    after_snapshot: {
      quote: result.after_snapshot.quote,
      lines: result.after_snapshot.lines
    },
    matching_strategy: result.matching_strategy,
    quote_diff: {
      changed_fields: [...result.quote_diff.changed_fields],
      before: result.quote_diff.before,
      after: result.quote_diff.after
    },
    line_diff: {
      added: result.line_diff.added,
      removed: result.line_diff.removed,
      changed: result.line_diff.changed,
      ambiguous: result.line_diff.ambiguous
    },
    changed_fields: [...result.changed_fields],
    recommended_next_commands: [...result.recommended_next_commands]
  };
}

function formatStringList(values: readonly string[]): string {
  return values.length === 0 ? '(none)' : values.join(', ');
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const COMPARE_QUOTE_PRICING_COMMAND_SPEC = defineCommand({
  name: 'compare-quote-pricing',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Compare persisted before/after quote pricing snapshots across two targeted quote ids using same-quote id pairing or conservative cross-quote matching.',
  ownership: {
        primary_owner: 'pricing-runtime-debug',
        secondary_escalation: ['runtime-context-inspection'],
        shared_library_dependencies: ['snapshot_quote', 'snapshot_lines', 'compare_quotes', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['before_quote_id', 'after_quote_id'],
        recommended_selectors: [],
        status_reason: 'Comparison requires both before and after quote ids.'
  },
    quickStart: 'quote-runtime compare-quote-pricing --org-alias <alias> --before-quote-id <id> --after-quote-id <id>',
  renderHelp: renderCompareQuotePricingHelp,
  run: runCompareQuotePricingCommand
});
