import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  executeInspectRlmContext,
  getDefaultInspectRlmContextFixturePath
} from '../../src/primitives/inspect-rlm-context';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/primitives/inspect-rlm-context');
const summaryFixture = JSON.parse(
  readFileSync(resolve(fixturesDir, 'rlm-sales-transaction-context-summary.json'), 'utf8')
) as Record<string, unknown>;

describe('inspect-rlm-context primitive', () => {
  it('returns the locked summary-first RLM context bridge shape from the authoritative fixture', async () => {
    const result = await executeInspectRlmContext({
      orgAlias: 'ARM'
    });

    expect(result.status).toBe('ok');
    expect(result.status_detail).toBe('fixture_loaded');
    expect(result.result).toMatchObject(summaryFixture);
    expect(result.result.context_artifact).toMatchObject({
      name: 'RLM_SalesTransactionContext',
      source: 'fixture'
    });
    expect(result.result.context_artifact.last_modified).toEqual(expect.any(String));
    expect(result.result.relevant_mappings).toHaveLength(5);
    expect(result.result.relevant_mappings.map((mapping) => mapping.mapping_name)).toEqual([
      'QuoteEntitiesMapping -> SalesTransaction -> Quote',
      'QuoteEntitiesMapping -> SalesTransactionAction -> QuoteAction',
      'QuoteEntitiesMapping -> SalesTransactionItem -> QuoteLineItem',
      'QuoteEntitiesMapping -> SalesTransactionItemDetail -> QuoteLineDetail',
      'QuoteEntitiesMapping -> SalesTrxnItemRelationship -> QuoteLineRelationship'
    ]);
    expect(result.result.bridge_summary.limitations).toHaveLength(3);
    expect(result.result.open_questions).toHaveLength(4);
    expect(result.evidence).toMatchObject([
      {
        evidence_level: 'documented'
      },
      {
        evidence_level: 'repo_proven'
      }
    ]);
    expect(result.source_files).toEqual([getDefaultInspectRlmContextFixturePath()]);
    expect(Object.keys(result.result)).toEqual([
      'context_artifact',
      'relevant_mappings',
      'bridge_summary',
      'open_questions'
    ]);
    expect(JSON.stringify(result.result)).not.toContain('<ContextDefinition');
    expect(JSON.stringify(result.result)).not.toContain('contextDefinition-meta.xml');
  });

  it('returns unsupported when the primary normalized summary artifact is missing or unreadable', async () => {
    const result = await executeInspectRlmContext({
      orgAlias: 'ARM',
      fixturePath: resolve(fixturesDir, 'missing-summary.json')
    });

    expect(result.status).toBe('unsupported');
    expect(result.status_detail).toBe('primary_artifact_unreadable');
    expect(result.result).toEqual({
      context_artifact: {
        name: 'RLM_SalesTransactionContext',
        source: 'fixture'
      },
      relevant_mappings: [],
      bridge_summary: {
        primary_bridge: '',
        quote_header_mapping: '',
        quote_line_mapping: '',
        lifecycle_mapping: '',
        waterfall_mapping: '',
        limitations: []
      },
      open_questions: []
    });
    expect(result.errors[0]).toContain('Unable to read primary RLM context artifact');
  });

  it('treats invalid fixture payloads as unreadable primary artifacts and does not emit raw fallback data', async () => {
    const result = await executeInspectRlmContext({
      orgAlias: 'ARM',
      fixturePath: resolve(fixturesDir, 'invalid-summary.json'),
      readFile: vi.fn(async () => '{"context_artifact":{"name":"RLM_SalesTransactionContext","source":"fixture"}}'),
      stat: vi.fn(async () => ({ mtime: new Date('2026-04-15T12:00:00.000Z') } as { mtime: Date }))
    });

    expect(result.status).toBe('unsupported');
    expect(result.errors[0]).toContain('Unable to read primary RLM context artifact');
    expect(JSON.stringify(result.result)).not.toContain('raw_xml');
    expect(JSON.stringify(result.result)).not.toContain('<xml');
    expect(result.result.bridge_summary).toEqual({
      primary_bridge: '',
      quote_header_mapping: '',
      quote_line_mapping: '',
      lifecycle_mapping: '',
      waterfall_mapping: '',
      limitations: []
    });
    expect(result.result.open_questions).toEqual([]);
  });
});
