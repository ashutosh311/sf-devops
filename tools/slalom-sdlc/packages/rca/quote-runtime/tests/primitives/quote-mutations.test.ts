import { describe, expect, it, vi } from 'vitest';

import {
  CREATED_QUOTE_REFERENCE,
  PST_PLACE_ROUTE,
  buildQuoteLineDeleteGraphRecord,
  buildQuoteGraphRecord,
  buildQuoteLineGraphRecord,
  buildQuoteLineRelationshipDeleteGraphRecord,
  executeBuildTestQuote,
  executeCreateQuote,
  executePstGraphMutation,
  executePriceQuote,
  executeUpsertQuoteLines
} from '../../src/primitives/quote-mutations';
import type { SfCliJsonResult } from '../../src/integrations/salesforce/sf-cli';

const QUOTE_FIELDS = [
  { name: 'Name', createable: true, updateable: true, nillable: false, defaultedOnCreate: false },
  { name: 'QuoteAccountId', createable: true, updateable: true, nillable: true, defaultedOnCreate: false },
  { name: 'OpportunityId', createable: true, updateable: true, nillable: true, defaultedOnCreate: false },
  { name: 'Pricebook2Id', createable: true, updateable: true, nillable: true, defaultedOnCreate: false },
  { name: 'AccountId', createable: false, updateable: false, nillable: true, defaultedOnCreate: false }
];

const LINE_FIELDS = [
  { name: 'QuoteId', createable: true, updateable: false, nillable: false, defaultedOnCreate: false },
  { name: 'PricebookEntryId', createable: true, updateable: false, nillable: false, defaultedOnCreate: false },
  { name: 'Product2Id', createable: true, updateable: false, nillable: false, defaultedOnCreate: false },
  { name: 'Quantity', createable: true, updateable: true, nillable: false, defaultedOnCreate: false },
  { name: 'UnitPrice', createable: true, updateable: true, nillable: true, defaultedOnCreate: false },
  { name: 'ListPrice', createable: false, updateable: false, nillable: true, defaultedOnCreate: false }
];

const RELATIONSHIP_FIELDS = [
  { name: 'QuoteId', createable: true, updateable: false, nillable: false, defaultedOnCreate: false },
  { name: 'MainQuoteLineId', createable: true, updateable: false, nillable: false, defaultedOnCreate: false },
  { name: 'AssociatedQuoteLineId', createable: true, updateable: false, nillable: false, defaultedOnCreate: false },
  { name: 'ProductRelatedComponentId', createable: true, updateable: false, nillable: true, defaultedOnCreate: false }
];

describe('quote mutation primitives', () => {
  it('builds the proven PST graph record shape for quote and line writes', () => {
    expect(buildQuoteGraphRecord({
      name: 'ACME Quote',
      quoteAccountId: '001xx',
      opportunityId: '006xx',
      pricebook2Id: '01sxx'
    })).toEqual({
      referenceId: 'quote1',
      record: {
        attributes: {
          type: 'Quote',
          method: 'POST'
        },
        Name: 'ACME Quote',
        QuoteAccountId: '001xx',
        OpportunityId: '006xx',
        Pricebook2Id: '01sxx'
      }
    });

    expect(buildQuoteLineGraphRecord({ lineId: '0QLxx', quantity: 2 }, '0Q0xx', 0)).toEqual({
      referenceId: 'line1',
      record: {
        attributes: {
          type: 'QuoteLineItem',
          method: 'PATCH',
          id: '0QLxx'
        },
        Quantity: 2
      }
    });
  });

  it('builds typed DELETE records for quote lines and quote line relationships', async () => {
    expect(buildQuoteLineRelationshipDeleteGraphRecord('0RLxx', 0)).toEqual({
      referenceId: 'deleteRelationship1',
      record: {
        attributes: {
          type: 'QuoteLineRelationship',
          method: 'DELETE',
          id: '0RLxx'
        }
      }
    });
    expect(buildQuoteLineDeleteGraphRecord('0QLxx', 0)).toEqual({
      referenceId: 'deleteLine1',
      record: {
        attributes: {
          type: 'QuoteLineItem',
          method: 'DELETE',
          id: '0QLxx'
        }
      }
    });

    const result = await executePstGraphMutation({
      orgAlias: 'ARMAF',
      mode: 'dry_run',
      records: [
        buildQuoteLineRelationshipDeleteGraphRecord('0RLxx', 0),
        buildQuoteLineDeleteGraphRecord('0QLxx', 0)
      ],
      expectedVerificationCommands: ['validate-product-config'],
      invokeSfJson: vi.fn(async ({ args }) => {
        const objectName = args.includes('QuoteLineRelationship') ? 'QuoteLineRelationship' : 'QuoteLineItem';
        return ok({ fields: objectName === 'QuoteLineRelationship' ? RELATIONSHIP_FIELDS : LINE_FIELDS });
      })
    });

    expect(result.status).toBe('ok');
    expect(result.result.plan.validation.map((entry) => ({
      object: entry.object,
      method: entry.method,
      checked_fields: entry.checked_fields,
      valid: entry.valid
    }))).toEqual([
      { object: 'QuoteLineRelationship', method: 'DELETE', checked_fields: [], valid: true },
      { object: 'QuoteLineItem', method: 'DELETE', checked_fields: [], valid: true }
    ]);
  });

  it('requires ids for PATCH and DELETE but rejects ids for POST', async () => {
    const result = await executePstGraphMutation({
      orgAlias: 'ARMAF',
      mode: 'dry_run',
      records: [
        {
          referenceId: 'badPatch',
          record: {
            attributes: {
              type: 'QuoteLineItem',
              method: 'PATCH'
            },
            Quantity: 2
          }
        },
        {
          referenceId: 'badDelete',
          record: {
            attributes: {
              type: 'QuoteLineRelationship',
              method: 'DELETE'
            }
          }
        },
        {
          referenceId: 'badPost',
          record: {
            attributes: {
              type: 'QuoteLineItem',
              method: 'POST',
              id: '0QLxx'
            },
            QuoteId: '0Q0xx',
            PricebookEntryId: '01uxx',
            Product2Id: '01txx',
            Quantity: 1
          }
        }
      ],
      expectedVerificationCommands: ['snapshot-lines'],
      invokeSfJson: vi.fn(async ({ args }) => {
        const objectName = args.includes('QuoteLineRelationship') ? 'QuoteLineRelationship' : 'QuoteLineItem';
        return ok({ fields: objectName === 'QuoteLineRelationship' ? RELATIONSHIP_FIELDS : LINE_FIELDS });
      })
    });

    expect(result.status).toBe('error');
    expect(result.errors).toEqual(expect.arrayContaining([
      "QuoteLineItem PATCH record 'badPatch' requires record.attributes.id.",
      "QuoteLineRelationship DELETE record 'badDelete' requires record.attributes.id.",
      "QuoteLineItem POST record 'badPost' must not include record.attributes.id."
    ]));
  });

  it('dry-runs create-quote after describe validation without submitting PST', async () => {
    const invokeSfJson = vi.fn(async () => ok({ fields: QUOTE_FIELDS }));
    const invokeSfRestWrite = vi.fn();

    const result = await executeCreateQuote({
      orgAlias: 'ARMAF',
      mode: 'dry_run',
      quote: {
        name: 'ACME Quote',
        quoteAccountId: '001xx',
        opportunityId: '006xx',
        pricebook2Id: '01sxx'
      },
      invokeSfJson,
      invokeSfRestWrite
    });

    expect(result.status).toBe('ok');
    expect(result.result.plan.route).toBe(PST_PLACE_ROUTE);
    expect(result.result.plan.validation[0]?.valid).toBe(true);
    expect(result.result.execution.executed).toBe(false);
    expect(invokeSfRestWrite).not.toHaveBeenCalled();
  });

  it('blocks fields that are not createable or updateable in describe metadata', async () => {
    const result = await executeCreateQuote({
      orgAlias: 'ARMAF',
      mode: 'dry_run',
      quote: {
        name: 'ACME Quote',
        extraFields: {
          AccountId: '001xx'
        }
      },
      invokeSfJson: vi.fn(async () => ok({ fields: QUOTE_FIELDS }))
    });

    expect(result.status).toBe('error');
    expect(result.errors).toContain('Quote.AccountId is not createable in this org.');
  });

  it('executes upsert line PATCH through the PST place route when requested', async () => {
    const invokeSfRestWrite = vi.fn(async () => ({
      ok: true,
      classification: 'ok',
      path: PST_PLACE_ROUTE,
      method: 'POST',
      body: '{}',
      cliPath: '/usr/bin/sf',
      data: { accepted: true },
      exitCode: 0,
      stdout: '{}',
      stderr: ''
    } as const));

    const result = await executeUpsertQuoteLines({
      orgAlias: 'ARMAF',
      mode: 'execute',
      quoteId: '0Q0xx',
      lines: [{ lineId: '0QLxx', quantity: 3 }],
      invokeSfJson: vi.fn(async ({ args }) => {
        const objectName = args.includes('QuoteLineItem') ? 'QuoteLineItem' : 'Quote';
        return ok({ fields: objectName === 'QuoteLineItem' ? LINE_FIELDS : QUOTE_FIELDS });
      }),
      invokeSfRestWrite
    });

    expect(result.status).toBe('changed');
    expect(result.result.execution.executed).toBe(true);
    expect(result.result.plan.graph.graph.records.map((record) => record.record.attributes)).toEqual([
      { type: 'Quote', method: 'PATCH', id: '0Q0xx' },
      { type: 'QuoteLineItem', method: 'PATCH', id: '0QLxx' }
    ]);
    expect(invokeSfRestWrite).toHaveBeenCalledWith(expect.objectContaining({
      orgAlias: 'ARMAF',
      path: PST_PLACE_ROUTE,
      method: 'POST'
    }));
  });

  it('price-quote emits quote PATCH plus scoped line PATCH records', async () => {
    const result = await executePriceQuote({
      orgAlias: 'ARMAF',
      mode: 'dry_run',
      quoteId: '0Q0xx',
      lines: [{ lineId: '0QLxx', quantity: 2 }],
      invokeSfJson: vi.fn(async ({ args }) => {
        const objectName = args.includes('QuoteLineItem') ? 'QuoteLineItem' : 'Quote';
        return ok({ fields: objectName === 'QuoteLineItem' ? LINE_FIELDS : QUOTE_FIELDS });
      })
    });

    expect(result.status).toBe('ok');
    expect(result.result.plan.graph.graph.records.map((record) => record.record.attributes)).toEqual([
      { type: 'Quote', method: 'PATCH', id: '0Q0xx' },
      { type: 'QuoteLineItem', method: 'PATCH', id: '0QLxx' }
    ]);
  });

  it('build-test-quote connects fresh line POST records to the created quote reference', async () => {
    const result = await executeBuildTestQuote({
      orgAlias: 'ARMAF',
      mode: 'dry_run',
      quote: {
        name: 'ACME Quote',
        quoteAccountId: '001xx',
        opportunityId: '006xx',
        pricebook2Id: '01sxx'
      },
      lines: [{ pricebookEntryId: '01uxx', product2Id: '01txx', quantity: 2 }],
      invokeSfJson: vi.fn(async ({ args }) => {
        const objectName = args.includes('QuoteLineItem') ? 'QuoteLineItem' : 'Quote';
        return ok({ fields: objectName === 'QuoteLineItem' ? LINE_FIELDS : QUOTE_FIELDS });
      })
    });

    expect(result.status).toBe('ok');
    expect(result.result.plan.graph.graph.records[1]?.record).toMatchObject({
      attributes: {
        type: 'QuoteLineItem',
        method: 'POST'
      },
      QuoteId: CREATED_QUOTE_REFERENCE,
      PricebookEntryId: '01uxx',
      Product2Id: '01txx',
      Quantity: 2
    });
  });

  it('build-test-quote does not invent a pricing PATCH for a quote that has not been created yet', async () => {
    const result = await executeBuildTestQuote({
      orgAlias: 'ARMAF',
      mode: 'dry_run',
      quote: {
        name: 'ACME Quote',
        quoteAccountId: '001xx',
        opportunityId: '006xx',
        pricebook2Id: '01sxx'
      },
      lines: [],
      price: true,
      invokeSfJson: vi.fn(async () => ok({ fields: QUOTE_FIELDS }))
    });

    expect(result.status).toBe('ok');
    expect(result.result.plan.graph.graph.records).toHaveLength(1);
    expect(result.result.plan.graph.graph.records[0]?.record.attributes).toEqual({
      type: 'Quote',
      method: 'POST'
    });
  });
});

function ok<T>(data: T): SfCliJsonResult<T> {
  return {
    ok: true,
    classification: 'ok',
    cliPath: '/usr/bin/sf',
    data,
    exitCode: 0,
    stdout: '{}',
    stderr: ''
  };
}
