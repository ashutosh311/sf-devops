import { FAIL_CHOICES, FAIL_DEFAULTS } from '../lib/contracts/constants';
import { PricingCliError } from '../lib/contracts/errors';
import { runRenderWaterfallHtml, type RenderWaterfallHtmlArgs } from '../lib/waterfall/html-renderer';
import { parseFailOn } from '../cli/dispatch';
import type { CommandModule, MinCommandArgs } from '../cli/dispatch';

const HELP =
  'Render a self-contained HTML/SVG pricing waterfall page from example JSON.';

const DESCRIPTION =
  'Answer: can this waterfall example be displayed as a standalone HTML artifact with graph, evidence, mappings, and limitations?';

const EPILOG =
  'Workflow example: render-waterfall-html --example example.json --output artifacts/netunitprice-waterfall.html --json.';

const HELP_TEXT = [
  DESCRIPTION,
  '',
  'Usage:',
  '  pricing-procedure render-waterfall-html --example <example.json> --output <page.html> [options]',
  '',
  'Options:',
  '  --example <path>                 Waterfall example JSON or JSON envelope from waterfall-example.',
  '  --output <path>                  Destination standalone HTML file.',
  '  --json                           Emit the canonical machine-readable JSON envelope.',
  `  --fail-on <value>                Exit threshold. Default: ${FAIL_DEFAULTS['render-waterfall-html']}.`,
  `                                   Choices: ${FAIL_CHOICES.join(', ')}`,
  '',
  EPILOG,
].join('\n');

function parseRenderWaterfallHtmlArgs(argv: string[]): RenderWaterfallHtmlArgs {
  const parsed: RenderWaterfallHtmlArgs = {
    example: '',
    output: '',
    json: false,
    failOn: FAIL_DEFAULTS['render-waterfall-html'],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--json') {
      parsed.json = true;
      continue;
    }
    if (token === '--fail-on') {
      parsed.failOn = parseFailOn('render-waterfall-html', next);
      index += 1;
      continue;
    }
    if (token === '--example') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'render-waterfall-html requires a value for --example.', {}, 'Pass --example <path>.');
      }
      parsed.example = next;
      index += 1;
      continue;
    }
    if (token === '--output') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'render-waterfall-html requires a value for --output.', {}, 'Pass --output <path>.');
      }
      parsed.output = next;
      index += 1;
      continue;
    }
    throw new PricingCliError(
      'invalid_selector_format',
      `Unknown render-waterfall-html option: ${token}`,
      { token },
      'Use render-waterfall-html --help to review supported flags.',
    );
  }

  if (!parsed.example) {
    throw new PricingCliError('invalid_selector_format', 'render-waterfall-html requires --example.', {}, 'Pass --example <path>.');
  }
  if (!parsed.output) {
    throw new PricingCliError('invalid_selector_format', 'render-waterfall-html requires --output.', {}, 'Pass --output <path>.');
  }

  return parsed;
}

function sourceFiles(argv: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if ((token === '--example' || token === '--output') && index + 1 < argv.length) {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        result.push(next);
      }
    }
  }
  return result;
}

export const renderWaterfallHtmlCommand: CommandModule = {
  name: 'render-waterfall-html',
  help: HELP,
  helpText: HELP_TEXT,
  parseArgs(argv): MinCommandArgs {
    return parseRenderWaterfallHtmlArgs(argv);
  },
  run(args: MinCommandArgs, startedAt): ReturnType<typeof runRenderWaterfallHtml> {
    return runRenderWaterfallHtml(args as RenderWaterfallHtmlArgs, startedAt);
  },
  sourceFiles,
};
