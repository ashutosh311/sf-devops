import { describe, expect, it, vi } from 'vitest';

import { executeActivateOrder, executePlanOrderActivation } from '../../src/primitives/order-activation';
import type {
  CapturePostActivationEvidencePrimitiveResult,
  ExecuteCapturePostActivationEvidenceInput,
  PostActivationEvidencePacket
} from '../../src/primitives/capture-post-activation-evidence';
import type { InvokeSfJsonOptions, SfCliJsonResult } from '../../src/integrations/salesforce/sf-cli';
import type { InvokeSfRestWriteOptions, SfRestWriteResult } from '../../src/integrations/salesforce/rest';

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

function makeEvidencePacket(overrides: Partial<PostActivationEvidencePacket> = {}): PostActivationEvidencePacket {
  return {
    order_id: '801xx',
    asset_ids_queried: ['a0001'],
    assets: [{
      id: 'a0001',
      name: 'Captured Asset',
      status: 'Installed',
      product_id: 'p0001',
      account_id: 'acc001',
      lifecycle_start_date: null,
      lifecycle_end_date: null
    }],
    asset_actions: [],
    asset_state_periods: [],
    evidence_status: 'ok',
    gaps: [],
    ...overrides
  };
}

function makeCaptureFake(result?: Partial<CapturePostActivationEvidencePrimitiveResult>) {
  const calls: ExecuteCapturePostActivationEvidenceInput[] = [];
  const packet = makeEvidencePacket();

  const fn = async (input: ExecuteCapturePostActivationEvidenceInput): Promise<CapturePostActivationEvidencePrimitiveResult> => {
    calls.push(input);
    return {
      status: 'ok',
      result: { packet },
      warnings: [],
      errors: [],
      evidence: [],
      ...result
    };
  };

  return { fn, calls, packet };
}

const ACTIVATED_ORDER = { records: [{ Id: '801xx', Status: 'Activated' }] };
const RLM_APP_USAGE = { records: [{ Id: '7Uba5000000001', AppUsageType: 'RevenueLifecycleManagement' }] };
const DRAFT_ORDER = { records: [{ Id: '801xx', Status: 'Draft' }] };
const ORDER_ITEMS = { records: [{ Id: '802aa', OrderId: '801xx', Status: 'Activated', Product2Id: 'p0001' }, { Id: '802bb', OrderId: '801xx', Status: 'Activated', Product2Id: 'p0002' }] };
const NO_ASSET_ACTION_SOURCES = { records: [] };
const EXISTING_ASSET_ACTION_SOURCES = {
  records: [
    { Id: 'aas001', AssetActionId: 'aa001', ReferenceEntityItemId: '802aa' },
    { Id: 'aas002', AssetActionId: 'aa002', ReferenceEntityItemId: '802bb' }
  ]
};

describe('executePlanOrderActivation', () => {
  it('emits an ok plan_only envelope for an activatable order', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: ACTIVATED_ORDER },
      { ok: true, data: ORDER_ITEMS },
      { ok: true, data: NO_ASSET_ACTION_SOURCES },
      { ok: true, data: RLM_APP_USAGE }
    ]);

    const result = await executePlanOrderActivation({ orgAlias: 'ARMAF', orderId: '801xx', invokeSfJson: fn });

    expect(result.status).toBe('ok');
    expect(result.result.mode).toBe('plan_only');
    expect(result.result.operation_family).toBe('order_activation');
    expect(result.result.subjects.order_item_count).toBe(2);
    expect(result.result.plan.planned_action).toBe('createOrUpdateAssetFromOrder');
    expect(result.result.plan.precondition_checks.order_status_ok).toBe(true);
    expect(result.result.plan.precondition_checks.already_assetized).toBe(false);
    expect(result.result.plan.side_effect_scope).toEqual(['Asset', 'AssetAction', 'AssetStatePeriod', 'AssetActionSource']);
    expect(result.result.plan.verification_branch_hints[0]).toContain('inspect-asset-lifecycle');
  });

  it('errors when the order is not activated', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: DRAFT_ORDER },
      { ok: true, data: ORDER_ITEMS },
      { ok: true, data: NO_ASSET_ACTION_SOURCES },
      { ok: true, data: RLM_APP_USAGE }
    ]);

    const result = await executePlanOrderActivation({ orgAlias: 'ARMAF', orderId: '801xx', invokeSfJson: fn });

    expect(result.status).toBe('error');
    expect(result.errors[0]).toContain("status 'Draft'");
    expect(result.result.plan.precondition_checks.order_status_ok).toBe(false);
  });

  it('returns no_match when the order is not found', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: { records: [] } }
    ]);

    const result = await executePlanOrderActivation({ orgAlias: 'ARMAF', orderId: '801zz', invokeSfJson: fn });

    expect(result.status).toBe('no_match');
    expect(result.warnings[0]).toContain('801zz');
  });

  it('selects the item-level action for staged assetization', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: ACTIVATED_ORDER },
      { ok: true, data: { records: [{ Id: '802aa', OrderId: '801xx' }] } },
      { ok: true, data: NO_ASSET_ACTION_SOURCES },
      { ok: true, data: RLM_APP_USAGE }
    ]);

    const result = await executePlanOrderActivation({
      orgAlias: 'ARMAF',
      orderId: '801xx',
      orderItemIds: ['802aa'],
      staged: true,
      invokeSfJson: fn
    });

    expect(result.result.plan.planned_action).toBe('createOrUpdateAssetFromOrderItem');
    expect(result.result.subjects.order_item_count).toBe(1);
  });

  it('flags an already-assetized order as a blocking precondition error', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: ACTIVATED_ORDER },
      { ok: true, data: ORDER_ITEMS },
      { ok: true, data: EXISTING_ASSET_ACTION_SOURCES },
      { ok: true, data: RLM_APP_USAGE }
    ]);

    const result = await executePlanOrderActivation({ orgAlias: 'ARMAF', orderId: '801xx', invokeSfJson: fn });

    expect(result.status).toBe('error');
    expect(result.result.plan.precondition_checks.already_assetized).toBe(true);
    expect(result.errors.some((error) =>
      error.includes('Order 801xx appears already assetized: 2 AssetActionSource row(s) reference its order items.')
    )).toBe(true);
    expect(result.errors.some((error) =>
      error.includes('run inspect-asset-lifecycle or capture-post-activation-evidence --order-id 801xx instead')
    )).toBe(true);
  });

  it('warns and keeps already_assetized false when the AssetActionSource query fails', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: ACTIVATED_ORDER },
      { ok: true, data: ORDER_ITEMS },
      { ok: false, message: 'INVALID_TYPE: sObject type AssetActionSource is not supported.' },
      { ok: true, data: RLM_APP_USAGE }
    ]);

    const result = await executePlanOrderActivation({ orgAlias: 'ARMAF', orderId: '801xx', invokeSfJson: fn });

    expect(result.status).toBe('warn');
    expect(result.result.plan.precondition_checks.already_assetized).toBe(false);
    expect(result.warnings.some((warning) => warning.includes('AssetActionSource precondition query failed'))).toBe(true);
  });
});

describe('executeActivateOrder', () => {
  it('performs NO REST write and NO evidence capture in dry-run (no --execute)', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: ACTIVATED_ORDER },
      { ok: true, data: ORDER_ITEMS },
      { ok: true, data: NO_ASSET_ACTION_SOURCES },
      { ok: true, data: RLM_APP_USAGE }
    ]);
    const restWriter = makeRestWriter({ ok: true, data: [{ isSuccess: true }] });
    const capture = makeCaptureFake();

    const result = await executeActivateOrder({
      orgAlias: 'ARMAF',
      orderId: '801xx',
      execute: false,
      invokeSfJson: fn,
      invokeSfRestWrite: restWriter.fn,
      executeCapturePostActivationEvidence: capture.fn
    });

    expect(restWriter.calls).toHaveLength(0);
    expect(capture.calls).toHaveLength(0);
    expect(result.result.mode).toBe('plan_only');
    expect(result.result.mutation).toBeNull();
    expect(result.result.post_activation_evidence).toBeNull();
    expect(result.status).toBe('ok');
  });

  it('POSTs createOrUpdateAssetFromOrder and auto-captures evidence on success with --execute', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: ACTIVATED_ORDER },
      { ok: true, data: ORDER_ITEMS },
      { ok: true, data: NO_ASSET_ACTION_SOURCES },
      { ok: true, data: RLM_APP_USAGE }
    ]);
    const restWriter = makeRestWriter({
      ok: true,
      data: [{ actionName: 'createOrUpdateAssetFromOrder', isSuccess: true, errors: [], outputValues: {} }]
    });
    const capture = makeCaptureFake();

    const result = await executeActivateOrder({
      orgAlias: 'ARMAF',
      orderId: '801xx',
      execute: true,
      invokeSfJson: fn,
      invokeSfRestWrite: restWriter.fn,
      executeCapturePostActivationEvidence: capture.fn
    });

    expect(restWriter.calls).toHaveLength(1);
    expect(restWriter.calls[0]?.path).toBe('/services/data/v67.0/actions/standard/createOrUpdateAssetFromOrder');
    expect(restWriter.calls[0]?.method).toBe('POST');
    expect(restWriter.calls[0]?.body).toEqual({ inputs: [{ orderId: '801xx' }] });
    expect(result.status).toBe('ok');
    expect(result.result.mode).toBe('execute');
    expect(result.result.mutation?.is_success).toBe(true);
    expect(result.result.mutation?.gaps).toEqual([]);
    expect(capture.calls).toHaveLength(1);
    expect(capture.calls[0]?.orderId).toBe('801xx');
    expect(capture.calls[0]?.orgAlias).toBe('ARMAF');
    expect(result.result.post_activation_evidence).toEqual(capture.packet);
  });

  it('keeps a successful activation at warn (not error) when evidence capture fails', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: ACTIVATED_ORDER },
      { ok: true, data: ORDER_ITEMS },
      { ok: true, data: NO_ASSET_ACTION_SOURCES },
      { ok: true, data: RLM_APP_USAGE }
    ]);
    const restWriter = makeRestWriter({
      ok: true,
      data: [{ actionName: 'createOrUpdateAssetFromOrder', isSuccess: true, errors: [], outputValues: {} }]
    });
    const capture = makeCaptureFake({
      status: 'error',
      errors: ['Asset query failed: INVALID_SESSION_ID.']
    });

    const result = await executeActivateOrder({
      orgAlias: 'ARMAF',
      orderId: '801xx',
      execute: true,
      invokeSfJson: fn,
      invokeSfRestWrite: restWriter.fn,
      executeCapturePostActivationEvidence: capture.fn
    });

    expect(capture.calls).toHaveLength(1);
    expect(result.status).toBe('warn');
    expect(result.errors).toEqual([]);
    expect(result.result.mutation?.is_success).toBe(true);
    expect(result.result.post_activation_evidence).toBeNull();
    expect(result.warnings.some((warning) =>
      warning.includes('evidence capture failed') &&
      warning.includes('capture-post-activation-evidence --order-id 801xx')
    )).toBe(true);
  });

  it('surfaces action-level isSuccess:false errors verbatim in gaps', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: ACTIVATED_ORDER },
      { ok: true, data: ORDER_ITEMS },
      { ok: true, data: NO_ASSET_ACTION_SOURCES },
      { ok: true, data: RLM_APP_USAGE }
    ]);
    const restWriter = makeRestWriter({
      ok: true,
      data: [{
        actionName: 'createOrUpdateAssetFromOrder',
        isSuccess: false,
        errors: [{ statusCode: 'INVALID_INPUT', message: 'Order is already assetized.' }],
        outputValues: {}
      }]
    });
    const capture = makeCaptureFake();

    const result = await executeActivateOrder({
      orgAlias: 'ARMAF',
      orderId: '801xx',
      execute: true,
      invokeSfJson: fn,
      invokeSfRestWrite: restWriter.fn,
      executeCapturePostActivationEvidence: capture.fn
    });

    expect(result.status).toBe('error');
    expect(result.result.mutation?.is_success).toBe(false);
    expect(result.result.mutation?.gaps).toContain('INVALID_INPUT: Order is already assetized.');
    expect(result.errors).toContain('INVALID_INPUT: Order is already assetized.');
    expect(capture.calls).toHaveLength(0);
    expect(result.result.post_activation_evidence).toBeNull();
  });

  it('surfaces isSuccess:false with empty errors and a requestIdentifier as async-in-progress (warn, not error)', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: ACTIVATED_ORDER },
      { ok: true, data: ORDER_ITEMS },
      { ok: true, data: NO_ASSET_ACTION_SOURCES },
      { ok: true, data: RLM_APP_USAGE }
    ]);
    const restWriter = makeRestWriter({
      ok: true,
      data: [{
        actionName: 'createOrUpdateAssetFromOrder',
        isSuccess: false,
        errors: [],
        outputValues: { requestIdentifier: 'req-12345' }
      }]
    });
    const capture = makeCaptureFake();

    const result = await executeActivateOrder({
      orgAlias: 'ARMAF',
      orderId: '801xx',
      execute: true,
      invokeSfJson: fn,
      invokeSfRestWrite: restWriter.fn,
      executeCapturePostActivationEvidence: capture.fn
    });

    expect(result.status).toBe('warn');
    expect(result.errors).toEqual([]);
    expect(result.result.mutation?.async_tracking_id).toBe('req-12345');
    expect(result.result.mutation?.gaps.some((gap) => gap.includes('req-12345'))).toBe(true);
    expect(result.result.mutation?.gaps.some((gap) => gap.includes('Async activation in progress'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('Async activation in progress'))).toBe(true);
  });

  it('surfaces isSuccess:true with a requestIdentifier as async-in-progress (warn, not error)', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: ACTIVATED_ORDER },
      { ok: true, data: ORDER_ITEMS },
      { ok: true, data: NO_ASSET_ACTION_SOURCES },
      { ok: true, data: RLM_APP_USAGE }
    ]);
    const restWriter = makeRestWriter({
      ok: true,
      data: [{
        actionName: 'createOrUpdateAssetFromOrder',
        isSuccess: true,
        errors: [],
        outputValues: { requestIdentifier: 'req-67890' }
      }]
    });
    const capture = makeCaptureFake();

    const result = await executeActivateOrder({
      orgAlias: 'ARMAF',
      orderId: '801xx',
      execute: true,
      invokeSfJson: fn,
      invokeSfRestWrite: restWriter.fn,
      executeCapturePostActivationEvidence: capture.fn
    });

    expect(result.status).toBe('warn');
    expect(result.errors).toEqual([]);
    expect(result.result.mutation?.async_tracking_id).toBe('req-67890');
    expect(result.result.mutation?.gaps.some((gap) => gap.includes('req-67890'))).toBe(true);
    expect(result.result.mutation?.gaps.some((gap) => gap.includes('Async activation in progress'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('Async activation in progress'))).toBe(true);
  });

  it('does not POST when the plan fails preconditions even with --execute', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: DRAFT_ORDER },
      { ok: true, data: ORDER_ITEMS },
      { ok: true, data: NO_ASSET_ACTION_SOURCES },
      { ok: true, data: RLM_APP_USAGE }
    ]);
    const restWriter = makeRestWriter({ ok: true, data: [{ isSuccess: true }] });

    const result = await executeActivateOrder({
      orgAlias: 'ARMAF',
      orderId: '801xx',
      execute: true,
      invokeSfJson: fn,
      invokeSfRestWrite: restWriter.fn
    });

    expect(restWriter.calls).toHaveLength(0);
    expect(result.status).toBe('error');
    expect(result.result.mutation).toBeNull();
  });

  it('blocks --execute with NO REST write when the order is already assetized', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: ACTIVATED_ORDER },
      { ok: true, data: ORDER_ITEMS },
      { ok: true, data: EXISTING_ASSET_ACTION_SOURCES },
      { ok: true, data: RLM_APP_USAGE }
    ]);
    const restWriter = makeRestWriter({ ok: true, data: [{ isSuccess: true }] });
    const capture = makeCaptureFake();

    const result = await executeActivateOrder({
      orgAlias: 'ARMAF',
      orderId: '801xx',
      execute: true,
      invokeSfJson: fn,
      invokeSfRestWrite: restWriter.fn,
      executeCapturePostActivationEvidence: capture.fn
    });

    expect(restWriter.calls).toHaveLength(0);
    expect(capture.calls).toHaveLength(0);
    expect(result.status).toBe('error');
    expect(result.result.mutation).toBeNull();
    expect(result.result.plan.plan.precondition_checks.already_assetized).toBe(true);
    expect(result.errors.some((error) => error.includes('appears already assetized'))).toBe(true);
  });

  it('uses the item-level action path with --staged and order item ids', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: ACTIVATED_ORDER },
      { ok: true, data: { records: [{ Id: '802aa', OrderId: '801xx' }] } },
      { ok: true, data: NO_ASSET_ACTION_SOURCES },
      { ok: true, data: RLM_APP_USAGE }
    ]);
    const restWriter = makeRestWriter({ ok: true, data: [{ isSuccess: true, errors: [], outputValues: {} }] });
    const capture = makeCaptureFake();

    const result = await executeActivateOrder({
      orgAlias: 'ARMAF',
      orderId: '801xx',
      orderItemIds: ['802aa'],
      staged: true,
      execute: true,
      invokeSfJson: fn,
      invokeSfRestWrite: restWriter.fn,
      executeCapturePostActivationEvidence: capture.fn
    });

    expect(restWriter.calls[0]?.path).toBe('/services/data/v67.0/actions/standard/createOrUpdateAssetFromOrderItem');
    expect(restWriter.calls[0]?.body).toEqual({ inputs: [{ orderItemId: '802aa' }] });
    expect(result.status).toBe('ok');
    expect(capture.calls).toHaveLength(1);
  });

  it('classifies a transport-level REST failure as error', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: ACTIVATED_ORDER },
      { ok: true, data: ORDER_ITEMS },
      { ok: true, data: NO_ASSET_ACTION_SOURCES },
      { ok: true, data: RLM_APP_USAGE }
    ]);
    const restWriter = makeRestWriter({ ok: false, message: 'HTTP 500: internal server error' });
    const capture = makeCaptureFake();

    const result = await executeActivateOrder({
      orgAlias: 'ARMAF',
      orderId: '801xx',
      execute: true,
      invokeSfJson: fn,
      invokeSfRestWrite: restWriter.fn,
      executeCapturePostActivationEvidence: capture.fn
    });

    expect(result.status).toBe('error');
    expect(result.errors.some((error) => error.includes('HTTP 500'))).toBe(true);
    expect(result.result.mutation?.gaps[0]).toContain('HTTP 500');
    expect(capture.calls).toHaveLength(0);
    expect(result.result.post_activation_evidence).toBeNull();
  });
});
