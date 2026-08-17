import { QUOTE_LINE_ITEM_SNAPSHOT_FIELDS, QUOTE_SNAPSHOT_FIELDS } from '../contracts/query-fields';
import type { EvidenceItem } from '../contracts/evidence';
import type { OperationFamily } from '../contracts/operation-family';
import type { JsonValue } from '../contracts/result-envelope';
import type { RuntimeStatus } from '../contracts/status';
import type { SfCliErrorClassification } from '../integrations/salesforce/sf-cli';
import { normalizeRepeatableIds } from '../selectors/runtime-selectors';

const PST_PLAN_ROUTE_DEFINITIONS = {
  pst_place: {
    route: '/services/data/v66.0/connect/rev/sales-transaction/actions/place',
    contract_class: 'primary_rest',
    side_effect_scope: 'May mutate or reprice the targeted quote and its quote lines in place.',
    payload_intent: 'PST quote mutation or repricing request on an existing runtime quote.',
    expected_anchor_type: 'same_quote',
    verification_branch_hints: [
      {
        branch: 'persisted_verification',
        when: 'Always start with Quote + QuoteLineItem readback on the same quote.',
        recommended_command: 'snapshot-lines'
      },
      {
        branch: 'pricing_waterfall_debug',
        when: 'If repricing clearly happened but the causal pricing-step explanation is still missing, escalate to the core-pricing waterfall debug lane keyed from QuoteLineItem.PriceWaterfallIdentifier.',
        recommended_command: 'inspect-pricing-waterfall'
      },
      {
        branch: 'lifecycle_overlay',
        when: 'Only if the PST change should express lifecycle provenance through QuoteAction rows.',
        recommended_command: 'overlay-actions'
      },
      {
        branch: 'structure_overlay',
        when: 'Only if bundle, option, or parent-child semantics are the active question.',
        recommended_command: 'overlay-relationships'
      },
      {
        branch: 'context_bridge',
        when: 'Use RLM context inspection only when persisted quote evidence and waterfall/debug evidence still do not explain the result.',
        recommended_command: 'inspect-rlm-context'
      }
    ]
  },
  initiate_amendment: {
    route: 'POST /services/data/v64.0/actions/standard/initiateAmendment',
    contract_class: 'primary_rest',
    side_effect_scope: 'Creates an amendment scenario and typically yields a new amendment quote anchored to the source quote/assets.',
    payload_intent: 'Lifecycle setup request to create an amendment quote from existing quote or asset state.',
    expected_anchor_type: 'new_quote',
    verification_branch_hints: [
      {
        branch: 'persisted_verification',
        when: 'Capture source quote before the action and verify the newly created amendment quote after the action.',
        recommended_command: 'snapshot-quote'
      },
      {
        branch: 'lifecycle_overlay',
        when: 'Use QuoteAction overlay when line provenance or source-asset linkage matters.',
        recommended_command: 'overlay-actions'
      },
      {
        branch: 'structure_overlay',
        when: 'Use relationship overlay only if amendment-created structure or carry-forward bundles must be interpreted.',
        recommended_command: 'overlay-relationships'
      },
      {
        branch: 'context_bridge',
        when: 'Escalate to RLM context inspection when persisted amendment quote evidence still leaves cause unclear.',
        recommended_command: 'inspect-rlm-context'
      }
    ]
  },
  initiate_renewal: {
    route: 'POST /services/data/v64.0/actions/standard/initiateRenewal',
    contract_class: 'primary_rest',
    side_effect_scope: 'Creates a renewal quote or renewal scenario anchored to the source contract or quote context.',
    payload_intent: 'Lifecycle setup request to create a renewal quote for downstream verification and pricing checks.',
    expected_anchor_type: 'new_quote',
    verification_branch_hints: [
      {
        branch: 'persisted_verification',
        when: 'Capture source quote or asset context before the action and verify the resulting renewal quote after the action.',
        recommended_command: 'snapshot-quote'
      },
      {
        branch: 'lifecycle_overlay',
        when: 'Use lifecycle overlay when renewal lineage or carried-forward asset provenance matters.',
        recommended_command: 'overlay-actions'
      },
      {
        branch: 'structure_overlay',
        when: 'Use relationship overlay only if bundle carry-forward or renewed component shape is under review.',
        recommended_command: 'overlay-relationships'
      },
      {
        branch: 'context_bridge',
        when: 'Escalate to RLM context inspection if persisted quote evidence does not explain missing or unexpected renewal state.',
        recommended_command: 'inspect-rlm-context'
      }
    ]
  },
  asset_add_to_renewal: {
    route: 'POST /services/data/v65.0/connect/revenue-management/assets/actions/renew',
    contract_class: 'primary_rest',
    side_effect_scope: 'Adds asset-driven renewal activity that can create or modify a renewal quote and its line set.',
    payload_intent: 'Asset-to-renewal setup request anchored on renewal-eligible asset ids.',
    expected_anchor_type: 'new_or_existing_renewal_quote',
    verification_branch_hints: [
      {
        branch: 'persisted_verification',
        when: 'Capture targeted assets and any known renewal quote before the action, then verify the resulting renewal quote and lines after the action.',
        recommended_command: 'snapshot-lines'
      },
      {
        branch: 'lifecycle_overlay',
        when: 'Use lifecycle overlay when proving which asset produced which renewal line is the core question.',
        recommended_command: 'overlay-actions'
      },
      {
        branch: 'structure_overlay',
        when: 'Use relationship overlay only if add-on structure or bundle semantics remain unclear after line verification.',
        recommended_command: 'overlay-relationships'
      },
      {
        branch: 'context_bridge',
        when: 'Escalate to RLM context inspection if quote and overlay evidence still do not explain renewal add results.',
        recommended_command: 'inspect-rlm-context'
      }
    ]
  }
} as const satisfies Record<OperationFamily, {
  route: string;
  contract_class: string;
  side_effect_scope: string;
  payload_intent: string;
  expected_anchor_type: string;
  verification_branch_hints: readonly {
    branch: string;
    when: string;
    recommended_command: string;
  }[];
}>;

const PST_PLAN_ASSET_CAPTURE_FIELDS = ['Id', 'Product2Id', 'ContractId', 'StartDate', 'EndDate', 'Quantity'] as const;

export type PstPlanSubjects = {
  quote_id: string | null;
  line_ids: string[];
  asset_ids: string[];
  expected_change: string | null;
};

export type PstPlanPayloadSummary = {
  intent: string;
  expected_change: string | null;
  expected_anchor_type: string;
  execution_requested: false;
};

export type PstPlanRequiredRead = {
  surface: string;
  required: boolean;
  selectors: Record<string, JsonValue>;
  field_set: string[];
};

export type PstPlanBeforeCapturePlan = {
  capture_stage: 'before';
  verification_anchor_expectation: string | null;
  required_reads: PstPlanRequiredRead[];
  optional_overlays: string[];
};

export type PstPlanAfterCapturePlan = {
  capture_stage: 'after';
  expected_anchor_type: string;
  required_reads: PstPlanRequiredRead[];
  comparison_expectation: string;
};

export type PstPlanVerificationBranchHint = {
  branch: string;
  when: string;
  recommended_command: string;
};

export type PstPlanResult = {
  mode: 'plan_only';
  operation_family: OperationFamily;
  route: string;
  contract_class: string;
  subjects: PstPlanSubjects;
  side_effect_scope: string;
  payload_summary: PstPlanPayloadSummary;
  before_capture_plan: PstPlanBeforeCapturePlan;
  after_capture_plan: PstPlanAfterCapturePlan;
  verification_branch_hints: PstPlanVerificationBranchHint[];
};

export type PstPlanPrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'warn'>;
  result: PstPlanResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
};

export type ExecutePstPlanInput = {
  operationFamily: OperationFamily;
  quoteId?: string | null;
  lineIds?: readonly string[];
  assetIds?: readonly string[];
  expectedChange?: string | null;
};

export async function executePstPlan(input: ExecutePstPlanInput): Promise<PstPlanPrimitiveResult> {
  const subjects = normalizePstPlanSubjects(input);
  const routeDefinition = PST_PLAN_ROUTE_DEFINITIONS[input.operationFamily];
  const warnings = buildPstPlanWarnings(input.operationFamily, subjects);
  const result: PstPlanResult = {
    mode: 'plan_only',
    operation_family: input.operationFamily,
    route: routeDefinition.route,
    contract_class: routeDefinition.contract_class,
    subjects,
    side_effect_scope: routeDefinition.side_effect_scope,
    payload_summary: {
      intent: routeDefinition.payload_intent,
      expected_change: subjects.expected_change,
      expected_anchor_type: routeDefinition.expected_anchor_type,
      execution_requested: false
    },
    before_capture_plan: buildBeforeCapturePlan(input.operationFamily, subjects),
    after_capture_plan: buildAfterCapturePlan(subjects, routeDefinition.expected_anchor_type),
    verification_branch_hints: routeDefinition.verification_branch_hints.map((hint) => ({ ...hint }))
  };

  return {
    status: warnings.length > 0 ? 'warn' : 'ok',
    result,
    warnings,
    errors: [],
    evidence: [
      {
        claim: 'pst-plan emits a read-only runtime plan using the canonical internal operation_family enum and the locked REST-first route posture.',
        evidence_level: 'repo_proven',
        proof_source: [
          'specs/quoting-pricing-runtime/quoting-pricing-runtime-wave4-command-grammar-and-result-schemas.md',
          'specs/quoting-pricing-runtime/quoting-pricing-runtime-node-typescript-wave2-primitives-build-plan.md'
        ],
        limitations: 'V1 pst-plan is plan_only; it does not execute routes, mutate org state, or confirm org reachability.',
        source_refs: []
      }
    ]
  };
}

export function mapPstPlanFailureStatus(
  classification: SfCliErrorClassification
): Extract<RuntimeStatus, 'unsupported' | 'error'> {
  switch (classification) {
    case 'auth':
    case 'unavailable':
    case 'internal_cli_error':
      return 'unsupported';
    case 'timeout':
    case 'max_buffer':
    case 'non_json_error':
    case 'cli_error':
      return 'error';
  }
}

function normalizePstPlanSubjects(input: ExecutePstPlanInput): PstPlanSubjects {
  return {
    quote_id: normalizeOptionalValue(input.quoteId),
    line_ids: normalizeRepeatableIds(input.lineIds ?? [], 'line-id'),
    asset_ids: normalizeRepeatableIds(input.assetIds ?? [], 'asset-id'),
    expected_change: normalizeOptionalValue(input.expectedChange)
  };
}

function normalizeOptionalValue(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function buildBeforeCapturePlan(
  operationFamily: OperationFamily,
  subjects: PstPlanSubjects
): PstPlanBeforeCapturePlan {
  const optionalOverlays: string[] = [];

  if (operationFamily !== 'pst_place') {
    optionalOverlays.push('QuoteAction when lifecycle provenance is expected');
  }

  if (subjects.line_ids.length > 0) {
    optionalOverlays.push('QuoteLineRelationship when line structure is under investigation');
  }

  return {
    capture_stage: 'before',
    verification_anchor_expectation: buildVerificationAnchor(operationFamily, subjects),
    required_reads: [
      {
        surface: 'Quote',
        required: Boolean(subjects.quote_id),
        selectors: { quote_id: subjects.quote_id },
        field_set: [...QUOTE_SNAPSHOT_FIELDS]
      },
      {
        surface: 'QuoteLineItem',
        required: Boolean(subjects.quote_id),
        selectors: {
          quote_id: subjects.quote_id,
          line_ids: [...subjects.line_ids]
        },
        field_set: [...QUOTE_LINE_ITEM_SNAPSHOT_FIELDS]
      },
      {
        surface: 'Asset',
        required: subjects.asset_ids.length > 0,
        selectors: { asset_ids: [...subjects.asset_ids] },
        field_set: [...PST_PLAN_ASSET_CAPTURE_FIELDS]
      }
    ],
    optional_overlays: optionalOverlays
  };
}

function buildAfterCapturePlan(
  subjects: PstPlanSubjects,
  expectedAnchorType: string
): PstPlanAfterCapturePlan {
  const targetQuote = expectedAnchorType === 'same_quote' ? subjects.quote_id : null;

  return {
    capture_stage: 'after',
    expected_anchor_type: expectedAnchorType,
    required_reads: [
      {
        surface: 'Quote',
        required: true,
        selectors: {
          quote_id: targetQuote,
          anchor_strategy: expectedAnchorType
        },
        field_set: [...QUOTE_SNAPSHOT_FIELDS]
      },
      {
        surface: 'QuoteLineItem',
        required: true,
        selectors: {
          quote_id: targetQuote,
          line_ids: [...subjects.line_ids],
          anchor_strategy: expectedAnchorType
        },
        field_set: [...QUOTE_LINE_ITEM_SNAPSHOT_FIELDS]
      }
    ],
    comparison_expectation: expectedAnchorType === 'same_quote'
      ? 'Compare before and after snapshots on the same quote.'
      : 'Compare source baseline against the output quote anchored by the route response.'
  };
}

function buildVerificationAnchor(
  operationFamily: OperationFamily,
  subjects: PstPlanSubjects
): string | null {
  if (operationFamily === 'pst_place') {
    return subjects.quote_id;
  }

  return subjects.quote_id ?? subjects.asset_ids[0] ?? null;
}

function buildPstPlanWarnings(operationFamily: OperationFamily, subjects: PstPlanSubjects): string[] {
  const warnings: string[] = [];

  if (operationFamily === 'pst_place' && !subjects.quote_id) {
    warnings.push(
      'pst_place planning is strongest with a target quote id because same-quote verification is the default anchor.'
    );
  }

  if (
    (operationFamily === 'initiate_amendment' || operationFamily === 'initiate_renewal') &&
    !subjects.quote_id &&
    subjects.asset_ids.length === 0
  ) {
    warnings.push('Lifecycle setup planning is broader without a source quote id or asset id anchor.');
  }

  if (operationFamily === 'asset_add_to_renewal' && subjects.asset_ids.length === 0) {
    warnings.push(
      'asset_add_to_renewal planning is broader without asset ids, which are usually the primary durable handles.'
    );
  }

  return warnings;
}
