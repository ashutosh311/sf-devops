import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import type { EvidenceItem } from '../contracts/evidence';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import type { RuntimeStatus } from '../contracts/status';
import {
  executeOverlayActions,
  type ExecuteOverlayActionsInput,
  type OverlayActionsPrimitiveResult
} from '../primitives/overlay-actions';
import {
  executeOverlayRelationships,
  type ExecuteOverlayRelationshipsInput,
  type OverlayRelationshipsPrimitiveResult
} from '../primitives/overlay-relationships';
import {
  executeSnapshotLines,
  type ExecuteSnapshotLinesInput,
  type SnapshotLineRecord,
  type SnapshotLinesPrimitiveResult
} from '../primitives/snapshot-lines';
import { classifyMissingPriceRootCause } from '../primitives/missing-price-root-cause';
import { routeSymptom } from '../primitives/symptom-routing';
import { normalizeOptionalId, normalizeRepeatableIds } from '../selectors/runtime-selectors';

export const EXPLAIN_MISSING_PRICE_HELP_TEXT = [
  'quote-runtime explain-missing-price',
  '',
  'Usage:',
  '  quote-runtime explain-missing-price --org-alias <alias> --quote-id <id> [--line-id <id> ...]',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Explain-missing-price flags:',
  '  --quote-id <id>',
  '  --line-id <id>',
  '',
  'Notes:',
  '  explain-missing-price composes snapshot-lines, overlay-actions, and overlay-relationships.',
  '  explain-missing-price keeps lifecycle provenance and bundle inclusion as separate branches instead of collapsing them into one overlay conclusion.',
  '',
  'Example:',
  '  quote-runtime explain-missing-price --org-alias <alias> --quote-id <id> --line-id <id>'
].join('\n');

const EXPLAIN_MISSING_PRICE_FLAG_DEFINITIONS = {
  'quote-id': Flags.string({
    required: true,
    helpValue: '<id>',
    summary: 'Target quote id for missing-price analysis.'
  }),
  'line-id': Flags.string({
    multiple: true,
    helpValue: '<id>',
    summary: 'Optional quote line ids used to narrow missing-price analysis.'
  })
};

export type ExplainMissingPriceCommandFlags = {
  quoteId: string;
  lineIds: string[];
};

export type ExplainMissingPriceResult = {
  symptom_class: string;
  persisted_evidence: string[];
  bundle_inclusion_findings: string[];
  lifecycle_provenance_findings: string[];
  likely_root_cause_class: string;
  recommended_next_commands: string[];
};

export type ExplainMissingPriceExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type BuildExplainMissingPriceEnvelopeInput = {
  globalFlags: GlobalFlags;
  commandFlags: ExplainMissingPriceCommandFlags;
  lineSnapshot: SnapshotLinesPrimitiveResult;
  overlayActions: OverlayActionsPrimitiveResult;
  overlayRelationships: OverlayRelationshipsPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
};

export type ExplainMissingPriceCommandDependencies = {
  executeSnapshotLines?: (input: ExecuteSnapshotLinesInput) => Promise<SnapshotLinesPrimitiveResult>;
  executeOverlayActions?: (input: ExecuteOverlayActionsInput) => Promise<OverlayActionsPrimitiveResult>;
  executeOverlayRelationships?: (input: ExecuteOverlayRelationshipsInput) => Promise<OverlayRelationshipsPrimitiveResult>;
};

export async function parseExplainMissingPriceFlags(argv: string[]): Promise<ExplainMissingPriceCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: EXPLAIN_MISSING_PRICE_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'quote-id': string;
      'line-id'?: string[];
    };
  };

  return {
    quoteId: normalizeOptionalId(parsed.flags['quote-id'], 'quote-id') ?? '',
    lineIds: normalizeRepeatableIds(parsed.flags['line-id'], 'line-id')
  };
}

export function renderExplainMissingPriceHelp(): string {
  return EXPLAIN_MISSING_PRICE_HELP_TEXT;
}

export function buildExplainMissingPriceEnvelope(input: BuildExplainMissingPriceEnvelopeInput): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('explain-missing-price envelope requires a resolved org alias.');
  }

  const route = routeSymptom('missing price on this quote line');
  const result = buildExplainMissingPriceResult(input);
  const status = determineExplainMissingPriceStatus(input, result);

  return makeEnvelope({
    command: 'explain-missing-price',
    status,
    summary: {
      primary_subject: buildPrimarySubject(input.commandFlags),
      status_reason: buildExplainMissingPriceStatusReason(status, result),
      primary_lane: route.primary_lane,
      verification_anchor: buildVerificationAnchor(input.commandFlags),
      symptom_class: route.symptom_class,
      next_suggested_command: result.recommended_next_commands[0] ?? null,
      key_counts: {
        persisted_findings: result.persisted_evidence.length,
        bundle_findings: result.bundle_inclusion_findings.length,
        lifecycle_findings: result.lifecycle_provenance_findings.length,
        missing_line_ids: input.lineSnapshot.result.selection.missing_line_ids.length
      }
    } satisfies Record<string, JsonValue>,
    result: explainMissingPriceResultToJsonRecord(result),
    warnings: dedupeStrings([
      ...input.lineSnapshot.warnings,
      ...input.overlayActions.warnings,
      ...input.overlayRelationships.warnings
    ]),
    errors: dedupeStrings([
      ...input.lineSnapshot.errors,
      ...input.overlayActions.errors,
      ...input.overlayRelationships.errors
    ]),
    evidence: buildExplainMissingPriceEvidence(input, result),
    meta: {
      org_alias: input.globalFlags.orgAlias,
      generated_at: input.generatedAt ?? new Date().toISOString(),
      duration_ms: input.durationMs ?? 0,
      source_files: []
    }
  });
}

export function renderExplainMissingPriceText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as ExplainMissingPriceResult;
  const lines = [
    'quote-runtime explain-missing-price',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `subject: ${String(envelope.summary.primary_subject ?? '(unknown)')}`,
    `symptom class: ${result.symptom_class}`,
    `likely root cause class: ${result.likely_root_cause_class}`,
    `persisted evidence: ${formatStringList(result.persisted_evidence)}`,
    `bundle inclusion findings: ${formatStringList(result.bundle_inclusion_findings)}`,
    `lifecycle provenance findings: ${formatStringList(result.lifecycle_provenance_findings)}`,
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

const EXPLAIN_MISSING_PRICE_SPEC: EnvelopeCommandSpec<ExplainMissingPriceCommandDependencies> = {
  commandName: 'explain-missing-price',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseExplainMissingPriceFlags(argv);
    const runSnapshotLines = deps.executeSnapshotLines ?? executeSnapshotLines;
    const runOverlayActions = deps.executeOverlayActions ?? executeOverlayActions;
    const runOverlayRelationships = deps.executeOverlayRelationships ?? executeOverlayRelationships;

    const [lineSnapshot, overlayActions, overlayRelationships] = await Promise.all([
      runSnapshotLines({ orgAlias: globalFlags.orgAlias!, quoteId: commandFlags.quoteId, lineIds: commandFlags.lineIds }),
      runOverlayActions({ orgAlias: globalFlags.orgAlias!, quoteId: commandFlags.quoteId, lineIds: commandFlags.lineIds }),
      runOverlayRelationships({ orgAlias: globalFlags.orgAlias!, quoteId: commandFlags.quoteId, lineIds: commandFlags.lineIds })
    ]);

    return buildExplainMissingPriceEnvelope({
      globalFlags,
      commandFlags,
      lineSnapshot,
      overlayActions,
      overlayRelationships,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderExplainMissingPriceText
};

export async function runExplainMissingPriceCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: ExplainMissingPriceCommandDependencies = {}
): Promise<ExplainMissingPriceExecution> {
  return runEnvelopeCommand(EXPLAIN_MISSING_PRICE_SPEC, argv, globalFlags, io, dependencies);
}

function buildExplainMissingPriceResult(
  input: BuildExplainMissingPriceEnvelopeInput
): ExplainMissingPriceResult {
  const route = routeSymptom('missing price on this quote line');
  const persistedEvidence = buildPersistedEvidence(input.lineSnapshot.result.lines, input.commandFlags.quoteId);
  const bundleInclusionFindings = buildBundleInclusionFindings(input.overlayRelationships);
  const lifecycleProvenanceFindings = buildLifecycleProvenanceFindings(input.overlayActions);
  const rootCause = classifyMissingPriceRootCause({
    bundleInclusionFound: isBundleBranchMatched(input.overlayRelationships),
    lifecycleProvenanceFound: isLifecycleBranchMatched(input.overlayActions)
  });

  return {
    symptom_class: route.symptom_class,
    persisted_evidence: persistedEvidence,
    bundle_inclusion_findings: bundleInclusionFindings,
    lifecycle_provenance_findings: lifecycleProvenanceFindings,
    likely_root_cause_class: rootCause.likely_root_cause_class,
    recommended_next_commands: [...rootCause.recommended_next_commands]
  };
}

function determineExplainMissingPriceStatus(
  input: BuildExplainMissingPriceEnvelopeInput,
  result: ExplainMissingPriceResult
): RuntimeStatus {
  if (input.lineSnapshot.status === 'error' || input.overlayActions.status === 'error' || input.overlayRelationships.status === 'error') {
    return 'error';
  }

  if (
    input.lineSnapshot.status === 'unsupported' ||
    input.overlayActions.status === 'unsupported' ||
    input.overlayRelationships.status === 'unsupported'
  ) {
    return 'unsupported';
  }

  if (input.lineSnapshot.status === 'no_match') {
    return 'no_match';
  }

  if (input.lineSnapshot.status === 'partial') {
    return 'partial';
  }

  if (result.likely_root_cause_class === 'unexplained_missing_price') {
    return 'partial';
  }

  if (input.overlayRelationships.status === 'partial' || dedupeStrings([
    ...input.lineSnapshot.warnings,
    ...input.overlayActions.warnings,
    ...input.overlayRelationships.warnings
  ]).length > 0) {
    return 'warn';
  }

  return 'ok';
}

function buildPersistedEvidence(lines: SnapshotLineRecord[], quoteId: string): string[] {
  if (lines.length === 0) {
    return [
      `No persisted quote lines matched the requested scope on ${quoteId}, so missing-price explanation has no target line evidence.`
    ];
  }

  const evidence = [`Persisted missing-price analysis examined ${lines.length} scoped line(s) on quote ${quoteId}.`];
  for (const line of lines) {
    const lineId = String(line.Id ?? '(unknown)');
    const zeroishFields = ['ListPrice', 'UnitPrice', 'NetUnitPrice', 'TotalPrice'].filter((fieldName) => {
      const value = line[fieldName as keyof SnapshotLineRecord];
      return value === null || value === '' || value === 0;
    });
    evidence.push(
      `Line ${lineId} surfaces missing-or-zero persisted pricing in ${zeroishFields.length > 0 ? zeroishFields.join(', ') : 'no locked price fields'}.`
    );
  }

  return evidence;
}

function buildBundleInclusionFindings(overlayRelationships: OverlayRelationshipsPrimitiveResult): string[] {
  const includedCount = Number(overlayRelationships.result.pricing_inclusion_summary.included_in_bundle_price_count ?? 0);
  return includedCount > 0
    ? [`QuoteLineRelationship overlay found ${includedCount} IncludedInBundlePrice relationship row(s) in scope.`]
    : ['QuoteLineRelationship overlay did not show bundle-inclusion semantics for the targeted scope.'];
}

function buildLifecycleProvenanceFindings(overlayActions: OverlayActionsPrimitiveResult): string[] {
  const linkedCount = Number(overlayActions.result.provenance_summary.linked_line_count ?? 0);
  return linkedCount > 0
    ? [`QuoteAction overlay linked ${linkedCount} targeted line(s) to lifecycle actions.`]
    : ['QuoteAction overlay did not show lifecycle links for the targeted scope.'];
}

function isBundleBranchMatched(overlayRelationships: OverlayRelationshipsPrimitiveResult): boolean {
  return Number(overlayRelationships.result.pricing_inclusion_summary.included_in_bundle_price_count ?? 0) > 0;
}

function isLifecycleBranchMatched(overlayActions: OverlayActionsPrimitiveResult): boolean {
  return Number(overlayActions.result.provenance_summary.linked_line_count ?? 0) > 0;
}

function explainMissingPriceResultToJsonRecord(result: ExplainMissingPriceResult): Record<string, JsonValue> {
  return {
    symptom_class: result.symptom_class,
    persisted_evidence: [...result.persisted_evidence],
    bundle_inclusion_findings: [...result.bundle_inclusion_findings],
    lifecycle_provenance_findings: [...result.lifecycle_provenance_findings],
    likely_root_cause_class: result.likely_root_cause_class,
    recommended_next_commands: [...result.recommended_next_commands]
  };
}

function buildExplainMissingPriceEvidence(
  input: BuildExplainMissingPriceEnvelopeInput,
  result: ExplainMissingPriceResult
): EvidenceItem[] {
  return [
    ...input.lineSnapshot.evidence,
    ...input.overlayActions.evidence,
    ...input.overlayRelationships.evidence,
    {
      claim: `Explain-missing-price kept QuoteAction and QuoteLineRelationship as separate explanation branches for ${input.commandFlags.quoteId}.`,
      evidence_level: 'repo_proven',
      proof_source: ['snapshot-lines', 'overlay-actions', 'overlay-relationships'],
      limitations: 'Branch preference is heuristic in V1 and may still require context escalation when neither branch matches.',
      source_refs: [
        'specs/quoting-pricing-runtime/quoting-pricing-runtime-node-typescript-wave3-scenarios-build-plan.md',
        'specs/quoting-pricing-runtime/quoting-pricing-runtime-wave4-command-grammar-and-result-schemas.md'
      ]
    },
    {
      claim: `Explain-missing-price favored '${result.likely_root_cause_class}' after evaluating separate structure and lifecycle branches.`,
      evidence_level: 'org_proven',
      proof_source: [
        `quote:${input.commandFlags.quoteId}`,
        ...input.commandFlags.lineIds.map((lineId) => `line:${lineId}`)
      ],
      limitations: 'The result explains the most likely branch from persisted evidence, not a full pricing rule trace.',
      source_refs: []
    }
  ];
}

function buildPrimarySubject(commandFlags: ExplainMissingPriceCommandFlags): string {
  return commandFlags.lineIds.length > 0
    ? `${commandFlags.quoteId} (${commandFlags.lineIds.length} scoped line id(s))`
    : commandFlags.quoteId;
}

function buildVerificationAnchor(commandFlags: ExplainMissingPriceCommandFlags): string {
  return commandFlags.lineIds.length > 0
    ? `quote:${commandFlags.quoteId}:lines:${commandFlags.lineIds.join(',')}`
    : `quote:${commandFlags.quoteId}`;
}

function buildExplainMissingPriceStatusReason(status: RuntimeStatus, result: ExplainMissingPriceResult): string {
  switch (status) {
    case 'ok':
      return `Missing-price explanation favors '${result.likely_root_cause_class}' after checking persisted, structure, and lifecycle branches separately.`;
    case 'warn':
      return `Missing-price explanation favors '${result.likely_root_cause_class}', but warnings limit confidence.`;
    case 'partial':
      return result.likely_root_cause_class === 'unexplained_missing_price'
        ? 'Persisted and overlay evidence were gathered, but neither structure nor lifecycle branches fully explained the missing price.'
        : 'Explain-missing-price only resolved part of the requested scope.';
    case 'no_match':
      return 'No persisted quote lines matched the requested selectors, so missing-price explanation has no target line scope.';
    case 'unsupported':
      return 'Explain-missing-price is unsupported in the current environment before separate structure and lifecycle branches could be completed.';
    case 'error':
      return 'Explain-missing-price failed before separate structure and lifecycle branches could be completed.';
    case 'changed':
    case 'no_change':
      return 'Explain-missing-price completed.';
  }
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}

function formatStringList(values: readonly string[]): string {
  return values.length > 0 ? values.join(' | ') : '(none)';
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const EXPLAIN_MISSING_PRICE_COMMAND_SPEC = defineCommand({
  name: 'explain-missing-price',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Explain a missing or zero price by checking bundle inclusion and lifecycle provenance as separate branches.',
  ownership: {
        primary_owner: 'pricing-runtime-debug',
        secondary_escalation: ['runtime-context-inspection', 'config-runtime-bridge'],
        shared_library_dependencies: ['overlay_actions', 'overlay_relationships', 'route_logic', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['quote_id'],
        recommended_selectors: ['line_ids'],
        status_reason: 'Missing-price explanation starts from a target quote and optional line narrowing.'
  },
    quickStart: 'quote-runtime explain-missing-price --org-alias <alias> --quote-id <id> --line-id <id>',
  renderHelp: renderExplainMissingPriceHelp,
  run: runExplainMissingPriceCommand
});
