import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import { normalizeRepeatableIds } from '../selectors/runtime-selectors';
import {
  executeInspectRlmContext,
  type ExecuteInspectRlmContextInput,
  type InspectRlmContextPrimitiveResult,
  type InspectRlmContextResult
} from '../primitives/inspect-rlm-context';

export const INSPECT_RLM_CONTEXT_HELP_TEXT = [
  'quote-runtime inspect-rlm-context',
  '',
  'Usage:',
  '  quote-runtime inspect-rlm-context --org-alias <alias> [--quote-id <id>] [--line-id <id> ...]',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Inspect-rlm-context flags:',
  '  --quote-id <id>     Optional quote scope hint for follow-up debugging only.',
  '  --line-id <id>      Optional line scope hint for follow-up debugging only.',
  '',
  'Notes:',
  '  inspect-rlm-context emits the normalized summary-first RLM bridge contract only.',
  '  inspect-rlm-context does not emit a full XML or raw metadata dump in default output.',
  '',
  'Example:',
  '  quote-runtime inspect-rlm-context --org-alias <alias> --quote-id <id> --line-id <id>'
].join('\n');

const INSPECT_RLM_CONTEXT_FLAG_DEFINITIONS = {
  'quote-id': Flags.string({
    required: false,
    helpValue: '<id>',
    summary: 'Optional quote selector hint; does not change the summary contract emitted by the command.'
  }),
  'line-id': Flags.string({
    multiple: true,
    helpValue: '<id>',
    summary: 'Optional line selector hint; does not change the summary contract emitted by the command.'
  })
};

export type InspectRlmContextCommandFlags = {
  quoteId?: string;
  lineIds: string[];
};

export type InspectRlmContextExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type BuildInspectRlmContextEnvelopeInput = {
  globalFlags: GlobalFlags;
  commandFlags: InspectRlmContextCommandFlags;
  primitiveResult: InspectRlmContextPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
};

export type InspectRlmContextCommandDependencies = {
  executeInspectRlmContext?: (input: ExecuteInspectRlmContextInput) => Promise<InspectRlmContextPrimitiveResult>;
};

export async function parseInspectRlmContextFlags(argv: string[]): Promise<InspectRlmContextCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: INSPECT_RLM_CONTEXT_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'quote-id'?: string;
      'line-id'?: string[];
    };
  };

  const quoteId = parsed.flags['quote-id'];
  const lineIds = normalizeRepeatableIds(parsed.flags['line-id'], 'line-id');

  return quoteId === undefined ? { lineIds } : { quoteId, lineIds };
}

export function renderInspectRlmContextHelp(): string {
  return INSPECT_RLM_CONTEXT_HELP_TEXT;
}

export function buildInspectRlmContextEnvelope(input: BuildInspectRlmContextEnvelopeInput): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('inspect-rlm-context envelope requires a resolved org alias.');
  }

  return makeEnvelope({
    command: 'inspect-rlm-context',
    status: input.primitiveResult.status,
    summary: {
      primary_subject: input.commandFlags.quoteId ?? 'RLM_SalesTransactionContext',
      status_reason: buildInspectRlmContextStatusReason(input.primitiveResult),
      primary_lane: 'context_bridge',
      verification_anchor: 'context:RLM_SalesTransactionContext',
      next_suggested_command: buildNextSuggestedCommand(input.commandFlags)
    },
    result: inspectRlmContextResultToJsonRecord(input.primitiveResult.result),
    warnings: input.primitiveResult.warnings,
    errors: input.primitiveResult.errors,
    evidence: input.primitiveResult.evidence,
    meta: {
      org_alias: input.globalFlags.orgAlias,
      generated_at: input.generatedAt ?? new Date().toISOString(),
      duration_ms: input.durationMs ?? 0,
      source_files: input.primitiveResult.source_files
    }
  });
}

export function renderInspectRlmContextText(envelope: ResultEnvelope, commandFlags?: InspectRlmContextCommandFlags): string {
  const result = envelope.result as unknown as InspectRlmContextResult;
  const lines = [
    'quote-runtime inspect-rlm-context',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `context artifact: ${result.context_artifact.name}`,
    `artifact source: ${result.context_artifact.source}`
  ];

  if (result.context_artifact.last_modified) {
    lines.push(`artifact last modified: ${result.context_artifact.last_modified}`);
  }
  if (commandFlags?.quoteId) {
    lines.push(`quote scope hint: ${commandFlags.quoteId}`);
  }
  if (commandFlags && commandFlags.lineIds.length > 0) {
    lines.push(`line scope hints: ${commandFlags.lineIds.join(', ')}`);
  }

  lines.push(`relevant mappings: ${result.relevant_mappings.length}`);
  lines.push(`primary bridge: ${result.bridge_summary.primary_bridge}`);
  lines.push(`quote header mapping: ${result.bridge_summary.quote_header_mapping}`);
  lines.push(`quote line mapping: ${result.bridge_summary.quote_line_mapping}`);
  lines.push(`lifecycle mapping: ${result.bridge_summary.lifecycle_mapping}`);
  lines.push(`waterfall mapping: ${result.bridge_summary.waterfall_mapping}`);

  if (result.relevant_mappings.length === 0) {
    lines.push('mapping summaries: (none)');
  } else {
    lines.push('mapping summaries:');
    for (const mapping of result.relevant_mappings) {
      lines.push(`- ${mapping.mapping_name} | job=${mapping.primary_debug_job} | evidence=${mapping.evidence_level} | nodes=${mapping.key_nodes.join(', ')}`);
    }
  }

  if (result.bridge_summary.limitations.length > 0) {
    lines.push('limitations:');
    for (const limitation of result.bridge_summary.limitations) {
      lines.push(`- ${limitation}`);
    }
  }

  if (result.open_questions.length > 0) {
    lines.push('open questions:');
    for (const question of result.open_questions) {
      lines.push(`- ${question}`);
    }
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

function makeInspectRlmContextSpec(): EnvelopeCommandSpec<InspectRlmContextCommandDependencies> {
  let parsedFlags: InspectRlmContextCommandFlags | undefined;
  return {
    commandName: 'inspect-rlm-context',
    execute: async ({ argv, globalFlags, startedAt, deps }) => {
      parsedFlags = await parseInspectRlmContextFlags(argv);
      const runPrimitive = deps.executeInspectRlmContext ?? executeInspectRlmContext;
      const primitiveInput: ExecuteInspectRlmContextInput = {
        orgAlias: globalFlags.orgAlias!,
        lineIds: parsedFlags.lineIds,
        ...(parsedFlags.quoteId === undefined ? {} : { quoteId: parsedFlags.quoteId })
      };
      const primitiveResult = await runPrimitive(primitiveInput);
      return buildInspectRlmContextEnvelope({
        globalFlags,
        commandFlags: parsedFlags,
        primitiveResult,
        durationMs: Math.max(0, Date.now() - startedAt)
      });
    },
    renderText: (envelope) => renderInspectRlmContextText(envelope, parsedFlags)
  };
}

export async function runInspectRlmContextCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: InspectRlmContextCommandDependencies = {}
): Promise<InspectRlmContextExecution> {
  return runEnvelopeCommand(makeInspectRlmContextSpec(), argv, globalFlags, io, dependencies);
}

function buildInspectRlmContextStatusReason(primitiveResult: InspectRlmContextPrimitiveResult): string {
  switch (primitiveResult.status) {
    case 'ok':
      return 'Loaded the summary-first RLM context bridge inspection for RLM_SalesTransactionContext.';
    case 'unsupported':
      return primitiveResult.errors[0] ?? 'Primary RLM context summary artifact is unavailable.';
  }
}

function buildNextSuggestedCommand(commandFlags: InspectRlmContextCommandFlags): string | null {
  if (commandFlags.lineIds.length > 0) {
    return 'snapshot-lines';
  }
  if (commandFlags.quoteId) {
    return 'snapshot-quote';
  }
  return null;
}

function inspectRlmContextResultToJsonRecord(result: InspectRlmContextResult): Record<string, JsonValue> {
  return {
    context_artifact: result.context_artifact as unknown as JsonValue,
    relevant_mappings: result.relevant_mappings as unknown as JsonValue,
    bridge_summary: result.bridge_summary as unknown as JsonValue,
    open_questions: result.open_questions
  };
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const INSPECT_RLM_CONTEXT_COMMAND_SPEC = defineCommand({
  name: 'inspect-rlm-context',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Inspect the summary-first RLM context bridge without emitting a raw metadata dump.',
  ownership: {
        primary_owner: 'runtime-context-inspection',
        secondary_escalation: ['pricing-runtime-debug', 'config-runtime-bridge'],
        shared_library_dependencies: ['inspect_rlm_context', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: ['quote_id', 'line_ids'],
        status_reason: 'Context inspection can run broadly, but scoped selectors improve evidence quality.'
  },
    quickStart: 'quote-runtime inspect-rlm-context --org-alias <alias> --quote-id <id> --line-id <id>',
  renderHelp: renderInspectRlmContextHelp,
  run: runInspectRlmContextCommand
});
