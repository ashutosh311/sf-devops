/**
 * Tests for src/primitives/symptom-routing.ts
 *
 * Moved from tests/routing/route-logic.test.ts (plan 022 Q4).
 */

import { describe, expect, it } from 'vitest';

import {
  SUPPORTED_SYMPTOM_CLASSES,
  routeSymptom,
  type SymptomRoute
} from '../../src/primitives/symptom-routing';

describe('symptom-routing', () => {
  it('exports the supported symptom classes', () => {
    expect(SUPPORTED_SYMPTOM_CLASSES).toEqual([
      'wrong-price',
      'missing-price',
      'structure',
      'lifecycle',
      'context-bridge'
    ]);
  });

  it('centralizes deterministic symptom routing for scenario commands', () => {
    expect(routeSymptom('the wrong price is showing on the line')).toEqual({
      symptom_class: 'wrong-price',
      primary_lane: 'quote_pricing',
      recommended_branch: 'persisted_price_explanation',
      required_overlays: [],
      recommended_next_commands: ['explain-price']
    } satisfies SymptomRoute);

    expect(routeSymptom('bundle structure is wrong for the child component')).toEqual({
      symptom_class: 'structure',
      primary_lane: 'structure_overlay',
      recommended_branch: 'structure_overlay',
      required_overlays: ['QuoteLineRelationship'],
      recommended_next_commands: ['overlay-relationships']
    } satisfies SymptomRoute);
  });

  it('routes missing-price symptoms', () => {
    expect(routeSymptom('price missing on this line')).toEqual({
      symptom_class: 'missing-price',
      primary_lane: 'quote_pricing',
      recommended_branch: 'missing_price_explanation',
      required_overlays: ['QuoteLineRelationship', 'QuoteAction'],
      recommended_next_commands: ['explain-missing-price']
    } satisfies SymptomRoute);

    expect(routeSymptom('this line is unpriced')).toMatchObject({
      symptom_class: 'missing-price',
      recommended_next_commands: ['explain-missing-price']
    });
  });

  it('routes lifecycle symptoms', () => {
    expect(routeSymptom('renewal provenance check needed')).toMatchObject({
      symptom_class: 'lifecycle',
      recommended_next_commands: ['verify-lifecycle-provenance']
    });
  });

  it('routes context-bridge symptoms', () => {
    expect(routeSymptom('pricing procedure context mismatch')).toMatchObject({
      symptom_class: 'context-bridge',
      recommended_next_commands: ['inspect-rlm-context']
    });
  });

  it('fails fast for unsupported symptoms instead of falling back to wrong-price', () => {
    expect(() => routeSymptom('this quote feels cursed')).toThrow(
      "Unsupported symptom text for triage-symptom routing: 'this quote feels cursed'. Supported symptom classes: wrong-price, missing-price, structure, lifecycle, context-bridge."
    );
  });

  it('rejects blank symptom text', () => {
    expect(() => routeSymptom('')).toThrow('Symptom text must not be blank');
    expect(() => routeSymptom('   ')).toThrow('Symptom text must not be blank');
  });
});
