import { describe, expect, it } from 'vitest';

import { ALL_COMMAND_NAMES } from '../../src/contracts/command-names';
import {
  COMMAND_REGISTRY,
  EXECUTABLE_COMMANDS,
  ROOT_COMMAND_GROUPS,
  WAVE_1_EXECUTABLE_COMMANDS,
  WAVE_1_GROUP_NAME,
  WAVE_2_EXECUTABLE_COMMANDS,
  WAVE_2_GROUP_NAME,
  WAVE_3_EXECUTABLE_COMMANDS,
  WAVE_3_GROUP_NAME,
  getRegistryEntry,
  isExecutableCommandName,
  listExecutableCommands
} from '../../src/registry/command-registry';

describe('command registry', () => {
  it('exposes only the implemented wave-1, wave-2, and shipped wave-3 scenario commands', () => {
    expect(WAVE_1_EXECUTABLE_COMMANDS).toEqual(['doctor']);
    expect(WAVE_2_EXECUTABLE_COMMANDS).toEqual(['snapshot-quote', 'snapshot-lines', 'overlay-actions', 'overlay-relationships']);
    expect(WAVE_3_EXECUTABLE_COMMANDS).toEqual([
      'inspect-pricing-waterfall',
      'capture-post-pst-evidence',
      'classify-pricing-outcome',
      'create-quote',
      'upsert-quote-lines',
      'price-quote',
      'build-test-quote',
      'discover-products',
      'inspect-usage-rate-model',
      'inspect-pricing-product-sync',
      'deploy-product-catalog-index',
      'refresh-decision-tables',
      'inspect-quote-ready-product',
      'inspect-product-catalog-config',
      'plan-product-config',
      'apply-configured-quote',
      'pst-apply-quote-intent',
      'inspect-product-config',
      'validate-product-config',
      'repair-product-config',
      'inspect-rlm-context',
      'pst-plan',
      'compare-quote-pricing',
      'triage-symptom',
      'explain-price',
      'explain-missing-price',
      'verify-lifecycle-provenance',
      'test-pricing-change',
      'create-lifecycle-scenario',
      'inspect-asset-lifecycle',
      'plan-order-activation',
      'activate-order',
      'capture-post-activation-evidence'
    ]);
    expect(EXECUTABLE_COMMANDS).toEqual([
      'doctor',
      'snapshot-quote',
      'snapshot-lines',
      'overlay-actions',
      'overlay-relationships',
      'inspect-pricing-waterfall',
      'capture-post-pst-evidence',
      'classify-pricing-outcome',
      'create-quote',
      'upsert-quote-lines',
      'price-quote',
      'build-test-quote',
      'discover-products',
      'inspect-usage-rate-model',
      'inspect-pricing-product-sync',
      'deploy-product-catalog-index',
      'refresh-decision-tables',
      'inspect-quote-ready-product',
      'inspect-product-catalog-config',
      'plan-product-config',
      'apply-configured-quote',
      'pst-apply-quote-intent',
      'inspect-product-config',
      'validate-product-config',
      'repair-product-config',
      'inspect-rlm-context',
      'pst-plan',
      'compare-quote-pricing',
      'triage-symptom',
      'explain-price',
      'explain-missing-price',
      'verify-lifecycle-provenance',
      'test-pricing-change',
      'create-lifecycle-scenario',
      'inspect-asset-lifecycle',
      'plan-order-activation',
      'activate-order',
      'capture-post-activation-evidence'
    ]);
    expect(listExecutableCommands().map((entry) => entry.name)).toEqual(EXECUTABLE_COMMANDS);
    expect(Object.keys(COMMAND_REGISTRY)).toEqual(EXECUTABLE_COMMANDS);
  });

  it('shows only the implemented root help groups', () => {
    expect(ROOT_COMMAND_GROUPS).toEqual([
      { name: 'Preflight and command fit', order: 1 },
      { name: 'Persisted snapshots and overlays', order: 2 },
      { name: 'Context and planning', order: 3 }
    ]);

    expect(listExecutableCommands().slice(0, 26)).toMatchObject([
      {
        name: 'doctor',
        group_name: 'Preflight and command fit',
        summary: 'Check command fit and selector prerequisites before deeper runtime work.'
      },
      {
        name: 'snapshot-quote',
        group_name: 'Persisted snapshots and overlays',
        summary: 'Read the persisted Salesforce Quote snapshot for a targeted quote id.'
      },
      {
        name: 'snapshot-lines',
        group_name: 'Persisted snapshots and overlays',
        summary: 'Read the persisted Salesforce QuoteLineItem snapshot rows for a targeted quote id.'
      },
      {
        name: 'overlay-actions',
        group_name: 'Persisted snapshots and overlays',
        summary: 'Read QuoteAction lifecycle provenance overlays for a quote and optional quote lines.'
      },
      {
        name: 'overlay-relationships',
        group_name: 'Persisted snapshots and overlays',
        summary: 'Read the persisted QuoteLineRelationship overlay for bundle and structure verification.'
      },
      {
        name: 'inspect-pricing-waterfall',
        group_name: 'Context and planning',
        summary: 'Inspect the persisted-first pricing waterfall for one quote line without exposing execution-id selectors.'
      },
      {
        name: 'capture-post-pst-evidence',
        group_name: 'Context and planning',
        summary: 'Capture one bounded read-only post-PST evidence packet across one or more targeted quote lines.'
      },
      {
        name: 'classify-pricing-outcome',
        group_name: 'Context and planning',
        summary: 'Classify overwrite-aware pricing outcome closeout without collapsing transport status into business outcome.'
      },
      {
        name: 'create-quote',
        group_name: 'Context and planning',
        summary: 'Create a fresh Quote through the metadata-gated PST graph mutation lane.'
      },
      {
        name: 'upsert-quote-lines',
        group_name: 'Context and planning',
        summary: 'POST new QuoteLineItem rows or PATCH existing quote lines through the PST graph mutation lane.'
      },
      {
        name: 'price-quote',
        group_name: 'Context and planning',
        summary: 'Run the proven Place Sales Transaction route to price or reprice a quote.'
      },
      {
        name: 'build-test-quote',
        group_name: 'Context and planning',
        summary: 'Build a controlled test quote from a structured quote_intent payload.'
      },
      {
        name: 'discover-products',
        group_name: 'Context and planning',
        summary: 'Find compact product and pricebook-entry candidates from product intent before quote creation.'
      },
      {
        name: 'inspect-usage-rate-model',
        group_name: 'Context and planning',
        summary: 'Read Revenue Cloud usage/rate object availability, field coverage, counts, and optional samples.'
      },
      {
        name: 'inspect-pricing-product-sync',
        group_name: 'Context and planning',
        summary: 'Read product index and DecisionTable sync readiness without executing refresh or deploy jobs.'
      },
      {
        name: 'deploy-product-catalog-index',
        group_name: 'Context and planning',
        summary: 'Dry-run or execute the documented product catalog index deploy route with preflight readback.'
      },
      {
        name: 'refresh-decision-tables',
        group_name: 'Context and planning',
        summary: 'Dry-run or execute the standard refreshDecisionTable action for pricing/rating decision tables.'
      },
      {
        name: 'inspect-quote-ready-product',
        group_name: 'Context and planning',
        summary: 'Resolve quote-ready product facts and configuration templates from a product id or seller term.'
      },
      {
        name: 'inspect-product-catalog-config',
        group_name: 'Context and planning',
        summary: 'Inspect product details, required attributes, and component options before quote creation.'
      },
      {
        name: 'plan-product-config',
        group_name: 'Context and planning',
        summary: 'Validate explicit product configuration choices and produce PST-ready attribute records.'
      },
      {
        name: 'apply-configured-quote',
        group_name: 'Context and planning',
        summary: 'Build and optionally execute a configured quote PST graph from approved plan files.'
      },
      {
        name: 'pst-apply-quote-intent',
        group_name: 'Context and planning',
        summary: 'Apply a scoped quote-intent file through the PST graph lane with dry-run, idempotency hash, and replace-line safeguards.'
      },
      {
        name: 'inspect-product-config',
        group_name: 'Context and planning',
        summary: 'Inspect runtime configuration messages for a persisted quote line.'
      },
      {
        name: 'validate-product-config',
        group_name: 'Context and planning',
        summary: 'Validate persisted product attributes and child relationships for a configured quote.'
      },
      {
        name: 'repair-product-config',
        group_name: 'Context and planning',
        summary: 'Review a deterministic repair plan for persisted product configuration issues.'
      },
      {
        name: 'inspect-rlm-context',
        group_name: 'Context and planning',
        summary: 'Inspect the summary-first RLM context bridge without emitting a raw metadata dump.'
      }
    ]);
  });

  it('prevents registry drift from the full locked v1 command inventory', () => {
    expect(ALL_COMMAND_NAMES).toContain('doctor');
    expect(ALL_COMMAND_NAMES).toContain('snapshot-quote');
    expect(ALL_COMMAND_NAMES).toContain('snapshot-lines');
    expect(ALL_COMMAND_NAMES).toContain('overlay-actions');
    expect(ALL_COMMAND_NAMES).toContain('overlay-relationships');
    expect(ALL_COMMAND_NAMES).toContain('capture-post-pst-evidence');
    expect(ALL_COMMAND_NAMES).toContain('classify-pricing-outcome');
    expect(ALL_COMMAND_NAMES.filter((commandName) => isExecutableCommandName(commandName))).toEqual([
      'doctor',
      'snapshot-quote',
      'snapshot-lines',
      'overlay-actions',
      'overlay-relationships',
      'inspect-pricing-waterfall',
      'capture-post-pst-evidence',
      'classify-pricing-outcome',
      'create-quote',
      'upsert-quote-lines',
      'price-quote',
      'build-test-quote',
      'discover-products',
      'inspect-usage-rate-model',
      'inspect-pricing-product-sync',
      'deploy-product-catalog-index',
      'refresh-decision-tables',
      'inspect-quote-ready-product',
      'inspect-product-catalog-config',
      'plan-product-config',
      'apply-configured-quote',
      'pst-apply-quote-intent',
      'inspect-product-config',
      'validate-product-config',
      'repair-product-config',
      'inspect-rlm-context',
      'pst-plan',
      'triage-symptom',
      'compare-quote-pricing',
      'explain-price',
      'explain-missing-price',
      'verify-lifecycle-provenance',
      'test-pricing-change',
      'create-lifecycle-scenario',
      'inspect-asset-lifecycle',
      'plan-order-activation',
      'activate-order',
      'capture-post-activation-evidence'
    ]);

    for (const commandName of ALL_COMMAND_NAMES.filter((commandName) => !EXECUTABLE_COMMANDS.includes(commandName as never))) {
      expect(getRegistryEntry(commandName)).toBeUndefined();
    }

    expect(getRegistryEntry('doctor')?.group_name).toBe(WAVE_1_GROUP_NAME);
    expect(getRegistryEntry('snapshot-quote')?.group_name).toBe(WAVE_2_GROUP_NAME);
    expect(getRegistryEntry('snapshot-lines')?.group_name).toBe(WAVE_2_GROUP_NAME);
    expect(getRegistryEntry('overlay-actions')?.group_name).toBe(WAVE_2_GROUP_NAME);
    expect(getRegistryEntry('overlay-relationships')?.group_name).toBe(WAVE_2_GROUP_NAME);
    expect(getRegistryEntry('inspect-rlm-context')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('inspect-pricing-waterfall')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('capture-post-pst-evidence')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('classify-pricing-outcome')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('create-quote')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('upsert-quote-lines')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('price-quote')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('build-test-quote')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('discover-products')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('inspect-usage-rate-model')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('inspect-pricing-product-sync')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('deploy-product-catalog-index')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('refresh-decision-tables')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('inspect-quote-ready-product')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('inspect-product-catalog-config')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('plan-product-config')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('apply-configured-quote')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('pst-apply-quote-intent')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('inspect-product-config')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('validate-product-config')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('repair-product-config')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('pst-plan')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('compare-quote-pricing')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('triage-symptom')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('explain-price')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('explain-missing-price')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('verify-lifecycle-provenance')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('create-lifecycle-scenario')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('inspect-asset-lifecycle')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('plan-order-activation')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('activate-order')?.group_name).toBe(WAVE_3_GROUP_NAME);
    expect(getRegistryEntry('capture-post-activation-evidence')?.group_name).toBe(WAVE_3_GROUP_NAME);
  });

  it('locks the inspect-pricing-waterfall shell help grammar in the registry', () => {
    const entry = getRegistryEntry('inspect-pricing-waterfall');

    expect(entry).toBeDefined();
    expect(entry?.renderHelp()).toContain(
      'quote-runtime inspect-pricing-waterfall --org-alias <alias> --quote-id <id> --line-id <id> [--json] [--fail-on <status>] [--output <path>] [--verbose]'
    );
    expect(entry?.renderHelp()).toContain('V1 requires exactly one --line-id and does not expose execution-id selectors.');
  });

  it('locks the inspect-usage-rate-model shell help grammar in the registry', () => {
    const entry = getRegistryEntry('inspect-usage-rate-model');

    expect(entry).toBeDefined();
    expect(entry?.renderHelp()).toContain(
      'quote-runtime inspect-usage-rate-model --org-alias <alias> [--product-id <id>] [--pricebook-id <id>] [--include-samples] [--sample-limit <n>] [--json] [--fail-on <status>] [--output <path>] [--verbose]'
    );
    expect(entry?.renderHelp()).toContain('Does not mutate catalog, pricing, decision-table, index, quote, or usage records.');
  });

  it('locks the deploy-product-catalog-index shell help grammar in the registry', () => {
    const entry = getRegistryEntry('deploy-product-catalog-index');

    expect(entry).toBeDefined();
    expect(entry?.renderHelp()).toContain(
      'quote-runtime deploy-product-catalog-index --org-alias <alias> [--execute] [--json] [--fail-on <status>] [--output <path>] [--verbose]'
    );
    expect(entry?.renderHelp()).toContain('use refresh-decision-tables for DecisionTable refresh');
  });

  it('locks the refresh-decision-tables shell help grammar in the registry', () => {
    const entry = getRegistryEntry('refresh-decision-tables');

    expect(entry).toBeDefined();
    expect(entry?.renderHelp()).toContain(
      'quote-runtime refresh-decision-tables --org-alias <alias> --decision-table-api-name <name> ... [--incremental] [--execute] [--json] [--fail-on <status>] [--output <path>] [--verbose]'
    );
    expect(entry?.renderHelp()).toContain('standard refreshDecisionTable action');
  });

  it('locks the capture-post-pst-evidence shell help grammar in the registry', () => {
    const entry = getRegistryEntry('capture-post-pst-evidence');

    expect(entry).toBeDefined();
    expect(entry?.renderHelp()).toContain(
      'quote-runtime capture-post-pst-evidence --org-alias <alias> --quote-id <id> (--line-id <id> ... | --all-lines) [--include-adjustments] [--include-line-detail] [--include-usage-rating] [--json] [--fail-on <status>] [--output <path>] [--verbose]'
    );
    expect(entry?.renderHelp()).toContain('does not emit business outcome classification in P1');
  });

  it('locks the classify-pricing-outcome shell help grammar in the registry', () => {
    const entry = getRegistryEntry('classify-pricing-outcome');

    expect(entry).toBeDefined();
    expect(entry?.renderHelp()).toContain(
      'quote-runtime classify-pricing-outcome --org-alias <alias> --quote-id <id> --line-id <id> ... --expected-change <text> [--metadata-proof <verified|not_verified>] [--output-family <text>] [--target-step <text>] [--include-adjustments] [--include-line-detail] [--include-usage-rating] [--json] [--fail-on <status>] [--output <path>] [--verbose]'
    );
    expect(entry?.renderHelp()).toContain('keeps transport status separate from business outcome_class');
  });
});
