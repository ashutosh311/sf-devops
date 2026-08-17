#!/usr/bin/env node

/**
 * Pricing-procedure CLI entry point.
 *
 * Thin wire-up: imports each command module and hands them to the shared
 * dispatch harness.  All argument parsing, help text, and run logic live in
 * the individual command files under commands/ and the harness in cli/dispatch.
 */

import { runDispatch } from './cli/dispatch';
import { discoverCommand } from './commands/discover';
import { validateCommand } from './commands/validate';
import { diffCommand } from './commands/diff';
import { summarizeCommand } from './commands/summarize';
import { traceTagCommand } from './commands/trace-tag';
import { waterfallModelCommand } from './commands/waterfall-model';
import { waterfallExampleCommand } from './commands/waterfall-example';
import { renderWaterfallHtmlCommand } from './commands/render-waterfall-html';
import { planChangeCommand } from './commands/plan-change';
import { inspectStepCommand } from './commands/inspect-step';
import { crosswalkCommand } from './commands/crosswalk';
import { doctorCommand } from './commands/doctor';
import { explainErrorCommand } from './commands/explain-error';

/** All command modules registered in the canonical ALL_COMMANDS order. */
const COMMAND_MODULES = [
  discoverCommand,
  validateCommand,
  diffCommand,
  summarizeCommand,
  traceTagCommand,
  waterfallModelCommand,
  waterfallExampleCommand,
  renderWaterfallHtmlCommand,
  planChangeCommand,
  inspectStepCommand,
  crosswalkCommand,
  doctorCommand,
  explainErrorCommand,
];

export function main(argv: string[] = process.argv.slice(2)): number {
  return runDispatch(COMMAND_MODULES, argv);
}

/** All command modules, exposed for in-process callers (e.g. the MCP server). */
export { COMMAND_MODULES };
