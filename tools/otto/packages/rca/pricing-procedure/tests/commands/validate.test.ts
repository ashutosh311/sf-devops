/**
 * Tests for the validate command module (lib/validate).
 *
 * validate checks structural/semantic sanity of a pricing-procedure file
 * and optionally cross-checks a companion ContextDefinition.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPricingEnvelopeShape } from '../helpers/envelope-assertions';

import { validateCommand } from '../../src/commands/validate';
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

function runValidate(argv: string[]) {
  const args = validateCommand.parseArgs(argv);
  return validateCommand.run(args, Date.now());
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('validate parseArgs', () => {
  it('accepts --file', () => {
    const args = validateCommand.parseArgs(['--file', PROCEDURE]);
    expect(args).toMatchObject({ file: PROCEDURE, json: false, failOn: 'warn' });
  });

  it('accepts --context option', () => {
    const args = validateCommand.parseArgs(['--file', PROCEDURE, '--context', CONTEXT]);
    expect(args).toMatchObject({ file: PROCEDURE, context: CONTEXT });
  });

  it('accepts --version option', () => {
    const args = validateCommand.parseArgs(['--file', PROCEDURE, '--version', 'active']);
    expect(args).toMatchObject({ version: 'active' });
  });

  it('accepts --fail-on option', () => {
    const args = validateCommand.parseArgs(['--file', PROCEDURE, '--fail-on', 'none']);
    expect(args).toMatchObject({ failOn: 'none' });
  });

  it('throws on unknown flag', () => {
    expect(() => validateCommand.parseArgs(['--file', PROCEDURE, '--bogus'])).toThrow(PricingCliError);
  });

  it('sourceFiles returns the file path', () => {
    const files = validateCommand.sourceFiles(['--file', PROCEDURE, '--context', CONTEXT]);
    expect(files).toContain(PROCEDURE);
    expect(files).toContain(CONTEXT);
  });
});

// ---------------------------------------------------------------------------
// run — happy paths
// ---------------------------------------------------------------------------

describe('validate run — happy paths', () => {
  it('returns status ok or warn for a valid procedure file', () => {
    const envelope = runValidate(['--file', PROCEDURE]);
    expect(['ok', 'warn']).toContain(envelope.status);
    assertPricingEnvelopeShape(envelope, 'validate', envelope.status);
    expect(envelope.errors).toHaveLength(0);
  });

  it('result has findings array', () => {
    const envelope = runValidate(['--file', PROCEDURE]);
    const result = envelope.result as { findings: unknown[] };
    expect(Array.isArray(result.findings)).toBe(true);
  });

  it('returns ok or warn with companion context file', () => {
    const envelope = runValidate(['--file', PROCEDURE, '--context', CONTEXT]);
    expect(['ok', 'warn']).toContain(envelope.status);
    expect(envelope.errors).toHaveLength(0);
  });

  it('meta.source_files contains the procedure path', () => {
    const envelope = runValidate(['--file', PROCEDURE]);
    expect(envelope.meta.source_files).toContain(PROCEDURE);
  });
});

// ---------------------------------------------------------------------------
// run — error paths
// ---------------------------------------------------------------------------

// PINNED BEHAVIOR: runValidate() throws PricingCliError for file-not-found
// rather than returning an error envelope.  The dispatch harness converts
// this throw into an error envelope for CLI output.
describe('validate run — error paths', () => {
  it('throws PricingCliError when the file does not exist', () => {
    const args = validateCommand.parseArgs(['--file', '/nonexistent/proc.xml']);
    expect(() => validateCommand.run(args, Date.now())).toThrow(PricingCliError);
  });
});
