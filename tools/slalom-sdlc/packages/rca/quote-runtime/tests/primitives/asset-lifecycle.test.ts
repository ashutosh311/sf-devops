import { describe, expect, it, vi } from 'vitest';

import { executeInspectAssetLifecycle } from '../../src/primitives/asset-lifecycle';
import type { InvokeSfJsonOptions, SfCliJsonResult } from '../../src/integrations/salesforce/sf-cli';

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
      return {
        ok: true,
        classification: 'ok',
        cliPath: 'sf',
        data: next.data as T,
        exitCode: 0,
        stdout: '{}',
        stderr: ''
      };
    }
    return {
      ok: false,
      classification: 'cli_error',
      cliPath: 'sf',
      message: next.message,
      exitCode: 1,
      stdout: '',
      stderr: next.message
    };
  };

  return { fn, calls };
}

const ASSET_ROW = {
  Id: 'a0001',
  Name: 'Test Asset',
  Status: 'Installed',
  Product2Id: 'p0001',
  Product2: { Name: 'Test Product' },
  AccountId: 'acc001',
  LifecycleStartDate: '2026-01-01'
};

describe('executeInspectAssetLifecycle', () => {
  it('classifies an assetized asset as amendable with state periods and order provenance', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: { records: [ASSET_ROW] } },
      { ok: true, data: { records: [{ Id: 'aa001', AssetId: 'a0001', Type: 'AssetCreation', ActionDate: '2026-01-01', CreatedDate: '2026-01-01' }] } },
      {
        ok: true,
        data: {
          records: [
            { Id: 'asp000', AssetId: 'a0001', StartDate: '2025-01-01', EndDate: '2025-12-31', Quantity: 1 },
            { Id: 'asp001', AssetId: 'a0001', StartDate: '2026-01-01', Quantity: 2 }
          ]
        }
      },
      { ok: true, data: { records: [{ Id: 'aas001', AssetActionId: 'aa001', ReferenceEntityItemId: '802order-item' }] } },
      { ok: true, data: { records: [{ Id: '802order-item', OrderId: '801order' }] } },
      { ok: true, data: { records: [{ Id: 'qa001', SourceAssetId: 'a0001' }] } }
    ]);

    const result = await executeInspectAssetLifecycle({ orgAlias: 'ARMAF', assetIds: ['a0001'], invokeSfJson: fn });

    expect(result.status).toBe('ok');
    expect(result.result.assets).toHaveLength(1);
    const asset = result.result.assets[0];
    expect(asset?.assetized).toBe(true);
    expect(asset?.amendable).toBe(true);
    expect(asset?.renewable).toBe(true);
    expect(asset?.cancellable).toBe(true);
    expect(asset?.last_asset_action?.type).toBe('AssetCreation');
    // Only the currently-active period appears; the total row count is disclosed separately.
    expect(asset?.active_state_periods).toHaveLength(1);
    expect(asset?.active_state_periods[0]?.id).toBe('asp001');
    expect(asset?.active_state_periods[0]?.quantity).toBe(2);
    expect(asset?.state_period_count).toBe(2);
    expect(asset?.assetized_via_order).toBe('801order');
    expect(asset?.source_quote_action_id).toBe('qa001');
    expect(result.result.precondition_summary.all_assetized).toBe(true);
  });

  it('surfaces a non-assetized asset as a warning with remediation hint, not a failure', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: { records: [ASSET_ROW] } },
      { ok: true, data: { records: [] } },
      { ok: true, data: { records: [] } },
      { ok: true, data: { records: [] } }
    ]);

    const result = await executeInspectAssetLifecycle({ orgAlias: 'ARMAF', assetIds: ['a0001'], invokeSfJson: fn });

    expect(result.status).toBe('warn');
    expect(result.errors).toEqual([]);
    const asset = result.result.assets[0];
    expect(asset?.assetized).toBe(false);
    expect(asset?.assetized_via_order).toBeNull();
    expect(asset?.amendable).toBe(false);
    expect(asset?.warnings[0]).toContain('Remediation');
    expect(result.result.precondition_summary.all_assetized).toBe(false);
    expect(result.result.precondition_summary.warnings.length).toBeGreaterThan(0);
  });

  it('returns no_match when the asset is not found', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: true, data: { records: [] } }
    ]);

    const result = await executeInspectAssetLifecycle({ orgAlias: 'ARMAF', assetIds: ['a9999'], invokeSfJson: fn });

    expect(result.status).toBe('no_match');
    expect(result.result.assets).toHaveLength(0);
    expect(result.warnings[0]).toContain('a9999');
  });

  it('returns error when the Asset query fails', async () => {
    const { fn } = makeInvokeSfJson([
      { ok: false, message: 'INVALID_TYPE: sObject type Asset is not supported.' }
    ]);

    const result = await executeInspectAssetLifecycle({ orgAlias: 'ARMAF', assetIds: ['a0001'], invokeSfJson: fn });

    expect(result.status).toBe('error');
    expect(result.errors[0]).toContain('Asset query failed');
  });

  it('errors when no asset ids are provided', async () => {
    const fn = vi.fn();
    const result = await executeInspectAssetLifecycle({ orgAlias: 'ARMAF', assetIds: [], invokeSfJson: fn });

    expect(result.status).toBe('error');
    expect(fn).not.toHaveBeenCalled();
  });
});
