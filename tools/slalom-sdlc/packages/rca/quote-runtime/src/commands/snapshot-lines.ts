import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import {
  dedupeLineIds,
  executeSnapshotLines,
  type ExecuteSnapshotLinesInput,
  type SnapshotLineRecord,
  type SnapshotLinesPrimitiveResult,
  type SnapshotLinesResult
} from '../primitives/snapshot-lines';

export const SNAPSHOT_LINES_HELP_TEXT = [
  'quote-runtime snapshot-lines',
  '',
  'Usage:',
  '  quote-runtime snapshot-lines --org-alias <alias> --quote-id <id> [--line-id <id> ...]',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Snapshot-lines flags:',
  '  --quote-id <id>',
  '  --line-id <id> (repeatable)',
  '',
  'Notes:',
  '  snapshot-lines performs a persisted Salesforce QuoteLineItem read only.',
  '  snapshot-lines uses the locked wave-2 QuoteLineItem snapshot field set.',
  '  Omitting --line-id returns all lines on the target quote.',
  '',
  'Examples:',
  '  quote-runtime snapshot-lines --org-alias <alias> --quote-id <id>',
  '  quote-runtime snapshot-lines --org-alias <alias> --quote-id <id> --line-id <id>'
].join('\n');

const SNAPSHOT_LINES_FLAG_DEFINITIONS = {
  'quote-id': Flags.string({
    required: true,
    helpValue: '<id>',
    summary: 'Target quote id to snapshot persisted Salesforce QuoteLineItem rows for.'
  }),
  'line-id': Flags.string({
    multiple: true,
    helpValue: '<id>',
    summary: 'Optional line id narrowing. Repeat to target multiple persisted quote lines.'
  })
};

export type SnapshotLinesCommandFlags = {
  quoteId: string;
  lineIds: string[];
};

export type SnapshotLinesExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type BuildSnapshotLinesEnvelopeInput = {
  globalFlags: GlobalFlags;
  commandFlags: SnapshotLinesCommandFlags;
  primitiveResult: SnapshotLinesPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
};

export type SnapshotLinesCommandDependencies = {
  executeSnapshotLines?: (input: ExecuteSnapshotLinesInput) => Promise<SnapshotLinesPrimitiveResult>;
};

export async function parseSnapshotLinesFlags(argv: string[]): Promise<SnapshotLinesCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: SNAPSHOT_LINES_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'quote-id': string;
      'line-id'?: string[];
    };
  };

  return {
    quoteId: parsed.flags['quote-id'],
    lineIds: dedupeLineIds(parsed.flags['line-id'] ?? [])
  };
}

export function renderSnapshotLinesHelp(): string {
  return SNAPSHOT_LINES_HELP_TEXT;
}

export function buildSnapshotLinesEnvelope(input: BuildSnapshotLinesEnvelopeInput): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('snapshot-lines envelope requires a resolved org alias.');
  }

  const counts = input.primitiveResult.result.counts;

  return makeEnvelope({
    command: 'snapshot-lines',
    status: input.primitiveResult.status,
    summary: {
      primary_subject: input.commandFlags.quoteId,
      status_reason: buildSnapshotLinesStatusReason(input.commandFlags.quoteId, input.primitiveResult),
      primary_lane: 'persisted_snapshot',
      verification_anchor: `quote:${input.commandFlags.quoteId}`,
      next_suggested_command: null,
      key_counts: {
        returned_lines: counts.returned,
        requested_lines: counts.requested,
        missing_lines: counts.missing,
        available_lines: counts.available_on_quote
      }
    } satisfies Record<string, JsonValue>,
    result: snapshotLinesResultToJsonRecord(input.primitiveResult.result),
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

export function renderSnapshotLinesText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as SnapshotLinesResult;
  const lines = [
    'quote-runtime snapshot-lines',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `quote id: ${result.quote_id}`,
    `counts: returned=${result.counts.returned} requested=${result.counts.requested} available_on_quote=${result.counts.available_on_quote} missing=${result.counts.missing}`,
    `selection: ${result.selection.mode}`,
    `requested line ids: ${formatIdList(result.selection.requested_line_ids)}`,
    `missing line ids: ${formatIdList(result.selection.missing_line_ids)}`,
    `field set: ${result.field_set.join(', ')}`,
    '',
    'lines:'
  ];

  if (result.lines.length === 0) {
    lines[lines.length - 1] = 'lines: (none)';
  } else {
    for (const lineRecord of result.lines) {
      lines.push('-');
      for (const [fieldName, value] of Object.entries(lineRecord)) {
        lines.push(`${fieldName}: ${formatSnapshotLinesValue(value)}`);
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

const SNAPSHOT_LINES_SPEC: EnvelopeCommandSpec<SnapshotLinesCommandDependencies> = {
  commandName: 'snapshot-lines',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseSnapshotLinesFlags(argv);
    const runPrimitive = deps.executeSnapshotLines ?? executeSnapshotLines;
    const primitiveResult = await runPrimitive({
      orgAlias: globalFlags.orgAlias!,
      quoteId: commandFlags.quoteId,
      lineIds: commandFlags.lineIds
    });
    return buildSnapshotLinesEnvelope({
      globalFlags,
      commandFlags,
      primitiveResult,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderSnapshotLinesText
};

export async function runSnapshotLinesCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: SnapshotLinesCommandDependencies = {}
): Promise<SnapshotLinesExecution> {
  return runEnvelopeCommand(SNAPSHOT_LINES_SPEC, argv, globalFlags, io, dependencies);
}

function buildSnapshotLinesStatusReason(
  quoteId: string,
  primitiveResult: SnapshotLinesPrimitiveResult
): string {
  const counts = primitiveResult.result.counts;

  switch (primitiveResult.status) {
    case 'ok':
      return primitiveResult.result.selection.mode === 'all_lines'
        ? `Retrieved ${counts.returned} persisted quote lines for ${quoteId}.`
        : `Retrieved ${counts.returned} matched persisted quote lines for ${quoteId}.`;
    case 'partial':
      return `Retrieved ${counts.returned} matched persisted quote lines for ${quoteId} and ${counts.missing} requested line ids were not found.`;
    case 'no_match':
      return primitiveResult.result.selection.mode === 'all_lines'
        ? `No persisted quote lines were found for ${quoteId}.`
        : `No persisted quote lines matched the requested selectors for ${quoteId}.`;
    case 'unsupported':
      return primitiveResult.errors[0] ?? `Persisted quote line snapshot is unsupported for ${quoteId}.`;
    case 'error':
      return primitiveResult.errors[0] ?? `Persisted quote line snapshot failed for ${quoteId}.`;
  }
}

function snapshotLinesResultToJsonRecord(result: SnapshotLinesResult): Record<string, JsonValue> {
  return {
    quote_id: result.quote_id,
    lines: result.lines as SnapshotLineRecord[],
    field_set: [...result.field_set],
    counts: {
      returned: result.counts.returned,
      requested: result.counts.requested,
      available_on_quote: result.counts.available_on_quote,
      missing: result.counts.missing
    },
    selection: {
      mode: result.selection.mode,
      requested_line_ids: [...result.selection.requested_line_ids],
      missing_line_ids: [...result.selection.missing_line_ids]
    }
  };
}

function formatIdList(values: readonly string[]): string {
  return values.length === 0 ? '(none)' : values.join(', ');
}

function formatSnapshotLinesValue(value: JsonValue): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const SNAPSHOT_LINES_COMMAND_SPEC = defineCommand({
  name: 'snapshot-lines',
  wave: 2,
  group_name: WAVE_GROUP_NAMES[2],
  summary: 'Read the persisted Salesforce QuoteLineItem snapshot rows for a targeted quote id.',
  ownership: {
        primary_owner: 'pricing-runtime-debug',
        secondary_escalation: ['quote-runtime-mutations'],
        shared_library_dependencies: ['snapshot_lines', 'result_envelope', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['quote_id'],
        recommended_selectors: ['line_ids'],
        status_reason: 'Line snapshots require a quote id; line ids are optional narrowing only.'
  },
    quickStart: 'quote-runtime snapshot-lines --org-alias <alias> --quote-id <id> --line-id <id>',
  renderHelp: renderSnapshotLinesHelp,
  run: runSnapshotLinesCommand
});
