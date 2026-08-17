export const SCHEMA_VERSION = '1.0.0';
export const TOOL_VERSION = '1.0.0';

export const ALL_COMMANDS = [
  'discover',
  'validate',
  'diff',
  'summarize',
  'trace-tag',
  'waterfall-model',
  'waterfall-example',
  'render-waterfall-html',
  'plan-change',
  'inspect-step',
  'crosswalk',
  'doctor',
  'explain-error',
] as const;

export type CommandName = (typeof ALL_COMMANDS)[number];

export const STATUS_PRECEDENCE = {
  ok: 0,
  no_change: 1,
  no_match: 2,
  changed: 3,
  warn: 4,
  partial: 5,
  unsupported: 6,
  error: 7,
} as const;

export const STATUS_VALUES = Object.freeze(
  Object.keys(STATUS_PRECEDENCE) as Array<keyof typeof STATUS_PRECEDENCE>,
);

export type Status = keyof typeof STATUS_PRECEDENCE;

export const FAIL_CHOICES = [
  'none',
  'warn',
  'changed',
  'partial',
  'no_match',
  'unsupported',
] as const;

export type FailChoice = (typeof FAIL_CHOICES)[number];

export const FAIL_DEFAULTS = {
  discover: 'unsupported',
  validate: 'warn',
  diff: 'changed',
  summarize: 'unsupported',
  'trace-tag': 'no_match',
  'waterfall-model': 'no_match',
  'waterfall-example': 'warn',
  'render-waterfall-html': 'warn',
  'plan-change': 'no_match',
  'inspect-step': 'no_match',
  crosswalk: 'partial',
  doctor: 'warn',
} as const satisfies Partial<Record<CommandName, FailChoice>>;

export const READONLY_NOTE = 'Read-only analysis is the default.';
export const REPO_SCAN_EXCLUDED_DIRS = new Set([
  '.git',
  '.sf',
  '.sfdx',
  'node_modules',
  '.venv',
  'venv',
]);
export const REPO_SCAN_LIMIT = 500;

export const MATCH_STATUS_VALUES = [
  'exact_attribute_match',
  'exact_tag_match',
  'exact_query_attribute_match',
  'normalized_family_match',
  'ambiguous_family_match',
  'no_direct_match',
] as const;

export type MatchStatus = (typeof MATCH_STATUS_VALUES)[number];
