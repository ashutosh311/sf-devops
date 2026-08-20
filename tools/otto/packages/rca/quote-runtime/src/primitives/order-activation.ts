import type { EvidenceItem } from '../contracts/evidence';
import type { RuntimeStatus } from '../contracts/status';
import { buildSoqlSelect, quoteSoqlId, quoteSoqlIds } from '../integrations/salesforce/soql';
import { invokeSfJson, type InvokeSfJsonOptions, type SfCliJsonResult } from '../integrations/salesforce/sf-cli';
import {
  invokeSfRestWrite,
  type InvokeSfRestWriteOptions,
  type SfRestWriteResult
} from '../integrations/salesforce/rest';
import {
  executeCapturePostActivationEvidence,
  type CapturePostActivationEvidencePrimitiveResult,
  type ExecuteCapturePostActivationEvidenceInput,
  type PostActivationEvidencePacket
} from './capture-post-activation-evidence';

export type OrderActivationDependencies = {
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
  invokeSfRestWrite?: <T>(options: InvokeSfRestWriteOptions) => Promise<SfRestWriteResult<T>>;
  executeCapturePostActivationEvidence?: (
    input: ExecuteCapturePostActivationEvidenceInput
  ) => Promise<CapturePostActivationEvidencePrimitiveResult>;
};

// ── Plan-order-activation types ──────────────────────────────────────────────

export type OrderActivationPreconditionChecks = {
  order_status: string | null;
  order_status_ok: boolean;
  already_assetized: boolean;
  billing_block: boolean;
  app_usage_assignment_ok: boolean;
};

export type OrderActivationPlan = {
  order_id: string;
  order_item_count: number;
  planned_action: 'createOrUpdateAssetFromOrder' | 'createOrUpdateAssetFromOrderItem';
  side_effect_scope: string[];
  precondition_checks: OrderActivationPreconditionChecks;
  before_capture_plan: {
    order_fields: string[];
    order_item_fields: string[];
  };
  after_capture_plan: {
    asset_fields: string[];
  };
  verification_branch_hints: string[];
};

export type PlanOrderActivationResult = {
  mode: 'plan_only';
  operation_family: 'order_activation';
  subjects: {
    order_id: string;
    order_item_count: number;
  };
  plan: OrderActivationPlan;
};

export type PlanOrderActivationPrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'warn' | 'error' | 'no_match'>;
  result: PlanOrderActivationResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
};

export type ExecutePlanOrderActivationInput = OrderActivationDependencies & {
  orgAlias: string;
  orderId: string;
  orderItemIds?: string[];
  staged?: boolean;
  timeoutMs?: number;
};

type OrderQueryRow = {
  Id?: string;
  Status?: string;
  BillingCity?: string;
  TotalAmount?: number;
};

type OrderItemQueryRow = {
  Id?: string;
  OrderId?: string;
  Product2Id?: string;
};

type QueryResponse<T> = {
  totalSize?: number;
  records?: T[];
};

export async function executePlanOrderActivation(
  input: ExecutePlanOrderActivationInput
): Promise<PlanOrderActivationPrimitiveResult> {
  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const warnings: string[] = [];
  const errors: string[] = [];

  // Query the order
  const orderSoql = buildSoqlSelect({
    objectName: 'Order',
    fields: ['Id', 'Status'],
    where: `Id = ${quoteSoqlId(input.orderId)}`,
    limit: 1
  });

  const orderResult = await executeSfJson<QueryResponse<OrderQueryRow>>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', orderSoql, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (!orderResult.ok) {
    return {
      status: 'error',
      result: buildEmptyPlanResult(input.orderId, 0, input.staged),
      warnings: [],
      errors: [`Order query failed: ${orderResult.message}`],
      evidence: []
    };
  }

  const orderRow = orderResult.data.records?.[0];
  if (!orderRow) {
    return {
      status: 'no_match',
      result: buildEmptyPlanResult(input.orderId, 0, input.staged),
      warnings: [`Order ${input.orderId} was not found.`],
      errors: [],
      evidence: []
    };
  }

  const orderStatus = orderRow.Status ?? null;
  const orderStatusOk = orderStatus === 'Activated';

  if (!orderStatusOk) {
    errors.push(
      `Order ${input.orderId} has status '${String(orderStatus)}'. Order must be Activated before assetization. ` +
      'Activate the order first, then run plan-order-activation again.'
    );
  }

  // Query order items
  const orderItemSoql = buildSoqlSelect({
    objectName: 'OrderItem',
    fields: ['Id', 'OrderId', 'Product2Id'],
    where: input.orderItemIds && input.orderItemIds.length > 0
      ? `OrderId = ${quoteSoqlId(input.orderId)} AND Id IN (${quoteSoqlIds(input.orderItemIds)})`
      : `OrderId = ${quoteSoqlId(input.orderId)}`
  });

  const orderItemResult = await executeSfJson<QueryResponse<OrderItemQueryRow>>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', orderItemSoql, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  const orderItemRows = orderItemResult.ok ? (orderItemResult.data.records ?? []) : [];
  if (!orderItemResult.ok) {
    warnings.push(`OrderItem query failed: ${orderItemResult.message}`);
  }

  const orderItemCount = orderItemRows.length;

  if (orderItemCount === 0 && orderStatusOk) {
    warnings.push(`Order ${input.orderId} has no order items matching the requested scope.`);
  }

  // Org-proven pivot (v67.0): OrderItem.Id -> AssetActionSource.ReferenceEntityItemId.
  // Any AssetActionSource row referencing this order's items means it was already assetized.
  let alreadyAssetized = false;
  const orderItemIdsForAssetCheck = orderItemRows
    .map((row) => row.Id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (orderItemIdsForAssetCheck.length > 0) {
    const assetActionSourceSoql = buildSoqlSelect({
      objectName: 'AssetActionSource',
      fields: ['Id', 'AssetActionId', 'ReferenceEntityItemId'],
      where: `ReferenceEntityItemId IN (${quoteSoqlIds(orderItemIdsForAssetCheck)})`
    });

    const assetActionSourceResult = await executeSfJson<QueryResponse<{ Id?: string; AssetActionId?: string; ReferenceEntityItemId?: string }>>({
      args: ['data', 'query', '--target-org', input.orgAlias, '--query', assetActionSourceSoql, '--json'],
      orgAlias: input.orgAlias,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    });

    if (!assetActionSourceResult.ok) {
      warnings.push(`AssetActionSource precondition query failed: ${assetActionSourceResult.message}`);
    } else {
      const assetActionSourceRows = assetActionSourceResult.data.records ?? [];
      if (assetActionSourceRows.length > 0) {
        alreadyAssetized = true;
        errors.push(
          `Order ${input.orderId} appears already assetized: ${assetActionSourceRows.length} AssetActionSource row(s) reference its order items. ` +
          `Re-activation is blocked; run inspect-asset-lifecycle or capture-post-activation-evidence --order-id ${input.orderId} instead.`
        );
      }
    }
  }

  // Org-proven precondition (v67.0): createOrUpdateAssetFromOrder requires the order to carry an
  // AppUsageAssignment with AppUsageType RevenueLifecycleManagement or SubscriptionManagement.
  let appUsageAssignmentOk = true;
  const appUsageSoql = buildSoqlSelect({
    objectName: 'AppUsageAssignment',
    fields: ['Id', 'AppUsageType'],
    where: `RecordId = ${quoteSoqlId(input.orderId)} AND AppUsageType IN ('RevenueLifecycleManagement', 'SubscriptionManagement')`
  });
  const appUsageResult = await executeSfJson<QueryResponse<{ Id?: string; AppUsageType?: string }>>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', appUsageSoql, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (!appUsageResult.ok) {
    warnings.push(`AppUsageAssignment precondition query failed: ${appUsageResult.message}`);
  } else if ((appUsageResult.data.records ?? []).length === 0) {
    appUsageAssignmentOk = false;
    errors.push(
      `Order ${input.orderId} has no AppUsageAssignment with AppUsageType RevenueLifecycleManagement or SubscriptionManagement. ` +
      'createOrUpdateAssetFromOrder rejects such orders with INVALID_INPUT. The order was not created through the RLM transaction lane.'
    );
  }

  const plannedAction = input.staged ? 'createOrUpdateAssetFromOrderItem' : 'createOrUpdateAssetFromOrder';

  const preconditionChecks: OrderActivationPreconditionChecks = {
    order_status: orderStatus,
    order_status_ok: orderStatusOk,
    already_assetized: alreadyAssetized, // Org-proven: AssetActionSource rows referencing this order's items
    billing_block: false, // Would require billing configuration check; conservative default
    app_usage_assignment_ok: appUsageAssignmentOk
  };

  const plan: OrderActivationPlan = {
    order_id: input.orderId,
    order_item_count: orderItemCount,
    planned_action: plannedAction,
    side_effect_scope: ['Asset', 'AssetAction', 'AssetStatePeriod', 'AssetActionSource'],
    precondition_checks: preconditionChecks,
    before_capture_plan: {
      order_fields: ['Id', 'Status', 'TotalAmount'],
      order_item_fields: ['Id', 'OrderId', 'Product2Id']
    },
    after_capture_plan: {
      asset_fields: ['Id', 'Name', 'Status', 'Product2Id', 'AccountId', 'LifecycleStartDate', 'LifecycleEndDate']
    },
    verification_branch_hints: [
      `inspect-asset-lifecycle --asset-id <created>`,
      `capture-post-activation-evidence --order-id ${input.orderId}`
    ]
  };

  const result: PlanOrderActivationResult = {
    mode: 'plan_only',
    operation_family: 'order_activation',
    subjects: {
      order_id: input.orderId,
      order_item_count: orderItemCount
    },
    plan
  };

  const status: PlanOrderActivationPrimitiveResult['status'] =
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'ok';

  return {
    status,
    result,
    warnings,
    errors,
    evidence: [
      {
        claim: `Order ${input.orderId} queried to determine activation readiness.`,
        evidence_level: 'org_proven',
        proof_source: [`sf data query Order WHERE Id = '${input.orderId}'`],
        limitations: 'already_assetized is org-proven via AssetActionSource.ReferenceEntityItemId; billing_block check is a conservative default (billing queries are deferred).',
        source_refs: ['https://developer.salesforce.com/docs/atlas.en-us.revenue_lifecycle_management_dev_guide.meta/revenue_lifecycle_management_dev_guide/actions_obj_create_update_asset_from_order.htm']
      }
    ]
  };
}

function buildEmptyPlanResult(orderId: string, itemCount: number, staged?: boolean): PlanOrderActivationResult {
  return {
    mode: 'plan_only',
    operation_family: 'order_activation',
    subjects: { order_id: orderId, order_item_count: itemCount },
    plan: {
      order_id: orderId,
      order_item_count: itemCount,
      planned_action: staged ? 'createOrUpdateAssetFromOrderItem' : 'createOrUpdateAssetFromOrder',
      side_effect_scope: ['Asset', 'AssetAction', 'AssetStatePeriod', 'AssetActionSource'],
      precondition_checks: { order_status: null, order_status_ok: false, already_assetized: false, billing_block: false, app_usage_assignment_ok: false },
      before_capture_plan: { order_fields: [], order_item_fields: [] },
      after_capture_plan: { asset_fields: [] },
      verification_branch_hints: []
    }
  };
}

// ── Activate-order types ─────────────────────────────────────────────────────

export type ActivateOrderActionResponse = {
  actionName?: string;
  isSuccess?: boolean;
  errors?: Array<{ message?: string; statusCode?: string }>;
  outputValues?: {
    requestIdentifier?: string;
    [key: string]: unknown;
  };
};

export type ActivateOrderMutationResult = {
  action_response: ActivateOrderActionResponse | null;
  is_success: boolean;
  async_tracking_id: string | null;
  gaps: string[];
};

export type ActivateOrderResult = {
  mode: 'plan_only' | 'execute';
  plan: PlanOrderActivationResult;
  mutation: ActivateOrderMutationResult | null;
  post_activation_evidence: PostActivationEvidencePacket | null;
};

export type ActivateOrderPrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'warn' | 'error' | 'no_match'>;
  result: ActivateOrderResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
};

export type ExecuteActivateOrderInput = OrderActivationDependencies & {
  orgAlias: string;
  orderId: string;
  orderItemIds?: string[];
  staged?: boolean;
  execute: boolean;
  timeoutMs?: number;
};

const CREATE_ASSET_FROM_ORDER_PATH = '/services/data/v67.0/actions/standard/createOrUpdateAssetFromOrder';
const CREATE_ASSET_FROM_ORDER_ITEM_PATH = '/services/data/v67.0/actions/standard/createOrUpdateAssetFromOrderItem';

export async function executeActivateOrder(
  input: ExecuteActivateOrderInput
): Promise<ActivateOrderPrimitiveResult> {
  // Always run the plan first
  const planResult = await executePlanOrderActivation({
    orgAlias: input.orgAlias,
    orderId: input.orderId,
    orderItemIds: input.orderItemIds,
    staged: input.staged,
    invokeSfJson: input.invokeSfJson,
    timeoutMs: input.timeoutMs
  });

  if (!input.execute) {
    // Dry-run: return the plan without any writes
    return {
      status: planResult.status,
      result: {
        mode: 'plan_only',
        plan: planResult.result,
        mutation: null,
        post_activation_evidence: null
      },
      warnings: planResult.warnings,
      errors: planResult.errors,
      evidence: planResult.evidence
    };
  }

  // Execute gate: only proceed if plan passed
  if (planResult.status === 'error') {
    return {
      status: 'error',
      result: {
        mode: 'execute',
        plan: planResult.result,
        mutation: null,
        post_activation_evidence: null
      },
      warnings: planResult.warnings,
      errors: planResult.errors,
      evidence: planResult.evidence
    };
  }

  const warnings = [...planResult.warnings];
  const errors = [...planResult.errors];
  const evidence = [...planResult.evidence];

  // Build the action request body
  const staged = input.staged === true;
  const actionPath = staged ? CREATE_ASSET_FROM_ORDER_ITEM_PATH : CREATE_ASSET_FROM_ORDER_PATH;

  const requestBody = staged && input.orderItemIds && input.orderItemIds.length > 0
    ? { inputs: input.orderItemIds.map((itemId) => ({ orderItemId: itemId })) }
    : { inputs: [{ orderId: input.orderId }] };

  const writeOptions: InvokeSfRestWriteOptions = {
    orgAlias: input.orgAlias,
    path: actionPath,
    method: 'POST',
    body: requestBody,
    ...(input.invokeSfJson === undefined ? {} : { invokeSfJson: input.invokeSfJson }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  };

  const restWriter = input.invokeSfRestWrite ?? invokeSfRestWrite;
  const writeResult = await restWriter<ActivateOrderActionResponse[]>(writeOptions);

  if (!writeResult.ok) {
    errors.push(`Order activation REST call failed: ${writeResult.message}`);
    return {
      status: 'error',
      result: {
        mode: 'execute',
        plan: planResult.result,
        mutation: {
          action_response: null,
          is_success: false,
          async_tracking_id: null,
          gaps: [`REST call failed: ${writeResult.message}`]
        },
        post_activation_evidence: null
      },
      warnings,
      errors,
      evidence
    };
  }

  const responseData = Array.isArray(writeResult.data) ? writeResult.data[0] : writeResult.data;
  const isSuccess = responseData?.isSuccess === true;
  const asyncTrackingId = responseData?.outputValues?.requestIdentifier ?? null;
  const actionErrors = responseData?.errors ?? [];
  const gaps: string[] = [];

  // Classification rule (org-proven): a requestIdentifier without record IDs is async-in-progress,
  // NOT an error. Only action-level errors constitute a real failure.
  if (!isSuccess && actionErrors.length > 0) {
    for (const actionError of actionErrors) {
      const msg = [actionError.statusCode, actionError.message].filter(Boolean).join(': ');
      gaps.push(msg || 'Action returned isSuccess=false with no error detail.');
      errors.push(msg || 'Order activation action returned isSuccess=false.');
    }
  } else if (asyncTrackingId) {
    const asyncMessage = `Async activation in progress — requestIdentifier: ${String(asyncTrackingId)}. Re-run inspect-asset-lifecycle after a delay.`;
    gaps.push(asyncMessage);
    warnings.push(asyncMessage);
  } else if (!isSuccess) {
    gaps.push('Action returned isSuccess=false with no errors array.');
    errors.push('Order activation action returned isSuccess=false with no error detail.');
  }

  evidence.push({
    claim: `createOrUpdateAsset${staged ? 'FromOrderItem' : 'FromOrder'} invocable action POSTed for order ${input.orderId}.`,
    evidence_level: 'org_proven',
    proof_source: [`POST ${actionPath}`],
    limitations: `isSuccess=${String(isSuccess)}; ${asyncTrackingId ? `async requestIdentifier=${String(asyncTrackingId)}` : 'synchronous response'}.`,
    source_refs: ['https://developer.salesforce.com/docs/atlas.en-us.revenue_lifecycle_management_dev_guide.meta/revenue_lifecycle_management_dev_guide/actions_obj_create_update_asset_from_order.htm']
  });

  const mutationResult: ActivateOrderMutationResult = {
    action_response: responseData ?? null,
    is_success: isSuccess,
    async_tracking_id: typeof asyncTrackingId === 'string' ? asyncTrackingId : null,
    gaps
  };

  // Auto-run post-activation evidence capture after a successful mutation. An evidence-capture
  // failure never flips a successful activation to error — it is surfaced as a warning.
  let postActivationEvidence: PostActivationEvidencePacket | null = null;
  if (isSuccess) {
    const captureEvidence = input.executeCapturePostActivationEvidence ?? executeCapturePostActivationEvidence;
    try {
      const captureResult = await captureEvidence({
        orgAlias: input.orgAlias,
        orderId: input.orderId,
        ...(input.invokeSfJson === undefined ? {} : { invokeSfJson: input.invokeSfJson }),
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
      });
      if (captureResult.status === 'error') {
        warnings.push(
          `Order activation succeeded but evidence capture failed: ${captureResult.errors.join('; ') || 'unknown error'}; ` +
          `run capture-post-activation-evidence --order-id ${input.orderId} manually.`
        );
      } else {
        postActivationEvidence = captureResult.result.packet;
        warnings.push(...captureResult.warnings);
        evidence.push(...captureResult.evidence);
      }
    } catch (captureError) {
      const message = captureError instanceof Error ? captureError.message : String(captureError);
      warnings.push(
        `Order activation succeeded but evidence capture failed: ${message}; ` +
        `run capture-post-activation-evidence --order-id ${input.orderId} manually.`
      );
    }
  }

  const status: ActivateOrderPrimitiveResult['status'] = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'ok';

  return {
    status,
    result: {
      mode: 'execute',
      plan: planResult.result,
      mutation: mutationResult,
      post_activation_evidence: postActivationEvidence
    },
    warnings,
    errors,
    evidence
  };
}
