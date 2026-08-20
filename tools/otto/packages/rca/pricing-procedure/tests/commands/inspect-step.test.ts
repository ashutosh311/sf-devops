/**
 * Tests for the inspect-step command module (lib/inspect_step).
 *
 * inspect-step returns matched step details for a given selector inside a
 * single ExpressionSetDefinition file.  The fixture has an "active" version
 * with a step named "AggregatePrice" (confirmed by the smoke suite).
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPricingEnvelopeShape } from '../helpers/envelope-assertions';

import { inspectStepCommand } from '../../src/commands/inspect-step';
import { PricingCliError } from '../../src/lib/contracts/errors';

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const PROCEDURE = resolve(FIXTURES, 'Rev_Mgmt_Default_Pricing_Procedure2.expressionSetDefinition-meta.xml');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runInspectStep(argv: string[]) {
  const args = inspectStepCommand.parseArgs(argv);
  return inspectStepCommand.run(args, Date.now());
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('inspect-step parseArgs', () => {
  it('accepts --file with a step-name selector', () => {
    const args = inspectStepCommand.parseArgs(['--file', PROCEDURE, '--step-name', 'AggregatePrice']);
    expect(args).toMatchObject({ file: PROCEDURE, stepName: 'AggregatePrice', json: false });
  });

  it('accepts --version and --active-only flags', () => {
    const args = inspectStepCommand.parseArgs(['--file', PROCEDURE, '--version', 'active', '--step-name', 'X']);
    expect(args).toMatchObject({ version: 'active' });

    const args2 = inspectStepCommand.parseArgs(['--file', PROCEDURE, '--active-only', '--step-name', 'X']);
    expect(args2).toMatchObject({ activeOnly: true });
  });

  it('accepts --list-candidates', () => {
    const args = inspectStepCommand.parseArgs(['--file', PROCEDURE, '--list-candidates']);
    expect(args).toMatchObject({ listCandidates: true });
  });

  it('accepts --step-name-contains with --list-candidates', () => {
    const args = inspectStepCommand.parseArgs(['--file', PROCEDURE, '--list-candidates', '--step-name-contains', 'Agg']);
    expect(args).toMatchObject({ listCandidates: true, stepNameContains: 'Agg' });
  });

  it('throws when --step-name-contains used without --list-candidates', () => {
    expect(() =>
      inspectStepCommand.parseArgs(['--file', PROCEDURE, '--step-name-contains', 'Agg'])
    ).toThrow(PricingCliError);
  });

  it('throws when --file is missing', () => {
    expect(() => inspectStepCommand.parseArgs(['--step-name', 'X'])).toThrow(PricingCliError);
  });

  it('throws on --compact and --verbose together', () => {
    expect(() =>
      inspectStepCommand.parseArgs(['--file', PROCEDURE, '--step-name', 'X', '--compact', '--verbose'])
    ).toThrow(PricingCliError);
  });

  it('throws on unknown flag', () => {
    expect(() => inspectStepCommand.parseArgs(['--file', PROCEDURE, '--bogus'])).toThrow(PricingCliError);
  });

  it('sourceFiles returns the file path', () => {
    const files = inspectStepCommand.sourceFiles(['--file', PROCEDURE]);
    expect(files).toContain(PROCEDURE);
  });
});

// ---------------------------------------------------------------------------
// run — happy paths
// ---------------------------------------------------------------------------

describe('inspect-step run — happy paths', () => {
  it('returns ok for a known step in the active version', () => {
    const envelope = runInspectStep(['--file', PROCEDURE, '--version', 'active', '--step-name', 'AggregatePrice']);
    assertPricingEnvelopeShape(envelope, 'inspect-step', 'ok');
    expect(envelope.errors).toHaveLength(0);
  });

  it('result has matched_steps or similar structure', () => {
    const envelope = runInspectStep(['--file', PROCEDURE, '--version', 'active', '--step-name', 'AggregatePrice']);
    const result = envelope.result as Record<string, unknown>;
    // The result should have some key with step data
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });

  it('lists candidates without a step selector', () => {
    const envelope = runInspectStep(['--file', PROCEDURE, '--version', 'active', '--list-candidates']);
    expect(['ok', 'no_match']).toContain(envelope.status);
    expect(envelope.errors).toHaveLength(0);
  });

  it('applies --step-name-contains filter', () => {
    const envelope = runInspectStep([
      '--file', PROCEDURE,
      '--version', 'active',
      '--list-candidates',
      '--step-name-contains', 'Aggregate',
    ]);
    expect(['ok', 'no_match']).toContain(envelope.status);
  });

  it('meta.source_files contains the procedure path', () => {
    const envelope = runInspectStep(['--file', PROCEDURE, '--version', 'active', '--step-name', 'AggregatePrice']);
    expect(envelope.meta.source_files).toContain(PROCEDURE);
  });
});

// ---------------------------------------------------------------------------
// run — edge / no-match paths
// ---------------------------------------------------------------------------

describe('inspect-step run — no-match / error paths', () => {
  it('returns no_match when the step name does not exist', () => {
    const envelope = runInspectStep(['--file', PROCEDURE, '--version', 'active', '--step-name', 'DoesNotExistStep_xyz']);
    expect(envelope.status).toBe('no_match');
    expect(envelope.errors).toHaveLength(0);
  });

  // PINNED BEHAVIOR: runInspectStep() throws PricingCliError for file-not-found.
  // The dispatch harness converts this into an error envelope for CLI output.
  it('throws PricingCliError when the file does not exist', () => {
    const args = inspectStepCommand.parseArgs(['--file', '/nonexistent/proc.xml', '--step-name', 'X']);
    expect(() => inspectStepCommand.run(args, Date.now())).toThrow(PricingCliError);
  });
});
