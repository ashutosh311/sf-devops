export const QUOTE_SNAPSHOT_FIELDS = [
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
] as const;

export const QUOTE_LINE_ITEM_SNAPSHOT_FIELDS = [
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
] as const;

export const QUOTE_ACTION_OVERLAY_FIELDS = [
  'Id',
  'QuoteId',
  'Type',
  'Subtype',
  'SourceAssetId',
  'CreatedDate',
  'LastModifiedDate'
] as const;

export const QUOTE_LINE_RELATIONSHIP_OVERLAY_FIELDS = [
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
] as const;

export const PRIMARY_RLM_CONTEXT_ARTIFACT_NAME = 'RLM_SalesTransactionContext';

export const RLM_CONTEXT_MAPPING_SUBSET = [
  'QuoteEntitiesMapping -> SalesTransaction -> Quote',
  'QuoteEntitiesMapping -> SalesTransactionAction -> QuoteAction',
  'QuoteEntitiesMapping -> SalesTransactionItem -> QuoteLineItem',
  'QuoteEntitiesMapping -> SalesTransactionItemDetail -> QuoteLineDetail',
  'QuoteEntitiesMapping -> SalesTrxnItemRelationship -> QuoteLineRelationship'
] as const;

export type QueryField =
  | (typeof QUOTE_SNAPSHOT_FIELDS)[number]
  | (typeof QUOTE_LINE_ITEM_SNAPSHOT_FIELDS)[number]
  | (typeof QUOTE_ACTION_OVERLAY_FIELDS)[number]
  | (typeof QUOTE_LINE_RELATIONSHIP_OVERLAY_FIELDS)[number];

export type RlmContextMappingPath = (typeof RLM_CONTEXT_MAPPING_SUBSET)[number];
