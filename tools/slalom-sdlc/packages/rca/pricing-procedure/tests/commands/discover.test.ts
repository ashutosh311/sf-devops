/**
 * Tests for the discover command module (lib/discover).
 *
 * discover reads an ExpressionSetDefinition XML file and returns
 * classification + version/step inventory.  Tests use the existing
 * smoke fixture so no handcrafted XML is needed.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPricingEnvelopeShape } from '../helpers/envelope-assertions';

import { discoverCommand } from '../../src/commands/discover';
import { PricingCliError } from '../../src/lib/contracts/errors';

// ---------------------------------------------------------------------------
// Fixture paths (reuse the smoke-suite assets)
// ---------------------------------------------------------------------------

const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const PROCEDURE = resolve(FIXTURES, 'Rev_Mgmt_Default_Pricing_Procedure2.expressionSetDefinition-meta.xml');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runDiscover(argv: string[]) {
  const args = discoverCommand.parseArgs(argv);
  return discoverCommand.run(args, Date.now());
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('discover parseArgs', () => {
  it('accepts --file', () => {
    const args = discoverCommand.parseArgs(['--file', PROCEDURE]);
    expect(args).toMatchObject({ file: PROCEDURE, json: false, failOn: 'unsupported' });
  });

  it('accepts --repo', () => {
    const args = discoverCommand.parseArgs(['--repo', '/some/dir']);
    expect(args).toMatchObject({ repo: '/some/dir' });
  });

  it('accepts optional filters', () => {
    const args = discoverCommand.parseArgs(['--file', PROCEDURE, '--version', 'active', '--step-name', 'AggregatePrice', '--json']);
    expect(args).toMatchObject({ version: 'active', stepName: 'AggregatePrice', json: true });
  });

  it('throws when neither --file nor --repo supplied', () => {
    expect(() => discoverCommand.parseArgs([])).toThrow(PricingCliError);
  });

  it('throws when both --file and --repo supplied', () => {
    expect(() => discoverCommand.parseArgs(['--file', PROCEDURE, '--repo', '/dir'])).toThrow(PricingCliError);
  });

  it('throws on unknown flag', () => {
    expect(() => discoverCommand.parseArgs(['--file', PROCEDURE, '--unknown'])).toThrow(PricingCliError);
  });

  it('sourceFiles returns the file path', () => {
    const files = discoverCommand.sourceFiles(['--file', PROCEDURE]);
    expect(files).toContain(PROCEDURE);
  });
});

// ---------------------------------------------------------------------------
// run — happy paths
// ---------------------------------------------------------------------------

describe('discover run — file mode', () => {
  it('returns status=ok for a valid procedure file', () => {
    const envelope = runDiscover(['--file', PROCEDURE]);
    assertPricingEnvelopeShape(envelope, 'discover', 'ok', { requireToolVersion: true });
    expect(envelope.errors).toHaveLength(0);
  });

  it('result carries mode=file and at least one artifact', () => {
    const envelope = runDiscover(['--file', PROCEDURE]);
    const result = envelope.result as { mode: string; artifacts: unknown[] };
    expect(result.mode).toBe('file');
    expect(result.artifacts.length).toBeGreaterThan(0);
  });

  it('artifact is classified as a pricing procedure', () => {
    const envelope = runDiscover(['--file', PROCEDURE]);
    const result = envelope.result as { artifacts: Array<{ is_pricing_procedure?: boolean }> };
    expect(result.artifacts[0]!.is_pricing_procedure).toBe(true);
  });

  it('applies --version filter and returns matching version', () => {
    const envelope = runDiscover(['--file', PROCEDURE, '--version', 'active']);
    expect(envelope.status).toBe('ok');
    // The active version exists in the fixture; the artifact list should still return
    const result = envelope.result as { artifacts: unknown[] };
    expect(result.artifacts.length).toBeGreaterThan(0);
  });

  it('applies --step-name filter without error', () => {
    const envelope = runDiscover(['--file', PROCEDURE, '--version', 'active', '--step-name', 'AggregatePrice']);
    expect(['ok', 'no_match']).toContain(envelope.status);
  });

  it('meta.source_files contains the procedure path', () => {
    const envelope = runDiscover(['--file', PROCEDURE]);
    expect(envelope.meta.source_files).toContain(PROCEDURE);
  });
});

// ---------------------------------------------------------------------------
// run — error / edge paths
// ---------------------------------------------------------------------------

// PINNED BEHAVIOR: runDiscover() throws PricingCliError for file-not-found
// rather than returning an error envelope.  The dispatch harness (runDispatch)
// converts this into an error envelope for CLI output.  Callers invoking
// run() directly must handle this throw.
describe('discover run — error paths', () => {
  it('throws PricingCliError when the --file path does not exist', () => {
    const args = discoverCommand.parseArgs(['--file', '/nonexistent/does-not-exist.xml']);
    expect(() => discoverCommand.run(args, Date.now())).toThrow(PricingCliError);
  });

  it('thrown error has a code field', () => {
    const args = discoverCommand.parseArgs(['--file', '/nonexistent/does-not-exist.xml']);
    try {
      discoverCommand.run(args, Date.now());
    } catch (error) {
      expect(error).toBeInstanceOf(PricingCliError);
      expect(typeof (error as PricingCliError).code).toBe('string');
    }
  });

  it('throws PricingCliError for a nonexistent --repo path', () => {
    const args = discoverCommand.parseArgs(['--repo', '/nonexistent/repo']);
    expect(() => discoverCommand.run(args, Date.now())).toThrow(PricingCliError);
  });
});
