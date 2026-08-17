import { FAIL_CHOICES, FAIL_DEFAULTS } from '../lib/contracts/constants';
import type { FailChoice } from '../lib/contracts/constants';
import { PricingCliError } from '../lib/contracts/errors';
import { runSummarize, type SummarizeArgs } from '../lib/summarize';
import type { CommandModule, MinCommandArgs } from '../cli/dispatch';

const HELP =
  'Compact routing summary for pricing-procedure action families, output context tags, and lookup surfaces.';

const DESCRIPTION =
  'Answer: what is the compact operational shape of this pricing procedure, and where should I route next?';

const EPILOG =
  'Workflow example: summarize --version active --focus-tag NetUnitPrice before routing to trace-tag or crosswalk. Defaults to all matched versions. Use --version active for most workflow questions when you want one edit target instead of cross-version aggregation.';

const HELP_TEXT = [
  DESCRIPTION,
  '',
  'Usage:',
  '  pricing-procedure summarize --file <path> [options]',
  '',
  'Options:',
  '  --file <path>               Path to one pricing-procedure ExpressionSetDefinition file.',
  '  --version <selector>        Optional version selector: active, exact fullName, or rank:N. Defaults to all matched versions.',
  '  --active-only               Shortcut for --version active when no explicit --version selector is supplied.',
  '  --focus-tag <tag>           Optional context tag to check for broad presence without doing a full provenance trace.',
  '  --json                      Emit the canonical machine-readable JSON envelope.',
  `  --fail-on <value>           Exit threshold. Default: ${FAIL_DEFAULTS.summarize}.`,
  `                              Choices: ${FAIL_CHOICES.join(', ')}`,
  '',
  EPILOG,
].join('\n');

function parseSummarizeArgs(argv: string[]): SummarizeArgs {
  const parsed: SummarizeArgs = {
    file: '',
    json: false,
    failOn: FAIL_DEFAULTS.summarize,
    activeOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--json') {
      parsed.json = true;
      continue;
    }
    if (token === '--active-only') {
      parsed.activeOnly = true;
      continue;
    }
    if (token === '--fail-on') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'summarize requires a value for --fail-on when the flag is supplied.',
          { command: 'summarize' },
          `Use one of: ${FAIL_CHOICES.join(', ')}.`,
        );
      }
      if (!(FAIL_CHOICES as readonly string[]).includes(next)) {
        throw new PricingCliError(
          'invalid_selector_format',
          `Invalid --fail-on value: ${next}`,
          { command: 'summarize', fail_on: next, allowed_values: FAIL_CHOICES },
          `Use one of: ${FAIL_CHOICES.join(', ')}.`,
        );
      }
      parsed.failOn = next as FailChoice;
      index += 1;
      continue;
    }
    if (token === '--file') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'summarize requires a value for --file.',
          {},
          'Pass --file <path>.',
        );
      }
      parsed.file = next;
      index += 1;
      continue;
    }
    if (token === '--version') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'summarize requires a value for --version.',
          {},
          'Use one of: active, FULL_NAME, or rank:N.',
        );
      }
      parsed.version = next;
      index += 1;
      continue;
    }
    if (token === '--focus-tag') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'summarize requires a value for --focus-tag.',
          {},
          'Pass one context tag value when you want a targeted routing check.',
        );
      }
      parsed.focusTag = next;
      index += 1;
      continue;
    }
    throw new PricingCliError(
      'invalid_selector_format',
      `Unknown summarize option: ${token}`,
      { token },
      'Use summarize --help to review supported flags.',
    );
  }

  if (!parsed.file) {
    throw new PricingCliError(
      'invalid_selector_format',
      'summarize requires --file.',
      {},
      'Pass --file <path>.',
    );
  }

  return parsed;
}

function sourceFiles(argv: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--file' && index + 1 < argv.length) {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        result.push(next);
      }
    }
  }
  return result;
}

export const summarizeCommand: CommandModule = {
  name: 'summarize',
  help: HELP,
  helpText: HELP_TEXT,
  parseArgs(argv): MinCommandArgs {
    return parseSummarizeArgs(argv);
  },
  run(args: MinCommandArgs, startedAt): ReturnType<typeof runSummarize> {
    return runSummarize(args as SummarizeArgs, startedAt);
  },
  sourceFiles,
};
