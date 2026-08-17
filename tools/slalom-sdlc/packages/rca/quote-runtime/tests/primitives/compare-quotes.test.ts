import { describe, expect, it } from 'vitest';

import {
  compareQuotes,
  type CompareQuotesInput,
  type CompareQuotesResult
} from '../../src/primitives/compare-quotes';
import type { SnapshotLineRecord } from '../../src/primitives/snapshot-lines';

function makeLine(overrides: Partial<SnapshotLineRecord> = {}): SnapshotLineRecord {
  return {
    Id: '0QLxx0000000001AAA',
    QuoteId: '0Q0xx0000000001AAA',
    LineNumber: 10,
    Product2Id: '01txx0000000001AAA',
    PricebookEntryId: '01uxx0000000001AAA',
    ParentQuoteLineItemId: null,
    Quantity: 1,
    StartQuantity: 1,
    EndQuantity: 1,
    UnitPrice: 100,
    ListPrice: 100,
    NetUnitPrice: 100,
    NetTotalPrice: 100,
    Subtotal: 100,
    TotalPrice: 100,
    TotalLineAmount: 100,
    TotalAdjustmentAmount: 0,
    SellingModelType: 'OneTime',
    StartDate: '2026-04-01',
    EndDate: '2026-04-30',
    PriceWaterfallIdentifier: 'PW-1',
    QuoteActionId: null,
    'QuoteAction.Type': null,
    'QuoteAction.SourceAssetId': null,
    CreatedDate: '2026-04-01T00:00:00.000+0000',
    LastModifiedDate: '2026-04-01T00:00:00.000+0000',
    ...overrides
  };
}

function makeSnapshot(args: {
  quoteId: string;
  quoteName: string;
  totalPrice?: number;
  lines: SnapshotLineRecord[];
}): CompareQuotesInput {
  return {
    quote: {
      Id: args.quoteId,
      Name: args.quoteName,
      QuoteNumber: args.quoteId === '0Q0xx0000000001AAA' ? 'Q-0001' : 'Q-0002',
      Pricebook2Id: '01sxx0000000001AAA',
      Status: 'Draft',
      CalculationStatus: 'Calculated',
      StartDate: '2026-04-01',
      ExpirationDate: '2026-04-30',
      Subtotal: args.totalPrice ?? 100,
      TotalPrice: args.totalPrice ?? 100,
      TotalTaxAmount: 10,
      TotalPriceWithTax: (args.totalPrice ?? 100) + 10,
      GrandTotal: (args.totalPrice ?? 100) + 10,
      LineItemCount: args.lines.length,
      OriginalActionType: null,
      CreatedDate: '2026-04-01T00:00:00.000+0000',
      LastModifiedDate: '2026-04-01T00:00:00.000+0000'
    },
    lines: args.lines
  };
}

describe('compare-quotes helper', () => {
  it('uses raw line ids only for same-quote comparisons', () => {
    const before = makeSnapshot({
      quoteId: '0Q0xx0000000001AAA',
      quoteName: 'Quote Before',
      lines: [makeLine(), makeLine({ Id: '0QLxx0000000002AAA', LineNumber: 20, Product2Id: '01txx0000000002AAA', PricebookEntryId: '01uxx0000000002AAA', NetTotalPrice: 10, TotalPrice: 10, TotalLineAmount: 10, UnitPrice: 10, ListPrice: 10, NetUnitPrice: 10, Subtotal: 10 })]
    });
    const after = makeSnapshot({
      quoteId: '0Q0xx0000000001AAA',
      quoteName: 'Quote Before',
      totalPrice: 200,
      lines: [
        makeLine({ NetTotalPrice: 200, TotalPrice: 200, TotalLineAmount: 200, LastModifiedDate: '2026-04-02T00:00:00.000+0000' }),
        makeLine({ Id: '0QLxx0000000003AAA', LineNumber: 30, Product2Id: '01txx0000000003AAA', PricebookEntryId: '01uxx0000000003AAA', NetTotalPrice: 10, TotalPrice: 10, TotalLineAmount: 10, UnitPrice: 10, ListPrice: 10, NetUnitPrice: 10, Subtotal: 10 })
      ]
    });

    const result = compareQuotes({ before, after });

    expect(result.matching_strategy).toEqual({
      mode: 'same_quote_by_line_id',
      same_quote: true,
      default_match_tiers: ['line_id']
    });
    expect(result.line_diff.changed).toEqual([
      expect.objectContaining({
        id: '0QLxx0000000001AAA',
        paired_id: '0QLxx0000000001AAA',
        match_basis: 'line_id',
        changed_fields: ['NetTotalPrice', 'TotalPrice', 'TotalLineAmount', 'LastModifiedDate']
      })
    ]);
    expect(result.line_diff.removed.map((line) => String(line.Id))).toEqual(['0QLxx0000000002AAA']);
    expect(result.line_diff.added.map((line) => String(line.Id))).toEqual(['0QLxx0000000003AAA']);
    expect(result.line_diff.ambiguous).toEqual([]);
  });

  it('matches a cross-quote preserved line by unique structural key without relying on quantity or pricing identity', () => {
    const before = makeSnapshot({
      quoteId: '0Q0xx0000000001AAA',
      quoteName: 'Quote Before',
      lines: [makeLine({ Quantity: 1, NetTotalPrice: 100, TotalPrice: 100, TotalLineAmount: 100 })]
    });
    const after = makeSnapshot({
      quoteId: '0Q0xx0000000002AAA',
      quoteName: 'Quote After',
      totalPrice: 250,
      lines: [makeLine({
        Id: '0QLxx0000000009AAA',
        QuoteId: '0Q0xx0000000002AAA',
        LineNumber: 40,
        Quantity: 5,
        NetTotalPrice: 250,
        TotalPrice: 250,
        TotalLineAmount: 250,
        PriceWaterfallIdentifier: 'PW-9',
        LastModifiedDate: '2026-04-02T00:00:00.000+0000'
      })]
    });

    const result = compareQuotes({ before, after });

    expect(result.matching_strategy).toEqual({
      mode: 'cross_quote_conservative',
      same_quote: false,
      default_match_tiers: ['quote_action_source_asset_id', 'structural_key', 'structural_key_plus_line_number']
    });
    expect(result.changed_fields).toContain('line.0QLxx0000000001AAA->0QLxx0000000009AAA.Quantity');
    expect(result.changed_fields).toContain('line.0QLxx0000000001AAA->0QLxx0000000009AAA.NetTotalPrice');
    expect(result.line_diff.changed).toEqual([
      expect.objectContaining({
        id: '0QLxx0000000001AAA',
        paired_id: '0QLxx0000000009AAA',
        match_basis: 'structural_key'
      })
    ]);
    expect(result.line_diff.added).toEqual([]);
    expect(result.line_diff.removed).toEqual([]);
  });

  it('prefers QuoteAction.SourceAssetId for unique cross-quote lifecycle carry-forward matches', () => {
    const before = makeSnapshot({
      quoteId: '0Q0xx0000000001AAA',
      quoteName: 'Quote Before',
      lines: [makeLine({
        Id: '0QLxx0000000010AAA',
        Product2Id: '01txx0000000010AAA',
        PricebookEntryId: '01uxx0000000010AAA',
        'QuoteAction.Type': 'Amend',
        'QuoteAction.SourceAssetId': '02ixx0000000001AAA'
      })]
    });
    const after = makeSnapshot({
      quoteId: '0Q0xx0000000002AAA',
      quoteName: 'Quote After',
      lines: [makeLine({
        Id: '0QLxx0000000011AAA',
        QuoteId: '0Q0xx0000000002AAA',
        LineNumber: 99,
        Product2Id: '01txx0000000010AAA',
        PricebookEntryId: '01uxx0000000099AAA',
        NetTotalPrice: 150,
        TotalPrice: 150,
        TotalLineAmount: 150,
        'QuoteAction.Type': 'Amend',
        'QuoteAction.SourceAssetId': '02ixx0000000001AAA'
      })]
    });

    const result = compareQuotes({ before, after });

    expect(result.line_diff.changed).toEqual([
      expect.objectContaining({
        id: '0QLxx0000000010AAA',
        paired_id: '0QLxx0000000011AAA',
        match_basis: 'quote_action_source_asset_id'
      })
    ]);
  });

  it('uses matched parent structure before comparing child lines across quotes', () => {
    const beforeParent = makeLine({ Id: '0QL-parent-before', LineNumber: 10, Product2Id: 'prod-parent', PricebookEntryId: 'pbe-parent' });
    const beforeChild = makeLine({
      Id: '0QL-child-before',
      LineNumber: 20,
      Product2Id: 'prod-child',
      PricebookEntryId: 'pbe-child',
      ParentQuoteLineItemId: '0QL-parent-before',
      NetTotalPrice: 25,
      TotalPrice: 25,
      TotalLineAmount: 25,
      UnitPrice: 25,
      ListPrice: 25,
      NetUnitPrice: 25,
      Subtotal: 25
    });
    const afterParent = makeLine({ Id: '0QL-parent-after', QuoteId: '0Q0xx0000000002AAA', LineNumber: 50, Product2Id: 'prod-parent', PricebookEntryId: 'pbe-parent' });
    const afterChild = makeLine({
      Id: '0QL-child-after',
      QuoteId: '0Q0xx0000000002AAA',
      LineNumber: 60,
      Product2Id: 'prod-child',
      PricebookEntryId: 'pbe-child',
      ParentQuoteLineItemId: '0QL-parent-after',
      NetTotalPrice: 35,
      TotalPrice: 35,
      TotalLineAmount: 35,
      UnitPrice: 35,
      ListPrice: 35,
      NetUnitPrice: 35,
      Subtotal: 35
    });

    const result = compareQuotes({
      before: makeSnapshot({ quoteId: '0Q0xx0000000001AAA', quoteName: 'Quote Before', lines: [beforeParent, beforeChild] }),
      after: makeSnapshot({ quoteId: '0Q0xx0000000002AAA', quoteName: 'Quote After', lines: [afterParent, afterChild] })
    });

    expect(result.line_diff.changed).toEqual([
      expect.objectContaining({ id: '0QL-parent-before', paired_id: '0QL-parent-after', match_basis: 'structural_key' }),
      expect.objectContaining({ id: '0QL-child-before', paired_id: '0QL-child-after', match_basis: 'structural_key' })
    ]);
    expect(result.line_diff.added).toEqual([]);
    expect(result.line_diff.removed).toEqual([]);
  });

  it('abstains when cross-quote structural candidates are ambiguous instead of guessing from price or quantity', () => {
    const before = makeSnapshot({
      quoteId: '0Q0xx0000000001AAA',
      quoteName: 'Quote Before',
      lines: [
        makeLine({ Id: '0QL-amb-before-1', LineNumber: null, Product2Id: 'dup-prod', PricebookEntryId: 'dup-pbe', UnitPrice: 10, ListPrice: 10, NetUnitPrice: 10, NetTotalPrice: 10, TotalPrice: 10, TotalLineAmount: 10, Subtotal: 10 }),
        makeLine({ Id: '0QL-amb-before-2', LineNumber: null, Product2Id: 'dup-prod', PricebookEntryId: 'dup-pbe', UnitPrice: 99, ListPrice: 99, NetUnitPrice: 99, NetTotalPrice: 99, TotalPrice: 99, TotalLineAmount: 99, Subtotal: 99 })
      ]
    });
    const after = makeSnapshot({
      quoteId: '0Q0xx0000000002AAA',
      quoteName: 'Quote After',
      lines: [
        makeLine({ Id: '0QL-amb-after-1', QuoteId: '0Q0xx0000000002AAA', LineNumber: null, Product2Id: 'dup-prod', PricebookEntryId: 'dup-pbe', UnitPrice: 11, ListPrice: 11, NetUnitPrice: 11, NetTotalPrice: 11, TotalPrice: 11, TotalLineAmount: 11, Subtotal: 11 }),
        makeLine({ Id: '0QL-amb-after-2', QuoteId: '0Q0xx0000000002AAA', LineNumber: null, Product2Id: 'dup-prod', PricebookEntryId: 'dup-pbe', UnitPrice: 101, ListPrice: 101, NetUnitPrice: 101, NetTotalPrice: 101, TotalPrice: 101, TotalLineAmount: 101, Subtotal: 101 })
      ]
    });

    const result = compareQuotes({ before, after });

    expect(result.status).toBe('changed');
    expect(result.line_diff.changed).toEqual([]);
    expect(result.line_diff.ambiguous).toEqual([
      {
        basis: 'structural_key',
        before_line_ids: ['0QL-amb-before-1', '0QL-amb-before-2'],
        after_line_ids: ['0QL-amb-after-1', '0QL-amb-after-2']
      }
    ]);
    expect(result.line_diff.removed.map((line) => String(line.Id))).toEqual(['0QL-amb-before-1', '0QL-amb-before-2']);
    expect(result.line_diff.added.map((line) => String(line.Id))).toEqual(['0QL-amb-after-1', '0QL-amb-after-2']);
  });

  it('returns the locked no_change shape for identical normalized snapshots', () => {
    const snapshot = makeSnapshot({
      quoteId: '0Q0xx0000000001AAA',
      quoteName: 'Quote Before',
      lines: [makeLine()]
    });

    const result: CompareQuotesResult = compareQuotes({ before: snapshot, after: snapshot });

    expect(result).toEqual({
      status: 'no_change',
      changed_fields: [],
      matching_strategy: {
        mode: 'same_quote_by_line_id',
        same_quote: true,
        default_match_tiers: ['line_id']
      },
      quote_diff: {
        changed_fields: [],
        before: snapshot.quote,
        after: snapshot.quote
      },
      line_diff: {
        added: [],
        removed: [],
        changed: [],
        ambiguous: []
      }
    });
  });

  it('treats equivalent nested JsonValue fields as unchanged', () => {
    const before: CompareQuotesInput = makeSnapshot({
      quoteId: '0Q0xx0000000001AAA',
      quoteName: 'Quote Before',
      lines: [makeLine({
        PriceWaterfallIdentifier: {
          steps: [1, 2, 3],
          details: { region: 'NA', active: true }
        }
      })]
    });
    before.quote.Name = {
      source: 'crm',
      flags: ['a', 'b'],
      nested: { enabled: true, count: 2 }
    };

    const after: CompareQuotesInput = makeSnapshot({
      quoteId: '0Q0xx0000000001AAA',
      quoteName: 'Quote Before',
      lines: [makeLine({
        PriceWaterfallIdentifier: {
          steps: [1, 2, 3],
          details: { region: 'NA', active: true }
        }
      })]
    });
    after.quote.Name = {
      source: 'crm',
      flags: ['a', 'b'],
      nested: { enabled: true, count: 2 }
    };

    const result = compareQuotes({ before, after });

    expect(result.status).toBe('no_change');
    expect(result.changed_fields).toEqual([]);
    expect(result.quote_diff.changed_fields).toEqual([]);
    expect(result.line_diff).toEqual({
      added: [],
      removed: [],
      changed: [],
      ambiguous: []
    });
  });

  it('throws when the before snapshot contains duplicate line ids', () => {
    const snapshot = makeSnapshot({
      quoteId: '0Q0xx0000000001AAA',
      quoteName: 'Quote Before',
      lines: [makeLine()]
    });

    expect(() =>
      compareQuotes({
        before: {
          ...snapshot,
          lines: [snapshot.lines[0], { ...snapshot.lines[0], LineNumber: 99 }]
        },
        after: snapshot
      })
    ).toThrowError('compareQuotes received duplicate line Id values in the before snapshot: 0QLxx0000000001AAA');
  });

  it('throws when the after snapshot contains duplicate line ids', () => {
    const snapshot = makeSnapshot({
      quoteId: '0Q0xx0000000001AAA',
      quoteName: 'Quote Before',
      lines: [makeLine()]
    });

    expect(() =>
      compareQuotes({
        before: snapshot,
        after: {
          ...snapshot,
          lines: [snapshot.lines[0], { ...snapshot.lines[0], LineNumber: 99 }]
        }
      })
    ).toThrowError('compareQuotes received duplicate line Id values in the after snapshot: 0QLxx0000000001AAA');
  });
});
