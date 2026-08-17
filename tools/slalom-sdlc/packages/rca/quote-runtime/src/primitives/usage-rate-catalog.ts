import { buildSoqlSelect, quoteSoqlIds } from '../integrations/salesforce/soql';
import {
  invokeSfJson,
  type InvokeSfJsonOptions,
  type SfCliJsonResult
} from '../integrations/salesforce/sf-cli';

export type UsageRateDiscoverySummary = {
  product_usage_resource_count: number;
  usage_resources: UsageResourceDiscoverySummary[];
  product_usage_grant_count: number;
  usage_grants: UsageGrantDiscoverySummary[];
  rate_card_entry_count: number;
  rate_card_entries: RateCardEntryDiscoverySummary[];
};

export type UsageResourceDiscoverySummary = {
  product_usage_resource_id: string | null;
  usage_resource_id: string | null;
  usage_resource_name: string | null;
  usage_resource_code: string | null;
  status: string | null;
};

export type UsageGrantDiscoverySummary = {
  product_usage_grant_id: string | null;
  product_id: string | null;
  product_selling_model_id: string | null;
  quantity: number | null;
  type: string | null;
  validity_period_term: number | null;
  validity_period_unit: string | null;
};

export type RateCardEntryDiscoverySummary = {
  rate_card_entry_id: string | null;
  rate_card_id: string | null;
  rate_card_name: string | null;
  usage_resource_id: string | null;
  usage_resource_name: string | null;
  product_selling_model_id: string | null;
  product_selling_model_name: string | null;
  rate: number | null;
  status: string | null;
};

export type UsageRateCatalogDependencies = {
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

export type LoadUsageRateCatalogSummariesInput = UsageRateCatalogDependencies & {
  orgAlias: string;
  productIds: readonly string[];
  timeoutMs?: number;
};

type QueryResponse = {
  records?: unknown[];
};

export async function loadUsageRateCatalogSummaries(
  input: LoadUsageRateCatalogSummariesInput
): Promise<{
  summariesByProductId: Map<string, UsageRateDiscoverySummary>;
  queries: string[];
  warnings: string[];
}> {
  const productIds = uniqueStrings(input.productIds);
  if (productIds.length === 0) {
    return { summariesByProductId: new Map(), queries: [], warnings: [] };
  }

  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const queries = [
    buildProductUsageResourceSoql(productIds),
    buildProductUsageGrantSoql(productIds),
    buildRateCardEntrySoql(productIds)
  ];
  const [usageResult, grantResult, rateResult] = await Promise.all(queries.map((query) =>
    executeSfJson<QueryResponse>({
      args: ['data', 'query', '--target-org', input.orgAlias, '--query', query, '--json'],
      orgAlias: input.orgAlias,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    })
  ));

  const warnings: string[] = [];
  if (usageResult.ok === false) {
    warnings.push(`Usage-rate product usage resource enrichment failed: ${usageResult.message}`);
  }
  if (grantResult.ok === false) {
    warnings.push(`Usage-rate product usage grant enrichment failed: ${grantResult.message}`);
  }
  if (rateResult.ok === false) {
    warnings.push(`Usage-rate rate card entry enrichment failed: ${rateResult.message}`);
  }

  return {
    summariesByProductId: buildSummariesByProductId(productIds, usageResult, grantResult, rateResult),
    queries,
    warnings
  };
}

export function emptyUsageRateSummary(): UsageRateDiscoverySummary {
  return {
    product_usage_resource_count: 0,
    usage_resources: [],
    product_usage_grant_count: 0,
    usage_grants: [],
    rate_card_entry_count: 0,
    rate_card_entries: []
  };
}

export function buildProductUsageResourceSoql(productIds: readonly string[]): string {
  return buildSoqlSelect({
    objectName: 'ProductUsageResource',
    fields: ['Id', 'ProductId', 'UsageResourceId', 'UsageResource.Name', 'UsageResource.Code', 'Status'],
    where: `ProductId IN (${quoteSoqlIds(productIds)})`,
    orderBy: ['ProductId', 'Id'],
    limit: 200
  });
}

export function buildProductUsageGrantSoql(productIds: readonly string[]): string {
  return buildSoqlSelect({
    objectName: 'ProductUsageGrant',
    fields: [
      'Id',
      'ProductId',
      'ProductSellingModelId',
      'Quantity',
      'Type',
      'ValidityPeriodTerm',
      'ValidityPeriodUnit'
    ],
    where: `ProductId IN (${quoteSoqlIds(productIds)})`,
    orderBy: ['ProductId', 'Id'],
    limit: 200
  });
}

export function buildRateCardEntrySoql(productIds: readonly string[]): string {
  return buildSoqlSelect({
    objectName: 'RateCardEntry',
    fields: [
      'Id',
      'RateCardId',
      'RateCard.Name',
      'ProductId',
      'UsageResourceId',
      'UsageResource.Name',
      'ProductSellingModelId',
      'ProductSellingModel.Name',
      'Rate',
      'Status'
    ],
    where: `ProductId IN (${quoteSoqlIds(productIds)})`,
    orderBy: ['ProductId', 'Id'],
    limit: 200
  });
}

function buildSummariesByProductId(
  productIds: readonly string[],
  usageResult: SfCliJsonResult<QueryResponse>,
  grantResult: SfCliJsonResult<QueryResponse>,
  rateResult: SfCliJsonResult<QueryResponse>
): Map<string, UsageRateDiscoverySummary> {
  const usageByProduct = new Map<string, UsageResourceDiscoverySummary[]>();
  if (usageResult.ok === true) {
    for (const record of (usageResult.data.records ?? []).filter(isRecord)) {
      const productId = readString(record.ProductId);
      if (!productId) {
        continue;
      }
      const usage = isRecord(record.UsageResource) ? record.UsageResource : {};
      usageByProduct.set(productId, [
        ...(usageByProduct.get(productId) ?? []),
        {
          product_usage_resource_id: readString(record.Id),
          usage_resource_id: readString(record.UsageResourceId),
          usage_resource_name: readString(usage.Name),
          usage_resource_code: readString(usage.Code),
          status: readString(record.Status)
        }
      ]);
    }
  }

  const grantsByProduct = new Map<string, UsageGrantDiscoverySummary[]>();
  if (grantResult.ok === true) {
    for (const record of (grantResult.data.records ?? []).filter(isRecord)) {
      const productId = readString(record.ProductId);
      if (!productId) {
        continue;
      }
      grantsByProduct.set(productId, [
        ...(grantsByProduct.get(productId) ?? []),
        {
          product_usage_grant_id: readString(record.Id),
          product_id: productId,
          product_selling_model_id: readString(record.ProductSellingModelId),
          quantity: readNumber(record.Quantity),
          type: readString(record.Type),
          validity_period_term: readNumber(record.ValidityPeriodTerm),
          validity_period_unit: readString(record.ValidityPeriodUnit)
        }
      ]);
    }
  }

  const ratesByProduct = new Map<string, RateCardEntryDiscoverySummary[]>();
  if (rateResult.ok === true) {
    for (const record of (rateResult.data.records ?? []).filter(isRecord)) {
      const productId = readString(record.ProductId);
      if (!productId) {
        continue;
      }
      const usage = isRecord(record.UsageResource) ? record.UsageResource : {};
      const rateCard = isRecord(record.RateCard) ? record.RateCard : {};
      const sellingModel = isRecord(record.ProductSellingModel) ? record.ProductSellingModel : {};
      ratesByProduct.set(productId, [
        ...(ratesByProduct.get(productId) ?? []),
        {
          rate_card_entry_id: readString(record.Id),
          rate_card_id: readString(record.RateCardId),
          rate_card_name: readString(rateCard.Name),
          usage_resource_id: readString(record.UsageResourceId),
          usage_resource_name: readString(usage.Name),
          product_selling_model_id: readString(record.ProductSellingModelId),
          product_selling_model_name: readString(sellingModel.Name),
          rate: readNumber(record.Rate),
          status: readString(record.Status)
        }
      ]);
    }
  }

  return new Map(productIds.map((productId) => {
    const usageResources = usageByProduct.get(productId) ?? [];
    const usageGrants = grantsByProduct.get(productId) ?? [];
    const rateEntries = ratesByProduct.get(productId) ?? [];
    return [
      productId,
      {
        product_usage_resource_count: usageResources.length,
        usage_resources: usageResources,
        product_usage_grant_count: usageGrants.length,
        usage_grants: usageGrants,
        rate_card_entry_count: rateEntries.length,
        rate_card_entries: rateEntries
      }
    ];
  }));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
