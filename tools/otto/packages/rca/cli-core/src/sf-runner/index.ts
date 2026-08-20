/**
 * Shared Salesforce CLI runner for the CLI family.
 *
 * This module makes cli-core a (small) runtime library rather than a
 * types-only contracts package — that is the intended direction: every
 * package that shells out to `sf` should build on this runner so fixes to
 * auth-error detection, timeout semantics, and buffer limits land once.
 *
 * BUILTINS ONLY: cli-core's main entry must stay free of external
 * dependencies (pricing-procedure-cli vendors the dist without
 * node_modules). This module may import only `node:*` builtins; the
 * package-surface test guards the main entry.
 *
 * Current consumers:
 * - quote-runtime-cli (`integrations/salesforce/sf-cli.ts` adapter over
 *   `invokeSfCliJson`)
 * - sfx `discover org-baseline` (`SystemOrgBaselineCommandRunner` over
 *   `executeSfCommand`)
 *
 * Follow-ups (not yet migrated):
 * - sfx doctor runners (`commands/doctor/resolution.ts`, `doctor/sf-cli.ts`)
 *   use sync `execFileSync`/`which` probing with different semantics.
 * - pricing-procedure-cli still shells out with `spawnSync` from its entry.
 */

export * from './types';
export * from './classify';
export * from './parse';
export * from './execute';
export * from './invoke';
