import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeCapturePostPstEvidence,
  type CapturePostPstEvidencePrimitiveResult,
  type CapturePostPstEvidenceResult,
  type ExecuteCapturePostPstEvidenceInput
} from '../primitives/capture-post-pst-evidence';
import {
  formatCommandReadinessIssues,
  getReadinessIssuesForPolicy,
  type CommandReadinessIssue,
  type CommandSelectorPolicy
} from '../routing/selector-functions';
import { normalizeSelectors } from '../selectors/runtime-selectors';
import { dedupeLineIds } from '../primitives/snapshot-lines';

export const CAPTURE_POST_PST_EVIDENCE_HELP_TEXT = [
  'quote-runtime capture-post-pst-evidence',
  '',
  'Usage:',
  '  quote-runtime capture-post-pst-evidence --org-alias <alias> --quote-id <id> (--line-id <id> ... | --all-lines) [--include-adjustments] [--include-line-detail] [--include-usage-rating] [--json] [--fail-on <status>] [--output <path>] [--verbose]',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Capture-post-pst-evidence flags:',
  '  --quote-id <id>            Required quote selector for bounded persisted evidence capture.',
  '  --line-id <id>             Repeatable line selector. Repeated values are deduplicated in first-seen order.',
  '  --all-lines                Capture every persisted line on the quote. Mutually exclusive with --line-id.',
  '  --include-adjustments      Request optional QuoteLinePriceAdjustment artifact capture.',
  '  --include-line-detail      Request optional QuoteLineDetail artifact capture.',
  '  --include-usage-rating     Request optional quote-side usage/rate artifact capture.',
  '',
  'Notes:',
  '  capture-post-pst-evidence is read only and does not emit business outcome classification in P1.',
  '  The command gathers quote snapshot, line snapshots, PriceWaterfallIdentifier anchoring, execution correlation, and per-line waterfall evidence in one packet.',
  '',
  'Example:',
  '  quote-runtime capture-post-pst-evidence --org-alias <alias> --quote-id <id> --all-lines'
].join('\n');

const CAPTURE_POST_PST_EVIDENCE_FLAG_DEFINITIONS = {
  'quote-id': Flags.string({
    required: false,
    helpValue: '<id>',
    summary: 'Required quote selector for bounded persisted evidence capture.'
  }),
  'line-id': Flags.string({
    required: false,
    multiple: true,
    helpValue: '<id>',
    summary: 'Repeatable line selector. Repeated values are deduplicated in first-seen order.'
  }),
  'all-lines': Flags.boolean({
    default: false,
    summary: 'Capture every persisted line on the quote. Mutually exclusive with --line-id.'
  }),
  'include-adjustments': Flags.boolean({
    default: false,
    summary: 'Request optional QuoteLinePriceAdjustment artifact capture.'
  }),
  'include-line-detail': Flags.boolean({
    default: false,
    summary: 'Request optional QuoteLineDetail artifact capture.'
  }),
  'include-usage-rating': Flags.boolean({
    default: false,
    summary: 'Request optional quote-side usage/rate artifact capture.'
  })
};

export type CapturePostPstEvidenceCommandFlags = {
  quoteId?: string;
  lineIds: string[];
  allLines: boolean;
  includeAdjustments: boolean;
  includeLineDetail: boolean;
  includeUsageRating: boolean;
};

export type CapturePostPstEvidenceExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type BuildCapturePostPstEvidenceEnvelopeInput = {
  globalFlags: GlobalFlags;
  commandFlags: CapturePostPstEvidenceCommandFlags;
  primitiveResult: CapturePostPstEvidencePrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
};

export type CapturePostPstEvidenceCommandDependencies = {
  executeCapturePostPstEvidence?: (
    input: ExecuteCapturePostPstEvidenceInput
  ) => Promise<CapturePostPstEvidencePrimitiveResult>;
};

export async function parseCapturePostPstEvidenceFlags(argv: string[]): Promise<CapturePostPstEvidenceCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: CAPTURE_POST_PST_EVIDENCE_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'quote-id'?: string;
      'line-id'?: string[];
      'all-lines': boolean;
      'include-adjustments': boolean;
      'include-line-detail': boolean;
      'include-usage-rating': boolean;
    };
  };

  const selectors = normalizeSelectors({
    quote_id: parsed.flags['quote-id'],
    line_id: parsed.flags['line-id'] ?? []
  });

  return {
    ...(selectors.quote_id === null ? {} : { quoteId: selectors.quote_id }),
    lineIds: dedupeLineIds(selectors.line_ids),
    allLines: parsed.flags['all-lines'],
    includeAdjustments: parsed.flags['include-adjustments'],
    includeLineDetail: parsed.flags['include-line-detail'],
    includeUsageRating: parsed.flags['include-usage-rating']
  };
}

export function renderCapturePostPstEvidenceHelp(): string {
  return CAPTURE_POST_PST_EVIDENCE_HELP_TEXT;
}

export function buildCapturePostPstEvidenceEnvelope(
  input: BuildCapturePostPstEvidenceEnvelopeInput
): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('capture-post-pst-evidence envelope requires a resolved org alias.');
  }

  return makeEnvelope({
    command: 'capture-post-pst-evidence',
    status: input.primitiveResult.status,
    summary: {
      primary_subject: input.commandFlags.quoteId ?? 'capture-post-pst-evidence',
      status_reason: buildCapturePostPstEvidenceStatusReason(input.commandFlags, input.primitiveResult),
      primary_lane: 'quote_pricing',
      verification_anchor: input.commandFlags.quoteId ? `quote:${input.commandFlags.quoteId}` : 'capture-post-pst-evidence',
      next_suggested_command: input.primitiveResult.result.recommended_next_commands[0] ?? null,
      key_counts: {
        requested_lines: input.primitiveResult.result.counts.requested_lines,
        resolved_line_snapshots: input.primitiveResult.result.counts.resolved_line_snapshots,
        ok_packets: input.primitiveResult.result.counts.ok_packets,
        partial_packets: input.primitiveResult.result.counts.partial_packets,
        no_match_packets: input.primitiveResult.result.counts.no_match_packets,
        error_packets: input.primitiveResult.result.counts.error_packets,
        unsupported_packets: input.primitiveResult.result.counts.unsupported_packets
      }
    } satisfies Record<string, JsonValue>,
    result: capturePostPstEvidenceResultToJsonRecord(input.primitiveResult.result),
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

export function renderCapturePostPstEvidenceText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as CapturePostPstEvidenceResult;
  const lines = [
    'quote-runtime capture-post-pst-evidence',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `quote snapshot: ${result.quote_snapshot === null ? '(missing)' : String(result.quote_snapshot.Id ?? '(resolved)')}`,
    `counts: requested=${result.counts.requested_lines} resolved=${result.counts.resolved_line_snapshots} ok=${result.counts.ok_packets} partial=${result.counts.partial_packets} no_match=${result.counts.no_match_packets} error=${result.counts.error_packets} unsupported=${result.counts.unsupported_packets}`,
    `recommended next commands: ${formatList(result.recommended_next_commands)}`,
    '',
    'line evidence packets:'
  ];

  if (result.line_evidence_packets.length === 0) {
    lines[lines.length - 1] = 'line evidence packets: (none)';
  } else {
    for (const packet of result.line_evidence_packets) {
      lines.push(`- requested line id: ${packet.requested_line_id}`);
      lines.push(`  resolved line id: ${String(packet.resolved_line_id ?? '(none)')}`);
      lines.push(`  capture status: ${packet.capture_status}`);
      lines.push(`  trace anchor: ${packet.trace_anchor?.price_waterfall_identifier ?? '(none)'}`);
      lines.push(`  correlation status: ${packet.execution_correlation?.correlation_status ?? '(none)'}`);
      lines.push(`  waterfall fetch: ${packet.waterfall?.fetch_status ?? '(none)'}`);
      lines.push(
        `  artifacts: line_detail=${packet.artifact_statuses.line_detail} price_adjustments=${packet.artifact_statuses.price_adjustments} rate_card_entries=${packet.artifact_statuses.rate_card_entries} rate_adjustments=${packet.artifact_statuses.rate_adjustments} usage_grants=${packet.artifact_statuses.usage_grants} usage_policies=${packet.artifact_statuses.usage_policies}`
      );
      if (packet.warnings.length > 0) {
        lines.push(`  warnings: ${packet.warnings.join(' | ')}`);
      }
    }
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

const CAPTURE_POST_PST_EVIDENCE_SPEC: EnvelopeCommandSpec<CapturePostPstEvidenceCommandDependencies> = {
  commandName: 'capture-post-pst-evidence',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseCapturePostPstEvidenceFlags(argv);
    const readinessIssues = getCapturePostPstEvidenceReadinessIssues(commandFlags);

    if (readinessIssues.length > 0) {
      throw new Error(formatCommandReadinessIssues('capture-post-pst-evidence', readinessIssues));
    }

    const runPrimitive = deps.executeCapturePostPstEvidence ?? executeCapturePostPstEvidence;
    const primitiveResult = await runPrimitive({
      orgAlias: globalFlags.orgAlias!,
      quoteId: commandFlags.quoteId ?? '',
      lineIds: commandFlags.lineIds,
      allLines: commandFlags.allLines,
      includeAdjustments: commandFlags.includeAdjustments,
      includeLineDetail: commandFlags.includeLineDetail,
      includeUsageRating: commandFlags.includeUsageRating
    });

    return buildCapturePostPstEvidenceEnvelope({
      globalFlags,
      commandFlags,
      primitiveResult,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderCapturePostPstEvidenceText
};

export async function runCapturePostPstEvidenceCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: CapturePostPstEvidenceCommandDependencies = {}
): Promise<CapturePostPstEvidenceExecution> {
  return runEnvelopeCommand(CAPTURE_POST_PST_EVIDENCE_SPEC, argv, globalFlags, io, dependencies);
}

function getCapturePostPstEvidenceReadinessIssues(
  commandFlags: CapturePostPstEvidenceCommandFlags
): CommandReadinessIssue[] {
  if (commandFlags.allLines && commandFlags.lineIds.length > 0) {
    return [{ key: 'line_ids', message: 'Use either --all-lines or one or more --line-id values, not both.' }];
  }
  return getReadinessIssuesForPolicy(
    CAPTURE_POST_PST_EVIDENCE_SELECTOR_POLICY,
    normalizeSelectors({
      quote_id: commandFlags.quoteId,
      line_id: commandFlags.allLines ? ['__all_lines__'] : commandFlags.lineIds
    })
  );
}

function buildCapturePostPstEvidenceStatusReason(
  commandFlags: CapturePostPstEvidenceCommandFlags,
  primitiveResult: CapturePostPstEvidencePrimitiveResult
): string {
  const quoteId = commandFlags.quoteId ?? '(missing quote id)';
  const counts = primitiveResult.result.counts;

  switch (primitiveResult.status) {
    case 'ok':
      return `Captured complete post-PST evidence for ${counts.ok_packets} requested lines on quote '${quoteId}'.`;
    case 'partial':
      return `Captured quote and line evidence for quote '${quoteId}', but ${counts.partial_packets + counts.error_packets + counts.unsupported_packets + counts.no_match_packets} requested lines remained incomplete.`;
    case 'no_match':
      return `Quote '${quoteId}' resolved, but none of the requested line ids matched persisted line snapshots.`;
    case 'unsupported':
      return primitiveResult.errors[0] ?? `Post-PST evidence capture is unsupported for quote '${quoteId}'.`;
    case 'error':
      return primitiveResult.errors[0] ?? `Post-PST evidence capture failed for quote '${quoteId}'.`;
  }
}

function capturePostPstEvidenceResultToJsonRecord(
  result: CapturePostPstEvidenceResult
): Record<string, JsonValue> {
  return {
    quote_snapshot: result.quote_snapshot as JsonValue,
    line_snapshots: result.line_snapshots as JsonValue,
    line_evidence_packets: result.line_evidence_packets as unknown as JsonValue,
    optional_artifacts: result.optional_artifacts as unknown as JsonValue,
    counts: result.counts as unknown as JsonValue,
    recommended_next_commands: [...result.recommended_next_commands]
  };
}

function formatList(values: readonly string[]): string {
  return values.length === 0 ? '(none)' : values.join(', ');
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

// Extracted so getCapturePostPstEvidenceReadinessIssues can use it directly
// (via getReadinessIssuesForPolicy) without consulting the derived map.
const CAPTURE_POST_PST_EVIDENCE_SELECTOR_POLICY: CommandSelectorPolicy = {
  required_selectors: ['quote_id', 'line_ids'],
  recommended_selectors: [],
  status_reason: 'Post-PST evidence capture requires a quote id and at least one target line id.'
};

export const CAPTURE_POST_PST_EVIDENCE_COMMAND_SPEC = defineCommand({
  name: 'capture-post-pst-evidence',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Capture one bounded read-only post-PST evidence packet across one or more targeted quote lines.',
  ownership: {
        primary_owner: 'pricing-runtime-debug',
        secondary_escalation: ['runtime-context-inspection', 'config-runtime-bridge'],
        shared_library_dependencies: ['snapshot_quote', 'snapshot_lines', 'selectors', 'evidence']
  },
  selectorPolicy: CAPTURE_POST_PST_EVIDENCE_SELECTOR_POLICY,
    quickStart: 'quote-runtime capture-post-pst-evidence --org-alias <alias> --quote-id <id> --line-id <id> --line-id <id>',
  renderHelp: renderCapturePostPstEvidenceHelp,
  run: runCapturePostPstEvidenceCommand
});
