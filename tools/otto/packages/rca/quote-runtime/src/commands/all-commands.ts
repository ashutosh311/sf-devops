/**
 * ALL_COMMAND_SPECS — the single aggregator for every quote-runtime subcommand spec.
 *
 * Order is intentional:
 *   Wave 1 → Wave 2 → Wave 3 (matches EXECUTABLE_COMMANDS order in command-registry.ts
 *   and the display order in root-help).  The QUICK_STARTS section of root-help is
 *   derived from this ordering, so it must match the current expected-root-help.txt fixture.
 */

import type { CommandSpec } from './spec';

import { _registerSpecMaps } from '../routing/selector-functions';

import { DOCTOR_COMMAND_SPEC } from './doctor';

import { SNAPSHOT_QUOTE_COMMAND_SPEC } from './snapshot-quote';
import { SNAPSHOT_LINES_COMMAND_SPEC } from './snapshot-lines';
import { OVERLAY_ACTIONS_COMMAND_SPEC } from './overlay-actions';
import { OVERLAY_RELATIONSHIPS_COMMAND_SPEC } from './overlay-relationships';

import { INSPECT_PRICING_WATERFALL_COMMAND_SPEC } from './inspect-pricing-waterfall';
import { CAPTURE_POST_PST_EVIDENCE_COMMAND_SPEC } from './capture-post-pst-evidence';
import { CLASSIFY_PRICING_OUTCOME_COMMAND_SPEC } from './classify-pricing-outcome';
import { CREATE_QUOTE_COMMAND_SPEC } from './create-quote';
import { UPSERT_QUOTE_LINES_COMMAND_SPEC } from './upsert-quote-lines';
import { PRICE_QUOTE_COMMAND_SPEC } from './price-quote';
import { BUILD_TEST_QUOTE_COMMAND_SPEC } from './build-test-quote';
import { DISCOVER_PRODUCTS_COMMAND_SPEC } from './discover-products';
import { INSPECT_USAGE_RATE_MODEL_COMMAND_SPEC } from './inspect-usage-rate-model';
import { INSPECT_PRICING_PRODUCT_SYNC_COMMAND_SPEC } from './inspect-pricing-product-sync';
import { DEPLOY_PRODUCT_CATALOG_INDEX_COMMAND_SPEC } from './deploy-product-catalog-index';
import { REFRESH_DECISION_TABLES_COMMAND_SPEC } from './refresh-decision-tables';
import { INSPECT_QUOTE_READY_PRODUCT_COMMAND_SPEC } from './inspect-quote-ready-product';
import { INSPECT_PRODUCT_CATALOG_CONFIG_COMMAND_SPEC } from './inspect-product-catalog-config';
import { PLAN_PRODUCT_CONFIG_COMMAND_SPEC } from './plan-product-config';
import { APPLY_CONFIGURED_QUOTE_COMMAND_SPEC } from './apply-configured-quote';
import { PST_APPLY_QUOTE_INTENT_COMMAND_SPEC } from './pst-apply-quote-intent';
import { INSPECT_PRODUCT_CONFIG_COMMAND_SPEC } from './inspect-product-config';
import { VALIDATE_PRODUCT_CONFIG_COMMAND_SPEC } from './validate-product-config';
import { REPAIR_PRODUCT_CONFIG_COMMAND_SPEC } from './repair-product-config';
import { INSPECT_RLM_CONTEXT_COMMAND_SPEC } from './inspect-rlm-context';
import { PST_PLAN_COMMAND_SPEC } from './pst-plan';
import { COMPARE_QUOTE_PRICING_COMMAND_SPEC } from './compare-quote-pricing';
import { TRIAGE_SYMPTOM_COMMAND_SPEC } from './triage-symptom';
import { EXPLAIN_PRICE_COMMAND_SPEC } from './explain-price';
import { EXPLAIN_MISSING_PRICE_COMMAND_SPEC } from './explain-missing-price';
import { VERIFY_LIFECYCLE_PROVENANCE_COMMAND_SPEC } from './verify-lifecycle-provenance';
import { TEST_PRICING_CHANGE_COMMAND_SPEC } from './test-pricing-change';
import { CREATE_LIFECYCLE_SCENARIO_COMMAND_SPEC } from './create-lifecycle-scenario';
import { INSPECT_ASSET_LIFECYCLE_COMMAND_SPEC } from './inspect-asset-lifecycle';
import { PLAN_ORDER_ACTIVATION_COMMAND_SPEC } from './plan-order-activation';
import { ACTIVATE_ORDER_COMMAND_SPEC } from './activate-order';
import { CAPTURE_POST_ACTIVATION_EVIDENCE_COMMAND_SPEC } from './capture-post-activation-evidence';

/**
 * Every executable quote-runtime command, in the canonical registry order.
 *
 * Downstream consumers derive:
 *   - `COMMAND_REGISTRY` (command-registry.ts) — name/group/summary/renderHelp/run
 *   - `QUICK_STARTS` (root-help.ts) — ordered quick-start example strings
 *   - ownership and selector-policy maps in routing/selector-functions.ts (Q4)
 */
export const ALL_COMMAND_SPECS: readonly CommandSpec[] = [
  // Wave 1 — Preflight and command fit
  DOCTOR_COMMAND_SPEC,

  // Wave 2 — Persisted snapshots and overlays
  SNAPSHOT_QUOTE_COMMAND_SPEC,
  SNAPSHOT_LINES_COMMAND_SPEC,
  OVERLAY_ACTIONS_COMMAND_SPEC,
  OVERLAY_RELATIONSHIPS_COMMAND_SPEC,

  // Wave 3 — Context and planning
  INSPECT_PRICING_WATERFALL_COMMAND_SPEC,
  CAPTURE_POST_PST_EVIDENCE_COMMAND_SPEC,
  CLASSIFY_PRICING_OUTCOME_COMMAND_SPEC,
  CREATE_QUOTE_COMMAND_SPEC,
  UPSERT_QUOTE_LINES_COMMAND_SPEC,
  PRICE_QUOTE_COMMAND_SPEC,
  BUILD_TEST_QUOTE_COMMAND_SPEC,
  DISCOVER_PRODUCTS_COMMAND_SPEC,
  INSPECT_USAGE_RATE_MODEL_COMMAND_SPEC,
  INSPECT_PRICING_PRODUCT_SYNC_COMMAND_SPEC,
  DEPLOY_PRODUCT_CATALOG_INDEX_COMMAND_SPEC,
  REFRESH_DECISION_TABLES_COMMAND_SPEC,
  INSPECT_QUOTE_READY_PRODUCT_COMMAND_SPEC,
  INSPECT_PRODUCT_CATALOG_CONFIG_COMMAND_SPEC,
  PLAN_PRODUCT_CONFIG_COMMAND_SPEC,
  APPLY_CONFIGURED_QUOTE_COMMAND_SPEC,
  PST_APPLY_QUOTE_INTENT_COMMAND_SPEC,
  INSPECT_PRODUCT_CONFIG_COMMAND_SPEC,
  VALIDATE_PRODUCT_CONFIG_COMMAND_SPEC,
  REPAIR_PRODUCT_CONFIG_COMMAND_SPEC,
  INSPECT_RLM_CONTEXT_COMMAND_SPEC,
  PST_PLAN_COMMAND_SPEC,
  COMPARE_QUOTE_PRICING_COMMAND_SPEC,
  TRIAGE_SYMPTOM_COMMAND_SPEC,
  EXPLAIN_PRICE_COMMAND_SPEC,
  EXPLAIN_MISSING_PRICE_COMMAND_SPEC,
  VERIFY_LIFECYCLE_PROVENANCE_COMMAND_SPEC,
  TEST_PRICING_CHANGE_COMMAND_SPEC,
  CREATE_LIFECYCLE_SCENARIO_COMMAND_SPEC,
  INSPECT_ASSET_LIFECYCLE_COMMAND_SPEC,
  PLAN_ORDER_ACTIVATION_COMMAND_SPEC,
  ACTIVATE_ORDER_COMMAND_SPEC,
  CAPTURE_POST_ACTIVATION_EVIDENCE_COMMAND_SPEC
];

// Register derived maps in selector-functions.ts now that ALL_COMMAND_SPECS is
// fully defined.  selector-functions.ts is already in the CJS module cache by
// this point (it was loaded by doctor.ts and the other command files above).
// Command files that only check their own readiness use getReadinessIssuesForPolicy
// (a pure function) and do not depend on these maps.
_registerSpecMaps(ALL_COMMAND_SPECS);
