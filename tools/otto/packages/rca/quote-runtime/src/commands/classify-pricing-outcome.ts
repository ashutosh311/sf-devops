import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeClassifyPricingOutcome,
  type ClassifyPricingOutcomePrimitiveResult,
  type ClassifyPricingOutcomeResult,
  type ExecuteClassifyPricingOutcomeInput
} from '../primitives/classify-pricing-outcome';
import {
  formatCommandReadinessIssues,
  getReadinessIssuesForPolicy,
  type CommandReadinessIssue,
  type CommandSelectorPolicy
} from '../routing/selector-functions';
import { normalizeOptionalText, normalizeSelectors } from '../selectors/runtime-selectors';
import { dedupeLineIds } from '../primitives/snapshot-lines';

export const CLASSIFY_PRICING_OUTCOME_HELP_TEXT = [
  'quote-runtime classify-pricing-outcome',
  '',
  'Usage:',
  '  quote-runtime classify-pricing-outcome --org-alias <alias> --quote-id <id> --line-id <id> ... --expected-change <text> [--metadata-proof <verified|not_verified>] [--output-family <text>] [--target-step <text>] [--include-adjustments] [--include-line-detail] [--include-usage-rating] [--json] [--fail-on <status>] [--output <path>] [--verbose]',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Classify-pricing-outcome flags:',
  '  --quote-id <id>            Required quote selector for read-only closeout classification.',
  '  --line-id <id>             Required repeatable line selector. Repeated values are deduplicated in first-seen order.',
  '  --expected-change <text>   Required operator-facing description of the requested business effect.',
  '  --metadata-proof <state>   Optional metadata-proof state: verified or not_verified. Defaults to not_verified.',
  '  --output-family <text>     Optional hint such as NetTotalPrice, Subtotal, or ItemNetTotalPrice when the family is known.',
  '  --target-step <text>       Optional pricing-element hint used to separate a named step from later same-family writers.',
  '  --include-adjustments      Request optional QuoteLinePriceAdjustment artifacts while classifying.',
  '  --include-line-detail      Request optional QuoteLineDetail artifacts while classifying.',
  '  --include-usage-rating     Request optional quote-side usage/rate artifacts while classifying.',
  '',
  'Notes:',
  '  classify-pricing-outcome is read only and layers on top of capture-post-pst-evidence.',
  '  It keeps transport status separate from business outcome_class and reports proof_status honestly when evidence stays incomplete.',
  '',
  'Example:',
  '  quote-runtime classify-pricing-outcome --org-alias <alias> --quote-id <id> --line-id <id> --expected-change "final persisted line total should reflect the discount" --output-family NetTotalPrice --target-step "Formula Based Pricing"'
].join('\n');

const CLASSIFY_PRICING_OUTCOME_FLAG_DEFINITIONS = {
  'quote-id': Flags.string({
    required: false,
    helpValue: '<id>',
    summary: 'Required quote selector for read-only closeout classification.'
  }),
  'line-id': Flags.string({
    required: false,
    multiple: true,
    helpValue: '<id>',
    summary: 'Required repeatable line selector. Repeated values are deduplicated in first-seen order.'
  }),
  'expected-change': Flags.string({
    required: false,
    helpValue: '<text>',
    summary: 'Required operator-facing description of the requested business effect.'
  }),
  'metadata-proof': Flags.string({
    required: false,
    options: ['verified', 'not_verified'],
    helpValue: '<state>',
    summary: 'Optional metadata-proof state: verified or not_verified. Defaults to not_verified.'
  }),
  'output-family': Flags.string({
    required: false,
    helpValue: '<text>',
    summary: 'Optional hint such as NetTotalPrice, Subtotal, or ItemNetTotalPrice when the family is known.'
  }),
  'target-step': Flags.string({
    required: false,
    helpValue: '<text>',
    summary: 'Optional pricing-element hint used to separate a named step from later same-family writers.'
  }),
  'include-adjustments': Flags.boolean({
    default: false,
    summary: 'Request optional QuoteLinePriceAdjustment artifacts while classifying.'
  }),
  'include-line-detail': Flags.boolean({
    default: false,
    summary: 'Request optional QuoteLineDetail artifacts while classifying.'
  }),
  'include-usage-rating': Flags.boolean({
    default: false,
    summary: 'Request optional quote-side usage/rate artifacts while classifying.'
  })
};

export type ClassifyPricingOutcomeCommandFlags = {
  quoteId?: string;
  lineIds: string[];
  expectedChange?: string;
  metadataProofState: 'verified' | 'not_verified';
  outputFamily: string | null;
  targetStep: string | null;
  includeAdjustments: boolean;
  includeLineDetail: boolean;
  includeUsageRating: boolean;
};

export type ClassifyPricingOutcomeExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type BuildClassifyPricingOutcomeEnvelopeInput = {
  globalFlags: GlobalFlags;
  commandFlags: ClassifyPricingOutcomeCommandFlags;
  primitiveResult: ClassifyPricingOutcomePrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
};

export type ClassifyPricingOutcomeCommandDependencies = {
  executeClassifyPricingOutcome?: (
    input: ExecuteClassifyPricingOutcomeInput
  ) => Promise<ClassifyPricingOutcomePrimitiveResult>;
};

export async function parseClassifyPricingOutcomeFlags(argv: string[]): Promise<ClassifyPricingOutcomeCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: CLASSIFY_PRICING_OUTCOME_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'quote-id'?: string;
      'line-id'?: string[];
      'expected-change'?: string;
      'metadata-proof'?: 'verified' | 'not_verified';
      'output-family'?: string;
      'target-step'?: string;
      'include-adjustments': boolean;
      'include-line-detail': boolean;
      'include-usage-rating': boolean;
    };
  };

  const selectors = normalizeSelectors({
    quote_id: parsed.flags['quote-id'],
    line_id: parsed.flags['line-id'] ?? [],
    expected_change: parsed.flags['expected-change']
  });

  return {
    ...(selectors.quote_id === null ? {} : { quoteId: selectors.quote_id }),
    lineIds: dedupeLineIds(selectors.line_ids),
    ...(selectors.expected_change === null ? {} : { expectedChange: selectors.expected_change }),
    metadataProofState: parsed.flags['metadata-proof'] ?? 'not_verified',
    outputFamily: normalizeOptionalText(parsed.flags['output-family']),
    targetStep: normalizeOptionalText(parsed.flags['target-step']),
    includeAdjustments: parsed.flags['include-adjustments'],
    includeLineDetail: parsed.flags['include-line-detail'],
    includeUsageRating: parsed.flags['include-usage-rating']
  };
}

export function renderClassifyPricingOutcomeHelp(): string {
  return CLASSIFY_PRICING_OUTCOME_HELP_TEXT;
}

export function buildClassifyPricingOutcomeEnvelope(
  input: BuildClassifyPricingOutcomeEnvelopeInput
): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('classify-pricing-outcome envelope requires a resolved org alias.');
  }

  return makeEnvelope({
    command: 'classify-pricing-outcome',
    status: input.primitiveResult.status,
    summary: {
      primary_subject: input.commandFlags.quoteId ?? 'classify-pricing-outcome',
      status_reason: buildStatusReason(input.commandFlags, input.primitiveResult),
      primary_lane: 'quote_pricing',
      verification_anchor: input.commandFlags.quoteId ? `quote:${input.commandFlags.quoteId}` : 'classify-pricing-outcome',
      next_suggested_command: input.primitiveResult.result.recommended_next_commands[0] ?? null,
      key_counts: {
        requested_lines: input.primitiveResult.result.evidence_packet.counts.requested_lines,
        classified_lines: input.primitiveResult.result.line_classifications.length,
        outcome_class: input.primitiveResult.result.outcome_class,
        proof_status: input.primitiveResult.result.proof_status
      }
    } satisfies Record<string, JsonValue>,
    result: classifyPricingOutcomeResultToJsonRecord(input.primitiveResult.result),
    warnings: input.primitiveResult.warnings,
    errors: input.primitiveResult.errors,
    evidence: input.primitiveResult.evidence,
    meta: {
      org_alias: input.globalFlags.orgAlias,
      generated_at: input.generatedAt ?? new Date().toISOString(),
      duration_ms: input.durationMs ?? 0,
      source_files: []
    }
  });
}

export function renderClassifyPricingOutcomeText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as ClassifyPricingOutcomeResult;
  const lines = [
    'quote-runtime classify-pricing-outcome',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `quote id: ${String(envelope.summary.primary_subject ?? '(unknown)')}`,
    `requested effect: ${result.requested_effect}`,
    `metadata proof state: ${result.metadata_proof_state}`,
    `outcome class: ${result.outcome_class}`,
    `proof status: ${result.proof_status}`,
    `output family under test: ${result.output_family_under_test ?? '(not isolated)'}`,
    `target step hint: ${result.target_step_hint ?? '(none)'}`,
    `recommended next action: ${result.recommended_next_action}`,
    `recommended next commands: ${formatList(result.recommended_next_commands)}`,
    '',
    'classification basis:'
  ];

  const usageReadback = formatUsageArtifactReadback(result);
  if (usageReadback.length > 0) {
    lines.push('');
    lines.push('usage/rate artifact readback:');
    lines.push(...usageReadback.map((entry) => `- ${entry}`));
    if (result.proof_status === 'hypothesis_level') {
      lines.push('- usage/rate rows were found; proof remains hypothesis-level only because metadata landing was not independently verified.');
    }
  }

  appendBulletSection(lines, 'runtime execution', result.classification_basis.runtime_execution_summary);
  appendBulletSection(lines, 'persisted outcome', result.classification_basis.persisted_outcome_summary);
  appendBulletSection(lines, 'overwrite interpretation', result.classification_basis.overwrite_summary);
  appendBulletSection(lines, 'unresolved ambiguities', result.classification_basis.unresolved_ambiguities);

  lines.push('');
  lines.push('per-line classifications:');
  for (const line of result.line_classifications) {
    lines.push(`- requested line id: ${line.requested_line_id}`);
    lines.push(`  resolved line id: ${line.resolved_line_id ?? '(none)'}`);
    lines.push(`  transport capture status: ${line.transport_capture_status}`);
    lines.push(`  outcome class: ${line.outcome_class}`);
    lines.push(`  proof status: ${line.proof_status}`);
    lines.push(`  recommended next action: ${line.recommended_next_action}`);
    lines.push(`  target writer: ${formatWriter(line.likely_target_writer)}`);
    lines.push(`  likely winning writer: ${formatWriter(line.likely_winning_writer)}`);
  }

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

const CLASSIFY_PRICING_OUTCOME_SPEC: EnvelopeCommandSpec<ClassifyPricingOutcomeCommandDependencies> = {
  commandName: 'classify-pricing-outcome',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseClassifyPricingOutcomeFlags(argv);
    const readinessIssues = getClassifyPricingOutcomeReadinessIssues(commandFlags);
    if (readinessIssues.length > 0) {
      throw new Error(formatCommandReadinessIssues('classify-pricing-outcome', readinessIssues));
    }

    const runPrimitive = deps.executeClassifyPricingOutcome ?? executeClassifyPricingOutcome;
    const primitiveResult = await runPrimitive({
      orgAlias: globalFlags.orgAlias!,
      quoteId: commandFlags.quoteId ?? '',
      lineIds: commandFlags.lineIds,
      expectedChange: commandFlags.expectedChange ?? '',
      metadataProofState: commandFlags.metadataProofState,
      ...(commandFlags.outputFamily === null ? {} : { outputFamilyHint: commandFlags.outputFamily }),
      ...(commandFlags.targetStep === null ? {} : { targetStepHint: commandFlags.targetStep }),
      includeAdjustments: commandFlags.includeAdjustments,
      includeLineDetail: commandFlags.includeLineDetail,
      includeUsageRating: commandFlags.includeUsageRating
    });

    return buildClassifyPricingOutcomeEnvelope({
      globalFlags,
      commandFlags,
      primitiveResult,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderClassifyPricingOutcomeText
};

export async function runClassifyPricingOutcomeCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: ClassifyPricingOutcomeCommandDependencies = {}
): Promise<ClassifyPricingOutcomeExecution> {
  return runEnvelopeCommand(CLASSIFY_PRICING_OUTCOME_SPEC, argv, globalFlags, io, dependencies);
}

function getClassifyPricingOutcomeReadinessIssues(
  commandFlags: ClassifyPricingOutcomeCommandFlags
): CommandReadinessIssue[] {
  return getReadinessIssuesForPolicy(
    CLASSIFY_PRICING_OUTCOME_SELECTOR_POLICY,
    normalizeSelectors({
      quote_id: commandFlags.quoteId,
      line_id: commandFlags.lineIds,
      expected_change: commandFlags.expectedChange
    })
  );
}

function buildStatusReason(
  commandFlags: ClassifyPricingOutcomeCommandFlags,
  primitiveResult: ClassifyPricingOutcomePrimitiveResult
): string {
  const quoteId = commandFlags.quoteId ?? '(missing quote id)';
  const outcome = primitiveResult.result.outcome_class;
  const proof = primitiveResult.result.proof_status;

  switch (primitiveResult.status) {
    case 'ok':
      return `Classified quote '${quoteId}' as '${outcome}' with ${proof} closeout evidence.`;
    case 'partial':
      return `Classified quote '${quoteId}' as '${outcome}', but transport evidence stayed partial so proof status remains ${proof}.`;
    case 'no_match':
      return `Classification for quote '${quoteId}' could not resolve the requested lines, so business closeout stayed '${outcome}'.`;
    case 'unsupported':
      return primitiveResult.errors[0] ?? `Classification transport was unsupported for quote '${quoteId}'.`;
    case 'error':
      return primitiveResult.errors[0] ?? `Classification transport failed for quote '${quoteId}'.`;
  }
}

function classifyPricingOutcomeResultToJsonRecord(
  result: ClassifyPricingOutcomeResult
): Record<string, JsonValue> {
  return {
    requested_effect: result.requested_effect,
    metadata_proof_state: result.metadata_proof_state,
    output_family_under_test: result.output_family_under_test,
    target_step_hint: result.target_step_hint,
    outcome_class: result.outcome_class,
    proof_status: result.proof_status,
    recommended_next_action: result.recommended_next_action,
    classification_basis: result.classification_basis as unknown as JsonValue,
    line_classifications: result.line_classifications as unknown as JsonValue,
    evidence_packet: result.evidence_packet as unknown as JsonValue,
    recommended_next_commands: [...result.recommended_next_commands]
  };
}

function appendBulletSection(lines: string[], label: string, values: readonly string[]): void {
  if (values.length === 0) {
    lines.push(`- ${label}: (none)`);
    return;
  }

  lines.push(`- ${label}:`);
  for (const value of values) {
    lines.push(`  - ${value}`);
  }
}

function formatWriter(value: ClassifyPricingOutcomeResult['line_classifications'][number]['likely_target_writer']): string {
  if (value === null) {
    return '(none)';
  }
  return `${value.name ?? '(unnamed)'}#${value.sequence}`;
}

function formatList(values: readonly string[]): string {
  return values.length === 0 ? '(none)' : values.join(', ');
}

function formatUsageArtifactReadback(result: ClassifyPricingOutcomeResult): string[] {
  const counts = result.evidence_packet.counts;
  const entries: string[] = [];
  if (counts.rate_card_entries_returned > 0) {
    entries.push(`${counts.rate_card_entries_returned} QuoteLineRateCardEntry row(s) found.`);
  }
  if (counts.rate_adjustments_returned > 0) {
    entries.push(`${counts.rate_adjustments_returned} QuoteLineRateAdjustment row(s) found.`);
  }
  if (counts.usage_grants_returned > 0) {
    entries.push(`${counts.usage_grants_returned} QuotLineItmUseRsrcGrant row(s) found.`);
  }
  if (counts.usage_policies_returned > 0) {
    entries.push(`${counts.usage_policies_returned} QuotLineItmUsageRsrcPlcy row(s) found.`);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

// Extracted so getClassifyPricingOutcomeReadinessIssues can use it directly
// (via getReadinessIssuesForPolicy) without consulting the derived map.
const CLASSIFY_PRICING_OUTCOME_SELECTOR_POLICY: CommandSelectorPolicy = {
  required_selectors: ['quote_id', 'line_ids', 'expected_change'],
  recommended_selectors: [],
  status_reason: 'Outcome classification requires a quote id, at least one target line id, and the requested business effect.'
};

export const CLASSIFY_PRICING_OUTCOME_COMMAND_SPEC = defineCommand({
  name: 'classify-pricing-outcome',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Classify overwrite-aware pricing outcome closeout without collapsing transport status into business outcome.',
  ownership: {
        primary_owner: 'pricing-runtime-debug',
        secondary_escalation: ['runtime-context-inspection', 'config-runtime-bridge'],
        shared_library_dependencies: ['snapshot_quote', 'snapshot_lines', 'selectors', 'evidence']
  },
  selectorPolicy: CLASSIFY_PRICING_OUTCOME_SELECTOR_POLICY,
    quickStart: 'quote-runtime classify-pricing-outcome --org-alias <alias> --quote-id <id> --line-id <id> --expected-change <text>',
  renderHelp: renderClassifyPricingOutcomeHelp,
  run: runClassifyPricingOutcomeCommand
});
