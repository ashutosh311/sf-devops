import { FAIL_CHOICES, FAIL_DEFAULTS } from '../lib/contracts/constants';
import type { FailChoice } from '../lib/contracts/constants';
import { PricingCliError } from '../lib/contracts/errors';
import { runDoctor, type DoctorArgs } from '../lib/doctor';
import type { CommandModule, MinCommandArgs } from '../cli/dispatch';

const HELP =
  'Diagnose selector, artifact, and companion-file issues before or after a failed analysis run.';

const DESCRIPTION =
  'Answer: can the intended analysis proceed, and if not, what is blocking it?';

const EPILOG =
  'Workflow example: doctor --file <procedure-file> --context <context-file> --version active before summarize, inspect-step, or crosswalk.';

const HELP_TEXT = [
  DESCRIPTION,
  '',
  'Usage:',
  '  pricing-procedure doctor (--file <path> | --repo <path>) [options]',
  '',
  'Options:',
  '  --file <path>               Path to one pricing-procedure ExpressionSetDefinition file to diagnose.',
  '  --repo <path>               Repo subtree to scan recursively for candidate pricing procedures.',
  '  --context <path>            Optional ContextDefinition companion file to verify.',
  '  --version <selector>        Optional version selector: active, exact fullName, or rank:N.',
  '  --step-name <name>          Optional exact step name selector to validate in the chosen version scope.',
  '  --sequence <value>          Optional exact sequenceNumber selector to validate in the chosen version scope.',
  '  --json                      Emit the canonical machine-readable JSON envelope.',
  `  --fail-on <value>           Exit threshold. Default: ${FAIL_DEFAULTS.doctor}.`,
  `                              Choices: ${FAIL_CHOICES.join(', ')}`,
  '',
  EPILOG,
].join('\n');

function parseDoctorArgs(argv: string[]): DoctorArgs {
  const parsed: DoctorArgs = {
    json: false,
    failOn: FAIL_DEFAULTS.doctor,
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
          'doctor requires a value for --fail-on when the flag is supplied.',
          { command: 'doctor' },
          `Use one of: ${FAIL_CHOICES.join(', ')}.`,
        );
      }
      if (!(FAIL_CHOICES as readonly string[]).includes(next)) {
        throw new PricingCliError(
          'invalid_selector_format',
          `Invalid --fail-on value: ${next}`,
          { command: 'doctor', fail_on: next, allowed_values: FAIL_CHOICES },
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
          'doctor requires a value for --file.',
          {},
          'Pass --file <path> or use --repo <path>.',
        );
      }
      if (parsed.repo) {
        throw new PricingCliError(
          'invalid_selector_format',
          'doctor accepts exactly one of --file or --repo.',
          { file: next, repo: parsed.repo },
          'Pass one input mode only.',
        );
      }
      parsed.file = next;
      index += 1;
      continue;
    }
    if (token === '--repo') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'doctor requires a value for --repo.',
          {},
          'Pass --repo <path> or use --file <path>.',
        );
      }
      if (parsed.file) {
        throw new PricingCliError(
          'invalid_selector_format',
          'doctor accepts exactly one of --file or --repo.',
          { file: parsed.file, repo: next },
          'Pass one input mode only.',
        );
      }
      parsed.repo = next;
      index += 1;
      continue;
    }
    if (token === '--context') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'doctor requires a value for --context.',
          {},
          'Pass --context <path> when you want companion artifact verification.',
        );
      }
      parsed.context = next;
      index += 1;
      continue;
    }
    if (token === '--version') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'doctor requires a value for --version.',
          {},
          'Use one of: active, FULL_NAME, or rank:N.',
        );
      }
      parsed.version = next;
      index += 1;
      continue;
    }
    if (token === '--step-name') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'doctor requires a value for --step-name.',
          {},
          'Pass one exact step name.',
        );
      }
      parsed.stepName = next;
      index += 1;
      continue;
    }
    if (token === '--sequence') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'doctor requires a value for --sequence.',
          {},
          'Pass one exact sequence number.',
        );
      }
      parsed.sequence = next;
      index += 1;
      continue;
    }
    throw new PricingCliError(
      'invalid_selector_format',
      `Unknown doctor option: ${token}`,
      { token },
      'Use doctor --help to review supported flags.',
    );
  }

  if ((!parsed.file && !parsed.repo) || (parsed.file && parsed.repo)) {
    throw new PricingCliError(
      'invalid_selector_format',
      'doctor requires exactly one of --file or --repo.',
      { file: parsed.file ?? null, repo: parsed.repo ?? null },
      'Pass one input mode only.',
    );
  }

  return parsed;
}

function sourceFiles(argv: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if ((token === '--file' || token === '--repo' || token === '--context') && index + 1 < argv.length) {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        result.push(next);
      }
    }
  }
  return result;
}

export const doctorCommand: CommandModule = {
  name: 'doctor',
  help: HELP,
  helpText: HELP_TEXT,
  parseArgs(argv): MinCommandArgs {
    return parseDoctorArgs(argv);
  },
  run(args: MinCommandArgs, startedAt): ReturnType<typeof runDoctor> {
    return runDoctor(args as DoctorArgs, startedAt);
  },
  sourceFiles,
};
