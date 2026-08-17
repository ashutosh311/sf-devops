/**
 * Envelope assertion helpers. Plain functions — no test-framework dependency.
 * Uses node:assert/strict which throws AssertionError (a subclass of Error) on
 * failure.  Works from compiled node scripts (sfx hand-rolled asserters) and
 * from vitest tests alike.
 */
import { strict as nodeAssert } from 'node:assert';

/**
 * Options for assertPricingEnvelopeShape.
 */
export interface PricingEnvelopeShapeOptions {
  /**
   * When true, assert that envelope.meta.tool_version is a string.
   * Only a subset of pricing-procedure commands emit tool_version in meta;
   * default is false so the assertion stays universally applicable.
   */
  requireToolVersion?: boolean;
}

/**
 * Assert that an object satisfies the common shape of a pricing-procedure-cli
 * command envelope:
 *   - command: string (must equal the provided command name)
 *   - status:  string (must equal the provided status)
 *   - summary: { primary_subject: string, status_reason: string }
 *   - errors:  array
 *   - warnings: array
 *   - evidence: array
 *   - meta: { source_files: array }
 *
 * This helper replaces the local `envelopeShape()` function that was duplicated
 * across every pricing-procedure vitest test file.  It can be called from
 * inside a vitest `it()` block — a thrown AssertionError is caught by vitest
 * and reported as a test failure just like any other assertion.
 *
 * It does NOT check result payload contents or meta.tool_version by default
 * (pass `{ requireToolVersion: true }` to enable that check).  Add command-
 * specific vitest assertions after this call for deeper coverage.
 */
export function assertPricingEnvelopeShape(
  envelope: unknown,
  command: string,
  status: string,
  options?: PricingEnvelopeShapeOptions,
): void {
  nodeAssert(
    envelope !== null && typeof envelope === 'object',
    'envelope must be a non-null object',
  );
  const e = envelope as Record<string, unknown>;

  nodeAssert.equal(e['command'], command, `envelope.command must equal '${command}'`);
  nodeAssert.equal(e['status'], status, `envelope.status must equal '${status}'`);

  const summary = e['summary'];
  nodeAssert(
    summary !== null && typeof summary === 'object',
    'envelope.summary must be a non-null object with primary_subject and status_reason',
  );
  const s = summary as Record<string, unknown>;
  nodeAssert(
    typeof s['primary_subject'] === 'string',
    'envelope.summary.primary_subject must be a string',
  );
  nodeAssert(
    typeof s['status_reason'] === 'string',
    'envelope.summary.status_reason must be a string',
  );

  nodeAssert(Array.isArray(e['errors']), 'envelope.errors must be an array');
  nodeAssert(Array.isArray(e['warnings']), 'envelope.warnings must be an array');
  nodeAssert(Array.isArray(e['evidence']), 'envelope.evidence must be an array');

  const meta = e['meta'];
  nodeAssert(
    meta !== null && typeof meta === 'object',
    'envelope.meta must be a non-null object',
  );
  const m = meta as Record<string, unknown>;
  nodeAssert(
    Array.isArray(m['source_files']),
    'envelope.meta.source_files must be an array',
  );

  if (options?.requireToolVersion) {
    nodeAssert(
      typeof m['tool_version'] === 'string',
      'envelope.meta.tool_version must be a string',
    );
  }
}
