import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type ResultEnvelope } from '../contracts/result-envelope';
import {
  executePlanOrderActivation,
  type ExecutePlanOrderActivationInput,
  type PlanOrderActivationPrimitiveResult
} from '../primitives/order-activation';

export const PLAN_ORDER_ACTIVATION_HELP_TEXT = [
  'quote-runtime plan-order-activation',
  '',
  'Usage:',
  '  quote-runtime plan-order-activation --org-alias <alias> --order-id <id> [--order-item-ids <id>] [--staged] [--json] [--fail-on <status>] [--output <path>] [--verbose]',
  '',
  'Notes:',
  '  Produces a dry-run plan for createOrUpdateAssetFromOrder without executing.',
  '  Checks order activation status and enumerates order items in scope.',
  '  Does not mutate any records. Use activate-order --execute to run the assetization.'
].join('\n');

const FLAGS = {
  'order-id': Flags.string({ required: true }),
  'order-item-ids': Flags.string({ required: false, multiple: true }),
  staged: Flags.boolean({ allowNo: false })
};

export type PlanOrderActivationCommandFlags = {
  orderId: string;
  orderItemIds: string[];
  staged: boolean;
};

export type PlanOrderActivationCommandDependencies = {
  executePlanOrderActivation?: (input: ExecutePlanOrderActivationInput) => Promise<PlanOrderActivationPrimitiveResult>;
};

export function renderPlanOrderActivationHelp(): string {
  return PLAN_ORDER_ACTIVATION_HELP_TEXT;
}

export async function parsePlanOrderActivationFlags(argv: string[]): Promise<PlanOrderActivationCommandFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: FLAGS,
    strict: true
  })) as {
    flags: {
      'order-id': string;
      'order-item-ids'?: string[];
      staged?: boolean;
    };
  };

  return {
    orderId: parsed.flags['order-id'],
    orderItemIds: parsed.flags['order-item-ids'] ?? [],
    staged: parsed.flags.staged === true
  };
}

const PLAN_ORDER_ACTIVATION_SPEC: EnvelopeCommandSpec<PlanOrderActivationCommandDependencies> = {
  commandName: 'plan-order-activation',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parsePlanOrderActivationFlags(argv);
    const primitive = await (deps.executePlanOrderActivation ?? executePlanOrderActivation)({
      orgAlias: globalFlags.orgAlias!,
      orderId: commandFlags.orderId,
      orderItemIds: commandFlags.orderItemIds,
      staged: commandFlags.staged
    });

    const preconditionOk = primitive.result.plan.precondition_checks.order_status_ok;

    return makeEnvelope({
      command: 'plan-order-activation',
      status: primitive.status,
      summary: {
        primary_subject: commandFlags.orderId,
        status_reason: `Order ${commandFlags.orderId} activation plan; order_status_ok=${String(preconditionOk)}; ${primitive.result.subjects.order_item_count} item(s).`,
        primary_lane: 'order_activation_planning',
        next_suggested_command: preconditionOk ? 'activate-order' : 'inspect-asset-lifecycle'
      },
      result: toJsonRecord(primitive.result),
      warnings: primitive.warnings,
      errors: primitive.errors,
      evidence: primitive.evidence,
      meta: {
        org_alias: globalFlags.orgAlias!,
        generated_at: new Date().toISOString(),
        duration_ms: Math.max(0, Date.now() - startedAt),
        source_files: []
      }
    });
  },
  renderText: renderPlanOrderActivationText
};

export async function runPlanOrderActivationCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: PlanOrderActivationCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(PLAN_ORDER_ACTIVATION_SPEC, argv, globalFlags, io, dependencies);
}

export function renderPlanOrderActivationText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as {
    plan: {
      order_id: string;
      order_item_count: number;
      planned_action: string;
      precondition_checks: { order_status: string | null; order_status_ok: boolean };
      verification_branch_hints: string[];
    };
  };

  const lines = [
    'quote-runtime plan-order-activation',
    `status: ${envelope.status}`,
    `order id: ${result.plan?.order_id ?? '(unknown)'}`,
    `order item count: ${String(result.plan?.order_item_count ?? 0)}`,
    `planned action: ${result.plan?.planned_action ?? '(unknown)'}`,
    `order status: ${String(result.plan?.precondition_checks?.order_status)} (ok=${String(result.plan?.precondition_checks?.order_status_ok)})`,
    `next: ${String(envelope.summary.next_suggested_command ?? '')}`
  ];

  if (envelope.errors.length > 0) {
    lines.push('errors:');
    lines.push(...envelope.errors.map((error) => `- ${error}`));
  }

  lines.push('');
  return lines.join('\n');
}

function toJsonRecord(value: unknown): Record<string, import('../contracts/result-envelope').JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, import('../contracts/result-envelope').JsonValue>;
}

// ---------------------------------------------------------------------------
// CommandSpec (Q3: defineCommand consolidation)
// ---------------------------------------------------------------------------
import { defineCommand, WAVE_GROUP_NAMES } from './spec';

export const PLAN_ORDER_ACTIVATION_COMMAND_SPEC = defineCommand({
  name: 'plan-order-activation',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Produce a dry-run plan for createOrUpdateAssetFromOrder without executing assetization.',
  ownership: {
        primary_owner: 'quote-runtime-mutations',
        secondary_escalation: ['runtime-context-inspection'],
        shared_library_dependencies: ['selectors', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: [],
        status_reason: 'Order activation planning requires --order-id at command parse time.'
  },
    quickStart: 'quote-runtime plan-order-activation --org-alias <alias> --order-id <id>',
  renderHelp: renderPlanOrderActivationHelp,
  run: runPlanOrderActivationCommand
});
