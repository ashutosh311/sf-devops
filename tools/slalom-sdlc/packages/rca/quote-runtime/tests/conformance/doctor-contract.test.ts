import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildDoctorEnvelope, renderDoctorHelp } from '../../src/commands/doctor';
import { parseEnvelope } from '../../src/contracts/result-envelope';
import { runQuoteRuntimeCli } from '../../src/bin/quote-runtime';

const fixturePath = resolve(import.meta.dirname, '../fixtures/doctor/expected-doctor-help.txt');
const expectedDoctorHelp = readFileSync(fixturePath, 'utf8');

describe('doctor contract conformance', () => {
  it('matches the locked doctor help fixture exactly', () => {
    expect(renderDoctorHelp()).toBe(expectedDoctorHelp);
  });

  it('emits the locked minimal doctor result object shape', () => {
    const envelope = buildDoctorEnvelope({
      globalFlags: {
        help: false,
        json: false,
        orgAlias: 'ARM',
        failOn: undefined,
        output: undefined,
        verbose: false
      },
      doctorFlags: {
        forCommand: 'snapshot-quote',
        quoteId: undefined,
        lineIds: ['L-1'],
        assetIds: ['A-1']
      },
      environment: {
        sfCliAvailable: true,
        sfCliVersion: 'sf-cli/2.0.0'
      },
      generatedAt: '2026-04-15T12:00:00.000Z',
      durationMs: 0
    });

    expect(parseEnvelope(envelope)).toMatchObject({
      command: 'doctor',
      status: 'warn',
      result: {
        subjects: {
          org_alias: 'ARM',
          for_command: 'snapshot-quote',
          quote_id: null,
          line_ids: ['L-1'],
          asset_ids: ['A-1']
        },
        checks: expect.any(Array),
        missing_requirements: ['quote_id'],
        recommended_next_commands: []
      }
    });
  });

  it('routes doctor help through the CLI entrypoint', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runQuoteRuntimeCli(['doctor', '--help'], {
      stdout: { write: (message: string) => void stdout.push(message) },
      stderr: { write: (message: string) => void stderr.push(message) }
    });

    expect(exitCode).toBe(0);
    expect(stdout.join('')).toBe(expectedDoctorHelp);
    expect(stderr).toEqual([]);
  });
});
