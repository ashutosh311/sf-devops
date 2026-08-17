import { ALL_COMMAND_SPECS } from '../commands/all-commands';
import { listExecutableCommands, ROOT_COMMAND_GROUPS } from '../registry/command-registry';

// ---------------------------------------------------------------------------
// QUICK_STARTS — derived from ALL_COMMAND_SPECS (plan 022 Q3)
//
// Each spec carries a `quickStart` field: a string for most commands, or a
// readonly string[] for commands that provide multiple examples (`doctor`).
// The ordering follows ALL_COMMAND_SPECS (wave 1 → 2 → 3), which matches the
// pre-Q3 ordering that expected-root-help.txt fixtures are locked against.
// ---------------------------------------------------------------------------

const QUICK_STARTS: readonly string[] = ALL_COMMAND_SPECS.flatMap((spec) =>
  typeof spec.quickStart === 'string' ? [spec.quickStart] : [...spec.quickStart]
);

export function renderRootHelp(): string {
  const commandsByGroup = new Map(ROOT_COMMAND_GROUPS.map((group) => [group.name, [] as string[]]));

  for (const entry of listExecutableCommands()) {
    commandsByGroup.get(entry.group_name)?.push(`  ${entry.name}`);
  }

  const sections = [
    'quote-runtime',
    '',
    'Usage:',
    '  quote-runtime <command> [flags]',
    '',
    'Global flags:',
    '  --json',
    '  --org-alias <alias>',
    '  --fail-on <status>',
    '  --output <path>',
    '  --verbose',
    ''
  ];

  for (const group of ROOT_COMMAND_GROUPS) {
    sections.push(`${group.name}:`);
    sections.push(...(commandsByGroup.get(group.name) ?? []));
    sections.push('');
  }

  sections.push('Quick starts:');
  sections.push(...QUICK_STARTS.map((example) => `  ${example}`));
  sections.push('');
  sections.push('Notes:');
  sections.push('  Installed workspace binary `quote-runtime` is the canonical operator path in this repo.');
  sections.push('  The skill-local TS script remains a repo-local implementation detail and compatibility fallback.');
  sections.push('  Product discovery/config inspection is deterministic; transcript interpretation remains agent-owned.');
  sections.push('  inspect-rlm-context is an escalation lane and stays summary-first; it does not replace persisted snapshots.');
  sections.push('');

  return sections.join('\n');
}
