import { describe, expect, it, vi } from 'vitest';

import {
  parsePlanOrderActivationFlags,
  renderPlanOrderActivationHelp,
  runPlanOrderActivationCommand
} from '../../src/commands/plan-order-activation';
import type { PlanOrderActivationPrimitiveResult } from '../../src/primitives/order-activation';

function makeGlobalFlags(overrides: Record<string, unknown> = {}) {
  return {
    help: false,
    json: true,
    orgAlias: 'ARMAF',
    failOn: undefined,
    output: undefined,
    verbose: false,
    ...overrides
  };
}

function makeIo() {
  const writes: string[] = [];
  return {
    io: {
      stdout: { write: (message: string) => void writes.push(message) },
      stderr: { write: () => undefined }
    },
    writes
  };
}

function planPrimitive(overrides: {
  status?: PlanOrderActivationPrimitiveResult['status'];
  orderStatusOk?: boolean;
  orderStatus?: string | null;
  errors?: string[];
  warnings?: string[];
} = {}): PlanOrderActivationPrimitiveResult {
  const orderStatusOk = overrides.orderStatusOk ?? true;
  return {
    status: overrides.status ?? 'ok',
    result: {
      mode: 'plan_only',
      operation_family: 'order_activation',
      subjects: { order_id: '801xx', order_item_count: 2 },
      plan: {
        order_id: '801xx',
        order_item_count: 2,
        planned_action: 'createOrUpdateAssetFromOrder',
        side_effect_scope: ['Asset', 'AssetAction', 'AssetStatePeriod', 'AssetActionSource'],
        precondition_checks: {
          order_status: overrides.orderStatus ?? (orderStatusOk ? 'Activated' : 'Draft'),
          order_status_ok: orderStatusOk,
          already_assetized: false,
          billing_block: false,
          app_usage_assignment_ok: true
        },
        before_capture_plan: { order_fields: ['Id', 'Status'], order_item_fields: ['Id'] },
        after_capture_plan: { asset_fields: ['Id', 'Status'] },
        verification_branch_hints: ['inspect-asset-lifecycle --asset-id <created>']
      }
    },
    warnings: overrides.warnings ?? [],
    errors: overrides.errors ?? [],
    evidence: []
  };
}

describe('plan-order-activation command', () => {
  it('parses order-id, order-item-ids, and staged flags', async () => {
    await expect(parsePlanOrderActivationFlags([
      '--order-id', '801xx',
      '--order-item-ids', '802aa',
      '--order-item-ids', '802bb',
      '--staged'
    ])).resolves.toEqual({
      orderId: '801xx',
      orderItemIds: ['802aa', '802bb'],
      staged: true
    });
  });

  it('documents the plan-only contract', () => {
    expect(renderPlanOrderActivationHelp()).toContain('plan-order-activation --org-alias <alias> --order-id <id>');
    expect(renderPlanOrderActivationHelp()).toContain('Does not mutate any records.');
  });

  it('emits an ok plan_only envelope for an activatable order', async () => {
    const { io, writes } = makeIo();
    const result = await runPlanOrderActivationCommand(
      ['--order-id', '801xx'],
      makeGlobalFlags(),
      io,
      { executePlanOrderActivation: vi.fn(async () => planPrimitive()) }
    );

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(writes.join(''));
    expect(envelope.command).toBe('plan-order-activation');
    expect(envelope.status).toBe('ok');
    expect(envelope.result.mode).toBe('plan_only');
    expect(envelope.result.plan.precondition_checks.order_status_ok).toBe(true);
    expect(envelope.summary.next_suggested_command).toBe('activate-order');
  });

  it('emits an error envelope when the order is not activated', async () => {
    const { io, writes } = makeIo();
    const result = await runPlanOrderActivationCommand(
      ['--order-id', '801xx'],
      makeGlobalFlags(),
      io,
      {
        executePlanOrderActivation: vi.fn(async () =>
          planPrimitive({
            status: 'error',
            orderStatusOk: false,
            errors: ["Order 801xx has status 'Draft'. Order must be Activated before assetization."]
          })
        )
      }
    );

    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(writes.join(''));
    expect(envelope.status).toBe('error');
    expect(envelope.errors[0]).toContain("status 'Draft'");
    expect(envelope.summary.next_suggested_command).toBe('inspect-asset-lifecycle');
  });

  it('emits an error envelope when the order is already assetized', async () => {
    const { io, writes } = makeIo();
    const primitive = planPrimitive({
      status: 'error',
      errors: ['Order 801xx is already assetized. Re-running activation has no effect.']
    });
    primitive.result.plan.precondition_checks.already_assetized = true;

    const result = await runPlanOrderActivationCommand(
      ['--order-id', '801xx'],
      makeGlobalFlags(),
      io,
      { executePlanOrderActivation: vi.fn(async () => primitive) }
    );

    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(writes.join(''));
    expect(envelope.status).toBe('error');
    expect(envelope.result.plan.precondition_checks.already_assetized).toBe(true);
    expect(envelope.errors[0]).toContain('already assetized');
  });

  it('throws when org-alias is missing', async () => {
    const { io } = makeIo();
    await expect(
      runPlanOrderActivationCommand(['--order-id', '801xx'], makeGlobalFlags({ orgAlias: undefined }), io, {})
    ).rejects.toThrow('requires --org-alias');
  });
});
