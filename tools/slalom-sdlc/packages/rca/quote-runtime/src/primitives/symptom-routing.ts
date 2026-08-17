/**
 * symptom-routing.ts — Deterministic symptom-to-lane routing.
 *
 * Moved from routing/route-logic.ts (plan 022 Q4).
 * Sole caller: src/commands/triage-symptom.ts (also used by explain-price.ts,
 * explain-missing-price.ts, test-pricing-change.ts for route classification).
 *
 * No imports from all-commands.ts or any command file — zero cycle risk.
 */

import type { CommandName } from '../contracts/command-names';

export type SymptomRoute = {
  symptom_class: 'wrong-price' | 'missing-price' | 'structure' | 'lifecycle' | 'context-bridge';
  primary_lane: 'quote_pricing' | 'structure_overlay' | 'lifecycle_provenance' | 'context_bridge';
  recommended_branch:
    | 'persisted_price_explanation'
    | 'missing_price_explanation'
    | 'structure_overlay'
    | 'lifecycle_overlay'
    | 'context_bridge';
  required_overlays: readonly ('QuoteAction' | 'QuoteLineRelationship')[];
  recommended_next_commands: readonly CommandName[];
};

export const SUPPORTED_SYMPTOM_CLASSES = [
  'wrong-price',
  'missing-price',
  'structure',
  'lifecycle',
  'context-bridge'
] as const satisfies readonly SymptomRoute['symptom_class'][];

const SYMPTOM_ROUTE_PATTERNS: readonly {
  route: SymptomRoute;
  keywords: readonly string[];
}[] = [
  {
    route: {
      symptom_class: 'missing-price',
      primary_lane: 'quote_pricing',
      recommended_branch: 'missing_price_explanation',
      required_overlays: ['QuoteLineRelationship', 'QuoteAction'],
      recommended_next_commands: ['explain-missing-price']
    },
    keywords: ['missing price', 'price missing', 'no price', 'zero price', 'blank price', 'unpriced', 'not priced']
  },
  {
    route: {
      symptom_class: 'structure',
      primary_lane: 'structure_overlay',
      recommended_branch: 'structure_overlay',
      required_overlays: ['QuoteLineRelationship'],
      recommended_next_commands: ['overlay-relationships']
    },
    keywords: ['bundle', 'component', 'parent', 'child', 'structure', 'relationship', 'rollup', 'included in bundle']
  },
  {
    route: {
      symptom_class: 'lifecycle',
      primary_lane: 'lifecycle_provenance',
      recommended_branch: 'lifecycle_overlay',
      required_overlays: ['QuoteAction'],
      recommended_next_commands: ['verify-lifecycle-provenance']
    },
    keywords: ['lifecycle', 'renewal', 'amendment', 'amend', 'provenance', 'source asset', 'quoteaction', 'add asset']
  },
  {
    route: {
      symptom_class: 'context-bridge',
      primary_lane: 'context_bridge',
      recommended_branch: 'context_bridge',
      required_overlays: [],
      recommended_next_commands: ['inspect-rlm-context']
    },
    keywords: [
      'context',
      'bridge',
      'metadata',
      'rlm',
      'salestransactioncontext',
      'pricing procedure',
      'decision table',
      'prehook'
    ]
  },
  {
    route: {
      symptom_class: 'wrong-price',
      primary_lane: 'quote_pricing',
      recommended_branch: 'persisted_price_explanation',
      required_overlays: [],
      recommended_next_commands: ['explain-price']
    },
    keywords: [
      'wrong price',
      'incorrect price',
      'unexpected price',
      'price is wrong',
      'priced wrong',
      'price mismatch',
      'too high',
      'too low',
      'wrong total',
      'unexpected total'
    ]
  }
] as const;

export function routeSymptom(symptom: string): SymptomRoute {
  const normalizedSymptom = symptom.trim().toLowerCase();

  if (!normalizedSymptom) {
    throw new Error('Symptom text must not be blank when routing triage-symptom.');
  }

  const matchedRoute = SYMPTOM_ROUTE_PATTERNS.find(({ keywords }) =>
    keywords.some((keyword) => normalizedSymptom.includes(keyword))
  )?.route;

  if (!matchedRoute) {
    throw new Error(
      `Unsupported symptom text for triage-symptom routing: '${symptom}'. Supported symptom classes: ${SUPPORTED_SYMPTOM_CLASSES.join(', ')}.`
    );
  }

  return matchedRoute;
}
