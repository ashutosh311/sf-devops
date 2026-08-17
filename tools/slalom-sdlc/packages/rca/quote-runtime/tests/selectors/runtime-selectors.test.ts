import { describe, expect, it } from 'vitest';

import {
  SelectorValidationError,
  normalizeKnownCommand,
  normalizeOperationFamilySelector,
  normalizeSelectors,
  type RuntimeSelectorBundle
} from '../../src/selectors/runtime-selectors';

describe('runtime selector normalization', () => {
  it('dedupes repeatable ids while preserving first-seen order', () => {
    const selectors = normalizeSelectors({
      line_id: [' line-2 ', 'line-1', 'line-2', 'line-1', 'line-3'],
      asset_id: ['asset-2', 'asset-2', ' asset-1 ']
    });

    expect(selectors.line_ids).toEqual(['line-2', 'line-1', 'line-3']);
    expect(selectors.asset_ids).toEqual(['asset-2', 'asset-1']);
  });

  it('preserves the exact-one unique line-id invariant basis by deduping repeated identical line ids', () => {
    const selectors = normalizeSelectors({ line_id: ['L-1', ' L-1 ', 'L-1'] });

    expect(selectors.line_ids).toEqual(['L-1']);
  });

  it('rejects blank ids', () => {
    expect(() => normalizeSelectors({ quote_id: '   ' })).toThrow(/quote-id/i);
    expect(() => normalizeSelectors({ line_id: ['line-1', '   '] })).toThrow(/line-id/i);
    expect(() => normalizeSelectors({ asset_id: [''] })).toThrow(/asset-id/i);
  });

  it('rejects mixing quote-id with before/after quote ids', () => {
    expect(() =>
      normalizeSelectors({
        quote_id: 'Q-001',
        before_quote_id: 'Q-000',
        after_quote_id: 'Q-002'
      })
    ).toThrow(/must not be mixed/i);
  });

  it('rejects unknown commands', () => {
    expect(() => normalizeKnownCommand('not-a-command')).toThrow(SelectorValidationError);
    expect(() => normalizeSelectors({ for_command: 'not-a-command' })).toThrow(/Unknown V1 command/i);
  });

  it('normalizes operation-family aliases', () => {
    expect(normalizeOperationFamilySelector('renewal')).toBe('initiate_renewal');
    expect(normalizeOperationFamilySelector('asset_add_to_renewal')).toBe('asset_add_to_renewal');

    const selectors = normalizeSelectors({ operation_family: 'amendment' });

    expect(selectors.operation_family).toBe('initiate_amendment');
  });

  it('returns the canonical selector bundle shape', () => {
    const selectors = normalizeSelectors({
      quote_id: ' Q-001 ',
      before_quote_id: null,
      after_quote_id: undefined,
      line_id: ['L-1'],
      asset_id: ['A-1'],
      symptom: ' Missing price ',
      expected_change: ' Reprice ',
      changed_artifact: ' QuoteLineItem ',
      operation_family: 'pst_place',
      for_command: 'doctor'
    });

    expect(selectors).toEqual({
      quote_id: 'Q-001',
      before_quote_id: null,
      after_quote_id: null,
      line_ids: ['L-1'],
      asset_ids: ['A-1'],
      symptom: 'Missing price',
      expected_change: 'Reprice',
      changed_artifact: 'QuoteLineItem',
      operation_family: 'pst_place',
      for_command: 'doctor'
    } satisfies RuntimeSelectorBundle);
  });
});
