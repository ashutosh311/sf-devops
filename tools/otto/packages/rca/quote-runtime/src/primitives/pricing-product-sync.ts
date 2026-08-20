import type { EvidenceItem } from '../contracts/evidence';
import type { JsonValue } from '../contracts/result-envelope';
import type { RuntimeStatus } from '../contracts/status';
import { buildSoqlSelect } from '../integrations/salesforce/soql';
import { invokeSfJson, type InvokeSfJsonOptions, type SfCliJsonResult } from '../integrations/salesforce/sf-cli';
import { invokeSfRestGet, type InvokeSfRestGetOptions, type SfRestGetResult } from '../integrations/salesforce/rest';

export const PRODUCT_INDEX_SNAPSHOTS_PATH = '/services/data/v66.0/connect/pcm/index/snapshots';
export const PRODUCT_INDEX_SETTING_PATH = '/services/data/v66.0/connect/pcm/index/setting';
export const PRODUCT_INDEX_ERROR_PATH = '/services/data/v66.0/connect/pcm/index/error';
export const PRODUCT_INDEX_DEPLOY_PATH = '/services/data/v66.0/connect/pcm/index/deploy';
export const DECISION_TABLE_REFRESH_ACTION_PATH = '/services/data/v66.0/actions/standard/refreshDecisionTable';

export const DECISION_TABLE_STATUS_FIELDS = [
  'Id',
  'DeveloperName',
  'MasterLabel',
  'UsageType',
  'ExecutionType',
  'UploadStatus',
  'DownloadStatus',
  'IsIncrementalSyncEnabled',
  'HasIncrementalSyncFailed',
  'LastIncrementalSyncDate'
] as const;

export type ProductIndexSnapshotSummary = {
  readonly status: 'ok' | 'error';
  readonly path: string;
  readonly status_code: number | null;
  readonly snapshot_count: number | null;
  readonly active_snapshot_present: boolean;
  readonly index_count: number | null;
  readonly latest_index_status: string | null;
  readonly latest_index_build_type: string | null;
  readonly latest_index_record_count: number | null;
  readonly latest_log_status: string | null;
  readonly latest_log_build_type: string | null;
  readonly latest_log_change_count: number | null;
  readonly message: string | null;
};

export type ProductIndexSettingSummary = {
  readonly status: 'ok' | 'error';
  readonly path: string;
  readonly status_code: number | null;
  readonly default_language: string | null;
  readonly supported_languages: string[];
  readonly active_languages: string[];
  readonly message: string | null;
};

export type DecisionTableSyncSummary = {
  readonly status: 'ok' | 'error';
  readonly queryable: boolean;
  readonly fields_present: string[];
  readonly fields_missing: string[];
  readonly sampled_count: number;
  readonly usage_types: string[];
  readonly rating_tables: string[];
  readonly pricing_tables: string[];
  readonly incremental_sync_enabled_count: number;
  readonly incremental_sync_failed_count: number;
  readonly upload_statuses: string[];
  readonly download_statuses: string[];
  readonly message: string | null;
};

export type PricingProductSyncResult = {
  readonly documented: {
    readonly product_catalog_index: {
      readonly snapshot_collection_get: string;
      readonly snapshot_deploy_post: string;
      readonly snapshot_error_get: string;
    };
    readonly pricing_data_sync: {
      readonly manual_setup_step: string;
      readonly execution_api_status: 'unknown';
    };
  };
  readonly repo_proven: {
    readonly rest_helper: string;
    readonly command_scope: string;
  };
  readonly org_proven: {
    readonly product_catalog_index: ProductIndexSnapshotSummary;
    readonly product_catalog_index_settings: ProductIndexSettingSummary;
    readonly decision_tables: DecisionTableSyncSummary;
  };
  readonly unknown: {
    readonly blockers: string[];
  };
  readonly guardrails: string[];
};

export type PricingProductSyncPrimitiveResult = {
  readonly status: Extract<RuntimeStatus, 'ok' | 'warn' | 'unsupported' | 'error'>;
  readonly result: PricingProductSyncResult;
  readonly warnings: string[];
  readonly errors: string[];
  readonly evidence: EvidenceItem[];
};

export type PricingProductSyncDependencies = {
  readonly invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
  readonly invokeSfRestGet?: <T>(options: InvokeSfRestGetOptions) => Promise<SfRestGetResult<T>>;
};

export type ExecuteInspectPricingProductSyncInput = PricingProductSyncDependencies & {
  readonly orgAlias: string;
  readonly includeIndexLogs?: boolean;
  readonly sampleLimit?: number;
  readonly timeoutMs?: number;
};

type SnapshotCollectionResponse = {
  readonly statusCode?: string | number;
  readonly snapshots?: SnapshotRecord[];
};

type SnapshotRecord = {
  readonly activationStatus?: string;
  readonly snapshotIndexes?: SnapshotIndexRecord[];
};

type SnapshotIndexRecord = {
  readonly indexBuildType?: string;
  readonly lastBuildStatus?: string;
  readonly numberOfRecords?: number;
  readonly indexLogs?: SnapshotIndexLog[];
};

type SnapshotIndexLog = {
  readonly indexBuildStatus?: string;
  readonly indexBuildType?: string;
  readonly numberOfChanges?: number;
};

type IndexSettingResponse = {
  readonly statusCode?: string | number;
  readonly metadata?: {
    readonly activeLanguages?: string[];
  };
  readonly setting?: {
    readonly defaultLanguage?: string;
    readonly supportedLanguages?: string[];
  };
};

type DescribeResult = {
  readonly queryable?: boolean;
  readonly fields?: Array<{ readonly name?: string }>;
};

type DecisionTableRecord = Partial<Record<(typeof DECISION_TABLE_STATUS_FIELDS)[number], unknown>>;

type QueryResponse = {
  readonly records?: DecisionTableRecord[];
};

const DOCUMENTED_PRODUCT_INDEX_URL =
  'https://developer.salesforce.com/docs/atlas.en-us.revenue_lifecycle_management_dev_guide.meta/revenue_lifecycle_management_dev_guide/connect_resources_snapshot_deploy.htm';
const DOCUMENTED_PRICING_SYNC_URL =
  'https://help.salesforce.com/s/articleView?id=ind.pricing_sync_pricing_data.htm&language=en_US&type=5';

export async function executeInspectPricingProductSync(
  input: ExecuteInspectPricingProductSyncInput
): Promise<PricingProductSyncPrimitiveResult> {
  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const executeRestGet = input.invokeSfRestGet ?? invokeSfRestGet;
  const warnings: string[] = [];
  const errors: string[] = [];

  const productIndex = await inspectProductIndexSnapshots({ input, executeRestGet });
  const productIndexSettings = await inspectProductIndexSettings({ input, executeRestGet });
  const decisionTables = await inspectDecisionTables({ input, executeSfJson });

  for (const check of [productIndex, productIndexSettings, decisionTables]) {
    if (check.status === 'error' && check.message) {
      warnings.push(check.message);
    }
  }

  const blockers = [
    'Exact supported Pricing Data Sync API route, method, body, response, permission requirements, and job polling model are not proven.',
    `Product index deploy exists at ${PRODUCT_INDEX_DEPLOY_PATH}, but this command does not execute it.`
  ];

  const status = productIndex.status === 'error' && productIndexSettings.status === 'error' && decisionTables.status === 'error'
    ? 'unsupported'
    : warnings.length > 0
      ? 'warn'
      : 'ok';

  return {
    status,
    result: {
      documented: {
        product_catalog_index: {
          snapshot_collection_get: PRODUCT_INDEX_SNAPSHOTS_PATH,
          snapshot_deploy_post: PRODUCT_INDEX_DEPLOY_PATH,
          snapshot_error_get: PRODUCT_INDEX_ERROR_PATH
        },
        pricing_data_sync: {
          manual_setup_step: 'Salesforce Help documents Sync Pricing Data as a manual Salesforce Pricing Setup operation.',
          execution_api_status: 'unknown'
        }
      },
      repo_proven: {
        rest_helper: 'tools/salesforce/quote-runtime-cli/src/integrations/salesforce/rest.ts',
        command_scope: 'read-only product index status/settings and DecisionTable status inspection'
      },
      org_proven: {
        product_catalog_index: productIndex,
        product_catalog_index_settings: productIndexSettings,
        decision_tables: decisionTables
      },
      unknown: {
        blockers
      },
      guardrails: [
        'Do not execute product index deploy without explicit approval, dry-run body, build type, target snapshot id, expected blast radius, and polling/error plan.',
        `Decision Table refresh execution is available through ${DECISION_TABLE_REFRESH_ACTION_PATH}; use refresh-decision-tables dry-run before --execute.`,
        'Do not execute Pricing Data Sync until the exact official API/action, permissions, request body, response body, and status/readback route are proven.',
        'If no supported API exists, operator docs must name the manual Salesforce Setup path and detection signals.'
      ]
    },
    warnings: dedupeStrings(warnings),
    errors,
    evidence: buildEvidence()
  };
}

async function inspectProductIndexSnapshots(options: {
  input: ExecuteInspectPricingProductSyncInput;
  executeRestGet: <T>(input: InvokeSfRestGetOptions) => Promise<SfRestGetResult<T>>;
}): Promise<ProductIndexSnapshotSummary> {
  const result = await options.executeRestGet<SnapshotCollectionResponse>({
    orgAlias: options.input.orgAlias,
    path: PRODUCT_INDEX_SNAPSHOTS_PATH,
    ...(options.input.timeoutMs === undefined ? {} : { timeoutMs: options.input.timeoutMs })
  });

  if (!result.ok) {
    return buildProductIndexSnapshotError(result.message);
  }

  const snapshots = result.data.snapshots ?? [];
  const indexes = snapshots.flatMap((snapshot) => snapshot.snapshotIndexes ?? []);
  const latestIndex = indexes[0] ?? null;
  const latestLog = latestIndex?.indexLogs?.[0] ?? null;

  return {
    status: 'ok',
    path: PRODUCT_INDEX_SNAPSHOTS_PATH,
    status_code: normalizeStatusCode(result.data.statusCode),
    snapshot_count: snapshots.length,
    active_snapshot_present: snapshots.some((snapshot) => snapshot.activationStatus === 'ACTIVE'),
    index_count: indexes.length,
    latest_index_status: latestIndex?.lastBuildStatus ?? null,
    latest_index_build_type: latestIndex?.indexBuildType ?? null,
    latest_index_record_count: latestIndex?.numberOfRecords ?? null,
    latest_log_status: latestLog?.indexBuildStatus ?? null,
    latest_log_build_type: latestLog?.indexBuildType ?? null,
    latest_log_change_count: latestLog?.numberOfChanges ?? null,
    message: null
  };
}

async function inspectProductIndexSettings(options: {
  input: ExecuteInspectPricingProductSyncInput;
  executeRestGet: <T>(input: InvokeSfRestGetOptions) => Promise<SfRestGetResult<T>>;
}): Promise<ProductIndexSettingSummary> {
  const result = await options.executeRestGet<IndexSettingResponse>({
    orgAlias: options.input.orgAlias,
    path: PRODUCT_INDEX_SETTING_PATH,
    ...(options.input.timeoutMs === undefined ? {} : { timeoutMs: options.input.timeoutMs })
  });

  if (!result.ok) {
    return {
      status: 'error',
      path: PRODUCT_INDEX_SETTING_PATH,
      status_code: null,
      default_language: null,
      supported_languages: [],
      active_languages: [],
      message: result.message
    };
  }

  return {
    status: 'ok',
    path: PRODUCT_INDEX_SETTING_PATH,
    status_code: normalizeStatusCode(result.data.statusCode),
    default_language: result.data.setting?.defaultLanguage ?? null,
    supported_languages: result.data.setting?.supportedLanguages ?? [],
    active_languages: result.data.metadata?.activeLanguages ?? [],
    message: null
  };
}

async function inspectDecisionTables(options: {
  input: ExecuteInspectPricingProductSyncInput;
  executeSfJson: <T>(input: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
}): Promise<DecisionTableSyncSummary> {
  const describe = await options.executeSfJson<DescribeResult>({
    args: ['sobject', 'describe', '--target-org', options.input.orgAlias, '--sobject', 'DecisionTable', '--json'],
    orgAlias: options.input.orgAlias,
    ...(options.input.timeoutMs === undefined ? {} : { timeoutMs: options.input.timeoutMs })
  });

  if (!describe.ok) {
    return buildDecisionTableError(describe.message, false, [], [...DECISION_TABLE_STATUS_FIELDS]);
  }

  const fieldNames = new Set((describe.data.fields ?? []).flatMap((field) => (field.name ? [field.name] : [])));
  const fieldsPresent = DECISION_TABLE_STATUS_FIELDS.filter((field) => fieldNames.has(field));
  const fieldsMissing = DECISION_TABLE_STATUS_FIELDS.filter((field) => !fieldNames.has(field));

  if (describe.data.queryable !== true) {
    return buildDecisionTableError('DecisionTable is not queryable in this org.', false, fieldsPresent, fieldsMissing);
  }

  const query = buildSoqlSelect({
    objectName: 'DecisionTable',
    fields: fieldsPresent.length > 0 ? fieldsPresent : ['Id'],
    orderBy: fieldsPresent.includes('DeveloperName') ? 'DeveloperName ASC' : undefined,
    limit: normalizeSampleLimit(options.input.sampleLimit)
  });
  const queryResult = await options.executeSfJson<QueryResponse>({
    args: ['data', 'query', '--target-org', options.input.orgAlias, '--query', query, '--json'],
    orgAlias: options.input.orgAlias,
    ...(options.input.timeoutMs === undefined ? {} : { timeoutMs: options.input.timeoutMs })
  });

  if (!queryResult.ok) {
    return buildDecisionTableError(queryResult.message, true, fieldsPresent, fieldsMissing);
  }

  const records = queryResult.data.records ?? [];
  const usageTypes = uniqueStrings(records.map((record) => record.UsageType));
  return {
    status: 'ok',
    queryable: true,
    fields_present: fieldsPresent,
    fields_missing: fieldsMissing,
    sampled_count: records.length,
    usage_types: usageTypes,
    rating_tables: records
      .filter((record) => String(record.UsageType ?? '').includes('Rating'))
      .flatMap((record) => stringValue(record.DeveloperName)),
    pricing_tables: records
      .filter((record) => String(record.UsageType ?? '').includes('Pricing'))
      .flatMap((record) => stringValue(record.DeveloperName)),
    incremental_sync_enabled_count: records.filter((record) => record.IsIncrementalSyncEnabled === true).length,
    incremental_sync_failed_count: records.filter((record) => record.HasIncrementalSyncFailed === true).length,
    upload_statuses: uniqueStrings(records.map((record) => record.UploadStatus)),
    download_statuses: uniqueStrings(records.map((record) => record.DownloadStatus)),
    message: fieldsMissing.length > 0 ? `DecisionTable is missing expected status field(s): ${fieldsMissing.join(', ')}.` : null
  };
}

function buildProductIndexSnapshotError(message: string): ProductIndexSnapshotSummary {
  return {
    status: 'error',
    path: PRODUCT_INDEX_SNAPSHOTS_PATH,
    status_code: null,
    snapshot_count: null,
    active_snapshot_present: false,
    index_count: null,
    latest_index_status: null,
    latest_index_build_type: null,
    latest_index_record_count: null,
    latest_log_status: null,
    latest_log_build_type: null,
    latest_log_change_count: null,
    message
  };
}

function buildDecisionTableError(
  message: string,
  queryable: boolean,
  fieldsPresent: string[],
  fieldsMissing: string[]
): DecisionTableSyncSummary {
  return {
    status: 'error',
    queryable,
    fields_present: fieldsPresent,
    fields_missing: fieldsMissing,
    sampled_count: 0,
    usage_types: [],
    rating_tables: [],
    pricing_tables: [],
    incremental_sync_enabled_count: 0,
    incremental_sync_failed_count: 0,
    upload_statuses: [],
    download_statuses: [],
    message
  };
}

function normalizeStatusCode(value: string | number | undefined): number | null {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeSampleLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? 20, 1), 100);
}

function uniqueStrings(values: readonly unknown[]): string[] {
  return [...new Set(values.flatMap(stringValue))].sort();
}

function stringValue(value: unknown): string[] {
  return typeof value === 'string' && value.trim() ? [value] : [];
}

function buildEvidence(): EvidenceItem[] {
  return [
    {
      claim: 'Official Salesforce docs expose product catalog index status/deploy/error resources; deploy is a mutation and is not executed by this command.',
      evidence_level: 'documented',
      proof_source: [DOCUMENTED_PRODUCT_INDEX_URL],
      limitations: 'Public docs prove product index API shape, not tenant permissions or safe execution policy.',
      source_refs: []
    },
    {
      claim: 'Salesforce Help documents Sync Pricing Data as an operator setup action; this command treats the execution API as unproven.',
      evidence_level: 'documented',
      proof_source: [DOCUMENTED_PRICING_SYNC_URL],
      limitations: 'The accessible Help page describes the manual setup operation but does not prove a supported execution payload.',
      source_refs: []
    },
    {
      claim: 'Salesforce exposes Refresh Decision Table as a standard action; refresh execution belongs to refresh-decision-tables, not this read-only inspection command.',
      evidence_level: 'documented',
      proof_source: [DECISION_TABLE_REFRESH_ACTION_PATH],
      limitations: 'Action availability and response shape must still be checked against the target org before execution.',
      source_refs: ['https://developer.salesforce.com/docs/atlas.en-us.psc_api.meta/psc_api/dt_actions_refresh_decision_table.htm']
    }
  ];
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
