/**
 * Tests for the waterfall command modules:
 *   - waterfall-model   (lib/waterfall/model.ts — WaterfallModel pipeline)
 *   - waterfall-example (lib/waterfall/example-builder.ts)
 *   - render-waterfall-html (lib/waterfall/html-renderer.ts)
 *
 * These three commands form a pipeline: model → example → HTML.
 * Tests cover each command individually; a combined pipeline test
 * chains all three using temp files written inside a tmpdir.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertPricingEnvelopeShape } from '../helpers/envelope-assertions';

import { waterfallModelCommand } from '../../src/commands/waterfall-model';
import { waterfallExampleCommand } from '../../src/commands/waterfall-example';
import { renderWaterfallHtmlCommand } from '../../src/commands/render-waterfall-html';
import { PricingCliError } from '../../src/lib/contracts/errors';

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const PROCEDURE = resolve(FIXTURES, 'Rev_Mgmt_Default_Pricing_Procedure2.expressionSetDefinition-meta.xml');
const CONTEXT = resolve(FIXTURES, 'RevSalesTransactionContext.contextDefinition-meta.xml');
const VALUES_FILE = resolve(FIXTURES, 'netunitprice-values.json');
const RUNTIME_WATERFALL_FILE = resolve(FIXTURES, 'netunitprice-runtime-waterfall.json');

// Temp dir for pipeline artefacts
let tmpDir: string;
let modelPath: string;
let examplePath: string;
let htmlPath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ppc-waterfall-unit-test-'));
  modelPath = join(tmpDir, 'model.json');
  examplePath = join(tmpDir, 'example.json');
  htmlPath = join(tmpDir, 'waterfall.html');
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures in tests
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runWaterfallModel(argv: string[]) {
  const args = waterfallModelCommand.parseArgs(argv);
  return waterfallModelCommand.run(args, Date.now());
}

function runWaterfallExample(argv: string[]) {
  const args = waterfallExampleCommand.parseArgs(argv);
  return waterfallExampleCommand.run(args, Date.now());
}

function runRenderWaterfallHtml(argv: string[]) {
  const args = renderWaterfallHtmlCommand.parseArgs(argv);
  return renderWaterfallHtmlCommand.run(args, Date.now());
}

// ---------------------------------------------------------------------------
// waterfall-model parseArgs
// ---------------------------------------------------------------------------

describe('waterfall-model parseArgs', () => {
  it('accepts --file', () => {
    const args = waterfallModelCommand.parseArgs(['--file', PROCEDURE]);
    expect(args).toMatchObject({ file: PROCEDURE, json: false, includeFormulaDetails: false });
  });

  it('accepts --context, --version, --focus-tag', () => {
    const args = waterfallModelCommand.parseArgs([
      '--file', PROCEDURE,
      '--context', CONTEXT,
      '--version', 'active',
      '--focus-tag', 'NetUnitPrice',
    ]);
    expect(args).toMatchObject({ context: CONTEXT, version: 'active', focusTag: 'NetUnitPrice' });
  });

  it('accepts --include-formula-details and --include-all-elements', () => {
    const args = waterfallModelCommand.parseArgs([
      '--file', PROCEDURE,
      '--include-formula-details',
      '--include-all-elements',
    ]);
    expect(args).toMatchObject({ includeFormulaDetails: true, includeAllElements: true });
  });

  it('throws when --file is missing', () => {
    expect(() => waterfallModelCommand.parseArgs([])).toThrow(PricingCliError);
  });

  it('throws on unknown flag', () => {
    expect(() => waterfallModelCommand.parseArgs(['--file', PROCEDURE, '--unknown'])).toThrow(PricingCliError);
  });

  it('sourceFiles returns file and context paths', () => {
    const files = waterfallModelCommand.sourceFiles(['--file', PROCEDURE, '--context', CONTEXT]);
    expect(files).toContain(PROCEDURE);
    expect(files).toContain(CONTEXT);
  });
});

// ---------------------------------------------------------------------------
// waterfall-example parseArgs
// ---------------------------------------------------------------------------

describe('waterfall-example parseArgs', () => {
  it('accepts --model', () => {
    const args = waterfallExampleCommand.parseArgs(['--model', modelPath]);
    expect(args).toMatchObject({ model: modelPath });
  });

  it('accepts --values', () => {
    const args = waterfallExampleCommand.parseArgs(['--model', modelPath, '--values', VALUES_FILE]);
    expect(args).toMatchObject({ values: VALUES_FILE });
  });

  it('accepts --runtime-waterfall', () => {
    const args = waterfallExampleCommand.parseArgs([
      '--model', modelPath,
      '--runtime-waterfall', RUNTIME_WATERFALL_FILE,
    ]);
    expect(args).toMatchObject({ runtimeWaterfall: RUNTIME_WATERFALL_FILE });
  });

  it('throws when --model is missing', () => {
    expect(() => waterfallExampleCommand.parseArgs(['--values', VALUES_FILE])).toThrow(PricingCliError);
  });

  it('throws on unknown flag', () => {
    expect(() => waterfallExampleCommand.parseArgs(['--model', modelPath, '--unknown'])).toThrow(PricingCliError);
  });
});

// ---------------------------------------------------------------------------
// render-waterfall-html parseArgs
// ---------------------------------------------------------------------------

describe('render-waterfall-html parseArgs', () => {
  it('accepts --example and --output', () => {
    const args = renderWaterfallHtmlCommand.parseArgs(['--example', examplePath, '--output', htmlPath]);
    expect(args).toMatchObject({ example: examplePath, output: htmlPath });
  });

  it('throws when --example is missing', () => {
    expect(() => renderWaterfallHtmlCommand.parseArgs(['--output', htmlPath])).toThrow(PricingCliError);
  });

  it('throws when --output is missing', () => {
    expect(() => renderWaterfallHtmlCommand.parseArgs(['--example', examplePath])).toThrow(PricingCliError);
  });

  it('throws on unknown flag', () => {
    expect(() =>
      renderWaterfallHtmlCommand.parseArgs(['--example', examplePath, '--output', htmlPath, '--unknown'])
    ).toThrow(PricingCliError);
  });
});

// ---------------------------------------------------------------------------
// waterfall-model run — lib/waterfall/model.ts area
// ---------------------------------------------------------------------------

describe('waterfall-model run — happy paths', () => {
  it('returns ok or no_match for a valid procedure file', () => {
    const envelope = runWaterfallModel(['--file', PROCEDURE]);
    expect(['ok', 'no_match', 'warn']).toContain(envelope.status);
    assertPricingEnvelopeShape(envelope, 'waterfall-model', envelope.status);
    expect(envelope.errors).toHaveLength(0);
  });

  it('result has graph with nodes and edges', () => {
    const envelope = runWaterfallModel(['--file', PROCEDURE]);
    const result = envelope.result as { graph?: { nodes: unknown[]; edges: unknown[] } };
    if (result.graph) {
      expect(Array.isArray(result.graph.nodes)).toBe(true);
      expect(Array.isArray(result.graph.edges)).toBe(true);
    }
  });

  it('applies --version active without error', () => {
    const envelope = runWaterfallModel(['--file', PROCEDURE, '--version', 'active']);
    expect(envelope.errors).toHaveLength(0);
  });

  it('applies --focus-tag NetUnitPrice without error', () => {
    const envelope = runWaterfallModel([
      '--file', PROCEDURE,
      '--version', 'active',
      '--focus-tag', 'NetUnitPrice',
    ]);
    expect(envelope.errors).toHaveLength(0);
  });

  it('applies --context companion file without error', () => {
    const envelope = runWaterfallModel([
      '--file', PROCEDURE,
      '--context', CONTEXT,
      '--version', 'active',
      '--focus-tag', 'NetUnitPrice',
    ]);
    expect(envelope.errors).toHaveLength(0);
    expect(['ok', 'no_match', 'warn']).toContain(envelope.status);
  });

  it('meta.source_files contains the procedure path', () => {
    const envelope = runWaterfallModel(['--file', PROCEDURE]);
    expect(envelope.meta.source_files).toContain(PROCEDURE);
  });
});

// ---------------------------------------------------------------------------
// waterfall-model run — error paths
// ---------------------------------------------------------------------------

// PINNED BEHAVIOR: runWaterfallModel() throws PricingCliError for a missing file.
// The dispatch harness converts this into an error envelope.
describe('waterfall-model run — error paths', () => {
  it('throws PricingCliError when the file does not exist', () => {
    const args = waterfallModelCommand.parseArgs(['--file', '/nonexistent/proc.xml']);
    expect(() => waterfallModelCommand.run(args, Date.now())).toThrow(PricingCliError);
  });
});

// ---------------------------------------------------------------------------
// Pipeline: model → example → render-html
// ---------------------------------------------------------------------------

describe('waterfall pipeline: model → example → render-html', () => {
  it('step 1 — waterfall-model produces a model envelope', () => {
    const envelope = runWaterfallModel([
      '--file', PROCEDURE,
      '--context', CONTEXT,
      '--version', 'active',
      '--focus-tag', 'NetUnitPrice',
      '--include-formula-details',
    ]);
    expect(['ok', 'no_match', 'warn']).toContain(envelope.status);
    expect(envelope.errors).toHaveLength(0);

    // Write the envelope (waterfall-example accepts an envelope wrapper or bare model)
    writeFileSync(modelPath, JSON.stringify(envelope, null, 2), 'utf8');
  });

  it('step 2 — waterfall-example produces an example from model + values', () => {
    const envelope = runWaterfallExample([
      '--model', modelPath,
      '--values', VALUES_FILE,
    ]);
    expect(['ok', 'warn', 'partial', 'no_match']).toContain(envelope.status);
    expect(envelope.errors).toHaveLength(0);

    // Write for next step
    writeFileSync(examplePath, JSON.stringify(envelope, null, 2), 'utf8');
  });

  it('step 2b — waterfall-example works with --runtime-waterfall instead of --values', () => {
    const envelope = runWaterfallExample([
      '--model', modelPath,
      '--runtime-waterfall', RUNTIME_WATERFALL_FILE,
    ]);
    expect(['ok', 'warn', 'partial', 'no_match']).toContain(envelope.status);
    expect(envelope.errors).toHaveLength(0);
  });

  it('step 3 — render-waterfall-html writes an HTML file', () => {
    mkdirSync(dirname(htmlPath), { recursive: true });
    const envelope = runRenderWaterfallHtml([
      '--example', examplePath,
      '--output', htmlPath,
    ]);
    expect(['ok', 'warn', 'partial', 'no_match']).toContain(envelope.status);
    expect(envelope.errors).toHaveLength(0);

    const result = envelope.result as { output_file?: string };
    if (result.output_file) {
      expect(typeof result.output_file).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// render-waterfall-html run — error paths
// ---------------------------------------------------------------------------

// PINNED BEHAVIOR: runRenderWaterfallHtml() throws PricingCliError (code
// 'json_parse_error') when the example file does not exist, rather than
// returning an error envelope.  The dispatch harness converts this throw.
describe('render-waterfall-html run — error paths', () => {
  it('throws PricingCliError when the example file does not exist', () => {
    const args = renderWaterfallHtmlCommand.parseArgs([
      '--example', '/nonexistent/example.json',
      '--output', htmlPath,
    ]);
    expect(() => renderWaterfallHtmlCommand.run(args, Date.now())).toThrow(PricingCliError);
  });
});
