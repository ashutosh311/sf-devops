import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executeSnapshotQuote,
  type ExecuteSnapshotQuoteInput,
  type SnapshotQuotePrimitiveResult,
  type SnapshotQuoteRecord,
  type SnapshotQuoteResult
} from '../primitives/snapshot-quote';

export const SNAPSHOT_QUOTE_HELP_TEXT = [
  'quote-runtime snapshot-quote',
  '',
  'Usage:',
  '  quote-runtime snapshot-quote --org-alias <alias> --quote-id <id>',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Snapshot-quote flags:',
  '  --quote-id <id>',
  '',
  'Notes:',
  '  snapshot-quote performs a persisted Salesforce Quote read only.',
  '  snapshot-quote uses the locked wave-2 quote snapshot field set.',
  '',
  'Example:',
  '  quote-runtime snapshot-quote --org-alias <alias> --quote-id <id>'
].join('\n');

const SNAPSHOT_QUOTE_FLAG_DEFINITIONS = {
  'quote-id': Flags.string({
    required: true,
    helpValue: '<id>',
    summary: 'Target quote id to snapshot from persisted Salesforce Quote data.'
  })
};

export type SnapshotQuoteCommandFlags = {
  quoteId: string;
};

export type SnapshotQuoteExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type BuildSnapshotQuoteEnvelopeInput = {
  globalFlags: GlobalFlags;
  commandFlags: SnapshotQuoteCommandFlags;
  primitiveResult: SnapshotQuotePrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
};

export type SnapshotQuoteCommandDependencies = {
  executeSnapshotQuote?: (input: ExecuteSnapshotQuoteInput) => Promise<SnapshotQuotePrimitiveResult>;
};

export async function parseSnapshotQuoteFlags(argv: string[]): Promise<SnapshotQuoteCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: SNAPSHOT_QUOTE_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'quote-id': string;
    };
  };

  return {
    quoteId: parsed.flags['quote-id']
  };
}

export function renderSnapshotQuoteHelp(): string {
  return SNAPSHOT_QUOTE_HELP_TEXT;
}

export function buildSnapshotQuoteEnvelope(input: BuildSnapshotQuoteEnvelopeInput): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('snapshot-quote envelope requires a resolved org alias.');
  }

  return makeEnvelope({
    command: 'snapshot-quote',
    status: input.primitiveResult.status,
    summary: {
      primary_subject: input.commandFlags.quoteId,
      status_reason: buildSnapshotQuoteStatusReason(input.commandFlags.quoteId, input.primitiveResult),
      primary_lane: 'persisted_snapshot',
      verification_anchor: `quote:${input.commandFlags.quoteId}`,
      next_suggested_command: null
    } satisfies Record<string, JsonValue>,
    result: snapshotQuoteResultToJsonRecord(input.primitiveResult.result),
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

export function renderSnapshotQuoteText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as SnapshotQuoteResult;
  const lines = [
    'quote-runtime snapshot-quote',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `quote id: ${String(envelope.summary.primary_subject ?? '(unknown)')}`,
    `snapshot type: ${result.snapshot_type}`,
    `field set: ${result.field_set.join(', ')}`,
    '',
    'quote:'
  ];

  if (result.quote === null) {
    lines[lines.length - 1] = 'quote: (none)';
  } else {
    for (const [fieldName, value] of Object.entries(result.quote)) {
      lines.push(`${fieldName}: ${formatSnapshotQuoteValue(value)}`);
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

const SNAPSHOT_QUOTE_SPEC: EnvelopeCommandSpec<SnapshotQuoteCommandDependencies> = {
  commandName: 'snapshot-quote',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseSnapshotQuoteFlags(argv);
    const runPrimitive = deps.executeSnapshotQuote ?? executeSnapshotQuote;
    const primitiveResult = await runPrimitive({
      orgAlias: globalFlags.orgAlias!,
      quoteId: commandFlags.quoteId
    });
    return buildSnapshotQuoteEnvelope({
      globalFlags,
      commandFlags,
      primitiveResult,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderSnapshotQuoteText
};

export async function runSnapshotQuoteCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: SnapshotQuoteCommandDependencies = {}
): Promise<SnapshotQuoteExecution> {
  return runEnvelopeCommand(SNAPSHOT_QUOTE_SPEC, argv, globalFlags, io, dependencies);
}

function buildSnapshotQuoteStatusReason(
  quoteId: string,
  primitiveResult: SnapshotQuotePrimitiveResult
): string {
  switch (primitiveResult.status) {
    case 'ok':
      return `Retrieved persisted quote snapshot for ${quoteId}.`;
    case 'no_match':
      return `No persisted Quote row matched ${quoteId}.`;
    case 'unsupported':
      return primitiveResult.errors[0] ?? `Persisted quote snapshot is unsupported for ${quoteId}.`;
    case 'error':
      return primitiveResult.errors[0] ?? `Persisted quote snapshot failed for ${quoteId}.`;
  }
}

function snapshotQuoteResultToJsonRecord(result: SnapshotQuoteResult): Record<string, JsonValue> {
  return {
    quote: result.quote as SnapshotQuoteRecord | null,
    field_set: [...result.field_set],
    snapshot_type: result.snapshot_type
  };
}

function formatSnapshotQuoteValue(value: JsonValue): string {
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

export const SNAPSHOT_QUOTE_COMMAND_SPEC = defineCommand({
  name: 'snapshot-quote',
  wave: 2,
  group_name: WAVE_GROUP_NAMES[2],
  summary: 'Read the persisted Salesforce Quote snapshot for a targeted quote id.',
  ownership: {
        primary_owner: 'pricing-runtime-debug',
        secondary_escalation: ['quote-runtime-mutations'],
        shared_library_dependencies: ['snapshot_quote', 'result_envelope', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['quote_id'],
        recommended_selectors: [],
        status_reason: 'Quote snapshots require one target quote id.'
  },
    quickStart: 'quote-runtime snapshot-quote --org-alias <alias> --quote-id <id>',
  renderHelp: renderSnapshotQuoteHelp,
  run: runSnapshotQuoteCommand
});
