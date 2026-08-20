import { describe, expect, it } from 'vitest';

import {
  parseActivateOrderFlags,
  renderActivateOrderHelp,
  runActivateOrderCommand
} from '../../src/commands/activate-order';
import type { InvokeSfJsonOptions, SfCliJsonResult } from '../../src/integrations/salesforce/sf-cli';
import type { InvokeSfRestWriteOptions, SfRestWriteResult } from '../../src/integrations/salesforce/rest';

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

type StubResponse = { ok: true; data: unknown } | { ok: false; message: string };

function makeInvokeSfJson(sequence: StubResponse[]) {
  let index = 0;
  const calls: InvokeSfJsonOptions[] = [];

  const fn = async <T,>(options: InvokeSfJsonOptions): Promise<SfCliJsonResult<T>> => {
    calls.push(options);
    const next = sequence[index++];
    if (!next) {
      throw new Error('Unexpected invokeSfJson call in test.');
    }
    if (next.ok) {
      return { ok: true, classification: 'ok', cliPath: 'sf', data: next.data as T, exitCode: 0, stdout: '{}', stderr: '' };
    }
    return { ok: false, classification: 'cli_error', cliPath: 'sf', message: next.message, exitCode: 1, stdout: '', stderr: next.message };
  };

  return { fn, calls };
}

function makeRestWriter(response: { ok: true; data: unknown } | { ok: false; message: string }) {
  const calls: InvokeSfRestWriteOptions[] = [];

  const fn = async <T,>(options: InvokeSfRestWriteOptions): Promise<SfRestWriteResult<T>> => {
    calls.push(options);
    if (response.ok) {
      return {
        ok: true,
        classification: 'ok',
        path: options.path,
        method: options.method,
        body: JSON.stringify(options.body),
        cliPath: 'sf',
        data: response.data as T,
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      };
    }
    return {
      ok: false,
      classification: 'cli_error',
      path: options.path,
      method: options.method,
      body: JSON.stringify(options.body),
      cliPath: 'sf',
      message: response.message,
      exitCode: 1,
      stdout: '',
      stderr: response.message
    };
  };

  return { fn, calls };
}

const ACTIVATED_ORDER = { records: [{ Id: '801xx', Status: 'Activated' }] };
const RLM_APP_USAGE = { records: [{ Id: '7Uba5000000001', AppUsageType: 'RevenueLifecycleManagement' }] };
const ORDER_ITEMS = { records: [{ Id: '802aa', OrderId: '801xx' }] };
const NO_ASSET_ACTION_SOURCES = { records: [] };

// Plan-phase queries: Order, OrderItem, AssetActionSource (already-assetized check), AppUsageAssignment.
const PLAN_STUBS: StubResponse[] = [
  { ok: true, data: ACTIVATED_ORDER },
  { ok: true, data: ORDER_ITEMS },
  { ok: true, data: NO_ASSET_ACTION_SOURCES },
  { ok: true, data: RLM_APP_USAGE }
];

// Post-activation capture queries: OrderItem, AssetActionSource, Asset, AssetAction, AssetStatePeriod.
const CAPTURE_STUBS: StubResponse[] = [
  { ok: true, data: ORDER_ITEMS },
  { ok: true, data: { records: [{ Id: 'aas001', AssetActionId: 'aa001', AssetAction: { AssetId: 'a0001' }, ReferenceEntityItemId: '802aa' }] } },
  { ok: true, data: { records: [{ Id: 'a0001', Name: 'Captured Asset', Status: 'Installed' }] } },
  { ok: true, data: { records: [{ Id: 'aa001', AssetId: 'a0001', Type: 'AssetCreation', ActionDate: '2026-07-01' }] } },
  { ok: true, data: { records: [{ Id: 'asp001', AssetId: 'a0001', StartDate: '2026-07-01', Quantity: 1 }] } }
];

describe('activate-order command', () => {
  it('parses execute, staged, order-id, and order-item-ids flags', async () => {
    await expect(parseActivateOrderFlags([
      '--order-id', '801xx',
      '--order-item-ids', '802aa',
      '--staged',
      '--execute'
    ])).resolves.toEqual({
      orderId: '801xx',
      orderItemIds: ['802aa'],
      staged: true,
      execute: true
    });
  });

  it('defaults to dry-run when --execute is not provided', async () => {
    await expect(parseActivateOrderFlags(['--order-id', '801xx'])).resolves.toEqual({
      orderId: '801xx',
      orderItemIds: [],
      staged: false,
      execute: false
    });
  });

  it('documents the point-of-no-return, execute-gated, and auto-capture contract', () => {
    expect(renderActivateOrderHelp()).toContain('activate-order --org-alias <alias> --order-id <id>');
    expect(renderActivateOrderHelp()).toContain('Without --execute, outputs the same plan as plan-order-activation (dry-run, no writes).');
    expect(renderActivateOrderHelp()).toContain('point of no return');
    expect(renderActivateOrderHelp()).toContain('post-activation evidence (Asset, AssetAction, AssetStatePeriod) is captured automatically');
  });

  it('performs no REST write without --execute (asserted via injected runner call log)', async () => {
    const { io, writes } = makeIo();
    const { fn } = makeInvokeSfJson(PLAN_STUBS);
    const restWriter = makeRestWriter({ ok: true, data: [{ isSuccess: true }] });

    const result = await runActivateOrderCommand(
      ['--order-id', '801xx'],
      makeGlobalFlags(),
      io,
      { invokeSfJson: fn, invokeSfRestWrite: restWriter.fn }
    );

    expect(restWriter.calls).toHaveLength(0);
    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(writes.join(''));
    expect(envelope.command).toBe('activate-order');
    expect(envelope.result.mode).toBe('plan_only');
    expect(envelope.result.mutation).toBeNull();
    expect(envelope.result.post_activation_evidence).toBeNull();
    expect(envelope.summary.status_reason).toContain('dry-run');
  });

  it('executes activation, auto-captures evidence, and reports success with --execute', async () => {
    const { io, writes } = makeIo();
    const { fn } = makeInvokeSfJson([...PLAN_STUBS, ...CAPTURE_STUBS]);
    const restWriter = makeRestWriter({
      ok: true,
      data: [{ actionName: 'createOrUpdateAssetFromOrder', isSuccess: true, errors: [], outputValues: {} }]
    });

    const result = await runActivateOrderCommand(
      ['--order-id', '801xx', '--execute'],
      makeGlobalFlags(),
      io,
      { invokeSfJson: fn, invokeSfRestWrite: restWriter.fn }
    );

    expect(restWriter.calls).toHaveLength(1);
    expect(restWriter.calls[0]?.path).toContain('createOrUpdateAssetFromOrder');
    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(writes.join(''));
    expect(envelope.status).toBe('ok');
    expect(envelope.result.mode).toBe('execute');
    expect(envelope.result.mutation.is_success).toBe(true);
    expect(envelope.result.post_activation_evidence.assets).toHaveLength(1);
    expect(envelope.result.post_activation_evidence.assets[0].id).toBe('a0001');
    expect(envelope.summary.next_suggested_command).toBe('inspect-asset-lifecycle');
    expect(result.text).toContain('evidence captured: 1 asset(s)');
  });

  it('surfaces action-level failures verbatim in envelope gaps', async () => {
    const { io, writes } = makeIo();
    const { fn } = makeInvokeSfJson(PLAN_STUBS);
    const restWriter = makeRestWriter({
      ok: true,
      data: [{
        isSuccess: false,
        errors: [{ statusCode: 'FIELD_INTEGRITY_EXCEPTION', message: 'Dynamic Revenue Orchestrator plan missing.' }],
        outputValues: {}
      }]
    });

    const result = await runActivateOrderCommand(
      ['--order-id', '801xx', '--execute'],
      makeGlobalFlags(),
      io,
      { invokeSfJson: fn, invokeSfRestWrite: restWriter.fn }
    );

    expect(result.exitCode).toBe(1);
    const envelope = JSON.parse(writes.join(''));
    expect(envelope.status).toBe('error');
    expect(envelope.result.mutation.is_success).toBe(false);
    expect(envelope.result.mutation.gaps).toContain('FIELD_INTEGRITY_EXCEPTION: Dynamic Revenue Orchestrator plan missing.');
    expect(envelope.errors).toContain('FIELD_INTEGRITY_EXCEPTION: Dynamic Revenue Orchestrator plan missing.');
  });

  it('surfaces isSuccess:false with empty errors and a requestIdentifier as async-in-progress (warn, not error)', async () => {
    const { io, writes } = makeIo();
    const { fn } = makeInvokeSfJson(PLAN_STUBS);
    const restWriter = makeRestWriter({
      ok: true,
      data: [{ isSuccess: false, errors: [], outputValues: { requestIdentifier: 'req-async-77' } }]
    });

    const result = await runActivateOrderCommand(
      ['--order-id', '801xx', '--execute'],
      makeGlobalFlags(),
      io,
      { invokeSfJson: fn, invokeSfRestWrite: restWriter.fn }
    );

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(writes.join(''));
    expect(envelope.status).toBe('warn');
    expect(envelope.errors).toEqual([]);
    expect(envelope.result.mutation.async_tracking_id).toBe('req-async-77');
    expect(envelope.summary.status_reason).toContain('req-async-77');
    expect(
      envelope.result.mutation.gaps.some((gap: string) => gap.includes('Async activation in progress'))
    ).toBe(true);
  });

  it('surfaces isSuccess:true with a requestIdentifier as async-in-progress (warn, not error)', async () => {
    const { io, writes } = makeIo();
    // isSuccess:true triggers auto-capture; the async activation has not produced assets yet.
    const { fn } = makeInvokeSfJson([...PLAN_STUBS, { ok: true, data: { records: [] } }]);
    const restWriter = makeRestWriter({
      ok: true,
      data: [{ isSuccess: true, errors: [], outputValues: { requestIdentifier: 'req-async-88' } }]
    });

    const result = await runActivateOrderCommand(
      ['--order-id', '801xx', '--execute'],
      makeGlobalFlags(),
      io,
      { invokeSfJson: fn, invokeSfRestWrite: restWriter.fn }
    );

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(writes.join(''));
    expect(envelope.status).toBe('warn');
    expect(envelope.errors).toEqual([]);
    expect(envelope.result.mutation.async_tracking_id).toBe('req-async-88');
    expect(envelope.summary.status_reason).toContain('req-async-88');
    expect(
      envelope.result.mutation.gaps.some((gap: string) => gap.includes('Async activation in progress'))
    ).toBe(true);
    expect(envelope.summary.next_suggested_command).toBe('capture-post-activation-evidence');
  });

  it('throws when org-alias is missing', async () => {
    const { io } = makeIo();
    await expect(
      runActivateOrderCommand(['--order-id', '801xx'], makeGlobalFlags({ orgAlias: undefined }), io, {})
    ).rejects.toThrow('requires --org-alias');
  });
});
