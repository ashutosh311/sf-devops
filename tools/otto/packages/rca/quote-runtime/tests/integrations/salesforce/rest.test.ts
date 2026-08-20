import { describe, expect, it, vi } from 'vitest';

import {
  buildSfRestGetArgs,
  buildSfRestWriteArgs,
  invokeSfRestGet,
  invokeSfRestWrite,
  normalizeRestPath
} from '../../../src/integrations/salesforce/rest';

describe('salesforce rest helper', () => {
  it('builds sf api request rest args for authenticated GETs', () => {
    expect(buildSfRestGetArgs('ARM', '/services/data/v66.0/connect/core-pricing/waterfall/L-1/EXEC-1')).toEqual([
      'api',
      'request',
      'rest',
      '/services/data/v66.0/connect/core-pricing/waterfall/L-1/EXEC-1',
      '--target-org',
      'ARM',
      '--method',
      'GET'
    ]);
  });

  it('builds sf api request rest args for authenticated writes with inline JSON body', () => {
    expect(buildSfRestWriteArgs('ARM', '/services/data/v66.0/connect/rev/sales-transaction/actions/place', 'POST', '{"graph":{"records":[]}}')).toEqual([
      'api',
      'request',
      'rest',
      '/services/data/v66.0/connect/rev/sales-transaction/actions/place',
      '--target-org',
      'ARM',
      '--method',
      'POST',
      '--body',
      '{"graph":{"records":[]}}'
    ]);
  });

  it('normalizes bare rest paths to a leading slash', () => {
    expect(normalizeRestPath('services/data/v66.0/connect/core-pricing/pricing-process-execution/123')).toBe(
      '/services/data/v66.0/connect/core-pricing/pricing-process-execution/123'
    );
  });

  it('delegates to invokeSfJson and returns the rest payload on success', async () => {
    const invokeSfJson = vi.fn(async () => ({
      ok: true,
      classification: 'ok' as const,
      cliPath: '/usr/local/bin/sf',
      data: { id: 'EXEC-1', status: 'Success' },
      exitCode: 0,
      stdout: '{"status":0}',
      stderr: ''
    }));

    const result = await invokeSfRestGet<{ id: string; status: string }>({
      orgAlias: 'ARM',
      path: 'services/data/v66.0/connect/core-pricing/pricing-process-execution/EXEC-1',
      timeoutMs: 9000,
      invokeSfJson
    });

    expect(invokeSfJson).toHaveBeenCalledWith({
      args: [
        'api',
        'request',
        'rest',
        '/services/data/v66.0/connect/core-pricing/pricing-process-execution/EXEC-1',
        '--target-org',
        'ARM',
        '--method',
        'GET'
      ],
      orgAlias: 'ARM',
      timeoutMs: 9000
    });
    expect(result).toEqual({
      ok: true,
      classification: 'ok',
      path: '/services/data/v66.0/connect/core-pricing/pricing-process-execution/EXEC-1',
      cliPath: '/usr/local/bin/sf',
      data: { id: 'EXEC-1', status: 'Success' },
      exitCode: 0,
      stdout: '{"status":0}',
      stderr: ''
    });
  });

  it('preserves sf-cli failure classification and details', async () => {
    const invokeSfJson = vi.fn(async () => ({
      ok: false,
      classification: 'auth' as const,
      cliPath: '/usr/local/bin/sf',
      message: 'Org alias ARM is not authenticated.',
      exitCode: 1,
      stdout: '',
      stderr: 'not authenticated'
    }));

    const result = await invokeSfRestGet({
      orgAlias: 'ARM',
      path: '/services/data/v66.0/connect/core-pricing/waterfall/L-1/EXEC-1',
      invokeSfJson
    });

    expect(result).toEqual({
      ok: false,
      classification: 'auth',
      path: '/services/data/v66.0/connect/core-pricing/waterfall/L-1/EXEC-1',
      cliPath: '/usr/local/bin/sf',
      message: 'Org alias ARM is not authenticated.',
      exitCode: 1,
      stdout: '',
      stderr: 'not authenticated'
    });
  });

  it('delegates POST writes to invokeSfJson and returns write metadata', async () => {
    const invokeSfJson = vi.fn(async () => ({
      ok: true,
      classification: 'ok' as const,
      cliPath: '/usr/local/bin/sf',
      data: { accepted: true },
      exitCode: 0,
      stdout: '{"status":0}',
      stderr: ''
    }));

    const result = await invokeSfRestWrite({
      orgAlias: 'ARM',
      path: '/services/data/v66.0/connect/rev/sales-transaction/actions/place',
      method: 'POST',
      body: { graph: { records: [] } },
      invokeSfJson
    });

    expect(invokeSfJson).toHaveBeenCalledWith({
      args: [
        'api',
        'request',
        'rest',
        '/services/data/v66.0/connect/rev/sales-transaction/actions/place',
        '--target-org',
        'ARM',
        '--method',
        'POST',
        '--body',
        '{"graph":{"records":[]}}'
      ],
      orgAlias: 'ARM'
    });
    expect(result).toMatchObject({
      ok: true,
      classification: 'ok',
      path: '/services/data/v66.0/connect/rev/sales-transaction/actions/place',
      method: 'POST',
      body: '{"graph":{"records":[]}}',
      data: { accepted: true }
    });
  });

  it('rejects empty rest paths', () => {
    expect(() => normalizeRestPath('   ')).toThrow('REST path must be a non-empty string.');
  });
});
