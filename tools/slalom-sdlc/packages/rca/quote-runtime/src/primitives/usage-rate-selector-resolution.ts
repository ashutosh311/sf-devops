import { buildSoqlSelect, quoteSoqlId, quoteSoqlIds } from '../integrations/salesforce/soql';
import {
  invokeSfJson,
  type InvokeSfJsonOptions,
  type SfCliJsonResult
} from '../integrations/salesforce/sf-cli';
import {
  buildQuoteLineRateCardEntryGraphRecord,
  buildQuoteLineUsageResourceGrantGraphRecord,
  type PstGraphRecord
} from './quote-mutations';

export type UsageRateSelectorGrantInput = {
  quote_line_usage_grant_id?: string;
  quoteLineUsageGrantId?: string;
  product_usage_grant_id?: string;
  productUsageGrantId?: string;
  product_usage_resource_policy_id?: string;
  productUsageResourcePolicyId?: string;
  usage_resource_id?: string;
  usageResourceId?: string;
  grant_type?: string;
  grantType?: string;
  grant_quantity?: number;
  grantQuantity?: number;
  validity_period_term?: number;
  validityPeriodTerm?: number;
  validity_period_unit?: string;
  validityPeriodUnit?: string;
};

export type UsageRateSelectorInput = {
  usage_resource_id?: string;
  usage_resource_code?: string;
  rate_card_id?: string;
  rate_card_entry_id?: string;
  product_selling_model_id?: string;
  expected_rate?: number;
  rating_quantity?: number;
  unit_of_measure_id?: string;
  negotiated_rate?: number | null;
  negotiatedRate?: number | null;
  grants?: UsageRateSelectorGrantInput[];
};

export type UsageRateSelectorLineInput = {
  operation?: string;
  lineId?: string | null;
  line_id?: string | null;
  product2Id?: string | null;
  product_id?: string | null;
  pricebookEntryId?: string | null;
  pricebook_entry_id?: string | null;
  usage?: UsageRateSelectorInput;
};

export type UsageRateSelectorContext = {
  line_index: number;
  product_id: string;
  pricebook_entry_id: string | null;
  product_selling_model_id: string | null;
  usage_resource_id: string | null;
  rate_card_id: string | null;
  rate_card_entry_id: string | null;
  rate_card_entry_product_selling_model_id: string | null;
  rate: number | null;
};

export type UsageRateSelectorDependencies = {
  invokeSfJson?: <T>(options: InvokeSfJsonOptions) => Promise<SfCliJsonResult<T>>;
};

type UsageRateSelectorRow = {
  Id?: string;
  ProductId?: string;
  UsageResourceId?: string;
  RateCardId?: string;
  ProductSellingModelId?: string;
  Rate?: number;
  Status?: string;
};

type UsageProductSellingModelRow = {
  Id?: string;
  Product2Id?: string;
  ProductSellingModelId?: string;
};

type UsageProductGrantRow = {
  Id?: string;
  ProductId?: string;
  ProductSellingModelId?: string | null;
  Type?: string | null;
  Quantity?: number | null;
  ValidityPeriodTerm?: number | null;
  ValidityPeriodUnit?: string | null;
};

export async function resolveUsageRateSelectors(input: {
  orgAlias: string;
  lines: readonly UsageRateSelectorLineInput[];
  dependencies?: UsageRateSelectorDependencies;
}): Promise<UsageRateSelectorContext[]> {
  const contexts: UsageRateSelectorContext[] = [];
  const usageLines = input.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.operation !== 'delete' && line.usage !== undefined);

  for (const { line, index } of usageLines) {
    const usage = line.usage;
    if (!usage) {
      continue;
    }
    const productId = line.product2Id ?? line.product_id;
    if (!productId) {
      throw new Error(`Line ${index + 1} usage selector requires resolved product_id before mutation.`);
    }
    if (!usage.usage_resource_id && !usage.rate_card_entry_id) {
      throw new Error(`Line ${index + 1} usage selector requires usage_resource_id or rate_card_entry_id.`);
    }

    const pricebookEntryId = line.pricebookEntryId ?? line.pricebook_entry_id ?? null;
    const productSellingModelId = await resolveLineProductSellingModel({
      orgAlias: input.orgAlias,
      productId,
      pricebookEntryId,
      requestedProductSellingModelId: usage.product_selling_model_id ?? null,
      lineIndex: index,
      dependencies: input.dependencies
    });
    let productUsageRow: UsageRateSelectorRow | null = null;
    let rateRow: UsageRateSelectorRow | null = null;

    if (usage.usage_resource_id) {
      const productUsageRows = await runQuery<UsageRateSelectorRow>(
        input.orgAlias,
        buildSoqlSelect({
          objectName: 'ProductUsageResource',
          fields: ['Id', 'ProductId', 'UsageResourceId', 'Status'],
          where: `ProductId = ${quoteSoqlId(productId)} AND UsageResourceId = ${quoteSoqlId(usage.usage_resource_id)}`,
          limit: 1
        }),
        input.dependencies
      );
      if (productUsageRows.length === 0) {
        throw new Error(`Line ${index + 1} usage selector did not resolve a ProductUsageResource for product ${productId} and usage resource ${usage.usage_resource_id}.`);
      }
      productUsageRow = productUsageRows[0] ?? null;
      if (productUsageRow?.Status && productUsageRow.Status !== 'Active') {
        throw new Error(`Line ${index + 1} ProductUsageResource for usage resource ${usage.usage_resource_id} is ${productUsageRow.Status}; expected Active.`);
      }
    }

    if (usage.rate_card_entry_id) {
      const clauses = [`Id = ${quoteSoqlId(usage.rate_card_entry_id)}`, `ProductId = ${quoteSoqlId(productId)}`];
      if (usage.usage_resource_id) {
        clauses.push(`UsageResourceId = ${quoteSoqlId(usage.usage_resource_id)}`);
      }
      if (usage.rate_card_id) {
        clauses.push(`RateCardId = ${quoteSoqlId(usage.rate_card_id)}`);
      }
      if (usage.product_selling_model_id) {
        clauses.push(`ProductSellingModelId = ${quoteSoqlId(usage.product_selling_model_id)}`);
      }
      const rateRows = await runQuery<UsageRateSelectorRow>(
        input.orgAlias,
        buildSoqlSelect({
          objectName: 'RateCardEntry',
          fields: ['Id', 'ProductId', 'UsageResourceId', 'RateCardId', 'ProductSellingModelId', 'Rate', 'Status'],
          where: clauses.join(' AND '),
          limit: 1
        }),
        input.dependencies
      );
      if (rateRows.length === 0) {
        throw new Error(`Line ${index + 1} usage selector did not resolve RateCardEntry ${usage.rate_card_entry_id} for product ${productId}.`);
      }
      rateRow = rateRows[0] ?? null;
      if (rateRow?.Status && rateRow.Status !== 'Active') {
        throw new Error(`Line ${index + 1} RateCardEntry ${usage.rate_card_entry_id} is ${rateRow.Status}; expected Active.`);
      }
      if (productSellingModelId && rateRow?.ProductSellingModelId && productSellingModelId !== rateRow.ProductSellingModelId) {
        throw new Error(`Line ${index + 1} product selling model mismatch: PricebookEntry uses ${productSellingModelId} but RateCardEntry uses ${rateRow.ProductSellingModelId}.`);
      }
    }

    await validateUsageGrants({
      orgAlias: input.orgAlias,
      productId,
      productSellingModelId,
      usage,
      lineIndex: index,
      dependencies: input.dependencies
    });

    contexts.push({
      line_index: index,
      product_id: productId,
      pricebook_entry_id: pricebookEntryId,
      product_selling_model_id: productSellingModelId,
      usage_resource_id: usage.usage_resource_id ?? productUsageRow?.UsageResourceId ?? rateRow?.UsageResourceId ?? null,
      rate_card_id: usage.rate_card_id ?? rateRow?.RateCardId ?? null,
      rate_card_entry_id: usage.rate_card_entry_id ?? rateRow?.Id ?? null,
      rate_card_entry_product_selling_model_id: rateRow?.ProductSellingModelId ?? null,
      rate: typeof rateRow?.Rate === 'number' ? rateRow.Rate : null
    });
  }

  return contexts;
}

export function buildUsageRateChildRecords(lines: readonly UsageRateSelectorLineInput[]): PstGraphRecord[] {
  const records: PstGraphRecord[] = [];
  let usageGrantIndex = 0;

  lines.forEach((line, lineIndex) => {
    const usage = line.usage;
    if (!usage) {
      return;
    }

    const quoteLineIdentifier = line.lineId ?? line.line_id ?? `@{line${lineIndex + 1}.id}`;
    if (usage.rate_card_entry_id) {
      records.push(buildQuoteLineRateCardEntryGraphRecord({
        quoteLineItemId: line.lineId ?? line.line_id ?? null,
        quoteLineItemReference: line.lineId || line.line_id ? null : quoteLineIdentifier,
        rateCardEntryId: usage.rate_card_entry_id,
        negotiatedRate: usage.negotiated_rate ?? usage.negotiatedRate ?? null
      }, lineIndex));
    }

    for (const grant of usage.grants ?? []) {
      records.push(buildQuoteLineUsageResourceGrantGraphRecord({
        quoteLineUsageGrantId: grant.quote_line_usage_grant_id ?? grant.quoteLineUsageGrantId ?? null,
        quoteLineItemId: line.lineId ?? line.line_id ?? null,
        quoteLineItemReference: line.lineId || line.line_id ? null : quoteLineIdentifier,
        usageResourceId: grant.usage_resource_id ?? grant.usageResourceId ?? usage.usage_resource_id ?? '',
        productUsageGrantId: grant.product_usage_grant_id ?? grant.productUsageGrantId ?? null,
        productUsageResourcePolicyId: grant.product_usage_resource_policy_id ?? grant.productUsageResourcePolicyId ?? null,
        grantType: grant.grant_type ?? grant.grantType ?? null,
        grantQuantity: grant.grant_quantity ?? grant.grantQuantity ?? null,
        validityPeriodTerm: grant.validity_period_term ?? grant.validityPeriodTerm ?? null,
        validityPeriodUnit: grant.validity_period_unit ?? grant.validityPeriodUnit ?? null
      }, usageGrantIndex));
      usageGrantIndex += 1;
    }
  });

  return records;
}

async function validateUsageGrants(input: {
  orgAlias: string;
  productId: string;
  productSellingModelId: string | null;
  usage: UsageRateSelectorInput;
  lineIndex: number;
  dependencies?: UsageRateSelectorDependencies;
}): Promise<void> {
  const grants = input.usage.grants ?? [];

  // Collect grants that have an ID, preserving original index for error messages.
  const grantsWithId = grants
    .map((grant, grantIndex) => ({ grant, grantIndex, productUsageGrantId: grant.product_usage_grant_id ?? grant.productUsageGrantId ?? null }))
    .filter((g): g is { grant: typeof g.grant; grantIndex: number; productUsageGrantId: string } => g.productUsageGrantId !== null);

  if (grantsWithId.length === 0) {
    return;
  }

  const ids = grantsWithId.map((g) => g.productUsageGrantId);
  const productUsageGrantRows = await runQuery<UsageProductGrantRow>(
    input.orgAlias,
    buildSoqlSelect({
      objectName: 'ProductUsageGrant',
      fields: ['Id', 'ProductId', 'ProductSellingModelId', 'Type', 'Quantity', 'ValidityPeriodTerm', 'ValidityPeriodUnit'],
      where: `Id IN (${quoteSoqlIds(ids)}) AND ProductId = ${quoteSoqlId(input.productId)}`
    }),
    input.dependencies
  );
  const grantMap = new Map(productUsageGrantRows.map((r) => [r.Id, r]));

  for (const { grant, grantIndex, productUsageGrantId } of grantsWithId) {
    const productUsageGrant = grantMap.get(productUsageGrantId) ?? null;
    if (!productUsageGrant) {
      throw new Error(`Line ${input.lineIndex + 1} usage grant ${grantIndex + 1} did not resolve ProductUsageGrant ${productUsageGrantId} for product ${input.productId}.`);
    }
    if (input.productSellingModelId && productUsageGrant.ProductSellingModelId && productUsageGrant.ProductSellingModelId !== input.productSellingModelId) {
      throw new Error(`Line ${input.lineIndex + 1} usage grant ${grantIndex + 1} product selling model mismatch: PricebookEntry uses ${input.productSellingModelId} but ProductUsageGrant uses ${productUsageGrant.ProductSellingModelId}.`);
    }
    const grantType = grant.grant_type ?? grant.grantType ?? null;
    if (grantType && productUsageGrant.Type && productUsageGrant.Type !== grantType) {
      throw new Error(`Line ${input.lineIndex + 1} usage grant ${grantIndex + 1} type mismatch: intent uses ${grantType} but ProductUsageGrant uses ${productUsageGrant.Type}.`);
    }
  }
}

async function resolveLineProductSellingModel(input: {
  orgAlias: string;
  productId: string;
  pricebookEntryId: string | null;
  requestedProductSellingModelId: string | null;
  lineIndex: number;
  dependencies?: UsageRateSelectorDependencies;
}): Promise<string | null> {
  if (!input.pricebookEntryId) {
    return input.requestedProductSellingModelId;
  }

  const rows = await runQuery<UsageProductSellingModelRow>(
    input.orgAlias,
    buildSoqlSelect({
      objectName: 'PricebookEntry',
      fields: ['Id', 'Product2Id', 'ProductSellingModelId'],
      where: `Id = ${quoteSoqlId(input.pricebookEntryId)} AND Product2Id = ${quoteSoqlId(input.productId)}`,
      limit: 1
    }),
    input.dependencies
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`Line ${input.lineIndex + 1} usage selector did not resolve PricebookEntry ${input.pricebookEntryId} for product ${input.productId}.`);
  }
  const productSellingModelId = row.ProductSellingModelId ?? null;
  if (input.requestedProductSellingModelId && productSellingModelId && input.requestedProductSellingModelId !== productSellingModelId) {
    throw new Error(`Line ${input.lineIndex + 1} product selling model mismatch: usage selector requested ${input.requestedProductSellingModelId} but PricebookEntry uses ${productSellingModelId}.`);
  }
  return productSellingModelId ?? input.requestedProductSellingModelId;
}

async function runQuery<T>(
  orgAlias: string,
  soql: string,
  dependencies?: UsageRateSelectorDependencies
): Promise<T[]> {
  const executeSfJson = dependencies?.invokeSfJson ?? invokeSfJson;
  const result = await executeSfJson<{ records?: T[] }>({
    args: ['data', 'query', '--target-org', orgAlias, '--query', soql, '--json'],
    orgAlias
  });

  if (result.ok === false) {
    throw new Error(result.message);
  }

  return Array.isArray(result.data.records) ? result.data.records : [];
}
