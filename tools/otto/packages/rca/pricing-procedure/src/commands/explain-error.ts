import { makeEnvelope, makeNotice, makeSummary } from '../lib/contracts/envelope';
import {
  ERROR_CODE_ALIASES,
  PricingCliError,
  explainErrorCode,
  knownErrorCodes,
} from '../lib/contracts/errors';
import type { Envelope } from '../lib/contracts/types';
import type { CommandModule, MinCommandArgs } from '../cli/dispatch';

const HELP =
  'Translate a stable CLI error or warning code into remediation guidance.';

const DESCRIPTION =
  'Answer: what does this stable CLI code mean, and what should I do next?';

const EPILOG =
  'Use explain-error --list-codes to discover canonical codes and aliases before looking up one exact code.';

const HELP_TEXT = [
  DESCRIPTION,
  '',
  'Usage:',
  '  pricing-procedure explain-error (--list-codes | --code <code>) [--json]',
  '',
  'Options:',
  '  --code <code>    Stable CLI code to explain, such as invalid_selector_format or version_not_found.',
  '  --list-codes     List known canonical error codes plus accepted alias spellings.',
  '  --json           Emit the canonical machine-readable JSON envelope.',
  '',
  EPILOG,
].join('\n');

interface ExplainErrorArgs extends MinCommandArgs {
  code?: string;
  listCodes: boolean;
}

function parseExplainErrorArgs(argv: string[]): ExplainErrorArgs {
  // explain-error never exits with non-zero due to --fail-on; failOn is always 'none'.
  const parsed: ExplainErrorArgs = { listCodes: false, json: false, failOn: 'none' };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      parsed.json = true;
      continue;
    }
    if (token === '--list-codes') {
      parsed.listCodes = true;
      continue;
    }
    if (token === '--code') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        throw new PricingCliError(
          'invalid_selector_format',
          'explain-error requires a value for --code.',
          {},
          'Pass one exact --code value, or use --list-codes.',
        );
      }
      parsed.code = next;
      index += 1;
      continue;
    }
    throw new PricingCliError(
      'invalid_selector_format',
      `Unknown explain-error option: ${token}`,
      { token },
      'Use explain-error --help to review the supported flags for the TS shell.',
    );
  }

  if (!parsed.listCodes && !parsed.code) {
    throw new PricingCliError(
      'invalid_selector_format',
      'explain-error requires either --code or --list-codes.',
      {},
      'Use explain-error --list-codes to discover canonical codes, or pass one exact --code.',
    );
  }

  return parsed;
}

function buildExplainErrorEnvelope(args: ExplainErrorArgs, startedAt: number): Envelope<unknown> {
  if (args.listCodes) {
    const result = {
      error_codes: knownErrorCodes(),
      error_code_aliases: ERROR_CODE_ALIASES,
    };
    return makeEnvelope(
      'explain-error',
      makeSummary(
        'code-index',
        'Known error code list completed.',
        {
          error_code_count: result.error_codes.length,
          alias_count: Object.keys(result.error_code_aliases).length,
        },
        'explain-error',
      ),
      result,
      { status: 'ok', source_files: [], started_at: startedAt },
    );
  }

  const [explained, unknownPayload] = explainErrorCode(args.code!);
  if (!explained) {
    return makeEnvelope(
      'explain-error',
      makeSummary(args.code!, 'Unknown error code.', {}, 'doctor'),
      unknownPayload,
      {
        warnings: [
          makeNotice(
            'no_match',
            'No explanation entry exists for the requested error code.',
            {
              error_code: args.code!,
              closest_known_codes: unknownPayload.closest_known_codes,
            },
            'Use --list-codes, or retry with the suggested canonical code when one is available.',
          ),
        ],
        status: 'no_match',
        source_files: [],
        started_at: startedAt,
      },
    );
  }

  return makeEnvelope(
    'explain-error',
    makeSummary(args.code!, 'Error explanation completed.', {}, 'doctor'),
    explained,
    { status: 'ok', source_files: [], started_at: startedAt },
  );
}

export const explainErrorCommand: CommandModule = {
  name: 'explain-error',
  help: HELP,
  helpText: HELP_TEXT,
  parseArgs(argv): MinCommandArgs {
    return parseExplainErrorArgs(argv);
  },
  run(args: MinCommandArgs, startedAt): Envelope<unknown> {
    return buildExplainErrorEnvelope(args as ExplainErrorArgs, startedAt);
  },
  sourceFiles(): string[] {
    return [];
  },
};
