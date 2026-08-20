import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it, vi } from 'vitest';

import {
  buildPstApplyQuoteIntentPlan,
  runPstApplyQuoteIntentCommand
} from '../../src/commands/pst-apply-quote-intent';
import type { SfCliJsonResult } from '../../src/integrations/salesforce/sf-cli';
import type { QuoteMutationPrimitiveResult } from '../../src/primitives/quote-mutations';

describe('pst-apply-quote-intent command', () => {
  it('resolves product codes into quote-line records and writes an apply artifact', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pst-apply-quote-intent-'));
    const inputPath = join(tempDir, 'quote-intent.json');
    const artifactPath = join(tempDir, 'apply-artifact.json');
    const executePstGraphMutation = vi.fn(async () => mutationResult());
    const invokeSfJson = vi.fn(async () => queryResult({
      records: [
        {
          Id: '01uPBE',
          Product2Id: '01tProduct',
          Product2: {
            ProductCode: 'NS-CLOUD-DEFENSE'
          }
        }
      ]
    }));

    try {
      writeFileSync(inputPath, JSON.stringify(createIntent()), 'utf8');

      const result = await runPstApplyQuoteIntentCommand(
        ['--input', inputPath, '--write-artifact', artifactPath],
        { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
        {
          stdout: { write: () => undefined },
          stderr: { write: () => undefined }
        },
        { executePstGraphMutation, invokeSfJson }
      );

      expect(result.exitCode).toBe(0);
      expect(result.envelope.command).toBe('pst-apply-quote-intent');
      expect(result.envelope.result.plan).toMatchObject({
        mutation_mode: 'dry_run',
        record_count: 2,
        line_count: 1
      });
      expect(executePstGraphMutation).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'dry_run',
        records: [
          expect.objectContaining({
            record: expect.objectContaining({
              attributes: expect.objectContaining({ type: 'Quote', method: 'POST' })
            })
          }),
          expect.objectContaining({
            record: expect.objectContaining({
              attributes: expect.objectContaining({ type: 'QuoteLineItem', method: 'POST' }),
              PricebookEntryId: '01uPBE',
              Product2Id: '01tProduct'
            })
          })
        ]
      }));
      expect(JSON.parse(readFileSync(artifactPath, 'utf8')).envelope.command).toBe('pst-apply-quote-intent');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails closed when replace-lines does not include an explicit managed line scope', async () => {
    await expect(buildPstApplyQuoteIntentPlan({
      orgAlias: 'ARMAF',
      mutationMode: 'dry_run',
      payload: {
        target: {
          mode: 'replace_lines',
          quote_id: '0Q0Quote'
        },
        lines: []
      }
    })).rejects.toThrow(/replace_lines requires target.line_scope/i);
  });

  it('plans relationship deletes before scoped line deletes for replace-lines', async () => {
    const invokeSfJson = vi.fn(async () => queryResult({
      records: [
        {
          Id: '0Q0Rel'
        }
      ]
    }));

    const plan = await buildPstApplyQuoteIntentPlan({
      orgAlias: 'ARMAF',
      mutationMode: 'dry_run',
      payload: {
        target: {
          mode: 'replace_lines',
          quote_id: '0Q0Quote',
          line_scope: {
            mode: 'explicit_line_ids',
            line_ids: ['0QLExisting']
          }
        },
        lines: [
          {
            pricebook_entry_id: '01uNew',
            product_id: '01tNew',
            quantity: 2
          }
        ]
      },
      dependencies: { invokeSfJson }
    });

    expect(plan.deleteLineIds).toEqual(['0QLExisting']);
    expect(plan.deleteRelationshipIds).toEqual(['0Q0Rel']);
    expect(plan.records.map((record) => record.record.attributes)).toEqual([
      { type: 'QuoteLineRelationship', method: 'DELETE', id: '0Q0Rel' },
      { type: 'QuoteLineItem', method: 'DELETE', id: '0QLExisting' },
      { type: 'Quote', method: 'PATCH', id: '0Q0Quote' },
      { type: 'QuoteLineItem', method: 'POST' }
    ]);
  });

  it('plans documented usage rate child records without writing usage fields onto quote lines', async () => {
    const invokeSfJson = vi.fn(async (options) => {
      const query = String(options.args[options.args.indexOf('--query') + 1]);
      if (query.includes('FROM PricebookEntry')) {
        return queryResult({
          records: [{ Id: '01uUsage', Product2Id: '01tUsage', ProductSellingModelId: '0jPUsage' }]
        });
      }
      if (query.includes('FROM ProductUsageResource')) {
        return queryResult({
          records: [{ Id: '0PURUsage', ProductId: '01tUsage', UsageResourceId: '1BRUsage', Status: 'Active' }]
        });
      }
      if (query.includes('FROM RateCardEntry')) {
        return queryResult({
          records: [{
            Id: '0RCEUsage',
            ProductId: '01tUsage',
            UsageResourceId: '1BRUsage',
            RateCardId: '0RCRate',
            ProductSellingModelId: '0jPUsage',
            Rate: 1.23,
            Status: 'Active'
          }]
        });
      }
      if (query.includes('FROM ProductUsageGrant')) {
        return queryResult({
          records: [{
            Id: '0PUGIncluded',
            ProductId: '01tUsage',
            ProductSellingModelId: '0jPUsage',
            Quantity: 500,
            Type: 'Grant',
            ValidityPeriodTerm: 1,
            ValidityPeriodUnit: 'Month'
          }]
        });
      }
      if (query.includes('FROM Quote')) {
        return queryResult({
          records: [{ Id: '0Q0Quote' }]
        });
      }
      return queryResult({ records: [] });
    });

    const plan = await buildPstApplyQuoteIntentPlan({
      orgAlias: 'ARMAF',
      mutationMode: 'dry_run',
      payload: {
        target: {
          mode: 'append_lines',
          quote_id: '0Q0Quote'
        },
        lines: [
          {
            product_id: '01tUsage',
            pricebook_entry_id: '01uUsage',
            quantity: 1,
            usage: {
              usage_resource_id: '1BRUsage',
              rate_card_id: '0RCRate',
              rate_card_entry_id: '0RCEUsage',
              product_selling_model_id: '0jPUsage',
              negotiated_rate: null,
              grants: [
                {
                  product_usage_grant_id: '0PUGIncluded',
                  product_usage_resource_policy_id: '0PURPIncluded',
                  grant_type: 'Grant',
                  grant_quantity: 500,
                  validity_period_term: 1,
                  validity_period_unit: 'Month'
                }
              ],
              rating_quantity: 1000
            }
          }
        ],
        pricing: {
          run: true
        }
      },
      dependencies: { invokeSfJson }
    });

    const lineRecord = plan.records.find((record) => record.record.attributes.type === 'QuoteLineItem');
    expect(lineRecord?.record).toMatchObject({
      PricebookEntryId: '01uUsage',
      Product2Id: '01tUsage'
    });
    expect(lineRecord?.record).not.toHaveProperty('UsageResourceId');
    const rateRecord = plan.records.find((record) => record.record.attributes.type === 'QuoteLineRateCardEntry');
    expect(rateRecord?.record).toMatchObject({
      attributes: {
        type: 'QuoteLineRateCardEntry',
        method: 'POST'
      },
      QuoteLineItemId: '@{line1.id}',
      RateCardEntryId: '0RCEUsage',
      NegotiatedRate: null
    });
    const grantRecord = plan.records.find((record) => record.record.attributes.type === 'QuotLineItmUseRsrcGrant');
    expect(grantRecord?.record).toMatchObject({
      attributes: {
        type: 'QuotLineItmUseRsrcGrant',
        method: 'POST'
      },
      QuoteLineItemId: '@{line1.id}',
      UsageResourceId: '1BRUsage',
      ProductUsageGrantId: '0PUGIncluded',
      GrantType: 'Grant',
      GrantQuantity: 500,
      ValidityPeriodTerm: 1,
      ValidityPeriodUnit: 'Month'
    });
    expect(plan.usageRateContexts).toEqual([{
      line_index: 0,
      product_id: '01tUsage',
      pricebook_entry_id: '01uUsage',
      product_selling_model_id: '0jPUsage',
      usage_resource_id: '1BRUsage',
      rate_card_id: '0RCRate',
      rate_card_entry_id: '0RCEUsage',
      rate_card_entry_product_selling_model_id: '0jPUsage',
      rate: 1.23
    }]);
    expect(plan.expectedVerificationCommands).toContain('inspect-usage-rate-model');
    expect(plan.expectedVerificationCommands).toContain('inspect-pricing-product-sync');
    expect(plan.expectedVerificationCommands).toContain('refresh-decision-tables --decision-table-api-name <pricing/rating DecisionTable API name>');
    expect(invokeSfJson).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(['--query', expect.stringContaining('FROM PricebookEntry')])
    }));
    expect(invokeSfJson).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(['--query', expect.stringContaining('FROM ProductUsageResource')])
    }));
    expect(invokeSfJson).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(['--query', expect.stringContaining('FROM RateCardEntry')])
    }));
    expect(invokeSfJson).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(['--query', expect.stringContaining('FROM ProductUsageGrant')])
    }));
  });

  it('plans usage rate child records against existing quote lines and supports catalog rate fetch preference', async () => {
    const invokeSfJson = vi.fn(async (options) => {
      const query = String(options.args[options.args.indexOf('--query') + 1]);
      if (query.includes('FROM PricebookEntry')) {
        return queryResult({
          records: [{ Id: '01uUsage', Product2Id: '01tUsage', ProductSellingModelId: '0jPUsage' }]
        });
      }
      if (query.includes('FROM RateCardEntry')) {
        return queryResult({
          records: [{
            Id: '0RCEUsage',
            ProductId: '01tUsage',
            UsageResourceId: '1BRUsage',
            RateCardId: '0RCRate',
            ProductSellingModelId: '0jPUsage',
            Rate: 1.23,
            Status: 'Active'
          }]
        });
      }
      if (query.includes('FROM Quote')) {
        return queryResult({
          records: [{ Id: '0Q0Quote' }]
        });
      }
      return queryResult({ records: [] });
    });

    const plan = await buildPstApplyQuoteIntentPlan({
      orgAlias: 'ARMAF',
      mutationMode: 'dry_run',
      payload: {
        target: {
          mode: 'patch',
          quote_id: '0Q0Quote'
        },
        pst_plan: {
          catalog_rates_pref: 'Fetch'
        },
        lines: [
          {
            operation: 'patch',
            line_id: '0QLExisting',
            product_id: '01tUsage',
            pricebook_entry_id: '01uUsage',
            usage: {
              rate_card_entry_id: '0RCEUsage',
              negotiated_rate: 0.99,
              grants: [
                {
                  quote_line_usage_grant_id: '0QLGExisting',
                  grant_quantity: 750
                }
              ]
            }
          }
        ]
      },
      dependencies: { invokeSfJson }
    });

    expect(plan.catalogRatesPref).toBe('Fetch');
    expect(plan.records.map((record) => record.record.attributes)).toEqual([
      { type: 'Quote', method: 'PATCH', id: '0Q0Quote' },
      { type: 'QuoteLineItem', method: 'PATCH', id: '0QLExisting' },
      { type: 'QuoteLineRateCardEntry', method: 'POST' },
      { type: 'QuotLineItmUseRsrcGrant', method: 'PATCH', id: '0QLGExisting' }
    ]);
    expect(plan.records[2]?.record).toMatchObject({
      QuoteLineItemId: '0QLExisting',
      RateCardEntryId: '0RCEUsage',
      NegotiatedRate: 0.99
    });
    expect(plan.records[3]?.record).toMatchObject({
      GrantQuantity: 750
    });
    expect(plan.records[3]?.record).not.toHaveProperty('QuoteLineItemId');
  });

  it('fails closed when usage rate card and pricebook entry selling models differ', async () => {
    const invokeSfJson = vi.fn(async (options) => {
      const query = String(options.args[options.args.indexOf('--query') + 1]);
      if (query.includes('FROM PricebookEntry')) {
        return queryResult({
          records: [{ Id: '01uUsage', Product2Id: '01tUsage', ProductSellingModelId: '0jPYearly' }]
        });
      }
      if (query.includes('FROM ProductUsageResource')) {
        return queryResult({
          records: [{ Id: '0PURUsage', ProductId: '01tUsage', UsageResourceId: '1BRUsage', Status: 'Active' }]
        });
      }
      if (query.includes('FROM RateCardEntry')) {
        return queryResult({
          records: [{
            Id: '0RCEUsage',
            ProductId: '01tUsage',
            UsageResourceId: '1BRUsage',
            RateCardId: '0RCRate',
            ProductSellingModelId: '0jPMonthly',
            Status: 'Active'
          }]
        });
      }
      return queryResult({ records: [] });
    });

    await expect(buildPstApplyQuoteIntentPlan({
      orgAlias: 'ARMAF',
      mutationMode: 'dry_run',
      payload: {
        target: {
          mode: 'append_lines',
          quote_id: '0Q0Quote'
        },
        lines: [
          {
            product_id: '01tUsage',
            pricebook_entry_id: '01uUsage',
            usage: {
              usage_resource_id: '1BRUsage',
              rate_card_entry_id: '0RCEUsage'
            }
          }
        ]
      },
      dependencies: { invokeSfJson }
    })).rejects.toThrow(/product selling model mismatch/i);
  });

  it('fails closed when usage grants do not resolve against the selected product', async () => {
    const invokeSfJson = vi.fn(async (options) => {
      const query = String(options.args[options.args.indexOf('--query') + 1]);
      if (query.includes('FROM PricebookEntry')) {
        return queryResult({
          records: [{ Id: '01uUsage', Product2Id: '01tUsage', ProductSellingModelId: '0jPUsage' }]
        });
      }
      if (query.includes('FROM ProductUsageResource')) {
        return queryResult({
          records: [{ Id: '0PURUsage', ProductId: '01tUsage', UsageResourceId: '1BRUsage', Status: 'Active' }]
        });
      }
      if (query.includes('FROM RateCardEntry')) {
        return queryResult({
          records: [{
            Id: '0RCEUsage',
            ProductId: '01tUsage',
            UsageResourceId: '1BRUsage',
            RateCardId: '0RCRate',
            ProductSellingModelId: '0jPUsage',
            Status: 'Active'
          }]
        });
      }
      if (query.includes('FROM ProductUsageGrant')) {
        return queryResult({ records: [] });
      }
      return queryResult({ records: [] });
    });

    await expect(buildPstApplyQuoteIntentPlan({
      orgAlias: 'ARMAF',
      mutationMode: 'dry_run',
      payload: {
        target: {
          mode: 'append_lines',
          quote_id: '0Q0Quote'
        },
        lines: [
          {
            product_id: '01tUsage',
            pricebook_entry_id: '01uUsage',
            usage: {
              usage_resource_id: '1BRUsage',
              rate_card_entry_id: '0RCEUsage',
              grants: [
                {
                  product_usage_grant_id: '0PUGWrongProduct',
                  grant_type: 'Grant',
                  grant_quantity: 500
                }
              ]
            }
          }
        ]
      },
      dependencies: { invokeSfJson }
    })).rejects.toThrow(/did not resolve ProductUsageGrant 0PUGWrongProduct for product 01tUsage/i);
  });

  it('issues exactly one ProductUsageGrant query for multiple grants (batch N+1 fix)', async () => {
    const invokeSfJson = vi.fn(async (options) => {
      const query = String(options.args[options.args.indexOf('--query') + 1]);
      if (query.includes('FROM PricebookEntry')) {
        return queryResult({
          records: [{ Id: '01uUsage', Product2Id: '01tUsage', ProductSellingModelId: '0jPUsage' }]
        });
      }
      if (query.includes('FROM ProductUsageResource')) {
        return queryResult({
          records: [{ Id: '0PURUsage', ProductId: '01tUsage', UsageResourceId: '1BRUsage', Status: 'Active' }]
        });
      }
      if (query.includes('FROM RateCardEntry')) {
        return queryResult({
          records: [{
            Id: '0RCEUsage',
            ProductId: '01tUsage',
            UsageResourceId: '1BRUsage',
            RateCardId: '0RCRate',
            ProductSellingModelId: '0jPUsage',
            Rate: 1.23,
            Status: 'Active'
          }]
        });
      }
      if (query.includes('FROM ProductUsageGrant')) {
        return queryResult({
          records: [
            { Id: '0PUGFirst', ProductId: '01tUsage', ProductSellingModelId: '0jPUsage', Type: 'Grant', Quantity: 100, ValidityPeriodTerm: 1, ValidityPeriodUnit: 'Month' },
            { Id: '0PUGSecond', ProductId: '01tUsage', ProductSellingModelId: '0jPUsage', Type: 'Grant', Quantity: 200, ValidityPeriodTerm: 12, ValidityPeriodUnit: 'Month' }
          ]
        });
      }
      if (query.includes('FROM Quote')) {
        return queryResult({ records: [{ Id: '0Q0Quote' }] });
      }
      return queryResult({ records: [] });
    });

    await buildPstApplyQuoteIntentPlan({
      orgAlias: 'ARMAF',
      mutationMode: 'dry_run',
      payload: {
        target: { mode: 'append_lines', quote_id: '0Q0Quote' },
        lines: [
          {
            product_id: '01tUsage',
            pricebook_entry_id: '01uUsage',
            usage: {
              usage_resource_id: '1BRUsage',
              rate_card_id: '0RCRate',
              rate_card_entry_id: '0RCEUsage',
              product_selling_model_id: '0jPUsage',
              grants: [
                { product_usage_grant_id: '0PUGFirst', grant_type: 'Grant', grant_quantity: 100, validity_period_term: 1, validity_period_unit: 'Month' },
                { product_usage_grant_id: '0PUGSecond', grant_type: 'Grant', grant_quantity: 200, validity_period_term: 12, validity_period_unit: 'Month' }
              ]
            }
          }
        ],
        pricing: { run: true }
      },
      dependencies: { invokeSfJson }
    });

    const grantQueryCalls = invokeSfJson.mock.calls.filter((call) =>
      String(call[0]?.args?.[call[0].args.indexOf('--query') + 1]).includes('FROM ProductUsageGrant')
    );
    expect(grantQueryCalls).toHaveLength(1);
    expect(grantQueryCalls[0]?.[0]?.args?.join(' ')).toMatch(/IN \(/);
  });

  it('fails closed when a usage grant selling model does not match the pricebook entry', async () => {
    const invokeSfJson = vi.fn(async (options) => {
      const query = String(options.args[options.args.indexOf('--query') + 1]);
      if (query.includes('FROM PricebookEntry')) {
        return queryResult({
          records: [{ Id: '01uUsage', Product2Id: '01tUsage', ProductSellingModelId: '0jPYearly' }]
        });
      }
      if (query.includes('FROM ProductUsageResource')) {
        return queryResult({
          records: [{ Id: '0PURUsage', ProductId: '01tUsage', UsageResourceId: '1BRUsage', Status: 'Active' }]
        });
      }
      if (query.includes('FROM RateCardEntry')) {
        return queryResult({
          records: [{
            Id: '0RCEUsage',
            ProductId: '01tUsage',
            UsageResourceId: '1BRUsage',
            RateCardId: '0RCRate',
            ProductSellingModelId: '0jPYearly',
            Status: 'Active'
          }]
        });
      }
      if (query.includes('FROM ProductUsageGrant')) {
        return queryResult({
          records: [{
            Id: '0PUGWrongModel',
            ProductId: '01tUsage',
            ProductSellingModelId: '0jPMonthly',
            Type: 'Grant',
            Quantity: 500,
            ValidityPeriodTerm: 1,
            ValidityPeriodUnit: 'Month'
          }]
        });
      }
      return queryResult({ records: [] });
    });

    await expect(buildPstApplyQuoteIntentPlan({
      orgAlias: 'ARMAF',
      mutationMode: 'dry_run',
      payload: {
        target: { mode: 'append_lines', quote_id: '0Q0Quote' },
        lines: [
          {
            product_id: '01tUsage',
            pricebook_entry_id: '01uUsage',
            usage: {
              usage_resource_id: '1BRUsage',
              rate_card_entry_id: '0RCEUsage',
              grants: [{ product_usage_grant_id: '0PUGWrongModel', grant_type: 'Grant', grant_quantity: 500 }]
            }
          }
        ]
      },
      dependencies: { invokeSfJson }
    })).rejects.toThrow(/Line 1 usage grant 1 product selling model mismatch: PricebookEntry uses 0jPYearly but ProductUsageGrant uses 0jPMonthly/);
  });

  it('fails closed when a usage grant type does not match the intent', async () => {
    const invokeSfJson = vi.fn(async (options) => {
      const query = String(options.args[options.args.indexOf('--query') + 1]);
      if (query.includes('FROM PricebookEntry')) {
        return queryResult({
          records: [{ Id: '01uUsage', Product2Id: '01tUsage', ProductSellingModelId: '0jPUsage' }]
        });
      }
      if (query.includes('FROM ProductUsageResource')) {
        return queryResult({
          records: [{ Id: '0PURUsage', ProductId: '01tUsage', UsageResourceId: '1BRUsage', Status: 'Active' }]
        });
      }
      if (query.includes('FROM RateCardEntry')) {
        return queryResult({
          records: [{
            Id: '0RCEUsage',
            ProductId: '01tUsage',
            UsageResourceId: '1BRUsage',
            RateCardId: '0RCRate',
            ProductSellingModelId: '0jPUsage',
            Status: 'Active'
          }]
        });
      }
      if (query.includes('FROM ProductUsageGrant')) {
        return queryResult({
          records: [{
            Id: '0PUGWrongType',
            ProductId: '01tUsage',
            ProductSellingModelId: '0jPUsage',
            Type: 'Inclusive',
            Quantity: 500,
            ValidityPeriodTerm: 1,
            ValidityPeriodUnit: 'Month'
          }]
        });
      }
      return queryResult({ records: [] });
    });

    await expect(buildPstApplyQuoteIntentPlan({
      orgAlias: 'ARMAF',
      mutationMode: 'dry_run',
      payload: {
        target: { mode: 'append_lines', quote_id: '0Q0Quote' },
        lines: [
          {
            product_id: '01tUsage',
            pricebook_entry_id: '01uUsage',
            usage: {
              usage_resource_id: '1BRUsage',
              rate_card_entry_id: '0RCEUsage',
              grants: [{ product_usage_grant_id: '0PUGWrongType', grant_type: 'Grant', grant_quantity: 500 }]
            }
          }
        ]
      },
      dependencies: { invokeSfJson }
    })).rejects.toThrow(/Line 1 usage grant 1 type mismatch: intent uses Grant but ProductUsageGrant uses Inclusive/);
  });

  it('issues zero ProductUsageGrant queries when no grants have IDs', async () => {
    const invokeSfJson = vi.fn(async (options) => {
      const query = String(options.args[options.args.indexOf('--query') + 1]);
      if (query.includes('FROM PricebookEntry')) {
        return queryResult({
          records: [{ Id: '01uUsage', Product2Id: '01tUsage', ProductSellingModelId: '0jPUsage' }]
        });
      }
      if (query.includes('FROM ProductUsageResource')) {
        return queryResult({
          records: [{ Id: '0PURUsage', ProductId: '01tUsage', UsageResourceId: '1BRUsage', Status: 'Active' }]
        });
      }
      if (query.includes('FROM RateCardEntry')) {
        return queryResult({
          records: [{
            Id: '0RCEUsage',
            ProductId: '01tUsage',
            UsageResourceId: '1BRUsage',
            RateCardId: '0RCRate',
            ProductSellingModelId: '0jPUsage',
            Rate: 0.5,
            Status: 'Active'
          }]
        });
      }
      if (query.includes('FROM Quote')) {
        return queryResult({ records: [{ Id: '0Q0Quote' }] });
      }
      return queryResult({ records: [] });
    });

    await buildPstApplyQuoteIntentPlan({
      orgAlias: 'ARMAF',
      mutationMode: 'dry_run',
      payload: {
        target: { mode: 'append_lines', quote_id: '0Q0Quote' },
        lines: [
          {
            product_id: '01tUsage',
            pricebook_entry_id: '01uUsage',
            usage: {
              usage_resource_id: '1BRUsage',
              rate_card_entry_id: '0RCEUsage',
              grants: []
            }
          }
        ],
        pricing: { run: true }
      },
      dependencies: { invokeSfJson }
    });

    const grantQueryCalls = invokeSfJson.mock.calls.filter((call) =>
      String(call[0]?.args?.[call[0].args.indexOf('--query') + 1]).includes('FROM ProductUsageGrant')
    );
    expect(grantQueryCalls).toHaveLength(0);
  });

  it('fails closed when a typed usage selector does not resolve to org records', async () => {
    await expect(buildPstApplyQuoteIntentPlan({
      orgAlias: 'ARMAF',
      mutationMode: 'dry_run',
      payload: {
        target: {
          mode: 'append_lines',
          quote_id: '0Q0Quote'
        },
        lines: [
          {
            product_id: '01tUsage',
            pricebook_entry_id: '01uUsage',
            usage: {
              usage_resource_id: '1BRMissing'
            }
          }
        ]
      },
      dependencies: {
        invokeSfJson: vi.fn(async (options) => {
          const query = String(options.args[options.args.indexOf('--query') + 1]);
          if (query.includes('FROM PricebookEntry')) {
            return queryResult({
              records: [{ Id: '01uUsage', Product2Id: '01tUsage', ProductSellingModelId: '0jPUsage' }]
            });
          }
          return queryResult({ records: [] });
        })
      }
    })).rejects.toThrow(/did not resolve a ProductUsageResource/i);
  });

  it('checks target assertions before execution', async () => {
    const executePstGraphMutation = vi.fn(async () => mutationResult());
    const invokeSfJson = vi.fn(async () => queryResult({
      records: [
        {
          Id: '0Q0Quote',
          QuoteNumber: 'Q-0002',
          OpportunityId: '006Wrong',
          Pricebook2Id: '01sBook'
        }
      ]
    }));

    await expect(runPstApplyQuoteIntentCommand(
      ['--input', writeTempIntent({
        target: {
          mode: 'append_lines',
          quote_id: '0Q0Quote',
          assertions: {
            quote_number: 'Q-0001'
          }
        },
        lines: []
      })],
      { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
      {
        stdout: { write: () => undefined },
        stderr: { write: () => undefined }
      },
      { executePstGraphMutation, invokeSfJson }
    )).rejects.toThrow(/Target assertion failed for quote_number/i);
    expect(executePstGraphMutation).not.toHaveBeenCalled();
  });

  it('accepts wrapped example documents and header alias but refuses raw configuration without a PST plan', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pst-apply-quote-intent-'));
    const inputPath = join(tempDir, 'wrapped-quote-intent.json');

    try {
      writeFileSync(inputPath, JSON.stringify({
        example_name: 'wrapped',
        quote_intent: {
          target: {
            mode: 'create'
          },
          header: {
            name: 'Configured Quote',
            pricebook_id: '01sBook'
          },
          lines: [
            {
              product_code: 'NS-BUNDLE',
              configuration: {
                attributes: {
                  Tier: 'Premium'
                }
              }
            }
          ]
        }
      }), 'utf8');

      await expect(runPstApplyQuoteIntentCommand(
        ['--input', inputPath],
        { help: false, json: true, orgAlias: 'ARMAF', failOn: undefined, output: undefined, verbose: false },
        {
          stdout: { write: () => undefined },
          stderr: { write: () => undefined }
        },
        {
          executePstGraphMutation: vi.fn(async () => mutationResult()),
          invokeSfJson: vi.fn(async () => queryResult({ records: [] }))
        }
      )).rejects.toThrow(/pst_plan\.quote_line_attributes/i);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function createIntent() {
  return {
    plan_key: 'northstar-draft-v1',
    target: {
      mode: 'create',
      assertions: {
        pricebook_id: '01sBook'
      }
    },
    quote: {
      name: 'Northstar Cloud Defense Draft',
      quote_account_id: '001Account',
      opportunity_id: '006Opportunity',
      pricebook_id: '01sBook'
    },
    lines: [
      {
        product_code: 'NS-CLOUD-DEFENSE',
        quantity: 1
      }
    ],
    pricing: {
      run: true
    }
  };
}

function writeTempIntent(value: unknown): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'pst-apply-quote-intent-'));
  const inputPath = join(tempDir, 'quote-intent.json');
  writeFileSync(inputPath, JSON.stringify(value), 'utf8');
  return inputPath;
}

function queryResult<T>(data: T): SfCliJsonResult<T> {
  return {
    ok: true,
    classification: 'ok',
    cliPath: 'sf',
    data,
    exitCode: 0,
    stdout: '',
    stderr: ''
  };
}

function mutationResult(): QuoteMutationPrimitiveResult {
  return {
    status: 'ok',
    result: {
      plan: {
        mode: 'dry_run',
        route: '/services/data/v66.0/connect/rev/sales-transaction/actions/place',
        graph: { graph: { records: [] } },
        validation: [],
        expected_verification_commands: []
      },
      execution: {
        executed: false,
        response: null
      }
    },
    warnings: [],
    errors: [],
    evidence: []
  };
}
