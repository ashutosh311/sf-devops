import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import { OPERATION_FAMILIES, type OperationFamily } from '../contracts/operation-family';
import { normalizeOptionalId, normalizeOptionalText, normalizeRepeatableIds } from '../selectors/runtime-selectors';
import { executePstPlan, type ExecutePstPlanInput, type PstPlanPrimitiveResult, type PstPlanResult } from '../primitives/pst-plan';

export const PST_PLAN_HELP_TEXT = [
  'quote-runtime pst-plan',
  '',
  'Usage:',
  '  quote-runtime pst-plan --org-alias <alias> --operation-family <pst_place|initiate_amendment|initiate_renewal|asset_add_to_renewal> [--quote-id <id>] [--line-id <id> ...] [--asset-id <id> ...] [--expected-change <text>]',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Pst-plan flags:',
  '  --operation-family <family>',
  '  --quote-id <id>         Optional persisted quote anchor for before/after capture guidance.',
  '  --line-id <id>          Optional line narrowing for capture and verification planning.',
  '  --asset-id <id>         Optional asset anchors for lifecycle and renewal planning.',
  '  --expected-change <text> Optional operator intent note carried into the payload summary.',
  '',
  'Notes:',
  '  pst-plan remains explicitly read-only and plan_only in wave 2.',
  '  pst-plan does not execute PST routes, mutate org state, or imply execution success.',
  '',
  'Example:',
  '  quote-runtime pst-plan --org-alias <alias> --operation-family initiate_amendment --quote-id <id> --asset-id <id>'
].join('\n');

const PST_PLAN_FLAG_DEFINITIONS = {
  'operation-family': Flags.string({
    required: true,
    helpValue: '<family>',
    summary: 'Canonical PST operation family used to choose the plan-only route posture.'
  }),
  'quote-id': Flags.string({
    required: false,
    helpValue: '<id>',
    summary: 'Optional persisted quote anchor for capture planning.'
  }),
  'line-id': Flags.string({
    multiple: true,
    helpValue: '<id>',
    summary: 'Optional line-id narrowing carried into capture planning.'
  }),
  'asset-id': Flags.string({
    multiple: true,
    helpValue: '<id>',
    summary: 'Optional asset anchors carried into lifecycle and renewal planning.'
  }),
  'expected-change': Flags.string({
    required: false,
    helpValue: '<text>',
    summary: 'Optional expected-change note carried into the payload summary.'
  })
};

export type PstPlanCommandFlags = {
  operationFamily: OperationFamily;
  quoteId: string | null;
  lineIds: string[];
  assetIds: string[];
  expectedChange: string | null;
};

export type PstPlanExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type BuildPstPlanEnvelopeInput = {
  globalFlags: GlobalFlags;
  commandFlags: PstPlanCommandFlags;
  primitiveResult: PstPlanPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
};

export type PstPlanCommandDependencies = {
  executePstPlan?: (input: ExecutePstPlanInput) => Promise<PstPlanPrimitiveResult>;
};

export async function parsePstPlanFlags(argv: string[]): Promise<PstPlanCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: PST_PLAN_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'operation-family': string;
      'quote-id'?: string;
      'line-id'?: string[];
      'asset-id'?: string[];
      'expected-change'?: string;
    };
  };

  return {
    operationFamily: parseCanonicalOperationFamily(parsed.flags['operation-family']),
    quoteId: normalizeOptionalId(parsed.flags['quote-id'], 'quote-id'),
    lineIds: normalizeRepeatableIds(parsed.flags['line-id'], 'line-id'),
    assetIds: normalizeRepeatableIds(parsed.flags['asset-id'], 'asset-id'),
    expectedChange: normalizeOptionalText(parsed.flags['expected-change'])
  };
}

export function renderPstPlanHelp(): string {
  return PST_PLAN_HELP_TEXT;
}

export function buildPstPlanEnvelope(input: BuildPstPlanEnvelopeInput): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('pst-plan envelope requires a resolved org alias.');
  }

  return makeEnvelope({
    command: 'pst-plan',
    status: input.primitiveResult.status,
    summary: {
      primary_subject: input.commandFlags.quoteId ?? input.commandFlags.assetIds[0] ?? input.commandFlags.operationFamily,
      status_reason: buildPstPlanStatusReason(input.commandFlags, input.primitiveResult),
      primary_lane: 'plan_only',
      verification_anchor:
        input.primitiveResult.result.before_capture_plan.verification_anchor_expectation ?? input.commandFlags.operationFamily,
      next_suggested_command: buildPstPlanNextSuggestedCommand(input.primitiveResult.result),
      key_counts: {
        line_ids: input.commandFlags.lineIds.length,
        asset_ids: input.commandFlags.assetIds.length,
        verification_branch_hints: input.primitiveResult.result.verification_branch_hints.length
      }
    },
    result: pstPlanResultToJsonRecord(input.primitiveResult.result),
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

export function renderPstPlanText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as PstPlanResult;
  const lines = [
    'quote-runtime pst-plan',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `mode: ${result.mode}`,
    `operation family: ${result.operation_family}`,
    `route: ${result.route}`,
    `contract class: ${result.contract_class}`,
    `side effect scope: ${result.side_effect_scope}`,
    `payload intent: ${result.payload_summary.intent}`,
    `execution requested: ${String(result.payload_summary.execution_requested)}`,
    `verification anchor: ${String(envelope.summary.verification_anchor)}`,
    'subjects:'
  ];

  lines.push(`- quote_id: ${result.subjects.quote_id ?? 'null'}`);
  lines.push(`- line_ids: ${result.subjects.line_ids.length > 0 ? result.subjects.line_ids.join(', ') : '(none)'}`);
  lines.push(`- asset_ids: ${result.subjects.asset_ids.length > 0 ? result.subjects.asset_ids.join(', ') : '(none)'}`);
  lines.push(`- expected_change: ${result.subjects.expected_change ?? 'null'}`);
  lines.push('before capture plan:');
  for (const read of result.before_capture_plan.required_reads) {
    lines.push(`- ${read.surface} required=${String(read.required)} selectors=${JSON.stringify(read.selectors)}`);
  }
  if (result.before_capture_plan.optional_overlays.length > 0) {
    lines.push(`- optional overlays: ${result.before_capture_plan.optional_overlays.join('; ')}`);
  }

  lines.push('after capture plan:');
  for (const read of result.after_capture_plan.required_reads) {
    lines.push(`- ${read.surface} required=${String(read.required)} selectors=${JSON.stringify(read.selectors)}`);
  }
  lines.push(`- comparison expectation: ${result.after_capture_plan.comparison_expectation}`);
  lines.push('verification branch hints:');
  for (const hint of result.verification_branch_hints) {
    lines.push(`- ${hint.branch}: ${hint.when} -> ${hint.recommended_command}`);
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

const PST_PLAN_SPEC: EnvelopeCommandSpec<PstPlanCommandDependencies> = {
  commandName: 'pst-plan',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parsePstPlanFlags(argv);
    const runPrimitive = deps.executePstPlan ?? executePstPlan;
    const primitiveResult = await runPrimitive({
      operationFamily: commandFlags.operationFamily,
      quoteId: commandFlags.quoteId,
      lineIds: commandFlags.lineIds,
      assetIds: commandFlags.assetIds,
      expectedChange: commandFlags.expectedChange
    });
    return buildPstPlanEnvelope({
      globalFlags,
      commandFlags,
      primitiveResult,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderPstPlanText
};

export async function runPstPlanCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: PstPlanCommandDependencies = {}
): Promise<PstPlanExecution> {
  return runEnvelopeCommand(PST_PLAN_SPEC, argv, globalFlags, io, dependencies);
}

function buildPstPlanStatusReason(
  commandFlags: PstPlanCommandFlags,
  primitiveResult: PstPlanPrimitiveResult
): string {
  return primitiveResult.status === 'ok'
    ? `Plan-only PST guidance assembled for ${commandFlags.operationFamily} without execution semantics.`
    : `Plan-only PST guidance assembled for ${commandFlags.operationFamily}, but verification anchors remain broad.`;
}

function buildPstPlanNextSuggestedCommand(result: PstPlanResult): string | null {
  const persistedVerificationCommand = result.verification_branch_hints.find(
    (hint) => hint.branch === 'persisted_verification'
  )?.recommended_command;

  if (!persistedVerificationCommand) {
    return null;
  }

  switch (persistedVerificationCommand) {
    case 'snapshot-lines':
      return result.subjects.quote_id ? 'snapshot-lines' : null;
    case 'snapshot-quote':
      return result.subjects.quote_id ? 'snapshot-quote' : null;
    default:
      return null;
  }
}

function pstPlanResultToJsonRecord(result: PstPlanResult): Record<string, JsonValue> {
  return {
    mode: result.mode,
    operation_family: result.operation_family,
    route: result.route,
    contract_class: result.contract_class,
    subjects: result.subjects as unknown as JsonValue,
    side_effect_scope: result.side_effect_scope,
    payload_summary: result.payload_summary as unknown as JsonValue,
    before_capture_plan: result.before_capture_plan as unknown as JsonValue,
    after_capture_plan: result.after_capture_plan as unknown as JsonValue,
    verification_branch_hints: result.verification_branch_hints as unknown as JsonValue
  };
}

function parseCanonicalOperationFamily(value: string): OperationFamily {
  if ((OPERATION_FAMILIES as readonly string[]).includes(value)) {
    return value as OperationFamily;
  }

  throw new Error(
    'The pst-plan command requires a canonical --operation-family value: pst_place, initiate_amendment, initiate_renewal, or asset_add_to_renewal.'
  );
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const PST_PLAN_COMMAND_SPEC = defineCommand({
  name: 'pst-plan',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Assemble plan-only PST route, capture, and verification guidance without execution.',
  ownership: {
        primary_owner: 'quote-runtime-mutations',
        secondary_escalation: ['pricing-runtime-debug'],
        shared_library_dependencies: ['pst_plan', 'selectors', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['operation_family'],
        recommended_selectors: ['quote_id', 'asset_ids', 'line_ids', 'expected_change'],
        status_reason: 'PST planning requires an operation family before any route can be chosen.'
  },
    quickStart: 'quote-runtime pst-plan --org-alias <alias> --operation-family initiate_amendment --quote-id <id>',
  renderHelp: renderPstPlanHelp,
  run: runPstPlanCommand
});
