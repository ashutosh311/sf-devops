import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import type { EvidenceItem } from '../contracts/evidence';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
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
import { normalizeOptionalId, normalizeOptionalText } from '../selectors/runtime-selectors';
import { routeSymptom } from '../primitives/symptom-routing';

export const TEST_PRICING_CHANGE_HELP_TEXT = [
  'quote-runtime test-pricing-change',
  '',
  'Usage:',
  '  quote-runtime test-pricing-change --org-alias <alias> --quote-id <id> --changed-artifact <text> [--expected-change <text>]',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Test-pricing-change flags:',
  '  --quote-id <id>',
  '  --changed-artifact <text>',
  '  --expected-change <text>',
  '',
  'Notes:',
  '  test-pricing-change remains explicitly read-only in V1.',
  '  test-pricing-change assumes the pricing change already happened outside the command.',
  '  test-pricing-change validates current persisted quote state and escalates only when persisted evidence is insufficient.',
  '',
  'Example:',
  '  quote-runtime test-pricing-change --org-alias <alias> --quote-id <id> --changed-artifact "pricing procedure v2" --expected-change "quote should now use the discounted renewal price"'
].join('\n');

const TEST_PRICING_CHANGE_FLAG_DEFINITIONS = {
  'quote-id': Flags.string({
    required: true,
    helpValue: '<id>',
    summary: 'Target quote id for read-only pricing-change validation.'
  }),
  'changed-artifact': Flags.string({
    required: true,
    helpValue: '<text>',
    summary: 'Short label describing the pricing metadata or configuration changed outside the tool.'
  }),
  'expected-change': Flags.string({
    required: false,
    helpValue: '<text>',
    summary: 'Optional operator expectation carried into the read-only verification plan.'
  })
};

export type TestPricingChangeCommandFlags = {
  quoteId: string;
  changedArtifact: string;
  expectedChange: string | null;
};

export type TestPricingChangeFinding = {
  finding_type: 'quote_snapshot' | 'line_snapshot' | 'current_state_consistency';
  observation: string;
  status: RuntimeStatus | CompareQuotesResult['status'];
  quote_id?: string;
  snapshot_type?: string;
  fields_observed?: string[];
  line_counts?: SnapshotLinesPrimitiveResult['result']['counts'];
  changed_fields?: string[];
  quote_diff?: CompareQuotesResult['quote_diff'];
  evidence: EvidenceItem[];
};

export type TestPricingChangeEscalationHint = {
  lane: 'runtime-context-inspection' | 'pricing-runtime-debug' | 'quote-runtime-mutations';
  recommended_command: string;
  when: string;
  why: string;
};

export type TestPricingChangeBeforeAfterSummary = {
  comparison_type: 'current_quote_vs_line_rollup';
  comparison_available: boolean;
  historical_before_after_available: false;
  comparison_status: CompareQuotesResult['status'] | 'unavailable';
  changed_fields: string[];
  quote_rollup_diff: CompareQuotesResult['quote_diff'] | null;
  line_rollup_counts: SnapshotLinesPrimitiveResult['result']['counts'];
  limitations: string;
};

export type TestPricingChangeResult = {
  changed_artifact: string;
  before_after_summary?: TestPricingChangeBeforeAfterSummary;
  persisted_findings: TestPricingChangeFinding[];
  escalation_hints: TestPricingChangeEscalationHint[];
  recommended_next_commands: string[];
};

export type TestPricingChangeExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

type CurrentStateComparison = {
  status: CompareQuotesResult['status'];
  changed_fields: string[];
  quote_diff: CompareQuotesResult['quote_diff'];
  line_rollup_counts: SnapshotLinesPrimitiveResult['result']['counts'];
};

export type BuildTestPricingChangeEnvelopeInput = {
  globalFlags: GlobalFlags;
  commandFlags: TestPricingChangeCommandFlags;
  quoteSnapshot: SnapshotQuotePrimitiveResult;
  lineSnapshot: SnapshotLinesPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
};

export type TestPricingChangeCommandDependencies = {
  executeSnapshotQuote?: (input: ExecuteSnapshotQuoteInput) => Promise<SnapshotQuotePrimitiveResult>;
  executeSnapshotLines?: (input: ExecuteSnapshotLinesInput) => Promise<SnapshotLinesPrimitiveResult>;
};

export async function parseTestPricingChangeFlags(argv: string[]): Promise<TestPricingChangeCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: TEST_PRICING_CHANGE_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'quote-id': string;
      'changed-artifact': string;
      'expected-change'?: string;
    };
  };

  return {
    quoteId: normalizeOptionalId(parsed.flags['quote-id'], 'quote-id') ?? '',
    changedArtifact: normalizeOptionalText(parsed.flags['changed-artifact']) ?? '',
    expectedChange: normalizeOptionalText(parsed.flags['expected-change'])
  };
}

export function renderTestPricingChangeHelp(): string {
  return TEST_PRICING_CHANGE_HELP_TEXT;
}

export function buildTestPricingChangeEnvelope(input: BuildTestPricingChangeEnvelopeInput): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('test-pricing-change envelope requires a resolved org alias.');
  }

  const route = routeSymptom('unexpected price after pricing change');
  const comparison = buildCurrentStateComparison(input.quoteSnapshot, input.lineSnapshot);
  const status = determineScenarioStatus(input.quoteSnapshot, input.lineSnapshot, comparison);
  const persistedFindings = buildPersistedFindings(input, comparison);
  const escalationHints = buildEscalationHints(status, input.commandFlags.expectedChange, comparison);
  const recommendedNextCommands = buildRecommendedNextCommands(status, escalationHints);
  const result = buildResult(input, comparison, persistedFindings, escalationHints, recommendedNextCommands);

  return makeEnvelope({
    command: 'test-pricing-change',
    status,
    summary: {
      primary_subject: input.commandFlags.quoteId,
      status_reason: buildStatusReason(status, input.commandFlags, comparison),
      primary_lane: route.primary_lane,
      verification_anchor: input.commandFlags.quoteId,
      symptom_class: route.symptom_class,
      next_suggested_command: recommendedNextCommands[0] ?? null,
      key_counts: {
        persisted_findings: persistedFindings.length,
        escalation_hints: escalationHints.length,
        comparison_changed_fields: comparison?.changed_fields.length ?? 0
      }
    } satisfies Record<string, JsonValue>,
    result: testPricingChangeResultToJsonRecord(result),
    warnings: buildWarnings(input),
    errors: [...input.quoteSnapshot.errors, ...input.lineSnapshot.errors],
    evidence: buildEvidence(input, comparison),
    meta: {
      org_alias: input.globalFlags.orgAlias,
      generated_at: input.generatedAt ?? new Date().toISOString(),
      duration_ms: input.durationMs ?? 0,
      source_files: []
    }
  });
}

export function renderTestPricingChangeText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as TestPricingChangeResult;
  const comparison = result.before_after_summary;
  const lines = [
    'quote-runtime test-pricing-change',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `quote id: ${String(envelope.summary.primary_subject ?? '(unknown)')}`,
    `changed artifact: ${result.changed_artifact}`,
    `comparison type: ${comparison?.comparison_type ?? '(unavailable)'}`,
    `comparison status: ${comparison?.comparison_status ?? '(unavailable)'}`,
    `recommended next commands: ${formatStringList(result.recommended_next_commands)}`
  ];

  lines.push('persisted findings:');
  for (const finding of result.persisted_findings) {
    lines.push(`- [${finding.finding_type}] ${finding.observation}`);
  }

  lines.push('escalation hints:');
  for (const hint of result.escalation_hints) {
    lines.push(`- ${hint.recommended_command}: ${hint.when} (${hint.why})`);
  }

  if (envelope.warnings.length > 0) {
    lines.push('warnings:');
    for (const warning of envelope.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  if (envelope.errors.length > 0) {
    lines.push('errors:');
    for (const error of envelope.errors) {
      lines.push(`- ${error}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

const TEST_PRICING_CHANGE_SPEC: EnvelopeCommandSpec<TestPricingChangeCommandDependencies> = {
  commandName: 'test-pricing-change',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseTestPricingChangeFlags(argv);
    const runSnapshotQuote = deps.executeSnapshotQuote ?? executeSnapshotQuote;
    const runSnapshotLines = deps.executeSnapshotLines ?? executeSnapshotLines;

    const [quoteSnapshot, lineSnapshot] = await Promise.all([
      runSnapshotQuote({ orgAlias: globalFlags.orgAlias!, quoteId: commandFlags.quoteId }),
      runSnapshotLines({ orgAlias: globalFlags.orgAlias!, quoteId: commandFlags.quoteId, lineIds: [] })
    ]);

    return buildTestPricingChangeEnvelope({
      globalFlags,
      commandFlags,
      quoteSnapshot,
      lineSnapshot,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderTestPricingChangeText
};

export async function runTestPricingChangeCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: TestPricingChangeCommandDependencies = {}
): Promise<TestPricingChangeExecution> {
  return runEnvelopeCommand(TEST_PRICING_CHANGE_SPEC, argv, globalFlags, io, dependencies);
}

function buildCurrentStateComparison(
  quoteSnapshot: SnapshotQuotePrimitiveResult,
  lineSnapshot: SnapshotLinesPrimitiveResult
): CurrentStateComparison | null {
  const quote = quoteSnapshot.result.quote;

  if (quoteSnapshot.status !== 'ok' || quote === null || lineSnapshot.status === 'error' || lineSnapshot.status === 'unsupported') {
    return null;
  }

  const lineRollupProjection = {
    Id: String(quote.Id),
    Subtotal: sumNumeric(lineSnapshot.result.lines.map((line) => line.Subtotal)),
    TotalPrice: sumNumeric(lineSnapshot.result.lines.map((line) => line.TotalPrice)),
    LineItemCount: lineSnapshot.result.lines.length
  } as SnapshotQuoteRecord;
  const quoteProjection = {
    Id: String(quote.Id),
    Subtotal: quote.Subtotal ?? null,
    TotalPrice: quote.TotalPrice ?? null,
    LineItemCount: quote.LineItemCount ?? null
  } as SnapshotQuoteRecord;
  const comparison = compareQuotes({
    before: { quote: quoteProjection, lines: [] },
    after: { quote: lineRollupProjection, lines: [] }
  });

  return {
    status: comparison.status,
    changed_fields: comparison.quote_diff.changed_fields,
    quote_diff: comparison.quote_diff,
    line_rollup_counts: lineSnapshot.result.counts
  };
}

function determineScenarioStatus(
  quoteSnapshot: SnapshotQuotePrimitiveResult,
  lineSnapshot: SnapshotLinesPrimitiveResult,
  comparison: CurrentStateComparison | null
): RuntimeStatus {
  if (quoteSnapshot.status !== 'ok' || lineSnapshot.status !== 'ok' || quoteSnapshot.result.quote === null) {
    return determineFailureStatus([
      quoteSnapshot.result.quote === null ? 'no_match' : 'ok',
      quoteSnapshot.status,
      lineSnapshot.status
    ]);
  }

  if (comparison?.status === 'changed') {
    return 'warn';
  }

  return 'warn';
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

  if (statuses.includes('warn')) {
    return 'warn';
  }

  return 'ok';
}

function buildWarnings(input: BuildTestPricingChangeEnvelopeInput): string[] {
  return [
    'test-pricing-change is read-only in V1 and does not perform runtime mutation or repricing execution.',
    ...input.quoteSnapshot.warnings,
    ...input.lineSnapshot.warnings
  ];
}

function buildPersistedFindings(
  input: BuildTestPricingChangeEnvelopeInput,
  comparison: CurrentStateComparison | null
): TestPricingChangeFinding[] {
  return [
    {
      finding_type: 'quote_snapshot',
      observation: buildQuoteObservation(input.commandFlags.quoteId, input.quoteSnapshot),
      status: input.quoteSnapshot.result.quote === null ? 'no_match' : input.quoteSnapshot.status,
      quote_id: input.commandFlags.quoteId,
      snapshot_type: input.quoteSnapshot.result.snapshot_type,
      fields_observed: [...input.quoteSnapshot.result.field_set],
      evidence: [...input.quoteSnapshot.evidence]
    },
    {
      finding_type: 'line_snapshot',
      observation: `Retrieved ${input.lineSnapshot.result.lines.length} persisted quote lines for ${input.commandFlags.quoteId}.`,
      status: input.lineSnapshot.status,
      quote_id: input.commandFlags.quoteId,
      snapshot_type: 'quote_lines',
      line_counts: input.lineSnapshot.result.counts,
      evidence: [...input.lineSnapshot.evidence]
    },
    buildCurrentStateConsistencyFinding(comparison)
  ];
}

function buildCurrentStateConsistencyFinding(comparison: CurrentStateComparison | null): TestPricingChangeFinding {
  const finding: TestPricingChangeFinding = {
    finding_type: 'current_state_consistency',
    observation:
      comparison === null
        ? 'Current-state consistency comparison is unavailable because the required persisted quote or line snapshot evidence did not resolve cleanly.'
        : comparison.status === 'no_change'
          ? 'Current quote pricing rollups align with current line rollups.'
          : 'Current quote pricing rollups differ from current line rollups and need explanation.',
    status: comparison?.status ?? 'unsupported',
    changed_fields: comparison?.changed_fields ?? [],
    evidence: comparison === null
      ? []
      : [{
          claim: 'Current-state comparison reused the shared compare-quotes helper against quote-level pricing rollups and line-derived rollups.',
          evidence_level: 'repo_proven',
          proof_source: ['commands/test-pricing-change.ts', 'primitives/compare-quotes.ts'],
          limitations:
            'This is a same-state consistency check, not a historical before/after comparison, because V1 test-pricing-change does not accept a before-quote selector.',
          source_refs: []
        }]
  };

  if (comparison !== null) {
    finding.quote_diff = comparison.quote_diff;
  }

  return finding;
}

function buildEscalationHints(
  status: RuntimeStatus,
  expectedChange: string | null,
  comparison: CurrentStateComparison | null
): TestPricingChangeEscalationHint[] {
  const hints: TestPricingChangeEscalationHint[] = [];

  if (comparison?.status === 'changed') {
    hints.push({
      lane: 'runtime-context-inspection',
      recommended_command: 'inspect-rlm-context',
      when: 'Use when current quote totals and current line rollups disagree or the persisted outcome still looks wrong.',
      why: 'Persisted evidence alone did not fully explain the observed pricing state.'
    });
  }

  if (expectedChange) {
    hints.push({
      lane: 'pricing-runtime-debug',
      recommended_command: 'compare-quote-pricing',
      when: 'Use when you can supply a separate before quote and want a true persisted before/after diff.',
      why: 'This command has no historical before selector in V1, so compare-quote-pricing is the explicit diff lane.'
    });
  }

  if (status === 'no_match' || status === 'partial' || status === 'unsupported') {
    hints.push({
      lane: 'pricing-runtime-debug',
      recommended_command: 'doctor',
      when: 'Use when the target quote or expected persisted reads did not resolve cleanly.',
      why: 'Doctor can validate selector readiness before another read-only validation pass.'
    });
  }

  return hints;
}

function buildRecommendedNextCommands(status: RuntimeStatus, hints: TestPricingChangeEscalationHint[]): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  if (status === 'no_match') {
    ordered.push('doctor', 'snapshot-quote');
    seen.add('doctor');
    seen.add('snapshot-quote');
  }

  for (const hint of hints) {
    if (!seen.has(hint.recommended_command)) {
      ordered.push(hint.recommended_command);
      seen.add(hint.recommended_command);
    }
  }

  return ordered;
}

function buildResult(
  input: BuildTestPricingChangeEnvelopeInput,
  comparison: CurrentStateComparison | null,
  persistedFindings: TestPricingChangeFinding[],
  escalationHints: TestPricingChangeEscalationHint[],
  recommendedNextCommands: string[]
): TestPricingChangeResult {
  const result: TestPricingChangeResult = {
    changed_artifact: input.commandFlags.changedArtifact,
    persisted_findings: persistedFindings,
    escalation_hints: escalationHints,
    recommended_next_commands: recommendedNextCommands
  };

  const beforeAfterSummary = buildBeforeAfterSummary(input.lineSnapshot, comparison);

  if (beforeAfterSummary) {
    result.before_after_summary = beforeAfterSummary;
  }

  return result;
}

function buildBeforeAfterSummary(
  lineSnapshot: SnapshotLinesPrimitiveResult,
  comparison: CurrentStateComparison | null
): TestPricingChangeBeforeAfterSummary | undefined {
  if (comparison === null) {
    return undefined;
  }

  return {
    comparison_type: 'current_quote_vs_line_rollup',
    comparison_available: true,
    historical_before_after_available: false,
    comparison_status: comparison.status,
    changed_fields: [...comparison.changed_fields],
    quote_rollup_diff: comparison.quote_diff,
    line_rollup_counts: comparison.line_rollup_counts,
    limitations:
      'V1 test-pricing-change has no explicit before-quote selector, so the comparison validates current persisted quote totals against current line rollups rather than a historical before/after anchor.'
  };
}

function buildStatusReason(
  status: RuntimeStatus,
  commandFlags: TestPricingChangeCommandFlags,
  comparison: CurrentStateComparison | null
): string {
  switch (status) {
    case 'warn':
      if (comparison?.status === 'changed') {
        return `Read-only pricing validation found persisted evidence for '${commandFlags.changedArtifact}', but current quote-level rollups do not fully align with current line rollups on quote '${commandFlags.quoteId}'.`;
      }

      return `Read-only pricing validation completed for quote '${commandFlags.quoteId}', but V1 evidence remains provisional because no historical before selector or execution support exists in-tool.`;
    case 'partial':
      return `Read-only pricing validation for quote '${commandFlags.quoteId}' returned only part of the required persisted evidence.`;
    case 'no_match':
      return `Read-only pricing validation could not resolve the persisted quote or line state for quote '${commandFlags.quoteId}'.`;
    case 'unsupported':
      return `Read-only pricing validation is unsupported for quote '${commandFlags.quoteId}' in the current environment.`;
    case 'error':
      return `Read-only pricing validation failed for quote '${commandFlags.quoteId}'.`;
    case 'ok':
      return `Read-only pricing validation completed for quote '${commandFlags.quoteId}' and current quote-level rollups align with current line rollups for '${commandFlags.changedArtifact}'.`;
    case 'changed':
    case 'no_change':
      return `Read-only pricing validation completed for quote '${commandFlags.quoteId}'.`;
  }
}

function buildEvidence(
  input: BuildTestPricingChangeEnvelopeInput,
  comparison: CurrentStateComparison | null
): EvidenceItem[] {
  const comparisonEvidence: EvidenceItem[] = comparison === null
    ? []
    : [{
        claim:
          comparison.status === 'no_change'
            ? 'Current persisted quote rollups align with current line-derived rollups for the targeted quote.'
            : 'Current persisted quote rollups differ from current line-derived rollups for the targeted quote.',
        evidence_level: 'org_proven',
        proof_source: [`quote:${input.commandFlags.quoteId}`, `lines:${input.commandFlags.quoteId}`, ...comparison.changed_fields],
        limitations:
          'Current-state comparison evidence is limited to Subtotal, TotalPrice, and LineItemCount because V1 test-pricing-change has no historical before selector.',
        source_refs: []
      }];

  return [
    ...input.quoteSnapshot.evidence,
    ...input.lineSnapshot.evidence,
    {
      claim: `test-pricing-change stayed read-only for quote '${input.commandFlags.quoteId}' and reused the shared snapshot and comparison primitives.`,
      evidence_level: 'repo_proven',
      proof_source: [
        'commands/test-pricing-change.ts',
        'primitives/snapshot-quote.ts',
        'primitives/snapshot-lines.ts',
        'primitives/compare-quotes.ts'
      ],
      limitations:
        'The command validates current persisted state only and does not provide a historical before selector or execution support.',
      source_refs: []
    },
    ...comparisonEvidence
  ];
}

function testPricingChangeResultToJsonRecord(result: TestPricingChangeResult): Record<string, JsonValue> {
  return {
    changed_artifact: result.changed_artifact,
    before_after_summary: result.before_after_summary
      ? {
          comparison_type: result.before_after_summary.comparison_type,
          comparison_available: result.before_after_summary.comparison_available,
          historical_before_after_available: result.before_after_summary.historical_before_after_available,
          comparison_status: result.before_after_summary.comparison_status,
          changed_fields: [...result.before_after_summary.changed_fields],
          quote_rollup_diff: result.before_after_summary.quote_rollup_diff,
          line_rollup_counts: result.before_after_summary.line_rollup_counts,
          limitations: result.before_after_summary.limitations
        }
      : null,
    persisted_findings: result.persisted_findings.map((finding) => ({
      finding_type: finding.finding_type,
      observation: finding.observation,
      status: finding.status,
      quote_id: finding.quote_id ?? null,
      snapshot_type: finding.snapshot_type ?? null,
      fields_observed: finding.fields_observed ?? [],
      line_counts: finding.line_counts ?? null,
      changed_fields: finding.changed_fields ?? [],
      quote_diff: finding.quote_diff ?? null,
      evidence: finding.evidence
    })),
    escalation_hints: result.escalation_hints.map((hint) => ({ ...hint })),
    recommended_next_commands: [...result.recommended_next_commands]
  };
}

function buildQuoteObservation(quoteId: string, quoteSnapshot: SnapshotQuotePrimitiveResult): string {
  switch (quoteSnapshot.status) {
    case 'ok':
      return `Retrieved persisted quote snapshot for ${quoteId}.`;
    case 'no_match':
      return `No persisted Quote row matched ${quoteId}.`;
    case 'unsupported':
      return quoteSnapshot.errors[0] ?? `Persisted quote snapshot is unsupported for ${quoteId}.`;
    case 'error':
      return quoteSnapshot.errors[0] ?? `Persisted quote snapshot failed for ${quoteId}.`;
  }
}

function sumNumeric(values: Array<JsonValue | undefined>): number {
  let total = 0;

  for (const value of values) {
    if (typeof value === 'number') {
      total += value;
    }
  }

  return total;
}

function formatStringList(values: readonly string[]): string {
  return values.length === 0 ? '(none)' : values.join(', ');
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const TEST_PRICING_CHANGE_COMMAND_SPEC = defineCommand({
  name: 'test-pricing-change',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Validate current persisted quote state for a changed pricing artifact without execution assumptions.',
  ownership: {
        primary_owner: 'pricing-runtime-debug',
        secondary_escalation: ['runtime-context-inspection', 'config-runtime-bridge'],
        shared_library_dependencies: ['pst_plan', 'snapshot_quote', 'snapshot_lines', 'compare_quotes', 'route_logic', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['quote_id', 'changed_artifact'],
        recommended_selectors: ['expected_change'],
        status_reason: 'Pricing-change validation requires a target quote and changed artifact label.'
  },
    quickStart: 'quote-runtime test-pricing-change --org-alias <alias> --quote-id <id> --changed-artifact <text> --expected-change <text>',
  renderHelp: renderTestPricingChangeHelp,
  run: runTestPricingChangeCommand
});
