import { FAIL_CHOICES, FAIL_DEFAULTS } from '../lib/contracts/constants';
import type { FailChoice } from '../lib/contracts/constants';
import { PricingCliError } from '../lib/contracts/errors';
import { runValidate, type ValidateArgs } from '../lib/validate';
import type { CommandModule, MinCommandArgs } from '../cli/dispatch';

const HELP =
  'Validate pricing procedure structure and optional context linkage exact matches.';

const DESCRIPTION =
  'Answer: is this pricing procedure structurally and semantically sane for safe investigation?';

const EPILOG =
  'Use crosswalk after validate when the question becomes context linkage. Next commands: summarize, crosswalk, or doctor.';

const HELP_TEXT = [
  DESCRIPTION,
  '',
  'Usage:',
  '  pricing-procedure validate --file <path> [options]',
  '',
  'Options:',
  '  --file <path>               Path to one pricing-procedure ExpressionSetDefinition file.',
  '  --version <selector>        Optional version selector: active, exact fullName, or rank:N.',
  '  --context <path>            Optional ContextDefinition companion file for exact output-value cross-checks.',
  '  --json                      Emit the canonical machine-readable JSON envelope.',
  `  --fail-on <value>           Exit threshold. Default: ${FAIL_DEFAULTS.validate}.`,
  `                              Choices: ${FAIL_CHOICES.join(', ')}`,
  '',
  EPILOG,
].join('\n');

function parseValidateArgs(argv: string[]): ValidateArgs {
  const parsed: ValidateArgs = {
    file: '',
    json: false,
    failOn: FAIL_DEFAULTS.validate,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--json') {
      parsed.json = true;
      continue;
    }
    if (token === '--fail-on') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'validate requires a value for --fail-on when the flag is supplied.',
          { command: 'validate' },
          `Use one of: ${FAIL_CHOICES.join(', ')}.`,
        );
      }
      if (!(FAIL_CHOICES as readonly string[]).includes(next)) {
        throw new PricingCliError(
          'invalid_selector_format',
          `Invalid --fail-on value: ${next}`,
          { command: 'validate', fail_on: next, allowed_values: FAIL_CHOICES },
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
          'validate requires a value for --file.',
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
          'validate requires a value for --version.',
          {},
          'Use one of: active, FULL_NAME, or rank:N.',
        );
      }
      parsed.version = next;
      index += 1;
      continue;
    }
    if (token === '--context') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'validate requires a value for --context.',
          {},
          'Pass --context <path> when you want exact output-value cross-checks.',
        );
      }
      parsed.context = next;
      index += 1;
      continue;
    }
    throw new PricingCliError(
      'invalid_selector_format',
      `Unknown validate option: ${token}`,
      { token },
      'Use validate --help to review supported flags.',
    );
  }

  if (!parsed.file) {
    throw new PricingCliError(
      'invalid_selector_format',
      'validate requires --file.',
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
    if ((token === '--file' || token === '--context') && index + 1 < argv.length) {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        result.push(next);
      }
    }
  }
  return result;
}

export const validateCommand: CommandModule = {
  name: 'validate',
  help: HELP,
  helpText: HELP_TEXT,
  parseArgs(argv): MinCommandArgs {
    return parseValidateArgs(argv);
  },
  run(args: MinCommandArgs, startedAt): ReturnType<typeof runValidate> {
    return runValidate(args as ValidateArgs, startedAt);
  },
  sourceFiles,
};
