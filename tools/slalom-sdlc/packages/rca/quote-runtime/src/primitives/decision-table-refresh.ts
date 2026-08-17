import type { EvidenceItem } from '../contracts/evidence';
import type { JsonValue } from '../contracts/result-envelope';
import type { RuntimeStatus } from '../contracts/status';
import {
  invokeSfRestGet,
  invokeSfRestWrite,
  type InvokeSfRestGetOptions,
  type InvokeSfRestWriteOptions,
  type SfRestErrorClassification,
  type SfRestGetResult,
  type SfRestWriteResult
} from '../integrations/salesforce/rest';
import {
  DECISION_TABLE_REFRESH_ACTION_PATH,
  executeInspectPricingProductSync,
  type ExecuteInspectPricingProductSyncInput,
  type PricingProductSyncPrimitiveResult
} from './pricing-product-sync';

export type DecisionTableRefreshMode = 'dry_run' | 'execute';

export type DecisionTableRefreshActionDescribe = {
  readonly name?: string;
  readonly label?: string;
  readonly inputs?: Array<{
    readonly name?: string;
    readonly required?: boolean;
    readonly type?: string;
  }>;
  readonly outputs?: Array<{
    readonly name?: string;
    readonly type?: string;
  }>;
};

export type DecisionTableRefreshRequestBody = {
  readonly inputs: Array<{
    readonly DecisionTableApiName: string;
    readonly isDecisionTableIncremental?: boolean;
  }>;
};

export type DecisionTableRefreshResult = {
  readonly mode: DecisionTableRefreshMode;
  readonly route: string;
  readonly method: 'POST';
  readonly request_body: DecisionTableRefreshRequestBody;
  readonly preflight: {
    readonly status: PricingProductSyncPrimitiveResult['status'];
    readonly action_available: boolean;
    readonly action_inputs: string[];
    readonly matching_sampled_tables: string[];
    readonly sampled_missing_tables: string[];
  };
  readonly execution: {
    readonly executed: boolean;
    readonly response: JsonValue;
  };
  readonly expected_verification_commands: string[];
};

export type DecisionTableRefreshPrimitiveResult = {
  readonly status: Extract<RuntimeStatus, 'ok' | 'changed' | 'warn' | 'unsupported' | 'error'>;
  readonly result: DecisionTableRefreshResult;
  readonly warnings: string[];
  readonly errors: string[];
  readonly evidence: EvidenceItem[];
};

export type DecisionTableRefreshDependencies = {
  readonly executeInspectPricingProductSync?: (
    input: ExecuteInspectPricingProductSyncInput
  ) => Promise<PricingProductSyncPrimitiveResult>;
  readonly invokeSfRestGet?: <T>(options: InvokeSfRestGetOptions) => Promise<SfRestGetResult<T>>;
  readonly invokeSfRestWrite?: <T>(options: InvokeSfRestWriteOptions) => Promise<SfRestWriteResult<T>>;
};

export type ExecuteDecisionTableRefreshInput = DecisionTableRefreshDependencies & {
  readonly orgAlias: string;
  readonly mode: DecisionTableRefreshMode;
  readonly decisionTableApiNames: readonly string[];
  readonly incremental?: boolean;
  readonly timeoutMs?: number;
};

export async function executeDecisionTableRefresh(
  input: ExecuteDecisionTableRefreshInput
): Promise<DecisionTableRefreshPrimitiveResult> {
  const apiNames = normalizeApiNames(input.decisionTableApiNames);
  const requestBody = buildRequestBody(apiNames, input.incremental);
  const runPreflight = input.executeInspectPricingProductSync ?? executeInspectPricingProductSync;
  const readRest = input.invokeSfRestGet ?? invokeSfRestGet;
  const preflight = await runPreflight({
    orgAlias: input.orgAlias,
    sampleLimit: 100,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });
  const actionDescribe = await readRest<DecisionTableRefreshActionDescribe>({
    orgAlias: input.orgAlias,
    path: DECISION_TABLE_REFRESH_ACTION_PATH,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });
  const actionInputs = actionDescribe.ok ? normalizeInputNames(actionDescribe.data.inputs ?? []) : [];
  const actionAvailable = actionDescribe.ok && actionInputs.includes('DecisionTableApiName');
  const resultBase = buildResult(input.mode, requestBody, preflight, actionAvailable, actionInputs, false, null);
  const warnings = [
    ...preflight.warnings,
    'Decision table refresh is asynchronous. Re-run inspect-pricing-product-sync after execution to verify status readback.'
  ];

  if (actionDescribe.ok === false) {
    return {
      status: 'unsupported',
      result: resultBase,
      warnings,
      errors: [actionDescribe.message],
      evidence: buildEvidence(input.mode, 'Refresh Decision Table action metadata was not available in this org.')
    };
  }

  if (!actionAvailable) {
    return {
      status: 'unsupported',
      result: resultBase,
      warnings,
      errors: ['refreshDecisionTable action is missing required DecisionTableApiName input.'],
      evidence: buildEvidence(input.mode, 'Refresh Decision Table action exists but did not expose the required input.')
    };
  }

  if (preflight.status === 'unsupported' || preflight.status === 'error') {
    return {
      status: preflight.status,
      result: resultBase,
      warnings,
      errors: preflight.errors,
      evidence: buildEvidence(input.mode, 'Preflight failed before decision table refresh could be planned.')
    };
  }

  if (input.mode === 'dry_run') {
    return {
      status: preflight.status === 'warn' ? 'warn' : 'ok',
      result: resultBase,
      warnings,
      errors: [],
      evidence: buildEvidence(input.mode, 'Decision table refresh was planned but not executed.')
    };
  }

  const writeRest = input.invokeSfRestWrite ?? invokeSfRestWrite;
  const response = await writeRest<JsonValue>({
    orgAlias: input.orgAlias,
    path: DECISION_TABLE_REFRESH_ACTION_PATH,
    method: 'POST',
    body: requestBody,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (response.ok === false) {
    return {
      status: mapWriteFailureStatus(response.classification),
      result: resultBase,
      warnings,
      errors: [response.message],
      evidence: buildEvidence(input.mode, 'Decision table refresh POST failed before a successful response was returned.')
    };
  }

  return {
    status: 'changed',
    result: buildResult(input.mode, requestBody, preflight, actionAvailable, actionInputs, true, response.data),
    warnings,
    errors: [],
    evidence: buildEvidence(input.mode, 'Decision table refresh POST was submitted; refresh status readback remains required.')
  };
}

function normalizeApiNames(values: readonly string[]): string[] {
  const names = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (names.length === 0) {
    throw new Error('At least one --decision-table-api-name <name> value is required.');
  }

  return names;
}

function buildRequestBody(apiNames: readonly string[], incremental?: boolean): DecisionTableRefreshRequestBody {
  return {
    inputs: apiNames.map((apiName) => ({
      DecisionTableApiName: apiName,
      ...(incremental === undefined ? {} : { isDecisionTableIncremental: incremental })
    }))
  };
}

function buildResult(
  mode: DecisionTableRefreshMode,
  requestBody: DecisionTableRefreshRequestBody,
  preflight: PricingProductSyncPrimitiveResult,
  actionAvailable: boolean,
  actionInputs: readonly string[],
  executed: boolean,
  response: JsonValue
): DecisionTableRefreshResult {
  const sampledNames = new Set([
    ...preflight.result.org_proven.decision_tables.rating_tables,
    ...preflight.result.org_proven.decision_tables.pricing_tables
  ]);
  const requestNames = requestBody.inputs.map((entry) => entry.DecisionTableApiName);
  return {
    mode,
    route: DECISION_TABLE_REFRESH_ACTION_PATH,
    method: 'POST',
    request_body: requestBody,
    preflight: {
      status: preflight.status,
      action_available: actionAvailable,
      action_inputs: [...actionInputs],
      matching_sampled_tables: requestNames.filter((name) => sampledNames.has(name)),
      sampled_missing_tables: requestNames.filter((name) => !sampledNames.has(name))
    },
    execution: {
      executed,
      response
    },
    expected_verification_commands: ['inspect-pricing-product-sync --sample-limit 100', 'inspect-usage-rate-model']
  };
}

function normalizeInputNames(inputs: readonly { readonly name?: string }[]): string[] {
  return inputs.flatMap((input) => typeof input.name === 'string' && input.name.trim() ? [input.name.trim()] : []);
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

function buildEvidence(mode: DecisionTableRefreshMode, claimSuffix: string): EvidenceItem[] {
  return [{
    claim: claimSuffix,
    evidence_level: mode === 'execute' ? 'repo_proven' : 'documented',
    proof_source: [DECISION_TABLE_REFRESH_ACTION_PATH, 'inspect-pricing-product-sync preflight'],
    limitations: 'The action submission is asynchronous; status readback must be verified after execution.',
    source_refs: [
      'https://developer.salesforce.com/docs/atlas.en-us.psc_api.meta/psc_api/dt_actions_refresh_decision_table.htm'
    ]
  }];
}
