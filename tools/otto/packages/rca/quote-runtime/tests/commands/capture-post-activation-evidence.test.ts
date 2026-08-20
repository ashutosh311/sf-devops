import { describe, expect, it, vi } from 'vitest';

import {
  parseCapturePostActivationEvidenceFlags,
  renderCapturePostActivationEvidenceHelp,
  runCapturePostActivationEvidenceCommand
} from '../../src/commands/capture-post-activation-evidence';
import { executeCapturePostActivationEvidence } from '../../src/primitives/capture-post-activation-evidence';
import type { CapturePostActivationEvidencePrimitiveResult } from '../../src/primitives/capture-post-activation-evidence';
import type { InvokeSfJsonOptions, SfCliJsonResult } from '../../src/integrations/salesforce/sf-cli';

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

  const fn = async <T,>(_options: InvokeSfJsonOptions): Promise<SfCliJsonResult<T>> => {
    const next = sequence[index++];
    if (!next) {
      throw new Error('Unexpected invokeSfJson call in test.');
    }
    if (next.ok) {
      return { ok: true, classification: 'ok', cliPath: 'sf', data: next.data as T, exitCode: 0, stdout: '{}', stderr: '' };
    }
    return { ok: false, classification: 'cli_error', cliPath: 'sf', message: next.message, exitCode: 1, stdout: '', stderr: next.message };
  };

  return fn;
}

function okPrimitive(): CapturePostActivationEvidencePrimitiveResult {
  return {
    status: 'ok',
    result: {
      packet: {
        order_id: '801xx',
        asset_ids_queried: ['a0001'],
        assets: [{ id: 'a0001', name: 'Asset', status: 'Installed', product_id: 'p0001', account_id: 'acc001', lifecycle_start_date: '2026-01-01', lifecycle_end_date: null }],
        asset_actions: [{ id: 'aa001', asset_id: 'a0001', type: 'AssetCreation', action_date: '2026-01-01' }],
        asset_state_periods: [{ id: 'asp001', asset_id: 'a0001', start_date: '2026-01-01', end_date: null, quantity: 1 }],
        evidence_status: 'ok',
        gaps: []
      }
    },
    warnings: [],
    errors: [],
    evidence: []
  };
}

describe('capture-post-activation-evidence command', () => {
  it('parses order-id and asset-id flags', async () => {
    await expect(parseCapturePostActivationEvidenceFlags([
      '--order-id', '801xx',
      '--asset-id', 'a0001',
      '--asset-id', 'a0002'
    ])).resolves.toEqual({
      orderId: '801xx',
      assetIds: ['a0001', 'a0002']
    });
  });

  it('documents the read-only evidence capture contract', () => {
    expect(renderCapturePostActivationEvidenceHelp()).toContain('capture-post-activation-evidence --org-alias <alias>');
    expect(renderCapturePostActivationEvidenceHelp()).toContain('Does not mutate any records.');
  });

  it('emits an ok envelope with the evidence packet', async () => {
    const { io, writes } = makeIo();
    const result = await runCapturePostActivationEvidenceCommand(
      ['--order-id', '801xx'],
      makeGlobalFlags(),
      io,
      { executeCapturePostActivationEvidence: vi.fn(async () => okPrimitive()) }
    );

    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(writes.join(''));
    expect(envelope.command).toBe('capture-post-activation-evidence');
    expect(envelope.status).toBe('ok');
    expect(envelope.result.packet.assets).toHaveLength(1);
    expect(envelope.result.packet.asset_actions).toHaveLength(1);
    expect(envelope.result.packet.asset_state_periods).toHaveLength(1);
    expect(envelope.summary.next_suggested_command).toBe('inspect-asset-lifecycle');
  });

  it('rejects when neither order-id nor asset-id is provided', async () => {
    const { io } = makeIo();
    await expect(
      runCapturePostActivationEvidenceCommand([], makeGlobalFlags(), io, {})
    ).rejects.toThrow('requires either --order-id or at least one --asset-id');
  });

  it('throws when org-alias is missing', async () => {
    const { io } = makeIo();
    await expect(
      runCapturePostActivationEvidenceCommand(['--order-id', '801xx'], makeGlobalFlags({ orgAlias: undefined }), io, {})
    ).rejects.toThrow('requires --org-alias');
  });
});

describe('executeCapturePostActivationEvidence primitive', () => {
  it('pivots from order-id to assets via AssetActionSource.ReferenceEntityItemId and captures evidence', async () => {
    const invokeSfJson = makeInvokeSfJson([
      { ok: true, data: { records: [{ Id: '802aa', OrderId: '801xx' }] } },
      { ok: true, data: { records: [{ Id: 'aas001', AssetActionId: 'aa001', ReferenceEntityItemId: '802aa', AssetAction: { AssetId: 'a0001' } }] } },
      { ok: true, data: { records: [{ Id: 'a0001', Name: 'Asset', Status: 'Installed', Product2Id: 'p0001', AccountId: 'acc001' }] } },
      { ok: true, data: { records: [{ Id: 'aa001', AssetId: 'a0001', Type: 'AssetCreation', ActionDate: '2026-01-01' }] } },
      { ok: true, data: { records: [{ Id: 'asp001', AssetId: 'a0001', StartDate: '2026-01-01', Quantity: 1 }] } }
    ]);

    const result = await executeCapturePostActivationEvidence({ orgAlias: 'ARMAF', orderId: '801xx', invokeSfJson });

    expect(result.status).toBe('ok');
    expect(result.result.packet.asset_ids_queried).toEqual(['a0001']);
    expect(result.result.packet.assets[0]?.id).toBe('a0001');
    expect(result.result.packet.asset_actions[0]?.type).toBe('AssetCreation');
    expect(result.result.packet.asset_state_periods[0]?.quantity).toBe(1);
    expect(result.result.packet.evidence_status).toBe('ok');
  });

  it('returns no_match with a remediation gap when the order has no assetized items', async () => {
    const invokeSfJson = makeInvokeSfJson([
      { ok: true, data: { records: [] } }
    ]);

    const result = await executeCapturePostActivationEvidence({ orgAlias: 'ARMAF', orderId: '801xx', invokeSfJson });

    expect(result.status).toBe('no_match');
    expect(result.result.packet.evidence_status).toBe('no_match');
    expect(result.result.packet.gaps.some((gap) => gap.includes('activate-order --execute'))).toBe(true);
  });

  it('captures directly from asset ids without the order pivot', async () => {
    const invokeSfJson = makeInvokeSfJson([
      { ok: true, data: { records: [{ Id: 'a0001', Status: 'Installed' }] } },
      { ok: true, data: { records: [] } },
      { ok: true, data: { records: [] } }
    ]);

    const result = await executeCapturePostActivationEvidence({ orgAlias: 'ARMAF', assetIds: ['a0001'], invokeSfJson });

    expect(result.status).toBe('ok');
    expect(result.result.packet.order_id).toBeNull();
    expect(result.result.packet.assets).toHaveLength(1);
  });

  it('errors when neither pivot input is provided', async () => {
    const result = await executeCapturePostActivationEvidence({ orgAlias: 'ARMAF' });

    expect(result.status).toBe('error');
    expect(result.errors[0]).toContain('required');
  });
});
