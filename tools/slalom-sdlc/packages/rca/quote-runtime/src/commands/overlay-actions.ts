import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import { normalizeRepeatableIds } from '../selectors/runtime-selectors';
import {
  executeOverlayActions,
  type ExecuteOverlayActionsInput,
  type OverlayActionLineLink,
  type OverlayActionRecord,
  type OverlayActionsPrimitiveResult,
  type OverlayActionsResult
} from '../primitives/overlay-actions';

export const OVERLAY_ACTIONS_HELP_TEXT = [
  'quote-runtime overlay-actions',
  '',
  'Usage:',
  '  quote-runtime overlay-actions --org-alias <alias> --quote-id <id> [--line-id <id> ...]',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Overlay-actions flags:',
  '  --quote-id <id>',
  '  --line-id <id>',
  '',
  'Notes:',
  '  overlay-actions reads QuoteAction lifecycle provenance only.',
  '  overlay-actions does not infer structural or bundle semantics.',
  '',
  'Example:',
  '  quote-runtime overlay-actions --org-alias <alias> --quote-id <id> --line-id <id>'
].join('\n');

const OVERLAY_ACTIONS_FLAG_DEFINITIONS = {
  'quote-id': Flags.string({
    required: true,
    helpValue: '<id>',
    summary: 'Target quote id for QuoteAction lifecycle provenance reads.'
  }),
  'line-id': Flags.string({
    multiple: true,
    helpValue: '<id>',
    summary: 'Optional quote line ids to narrow the lifecycle provenance overlay.'
  })
};

export type OverlayActionsCommandFlags = {
  quoteId: string;
  lineIds: string[];
};

export type OverlayActionsExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type BuildOverlayActionsEnvelopeInput = {
  globalFlags: GlobalFlags;
  commandFlags: OverlayActionsCommandFlags;
  primitiveResult: OverlayActionsPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
};

export type OverlayActionsCommandDependencies = {
  executeOverlayActions?: (input: ExecuteOverlayActionsInput) => Promise<OverlayActionsPrimitiveResult>;
};

export async function parseOverlayActionsFlags(argv: string[]): Promise<OverlayActionsCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: OVERLAY_ACTIONS_FLAG_DEFINITIONS,
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

export function renderOverlayActionsHelp(): string {
  return OVERLAY_ACTIONS_HELP_TEXT;
}

export function buildOverlayActionsEnvelope(input: BuildOverlayActionsEnvelopeInput): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('overlay-actions envelope requires a resolved org alias.');
  }

  return makeEnvelope({
    command: 'overlay-actions',
    status: input.primitiveResult.status,
    summary: {
      primary_subject: input.commandFlags.quoteId,
      status_reason: buildOverlayActionsStatusReason(input.commandFlags, input.primitiveResult),
      primary_lane: 'lifecycle_provenance',
      verification_anchor: `quote:${input.commandFlags.quoteId}`,
      next_suggested_command: null,
      line_ids: [...input.commandFlags.lineIds]
    } satisfies Record<string, JsonValue>,
    result: overlayActionsResultToJsonRecord(input.primitiveResult.result),
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

export function renderOverlayActionsText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as OverlayActionsResult;
  const lineIdsValue = envelope.summary.line_ids;
  const lineIds = Array.isArray(lineIdsValue) ? lineIdsValue.map(String) : [];
  const lines = [
    'quote-runtime overlay-actions',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `quote id: ${String(envelope.summary.primary_subject ?? '(unknown)')}`,
    `line ids: ${lineIds.length > 0 ? lineIds.join(', ') : '(all)'}`,
    `field set: ${result.field_set.join(', ')}`,
    `action rows: ${result.action_rows.length}`,
    `line action links: ${result.line_action_links.length}`,
    ''
  ];

  if (result.action_rows.length === 0) {
    lines.push('action rows detail: (none)');
  } else {
    lines.push('action rows detail:');
    for (const row of result.action_rows) {
      lines.push(
        `- ${String(row.Id)} type=${formatOverlayActionsValue(row.Type)} subtype=${formatOverlayActionsValue(row.Subtype)} source_asset_id=${formatOverlayActionsValue(row.SourceAssetId)}`
      );
    }
  }

  if (result.provenance_summary && Object.keys(result.provenance_summary).length > 0) {
    lines.push('');
    lines.push(`provenance summary: ${JSON.stringify(result.provenance_summary)}`);
  } else {
    lines.push('');
    lines.push('provenance summary: (empty)');
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

const OVERLAY_ACTIONS_SPEC: EnvelopeCommandSpec<OverlayActionsCommandDependencies> = {
  commandName: 'overlay-actions',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseOverlayActionsFlags(argv);
    const runPrimitive = deps.executeOverlayActions ?? executeOverlayActions;
    const primitiveResult = await runPrimitive({
      orgAlias: globalFlags.orgAlias!,
      quoteId: commandFlags.quoteId,
      lineIds: commandFlags.lineIds
    });
    return buildOverlayActionsEnvelope({
      globalFlags,
      commandFlags,
      primitiveResult,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderOverlayActionsText
};

export async function runOverlayActionsCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: OverlayActionsCommandDependencies = {}
): Promise<OverlayActionsExecution> {
  return runEnvelopeCommand(OVERLAY_ACTIONS_SPEC, argv, globalFlags, io, dependencies);
}

function buildOverlayActionsStatusReason(
  commandFlags: OverlayActionsCommandFlags,
  primitiveResult: OverlayActionsPrimitiveResult
): string {
  switch (primitiveResult.status) {
    case 'ok':
      return primitiveResult.status_detail === 'empty_overlay'
        ? `No QuoteAction lifecycle provenance rows matched ${commandFlags.quoteId}.`
        : `Retrieved QuoteAction lifecycle provenance overlay for ${commandFlags.quoteId}.`;
    case 'no_match':
      return primitiveResult.status_detail === 'quote_absent'
        ? `No persisted Quote row matched ${commandFlags.quoteId}.`
        : `No requested quote lines matched ${commandFlags.quoteId}.`;
    case 'unsupported':
      return primitiveResult.errors[0] ?? `QuoteAction lifecycle provenance is unsupported for ${commandFlags.quoteId}.`;
    case 'error':
      return primitiveResult.errors[0] ?? `QuoteAction lifecycle provenance failed for ${commandFlags.quoteId}.`;
  }
}

function overlayActionsResultToJsonRecord(result: OverlayActionsResult): Record<string, JsonValue> {
  return {
    quote_id: result.quote_id,
    field_set: [...result.field_set],
    action_rows: result.action_rows as OverlayActionRecord[],
    line_action_links: result.line_action_links.map((link) => lineActionLinkToJsonValue(link)),
    provenance_summary: result.provenance_summary
  };
}

function lineActionLinkToJsonValue(link: OverlayActionLineLink): JsonValue {
  return {
    line_id: link.line_id,
    quote_action_id: link.quote_action_id,
    action_type: link.action_type,
    source_asset_id: link.source_asset_id
  };
}

function formatOverlayActionsValue(value: JsonValue): string {
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

export const OVERLAY_ACTIONS_COMMAND_SPEC = defineCommand({
  name: 'overlay-actions',
  wave: 2,
  group_name: WAVE_GROUP_NAMES[2],
  summary: 'Read QuoteAction lifecycle provenance overlays for a quote and optional quote lines.',
  ownership: {
        primary_owner: 'pricing-runtime-debug',
        secondary_escalation: ['quote-runtime-mutations'],
        shared_library_dependencies: ['overlay_actions', 'selectors', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['quote_id'],
        recommended_selectors: ['line_ids'],
        status_reason: 'QuoteAction overlays start from a known quote.'
  },
    quickStart: 'quote-runtime overlay-actions --org-alias <alias> --quote-id <id>',
  renderHelp: renderOverlayActionsHelp,
  run: runOverlayActionsCommand
});
