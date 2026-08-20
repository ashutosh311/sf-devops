import { FAIL_CHOICES, FAIL_DEFAULTS } from '../lib/contracts/constants';
import type { FailChoice } from '../lib/contracts/constants';
import { PricingCliError } from '../lib/contracts/errors';
import { runCrosswalk, type CrosswalkArgs } from '../lib/crosswalk';
import type { CommandModule, MinCommandArgs } from '../cli/dispatch';

const HELP =
  'Crosswalk pricing-procedure context tags to context-definition and object-layer surfaces.';

const DESCRIPTION =
  'Answer: how does a requested context tag map through the context definition and object-layer fields?';

const EPILOG =
  'Use --tag for the preferred context-tag-centered workflow. Default scope includes all matched versions; use --version active or --active-only for normal edit-planning and object-layer validation workflows. Keep --name for lower-level parameter searches and backward compatibility.';

const HELP_TEXT = [
  DESCRIPTION,
  '',
  'Usage:',
  '  pricing-procedure crosswalk --procedure <path> --context <path> [options]',
  '',
  'Options:',
  '  --procedure <path>                 Path to one pricing-procedure ExpressionSetDefinition file.',
  '  --context <path>                   Path to one ContextDefinition metadata file.',
  '  --version <selector>               Optional version selector: active, exact fullName, or rank:N. Defaults to all matched versions unless you pass --active-only.',
  '  --active-only                      Shortcut for --version active when no explicit --version selector is supplied.',
  '  --tag <tag>                        Preferred context-tag filter for tag-centered crosswalk output.',
  '  --name <name>                      Optional exact parameter name or parameter value filter for lower-level searches.',
  '  --distinct                         Deduplicate repeated procedure references and mapping rows where possible.',
  '  --include-mappings                 Include entity-mapping targets in the tag-centered output.',
  '  --include-hydration                Include hydration_details inside entity_mapping_targets when mapping evidence is needed.',
  '  --include-procedure-references     Include raw repeated procedure references in procedure_reference_summary.',
  '  --include-context-matches-full     Include full context_tag_matches entries instead of the compact default summary rows.',
  '  --object <name>                    Optional object-layer target filter, such as Quote or QuoteLineItem.',
  '  --compact                          Request compact crosswalk output (default contract intent).',
  '  --verbose                          Request expanded crosswalk output where supported.',
  '  --json                             Emit the canonical machine-readable JSON envelope.',
  `  --fail-on <value>                  Exit threshold. Default: ${FAIL_DEFAULTS.crosswalk}.`,
  `                                     Choices: ${FAIL_CHOICES.join(', ')}`,
  '',
  EPILOG,
].join('\n');

function parseCrosswalkArgs(argv: string[]): CrosswalkArgs {
  const parsed: CrosswalkArgs = {
    procedure: '',
    context: '',
    activeOnly: false,
    distinct: false,
    includeMappings: false,
    includeHydration: false,
    includeProcedureReferences: false,
    includeContextMatchesFull: false,
    compact: false,
    verbose: false,
    json: false,
    failOn: FAIL_DEFAULTS.crosswalk,
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
    if (token === '--distinct') {
      parsed.distinct = true;
      continue;
    }
    if (token === '--include-mappings') {
      parsed.includeMappings = true;
      continue;
    }
    if (token === '--include-hydration') {
      parsed.includeHydration = true;
      continue;
    }
    if (token === '--include-procedure-references') {
      parsed.includeProcedureReferences = true;
      continue;
    }
    if (token === '--include-context-matches-full') {
      parsed.includeContextMatchesFull = true;
      continue;
    }
    if (token === '--compact') {
      if (parsed.verbose) {
        throw new PricingCliError('invalid_selector_format', 'crosswalk accepts at most one verbosity flag.', { compact: true, verbose: true }, 'Use either --compact or --verbose.');
      }
      parsed.compact = true;
      continue;
    }
    if (token === '--verbose') {
      if (parsed.compact) {
        throw new PricingCliError('invalid_selector_format', 'crosswalk accepts at most one verbosity flag.', { compact: true, verbose: true }, 'Use either --compact or --verbose.');
      }
      parsed.verbose = true;
      continue;
    }
    if (token === '--fail-on') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'crosswalk requires a value for --fail-on when the flag is supplied.', { command: 'crosswalk' }, `Use one of: ${FAIL_CHOICES.join(', ')}.`);
      }
      if (!(FAIL_CHOICES as readonly string[]).includes(next)) {
        throw new PricingCliError('invalid_selector_format', `Invalid --fail-on value: ${next}`, { command: 'crosswalk', fail_on: next, allowed_values: FAIL_CHOICES }, `Use one of: ${FAIL_CHOICES.join(', ')}.`);
      }
      parsed.failOn = next as FailChoice;
      index += 1;
      continue;
    }
    if (token === '--procedure') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'crosswalk requires a value for --procedure.', {}, 'Pass --procedure <path>.');
      }
      parsed.procedure = next;
      index += 1;
      continue;
    }
    if (token === '--context') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'crosswalk requires a value for --context.', {}, 'Pass --context <path>.');
      }
      parsed.context = next;
      index += 1;
      continue;
    }
    if (token === '--version') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'crosswalk requires a value for --version.', {}, 'Use one of: active, FULL_NAME, or rank:N.');
      }
      parsed.version = next;
      index += 1;
      continue;
    }
    if (token === '--tag') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'crosswalk requires a value for --tag.', {}, 'Pass one context tag value.');
      }
      parsed.tag = next;
      index += 1;
      continue;
    }
    if (token === '--name') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'crosswalk requires a value for --name.', {}, 'Pass one exact parameter name or parameter value.');
      }
      parsed.name = next;
      index += 1;
      continue;
    }
    if (token === '--object') {
      if (!next || next.startsWith('--')) {
        throw new PricingCliError('invalid_selector_format', 'crosswalk requires a value for --object.', {}, 'Pass one object-layer target name.');
      }
      parsed.object = next;
      index += 1;
      continue;
    }
    throw new PricingCliError(
      'invalid_selector_format',
      `Unknown crosswalk option: ${token}`,
      { token },
      'Use crosswalk --help to review supported flags.',
    );
  }

  if (!parsed.procedure || !parsed.context) {
    throw new PricingCliError(
      'invalid_selector_format',
      'crosswalk requires --procedure and --context.',
      { procedure: parsed.procedure || null, context: parsed.context || null },
      'Pass both --procedure <path> and --context <path>.',
    );
  }

  return parsed;
}

function sourceFiles(argv: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if ((token === '--procedure' || token === '--context') && index + 1 < argv.length) {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        result.push(next);
      }
    }
  }
  return result;
}

export const crosswalkCommand: CommandModule = {
  name: 'crosswalk',
  help: HELP,
  helpText: HELP_TEXT,
  parseArgs(argv): MinCommandArgs {
    return parseCrosswalkArgs(argv);
  },
  run(args: MinCommandArgs, startedAt): ReturnType<typeof runCrosswalk> {
    return runCrosswalk(args as CrosswalkArgs, startedAt);
  },
  sourceFiles,
};
