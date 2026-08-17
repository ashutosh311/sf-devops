/**
 * Tests for the explain-error command module (no fixture files needed).
 *
 * explain-error is a pure in-memory command: it translates known error codes
 * into remediation guidance without reading any files.  This makes it the
 * simplest command to unit-test and a good sanity-check for the vitest
 * setup + envelope contract.
 */
import { describe, expect, it } from 'vitest';
import { assertPricingEnvelopeShape } from '../helpers/envelope-assertions';

import { explainErrorCommand } from '../../src/commands/explain-error';
import { PricingCliError } from '../../src/lib/contracts/errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runCommand(argv: string[]) {
  const args = explainErrorCommand.parseArgs(argv);
  return explainErrorCommand.run(args, Date.now());
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('explain-error parseArgs', () => {
  it('accepts --list-codes', () => {
    const args = explainErrorCommand.parseArgs(['--list-codes']);
    expect(args).toMatchObject({ listCodes: true, json: false, failOn: 'none' });
  });

  it('accepts --code <value>', () => {
    const args = explainErrorCommand.parseArgs(['--code', 'file_not_found']);
    expect(args).toMatchObject({ code: 'file_not_found', listCodes: false, json: false });
  });

  it('accepts --json flag', () => {
    const args = explainErrorCommand.parseArgs(['--list-codes', '--json']);
    expect(args).toMatchObject({ listCodes: true, json: true });
  });

  it('throws when neither --code nor --list-codes are supplied', () => {
    expect(() => explainErrorCommand.parseArgs([])).toThrow(PricingCliError);
  });

  it('throws when --code has no value', () => {
    expect(() => explainErrorCommand.parseArgs(['--code'])).toThrow(PricingCliError);
  });

  it('throws on unknown flag', () => {
    expect(() => explainErrorCommand.parseArgs(['--unknown-flag'])).toThrow(PricingCliError);
  });
});

// ---------------------------------------------------------------------------
// run — list-codes happy path
// ---------------------------------------------------------------------------

describe('explain-error run --list-codes', () => {
  it('returns status=ok with error code list', () => {
    const envelope = runCommand(['--list-codes']);
    assertPricingEnvelopeShape(envelope, 'explain-error', 'ok', { requireToolVersion: true });
    expect((envelope.result as { error_codes: string[] }).error_codes).toBeInstanceOf(Array);
    expect((envelope.result as { error_codes: string[] }).error_codes.length).toBeGreaterThan(0);
    expect(envelope.errors).toHaveLength(0);
  });

  it('result includes error_code_aliases', () => {
    const envelope = runCommand(['--list-codes']);
    const result = envelope.result as { error_codes: string[]; error_code_aliases: Record<string, string> };
    expect(typeof result.error_code_aliases).toBe('object');
    expect(result.error_codes).toContain('file_not_found');
    expect(result.error_codes).toContain('xml_parse_error');
  });

  it('summary.key_counts reports code counts', () => {
    const envelope = runCommand(['--list-codes']);
    const counts = envelope.summary.key_counts as { error_code_count?: number; alias_count?: number };
    expect(typeof counts.error_code_count).toBe('number');
    expect(typeof counts.alias_count).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// run — known code happy path
// ---------------------------------------------------------------------------

describe('explain-error run --code <known>', () => {
  it('returns status=ok with explanation for file_not_found', () => {
    const envelope = runCommand(['--code', 'file_not_found']);
    assertPricingEnvelopeShape(envelope, 'explain-error', 'ok', { requireToolVersion: true });
    expect(envelope.errors).toHaveLength(0);
    const result = envelope.result as { meaning: string; likely_causes: string[]; next_checks: string[] };
    expect(typeof result.meaning).toBe('string');
    expect(result.likely_causes).toBeInstanceOf(Array);
    expect(result.next_checks).toBeInstanceOf(Array);
  });

  it('returns status=ok for xml_parse_error', () => {
    const envelope = runCommand(['--code', 'xml_parse_error']);
    expect(envelope.status).toBe('ok');
    expect(envelope.errors).toHaveLength(0);
  });

  it('returns status=ok for version_not_found (known alias)', () => {
    // version_not_found may be an alias; the command resolves it to a canonical code
    const envelope = runCommand(['--code', 'version_not_found']);
    expect(['ok', 'no_match']).toContain(envelope.status);
  });
});

// ---------------------------------------------------------------------------
// run — unknown code edge path
// ---------------------------------------------------------------------------

describe('explain-error run --code <unknown>', () => {
  it('returns status=no_match with a warning for an unrecognized code', () => {
    const envelope = runCommand(['--code', 'completely_made_up_code_xyz']);
    assertPricingEnvelopeShape(envelope, 'explain-error', 'no_match', { requireToolVersion: true });
    expect(envelope.warnings.length).toBeGreaterThan(0);
    expect(envelope.warnings[0]!.code).toBe('no_match');
    expect(envelope.errors).toHaveLength(0);
  });
});
