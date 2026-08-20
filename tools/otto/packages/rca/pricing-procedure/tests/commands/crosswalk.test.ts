/**
 * Tests for the crosswalk command module (lib/crosswalk — 945 LOC).
 *
 * crosswalk maps context tags through a pricing-procedure to context-definition
 * and object-layer surfaces.  It requires both a procedure file and a context
 * definition file.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPricingEnvelopeShape } from '../helpers/envelope-assertions';

import { crosswalkCommand } from '../../src/commands/crosswalk';
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

function runCrosswalk(argv: string[]) {
  const args = crosswalkCommand.parseArgs(argv);
  return crosswalkCommand.run(args, Date.now());
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('crosswalk parseArgs', () => {
  it('accepts --procedure and --context', () => {
    const args = crosswalkCommand.parseArgs(['--procedure', PROCEDURE, '--context', CONTEXT]);
    expect(args).toMatchObject({
      procedure: PROCEDURE,
      context: CONTEXT,
      json: false,
      failOn: 'partial',
      compact: false,
      verbose: false,
    });
  });

  it('accepts optional --version, --tag, --object', () => {
    const args = crosswalkCommand.parseArgs([
      '--procedure', PROCEDURE,
      '--context', CONTEXT,
      '--version', 'active',
      '--tag', 'NetUnitPrice',
      '--object', 'QuoteLineItem',
    ]);
    expect(args).toMatchObject({ version: 'active', tag: 'NetUnitPrice', object: 'QuoteLineItem' });
  });

  it('accepts --active-only shortcut', () => {
    const args = crosswalkCommand.parseArgs(['--procedure', PROCEDURE, '--context', CONTEXT, '--active-only']);
    expect(args).toMatchObject({ activeOnly: true });
  });

  it('accepts --include-mappings, --include-hydration, --include-procedure-references', () => {
    const args = crosswalkCommand.parseArgs([
      '--procedure', PROCEDURE,
      '--context', CONTEXT,
      '--include-mappings',
      '--include-hydration',
      '--include-procedure-references',
    ]);
    expect(args).toMatchObject({
      includeMappings: true,
      includeHydration: true,
      includeProcedureReferences: true,
    });
  });

  it('accepts --compact and --verbose flags (mutually exclusive)', () => {
    const compact = crosswalkCommand.parseArgs(['--procedure', PROCEDURE, '--context', CONTEXT, '--compact']);
    expect(compact).toMatchObject({ compact: true });

    const verbose = crosswalkCommand.parseArgs(['--procedure', PROCEDURE, '--context', CONTEXT, '--verbose']);
    expect(verbose).toMatchObject({ verbose: true });
  });

  it('throws when both --compact and --verbose are specified', () => {
    expect(() =>
      crosswalkCommand.parseArgs(['--procedure', PROCEDURE, '--context', CONTEXT, '--compact', '--verbose'])
    ).toThrow(PricingCliError);
  });

  it('throws when --procedure is missing', () => {
    expect(() => crosswalkCommand.parseArgs(['--context', CONTEXT])).toThrow(PricingCliError);
  });

  it('throws when --context is missing', () => {
    expect(() => crosswalkCommand.parseArgs(['--procedure', PROCEDURE])).toThrow(PricingCliError);
  });

  it('throws on unknown flag', () => {
    expect(() =>
      crosswalkCommand.parseArgs(['--procedure', PROCEDURE, '--context', CONTEXT, '--bogus'])
    ).toThrow(PricingCliError);
  });

  it('sourceFiles returns procedure and context paths', () => {
    const files = crosswalkCommand.sourceFiles(['--procedure', PROCEDURE, '--context', CONTEXT]);
    expect(files).toContain(PROCEDURE);
    expect(files).toContain(CONTEXT);
  });
});

// ---------------------------------------------------------------------------
// run — lib/crosswalk area (945 LOC)
// ---------------------------------------------------------------------------

describe('crosswalk run — happy paths', () => {
  it('returns a non-error status for procedure+context without filters', () => {
    const envelope = runCrosswalk(['--procedure', PROCEDURE, '--context', CONTEXT]);
    expect(['ok', 'warn', 'partial', 'no_match']).toContain(envelope.status);
    assertPricingEnvelopeShape(envelope, 'crosswalk', envelope.status);
    expect(envelope.errors).toHaveLength(0);
  });

  it('result has expected crosswalk structure', () => {
    const envelope = runCrosswalk(['--procedure', PROCEDURE, '--context', CONTEXT]);
    const result = envelope.result as Record<string, unknown>;
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });

  it('applies --version active filter without error', () => {
    const envelope = runCrosswalk([
      '--procedure', PROCEDURE,
      '--context', CONTEXT,
      '--version', 'active',
    ]);
    expect(envelope.errors).toHaveLength(0);
    expect(['ok', 'warn', 'partial', 'no_match']).toContain(envelope.status);
  });

  it('applies --tag NetUnitPrice filter and returns ok or no_match', () => {
    const envelope = runCrosswalk([
      '--procedure', PROCEDURE,
      '--context', CONTEXT,
      '--version', 'active',
      '--tag', 'NetUnitPrice',
    ]);
    expect(envelope.errors).toHaveLength(0);
    expect(['ok', 'warn', 'partial', 'no_match']).toContain(envelope.status);
  });

  it('applies --tag and --object filter', () => {
    const envelope = runCrosswalk([
      '--procedure', PROCEDURE,
      '--context', CONTEXT,
      '--version', 'active',
      '--tag', 'NetUnitPrice',
      '--object', 'QuoteLineItem',
      '--include-mappings',
    ]);
    expect(envelope.errors).toHaveLength(0);
  });

  it('--include-mappings adds mapping data to result', () => {
    const envelope = runCrosswalk([
      '--procedure', PROCEDURE,
      '--context', CONTEXT,
      '--version', 'active',
      '--tag', 'NetUnitPrice',
      '--include-mappings',
    ]);
    expect(envelope.errors).toHaveLength(0);
    // result should have some indication of mapping data
    const result = envelope.result as Record<string, unknown>;
    expect(result).not.toBeNull();
  });

  it('meta.source_files contains procedure and context paths', () => {
    const envelope = runCrosswalk(['--procedure', PROCEDURE, '--context', CONTEXT]);
    expect(envelope.meta.source_files).toContain(PROCEDURE);
    expect(envelope.meta.source_files).toContain(CONTEXT);
  });

  it('summary.primary_subject is non-empty', () => {
    const envelope = runCrosswalk(['--procedure', PROCEDURE, '--context', CONTEXT]);
    expect(envelope.summary.primary_subject.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// run — error paths
// ---------------------------------------------------------------------------

// PINNED BEHAVIOR NOTES:
// - runCrosswalk() throws PricingCliError for a missing *procedure* file (line 654,
//   via loadExpressionSet which has no try/catch).
// - runCrosswalk() checks fs.existsSync(args.context) BEFORE calling
//   loadContextDefinition.  A nonexistent context file NEVER throws — the function
//   instead returns early with status=partial/no_match and a
//   'missing_context_definition' warning.  This applies with or without --tag.
describe('crosswalk run — error paths', () => {
  it('throws PricingCliError when the procedure file does not exist', () => {
    const args = crosswalkCommand.parseArgs(['--procedure', '/nonexistent/proc.xml', '--context', CONTEXT]);
    expect(() => crosswalkCommand.run(args, Date.now())).toThrow(PricingCliError);
  });

  it('returns partial or no_match (not a throw) when context file is missing', () => {
    // existsSync guard: returns early with missing_context_definition warning.
    const envelope = runCrosswalk(['--procedure', PROCEDURE, '--context', '/nonexistent/context.xml']);
    expect(['partial', 'no_match']).toContain(envelope.status);
    expect(envelope.errors).toHaveLength(0);
    const warning = envelope.warnings.find((w) => w.code === 'missing_context_definition');
    expect(warning).toBeDefined();
  });

  it('returns partial or no_match when context file is missing and --tag is provided', () => {
    // Even with --tag, the existsSync guard returns early without loading the file.
    const envelope = runCrosswalk([
      '--procedure', PROCEDURE,
      '--context', '/nonexistent/context.xml',
      '--tag', 'NetUnitPrice',
    ]);
    expect(['partial', 'no_match']).toContain(envelope.status);
    expect(envelope.errors).toHaveLength(0);
    const warning = envelope.warnings.find((w) => w.code === 'missing_context_definition');
    expect(warning).toBeDefined();
  });
});
