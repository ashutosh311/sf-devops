import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import type { EvidenceItem } from '../contracts/evidence';
import { exitCodeForStatus, makeEnvelope, type JsonValue, type ResultEnvelope } from '../contracts/result-envelope';
import type { OperationFamily } from '../contracts/operation-family';
import {
  executePstPlan,
  type ExecutePstPlanInput,
  type PstPlanAfterCapturePlan,
  type PstPlanBeforeCapturePlan,
  type PstPlanPayloadSummary,
  type PstPlanPrimitiveResult,
  type PstPlanResult,
  type PstPlanSubjects,
  type PstPlanVerificationBranchHint
} from '../primitives/pst-plan';
import { normalizeOptionalId, normalizeOptionalText, normalizeRepeatableIds } from '../selectors/runtime-selectors';

const LIFECYCLE_OPERATION_FAMILIES = [
  'initiate_amendment',
  'initiate_renewal',
  'asset_add_to_renewal'
] as const satisfies readonly OperationFamily[];

type LifecycleOperationFamily = (typeof LIFECYCLE_OPERATION_FAMILIES)[number];

export const CREATE_LIFECYCLE_SCENARIO_HELP_TEXT = [
  'quote-runtime create-lifecycle-scenario',
  '',
  'Usage:',
  '  quote-runtime create-lifecycle-scenario --org-alias <alias> --operation-family <initiate_amendment|initiate_renewal|asset_add_to_renewal> [--asset-id <id> ...] [--quote-id <id>] [--expected-change <text>]',
  '',
  'Global flags:',
  '  --json',
  '  --org-alias <alias>',
  '  --fail-on <status>',
  '  --output <path>',
  '  --verbose',
  '',
  'Create-lifecycle-scenario flags:',
  '  --operation-family <family>',
  '  --asset-id <id>          Optional asset anchors for renewal and lifecycle lineage planning.',
  '  --quote-id <id>          Optional source quote anchor for before/after capture guidance.',
  '  --expected-change <text> Optional operator intent note carried into the lifecycle scenario plan.',
  '',
  'Notes:',
  '  create-lifecycle-scenario remains explicitly mode=plan_only in V1.',
  '  create-lifecycle-scenario prepares the lifecycle scenario plan and readback checklist only.',
  '  create-lifecycle-scenario does not execute lifecycle mutations or imply execution success.',
  '',
  'Example:',
  '  quote-runtime create-lifecycle-scenario --org-alias <alias> --operation-family initiate_amendment --quote-id <id> --asset-id <id>'
].join('\n');

const CREATE_LIFECYCLE_SCENARIO_FLAG_DEFINITIONS = {
  'operation-family': Flags.string({
    required: true,
    helpValue: '<family>',
    summary: 'Lifecycle-only operation family used to assemble the scenario plan and readback checklist.'
  }),
  'asset-id': Flags.string({
    multiple: true,
    helpValue: '<id>',
    summary: 'Optional asset anchors carried into renewal and lifecycle provenance planning.'
  }),
  'quote-id': Flags.string({
    required: false,
    helpValue: '<id>',
    summary: 'Optional source quote id used as the initial before/after capture anchor.'
  }),
  'expected-change': Flags.string({
    required: false,
    helpValue: '<text>',
    summary: 'Optional operator intent note carried into the lifecycle scenario plan.'
  })
};

export type CreateLifecycleScenarioCommandFlags = {
  operationFamily: LifecycleOperationFamily;
  assetIds: string[];
  quoteId: string | null;
  expectedChange: string | null;
};

export type LifecycleReadbackChecklistItem = {
  phase: 'before_execution' | 'after_execution' | 'conditional';
  command: 'snapshot-quote' | 'snapshot-lines' | 'verify-lifecycle-provenance' | 'overlay-relationships';
  purpose: string;
};

export type CreateLifecycleScenarioVerificationPlan = {
  verification_anchor_strategy: string;
  before_capture_plan: PstPlanBeforeCapturePlan;
  after_capture_plan: PstPlanAfterCapturePlan;
  verification_branch_hints: PstPlanVerificationBranchHint[];
  readback_checklist: LifecycleReadbackChecklistItem[];
};

export type CreateLifecycleScenarioResult = {
  mode: 'plan_only';
  operation_family: LifecycleOperationFamily;
  route: string;
  subjects: PstPlanSubjects;
  planned_payload_summary: PstPlanPayloadSummary;
  verification_plan: CreateLifecycleScenarioVerificationPlan;
  recommended_next_commands: string[];
};

export type CreateLifecycleScenarioExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

export type BuildCreateLifecycleScenarioEnvelopeInput = {
  globalFlags: GlobalFlags;
  commandFlags: CreateLifecycleScenarioCommandFlags;
  pstPlan: PstPlanPrimitiveResult;
  generatedAt?: string;
  durationMs?: number;
};

export type CreateLifecycleScenarioCommandDependencies = {
  executePstPlan?: (input: ExecutePstPlanInput) => Promise<PstPlanPrimitiveResult>;
};

export async function parseCreateLifecycleScenarioFlags(argv: string[]): Promise<CreateLifecycleScenarioCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: CREATE_LIFECYCLE_SCENARIO_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      'operation-family': string;
      'asset-id'?: string[];
      'quote-id'?: string;
      'expected-change'?: string;
    };
  };

  return {
    operationFamily: parseLifecycleOperationFamily(parsed.flags['operation-family']),
    assetIds: normalizeRepeatableIds(parsed.flags['asset-id'], 'asset-id'),
    quoteId: normalizeOptionalId(parsed.flags['quote-id'], 'quote-id'),
    expectedChange: normalizeOptionalText(parsed.flags['expected-change'])
  };
}

export function renderCreateLifecycleScenarioHelp(): string {
  return CREATE_LIFECYCLE_SCENARIO_HELP_TEXT;
}

export function buildCreateLifecycleScenarioEnvelope(input: BuildCreateLifecycleScenarioEnvelopeInput): ResultEnvelope {
  if (!input.globalFlags.orgAlias) {
    throw new Error('create-lifecycle-scenario envelope requires a resolved org alias.');
  }

  const result = buildCreateLifecycleScenarioResult(input);

  return makeEnvelope({
    command: 'create-lifecycle-scenario',
    status: input.pstPlan.status,
    summary: {
      primary_subject: buildPrimarySubject(input.commandFlags),
      status_reason: buildCreateLifecycleScenarioStatusReason(input),
      primary_lane: 'plan_only',
      verification_anchor: result.verification_plan.verification_anchor_strategy,
      next_suggested_command: result.recommended_next_commands[0] ?? null,
      key_counts: {
        asset_ids: input.commandFlags.assetIds.length,
        readback_checklist: result.verification_plan.readback_checklist.length,
        recommended_next_commands: result.recommended_next_commands.length
      }
    } satisfies Record<string, JsonValue>,
    result: createLifecycleScenarioResultToJsonRecord(result),
    warnings: [...input.pstPlan.warnings],
    errors: [...input.pstPlan.errors],
    evidence: buildCreateLifecycleScenarioEvidence(input, result),
    meta: {
      org_alias: input.globalFlags.orgAlias,
      generated_at: input.generatedAt ?? new Date().toISOString(),
      duration_ms: input.durationMs ?? 0,
      source_files: []
    }
  });
}

export function renderCreateLifecycleScenarioText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as CreateLifecycleScenarioResult;
  const lines = [
    'quote-runtime create-lifecycle-scenario',
    `status: ${envelope.status}`,
    `org alias: ${envelope.meta.org_alias}`,
    `mode: ${result.mode}`,
    `operation family: ${result.operation_family}`,
    `route: ${result.route}`,
    `subject: ${String(envelope.summary.primary_subject ?? '(unknown)')}`,
    `verification anchor: ${result.verification_plan.verification_anchor_strategy}`,
    `recommended next commands: ${formatStringList(result.recommended_next_commands)}`,
    'readback checklist:'
  ];

  for (const item of result.verification_plan.readback_checklist) {
    lines.push(`- [${item.phase}] ${item.command}: ${item.purpose}`);
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

const CREATE_LIFECYCLE_SCENARIO_SPEC: EnvelopeCommandSpec<CreateLifecycleScenarioCommandDependencies> = {
  commandName: 'create-lifecycle-scenario',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseCreateLifecycleScenarioFlags(argv);
    const runPstPlan = deps.executePstPlan ?? executePstPlan;
    const pstPlan = await runPstPlan({
      operationFamily: commandFlags.operationFamily,
      quoteId: commandFlags.quoteId,
      lineIds: [],
      assetIds: commandFlags.assetIds,
      expectedChange: commandFlags.expectedChange
    });

    return buildCreateLifecycleScenarioEnvelope({
      globalFlags,
      commandFlags,
      pstPlan,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
  },
  renderText: renderCreateLifecycleScenarioText
};

export async function runCreateLifecycleScenarioCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: CreateLifecycleScenarioCommandDependencies = {}
): Promise<CreateLifecycleScenarioExecution> {
  return runEnvelopeCommand(CREATE_LIFECYCLE_SCENARIO_SPEC, argv, globalFlags, io, dependencies);
}

function buildCreateLifecycleScenarioResult(
  input: BuildCreateLifecycleScenarioEnvelopeInput
): CreateLifecycleScenarioResult {
  const pstPlanResult = input.pstPlan.result as PstPlanResult;
  const readbackChecklist = buildLifecycleReadbackChecklist(pstPlanResult);

  return {
    mode: 'plan_only',
    operation_family: input.commandFlags.operationFamily,
    route: pstPlanResult.route,
    subjects: pstPlanResult.subjects,
    planned_payload_summary: pstPlanResult.payload_summary,
    verification_plan: {
      verification_anchor_strategy:
        pstPlanResult.after_capture_plan.expected_anchor_type === 'same_quote'
          ? `Use quote:${pstPlanResult.subjects.quote_id ?? '(same quote)'} as the persisted verification anchor after execution.`
          : 'Use the returned output quote id as the persisted verification anchor after execution.',
      before_capture_plan: pstPlanResult.before_capture_plan,
      after_capture_plan: pstPlanResult.after_capture_plan,
      verification_branch_hints: pstPlanResult.verification_branch_hints.map((hint) => ({ ...hint })),
      readback_checklist: readbackChecklist
    },
    recommended_next_commands: collectRecommendedNextCommands(readbackChecklist)
  };
}

function buildLifecycleReadbackChecklist(pstPlanResult: PstPlanResult): LifecycleReadbackChecklistItem[] {
  const checklist: LifecycleReadbackChecklistItem[] = [];

  if (pstPlanResult.subjects.quote_id) {
    checklist.push({
      phase: 'before_execution',
      command: 'snapshot-quote',
      purpose: 'Capture the source quote snapshot before lifecycle execution so after-state readback has a durable baseline.'
    });
    checklist.push({
      phase: 'before_execution',
      command: 'snapshot-lines',
      purpose: 'Capture the source quote line snapshot before lifecycle execution to preserve the baseline line set.'
    });
  }

  checklist.push({
    phase: 'after_execution',
    command: 'snapshot-quote',
    purpose:
      pstPlanResult.after_capture_plan.expected_anchor_type === 'same_quote'
        ? 'Read back the same quote after execution and confirm persisted lifecycle state on the quote record.'
        : 'Read back the resulting lifecycle quote after execution and treat the returned output quote id as the verification anchor.'
  });
  checklist.push({
    phase: 'after_execution',
    command: 'snapshot-lines',
    purpose: 'Read back the resulting quote lines after execution before moving to overlay-specific interpretation.'
  });
  checklist.push({
    phase: 'conditional',
    command: 'verify-lifecycle-provenance',
    purpose: 'Confirm QuoteAction-backed lifecycle provenance separately when source-asset or amendment lineage matters.'
  });
  checklist.push({
    phase: 'conditional',
    command: 'overlay-relationships',
    purpose: 'Inspect QuoteLineRelationship separately when carry-forward bundle or structure semantics remain unclear.'
  });

  return checklist;
}

function collectRecommendedNextCommands(readbackChecklist: LifecycleReadbackChecklistItem[]): string[] {
  const commands: string[] = [];

  for (const item of readbackChecklist) {
    if (!commands.includes(item.command)) {
      commands.push(item.command);
    }
  }

  return commands;
}

function buildPrimarySubject(commandFlags: CreateLifecycleScenarioCommandFlags): string {
  if (commandFlags.quoteId && commandFlags.assetIds.length > 0) {
    return `${commandFlags.operationFamily} on quote ${commandFlags.quoteId} (${commandFlags.assetIds.length} asset id(s))`;
  }

  if (commandFlags.quoteId) {
    return `${commandFlags.operationFamily} on quote ${commandFlags.quoteId}`;
  }

  if (commandFlags.assetIds.length > 0) {
    return `${commandFlags.operationFamily} (${commandFlags.assetIds.length} asset id(s))`;
  }

  return commandFlags.operationFamily;
}

function buildCreateLifecycleScenarioStatusReason(input: BuildCreateLifecycleScenarioEnvelopeInput): string {
  return input.pstPlan.status === 'ok'
    ? `Plan-only lifecycle scenario guidance assembled for ${input.commandFlags.operationFamily} with an explicit readback checklist.`
    : `Plan-only lifecycle scenario guidance assembled for ${input.commandFlags.operationFamily}, but verification anchors remain broad until execution returns a quote-centric handle.`;
}

function buildCreateLifecycleScenarioEvidence(
  input: BuildCreateLifecycleScenarioEnvelopeInput,
  result: CreateLifecycleScenarioResult
): EvidenceItem[] {
  return [
    ...input.pstPlan.evidence,
    {
      claim: 'create-lifecycle-scenario reuses pst-plan output and adds a readback checklist without introducing execution semantics.',
      evidence_level: 'repo_proven',
      proof_source: [
        'specs/quoting-pricing-runtime/quoting-pricing-runtime-wave4-command-grammar-and-result-schemas.md',
        'specs/quoting-pricing-runtime/quoting-pricing-runtime-node-typescript-wave3-scenarios-build-plan.md'
      ],
      limitations: `The lifecycle scenario result remains ${result.mode}; operators must execute lifecycle mutations outside this command in V1.`,
      source_refs: []
    }
  ];
}

function createLifecycleScenarioResultToJsonRecord(result: CreateLifecycleScenarioResult): Record<string, JsonValue> {
  return {
    mode: result.mode,
    operation_family: result.operation_family,
    route: result.route,
    subjects: result.subjects as unknown as JsonValue,
    planned_payload_summary: result.planned_payload_summary as unknown as JsonValue,
    verification_plan: result.verification_plan as unknown as JsonValue,
    recommended_next_commands: result.recommended_next_commands as unknown as JsonValue
  };
}

function formatStringList(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : '(none)';
}

function parseLifecycleOperationFamily(value: string): LifecycleOperationFamily {
  if ((LIFECYCLE_OPERATION_FAMILIES as readonly string[]).includes(value)) {
    return value as LifecycleOperationFamily;
  }

  throw new Error(
    'The create-lifecycle-scenario command requires a lifecycle --operation-family value: initiate_amendment, initiate_renewal, or asset_add_to_renewal.'
  );
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const CREATE_LIFECYCLE_SCENARIO_COMMAND_SPEC = defineCommand({
  name: 'create-lifecycle-scenario',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Assemble a plan-only lifecycle scenario plus readback checklist without performing execution.',
  ownership: {
        primary_owner: 'quote-runtime-mutations',
        secondary_escalation: ['pricing-runtime-debug'],
        shared_library_dependencies: ['pst_plan', 'selectors', 'evidence']
  },
  selectorPolicy: {
        required_selectors: ['operation_family'],
        recommended_selectors: ['asset_ids', 'quote_id', 'expected_change'],
        status_reason: 'Lifecycle scenario planning requires the intended operation family.'
  },
    quickStart: 'quote-runtime create-lifecycle-scenario --org-alias <alias> --operation-family initiate_amendment --quote-id <id> --asset-id <id>',
  renderHelp: renderCreateLifecycleScenarioHelp,
  run: runCreateLifecycleScenarioCommand
});
