import { describe, expect, it, vi } from 'vitest';

import {
  parseInspectAssetLifecycleFlags,
  renderInspectAssetLifecycleHelp,
  runInspectAssetLifecycleCommand
} from '../../src/commands/inspect-asset-lifecycle';
import type { InspectAssetLifecyclePrimitiveResult } from '../../src/primitives/asset-lifecycle';

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

function assetizedPrimitive(): InspectAssetLifecyclePrimitiveResult {
  return {
    status: 'ok',
    result: {
      assets: [
        {
          id: 'a0001',
          name: 'Test Asset',
          status: 'Installed',
          product_id: 'p0001',
          product_name: 'Test Product',
          account_id: 'acc001',
          lifecycle_start_date: '2026-01-01',
          lifecycle_end_date: null,
          assetized: true,
          assetized_via_order: '801order',
          amendable: true,
          renewable: true,
          cancellable: true,
          active_state_periods: [
            { id: 'asp001', start_date: '2026-01-01', end_date: null, quantity: 1 }
          ],
          state_period_count: 1,
          last_asset_action: { id: 'aa001', type: 'AssetCreation', action_date: '2026-01-01', created_date: '2026-01-01' },
          source_quote_action_id: null,
          warnings: []
        }
      ],
      precondition_summary: {
        all_assetized: true,
        shared_pricebook: true,
        warnings: []
      }
    },
    warnings: [],
    errors: [],
    evidence: []
  };
}

function nonAssetizedPrimitive(): InspectAssetLifecyclePrimitiveResult {
  return {
    status: 'warn',
    result: {
      assets: [
        {
          id: 'a0002',
          name: 'Manual Asset',
          status: 'Installed',
          product_id: 'p0001',
          product_name: null,
          account_id: 'acc001',
          lifecycle_start_date: null,
          lifecycle_end_date: null,
          assetized: false,
          assetized_via_order: null,
          amendable: false,
          renewable: false,
          cancellable: false,
          active_state_periods: [],
          state_period_count: 0,
          last_asset_action: null,
          source_quote_action_id: null,
          warnings: [
            'Asset a0002 has no AssetAction records — it was not created through the standard order activation lifecycle. Amend/renew/cancel operations will fail. Remediation: activate the originating order using activate-order --execute.'
          ]
        }
      ],
      precondition_summary: {
        all_assetized: false,
        shared_pricebook: true,
        warnings: ['Not all assets are assetized via the standard lifecycle. Order activation is required before amend/renew/cancel.']
      }
    },
    warnings: ['Asset a0002 has no AssetAction records — it was not created through the standard order activation lifecycle. Amend/renew/cancel operations will fail. Remediation: activate the originating order using activate-order --execute.'],
    errors: [],
    evidence: []
  };
}

function notFoundPrimitive(): InspectAssetLifecyclePrimitiveResult {
  return {
    status: 'no_match',
    result: {
      assets: [],
      precondition_summary: {
        all_assetized: false,
        shared_pricebook: false,
        warnings: ['No Asset records found for ID(s): a9999.']
      }
    },
    warnings: ['No Asset records found for ID(s): a9999.'],
    errors: [],
    evidence: []
  };
}

describe('inspect-asset-lifecycle command', () => {
  it('parses asset-id and account-id flags', async () => {
    await expect(parseInspectAssetLifecycleFlags([
      '--asset-id', 'a0001',
      '--asset-id', 'a0002',
      '--account-id', 'acc001'
    ])).resolves.toEqual({
      assetIds: ['a0001', 'a0002'],
      accountId: 'acc001'
    });
  });

  it('parses asset-id only, defaulting account-id to null', async () => {
    await expect(parseInspectAssetLifecycleFlags(['--asset-id', 'a0001'])).resolves.toEqual({
      assetIds: ['a0001'],
      accountId: null
    });
  });

  it('documents the read-only asset lifecycle inspection contract', () => {
    expect(renderInspectAssetLifecycleHelp()).toContain('inspect-asset-lifecycle --org-alias <alias> --asset-id <id>');
    expect(renderInspectAssetLifecycleHelp()).toContain('Does not mutate any records.');
    expect(renderInspectAssetLifecycleHelp()).toContain('Non-assetized assets surface a warning with remediation hint, not a failure.');
  });

  it('returns ok envelope for an assetized asset', async () => {
    const { io, writes } = makeIo();
    const result = await runInspectAssetLifecycleCommand(
      ['--asset-id', 'a0001'],
      makeGlobalFlags(),
      io,
      { executeInspectAssetLifecycle: vi.fn(async () => assetizedPrimitive()) }
    );

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(writes.join(''));
    expect(envelope.command).toBe('inspect-asset-lifecycle');
    expect(envelope.status).toBe('ok');
    expect(envelope.summary.primary_lane).toBe('asset_lifecycle_inspection');
    expect(envelope.result.assets[0].assetized).toBe(true);
    expect(envelope.result.assets[0].amendable).toBe(true);
    expect(envelope.result.precondition_summary.all_assetized).toBe(true);
  });

  it('returns warn envelope for a non-assetized asset with remediation hint', async () => {
    const { io, writes } = makeIo();
    const result = await runInspectAssetLifecycleCommand(
      ['--asset-id', 'a0002'],
      makeGlobalFlags(),
      io,
      { executeInspectAssetLifecycle: vi.fn(async () => nonAssetizedPrimitive()) }
    );

    expect(result.exitCode).toBe(0); // warn does not fail when failOn=undefined (defaults to error)
    const envelope = JSON.parse(writes.join(''));
    expect(envelope.command).toBe('inspect-asset-lifecycle');
    expect(envelope.status).toBe('warn');
    expect(envelope.result.assets[0].assetized).toBe(false);
    expect(envelope.result.assets[0].amendable).toBe(false);
    expect(envelope.result.precondition_summary.all_assetized).toBe(false);
    expect(envelope.warnings.length).toBeGreaterThan(0);
    expect(envelope.warnings[0]).toContain('Remediation');
  });

  it('returns no_match envelope when asset is not found', async () => {
    const { io, writes } = makeIo();
    const result = await runInspectAssetLifecycleCommand(
      ['--asset-id', 'a9999'],
      makeGlobalFlags(),
      io,
      { executeInspectAssetLifecycle: vi.fn(async () => notFoundPrimitive()) }
    );

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(writes.join(''));
    expect(envelope.status).toBe('no_match');
    expect(envelope.result.assets).toHaveLength(0);
  });

  it('throws when org-alias is missing', async () => {
    const { io } = makeIo();
    await expect(
      runInspectAssetLifecycleCommand(
        ['--asset-id', 'a0001'],
        makeGlobalFlags({ orgAlias: undefined }),
        io,
        {}
      )
    ).rejects.toThrow('requires --org-alias');
  });
});
