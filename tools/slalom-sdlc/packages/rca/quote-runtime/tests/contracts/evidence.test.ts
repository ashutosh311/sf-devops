import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_LEVELS,
  evidenceItemSchema,
  evidenceListSchema,
  isEvidenceItem,
  parseEvidenceItem,
  parseEvidenceList,
  type EvidenceItem
} from '../../src/contracts/evidence';

describe('evidence contracts', () => {
  const validEvidence = {
    claim: 'QuoteAction proves amendment provenance for the targeted line.',
    evidence_level: 'org_proven',
    proof_source: ['QuoteLineItem.QuoteActionId', 'QuoteAction.Type', 'QuoteAction.SourceAssetId'],
    limitations: 'Only amendment is org-proven in current ARM data.',
    source_refs: []
  } satisfies EvidenceItem;

  it('locks the shared evidence item shape', () => {
    expect(evidenceItemSchema.parse(validEvidence)).toEqual(validEvidence);
  });

  it('locks the supported evidence levels', () => {
    expect(EVIDENCE_LEVELS).toEqual(['documented', 'repo_proven', 'org_proven', 'inferred', 'unknown']);
  });

  it('parses evidence lists using the canonical item schema', () => {
    expect(evidenceListSchema.parse([validEvidence])).toEqual([validEvidence]);
    expect(parseEvidenceList([validEvidence])).toEqual([validEvidence]);
  });

  it('requires every evidence field in the canonical contract', () => {
    expect(() => parseEvidenceItem({ ...validEvidence, claim: '' })).toThrow(/claim/i);
    expect(() => parseEvidenceItem({ ...validEvidence, evidence_level: 'guessed' })).toThrow(/evidence_level/i);
    expect(() => parseEvidenceItem({ ...validEvidence, proof_source: [''] })).toThrow(/proof_source/i);
    expect(() => parseEvidenceItem({ ...validEvidence, limitations: '' })).toThrow(/limitations/i);
    expect(() => evidenceItemSchema.parse({ ...validEvidence, source_refs: undefined })).toThrow(/source_refs/i);
  });

  it('rejects unknown evidence fields', () => {
    expect(() => parseEvidenceItem({ ...validEvidence, extra: 'nope' })).toThrow(/unrecognized key/i);
  });

  it('provides an evidence-item type guard', () => {
    expect(isEvidenceItem(validEvidence)).toBe(true);
    expect(isEvidenceItem({ claim: 'missing fields' })).toBe(false);
  });
});
