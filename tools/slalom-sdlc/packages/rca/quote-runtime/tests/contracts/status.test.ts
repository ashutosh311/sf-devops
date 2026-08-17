import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FAIL_ON_VALUES,
  RUNTIME_STATUSES,
  STATUS_PRECEDENCE,
  shouldFailForStatus,
  type FailOn,
  type RuntimeStatus
} from '../../src/contracts/status';
import { ALL_COMMAND_NAMES, type CommandName } from '../../src/contracts/command-names';
import {
  NORMALIZED_OPERATION_FAMILY_ALIASES,
  OPERATION_FAMILIES,
  normalizeOperationFamily,
  type OperationFamily
} from '../../src/contracts/operation-family';

type StatusFixture = {
  statusPrecedence: RuntimeStatus[];
  failOnValues: FailOn[];
  thresholdExpectations: Array<{
    failOn: FailOn;
    shouldFail: RuntimeStatus[];
  }>;
  operationFamilyAliases: Record<string, OperationFamily>;
};

const fixturePath = resolve(import.meta.dirname, '../fixtures/contracts/status-thresholds.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as StatusFixture;

const EXPECTED_COMMAND_NAMES = [
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
] as const satisfies readonly CommandName[];

describe('status contracts', () => {
  it('locks the full runtime status vocabulary', () => {
    expect(RUNTIME_STATUSES).toEqual([
      'ok',
      'warn',
      'error',
      'partial',
      'changed',
      'no_change',
      'no_match',
      'unsupported'
    ] satisfies readonly RuntimeStatus[]);
  });

  it('locks the Wave 4 status precedence order', () => {
    expect(STATUS_PRECEDENCE).toEqual(fixture.statusPrecedence);
  });

  it('locks the allowed fail-on values', () => {
    expect(FAIL_ON_VALUES).toEqual(fixture.failOnValues);
  });

  it('applies fail-on threshold behavior across the full status vocabulary', () => {
    for (const threshold of fixture.thresholdExpectations) {
      for (const status of STATUS_PRECEDENCE) {
        expect(shouldFailForStatus(status, threshold.failOn), `${threshold.failOn} / ${status}`).toBe(
          threshold.shouldFail.includes(status)
        );
      }
    }
  });
});

describe('command-name contracts', () => {
  it('locks the full V1 command-name list', () => {
    expect(ALL_COMMAND_NAMES).toEqual(EXPECTED_COMMAND_NAMES);
  });
});

describe('operation-family contracts', () => {
  it('locks the canonical operation-family enum values', () => {
    expect(OPERATION_FAMILIES).toEqual([
      'pst_place',
      'initiate_amendment',
      'initiate_renewal',
      'asset_add_to_renewal'
    ] satisfies readonly OperationFamily[]);
  });

  it('normalizes only the locked operation-family aliases', () => {
    expect(NORMALIZED_OPERATION_FAMILY_ALIASES).toEqual(fixture.operationFamilyAliases);

    for (const [input, expected] of Object.entries(fixture.operationFamilyAliases)) {
      expect(normalizeOperationFamily(input), input).toBe(expected);
    }
  });

  it('rejects unsupported aliases', () => {
    expect(() => normalizeOperationFamily('place')).toThrow(/Unsupported operation-family/i);
    expect(() => normalizeOperationFamily('asset_add')).toThrow(/Unsupported operation-family/i);
  });
});
