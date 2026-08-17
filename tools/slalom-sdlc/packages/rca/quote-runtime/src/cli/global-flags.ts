import { Flags, Parser } from '@oclif/core';

import { FAIL_ON_VALUES, type FailOn } from '../contracts/status';

export const GLOBAL_FLAG_DEFINITIONS = {
  help: Flags.boolean({
    allowNo: false,
    summary: 'Show root help.'
  }),
  json: Flags.boolean({
    allowNo: false,
    summary: 'Emit JSON output.'
  }),
  'org-alias': Flags.string({
    summary: 'Target Salesforce org alias.',
    helpValue: '<alias>'
  }),
  'fail-on': Flags.option({
    options: FAIL_ON_VALUES,
    summary: 'Fail when status reaches or exceeds the chosen threshold.',
    helpValue: '<status>'
  })(),
  output: Flags.string({
    summary: 'Write the same payload that would otherwise go to stdout.',
    helpValue: '<path>'
  }),
  verbose: Flags.boolean({
    allowNo: false,
    summary: 'Emit verbose diagnostic detail in text mode.'
  })
};

export type GlobalFlags = {
  help: boolean;
  json: boolean;
  orgAlias: string | undefined;
  failOn: FailOn | undefined;
  output: string | undefined;
  verbose: boolean;
};

export type RootArgvShape = {
  globalArgv: string[];
  commandName: string | undefined;
  commandArgv: string[];
};

const GLOBAL_BOOLEAN_FLAGS = new Set(['--help', '--json', '--verbose']);
const GLOBAL_VALUE_FLAGS = new Set(['--org-alias', '--fail-on', '--output']);

export function splitRootArgv(argv: string[]): RootArgvShape {
  const globalArgv: string[] = [];
  const commandArgv: string[] = [];

  let commandName: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === undefined) {
      continue;
    }

    if (commandName !== undefined && token === '--help') {
      commandArgv.push(token);
      continue;
    }

    if (isRecognizedGlobalBooleanFlag(token)) {
      globalArgv.push(token);
      continue;
    }

    const globalValueFlag = getRecognizedGlobalValueFlag(token);

    if (globalValueFlag !== undefined) {
      const nextValue = argv[index + 1];

      if (token.includes('=')) {
        globalArgv.push(token);
        continue;
      }

      if (nextValue === undefined || nextValue.startsWith('-')) {
        throw new Error(`Missing value for global flag: ${globalValueFlag}`);
      }

      globalArgv.push(globalValueFlag, nextValue);
      index += 1;
      continue;
    }

    if (token.startsWith('-')) {
      if (commandName === undefined) {
        throw new Error(`Unknown global flag: ${token}`);
      }

      commandArgv.push(token);
      continue;
    }

    if (commandName === undefined) {
      commandName = token;
      continue;
    }

    commandArgv.push(token);
  }

  return {
    globalArgv,
    commandName,
    commandArgv
  };
}

export async function parseGlobalFlags(argv: string[]): Promise<GlobalFlags> {
  const parsed = (await Parser.parse(argv, {
    args: {},
    enableJsonFlag: false,
    flags: GLOBAL_FLAG_DEFINITIONS,
    strict: true
  })) as {
    flags: {
      help?: boolean;
      json?: boolean;
      'org-alias'?: string;
      'fail-on'?: FailOn;
      output?: string;
      verbose?: boolean;
    };
  };

  return {
    help: parsed.flags.help ?? false,
    json: parsed.flags.json ?? false,
    orgAlias: parsed.flags['org-alias'],
    failOn: parsed.flags['fail-on'],
    output: parsed.flags.output,
    verbose: parsed.flags.verbose ?? false
  };
}

function isRecognizedGlobalBooleanFlag(token: string): boolean {
  return GLOBAL_BOOLEAN_FLAGS.has(token);
}

function getRecognizedGlobalValueFlag(token: string): string | undefined {
  if (GLOBAL_VALUE_FLAGS.has(token)) {
    return token;
  }

  if (!token.startsWith('--')) {
    return undefined;
  }

  const flagName = token.split('=', 1)[0];

  return flagName !== undefined && GLOBAL_VALUE_FLAGS.has(flagName) ? flagName : undefined;
}
