import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import type { EvidenceItem } from '../contracts/evidence';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import type { RuntimeStatus } from '../contracts/status';
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
import { normalizeOptionalId, normalizeOptionalText, normalizeRepeatableIds } from '../selectors/runtime-selectors';
import { routeSymptom } from '../primitives/symptom-routing';

export const EXPLAIN_PRICE_HELP_TEXT = [
  'quote-runtime explain-price',
  '',
  'Usage:',
  '  quote-runtime explain-price --org-alias <alias> --quote-id <id> [--line-id <id> ...] --expected-change <text>',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Explain-price flags:',
  '  --quote-id <id>',
  '  --line-id <id>',
  '  --expected-change <text>',
  '',
  'Notes:',
  '  explain-price stays persisted-first by composing quote and line snapshots before suggesting any context bridge escalation.',
  '  explain-price only escalates to inspect-rlm-context when persisted quote and line evidence does not explain the unexpected price.',
  '',
  'Example:',
  '  quote-runtime explain-price --org-alias <alias> --quote-id <id> --line-id <id> --expected-change "line should use the discounted renewal price"'
].join('\n');

const EXPLAIN_PRICE_FLAG_DEFINITIONS = {
  'quote-id': Flags.string({
    required: true,
    helpValue: '<id>',
    summary: 'Target quote id for present-but-unexpected price analysis.'
  }),
  'line-id': Flags.string({
    multiple: true,
    helpValue: '<id>',
    summary: 'Optional quote line ids used to narrow persisted price analysis.'
  }),
  'expected-change': Flags.string({
    required: true,
    helpValue: '<text>',
    summary: 'Operator-stated expectation used to decide whether context escalation is still needed.'
  })
};

export type ExplainPriceCommandFlags = {
  quoteId: string;
  lineIds: string[];
  expectedChange: string;
};

export type ExplainPriceResult = {
  symptom_class: string;
  persisted_evidence: string[];
  overlay_findings: string[];
  context_bridge_needed: boolean;
  recommended_next_commands: string[];
};

export type ExplainPriceExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type BuildExplainPriceEnvelopeInput = {
  globalFlags: GlobalFlags;
  commandFlags: ExplainPriceCommandFlags;
  quoteSnapshot: SnapshotQuotePrimitiveResult;
  lineSnapshot: SnapshotLinesPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
};

export type ExplainPriceCommandDependencies = {
  executeSnapshotQuote?: (input: ExecuteSnapshotQuoteInput) => Promise<SnapshotQuotePrimitiveResult>;
  executeSnapshotLines?: (input: ExecuteSnapshotLinesInput) => Promise<SnapshotLinesPrimitiveResult>;
};

export async function parseExplainPriceFlags(argv: string[]): Promise<ExplainPriceCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: EXPLAIN_PRICE_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'quote-id': string;
      'line-id'?: string[];
      'expected-change': string;
    };
  };

  return {
    quoteId: normalizeOptionalId(parsed.flags['quote-id'], 'quote-id') ?? '',
    lineIds: normalizeRepeatableIds(parsed.flags['line-id'], 'line-id'),
    expectedChange: normalizeOptionalText(parsed.flags['expected-change']) ?? ''
  };
}

export function renderExplainPriceHelp(): string {
  return EXPLAIN_PRICE_HELP_TEXT;
}

export function buildExplainPriceEnvelope(input: BuildExplainPriceEnvelopeInput): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('explain-price envelope requires a resolved org alias.');
  }

  const route = routeSymptom('unexpected price on this quote line');
  const result = buildExplainPriceResult(input);
  const status = determineExplainPriceStatus(input, result);

  return makeEnvelope({
    command: 'explain-price',
    status,
    summary: {
      primary_subject: buildPrimarySubject(input.commandFlags),
      status_reason: buildExplainPriceStatusReason(status, input, result),
      primary_lane: route.primary_lane,
      verification_anchor: buildVerificationAnchor(input.commandFlags),
      symptom_class: route.symptom_class,
      next_suggested_command: result.recommended_next_commands[0] ?? null,
      key_counts: {
        persisted_evidence: result.persisted_evidence.length,
        scoped_lines: input.lineSnapshot.result.lines.length,
        missing_line_ids: input.lineSnapshot.result.selection.missing_line_ids.length,
        recommended_next_commands: result.recommended_next_commands.length
      }
    } satisfies Record<string, JsonValue>,
    result: explainPriceResultToJsonRecord(result),
    warnings: [...input.quoteSnapshot.warnings, ...input.lineSnapshot.warnings],
    errors: [...input.quoteSnapshot.errors, ...input.lineSnapshot.errors],
    evidence: buildExplainPriceEvidence(input, result),
    meta: {
      org_alias: input.globalFlags.orgAlias,
      generated_at: input.generatedAt ?? new Date().toISOString(),
      duration_ms: input.durationMs ?? 0,
      source_files: []
    }
  });
}

export function renderExplainPriceText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as ExplainPriceResult;
  const lines = [
    'quote-runtime explain-price',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `subject: ${String(envelope.summary.primary_subject ?? '(unknown)')}`,
    `symptom class: ${result.symptom_class}`,
    `context bridge needed: ${result.context_bridge_needed ? 'yes' : 'no'}`,
    `persisted evidence: ${formatStringList(result.persisted_evidence)}`,
    `overlay findings: ${formatStringList(result.overlay_findings)}`,
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

const EXPLAIN_PRICE_SPEC: EnvelopeCommandSpec<ExplainPriceCommandDependencies> = {
  commandName: 'explain-price',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseExplainPriceFlags(argv);
    const runSnapshotQuote = deps.executeSnapshotQuote ?? executeSnapshotQuote;
    const runSnapshotLines = deps.executeSnapshotLines ?? executeSnapshotLines;
    const [quoteSnapshot, lineSnapshot] = await Promise.all([
      runSnapshotQuote({ orgAlias: globalFlags.orgAlias!, quoteId: commandFlags.quoteId }),
      runSnapshotLines({ orgAlias: globalFlags.orgAlias!, quoteId: commandFlags.quoteId, lineIds: commandFlags.lineIds })
    ]);

    return buildExplainPriceEnvelope({
      globalFlags,
      commandFlags,
      quoteSnapshot,
      lineSnapshot,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderExplainPriceText
};

export async function runExplainPriceCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: ExplainPriceCommandDependencies = {}
): Promise<ExplainPriceExecution> {
  return runEnvelopeCommand(EXPLAIN_PRICE_SPEC, argv, globalFlags, io, dependencies);
}

function buildExplainPriceResult(
  input: BuildExplainPriceEnvelopeInput
): ExplainPriceResult {
  const route = routeSymptom('unexpected price on this quote line');
  const quote = input.quoteSnapshot.result.quote;
  const lines = input.lineSnapshot.result.lines;
  const missingLineIds = input.lineSnapshot.result.selection.missing_line_ids;

  if (input.quoteSnapshot.status !== 'ok' || quote === null || input.lineSnapshot.status === 'error' || input.lineSnapshot.status === 'unsupported') {
    return {
      symptom_class: route.symptom_class,
      persisted_evidence: [],
      overlay_findings: [
        'Shared route logic classified the scenario as wrong-price and kept lifecycle and structure overlays out of the default explain-price lane.'
      ],
      context_bridge_needed: false,
      recommended_next_commands: buildFailureNextCommands(determineFailureStatus([input.quoteSnapshot.status, input.lineSnapshot.status]))
    };
  }

  if (input.lineSnapshot.status === 'partial') {
    return {
      symptom_class: route.symptom_class,
      persisted_evidence: buildPersistedEvidence(quote, lines, input.commandFlags, missingLineIds),
      overlay_findings: [
        `Shared route logic kept lifecycle and structure overlays out of scope because explain-price could only resolve ${lines.length} of ${input.commandFlags.lineIds.length} requested line ids from persisted data.`
      ],
      context_bridge_needed: false,
      recommended_next_commands: ['snapshot-lines']
    };
  }

  const persistedEvidence = buildPersistedEvidence(quote, lines, input.commandFlags, missingLineIds);
  const contextBridgeNeeded = shouldEscalateToContextBridge(quote, lines);

  return {
    symptom_class: route.symptom_class,
    persisted_evidence: persistedEvidence,
    overlay_findings: [
      contextBridgeNeeded
        ? 'Shared route logic kept lifecycle and structure overlays out of scope and escalated to the RLM context bridge only because persisted evidence did not isolate the pricing rule path.'
        : 'Shared route logic classified the scenario as wrong-price and did not require lifecycle or structure overlays for the persisted explanation.'
    ],
    context_bridge_needed: contextBridgeNeeded,
    recommended_next_commands: contextBridgeNeeded ? ['inspect-rlm-context'] : []
  };
}

function determineExplainPriceStatus(
  input: BuildExplainPriceEnvelopeInput,
  result: ExplainPriceResult
): RuntimeStatus {
  if (input.quoteSnapshot.status !== 'ok' || input.quoteSnapshot.result.quote === null || input.lineSnapshot.status !== 'ok') {
    return determineFailureStatus([
      input.quoteSnapshot.result.quote === null ? 'no_match' : 'ok',
      input.quoteSnapshot.status,
      input.lineSnapshot.status
    ]);
  }

  return result.context_bridge_needed ? 'partial' : 'ok';
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

function buildFailureNextCommands(status: RuntimeStatus): string[] {
  switch (status) {
    case 'no_match':
      return ['snapshot-quote'];
    case 'partial':
      return ['snapshot-lines'];
    case 'unsupported':
    case 'error':
      return ['doctor'];
    case 'ok':
    case 'warn':
    case 'changed':
    case 'no_change':
      return [];
  }
}

function buildPersistedEvidence(
  quote: SnapshotQuoteRecord,
  scopedLines: SnapshotLineRecord[],
  commandFlags: ExplainPriceCommandFlags,
  missingLineIds: readonly string[]
): string[] {
  const resolvedScopeCount = scopedLines.length;
  const requestedScopeCount = commandFlags.lineIds.length;
  const evidence = [
    `Persisted quote ${commandFlags.quoteId} is currently ${String(quote.CalculationStatus ?? 'unknown')} with total price ${formatJsonValue(quote.TotalPrice)}.`,
    commandFlags.lineIds.length > 0
      ? missingLineIds.length > 0
        ? `Persisted analysis resolved ${resolvedScopeCount} of ${requestedScopeCount} requested line(s) for expected change '${commandFlags.expectedChange}'. Missing requested line ids: ${missingLineIds.join(', ')}.`
        : `Persisted analysis was narrowed to ${resolvedScopeCount} requested line(s) for expected change '${commandFlags.expectedChange}'.`
      : `Persisted analysis examined all ${scopedLines.length} quote line(s) for expected change '${commandFlags.expectedChange}'.`
  ];

  if (scopedLines.length === 0) {
    evidence.push('No persisted quote lines matched the requested scope, so line-level pricing evidence is unavailable.');
    return evidence;
  }

  for (const line of scopedLines) {
    const lineId = String(line.Id ?? '(unknown)');
    const quantity = numericValue(line.Quantity);
    const listPrice = numericValue(line.ListPrice);
    const unitPrice = numericValue(line.UnitPrice);
    const netUnitPrice = numericValue(line.NetUnitPrice);
    const totalAdjustment = numericValue(line.TotalAdjustmentAmount);
    const totalPrice = numericValue(line.TotalPrice);

    if (totalAdjustment !== null && totalAdjustment !== 0) {
      evidence.push(
        `Line ${lineId} carries persisted TotalAdjustmentAmount ${formatNumber(totalAdjustment)}, so the current price is already diverging from the base list price inside persisted quote data.`
      );
      continue;
    }

    if (listPrice !== null && unitPrice !== null && listPrice !== unitPrice) {
      evidence.push(
        `Line ${lineId} has persisted ListPrice ${formatNumber(listPrice)} versus UnitPrice ${formatNumber(unitPrice)}, showing the unexpected price is already visible in stored line pricing fields.`
      );
      continue;
    }

    if (unitPrice !== null && netUnitPrice !== null && unitPrice !== netUnitPrice) {
      evidence.push(
        `Line ${lineId} has persisted UnitPrice ${formatNumber(unitPrice)} versus NetUnitPrice ${formatNumber(netUnitPrice)}, so the stored pricing waterfall already explains the current line amount.`
      );
      continue;
    }

    if (quantity !== null && unitPrice !== null && totalPrice !== null && Math.abs(totalPrice - quantity * unitPrice) > 0.000001) {
      evidence.push(
        `Line ${lineId} has persisted Quantity ${formatNumber(quantity)} and UnitPrice ${formatNumber(unitPrice)}, but TotalPrice ${formatNumber(totalPrice)} does not equal the simple quantity x unit-price expectation.`
      );
      continue;
    }

    evidence.push(
      `Line ${lineId} stays present with persisted ListPrice ${formatJsonValue(line.ListPrice)}, UnitPrice ${formatJsonValue(line.UnitPrice)}, NetUnitPrice ${formatJsonValue(line.NetUnitPrice)}, TotalAdjustmentAmount ${formatJsonValue(line.TotalAdjustmentAmount)}, and TotalPrice ${formatJsonValue(line.TotalPrice)}.`
    );
  }

  return evidence;
}

function shouldEscalateToContextBridge(quote: SnapshotQuoteRecord, scopedLines: SnapshotLineRecord[]): boolean {
  if (String(quote.CalculationStatus ?? '').toLowerCase() !== 'calculated') {
    return false;
  }

  if (scopedLines.length === 0) {
    return true;
  }

  return scopedLines.every((line) => {
    const quantity = numericValue(line.Quantity);
    const listPrice = numericValue(line.ListPrice);
    const unitPrice = numericValue(line.UnitPrice);
    const netUnitPrice = numericValue(line.NetUnitPrice);
    const totalAdjustment = numericValue(line.TotalAdjustmentAmount);
    const totalPrice = numericValue(line.TotalPrice);

    if (totalAdjustment !== null && totalAdjustment !== 0) {
      return false;
    }

    if (listPrice !== null && unitPrice !== null && listPrice !== unitPrice) {
      return false;
    }

    if (unitPrice !== null && netUnitPrice !== null && unitPrice !== netUnitPrice) {
      return false;
    }

    if (quantity !== null && unitPrice !== null && totalPrice !== null && Math.abs(totalPrice - quantity * unitPrice) > 0.000001) {
      return false;
    }

    return true;
  });
}

function explainPriceResultToJsonRecord(result: ExplainPriceResult): Record<string, JsonValue> {
  return {
    symptom_class: result.symptom_class,
    persisted_evidence: [...result.persisted_evidence],
    overlay_findings: [...result.overlay_findings],
    context_bridge_needed: result.context_bridge_needed,
    recommended_next_commands: [...result.recommended_next_commands]
  };
}

function buildExplainPriceEvidence(
  input: BuildExplainPriceEnvelopeInput,
  result: ExplainPriceResult
): EvidenceItem[] {
  const missingLineIds = input.lineSnapshot.result.selection.missing_line_ids;

  return [
    ...input.quoteSnapshot.evidence,
    ...input.lineSnapshot.evidence,
    {
      claim: input.lineSnapshot.status === 'partial'
        ? `Persisted quote evidence for ${input.commandFlags.quoteId} was available, but explain-price could only resolve part of the requested line scope (${missingLineIds.join(', ')}).`
        : result.context_bridge_needed
          ? `Persisted quote and line evidence for ${input.commandFlags.quoteId} stayed insufficient to explain the wrong-price symptom without the RLM context bridge.`
          : `Persisted quote and line evidence for ${input.commandFlags.quoteId} explained the wrong-price symptom without using lifecycle or structure overlays.`,
      evidence_level: 'org_proven',
      proof_source: [
        `quote:${input.commandFlags.quoteId}`,
        ...input.commandFlags.lineIds.map((lineId) => `line:${lineId}`),
        `expected_change:${input.commandFlags.expectedChange}`
      ],
      limitations: 'Explain-price stays persisted-first and does not claim rule-trace certainty unless later context inspection is run.',
      source_refs: [
        'specs/quoting-pricing-runtime/quoting-pricing-runtime-node-typescript-wave3-scenarios-build-plan.md',
        'specs/quoting-pricing-runtime/quoting-pricing-runtime-wave4-command-grammar-and-result-schemas.md'
      ]
    }
  ];
}

function buildPrimarySubject(commandFlags: ExplainPriceCommandFlags): string {
  return commandFlags.lineIds.length > 0
    ? `${commandFlags.quoteId} (${commandFlags.lineIds.length} scoped line id(s))`
    : commandFlags.quoteId;
}

function buildVerificationAnchor(commandFlags: ExplainPriceCommandFlags): string {
  return commandFlags.lineIds.length > 0
    ? `quote:${commandFlags.quoteId}:lines:${commandFlags.lineIds.join(',')}`
    : `quote:${commandFlags.quoteId}`;
}

function buildExplainPriceStatusReason(
  status: RuntimeStatus,
  input: BuildExplainPriceEnvelopeInput,
  result: ExplainPriceResult
): string {
  const { commandFlags } = input;

  switch (status) {
    case 'ok':
      return `Persisted quote and line evidence explained the unexpected price for '${commandFlags.expectedChange}' without needing context escalation.`;
    case 'partial':
      return input.lineSnapshot.status === 'partial'
        ? `Explain-price only resolved part of the requested line scope for '${commandFlags.expectedChange}', so rerun snapshot-lines or explain-price with line ids that exist on the quote before escalating.`
        : result.context_bridge_needed
          ? `Persisted quote and line evidence confirmed the present price but did not explain '${commandFlags.expectedChange}', so inspect-rlm-context is still required.`
          : 'Explain-price completed with partial persisted evidence.';
    case 'no_match':
      return 'Explain-price could not find the targeted persisted quote or line scope.';
    case 'unsupported':
      return 'Explain-price is unsupported in the current environment before a normalized persisted explanation could be built.';
    case 'error':
      return 'Explain-price failed before a normalized persisted explanation could be produced.';
    case 'warn':
    case 'changed':
    case 'no_change':
      return 'Explain-price completed.';
  }
}

function numericValue(value: JsonValue): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatJsonValue(value: JsonValue): string {
  return value === null ? 'null' : String(value);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function formatStringList(values: readonly string[]): string {
  return values.length > 0 ? values.join(' | ') : '(none)';
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const EXPLAIN_PRICE_COMMAND_SPEC = defineCommand({
  name: 'explain-price',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Explain a present but unexpected price from persisted quote and line evidence before escalating to context inspection.',
  ownership: {
        primary_owner: 'pricing-runtime-debug',
        secondary_escalation: ['runtime-context-inspection', 'config-runtime-bridge'],
        shared_library_dependencies: ['compare_quotes', 'route_logic', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['quote_id', 'expected_change'],
        recommended_selectors: ['line_ids'],
        status_reason: 'Explaining a present price requires the target quote and the expected change statement.'
  },
    quickStart: 'quote-runtime explain-price --org-alias <alias> --quote-id <id> --line-id <id> --expected-change "line should use the discounted renewal price"',
  renderHelp: renderExplainPriceHelp,
  run: runExplainPriceCommand
});
