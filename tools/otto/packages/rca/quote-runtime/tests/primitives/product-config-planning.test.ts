import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  executePlanProductConfig,
  planProductConfig,
  type ProductConfigChoices
} from '../../src/primitives/product-config-planning';
import type { ProductCatalogConfigSummary } from '../../src/primitives/product-catalog-config';

describe('product config planning primitive', () => {
  it('validates explicit choices and emits PST-ready quote line attributes', () => {
    const result = planProductConfig(configSummary(), {
      attributes: {
        'Detector Size': '10x12',
        'Software Package': 'GeneralPractice',
        'Installation Tier': 'Standard'
      },
      componentSelections: {
        'Detector Options': ['Wireless DR detector 10x12']
      },
      sources: {
        'Detector Size': 'seller_note'
      }
    }, '@{line2.id}');

    expect(result.status).toBe('ok');
    expect(result.result.blocked).toBe(false);
    expect(result.result.pst_plan.quote_line_attributes).toHaveLength(3);
    expect(result.result.pst_plan.quote_line_attributes[0]).toMatchObject({
      record: {
        QuoteLineItemId: '@{line2.id}',
        AttributeDefinitionId: 'attr-detector',
        AttributePicklistValueId: 'value-10x12',
        AttributeValue: '10x12'
      }
    });
    expect(result.result.selected_configuration.component_groups[0].selected_components[0]).toMatchObject({
      id: 'prod-detector-10x12'
    });
  });

  it('blocks missing required attributes and required component selections', () => {
    const result = planProductConfig(configSummary(), {
      attributes: {
        'Detector Size': '14x17'
      }
    }, '@{line1.id}');

    expect(result.status).toBe('error');
    expect(result.result.blocked).toBe(true);
    expect(result.result.pst_plan.quote_line_attributes).toEqual([]);
    expect(result.result.unresolved_questions).toEqual([
      "Choose required attribute 'Software Package'.",
      "Choose required attribute 'Installation Tier'.",
      "Component group 'Detector Options' requires at least 1 selection(s)."
    ]);
  });

  it('accepts a full inspect-product-catalog-config envelope as the product-config artifact', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'product-config-plan-'));
    const productConfigPath = join(tempDir, 'inspect-envelope.json');
    const choicesPath = join(tempDir, 'choices.json');

    try {
      writeFileSync(productConfigPath, JSON.stringify({ command: 'inspect-product-catalog-config', result: { product_config: configSummary() } }), 'utf8');
      writeFileSync(choicesPath, JSON.stringify(validChoices()), 'utf8');

      const result = executePlanProductConfig({
        productConfigPath,
        choicesPath,
        parentLineReference: '@{line1.id}'
      });

      expect(result.status).toBe('ok');
      expect(result.result.product_id).toBe('prod-dr-suite');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function validChoices(): ProductConfigChoices {
  return {
    attributes: {
      'Detector Size': '10x12',
      'Software Package': 'GeneralPractice',
      'Installation Tier': 'Standard'
    },
    componentSelections: {
      'Detector Options': ['Wireless DR detector 10x12']
    }
  };
}

function configSummary(): ProductCatalogConfigSummary {
  return {
    product: {
      id: 'prod-dr-suite',
      name: 'Companion animal DR suite',
      code: 'DR-SUITE',
      type: 'Bundle',
      pricebook_id: '01sxx',
      pricebook_entry_id: '01uxx'
    },
    attributes: [
      {
        id: 'attr-detector',
        name: 'Detector Size',
        label: 'Detector Size',
        code: null,
        required: true,
        values: [{ id: 'value-10x12', name: '10x12', display_value: '10x12', text_value: '10x12', code: null }]
      },
      {
        id: 'attr-software',
        name: 'Software Package',
        label: 'Software Package',
        code: null,
        required: true,
        values: [{ id: 'value-gp', name: 'GeneralPractice', display_value: 'General Practice', text_value: 'GeneralPractice', code: null }]
      },
      {
        id: 'attr-install',
        name: 'Installation Tier',
        label: 'Installation Tier',
        code: null,
        required: true,
        values: [{ id: 'value-standard', name: 'Standard', display_value: 'Standard', text_value: 'Standard', code: null }]
      }
    ],
    component_groups: [
      {
        id: 'group-detector',
        name: 'Detector Options',
        code: null,
        min_quantity: 1,
        max_quantity: 1,
        components: [
          {
            id: 'prod-detector-10x12',
            name: 'Wireless DR detector 10x12',
            product_code: 'DET-10X12',
            related_component_id: 'rel-detector-10x12',
            required: false,
            default: true
          }
        ]
      }
    ],
    runtime_validation_available_pre_quote: false
  };
}
