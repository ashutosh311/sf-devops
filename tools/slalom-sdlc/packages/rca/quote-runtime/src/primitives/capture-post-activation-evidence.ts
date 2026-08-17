import type { EvidenceItem } from '../contracts/evidence';
import type { RuntimeStatus } from '../contracts/status';
import { buildSoqlSelect, quoteSoqlId, quoteSoqlIds } from '../integrations/salesforce/soql';
import { invokeSfJson, type InvokeSfJsonOptions, type SfCliJsonResult } from '../integrations/salesforce/sf-cli';

export type CapturePostActivationEvidenceDependencies = {
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

export type ExecuteCapturePostActivationEvidenceInput = CapturePostActivationEvidenceDependencies & {
  orgAlias: string;
  orderId?: string | null;
  assetIds?: string[];
  timeoutMs?: number;
};

export type ActivationEvidenceAssetRecord = {
  id: string;
  name: string | null;
  status: string | null;
  product_id: string | null;
  account_id: string | null;
  lifecycle_start_date: string | null;
  lifecycle_end_date: string | null;
};

export type ActivationEvidenceAssetActionRecord = {
  id: string;
  asset_id: string;
  type: string | null;
  action_date: string | null;
};

export type ActivationEvidenceStatePeriodRecord = {
  id: string;
  asset_id: string;
  start_date: string | null;
  end_date: string | null;
  quantity: number | null;
};

export type PostActivationEvidencePacket = {
  order_id: string | null;
  asset_ids_queried: string[];
  assets: ActivationEvidenceAssetRecord[];
  asset_actions: ActivationEvidenceAssetActionRecord[];
  asset_state_periods: ActivationEvidenceStatePeriodRecord[];
  evidence_status: Extract<RuntimeStatus, 'ok' | 'partial' | 'no_match' | 'error'>;
  gaps: string[];
};

export type CapturePostActivationEvidenceResult = {
  packet: PostActivationEvidencePacket;
};

export type CapturePostActivationEvidencePrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'warn' | 'error' | 'no_match'>;
  result: CapturePostActivationEvidenceResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
};

type AssetQueryRow = {
  Id?: string;
  Name?: string;
  Status?: string;
  Product2Id?: string;
  AccountId?: string;
  LifecycleStartDate?: string;
  LifecycleEndDate?: string;
};

type AssetActionQueryRow = {
  Id?: string;
  AssetId?: string;
  Type?: string;
  ActionDate?: string;
};

type AssetStatePeriodQueryRow = {
  Id?: string;
  AssetId?: string;
  StartDate?: string;
  EndDate?: string;
  Quantity?: number;
};

type OrderItemQueryRow = {
  Id?: string;
  OrderId?: string;
};

type AssetActionSourceQueryRow = {
  Id?: string;
  AssetActionId?: string;
  ReferenceEntityItemId?: string;
  AssetAction?: {
    AssetId?: string;
  };
};

type QueryResponse<T> = {
  totalSize?: number;
  records?: T[];
};

export async function executeCapturePostActivationEvidence(
  input: ExecuteCapturePostActivationEvidenceInput
): Promise<CapturePostActivationEvidencePrimitiveResult> {
  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const warnings: string[] = [];
  const errors: string[] = [];
  const gaps: string[] = [];

  if (!input.orderId && (!input.assetIds || input.assetIds.length === 0)) {
    return {
      status: 'error',
      result: {
        packet: {
          order_id: null,
          asset_ids_queried: [],
          assets: [],
          asset_actions: [],
          asset_state_periods: [],
          evidence_status: 'error',
          gaps: ['Either --order-id or --asset-id is required.']
        }
      },
      warnings: [],
      errors: ['Either --order-id or --asset-id is required.'],
      evidence: []
    };
  }

  let assetIds: string[] = input.assetIds ?? [];

  // If order-id pivot: find assets created from this order.
  // Org-proven linkage (v67.0): OrderItem.Id -> AssetActionSource.ReferenceEntityItemId -> AssetAction.AssetId.
  // OrderItem carries no Asset lookup in the RLM data model.
  if (input.orderId && assetIds.length === 0) {
    const orderItemSoql = buildSoqlSelect({
      objectName: 'OrderItem',
      fields: ['Id', 'OrderId'],
      where: `OrderId = ${quoteSoqlId(input.orderId)}`
    });

    const orderItemResult = await executeSfJson<QueryResponse<OrderItemQueryRow>>({
      args: ['data', 'query', '--target-org', input.orgAlias, '--query', orderItemSoql, '--json'],
      orgAlias: input.orgAlias,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    });

    if (!orderItemResult.ok) {
      warnings.push(`OrderItem query failed: ${orderItemResult.message}`);
      gaps.push(`Could not resolve order items from order ${input.orderId}: ${orderItemResult.message}`);
    } else {
      const orderItemIds = (orderItemResult.data.records ?? [])
        .map((row) => row.Id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

      if (orderItemIds.length > 0) {
        const assetActionSourceSoql = buildSoqlSelect({
          objectName: 'AssetActionSource',
          fields: ['Id', 'AssetActionId', 'AssetAction.AssetId', 'ReferenceEntityItemId'],
          where: `ReferenceEntityItemId IN (${quoteSoqlIds(orderItemIds)})`
        });

        const assetActionSourceResult = await executeSfJson<QueryResponse<AssetActionSourceQueryRow>>({
          args: ['data', 'query', '--target-org', input.orgAlias, '--query', assetActionSourceSoql, '--json'],
          orgAlias: input.orgAlias,
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
        });

        if (!assetActionSourceResult.ok) {
          warnings.push(`AssetActionSource query failed: ${assetActionSourceResult.message}`);
          gaps.push(`Could not resolve assets from order ${input.orderId}: ${assetActionSourceResult.message}`);
        } else {
          assetIds = [...new Set(
            (assetActionSourceResult.data.records ?? [])
              .map((row) => row.AssetAction?.AssetId)
              .filter((id): id is string => typeof id === 'string' && id.length > 0)
          )];
        }
      }
    }

    if (assetIds.length === 0) {
      warnings.push(`No assets found linked to order ${input.orderId}. The order may not have been assetized yet.`);
      gaps.push(`No AssetActionSource rows reference OrderItems of order ${input.orderId}. Run activate-order --execute first.`);
    }
  }

  if (assetIds.length === 0) {
    return {
      status: 'no_match',
      result: {
        packet: {
          order_id: input.orderId ?? null,
          asset_ids_queried: [],
          assets: [],
          asset_actions: [],
          asset_state_periods: [],
          evidence_status: 'no_match',
          gaps
        }
      },
      warnings,
      errors,
      evidence: []
    };
  }

  // Query Asset records
  const assetSoql = buildSoqlSelect({
    objectName: 'Asset',
    fields: ['Id', 'Name', 'Status', 'Product2Id', 'AccountId', 'LifecycleStartDate', 'LifecycleEndDate'],
    where: `Id IN (${quoteSoqlIds(assetIds)})`
  });

  const assetResult = await executeSfJson<QueryResponse<AssetQueryRow>>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', assetSoql, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  const assetRows = assetResult.ok ? (assetResult.data.records ?? []) : [];
  if (!assetResult.ok) {
    errors.push(`Asset query failed: ${assetResult.message}`);
  }

  // Query AssetAction records
  const assetActionSoql = buildSoqlSelect({
    objectName: 'AssetAction',
    fields: ['Id', 'AssetId', 'Type', 'ActionDate'],
    where: `AssetId IN (${quoteSoqlIds(assetIds)})`,
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
    gaps.push('AssetAction records could not be read.');
  }

  // Query AssetStatePeriod records
  const assetStatePeriodSoql = buildSoqlSelect({
    objectName: 'AssetStatePeriod',
    fields: ['Id', 'AssetId', 'StartDate', 'EndDate', 'Quantity'],
    where: `AssetId IN (${quoteSoqlIds(assetIds)})`
  });

  const assetStatePeriodResult = await executeSfJson<QueryResponse<AssetStatePeriodQueryRow>>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', assetStatePeriodSoql, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  const assetStatePeriodRows = assetStatePeriodResult.ok ? (assetStatePeriodResult.data.records ?? []) : [];
  if (!assetStatePeriodResult.ok) {
    warnings.push(`AssetStatePeriod query failed: ${assetStatePeriodResult.message}`);
    gaps.push('AssetStatePeriod records could not be read.');
  }

  const hasData = assetRows.length > 0;
  const evidenceStatus: PostActivationEvidencePacket['evidence_status'] =
    errors.length > 0 ? 'error' :
    !hasData ? 'no_match' :
    warnings.length > 0 ? 'partial' : 'ok';

  const packet: PostActivationEvidencePacket = {
    order_id: input.orderId ?? null,
    asset_ids_queried: assetIds,
    assets: assetRows.map((row) => ({
      id: row.Id ?? '',
      name: row.Name ?? null,
      status: row.Status ?? null,
      product_id: row.Product2Id ?? null,
      account_id: row.AccountId ?? null,
      lifecycle_start_date: row.LifecycleStartDate ?? null,
      lifecycle_end_date: row.LifecycleEndDate ?? null
    })),
    asset_actions: assetActionRows.map((row) => ({
      id: row.Id ?? '',
      asset_id: row.AssetId ?? '',
      type: row.Type ?? null,
      action_date: row.ActionDate ?? null
    })),
    asset_state_periods: assetStatePeriodRows.map((row) => ({
      id: row.Id ?? '',
      asset_id: row.AssetId ?? '',
      start_date: row.StartDate ?? null,
      end_date: row.EndDate ?? null,
      quantity: typeof row.Quantity === 'number' ? row.Quantity : null
    })),
    evidence_status: evidenceStatus,
    gaps
  };

  const status: CapturePostActivationEvidencePrimitiveResult['status'] =
    errors.length > 0 ? 'error' :
    !hasData ? 'no_match' :
    warnings.length > 0 ? 'warn' : 'ok';

  return {
    status,
    result: { packet },
    warnings,
    errors,
    evidence: [
      {
        claim: `Post-activation evidence captured for ${assetIds.length} asset(s) from order ${input.orderId ?? '(direct asset ids)'}.`,
        evidence_level: 'org_proven',
        proof_source: ['sf data query Asset', 'sf data query AssetAction', 'sf data query AssetStatePeriod'],
        limitations: `evidence_status=${evidenceStatus}; AssetActionSource not yet queried.`,
        source_refs: ['https://developer.salesforce.com/docs/atlas.en-us.revenue_lifecycle_management_dev_guide.meta/revenue_lifecycle_management_dev_guide/actions_obj_create_update_asset_from_order.htm']
      }
    ]
  };
}
