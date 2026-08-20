/**
 * Tests for the doctor command module (lib/doctor — 844 LOC).
 *
 * doctor diagnoses selector, artifact, and companion-file issues.  It is the
 * primary entry-point for the readiness-check workflow and the largest lib
 * module that benefits most from direct unit coverage.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPricingEnvelopeShape } from '../helpers/envelope-assertions';

import { doctorCommand } from '../../src/commands/doctor';
import { PricingCliError } from '../../src/lib/contracts/errors';

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const PROCEDURE = resolve(FIXTURES, 'Rev_Mgmt_Default_Pricing_Procedure2.expressionSetDefinition-meta.xml');
const CONTEXT = resolve(FIXTURES, 'RevSalesTransactionContext.contextDefinition-meta.xml');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runDoctor(argv: string[]) {
  const args = doctorCommand.parseArgs(argv);
  return doctorCommand.run(args, Date.now());
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('doctor parseArgs', () => {
  it('accepts --file', () => {
    const args = doctorCommand.parseArgs(['--file', PROCEDURE]);
    expect(args).toMatchObject({ file: PROCEDURE, json: false, failOn: 'warn' });
  });

  it('accepts --repo', () => {
    const args = doctorCommand.parseArgs(['--repo', '/some/dir']);
    expect(args).toMatchObject({ repo: '/some/dir' });
  });

  it('accepts --context option', () => {
    const args = doctorCommand.parseArgs(['--file', PROCEDURE, '--context', CONTEXT]);
    expect(args).toMatchObject({ context: CONTEXT });
  });

  it('accepts --version option', () => {
    const args = doctorCommand.parseArgs(['--file', PROCEDURE, '--version', 'active']);
    expect(args).toMatchObject({ version: 'active' });
  });

  it('accepts --step-name and --sequence options', () => {
    const args = doctorCommand.parseArgs(['--file', PROCEDURE, '--step-name', 'AggregatePrice', '--sequence', '3']);
    expect(args).toMatchObject({ stepName: 'AggregatePrice', sequence: '3' });
  });

  it('throws when neither --file nor --repo provided', () => {
    expect(() => doctorCommand.parseArgs([])).toThrow(PricingCliError);
  });

  it('throws when both --file and --repo provided', () => {
    expect(() => doctorCommand.parseArgs(['--file', PROCEDURE, '--repo', '/dir'])).toThrow(PricingCliError);
  });

  it('throws on unknown flag', () => {
    expect(() => doctorCommand.parseArgs(['--file', PROCEDURE, '--bogus'])).toThrow(PricingCliError);
  });

  it('throws for --fail-on without value', () => {
    expect(() => doctorCommand.parseArgs(['--file', PROCEDURE, '--fail-on'])).toThrow(PricingCliError);
  });

  it('throws for invalid --fail-on value', () => {
    expect(() => doctorCommand.parseArgs(['--file', PROCEDURE, '--fail-on', 'invalid'])).toThrow(PricingCliError);
  });

  it('sourceFiles returns file and context paths', () => {
    const files = doctorCommand.sourceFiles(['--file', PROCEDURE, '--context', CONTEXT]);
    expect(files).toContain(PROCEDURE);
    expect(files).toContain(CONTEXT);
  });
});

// ---------------------------------------------------------------------------
// run — happy paths (lib/doctor — 844 LOC area)
// ---------------------------------------------------------------------------

describe('doctor run — happy paths', () => {
  it('returns ok or warn for a valid procedure file', () => {
    const envelope = runDoctor(['--file', PROCEDURE]);
    expect(['ok', 'warn']).toContain(envelope.status);
    assertPricingEnvelopeShape(envelope, 'doctor', envelope.status);
    expect(envelope.errors).toHaveLength(0);
  });

  it('result has checks array and readiness field', () => {
    const envelope = runDoctor(['--file', PROCEDURE]);
    const result = envelope.result as { checks: unknown[]; readiness: string };
    expect(Array.isArray(result.checks)).toBe(true);
    expect(typeof result.readiness).toBe('string');
  });

  it('each check has code, status, message fields', () => {
    const envelope = runDoctor(['--file', PROCEDURE]);
    const result = envelope.result as { checks: Array<{ code: string; status: string; message: string }> };
    for (const check of result.checks) {
      expect(typeof check.code).toBe('string');
      expect(typeof check.status).toBe('string');
      expect(typeof check.message).toBe('string');
    }
  });

  it('returns ok or warn with --version active', () => {
    const envelope = runDoctor(['--file', PROCEDURE, '--version', 'active']);
    expect(['ok', 'warn']).toContain(envelope.status);
  });

  it('returns ok or warn with --context companion file', () => {
    const envelope = runDoctor(['--file', PROCEDURE, '--context', CONTEXT, '--version', 'active']);
    expect(['ok', 'warn']).toContain(envelope.status);
    expect(envelope.errors).toHaveLength(0);
  });

  it('result has artifact_summary with version info', () => {
    const envelope = runDoctor(['--file', PROCEDURE, '--version', 'active']);
    const result = envelope.result as { artifact_summary: { path: string } | null };
    expect(result.artifact_summary).not.toBeNull();
    expect(typeof result.artifact_summary!.path).toBe('string');
  });

  it('result has candidate_commands list', () => {
    const envelope = runDoctor(['--file', PROCEDURE, '--version', 'active']);
    const result = envelope.result as { candidate_commands: string[] };
    expect(Array.isArray(result.candidate_commands)).toBe(true);
  });

  it('result check_counts has total field', () => {
    const envelope = runDoctor(['--file', PROCEDURE]);
    const result = envelope.result as { check_counts: { total: number } };
    expect(typeof result.check_counts.total).toBe('number');
    expect(result.check_counts.total).toBeGreaterThan(0);
  });

  it('validates a specific step-name selector', () => {
    const envelope = runDoctor(['--file', PROCEDURE, '--version', 'active', '--step-name', 'AggregatePrice']);
    expect(['ok', 'warn', 'no_match']).toContain(envelope.status);
    expect(envelope.errors).toHaveLength(0);
  });

  it('meta.source_files contains the procedure path', () => {
    const envelope = runDoctor(['--file', PROCEDURE]);
    expect(envelope.meta.source_files).toContain(PROCEDURE);
  });

  it('summary.primary_subject reflects the file path or artifact name', () => {
    const envelope = runDoctor(['--file', PROCEDURE]);
    expect(envelope.summary.primary_subject.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// run — error / edge paths
// ---------------------------------------------------------------------------

describe('doctor run — error paths', () => {
  // PINNED BEHAVIOR: runDoctor() wraps loadExpressionSet in try/catch for
  // the --file path.  A nonexistent file is recorded as a 'blocked' check
  // and the function returns an envelope with status=warn (NOT a throw).
  // This is consistent with doctor --repo behavior and different from other
  // commands (validate, inspect-step, crosswalk) which throw for missing files.
  it('returns status=warn with a blocked check when the --file path does not exist', () => {
    const envelope = runDoctor(['--file', '/nonexistent/proc.xml']);
    expect(envelope.status).toBe('warn');
    expect(envelope.errors).toHaveLength(0);
    const result = envelope.result as { checks: Array<{ code: string; status: string }> };
    const blockedCheck = result.checks.find((c) => c.status === 'blocked');
    expect(blockedCheck).toBeDefined();
  });

  // PINNED BEHAVIOR: doctor --repo with a nonexistent path returns status=warn
  // rather than throwing or returning status=error.  The repo scanning code
  // wraps the lstat call in try/catch and records a 'repo_scan_root_not_found'
  // warning check, giving the output a readiness=blocked or similar status.
  // This is notably different from discover --repo which throws.
  it('returns status=warn (not error/throw) for a nonexistent --repo path', () => {
    const envelope = runDoctor(['--repo', '/nonexistent/repo']);
    expect(envelope.status).toBe('warn');
    expect(envelope.errors).toHaveLength(0);
    // There should be checks or warnings that explain the issue
    const result = envelope.result as { checks: Array<{ code: string; status: string }> };
    const repoCheck = result.checks.find((c) => c.code.includes('repo_scan_root'));
    expect(repoCheck).toBeDefined();
  });
});
