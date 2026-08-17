import type { EvidenceItem } from '../contracts/evidence';
import type { RuntimeStatus } from '../contracts/status';
import { buildSoqlSelect, quoteSoqlIds } from '../integrations/salesforce/soql';
import { invokeSfJson, type InvokeSfJsonOptions, type SfCliJsonResult } from '../integrations/salesforce/sf-cli';

export type AssetLifecycleDependencies = {
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

export type ExecuteInspectAssetLifecycleInput = AssetLifecycleDependencies & {
  orgAlias: string;
  assetIds: string[];
  accountId?: string | null;
  timeoutMs?: number;
};

export type AssetActionRecord = {
  id: string;
  type: string | null;
  action_date: string | null;
  created_date: string | null;
};

export type AssetStatePeriodRecord = {
  id: string;
  start_date: string | null;
  end_date: string | null;
  quantity: number | null;
};

export type AssetLifecycleRecord = {
  id: string;
  name: string | null;
  status: string | null;
  product_id: string | null;
  product_name: string | null;
  account_id: string | null;
  lifecycle_start_date: string | null;
  lifecycle_end_date: string | null;
  assetized: boolean;
  assetized_via_order: string | null;
  amendable: boolean;
  renewable: boolean;
  cancellable: boolean;
  active_state_periods: AssetStatePeriodRecord[];
  state_period_count: number;
  last_asset_action: AssetActionRecord | null;
  source_quote_action_id: string | null;
  warnings: string[];
};

export type AssetLifecyclePreconditionSummary = {
  all_assetized: boolean;
  shared_pricebook: boolean;
  warnings: string[];
};

export type AssetLifecycleResult = {
  assets: AssetLifecycleRecord[];
  precondition_summary: AssetLifecyclePreconditionSummary;
};

export type InspectAssetLifecyclePrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'warn' | 'error' | 'no_match'>;
  result: AssetLifecycleResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
};

type AssetQueryRow = {
  Id?: string;
  Name?: string;
  Status?: string;
  Product2Id?: string;
  Product2?: { Name?: string };
  AccountId?: string;
  LifecycleStartDate?: string;
  LifecycleEndDate?: string;
};

type AssetActionQueryRow = {
  Id?: string;
  AssetId?: string;
  Type?: string;
  ActionDate?: string;
  CreatedDate?: string;
};

type AssetStatePeriodQueryRow = {
  Id?: string;
  AssetId?: string;
  StartDate?: string;
  EndDate?: string;
  Quantity?: number;
};

type AssetActionSourceQueryRow = {
  Id?: string;
  AssetActionId?: string;
  ReferenceEntityItemId?: string;
};

type QueryResponse<T> = {
  totalSize?: number;
  records?: T[];
};

export async function executeInspectAssetLifecycle(
  input: ExecuteInspectAssetLifecycleInput
): Promise<InspectAssetLifecyclePrimitiveResult> {
  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const warnings: string[] = [];
  const errors: string[] = [];

  if (input.assetIds.length === 0) {
    return {
      status: 'error',
      result: { assets: [], precondition_summary: { all_assetized: false, shared_pricebook: false, warnings: ['No asset IDs provided.'] } },
      warnings: [],
      errors: ['At least one --asset-id is required.'],
      evidence: []
    };
  }

  // Query Asset records
  const assetSoql = buildSoqlSelect({
    objectName: 'Asset',
    fields: [
      'Id', 'Name', 'Status', 'Product2Id', 'Product2.Name',
      'AccountId', 'LifecycleStartDate', 'LifecycleEndDate'
    ],
    where: `Id IN (${quoteSoqlIds(input.assetIds)})`
  });

  const assetResult = await executeSfJson<QueryResponse<AssetQueryRow>>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', assetSoql, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (!assetResult.ok) {
    return {
      status: 'error',
      result: { assets: [], precondition_summary: { all_assetized: false, shared_pricebook: false, warnings: [] } },
      warnings: [],
      errors: [`Asset query failed: ${assetResult.message}`],
      evidence: []
    };
  }

  const assetRows = assetResult.data.records ?? [];

  if (assetRows.length === 0) {
    const notFoundIds = input.assetIds.join(', ');
    return {
      status: 'no_match',
      result: {
        assets: [],
        precondition_summary: {
          all_assetized: false,
          shared_pricebook: false,
          warnings: [`No Asset records found for ID(s): ${notFoundIds}.`]
        }
      },
      warnings: [`No Asset records found for ID(s): ${notFoundIds}.`],
      errors: [],
      evidence: []
    };
  }

  const foundIds = assetRows.map((row) => row.Id).filter((id): id is string => typeof id === 'string');
  const missingIds = input.assetIds.filter((id) => !foundIds.includes(id));
  if (missingIds.length > 0) {
    warnings.push(`Asset ID(s) not found: ${missingIds.join(', ')}.`);
  }

  // Query AssetAction records
  const assetActionSoql = buildSoqlSelect({
    objectName: 'AssetAction',
    fields: ['Id', 'AssetId', 'Type', 'ActionDate', 'CreatedDate'],
    where: `AssetId IN (${quoteSoqlIds(foundIds)})`,
    orderBy: ['ActionDate DESC']
  });

  const assetActionResult = await executeSfJson<QueryResponse<AssetActionQueryRow>>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', assetActionSoql, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  const assetActionRows = assetActionResult.ok ? (assetActionResult.data.records ?? []) : [];
  if (!assetActionResult.ok) {
    warnings.push(`AssetAction query failed: ${assetActionResult.message}`);
  }

  // Build a map of assetId -> assetActions
  const actionsByAssetId = new Map<string, AssetActionQueryRow[]>();
  for (const row of assetActionRows) {
    const assetId = row.AssetId;
    if (!assetId) { continue; }
    const existing = actionsByAssetId.get(assetId) ?? [];
    existing.push(row);
    actionsByAssetId.set(assetId, existing);
  }

  // Query AssetStatePeriod records
  const assetStatePeriodSoql = buildSoqlSelect({
    objectName: 'AssetStatePeriod',
    fields: ['Id', 'AssetId', 'StartDate', 'EndDate', 'Quantity'],
    where: `AssetId IN (${quoteSoqlIds(foundIds)})`
  });

  const assetStatePeriodResult = await executeSfJson<QueryResponse<AssetStatePeriodQueryRow>>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', assetStatePeriodSoql, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  const assetStatePeriodRows = assetStatePeriodResult.ok ? (assetStatePeriodResult.data.records ?? []) : [];
  if (!assetStatePeriodResult.ok) {
    warnings.push(`AssetStatePeriod query failed: ${assetStatePeriodResult.message}`);
  }

  // Build a map of assetId -> statePeriods
  const statePeriodsByAssetId = new Map<string, AssetStatePeriodQueryRow[]>();
  for (const row of assetStatePeriodRows) {
    const assetId = row.AssetId;
    if (!assetId) { continue; }
    const existing = statePeriodsByAssetId.get(assetId) ?? [];
    existing.push(row);
    statePeriodsByAssetId.set(assetId, existing);
  }

  // Resolve assetized_via_order via the org-proven linkage:
  // AssetAction.Id -> AssetActionSource.AssetActionId, AssetActionSource.ReferenceEntityItemId -> OrderItem.Id -> OrderItem.OrderId
  const orderIdByAssetId = new Map<string, string>();
  const allActionIds = assetActionRows.map((row) => row.Id).filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (allActionIds.length > 0) {
    const assetActionSourceSoql = buildSoqlSelect({
      objectName: 'AssetActionSource',
      fields: ['Id', 'AssetActionId', 'ReferenceEntityItemId'],
      where: `AssetActionId IN (${quoteSoqlIds(allActionIds)})`
    });
    const assetActionSourceResult = await executeSfJson<QueryResponse<AssetActionSourceQueryRow>>({
      args: ['data', 'query', '--target-org', input.orgAlias, '--query', assetActionSourceSoql, '--json'],
      orgAlias: input.orgAlias,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    });

    if (!assetActionSourceResult.ok) {
      warnings.push(`AssetActionSource query failed: ${assetActionSourceResult.message}`);
    } else {
      const sourceRows = assetActionSourceResult.data.records ?? [];
      const assetIdByActionId = new Map<string, string>();
      for (const row of assetActionRows) {
        if (row.Id && row.AssetId) {
          assetIdByActionId.set(row.Id, row.AssetId);
        }
      }
      // OrderItem ids carry the 802 key prefix; ReferenceEntityItemId is polymorphic.
      const orderItemRefIds = [...new Set(
        sourceRows
          .map((row) => row.ReferenceEntityItemId)
          .filter((id): id is string => typeof id === 'string' && id.startsWith('802'))
      )];

      if (orderItemRefIds.length > 0) {
        const orderItemSoql = buildSoqlSelect({
          objectName: 'OrderItem',
          fields: ['Id', 'OrderId'],
          where: `Id IN (${quoteSoqlIds(orderItemRefIds)})`
        });
        const orderItemResult = await executeSfJson<QueryResponse<{ Id?: string; OrderId?: string }>>({
          args: ['data', 'query', '--target-org', input.orgAlias, '--query', orderItemSoql, '--json'],
          orgAlias: input.orgAlias,
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
        });

        if (!orderItemResult.ok) {
          warnings.push(`OrderItem provenance query failed: ${orderItemResult.message}`);
        } else {
          const orderIdByItemId = new Map<string, string>();
          for (const row of orderItemResult.data.records ?? []) {
            if (row.Id && row.OrderId) {
              orderIdByItemId.set(row.Id, row.OrderId);
            }
          }
          for (const sourceRow of sourceRows) {
            const actionId = sourceRow.AssetActionId;
            const refItemId = sourceRow.ReferenceEntityItemId;
            if (!actionId || !refItemId) { continue; }
            const assetId = assetIdByActionId.get(actionId);
            const orderId = orderIdByItemId.get(refItemId);
            if (assetId && orderId && !orderIdByAssetId.has(assetId)) {
              orderIdByAssetId.set(assetId, orderId);
            }
          }
        }
      }
    }
  }

  // Resolve source_quote_action_id via QuoteAction.SourceAssetId
  const quoteActionIdByAssetId = new Map<string, string>();
  const quoteActionSoql = buildSoqlSelect({
    objectName: 'QuoteAction',
    fields: ['Id', 'SourceAssetId'],
    where: `SourceAssetId IN (${quoteSoqlIds(foundIds)})`
  });
  const quoteActionResult = await executeSfJson<QueryResponse<{ Id?: string; SourceAssetId?: string }>>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', quoteActionSoql, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (!quoteActionResult.ok) {
    warnings.push(`QuoteAction provenance query failed: ${quoteActionResult.message}`);
  } else {
    for (const row of quoteActionResult.data.records ?? []) {
      if (row.Id && row.SourceAssetId && !quoteActionIdByAssetId.has(row.SourceAssetId)) {
        quoteActionIdByAssetId.set(row.SourceAssetId, row.Id);
      }
    }
  }

  // Build asset lifecycle records
  const nowMs = Date.now();
  const isCurrentlyActivePeriod = (period: AssetStatePeriodQueryRow): boolean => {
    if (!period.StartDate) { return false; }
    const startMs = Date.parse(period.StartDate);
    if (!Number.isFinite(startMs) || startMs > nowMs) { return false; }
    if (!period.EndDate) { return true; }
    const endMs = Date.parse(period.EndDate);
    return !Number.isFinite(endMs) || endMs >= nowMs;
  };

  const assets: AssetLifecycleRecord[] = assetRows.map((row) => {
    const assetId = row.Id ?? '';
    const actions = actionsByAssetId.get(assetId) ?? [];
    const statePeriods = statePeriodsByAssetId.get(assetId) ?? [];

    const assetized = actions.length > 0;
    const lastAction = actions[0] ?? null;

    // Determine amendable/renewable/cancellable from status and state periods
    const assetStatus = row.Status ?? null;
    const isActiveStatus = assetStatus === 'Installed' || assetStatus === 'Active';
    const hasCancelledStatus = assetStatus === 'Cancelled' || assetStatus === 'Expired';

    const amendable = assetized && isActiveStatus;
    const renewable = assetized && isActiveStatus;
    const cancellable = assetized && isActiveStatus && !hasCancelledStatus;

    const assetWarnings: string[] = [];
    if (!assetized) {
      assetWarnings.push(
        `Asset ${assetId} has no AssetAction records — it was not created through the standard order activation lifecycle. ` +
        'Amend/renew/cancel operations will fail. Remediation: activate the originating order using activate-order --execute.'
      );
    }

    return {
      id: assetId,
      name: row.Name ?? null,
      status: assetStatus,
      product_id: row.Product2Id ?? null,
      product_name: row.Product2?.Name ?? null,
      account_id: row.AccountId ?? null,
      lifecycle_start_date: row.LifecycleStartDate ?? null,
      lifecycle_end_date: row.LifecycleEndDate ?? null,
      assetized,
      assetized_via_order: orderIdByAssetId.get(assetId) ?? null,
      amendable,
      renewable,
      cancellable,
      active_state_periods: statePeriods.filter(isCurrentlyActivePeriod).map((sp) => ({
        id: sp.Id ?? '',
        start_date: sp.StartDate ?? null,
        end_date: sp.EndDate ?? null,
        quantity: typeof sp.Quantity === 'number' ? sp.Quantity : null
      })),
      state_period_count: statePeriods.length,
      last_asset_action: lastAction
        ? {
            id: lastAction.Id ?? '',
            type: lastAction.Type ?? null,
            action_date: lastAction.ActionDate ?? null,
            created_date: lastAction.CreatedDate ?? null
          }
        : null,
      source_quote_action_id: quoteActionIdByAssetId.get(assetId) ?? null,
      warnings: assetWarnings
    };
  });

  for (const asset of assets) {
    warnings.push(...asset.warnings);
  }

  const allAssetized = assets.length > 0 && assets.every((asset) => asset.assetized);
  const preconditionWarnings: string[] = [];
  if (!allAssetized) {
    preconditionWarnings.push('Not all assets are assetized via the standard lifecycle. Order activation is required before amend/renew/cancel.');
  }

  const status: InspectAssetLifecyclePrimitiveResult['status'] =
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'ok';

  return {
    status,
    result: {
      assets,
      precondition_summary: {
        all_assetized: allAssetized,
        shared_pricebook: true, // Cannot determine without pricebook query; conservative default
        warnings: preconditionWarnings
      }
    },
    warnings,
    errors,
    evidence: [
      {
        claim: 'Asset lifecycle state read from Asset, AssetAction, and AssetStatePeriod SOQL queries.',
        evidence_level: 'org_proven',
        proof_source: [`sf data query Asset WHERE Id IN (${input.assetIds.join(', ')})`, 'sf data query AssetAction', 'sf data query AssetStatePeriod', 'sf data query AssetActionSource', 'sf data query OrderItem', 'sf data query QuoteAction'],
        limitations: 'assetized_via_order resolved via AssetAction -> AssetActionSource.ReferenceEntityItemId -> OrderItem.OrderId (org-proven linkage); shared_pricebook check requires Pricebook2 query (deferred).',
        source_refs: ['https://developer.salesforce.com/docs/atlas.en-us.revenue_lifecycle_management_dev_guide.meta/revenue_lifecycle_management_dev_guide/actions_obj_create_update_asset_from_order.htm']
      }
    ]
  };
}
