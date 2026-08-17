import { describe, expect, it } from 'vitest';

import {
  PRIMARY_RLM_CONTEXT_ARTIFACT_NAME,
  QUOTE_ACTION_OVERLAY_FIELDS,
  QUOTE_LINE_ITEM_SNAPSHOT_FIELDS,
  QUOTE_LINE_RELATIONSHIP_OVERLAY_FIELDS,
  QUOTE_SNAPSHOT_FIELDS,
  RLM_CONTEXT_MAPPING_SUBSET
} from '../../src/contracts/query-fields';

describe('query field contracts', () => {
  it('locks the quote snapshot field set exactly', () => {
    expect(QUOTE_SNAPSHOT_FIELDS).toEqual([
      'Id',
      'Name',
      'QuoteNumber',
      'Pricebook2Id',
      'Status',
      'CalculationStatus',
      'StartDate',
      'ExpirationDate',
      'Subtotal',
      'TotalPrice',
      'TotalTaxAmount',
      'TotalPriceWithTax',
      'GrandTotal',
      'LineItemCount',
      'OriginalActionType',
      'CreatedDate',
      'LastModifiedDate'
    ]);
  });

  it('locks the quote line item snapshot field set exactly', () => {
    expect(QUOTE_LINE_ITEM_SNAPSHOT_FIELDS).toEqual([
      'Id',
      'QuoteId',
      'LineNumber',
      'Product2Id',
      'PricebookEntryId',
      'ParentQuoteLineItemId',
      'Quantity',
      'StartQuantity',
      'EndQuantity',
      'UnitPrice',
      'ListPrice',
      'NetUnitPrice',
      'NetTotalPrice',
      'Subtotal',
      'TotalPrice',
      'TotalLineAmount',
      'TotalAdjustmentAmount',
      'SellingModelType',
      'StartDate',
      'EndDate',
      'PriceWaterfallIdentifier',
      'QuoteActionId',
      'QuoteAction.Type',
      'QuoteAction.SourceAssetId',
      'CreatedDate',
      'LastModifiedDate'
    ]);
  });

  it('locks the quote action overlay field set exactly', () => {
    expect(QUOTE_ACTION_OVERLAY_FIELDS).toEqual([
      'Id',
      'QuoteId',
      'Type',
      'Subtype',
      'SourceAssetId',
      'CreatedDate',
      'LastModifiedDate'
    ]);
  });

  it('locks the quote line relationship overlay field set exactly', () => {
    expect(QUOTE_LINE_RELATIONSHIP_OVERLAY_FIELDS).toEqual([
      'Id',
      'QuoteId',
      'MainQuoteLineId',
      'MainQuoteLine.LineNumber',
      'MainQuoteLine.TotalPrice',
      'AssociatedQuoteLineId',
      'AssociatedQuoteLine.LineNumber',
      'AssociatedQuoteLine.TotalPrice',
      'MainQuoteLineRole',
      'AssociatedQuoteLineRole',
      'AssociatedQuoteLinePricing',
      'AssociatedQuantScaleMethod',
      'RootQuoteLineId',
      'ProductRelationshipTypeId',
      'ProductRelatedComponentId',
      'IsPriceInclusive'
    ]);
  });

  it('locks the primary RLM context artifact and mapping subset exactly', () => {
    expect(PRIMARY_RLM_CONTEXT_ARTIFACT_NAME).toBe('RLM_SalesTransactionContext');
    expect(RLM_CONTEXT_MAPPING_SUBSET).toEqual([
      'QuoteEntitiesMapping -> SalesTransaction -> Quote',
      'QuoteEntitiesMapping -> SalesTransactionAction -> QuoteAction',
      'QuoteEntitiesMapping -> SalesTransactionItem -> QuoteLineItem',
      'QuoteEntitiesMapping -> SalesTransactionItemDetail -> QuoteLineDetail',
      'QuoteEntitiesMapping -> SalesTrxnItemRelationship -> QuoteLineRelationship'
    ]);
  });
});
