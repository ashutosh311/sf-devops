import { describe, expect, it } from 'vitest';

import {
  buildDoctorEnvelope,
  buildDoctorLiveChecks,
  parseDoctorFlags,
  renderDoctorHelp,
  renderDoctorText,
  runDoctorCommand,
  type DoctorCommandDependencies,
  type DoctorCheck
} from '../../src/commands/doctor';
// Registers the ownership/selector-policy maps that buildDoctorCommandChecks needs.
// doctor.ts cannot import all-commands.ts directly (it would create a CJS cycle),
// so tests that exercise buildDoctorCommandChecks must trigger registration here.
import '../../src/commands/all-commands';
import type { GlobalFlags } from '../../src/cli/global-flags';

function makeGlobalFlags(overrides: Partial<GlobalFlags> = {}): GlobalFlags {
  return {
    help: false,
    json: false,
    orgAlias: 'ARM',
    failOn: undefined,
    output: undefined,
    verbose: false,
    ...overrides
  };
}

function makeInvokeSfJson(sequence: Array<{ ok: true; data: unknown } | { ok: false; message: string; classification?: string }>): DoctorCommandDependencies['invokeSfJson'] {
  let index = 0;

  return async <T,>(_options: unknown) => {
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

    const failure = next as { ok: false; message: string; classification?: string };
    return {
      ok: false,
      classification: (failure.classification ?? 'unavailable') as 'auth' | 'unavailable' | 'timeout' | 'non_json_error' | 'internal_cli_error' | 'cli_error',
      cliPath: 'sf',
      message: failure.message,
      exitCode: 1,
      stdout: '',
      stderr: failure.message
    };
  };
}

describe('doctor command', () => {
  it('parses the locked doctor selector flags', async () => {
    await expect(
      parseDoctorFlags(['--for-command', 'snapshot-quote', '--quote-id', 'Q-001', '--line-id', 'L-1', '--asset-id', 'A-1'])
    ).resolves.toEqual({
      forCommand: 'snapshot-quote',
      quoteId: 'Q-001',
      lineIds: ['L-1'],
      assetIds: ['A-1']
    });
  });

  it('returns warn results when selector requirements are missing', () => {
    const envelope = buildDoctorEnvelope({
      globalFlags: makeGlobalFlags({ orgAlias: undefined }),
      doctorFlags: {
        forCommand: 'snapshot-quote',
        quoteId: undefined,
        lineIds: [],
        assetIds: []
      },
      liveChecks: [],
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(envelope.status).toBe('warn');
    expect(envelope.summary.next_suggested_command).toBeNull();
    expect(envelope.result).toMatchObject({
      subjects: {
        org_alias: null,
        for_command: 'snapshot-quote',
        quote_id: null,
        line_ids: [],
        asset_ids: []
      },
      missing_requirements: ['org_alias', 'quote_id'],
      recommended_next_commands: []
    });
  });

  it('returns ok when doctor has the required selector inputs and live checks pass', () => {
    const liveChecks: DoctorCheck[] = [
      { scope: 'live', key: 'sf_cli', status: 'ok', message: 'Salesforce CLI is available.' },
      { scope: 'live', key: 'org_auth', status: 'ok', message: 'Org alias is authenticated.' },
      { scope: 'live', key: 'org_read_proof', status: 'ok', message: 'Safe read proof succeeded.' }
    ];

    const envelope = buildDoctorEnvelope({
      globalFlags: makeGlobalFlags(),
      doctorFlags: {
        forCommand: 'snapshot-quote',
        quoteId: 'Q-001',
        lineIds: [],
        assetIds: []
      },
      liveChecks,
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(envelope.status).toBe('ok');
    expect(envelope.summary.next_suggested_command).toBe('snapshot-quote');
    expect(envelope.result).toMatchObject({
      missing_requirements: [],
      recommended_next_commands: ['snapshot-quote'],
      checks: expect.arrayContaining([expect.objectContaining({ key: 'org_read_proof', status: 'ok' })])
    });
  });

  it('suppresses next-command recommendations when live readiness checks are still missing', () => {
    const envelope = buildDoctorEnvelope({
      globalFlags: makeGlobalFlags(),
      doctorFlags: {
        forCommand: 'snapshot-quote',
        quoteId: 'Q-001',
        lineIds: [],
        assetIds: []
      },
      liveChecks: [
        { scope: 'live', key: 'sf_cli', status: 'ok', message: 'Salesforce CLI is available.' },
        { scope: 'live', key: 'org_auth', status: 'missing', message: 'Org alias is not authenticated.' },
        { scope: 'live', key: 'org_read_proof', status: 'missing', message: 'Skipped safe read proof.' }
      ],
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(envelope.status).toBe('warn');
    expect(envelope.summary.next_suggested_command).toBeNull();
    expect(envelope.result).toMatchObject({
      missing_requirements: ['org_auth', 'org_read_proof'],
      recommended_next_commands: []
    });
  });

  it('keeps inspect-pricing-waterfall blocked until exactly one unique line id is provided', () => {
    const envelope = buildDoctorEnvelope({
      globalFlags: makeGlobalFlags(),
      doctorFlags: {
        forCommand: 'inspect-pricing-waterfall',
        quoteId: 'Q-001',
        lineIds: ['L-1', 'L-2'],
        assetIds: []
      },
      liveChecks: [],
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(envelope.status).toBe('warn');
    expect(envelope.summary.next_suggested_command).toBeNull();
    expect(envelope.result).toMatchObject({
      missing_requirements: ['line_ids_exactly_one'],
      recommended_next_commands: [],
      checks: expect.arrayContaining([
        expect.objectContaining({
          key: 'line_ids_exactly_one',
          status: 'missing',
          message: 'Provide exactly one unique --line-id <id> in V1.'
        })
      ])
    });
  });

  it('builds live readiness checks for sf availability, org auth, and safe read proof', async () => {
    const checks = await buildDoctorLiveChecks(makeGlobalFlags(), {
      invokeSfJson: makeInvokeSfJson([
        { ok: true, data: { cliVersion: '@salesforce/cli/2.99.0', nodeVersion: 'node-v24.1.0' } },
        { ok: true, data: { id: '00DTEST', username: 'agent@example.com' } },
        { ok: true, data: { totalSize: 1, records: [{ Id: '00DTEST' }] } }
      ])
    });

    expect(checks).toEqual([
      expect.objectContaining({ key: 'sf_cli', status: 'ok' }),
      expect.objectContaining({ key: 'org_auth', status: 'ok' }),
      expect.objectContaining({ key: 'org_read_proof', status: 'ok' })
    ]);
  });

  it('reports skipped read proof when org auth viability fails', async () => {
    const checks = await buildDoctorLiveChecks(makeGlobalFlags(), {
      invokeSfJson: makeInvokeSfJson([
        { ok: true, data: { cliVersion: '@salesforce/cli/2.99.0' } },
        { ok: false, message: "Salesforce CLI live org reads are unavailable for alias 'ARM' because the org is not authenticated.", classification: 'auth' }
      ])
    });

    expect(checks).toEqual([
      expect.objectContaining({ key: 'sf_cli', status: 'ok' }),
      expect.objectContaining({ key: 'org_auth', status: 'missing' }),
      expect.objectContaining({ key: 'org_read_proof', status: 'missing' })
    ]);
  });

  it('renders deterministic doctor help and text output', () => {
    expect(renderDoctorHelp()).toContain('quote-runtime doctor --org-alias <alias> --for-command <subcommand>');
    expect(renderDoctorHelp()).toContain('safe read-only Organization query proof');

    const envelope = buildDoctorEnvelope({
      globalFlags: makeGlobalFlags(),
      doctorFlags: {
        forCommand: 'snapshot-quote',
        quoteId: undefined,
        lineIds: [],
        assetIds: []
      },
      liveChecks: [{ scope: 'live', key: 'sf_cli', status: 'ok', message: 'Salesforce CLI is available.' }],
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(renderDoctorText(envelope)).toContain('Missing requirements:');
    expect(renderDoctorText(envelope)).toContain('- quote_id');
  });

  it('adds lifecycle-assetization checks when --for-command targets a lifecycle command and they pass', async () => {
    const checks = await buildDoctorLiveChecks(
      makeGlobalFlags(),
      {
        invokeSfJson: makeInvokeSfJson([
          { ok: true, data: { cliVersion: '@salesforce/cli/2.99.0' } },
          { ok: true, data: { id: '00DTEST', username: 'agent@example.com' } },
          { ok: true, data: { totalSize: 1, records: [{ Id: '00DTEST' }] } },
          { ok: true, data: { name: 'AssetStatePeriod', queryable: true } },
          { ok: true, data: { name: 'AssetAction', queryable: true } },
          { ok: true, data: { totalSize: 1, records: [] } },
          { ok: true, data: { totalSize: 1, records: [] } }
        ])
      },
      { forCommand: 'activate-order', quoteId: undefined, lineIds: [], assetIds: [] }
    );

    expect(checks).toEqual([
      expect.objectContaining({ key: 'sf_cli', status: 'ok' }),
      expect.objectContaining({ key: 'org_auth', status: 'ok' }),
      expect.objectContaining({ key: 'org_read_proof', status: 'ok' }),
      expect.objectContaining({ key: 'lifecycle_assetization.asset_state_period_readable', status: 'ok' }),
      expect.objectContaining({ key: 'lifecycle_assetization.asset_action_readable', status: 'ok' }),
      expect.objectContaining({ key: 'lifecycle_assetization.initiate_amend_permission_set', status: 'ok' }),
      expect.objectContaining({ key: 'lifecycle_assetization.assetize_order_permission_assigned', status: 'ok' })
    ]);
  });

  it('reports missing lifecycle-assetization readiness when describes fail or permission set is absent', async () => {
    const checks = await buildDoctorLiveChecks(
      makeGlobalFlags(),
      {
        invokeSfJson: makeInvokeSfJson([
          { ok: true, data: { cliVersion: '@salesforce/cli/2.99.0' } },
          { ok: true, data: { id: '00DTEST', username: 'agent@example.com' } },
          { ok: true, data: { totalSize: 1, records: [{ Id: '00DTEST' }] } },
          { ok: false, message: 'The requested resource does not exist: AssetStatePeriod' },
          { ok: true, data: { name: 'AssetAction', queryable: false } },
          { ok: true, data: { totalSize: 0, records: [] } },
          { ok: true, data: { totalSize: 0, records: [] } }
        ])
      },
      { forCommand: 'inspect-asset-lifecycle', quoteId: undefined, lineIds: [], assetIds: [] }
    );

    expect(checks).toEqual([
      expect.objectContaining({ key: 'sf_cli', status: 'ok' }),
      expect.objectContaining({ key: 'org_auth', status: 'ok' }),
      expect.objectContaining({ key: 'org_read_proof', status: 'ok' }),
      expect.objectContaining({ key: 'lifecycle_assetization.asset_state_period_readable', status: 'missing' }),
      expect.objectContaining({ key: 'lifecycle_assetization.asset_action_readable', status: 'missing' }),
      expect.objectContaining({ key: 'lifecycle_assetization.initiate_amend_permission_set', status: 'missing' }),
      expect.objectContaining({ key: 'lifecycle_assetization.assetize_order_permission_assigned', status: 'missing' })
    ]);
  });

  it('does not add lifecycle-assetization checks for non-lifecycle commands', async () => {
    const checks = await buildDoctorLiveChecks(
      makeGlobalFlags(),
      {
        invokeSfJson: makeInvokeSfJson([
          { ok: true, data: { cliVersion: '@salesforce/cli/2.99.0' } },
          { ok: true, data: { id: '00DTEST', username: 'agent@example.com' } },
          { ok: true, data: { totalSize: 1, records: [{ Id: '00DTEST' }] } }
        ])
      },
      { forCommand: 'snapshot-quote', quoteId: 'Q-001', lineIds: [], assetIds: [] }
    );

    expect(checks.map((check) => check.key)).toEqual(['sf_cli', 'org_auth', 'org_read_proof']);
  });

  it('runs through the command entry and emits json when requested', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const execution = await runDoctorCommand(
      ['--for-command', 'doctor'],
      makeGlobalFlags({ json: true, failOn: 'error' }),
      {
        stdout: { write: (message: string) => void stdout.push(message) },
        stderr: { write: (message: string) => void stderr.push(message) }
      },
      {
        invokeSfJson: makeInvokeSfJson([
          { ok: true, data: { cliVersion: '@salesforce/cli/2.99.0' } },
          { ok: true, data: { id: '00DTEST', username: 'agent@example.com' } },
          { ok: true, data: { totalSize: 1, records: [{ Id: '00DTEST' }] } }
        ])
      }
    );

    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    const payload = JSON.parse(stdout.join(''));

    expect(payload).toMatchObject({
      command: 'doctor',
      status: 'ok',
      result: {
        recommended_next_commands: ['doctor']
      }
    });
    expect(payload.result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'sf_cli', status: 'ok' }),
        expect.objectContaining({ key: 'org_auth', status: 'ok' }),
        expect.objectContaining({ key: 'org_read_proof', status: 'ok' })
      ])
    );
  });
});
