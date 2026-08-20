import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { invokeSfJson, type SfCliJsonFailure, type SfCliRunnerResult } from '../../../src/integrations/salesforce/sf-cli';

const fixturesDir = resolve(import.meta.dirname, '../../fixtures/integrations/salesforce');

function readFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf8');
}

function createRunner(result: SfCliRunnerResult) {
  return vi.fn(async () => result);
}

function expectFailure(result: unknown): asserts result is SfCliJsonFailure {
  expect(result).toMatchObject({ ok: false });
}

describe('sf cli adapter scaffold', () => {
  it('classifies a missing sf binary as unavailable', async () => {
    const runner = vi.fn();

    const result = await invokeSfJson({
      args: ['org', 'display', '--target-org', 'ARM', '--json'],
      resolveCliPath: () => null,
      run: runner
    });

    expect(result).toMatchObject({
      ok: false,
      classification: 'unavailable'
    });
    expectFailure(result);
    expect(result.message).toMatch(/sf.*not available on PATH/i);
    expect(runner).not.toHaveBeenCalled();
  });

  it('classifies auth failures without treating them as successful command results', async () => {
    const runner = createRunner({
      exitCode: 1,
      stdout: '',
      stderr: readFixture('auth-error.txt')
    });

    const result = await invokeSfJson({
      args: ['org', 'display', '--target-org', 'ARM', '--json'],
      orgAlias: 'ARM',
      resolveCliPath: () => '/usr/local/bin/sf',
      run: runner
    });

    expect(result).toMatchObject({
      ok: false,
      classification: 'auth'
    });
    expectFailure(result);
    expect(result.message).toMatch(/not authenticated/i);
  });

  it('classifies timeouts explicitly', async () => {
    const runner = vi.fn(async () => {
      const error = new Error('timed out');
      Object.assign(error, { code: 'ETIMEDOUT' });
      throw error;
    });

    const result = await invokeSfJson({
      args: ['data', 'query', '--query', 'SELECT Id FROM Quote', '--json'],
      orgAlias: 'ARM',
      timeoutMs: 5000,
      resolveCliPath: () => '/usr/local/bin/sf',
      run: runner
    });

    expect(result).toMatchObject({
      ok: false,
      classification: 'timeout'
    });
    expectFailure(result);
    expect(result.message).toMatch(/timed out after 5000ms/i);
  });

  it('classifies buffer overflow as max_buffer, not timeout', async () => {
    const runner = vi.fn(async () => {
      const error = new Error('stdout maxBuffer length exceeded');
      Object.assign(error, { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
      throw error;
    });

    const result = await invokeSfJson({
      args: ['data', 'query', '--query', 'SELECT Id FROM Quote LIMIT 100000', '--json'],
      orgAlias: 'ARM',
      timeoutMs: 45000,
      resolveCliPath: () => '/usr/local/bin/sf',
      run: runner
    });

    expect(result).toMatchObject({
      ok: false,
      classification: 'max_buffer'
    });
    expectFailure(result);
    expect(result.message).toMatch(/10 MB buffer limit/i);
    expect(result.message).not.toMatch(/timed out/i);
  });

  it('classifies non-json output as an error instead of a normal success', async () => {
    const runner = createRunner({
      exitCode: 0,
      stdout: readFixture('non-json-output.txt'),
      stderr: ''
    });

    const result = await invokeSfJson({
      args: ['data', 'query', '--query', 'SELECT Id FROM Quote', '--json'],
      orgAlias: 'ARM',
      resolveCliPath: () => '/usr/local/bin/sf',
      run: runner
    });

    expect(result).toMatchObject({
      ok: false,
      classification: 'non_json_error'
    });
    expectFailure(result);
    expect(result.message).toMatch(/unable to parse salesforce cli json output/i);
  });

  it('classifies known internal cli crashes as internal cli errors', async () => {
    const runner = createRunner({
      exitCode: 1,
      stdout: '',
      stderr: readFixture('internal-cli-error.txt')
    });

    const result = await invokeSfJson({
      args: ['data', 'query', '--query', 'SELECT Id FROM Quote', '--json'],
      orgAlias: 'ARM',
      resolveCliPath: () => '/usr/local/bin/sf',
      run: runner
    });

    expect(result).toMatchObject({
      ok: false,
      classification: 'internal_cli_error'
    });
    expectFailure(result);
    expect(result.message).toMatch(/internal error/i);
  });

  it('does not collapse generic not-found style failures into unavailable', async () => {
    const runner = createRunner({
      exitCode: 1,
      stdout: '',
      stderr: 'Record not found.'
    });

    const result = await invokeSfJson({
      args: ['data', 'query', '--query', 'SELECT Id FROM Quote', '--json'],
      orgAlias: 'ARM',
      resolveCliPath: () => '/usr/local/bin/sf',
      run: runner
    });

    expect(result).toMatchObject({
      ok: false,
      classification: 'cli_error'
    });
    expectFailure(result);
    expect(result.message).toMatch(/record not found/i);
  });

  it('keeps unexpected runner failures as cli errors instead of unavailable', async () => {
    const runner = vi.fn(async () => {
      throw new Error('permission denied reading config');
    });

    const result = await invokeSfJson({
      args: ['data', 'query', '--query', 'SELECT Id FROM Quote', '--json'],
      orgAlias: 'ARM',
      resolveCliPath: () => '/usr/local/bin/sf',
      run: runner
    });

    expect(result).toMatchObject({
      ok: false,
      classification: 'cli_error'
    });
    expectFailure(result);
    expect(result.message).toMatch(/permission denied reading config/i);
  });

  it('returns parsed json payloads only for real success', async () => {
    const runner = createRunner({
      exitCode: 0,
      stdout: JSON.stringify({ status: 0, result: { id: '001xx000003DHP0AAO' } }),
      stderr: ''
    });

    const result = await invokeSfJson<{ id: string }>({
      args: ['org', 'display', '--target-org', 'ARM', '--json'],
      orgAlias: 'ARM',
      resolveCliPath: () => '/usr/local/bin/sf',
      run: runner
    });

    expect(result).toEqual({
      ok: true,
      classification: 'ok',
      cliPath: '/usr/local/bin/sf',
      data: { id: '001xx000003DHP0AAO' },
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({ status: 0, result: { id: '001xx000003DHP0AAO' } })
    });
  });

  it('treats top-level successful sf json payloads as success data when no result wrapper is present', async () => {
    const runner = createRunner({
      exitCode: 0,
      stdout: JSON.stringify({ cliVersion: '@salesforce/cli/2.130.9', nodeVersion: 'node-v25.9.0' }),
      stderr: ''
    });

    const result = await invokeSfJson<{ cliVersion: string; nodeVersion: string }>({
      args: ['version', '--json'],
      resolveCliPath: () => '/usr/local/bin/sf',
      run: runner
    });

    expect(result).toEqual({
      ok: true,
      classification: 'ok',
      cliPath: '/usr/local/bin/sf',
      data: { cliVersion: '@salesforce/cli/2.130.9', nodeVersion: 'node-v25.9.0' },
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({ cliVersion: '@salesforce/cli/2.130.9', nodeVersion: 'node-v25.9.0' })
    });
  });

  it('treats raw REST array json as payload data', async () => {
    const runner = createRunner({
      exitCode: 0,
      stdout: JSON.stringify([{ id: '001xx000003DHP0AAO' }]),
      stderr: ''
    });

    const result = await invokeSfJson<Array<{ id: string }>>({
      args: ['api', 'request', 'rest', '/services/data/v66.0/query', '--json'],
      orgAlias: 'ARM',
      resolveCliPath: () => '/usr/local/bin/sf',
      run: runner
    });

    expect(result).toMatchObject({
      ok: true,
      data: [{ id: '001xx000003DHP0AAO' }]
    });
  });

  it('reports raw REST array error payload details before stderr warnings', async () => {
    const runner = createRunner({
      exitCode: 1,
      stdout: JSON.stringify([
        {
          errorCode: 'JSON_PARSER_ERROR',
          message: 'Unrecognized field "pricebookId".'
        }
      ]),
      stderr: '›   Warning: @salesforce/cli update available from 2.130.9 to 2.131.7.'
    });

    const result = await invokeSfJson({
      args: ['api', 'request', 'rest', '/services/data/v66.0/connect/cpq/products/01t', '--json'],
      orgAlias: 'ARM',
      resolveCliPath: () => '/usr/local/bin/sf',
      run: runner
    });

    expect(result).toMatchObject({
      ok: false,
      classification: 'cli_error'
    });
    expectFailure(result);
    expect(result.message).toContain('JSON_PARSER_ERROR');
    expect(result.message).toContain('Unrecognized field "pricebookId".');
    expect(result.message).not.toContain('update available');
  });

  it('reports json failure payload details before stderr warnings', async () => {
    const runner = createRunner({
      exitCode: 1,
      stdout: JSON.stringify({
        isSuccess: false,
        errorResponse: [
          {
            errorCode: 'FIELD_INTEGRITY_EXCEPTION',
            message: 'Product does not belong to the quote price book.'
          }
        ]
      }),
      stderr: '›   Warning: @salesforce/cli update available from 2.130.9 to 2.131.7.'
    });

    const result = await invokeSfJson({
      args: ['api', 'request', 'rest', '/services/data/v66.0/connect/rev/sales-transaction/actions/place', '--json'],
      orgAlias: 'ARM',
      resolveCliPath: () => '/usr/local/bin/sf',
      run: runner
    });

    expect(result).toMatchObject({
      ok: false,
      classification: 'cli_error'
    });
    expectFailure(result);
    expect(result.message).toContain('FIELD_INTEGRITY_EXCEPTION');
    expect(result.message).toContain('Product does not belong to the quote price book.');
    expect(result.message).not.toContain('update available');
  });
});
