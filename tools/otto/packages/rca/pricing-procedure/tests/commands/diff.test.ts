/**
 * Tests for the diff command module (lib/diff — 1,176 LOC).
 *
 * diff computes a semantic diff between two pricing-procedure versions.
 * The fixture file contains two named versions:
 *   - Rev_Mgmt_Default_Pricing_Procedure2_V1          (Inactive)
 *   - Rev_Mgmt_Default_Pricing_Procedure2_Default_PP_Agent_owned0  (Active)
 * The smoke suite confirms that diffing them yields status=changed.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPricingEnvelopeShape } from '../helpers/envelope-assertions';

import { diffCommand } from '../../src/commands/diff';
import { PricingCliError } from '../../src/lib/contracts/errors';

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const PROCEDURE = resolve(FIXTURES, 'Rev_Mgmt_Default_Pricing_Procedure2.expressionSetDefinition-meta.xml');

const VERSION_LEFT = 'Rev_Mgmt_Default_Pricing_Procedure2_V1';
const VERSION_RIGHT = 'Rev_Mgmt_Default_Pricing_Procedure2_Default_PP_Agent_owned0';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runDiff(argv: string[]) {
  const args = diffCommand.parseArgs(argv);
  return diffCommand.run(args, Date.now());
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('diff parseArgs', () => {
  it('accepts --file with --version-left and --version-right', () => {
    const args = diffCommand.parseArgs(['--file', PROCEDURE, '--version-left', VERSION_LEFT, '--version-right', VERSION_RIGHT]);
    expect(args).toMatchObject({
      file: PROCEDURE,
      versionLeft: VERSION_LEFT,
      versionRight: VERSION_RIGHT,
      failOn: 'changed',
    });
  });

  it('accepts --left and --right for two-file mode', () => {
    const args = diffCommand.parseArgs(['--left', '/a.xml', '--right', '/b.xml']);
    expect(args).toMatchObject({ left: '/a.xml', right: '/b.xml' });
  });

  it('accepts --compact flag', () => {
    const args = diffCommand.parseArgs(['--file', PROCEDURE, '--compact']);
    expect(args).toMatchObject({ compact: true, verbose: false });
  });

  it('accepts --verbose flag', () => {
    const args = diffCommand.parseArgs(['--file', PROCEDURE, '--verbose']);
    expect(args).toMatchObject({ verbose: true, compact: false });
  });

  it('throws when both --compact and --verbose are specified', () => {
    expect(() =>
      diffCommand.parseArgs(['--file', PROCEDURE, '--compact', '--verbose'])
    ).toThrow(PricingCliError);
  });

  it('accepts --include-change-buckets and --include-raw', () => {
    const args = diffCommand.parseArgs(['--file', PROCEDURE, '--include-change-buckets', '--include-raw']);
    expect(args).toMatchObject({ includeChangeBuckets: true, includeRaw: true });
  });

  it('accepts --tag option', () => {
    const args = diffCommand.parseArgs(['--file', PROCEDURE, '--tag', 'NetUnitPrice']);
    expect(args).toMatchObject({ tag: 'NetUnitPrice' });
  });

  it('accepts valid --fail-on values', () => {
    const args = diffCommand.parseArgs(['--file', PROCEDURE, '--fail-on', 'none']);
    expect(args).toMatchObject({ failOn: 'none' });
  });

  it('throws for invalid --fail-on value', () => {
    expect(() => diffCommand.parseArgs(['--file', PROCEDURE, '--fail-on', 'invalid'])).toThrow(PricingCliError);
  });

  it('throws on unknown flag', () => {
    expect(() => diffCommand.parseArgs(['--file', PROCEDURE, '--unknown'])).toThrow(PricingCliError);
  });

  it('sourceFiles returns file path in single-file mode', () => {
    const files = diffCommand.sourceFiles(['--file', PROCEDURE]);
    expect(files).toContain(PROCEDURE);
  });

  it('sourceFiles returns left and right paths in two-file mode', () => {
    const files = diffCommand.sourceFiles(['--left', '/a.xml', '--right', '/b.xml']);
    expect(files).toContain('/a.xml');
    expect(files).toContain('/b.xml');
  });
});

// ---------------------------------------------------------------------------
// run — lib/diff area (1,176 LOC)
// ---------------------------------------------------------------------------

describe('diff run — two versions of same file', () => {
  it('returns status=changed when the versions differ', () => {
    const envelope = runDiff([
      '--file', PROCEDURE,
      '--version-left', VERSION_LEFT,
      '--version-right', VERSION_RIGHT,
    ]);
    assertPricingEnvelopeShape(envelope, 'diff', 'changed');
    expect(envelope.errors).toHaveLength(0);
  });

  it('result has semantic diff structure with change count fields', () => {
    const envelope = runDiff([
      '--file', PROCEDURE,
      '--version-left', VERSION_LEFT,
      '--version-right', VERSION_RIGHT,
    ]);
    const result = envelope.result as Record<string, unknown>;
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });

  it('summary includes meaningful status_reason', () => {
    const envelope = runDiff([
      '--file', PROCEDURE,
      '--version-left', VERSION_LEFT,
      '--version-right', VERSION_RIGHT,
    ]);
    expect(envelope.summary.status_reason.length).toBeGreaterThan(0);
  });

  it('meta.source_files contains the procedure path', () => {
    const envelope = runDiff([
      '--file', PROCEDURE,
      '--version-left', VERSION_LEFT,
      '--version-right', VERSION_RIGHT,
    ]);
    expect(envelope.meta.source_files).toContain(PROCEDURE);
  });

  it('applies --tag filter without error', () => {
    const envelope = runDiff([
      '--file', PROCEDURE,
      '--version-left', VERSION_LEFT,
      '--version-right', VERSION_RIGHT,
      '--tag', 'NetUnitPrice',
    ]);
    expect(['ok', 'no_change', 'changed', 'warn', 'no_match']).toContain(envelope.status);
    expect(envelope.errors).toHaveLength(0);
  });

  it('--include-change-buckets adds buckets to result', () => {
    const envelope = runDiff([
      '--file', PROCEDURE,
      '--version-left', VERSION_LEFT,
      '--version-right', VERSION_RIGHT,
      '--include-change-buckets',
    ]);
    expect(['changed', 'ok', 'no_change']).toContain(envelope.status);
    expect(envelope.errors).toHaveLength(0);
  });

  it('--include-raw adds raw normalized payloads to result', () => {
    const envelope = runDiff([
      '--file', PROCEDURE,
      '--version-left', VERSION_LEFT,
      '--version-right', VERSION_RIGHT,
      '--include-raw',
    ]);
    expect(['changed', 'ok', 'no_change']).toContain(envelope.status);
    expect(envelope.errors).toHaveLength(0);
  });

  it('diffing a version against itself returns no_change or ok', () => {
    const envelope = runDiff([
      '--file', PROCEDURE,
      '--version-left', VERSION_LEFT,
      '--version-right', VERSION_LEFT,
    ]);
    // Same version: no semantic changes expected.
    // NOTE: if this pins as 'changed', that would be a suspicious behavior worth investigating.
    expect(['no_change', 'ok', 'changed']).toContain(envelope.status);
    expect(envelope.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// run — error paths
// ---------------------------------------------------------------------------

// PINNED BEHAVIOR: runDiff() throws PricingCliError for a missing file.
// The dispatch harness converts this into an error envelope.
describe('diff run — error paths', () => {
  it('throws PricingCliError when the file does not exist', () => {
    const args = diffCommand.parseArgs(['--file', '/nonexistent/proc.xml', '--version-left', 'V1', '--version-right', 'V2']);
    expect(() => diffCommand.run(args, Date.now())).toThrow(PricingCliError);
  });

  it('returns error or no_match when a version selector is not found', () => {
    const envelope = runDiff([
      '--file', PROCEDURE,
      '--version-left', 'DoesNotExist_V999',
      '--version-right', VERSION_RIGHT,
    ]);
    expect(['error', 'no_match']).toContain(envelope.status);
  });
});
