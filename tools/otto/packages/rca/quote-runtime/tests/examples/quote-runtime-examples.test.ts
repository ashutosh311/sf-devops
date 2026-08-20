import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const EXAMPLES_DIR = join(process.cwd(), 'examples');

const REQUIRED_EXAMPLES = [
  'new-simple-term-quote.json',
  'existing-quote-replace-lines.json',
  'configured-bundle-with-attributes.json',
  'configured-bundle-with-default-exclusion.json',
  'mixed-bundle-service-hardware-discounts.json',
  'pst-delete-bundle-default-component.json',
  'northstar-cloud-defense-quote-intent.json',
  'usage-rated-api-access-quote-intent.json'
] as const;

type ExampleDocument = {
  example_name?: string;
  purpose?: string;
  command_family?: string;
  create_vs_patch_behavior?: string;
  quote_intent?: unknown;
  repair_intent?: unknown;
  generated_pst_graph_preview?: unknown;
  expected_readback_shape?: unknown;
  expected_verification_commands?: unknown;
};

describe('quote-runtime examples', () => {
  it.each(REQUIRED_EXAMPLES)('%s is valid JSON with the expected example sections', (filename) => {
    const document = readExample(filename);

    expect(document.example_name).toBe(filename.replace(/\.json$/, ''));
    expect(document.purpose).toEqual(expect.any(String));
    expect(document.command_family).toEqual(expect.any(String));
    expect(document.create_vs_patch_behavior).toEqual(expect.any(String));
    expect(document.quote_intent ?? document.repair_intent).toBeDefined();
    expect(document.generated_pst_graph_preview).toBeDefined();
    expect(document.expected_readback_shape).toBeDefined();
    expect(document.expected_verification_commands).toEqual(expect.any(Array));
  });

  it('keeps the Northstar golden example locked to the original target quote and scoped replacement mode', () => {
    const document = readExample('northstar-cloud-defense-quote-intent.json') as {
      quote_intent: {
        target: {
          mode: string;
          quote_id: string;
          allow_new_quote: boolean;
          assertions: {
            quote_number: string;
          };
          line_scope: {
            allow_delete_outside_scope: boolean;
            product_codes: string[];
          };
        };
        default_policy: {
          excluded_product_codes: string[];
        };
      };
      expected_readback_shape: {
        northstar_spec_targets: {
          grand_total: number;
        };
      };
    };

    expect(document.quote_intent.target).toMatchObject({
      mode: 'replace_lines',
      quote_id: '0Q0a5000002mnBlCAI',
      allow_new_quote: false,
      assertions: {
        quote_number: '00000048'
      },
      line_scope: {
        allow_delete_outside_scope: false
      }
    });
    expect(document.quote_intent.target.line_scope.product_codes).toContain('AEGISXDR-ENDPOINT-SENSOR');
    expect(document.quote_intent.default_policy.excluded_product_codes).toContain('AEGISXDR-ENDPOINT-SENSOR');
    expect(document.expected_readback_shape.northstar_spec_targets.grand_total).toBe(427241.5);
  });
});

function readExample(filename: string): ExampleDocument {
  return JSON.parse(readFileSync(join(EXAMPLES_DIR, filename), 'utf8')) as ExampleDocument;
}
