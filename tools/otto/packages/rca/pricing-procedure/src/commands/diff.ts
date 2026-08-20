import { FAIL_CHOICES, FAIL_DEFAULTS } from '../lib/contracts/constants';
import type { FailChoice } from '../lib/contracts/constants';
import { PricingCliError } from '../lib/contracts/errors';
import { runDiff, type DiffArgs } from '../lib/diff';
import type { CommandModule, MinCommandArgs } from '../cli/dispatch';

const HELP =
  'Semantic diff for two pricing procedure files or two versions in one file.';

const DESCRIPTION =
  'Answer: what meaningful pricing-procedure changes exist between two files or two versions?';

const EPILOG =
  'Workflow example: diff --file <procedure-file> --version-left rank:1 --version-right active --tag NetUnitPrice. Use --left/--right for two-file comparison. Use --include-change-buckets or --include-raw when you need expanded evidence beyond the compact semantic summary.';

const HELP_TEXT = [
  DESCRIPTION,
  '',
  'Usage:',
  '  pricing-procedure diff (--file <path> | --left <path> --right <path>) [options]',
  '',
  'Options:',
  '  --file <path>               One file containing both versions to compare.',
  '  --left <path>               Left-side pricing procedure file for two-file diff mode.',
  '  --right <path>              Right-side pricing procedure file for two-file diff mode.',
  '  --version-left <selector>   Left version selector for single-file diff mode.',
  '  --version-right <selector>  Right version selector for single-file diff mode.',
  '  --tag <tag>                 Optional context tag for compact tag-centered flow drift summary.',
  '  --compact                   Request compact semantic diff output (default).',
  '  --verbose                   Include expanded evidence payloads and change buckets.',
  '  --include-change-buckets    Include raw semantic change buckets in the result.',
  '  --include-raw               Include full normalized left/right version payloads.',
  '  --json                      Emit the canonical machine-readable JSON envelope.',
  `  --fail-on <value>           Exit threshold. Default: ${FAIL_DEFAULTS.diff}.`,
  `                              Choices: ${FAIL_CHOICES.join(', ')}`,
  '',
  EPILOG,
].join('\n');

function parseDiffArgs(argv: string[]): DiffArgs {
  const parsed: DiffArgs = {
    compact: false,
    verbose: false,
    includeChangeBuckets: false,
    includeRaw: false,
    json: false,
    failOn: FAIL_DEFAULTS.diff,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--json') {
      parsed.json = true;
      continue;
    }
    if (token === '--compact') {
      if (parsed.verbose) {
        throw new PricingCliError(
          'invalid_selector_format',
          'diff accepts at most one verbosity flag.',
          { compact: true, verbose: true },
          'Use either --compact or --verbose.',
        );
      }
      parsed.compact = true;
      continue;
    }
    if (token === '--verbose') {
      if (parsed.compact) {
        throw new PricingCliError(
          'invalid_selector_format',
          'diff accepts at most one verbosity flag.',
          { compact: true, verbose: true },
          'Use either --compact or --verbose.',
        );
      }
      parsed.verbose = true;
      continue;
    }
    if (token === '--include-change-buckets') {
      parsed.includeChangeBuckets = true;
      continue;
    }
    if (token === '--include-raw') {
      parsed.includeRaw = true;
      continue;
    }
    if (token === '--fail-on') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'diff requires a value for --fail-on when the flag is supplied.',
          { command: 'diff' },
          `Use one of: ${FAIL_CHOICES.join(', ')}.`,
        );
      }
      if (!(FAIL_CHOICES as readonly string[]).includes(next)) {
        throw new PricingCliError(
          'invalid_selector_format',
          `Invalid --fail-on value: ${next}`,
          { command: 'diff', fail_on: next, allowed_values: FAIL_CHOICES },
          `Use one of: ${FAIL_CHOICES.join(', ')}.`,
        );
      }
      parsed.failOn = next as FailChoice;
      index += 1;
      continue;
    }
    if (token === '--file') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'diff requires a value for --file.', {}, 'Pass --file <path>.');
      }
      parsed.file = next;
      index += 1;
      continue;
    }
    if (token === '--left') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'diff requires a value for --left.', {}, 'Pass --left <path>.');
      }
      parsed.left = next;
      index += 1;
      continue;
    }
    if (token === '--right') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'diff requires a value for --right.', {}, 'Pass --right <path>.');
      }
      parsed.right = next;
      index += 1;
      continue;
    }
    if (token === '--version-left') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'diff requires a value for --version-left.',
          {},
          'Use one of: active, FULL_NAME, or rank:N.',
        );
      }
      parsed.versionLeft = next;
      index += 1;
      continue;
    }
    if (token === '--version-right') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'diff requires a value for --version-right.',
          {},
          'Use one of: active, FULL_NAME, or rank:N.',
        );
      }
      parsed.versionRight = next;
      index += 1;
      continue;
    }
    if (token === '--tag') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'diff requires a value for --tag.', {}, 'Pass one context tag value.');
      }
      parsed.tag = next;
      index += 1;
      continue;
    }
    throw new PricingCliError(
      'invalid_selector_format',
      `Unknown diff option: ${token}`,
      { token },
      'Use diff --help to review supported flags.',
    );
  }

  return parsed;
}

function sourceFiles(argv: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if ((token === '--file' || token === '--left' || token === '--right') && index + 1 < argv.length) {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        result.push(next);
      }
    }
  }
  return result;
}

export const diffCommand: CommandModule = {
  name: 'diff',
  help: HELP,
  helpText: HELP_TEXT,
  parseArgs(argv): MinCommandArgs {
    return parseDiffArgs(argv);
  },
  run(args: MinCommandArgs, startedAt): ReturnType<typeof runDiff> {
    return runDiff(args as DiffArgs, startedAt);
  },
  sourceFiles,
};
