import type { EvidenceItem } from '../contracts/evidence';
import type { JsonValue } from '../contracts/result-envelope';
import type { RuntimeStatus } from '../contracts/status';
import {
  invokeSfJson,
  type InvokeSfJsonOptions,
  type SfCliJsonResult
} from '../integrations/salesforce/sf-cli';
import {
  invokeSfRestWrite,
  type InvokeSfRestWriteOptions,
  type SfRestWriteResult
} from '../integrations/salesforce/rest';
import { buildSoqlSelect, escapeSoqlStringLiteral } from '../integrations/salesforce/soql';
import {
  emptyUsageRateSummary,
  loadUsageRateCatalogSummaries,
  type UsageRateDiscoverySummary
} from './usage-rate-catalog';

export {
  buildProductUsageGrantSoql,
  buildProductUsageResourceSoql,
  buildRateCardEntrySoql
} from './usage-rate-catalog';

export type {
  RateCardEntryDiscoverySummary,
  UsageGrantDiscoverySummary,
  UsageRateDiscoverySummary,
  UsageResourceDiscoverySummary
} from './usage-rate-catalog';

export const PRODUCTS_LIST_ROUTE = '/services/data/v66.0/connect/cpq/products';

export type ProductDiscoveryCandidate = {
  product_id: string;
  name: string;
  product_code: string | null;
  node_type: string | null;
  pricebook_entry_id: string | null;
  pricebook_id: string;
  unit_price: number | null;
  currency_iso_code: string | null;
  product_selling_model_id: string | null;
  product_selling_model_name: string | null;
  selling_model_type: string | null;
  pricing_term: number | null;
  pricing_term_unit: string | null;
  usage_rate_summary: UsageRateDiscoverySummary;
  match_reason: string;
  confidence: 'high' | 'medium' | 'low';
  usable: boolean;
  blockers: string[];
};

export type ProductDiscoveryResult = {
  strategy: 'products_list' | 'soql_fallback';
  terms: string[];
  candidates: ProductDiscoveryCandidate[];
  omitted_count: number;
};

export type ProductDiscoveryPrimitiveResult = {
  status: Extract<RuntimeStatus, 'ok' | 'no_match' | 'unsupported' | 'error'>;
  result: ProductDiscoveryResult;
  warnings: string[];
  errors: string[];
  evidence: EvidenceItem[];
};

export type ProductDiscoveryDependencies = {
  invokeSfRestWrite?: <T>(options: InvokeSfRestWriteOptions) => Promise<SfRestWriteResult<T>>;
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

export type ExecuteDiscoverProductsInput = ProductDiscoveryDependencies & {
  orgAlias: string;
  pricebookId: string;
  terms: string[];
  catalogId?: string | null;
  categoryId?: string | null;
  accountId?: string | null;
  currencyCode?: string | null;
  limit?: number;
  timeoutMs?: number;
};

type ProductsListResponse = {
  result?: unknown[];
};

type QueryResponse = {
  records?: unknown[];
};

export async function executeDiscoverProducts(input: ExecuteDiscoverProductsInput): Promise<ProductDiscoveryPrimitiveResult> {
  const limit = normalizeLimit(input.limit);
  const shouldUseProductsList = Boolean(input.catalogId || input.categoryId);
  const writeRest = input.invokeSfRestWrite ?? invokeSfRestWrite;
  const listResponse = shouldUseProductsList
    ? await writeRest<ProductsListResponse>({
      orgAlias: input.orgAlias,
      path: PRODUCTS_LIST_ROUTE,
      method: 'POST',
      body: buildProductsListBody(input, limit),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    })
    : null;

  if (listResponse?.ok && Array.isArray(listResponse.data.result) && listResponse.data.result.length > 0) {
    const candidates = listResponse.data.result.flatMap((record) => normalizeProductsListCandidate(record, input.pricebookId)).slice(0, limit);
    const enriched = await enrichCandidatesWithUsageRate(input, candidates);
    return buildDiscoveryResult(input, 'products_list', enriched.candidates, Math.max(0, listResponse.data.result.length - candidates.length), enriched.warnings);
  }

  const executeSfJson = input.invokeSfJson ?? invokeSfJson;
  const query = buildProductFallbackSoql(input.pricebookId, input.terms, limit, input.currencyCode ?? null);
  const soqlResponse = await executeSfJson<QueryResponse>({
    args: ['data', 'query', '--target-org', input.orgAlias, '--query', query, '--json'],
    orgAlias: input.orgAlias,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
  });

  if (soqlResponse.ok === false) {
    return {
      status: listResponse?.ok || listResponse === null ? 'error' : mapFailure(listResponse.classification),
      result: {
        strategy: 'soql_fallback',
        terms: input.terms,
        candidates: [],
        omitted_count: 0
      },
      warnings: listResponse === null
        ? ['Products List API was skipped because neither --catalog-id nor --category-id was provided.']
        : listResponse.ok
          ? ['Products List returned no candidates before SOQL fallback failed.']
          : [listResponse.message],
      errors: [soqlResponse.message],
      evidence: []
    };
  }

  const records = soqlResponse.data.records ?? [];
  const candidates = records.flatMap((record) => normalizeSoqlCandidate(record, input.pricebookId)).slice(0, limit);
  const enriched = await enrichCandidatesWithUsageRate(input, candidates);
  return buildDiscoveryResult(input, 'soql_fallback', enriched.candidates, Math.max(0, records.length - candidates.length), [
    ...(listResponse === null
      ? ['Products List API was skipped because neither --catalog-id nor --category-id was provided.']
      : [listResponse.ok ? 'Products List returned no candidates; used SOQL fallback.' : `Products List failed before fallback: ${listResponse.message}`]),
    ...enriched.warnings
  ]);
}

export function buildProductsListBody(input: ExecuteDiscoverProductsInput, limit: number): Record<string, JsonValue> {
  return {
    limit,
    priceBookId: input.pricebookId,
    ...(input.catalogId ? { catalogId: input.catalogId } : {}),
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    ...(input.accountId ? { userContext: { accountId: input.accountId } } : {}),
    ...(input.currencyCode ? { currencyCode: input.currencyCode } : {}),
    includeCatalogDetails: true,
    enablePricing: true,
    enableQualification: true,
    filter: {
      criteria: input.terms.map((term) => ({
        property: 'name',
        operator: 'like',
        value: `%${term}%`
      }))
    }
  };
}

export function buildProductFallbackSoql(pricebookId: string, terms: readonly string[], limit: number, currencyCode?: string | null): string {
  const termFilters = terms.length === 0
    ? ''
    : ` AND (${terms.map((term) => `(Product2.Name LIKE '%${escapeSoqlStringLiteral(term)}%' OR Product2.ProductCode LIKE '%${escapeSoqlStringLiteral(term)}%')`).join(' OR ')})`;
  const currencyFilter = currencyCode ? ` AND CurrencyIsoCode = '${escapeSoqlStringLiteral(currencyCode)}'` : '';
  return buildSoqlSelect({
    objectName: 'PricebookEntry',
    fields: [
      'Id',
      'Product2Id',
      'Product2.Name',
      'Product2.ProductCode',
      'Product2.Type',
      'Pricebook2Id',
      'IsActive',
      'UnitPrice',
      'ProductSellingModelId',
      'ProductSellingModel.Name',
      'ProductSellingModel.SellingModelType',
      'ProductSellingModel.PricingTerm',
      'ProductSellingModel.PricingTermUnit'
    ],
    where: `Pricebook2Id = '${escapeSoqlStringLiteral(pricebookId)}' AND IsActive = true${currencyFilter}${termFilters}`,
    orderBy: 'Product2.Name ASC',
    limit
  });
}

function buildDiscoveryResult(
  input: ExecuteDiscoverProductsInput,
  strategy: ProductDiscoveryResult['strategy'],
  candidates: ProductDiscoveryCandidate[],
  omittedCount: number,
  warnings: string[]
): ProductDiscoveryPrimitiveResult {
  return {
    status: candidates.length > 0 ? 'ok' : 'no_match',
    result: {
      strategy,
      terms: input.terms,
      candidates,
      omitted_count: omittedCount
    },
    warnings,
    errors: [],
    evidence: [
      {
        claim: `Discovered ${candidates.length} product candidate(s) using ${strategy}.`,
        evidence_level: strategy === 'products_list' ? 'org_proven' : 'repo_proven',
        proof_source: [strategy === 'products_list' ? PRODUCTS_LIST_ROUTE : buildProductFallbackSoql(input.pricebookId, input.terms, normalizeLimit(input.limit), input.currencyCode ?? null)],
        limitations: 'Products List can return empty results in ARMAF; SOQL fallback remains part of the contract.',
        source_refs: []
      }
    ]
  };
}

function normalizeProductsListCandidate(value: unknown, pricebookId: string): ProductDiscoveryCandidate[] {
  if (!isRecord(value)) {
    return [];
  }
  const product = isRecord(value.product) ? value.product : value;
  const id = readString(product.id) ?? readString(value.productId);
  const name = readString(product.name) ?? readString(value.productName);
  if (!id || !name) {
    return [];
  }
  return [{
    product_id: id,
    name,
    product_code: readString(product.productCode) ?? readString(product.ProductCode) ?? readString(value.productCode),
    node_type: readString(product.nodeType) ?? readString(value.nodeType),
    pricebook_entry_id: readPricebookEntryId(value),
    pricebook_id: pricebookId,
    unit_price: readNumber(value.unitPrice) ?? readNumber(value.UnitPrice) ?? readFirstPriceNumber(value, 'unitPrice'),
    currency_iso_code: readString(value.currencyIsoCode) ?? readString(value.CurrencyIsoCode) ?? readFirstPriceString(value, 'currencyIsoCode'),
    product_selling_model_id: readString(value.productSellingModelId) ?? readString(value.ProductSellingModelId) ?? readFirstPriceString(value, 'productSellingModelId'),
    product_selling_model_name: readString(value.productSellingModelName) ?? readString(value.ProductSellingModelName) ?? readFirstPriceString(value, 'productSellingModelName'),
    selling_model_type: readString(value.sellingModelType) ?? readString(value.SellingModelType),
    pricing_term: readNumber(value.pricingTerm) ?? readNumber(value.PricingTerm),
    pricing_term_unit: readString(value.pricingTermUnit) ?? readString(value.PricingTermUnit),
    usage_rate_summary: emptyUsageRateSummary(),
    match_reason: 'Returned by Product Discovery Products List API.',
    confidence: 'medium',
    usable: true,
    blockers: []
  }];
}

function normalizeSoqlCandidate(value: unknown, pricebookId: string): ProductDiscoveryCandidate[] {
  if (!isRecord(value)) {
    return [];
  }
  const product = isRecord(value.Product2) ? value.Product2 : {};
  const sellingModel = isRecord(value.ProductSellingModel) ? value.ProductSellingModel : {};
  const productId = readString(value.Product2Id);
  const name = readString(product.Name);
  if (!productId || !name) {
    return [];
  }
  return [{
    product_id: productId,
    name,
    product_code: readString(product.ProductCode),
    node_type: readString(product.Type),
    pricebook_entry_id: readString(value.Id),
    pricebook_id: pricebookId,
    unit_price: readNumber(value.UnitPrice),
    currency_iso_code: readString(value.CurrencyIsoCode),
    product_selling_model_id: readString(value.ProductSellingModelId),
    product_selling_model_name: readString(sellingModel.Name),
    selling_model_type: readString(sellingModel.SellingModelType),
    pricing_term: readNumber(sellingModel.PricingTerm),
    pricing_term_unit: readString(sellingModel.PricingTermUnit),
    usage_rate_summary: emptyUsageRateSummary(),
    match_reason: 'Matched active PricebookEntry/Product2 SOQL fallback.',
    confidence: 'medium',
    usable: true,
    blockers: []
  }];
}

async function enrichCandidatesWithUsageRate(
  input: ExecuteDiscoverProductsInput,
  candidates: ProductDiscoveryCandidate[]
): Promise<{ candidates: ProductDiscoveryCandidate[]; warnings: string[] }> {
  if (candidates.length === 0) {
    return { candidates, warnings: [] };
  }

  const usageRate = await loadUsageRateCatalogSummaries({
    orgAlias: input.orgAlias,
    productIds: candidates.map((candidate) => candidate.product_id),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.invokeSfJson === undefined ? {} : { invokeSfJson: input.invokeSfJson })
  });

  return {
    candidates: candidates.map((candidate) => ({
      ...candidate,
      usage_rate_summary: usageRate.summariesByProductId.get(candidate.product_id) ?? emptyUsageRateSummary()
    })),
    warnings: usageRate.warnings
  };
}

function readPricebookEntryId(value: Record<string, unknown>): string | null {
  const prices = Array.isArray(value.prices) ? value.prices : [];
  for (const price of prices) {
    if (isRecord(price)) {
      const id = readString(price.priceBookEntryId);
      if (id) {
        return id;
      }
    }
  }
  return null;
}

function readFirstPriceString(value: Record<string, unknown>, key: string): string | null {
  const prices = Array.isArray(value.prices) ? value.prices : [];
  for (const price of prices) {
    if (isRecord(price)) {
      const result = readString(price[key]);
      if (result) {
        return result;
      }
    }
  }
  return null;
}

function readFirstPriceNumber(value: Record<string, unknown>, key: string): number | null {
  const prices = Array.isArray(value.prices) ? value.prices : [];
  for (const price of prices) {
    if (isRecord(price)) {
      const result = readNumber(price[key]);
      if (result !== null) {
        return result;
      }
    }
  }
  return null;
}

function normalizeLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? 10, 1), 25);
}

function mapFailure(classification: string): Extract<RuntimeStatus, 'unsupported' | 'error'> {
  return classification === 'auth' || classification === 'unavailable' ? 'unsupported' : 'error';
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
