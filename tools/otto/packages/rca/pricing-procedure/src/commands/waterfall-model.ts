import { FAIL_DEFAULTS } from '../lib/contracts/constants';
import { PricingCliError } from '../lib/contracts/errors';
import { runWaterfallModel, type WaterfallModelArgs } from '../lib/waterfall/model';
import { parseFailOn } from '../cli/dispatch';
import type { CommandModule, MinCommandArgs } from '../cli/dispatch';
import { FAIL_CHOICES } from '../lib/contracts/constants';

const HELP =
  'Build graph-ready pricing waterfall JSON from pricing-procedure XML.';

const DESCRIPTION =
  'Answer: what ordered pricing steps, context tags, formulas, mappings, and graph edges explain a pricing waterfall slice?';

const EPILOG =
  'Workflow example: waterfall-model --file <procedure-file> --context <context-file> --version active --focus-tag NetUnitPrice --json > model.json.';

const HELP_TEXT = [
  DESCRIPTION,
  '',
  'Usage:',
  '  pricing-procedure waterfall-model --file <path> [options]',
  '',
  'Options:',
  '  --file <path>                    Path to one pricing-procedure ExpressionSetDefinition file.',
  '  --context <path>                 Optional ContextDefinition companion file for object-layer mapping labels.',
  '  --version <selector>             Optional version selector: active, exact fullName, or rank:N. Defaults to active when available.',
  '  --focus-tag <context-tag>        Optional context tag used to narrow the rendered waterfall slice.',
  '  --include-formula-details        Include full formula source strings instead of compact snippets.',
  '  --include-all-elements           Include every ordered pricing-procedure element instead of only the focused slice.',
  '  --json                           Emit the canonical machine-readable JSON envelope.',
  `  --fail-on <value>                Exit threshold. Default: ${FAIL_DEFAULTS['waterfall-model']}.`,
  `                                   Choices: ${FAIL_CHOICES.join(', ')}`,
  '',
  EPILOG,
].join('\n');

function parseWaterfallModelArgs(argv: string[]): WaterfallModelArgs {
  const parsed: WaterfallModelArgs = {
    file: '',
    includeFormulaDetails: false,
    includeAllElements: false,
    json: false,
    failOn: FAIL_DEFAULTS['waterfall-model'],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--json') {
      parsed.json = true;
      continue;
    }
    if (token === '--include-formula-details') {
      parsed.includeFormulaDetails = true;
      continue;
    }
    if (token === '--include-all-elements') {
      parsed.includeAllElements = true;
      continue;
    }
    if (token === '--fail-on') {
      parsed.failOn = parseFailOn('waterfall-model', next);
      index += 1;
      continue;
    }
    if (token === '--file') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'waterfall-model requires a value for --file.', {}, 'Pass --file <path>.');
      }
      parsed.file = next;
      index += 1;
      continue;
    }
    if (token === '--context') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'waterfall-model requires a value for --context.', {}, 'Pass --context <path>.');
      }
      parsed.context = next;
      index += 1;
      continue;
    }
    if (token === '--version') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'waterfall-model requires a value for --version.', {}, 'Use one of: active, FULL_NAME, or rank:N.');
      }
      parsed.version = next;
      index += 1;
      continue;
    }
    if (token === '--focus-tag') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'waterfall-model requires a value for --focus-tag.', {}, 'Pass one context tag.');
      }
      parsed.focusTag = next;
      index += 1;
      continue;
    }
    throw new PricingCliError(
      'invalid_selector_format',
      `Unknown waterfall-model option: ${token}`,
      { token },
      'Use waterfall-model --help to review supported flags.',
    );
  }

  if (!parsed.file) {
    throw new PricingCliError('invalid_selector_format', 'waterfall-model requires --file.', {}, 'Pass --file <path>.');
  }

  return parsed;
}

function sourceFiles(argv: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if ((token === '--file' || token === '--context') && index + 1 < argv.length) {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        result.push(next);
      }
    }
  }
  return result;
}

export const waterfallModelCommand: CommandModule = {
  name: 'waterfall-model',
  help: HELP,
  helpText: HELP_TEXT,
  parseArgs(argv): MinCommandArgs {
    return parseWaterfallModelArgs(argv);
  },
  run(args: MinCommandArgs, startedAt): ReturnType<typeof runWaterfallModel> {
    return runWaterfallModel(args as WaterfallModelArgs, startedAt);
  },
  sourceFiles,
};
