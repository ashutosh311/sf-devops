import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseEnvelope, makeEnvelope, normalizeStatus, exitCodeForStatus, renderEnvelopeJson, writeEnvelopeJson } from '../../src/contracts/result-envelope';
import type { RuntimeStatus } from '../../src/contracts/status';

type MinimalEnvelopeFixture = ReturnType<typeof parseFixture>;

const fixturePath = resolve(import.meta.dirname, '../fixtures/contracts/minimal-envelope.json');

function parseFixture() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

describe('result-envelope contracts', () => {
  it('parses the canonical minimal envelope fixture', () => {
    const fixture = parseFixture();

    expect(parseEnvelope(fixture)).toEqual(fixture);
  });

  it('requires every locked top-level envelope field', () => {
    const fixture = parseFixture();
    const requiredFields = [
      'schema_version',
      'command',
      'status',
      'summary',
      'result',
      'warnings',
      'errors',
      'evidence',
      'meta'
    ] as const;

    for (const field of requiredFields) {
      const candidate: Partial<MinimalEnvelopeFixture> & Record<string, unknown> = { ...fixture };
      delete candidate[field];

      expect(() => parseEnvelope(candidate), field).toThrow(new RegExp(field, 'i'));
    }
  });

  it('requires evidence at the top level even when it is empty', () => {
    const fixture = parseFixture();

    expect(parseEnvelope({ ...fixture, evidence: [] }).evidence).toEqual([]);
    expect(() => parseEnvelope({ ...fixture, evidence: undefined })).toThrow(/evidence/i);
  });

  it('rejects unknown envelope keys', () => {
    const fixture = parseFixture();

    expect(() => parseEnvelope({ ...fixture, extra: 'nope' })).toThrow(/unrecognized key/i);
    expect(() => parseEnvelope({ ...fixture, meta: { ...fixture.meta, extra: 'nope' } })).toThrow(/unrecognized key/i);
  });

  it('rejects non-json-safe values in summary and result', () => {
    const fixture = parseFixture();

    expect(() => parseEnvelope({ ...fixture, summary: { keep: 1, drop: undefined } })).toThrow();
    expect(() => parseEnvelope({ ...fixture, result: { fn: () => 1 } })).toThrow();
  });

  it('builds envelopes with the locked schema version and canonical defaults', () => {
    const envelope = makeEnvelope({
      command: 'doctor',
      status: 'warn',
      summary: { status_reason: 'Missing org alias.' },
      result: { missing_requirements: ['org alias'] },
      meta: {
        org_alias: 'ARM',
        generated_at: '2026-04-14T00:00:00Z',
        duration_ms: 15
      }
    });

    expect(envelope).toMatchObject({
      schema_version: '1.0.0',
      command: 'doctor',
      status: 'warn',
      warnings: [],
      errors: [],
      evidence: [],
      meta: {
        org_alias: 'ARM',
        generated_at: '2026-04-14T00:00:00Z',
        duration_ms: 15,
        source_files: []
      }
    });
  });

  it('normalizes only locked runtime statuses', () => {
    const statuses: RuntimeStatus[] = ['ok', 'warn', 'error', 'partial', 'changed', 'no_change', 'no_match', 'unsupported'];

    for (const status of statuses) {
      expect(normalizeStatus(status)).toBe(status);
    }

    expect(() => normalizeStatus('OK')).toThrow(/status/i);
  });

  it('maps status thresholds to exit codes', () => {
    expect(exitCodeForStatus('ok', 'none')).toBe(0);
    expect(exitCodeForStatus('warn', 'warn')).toBe(1);
    expect(exitCodeForStatus('changed', 'warn')).toBe(0);
    expect(exitCodeForStatus('error', 'error')).toBe(1);
  });

  it('renders and writes the canonical envelope JSON payload', () => {
    const fixture = parseFixture();
    const outputDir = mkdtempSync(join(tmpdir(), 'quote-runtime-envelope-'));
    const outputPath = join(outputDir, 'envelope.json');

    const rendered = renderEnvelopeJson(fixture);
    writeEnvelopeJson(outputPath, fixture);

    expect(rendered.endsWith('\n')).toBe(true);
    expect(JSON.parse(rendered)).toEqual(fixture);
    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(fixture);
  });
});
