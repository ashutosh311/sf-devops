import type { EvidenceItem } from '../contracts/evidence';
import type { JsonValue } from '../contracts/result-envelope';
import type { RuntimeStatus } from '../contracts/status';
import {
  invokeSfRestWrite,
  type InvokeSfRestWriteOptions,
  type SfRestErrorClassification,
  type SfRestWriteResult
} from '../integrations/salesforce/rest';
import {
  executeInspectPricingProductSync,
  PRODUCT_INDEX_DEPLOY_PATH,
  type ExecuteInspectPricingProductSyncInput,
  type PricingProductSyncPrimitiveResult
} from './pricing-product-sync';

export type ProductCatalogIndexDeployMode = 'dry_run' | 'execute';

export type ProductCatalogIndexDeployResult = {
  readonly mode: ProductCatalogIndexDeployMode;
  readonly route: string;
  readonly method: 'POST';
  readonly request_body: Record<string, never>;
  readonly preflight: {
    readonly status: PricingProductSyncPrimitiveResult['status'];
    readonly product_index_status: string | null;
    readonly active_snapshot_present: boolean;
    readonly blockers: string[];
  };
  readonly execution: {
    readonly executed: boolean;
    readonly response: JsonValue;
  };
  readonly expected_verification_commands: string[];
};

export type ProductCatalogIndexDeployPrimitiveResult = {
  readonly status: Extract<RuntimeStatus, 'ok' | 'changed' | 'warn' | 'unsupported' | 'error'>;
  readonly result: ProductCatalogIndexDeployResult;
  readonly warnings: string[];
  readonly errors: string[];
  readonly evidence: EvidenceItem[];
};

export type ProductCatalogIndexDeployDependencies = {
  readonly executeInspectPricingProductSync?: (
    input: ExecuteInspectPricingProductSyncInput
  ) => Promise<PricingProductSyncPrimitiveResult>;
  readonly invokeSfRestWrite?: <T>(options: InvokeSfRestWriteOptions) => Promise<SfRestWriteResult<T>>;
};

export type ExecuteProductCatalogIndexDeployInput = ProductCatalogIndexDeployDependencies & {
  readonly orgAlias: string;
  readonly mode: ProductCatalogIndexDeployMode;
  readonly timeoutMs?: number;
};

export async function executeProductCatalogIndexDeploy(
  input: ExecuteProductCatalogIndexDeployInput
): Promise<ProductCatalogIndexDeployPrimitiveResult> {
  const runPreflight = input.executeInspectPricingProductSync ?? executeInspectPricingProductSync;
  const preflight = await runPreflight({
    orgAlias: input.orgAlias,
    sampleLimit: 20,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });
  const resultBase = buildResult(input.mode, preflight, false, null);
  const warnings = [
    ...preflight.warnings,
    'Product catalog index deploy is a sync/refresh job. Dry-run is default; execution requires --execute and operator approval.'
  ];

  if (preflight.status === 'unsupported' || preflight.status === 'error') {
    return {
      status: preflight.status,
      result: resultBase,
      warnings,
      errors: preflight.errors,
      evidence: buildEvidence(input.mode, 'Preflight failed before product catalog index deploy could be planned.')
    };
  }

  if (input.mode === 'dry_run') {
    return {
      status: preflight.status === 'warn' ? 'warn' : 'ok',
      result: resultBase,
      warnings,
      errors: [],
      evidence: buildEvidence(input.mode, 'Product catalog index deploy was planned but not executed.')
    };
  }

  const writeRest = input.invokeSfRestWrite ?? invokeSfRestWrite;
  const response = await writeRest<JsonValue>({
    orgAlias: input.orgAlias,
    path: PRODUCT_INDEX_DEPLOY_PATH,
    method: 'POST',
    body: {},
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (response.ok === false) {
    return {
      status: mapWriteFailureStatus(response.classification),
      result: buildResult(input.mode, preflight, false, null),
      warnings,
      errors: [response.message],
      evidence: buildEvidence(input.mode, 'Product catalog index deploy POST failed before a successful response was returned.')
    };
  }

  return {
    status: 'changed',
    result: buildResult(input.mode, preflight, true, response.data),
    warnings,
    errors: [],
    evidence: buildEvidence(input.mode, 'Product catalog index deploy POST was submitted; index status readback remains required.')
  };
}

function buildResult(
  mode: ProductCatalogIndexDeployMode,
  preflight: PricingProductSyncPrimitiveResult,
  executed: boolean,
  response: JsonValue
): ProductCatalogIndexDeployResult {
  const productIndex = preflight.result.org_proven.product_catalog_index;
  return {
    mode,
    route: PRODUCT_INDEX_DEPLOY_PATH,
    method: 'POST',
    request_body: {},
    preflight: {
      status: preflight.status,
      product_index_status: productIndex.latest_index_status,
      active_snapshot_present: productIndex.active_snapshot_present,
      blockers: preflight.result.unknown.blockers
    },
    execution: {
      executed,
      response
    },
    expected_verification_commands: [
      'inspect-pricing-product-sync --include-index-logs',
      'inspect-usage-rate-model',
      'discover-products'
    ]
  };
}

function mapWriteFailureStatus(classification: SfRestErrorClassification): Extract<RuntimeStatus, 'unsupported' | 'error'> {
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

function buildEvidence(mode: ProductCatalogIndexDeployMode, claimSuffix: string): EvidenceItem[] {
  return [{
    claim: claimSuffix,
    evidence_level: mode === 'execute' ? 'repo_proven' : 'documented',
    proof_source: [PRODUCT_INDEX_DEPLOY_PATH, 'inspect-pricing-product-sync preflight'],
    limitations: 'This command covers the documented product catalog index deploy route only; use refresh-decision-tables for DecisionTable refresh and keep Pricing Data Sync separate.',
    source_refs: ['https://developer.salesforce.com/docs/atlas.en-us.revenue_lifecycle_management_dev_guide.meta/revenue_lifecycle_management_dev_guide/connect_resources_snapshot_deploy.htm']
  }];
}
