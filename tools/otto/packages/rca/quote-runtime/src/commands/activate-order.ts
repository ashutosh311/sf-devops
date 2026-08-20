import { Flags, Parser } from '@oclif/core';

import type { GlobalFlags } from '../cli/global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from '../cli/output';
import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../cli/run-envelope-command';
import { exitCodeForStatus, makeEnvelope, type ResultEnvelope } from '../contracts/result-envelope';
import type { InvokeSfJsonOptions, SfCliJsonResult } from '../integrations/salesforce/sf-cli';
import type { InvokeSfRestWriteOptions, SfRestWriteResult } from '../integrations/salesforce/rest';
import {
  executeActivateOrder,
  type ExecuteActivateOrderInput,
  type ActivateOrderPrimitiveResult
} from '../primitives/order-activation';

export const ACTIVATE_ORDER_HELP_TEXT = [
  'quote-runtime activate-order',
  '',
  'Usage:',
  '  quote-runtime activate-order --org-alias <alias> --order-id <id> [--staged] [--order-item-ids <id>] [--execute] [--json] [--fail-on <status>] [--output <path>] [--verbose]',
  '',
  'Notes:',
  '  Without --execute, outputs the same plan as plan-order-activation (dry-run, no writes).',
  '  With --execute, POSTs createOrUpdateAssetFromOrder (or createOrUpdateAssetFromOrderItem when --staged).',
  '  Action-level errors from the invocable action are surfaced verbatim in the envelope gaps.',
  '  A requestIdentifier without asset IDs indicates async activation in progress.',
  '  After a successful --execute, post-activation evidence (Asset, AssetAction, AssetStatePeriod) is captured automatically.',
  '  This is a point of no return: once assetized, use amend/renew/cancel for further changes.'
].join('\n');

const FLAGS = {
  'order-id': Flags.string({ required: true }),
  'order-item-ids': Flags.string({ required: false, multiple: true }),
  staged: Flags.boolean({ allowNo: false }),
  execute: Flags.boolean({ allowNo: false })
};

export type ActivateOrderCommandFlags = {
  orderId: string;
  orderItemIds: string[];
  staged: boolean;
  execute: boolean;
};

export type ActivateOrderCommandDependencies = {
  executeActivateOrder?: (input: ExecuteActivateOrderInput) => Promise<ActivateOrderPrimitiveResult>;
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
  invokeSfRestWrite?: <T>(options: InvokeSfRestWriteOptions) => Promise<SfRestWriteResult<T>>;
};

export function renderActivateOrderHelp(): string {
  return ACTIVATE_ORDER_HELP_TEXT;
}

export async function parseActivateOrderFlags(argv: string[]): Promise<ActivateOrderCommandFlags> {
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
      execute?: boolean;
    };
  };

  return {
    orderId: parsed.flags['order-id'],
    orderItemIds: parsed.flags['order-item-ids'] ?? [],
    staged: parsed.flags.staged === true,
    execute: parsed.flags.execute === true
  };
}

const ACTIVATE_ORDER_SPEC: EnvelopeCommandSpec<ActivateOrderCommandDependencies> = {
  commandName: 'activate-order',
  execute: async ({ argv, globalFlags, startedAt, deps }) => {
    const commandFlags = await parseActivateOrderFlags(argv);
    const primitive = await (deps.executeActivateOrder ?? executeActivateOrder)({
      orgAlias: globalFlags.orgAlias!,
      orderId: commandFlags.orderId,
      orderItemIds: commandFlags.orderItemIds,
      staged: commandFlags.staged,
      execute: commandFlags.execute,
      ...(deps.invokeSfJson === undefined ? {} : { invokeSfJson: deps.invokeSfJson }),
      ...(deps.invokeSfRestWrite === undefined ? {} : { invokeSfRestWrite: deps.invokeSfRestWrite })
    });
    const mode = primitive.result.mode;
    const isSuccess = primitive.result.mutation?.is_success ?? false;
    const asyncTrackingId = primitive.result.mutation?.async_tracking_id;
    const evidenceCaptured = (primitive.result.post_activation_evidence?.assets.length ?? 0) > 0;
    return makeEnvelope({
      command: 'activate-order',
      status: primitive.status,
      summary: {
        primary_subject: commandFlags.orderId,
        status_reason: mode === 'execute'
          ? `Order activation executed; is_success=${String(isSuccess)}${asyncTrackingId ? `; async_tracking_id=${String(asyncTrackingId)}` : ''}.`
          : `Order activation plan only (dry-run). Use --execute to assetize.`,
        primary_lane: 'order_activation_execution',
        next_suggested_command: mode === 'execute' && isSuccess
          ? (evidenceCaptured ? 'inspect-asset-lifecycle' : 'capture-post-activation-evidence')
          : 'plan-order-activation'
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
  renderText: renderActivateOrderText
};

export async function runActivateOrderCommand(
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  dependencies: ActivateOrderCommandDependencies = {}
): Promise<{ envelope: ResultEnvelope; text: string; exitCode: 0 | 1 }> {
  return runEnvelopeCommand(ACTIVATE_ORDER_SPEC, argv, globalFlags, io, dependencies);
}

export function renderActivateOrderText(envelope: ResultEnvelope): string {
  const result = envelope.result as unknown as {
    mode: string;
    mutation: { is_success: boolean; async_tracking_id: string | null; gaps: string[] } | null;
    plan: { order_id: string; precondition_checks: { order_status: string | null; order_status_ok: boolean } };
    post_activation_evidence: { assets: Array<{ id: string }> } | null;
  };

  const lines = [
    'quote-runtime activate-order',
    `status: ${envelope.status}`,
    `mode: ${result.mode ?? 'plan_only'}`,
    `order id: ${result.plan?.order_id ?? '(unknown)'}`,
    `order status ok: ${String(result.plan?.precondition_checks?.order_status_ok)}`
  ];

  if (result.mutation) {
    lines.push(`execute is_success: ${String(result.mutation.is_success)}`);
    if (result.mutation.async_tracking_id) {
      lines.push(`async tracking id: ${result.mutation.async_tracking_id}`);
    }
    if (result.mutation.gaps.length > 0) {
      lines.push('gaps:');
      lines.push(...result.mutation.gaps.map((gap) => `- ${gap}`));
    }
    if (result.post_activation_evidence) {
      lines.push(`evidence captured: ${String(result.post_activation_evidence.assets?.length ?? 0)} asset(s)`);
    }
  } else {
    lines.push('(dry-run — no writes performed; add --execute to assetize)');
  }

  lines.push(`next: ${String(envelope.summary.next_suggested_command ?? '')}`);

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

export const ACTIVATE_ORDER_COMMAND_SPEC = defineCommand({
  name: 'activate-order',
  wave: 3,
  group_name: WAVE_GROUP_NAMES[3],
  summary: 'Execute order assetization via createOrUpdateAssetFromOrder with --execute gate and auto-evidence capture.',
  ownership: {
        primary_owner: 'quote-runtime-mutations',
        secondary_escalation: ['runtime-context-inspection'],
        shared_library_dependencies: ['rest', 'selectors', 'evidence']
  },
  selectorPolicy: {
        required_selectors: [],
        recommended_selectors: [],
        status_reason: 'Order activation requires --order-id and --execute at command parse time.'
  },
    quickStart: 'quote-runtime activate-order --org-alias <alias> --order-id <id> --execute',
  renderHelp: renderActivateOrderHelp,
  run: runActivateOrderCommand
});
