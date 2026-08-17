import { FAIL_CHOICES, FAIL_DEFAULTS } from '../lib/contracts/constants';
import { PricingCliError } from '../lib/contracts/errors';
import { runWaterfallExample, type WaterfallExampleArgs } from '../lib/waterfall/example-builder';
import { parseFailOn } from '../cli/dispatch';
import type { CommandModule, MinCommandArgs } from '../cli/dispatch';

const HELP =
  'Apply fixture values or saved runtime waterfall evidence to a waterfall model.';

const DESCRIPTION =
  'Answer: what concrete bars, deltas, outputs, unresolved values, and overwrites should be rendered for a pricing waterfall?';

const EPILOG =
  'Workflow example: waterfall-example --model model.json --values values.json --json > example.json, or use --runtime-waterfall with saved quote-runtime inspect-pricing-waterfall JSON.';

const HELP_TEXT = [
  DESCRIPTION,
  '',
  'Usage:',
  '  pricing-procedure waterfall-example --model <model.json> (--values <values.json> | --runtime-waterfall <runtime.json>) [options]',
  '',
  'Options:',
  '  --model <path>                   Waterfall model JSON or JSON envelope from waterfall-model.',
  '  --values <path>                  Fixture value JSON. Accepts either a flat object or { "values": { ... } }.',
  '  --runtime-waterfall <path>       Saved quote-runtime inspect-pricing-waterfall JSON envelope.',
  '  --json                           Emit the canonical machine-readable JSON envelope.',
  `  --fail-on <value>                Exit threshold. Default: ${FAIL_DEFAULTS['waterfall-example']}.`,
  `                                   Choices: ${FAIL_CHOICES.join(', ')}`,
  '',
  EPILOG,
].join('\n');

function parseWaterfallExampleArgs(argv: string[]): WaterfallExampleArgs {
  const parsed: WaterfallExampleArgs = {
    model: '',
    json: false,
    failOn: FAIL_DEFAULTS['waterfall-example'],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--json') {
      parsed.json = true;
      continue;
    }
    if (token === '--fail-on') {
      parsed.failOn = parseFailOn('waterfall-example', next);
      index += 1;
      continue;
    }
    if (token === '--model') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'waterfall-example requires a value for --model.', {}, 'Pass --model <path>.');
      }
      parsed.model = next;
      index += 1;
      continue;
    }
    if (token === '--values') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'waterfall-example requires a value for --values.', {}, 'Pass --values <path>.');
      }
      parsed.values = next;
      index += 1;
      continue;
    }
    if (token === '--runtime-waterfall') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'waterfall-example requires a value for --runtime-waterfall.', {}, 'Pass --runtime-waterfall <path>.');
      }
      parsed.runtimeWaterfall = next;
      index += 1;
      continue;
    }
    throw new PricingCliError(
      'invalid_selector_format',
      `Unknown waterfall-example option: ${token}`,
      { token },
      'Use waterfall-example --help to review supported flags.',
    );
  }

  if (!parsed.model) {
    throw new PricingCliError('invalid_selector_format', 'waterfall-example requires --model.', {}, 'Pass --model <path>.');
  }

  return parsed;
}

function sourceFiles(argv: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if ((token === '--model' || token === '--values' || token === '--runtime-waterfall') && index + 1 < argv.length) {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        result.push(next);
      }
    }
  }
  return result;
}

export const waterfallExampleCommand: CommandModule = {
  name: 'waterfall-example',
  help: HELP,
  helpText: HELP_TEXT,
  parseArgs(argv): MinCommandArgs {
    return parseWaterfallExampleArgs(argv);
  },
  run(args: MinCommandArgs, startedAt): ReturnType<typeof runWaterfallExample> {
    return runWaterfallExample(args as WaterfallExampleArgs, startedAt);
  },
  sourceFiles,
};
