import { describe, expect, it, vi } from 'vitest';

import { runEnvelopeCommand, type EnvelopeCommandSpec } from '../../src/cli/run-envelope-command';
import type { GlobalFlags } from '../../src/cli/global-flags';
import type { CliIo } from '../../src/cli/output';
import type { ResultEnvelope } from '../../src/contracts/result-envelope';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeGlobalFlags(overrides: Partial<GlobalFlags> = {}): GlobalFlags {
  return {
    help: false,
    json: false,
    orgAlias: 'dev-org',
    failOn: undefined,
    output: undefined,
    verbose: false,
    ...overrides
  };
}

function makeIo(): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (msg: string) => void stdout.push(msg) },
      stderr: { write: (msg: string) => void stderr.push(msg) }
    },
    stdout,
    stderr
  };
}

function makeEnvelope(overrides: Partial<ResultEnvelope> = {}): ResultEnvelope {
  return {
    command: 'test-command',
    status: 'ok',
    summary: {
      primary_subject: 'test-subject',
      status_reason: 'ok',
      primary_lane: 'test',
      verification_anchor: null,
      next_suggested_command: null
    },
    result: {},
    warnings: [],
    errors: [],
    evidence: [],
    meta: {
      org_alias: 'dev-org',
      generated_at: '2026-01-01T00:00:00.000Z',
      duration_ms: 0,
      source_files: []
    },
    ...overrides
  };
}

function makeSpec(
  overrides: Partial<EnvelopeCommandSpec<{ testDep?: () => ResultEnvelope }>> = {}
): EnvelopeCommandSpec<{ testDep?: () => ResultEnvelope }> {
  return {
    commandName: 'test-command',
    requiresOrgAlias: true,
    execute: async ({ deps }) => deps.testDep?.() ?? makeEnvelope(),
    renderText: (envelope) => `status: ${envelope.status}\n`,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Org-alias guard
// ---------------------------------------------------------------------------

describe('org-alias guard', () => {
  it('throws when requiresOrgAlias is true (default) and orgAlias is undefined', async () => {
    const { io } = makeIo();
    const spec = makeSpec({ commandName: 'snapshot-quote' });

    await expect(
      runEnvelopeCommand(spec, [], makeGlobalFlags({ orgAlias: undefined }), io, {})
    ).rejects.toThrow('The snapshot-quote command requires --org-alias <alias>.');
  });

  it('throws when requiresOrgAlias is explicitly true and orgAlias is undefined', async () => {
    const { io } = makeIo();
    const spec = makeSpec({ commandName: 'price-quote', requiresOrgAlias: true });

    await expect(
      runEnvelopeCommand(spec, [], makeGlobalFlags({ orgAlias: undefined }), io, {})
    ).rejects.toThrow('requires --org-alias');
  });

  it('does NOT throw when requiresOrgAlias is false and orgAlias is undefined', async () => {
    const { io } = makeIo();
    const spec = makeSpec({ commandName: 'doctor', requiresOrgAlias: false });

    await expect(
      runEnvelopeCommand(spec, [], makeGlobalFlags({ orgAlias: undefined }), io, {})
    ).resolves.toBeDefined();
  });

  it('does NOT throw when orgAlias is provided', async () => {
    const { io } = makeIo();
    const spec = makeSpec();

    await expect(
      runEnvelopeCommand(spec, [], makeGlobalFlags({ orgAlias: 'my-org' }), io, {})
    ).resolves.toBeDefined();
  });

  it('error message contains the command name', async () => {
    const { io } = makeIo();
    const spec = makeSpec({ commandName: 'pst-plan' });

    await expect(
      runEnvelopeCommand(spec, [], makeGlobalFlags({ orgAlias: undefined }), io, {})
    ).rejects.toThrow('The pst-plan command requires --org-alias <alias>.');
  });
});

// ---------------------------------------------------------------------------
// JSON vs text emit
// ---------------------------------------------------------------------------

describe('output branching', () => {
  it('emits JSON when --json flag is set', async () => {
    const envelope = makeEnvelope({ status: 'ok', command: 'test-command' });
    const { io, stdout } = makeIo();
    const spec = makeSpec({ execute: async () => envelope });

    await runEnvelopeCommand(spec, [], makeGlobalFlags({ json: true }), io, {});

    expect(stdout).toHaveLength(1);
    const parsed = JSON.parse(stdout[0]!) as ResultEnvelope;
    expect(parsed.status).toBe('ok');
    expect(parsed.command).toBe('test-command');
  });

  it('emits text when --json flag is not set', async () => {
    const envelope = makeEnvelope({ status: 'warn' });
    const { io, stdout } = makeIo();
    const spec = makeSpec({
      execute: async () => envelope,
      renderText: (e) => `status: ${e.status}\n`
    });

    await runEnvelopeCommand(spec, [], makeGlobalFlags({ json: false }), io, {});

    expect(stdout.join('')).toContain('status: warn');
    // must not look like JSON
    expect(stdout.join('')).not.toContain('"status"');
  });

  it('calls renderText exactly once with the envelope', async () => {
    const envelope = makeEnvelope();
    const { io } = makeIo();
    const renderText = vi.fn(() => 'rendered\n');
    const spec = makeSpec({ execute: async () => envelope, renderText });

    await runEnvelopeCommand(spec, [], makeGlobalFlags({ json: false }), io, {});

    expect(renderText).toHaveBeenCalledOnce();
    expect(renderText).toHaveBeenCalledWith(envelope);
  });
});

// ---------------------------------------------------------------------------
// Exit-code mapping
// ---------------------------------------------------------------------------

describe('exit code mapping', () => {
  it('returns exitCode 0 for ok status with default fail-on (error)', async () => {
    const { io } = makeIo();
    const spec = makeSpec({ execute: async () => makeEnvelope({ status: 'ok' }) });

    const result = await runEnvelopeCommand(spec, [], makeGlobalFlags({ failOn: undefined }), io, {});

    expect(result.exitCode).toBe(0);
  });

  it('returns exitCode 0 for warn status when fail-on is error', async () => {
    const { io } = makeIo();
    const spec = makeSpec({ execute: async () => makeEnvelope({ status: 'warn' }) });

    const result = await runEnvelopeCommand(spec, [], makeGlobalFlags({ failOn: 'error' }), io, {});

    expect(result.exitCode).toBe(0);
  });

  it('returns exitCode 1 for error status when fail-on is error', async () => {
    const { io } = makeIo();
    const spec = makeSpec({ execute: async () => makeEnvelope({ status: 'error' }) });

    const result = await runEnvelopeCommand(spec, [], makeGlobalFlags({ failOn: 'error' }), io, {});

    expect(result.exitCode).toBe(1);
  });

  it('returns exitCode 1 for warn status when fail-on is warn', async () => {
    const { io } = makeIo();
    const spec = makeSpec({ execute: async () => makeEnvelope({ status: 'warn' }) });

    const result = await runEnvelopeCommand(spec, [], makeGlobalFlags({ failOn: 'warn' }), io, {});

    expect(result.exitCode).toBe(1);
  });

  it('returns exitCode 1 for no_match status when fail-on is no_match', async () => {
    const { io } = makeIo();
    const spec = makeSpec({ execute: async () => makeEnvelope({ status: 'no_match' }) });

    const result = await runEnvelopeCommand(spec, [], makeGlobalFlags({ failOn: 'no_match' }), io, {});

    expect(result.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Return shape
// ---------------------------------------------------------------------------

describe('return shape', () => {
  it('returns { envelope, text, exitCode }', async () => {
    const envelope = makeEnvelope({ status: 'ok' });
    const { io } = makeIo();
    const renderText = () => 'the text\n';
    const spec = makeSpec({ execute: async () => envelope, renderText });

    const result = await runEnvelopeCommand(spec, [], makeGlobalFlags(), io, {});

    expect(result.envelope).toBe(envelope);
    expect(result.text).toBe('the text\n');
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

describe('dependency injection', () => {
  it('passes deps through to the execute function', async () => {
    const customEnvelope = makeEnvelope({ status: 'warn', command: 'injected' });
    const testDep = vi.fn(() => customEnvelope);
    const { io } = makeIo();
    const spec = makeSpec({
      execute: async ({ deps }) => deps.testDep?.() ?? makeEnvelope()
    });

    const result = await runEnvelopeCommand(spec, [], makeGlobalFlags(), io, { testDep });

    expect(testDep).toHaveBeenCalledOnce();
    expect(result.envelope.command).toBe('injected');
  });

  it('works with empty deps object for no-dep commands', async () => {
    const { io } = makeIo();
    const noDepSpec: EnvelopeCommandSpec = {
      commandName: 'triage-symptom',
      execute: async () => makeEnvelope({ status: 'ok' }),
      renderText: () => 'ok\n'
    };

    const result = await runEnvelopeCommand(noDepSpec, [], makeGlobalFlags(), io, {});

    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Argv forwarding
// ---------------------------------------------------------------------------

describe('argv forwarding', () => {
  it('passes argv into the execute context', async () => {
    const capturedArgv: string[][] = [];
    const { io } = makeIo();
    const spec: EnvelopeCommandSpec = {
      commandName: 'test-command',
      execute: async ({ argv }) => {
        capturedArgv.push(argv);
        return makeEnvelope();
      },
      renderText: () => 'text\n'
    };

    await runEnvelopeCommand(spec, ['--quote-id', '0Q0xx'], makeGlobalFlags(), io, {});

    expect(capturedArgv).toHaveLength(1);
    expect(capturedArgv[0]).toEqual(['--quote-id', '0Q0xx']);
  });
});
