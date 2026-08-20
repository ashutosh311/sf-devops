import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import { normalizeRepeatableIds } from '../selectors/runtime-selectors';
import {
  executeOverlayRelationships,
  type ExecuteOverlayRelationshipsInput,
  type OverlayRelationshipsPrimitiveResult,
  type OverlayRelationshipsResult,
  type OverlayRelationshipRow
} from '../primitives/overlay-relationships';

export const OVERLAY_RELATIONSHIPS_HELP_TEXT = [
  'quote-runtime overlay-relationships',
  '',
  'Usage:',
  '  quote-runtime overlay-relationships --org-alias <alias> --quote-id <id> [--line-id <id> ...]',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Overlay-relationships flags:',
  '  --quote-id <id>',
  '  --line-id <id>    Optional line-id narrowing for structure and bundle overlays only.',
  '',
  'Notes:',
  '  overlay-relationships performs a persisted Salesforce QuoteLineRelationship read only.',
  '  overlay-relationships is locked to structure and bundle semantics, not lifecycle provenance.',
  '',
  'Example:',
  '  quote-runtime overlay-relationships --org-alias <alias> --quote-id <id> --line-id <id>'
].join('\n');

const OVERLAY_RELATIONSHIPS_FLAG_DEFINITIONS = {
  'quote-id': Flags.string({
    required: true,
    helpValue: '<id>',
    summary: 'Target quote id whose QuoteLineRelationship overlay should be read.'
  }),
  'line-id': Flags.string({
    multiple: true,
    helpValue: '<id>',
    summary: 'Optional line-id narrowing across MainQuoteLineId, AssociatedQuoteLineId, and RootQuoteLineId.'
  })
};

export type OverlayRelationshipsCommandFlags = {
  quoteId: string;
  lineIds: string[];
};

export type OverlayRelationshipsExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type BuildOverlayRelationshipsEnvelopeInput = {
  globalFlags: GlobalFlags;
  commandFlags: OverlayRelationshipsCommandFlags;
  primitiveResult: OverlayRelationshipsPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
};

export type OverlayRelationshipsCommandDependencies = {
  executeOverlayRelationships?: (input: ExecuteOverlayRelationshipsInput) => Promise<OverlayRelationshipsPrimitiveResult>;
};

export async function parseOverlayRelationshipsFlags(argv: string[]): Promise<OverlayRelationshipsCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: OVERLAY_RELATIONSHIPS_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'quote-id': string;
      'line-id'?: string[];
    };
  };

  return {
    quoteId: parsed.flags['quote-id'],
    lineIds: normalizeRepeatableIds(parsed.flags['line-id'], 'line-id')
  };
}

export function renderOverlayRelationshipsHelp(): string {
  return OVERLAY_RELATIONSHIPS_HELP_TEXT;
}

export function buildOverlayRelationshipsEnvelope(input: BuildOverlayRelationshipsEnvelopeInput): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('overlay-relationships envelope requires a resolved org alias.');
  }

  return makeEnvelope({
    command: 'overlay-relationships',
    status: input.primitiveResult.status,
    summary: {
      primary_subject: input.commandFlags.quoteId,
      status_reason: buildOverlayRelationshipsStatusReason(input.commandFlags, input.primitiveResult),
      primary_lane: 'persisted_overlay',
      verification_anchor: `quote:${input.commandFlags.quoteId}`,
      next_suggested_command: null
    },
    result: overlayRelationshipsResultToJsonRecord(input.primitiveResult.result),
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

export function renderOverlayRelationshipsText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as OverlayRelationshipsResult;
  const lines = [
    'quote-runtime overlay-relationships',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `quote id: ${result.quote_id}`,
    `relationship count: ${result.bundle_summary.relationship_count}`,
    `distinct main line count: ${result.bundle_summary.distinct_main_line_count}`,
    `distinct associated line count: ${result.bundle_summary.distinct_associated_line_count}`,
    `included in bundle price count: ${result.pricing_inclusion_summary.included_in_bundle_price_count}`
  ];

  if (result.bundle_summary.main_roles.length > 0) {
    lines.push(`main roles: ${result.bundle_summary.main_roles.join(', ')}`);
  }
  if (result.bundle_summary.associated_roles.length > 0) {
    lines.push(`associated roles: ${result.bundle_summary.associated_roles.join(', ')}`);
  }
  if (result.bundle_summary.missing_line_ids.length > 0) {
    lines.push(`missing line ids: ${result.bundle_summary.missing_line_ids.join(', ')}`);
  }

  if (result.relationship_rows.length === 0) {
    lines.push('relationship rows: (none)');
  } else {
    lines.push('relationship rows:');
    for (const row of result.relationship_rows) {
      lines.push(renderOverlayRelationshipRow(row));
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

const OVERLAY_RELATIONSHIPS_SPEC: EnvelopeCommandSpec<OverlayRelationshipsCommandDependencies> = {
  commandName: 'overlay-relationships',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseOverlayRelationshipsFlags(argv);
    const runPrimitive = deps.executeOverlayRelationships ?? executeOverlayRelationships;
    const primitiveResult = await runPrimitive({
      orgAlias: globalFlags.orgAlias!,
      quoteId: commandFlags.quoteId,
      lineIds: commandFlags.lineIds
    });
    return buildOverlayRelationshipsEnvelope({
      globalFlags,
      commandFlags,
      primitiveResult,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderOverlayRelationshipsText
};

export async function runOverlayRelationshipsCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: OverlayRelationshipsCommandDependencies = {}
): Promise<OverlayRelationshipsExecution> {
  return runEnvelopeCommand(OVERLAY_RELATIONSHIPS_SPEC, argv, globalFlags, io, dependencies);
}

function buildOverlayRelationshipsStatusReason(
  commandFlags: OverlayRelationshipsCommandFlags,
  primitiveResult: OverlayRelationshipsPrimitiveResult
): string {
  switch (primitiveResult.status) {
    case 'ok':
      return primitiveResult.status_detail === 'empty_overlay'
        ? `No structural QuoteLineRelationship rows matched ${commandFlags.quoteId}; structural bundle semantics remained empty and no lifecycle provenance was inferred.`
        : `Retrieved structural QuoteLineRelationship overlay for ${commandFlags.quoteId}.`;
    case 'partial':
      return `Retrieved a partial structural QuoteLineRelationship overlay for ${commandFlags.quoteId}; some requested line ids were outside the matched relationship scope.`;
    case 'no_match':
      return primitiveResult.status_detail === 'quote_absent'
        ? `No persisted Quote row matched ${commandFlags.quoteId}.`
        : `No requested line ids matched the structural QuoteLineRelationship scope for ${commandFlags.quoteId}.`;
    case 'unsupported':
      return primitiveResult.errors[0] ?? `Structural QuoteLineRelationship overlay is unsupported for ${commandFlags.quoteId}.`;
    case 'error':
      return primitiveResult.errors[0] ?? `Structural QuoteLineRelationship overlay failed for ${commandFlags.quoteId}.`;
  }
}

function overlayRelationshipsResultToJsonRecord(result: OverlayRelationshipsResult): Record<string, JsonValue> {
  return {
    quote_id: result.quote_id,
    relationship_rows: result.relationship_rows as unknown as JsonValue,
    bundle_summary: result.bundle_summary as unknown as JsonValue,
    pricing_inclusion_summary: result.pricing_inclusion_summary as unknown as JsonValue
  };
}

function renderOverlayRelationshipRow(row: OverlayRelationshipRow): string {
  return `- ${row.relationship_id ?? '(unknown)'} main=${formatRowValue(row.main_line_number)}/${row.main_line_id ?? '-'} associated=${formatRowValue(row.associated_line_number)}/${row.associated_line_id ?? '-'} pricing=${row.associated_line_pricing ?? '-'} inclusive=${formatRowValue(row.is_price_inclusive)}`;
}

function formatRowValue(value: JsonValue | boolean | null): string {
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

export const OVERLAY_RELATIONSHIPS_COMMAND_SPEC = defineCommand({
  name: 'overlay-relationships',
  wave: 2,
  group_name: WAVE_GROUP_NAMES[2],
  summary: 'Read the persisted QuoteLineRelationship overlay for bundle and structure verification.',
  ownership: {
        primary_owner: 'pricing-runtime-debug',
        secondary_escalation: ['quote-runtime-mutations'],
        shared_library_dependencies: ['overlay_relationships', 'selectors', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['quote_id'],
        recommended_selectors: ['line_ids'],
        status_reason: 'QuoteLineRelationship overlays start from a known quote.'
  },
    quickStart: 'quote-runtime overlay-relationships --org-alias <alias> --quote-id <id> --line-id <id>',
  renderHelp: renderOverlayRelationshipsHelp,
  run: runOverlayRelationshipsCommand
});
