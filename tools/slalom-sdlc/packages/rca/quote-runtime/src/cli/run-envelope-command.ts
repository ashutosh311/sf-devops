/**
 * Shared scaffold for all quote-runtime subcommands.
 *
 * Every command follows the same execution spine:
 *   org-alias guard → flag parse + primitive execute + envelope build →
 *   renderText → exitCodeForStatus → emit json/text → return {envelope, text, exitCode}
 *
 * Each command supplies a CommandSpec that fills in the variable pieces.  The
 * harness owns the invariant plumbing so commands can focus on their unique
 * flag/primitive/envelope/render logic.
 */

import type { GlobalFlags } from './global-flags';
import { emitJsonOutput, emitTextOutput, type CliIo } from './output';
import { exitCodeForStatus, type ResultEnvelope } from '../contracts/result-envelope';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Context passed to the spec's execute function.  `startedAt` is the
 * timestamp captured before the org-alias guard so that duration_ms is
 * stable regardless of where the guard fires.
 */
export type EnvelopeExecuteContext<TDeps> = {
  argv: string[];
  globalFlags: GlobalFlags;
  /** `Date.now()` captured at the start of the run, before the org-alias guard. */
  startedAt: number;
  deps: TDeps;
};

/**
 * Spec that a command file supplies to `runEnvelopeCommand`.
 *
 * TDeps defaults to `object` so commands with no injectable dependencies can
 * omit the type parameter and pass `{}` as the deps argument.
 *
 * Variation points
 * ─────────────────
 * - `requiresOrgAlias` (default true): set to false for `doctor`, which
 *   treats --org-alias as optional.
 * - `execute`: owns flag parsing, primitive execution, envelope construction
 *   (and any command-specific side effects such as pst-apply-quote-intent's
 *   write-artifact step).  Receives `startedAt` so commands can compute
 *   `duration_ms` without re-capturing the clock.
 * - `renderText`: pure text renderer called by the harness.
 */
export type EnvelopeCommandSpec<TDeps = object> = {
  /** Subcommand name used only in the org-alias error message. */
  commandName: string;
  /**
   * Whether --org-alias must be present.
   * Default: true.  Only `doctor` sets this to false.
   */
  requiresOrgAlias?: boolean;
  /**
   * Parse argv, execute the primitive, build and return the ResultEnvelope.
   * Command-specific side effects (e.g. writeApplyArtifact) belong here,
   * executed after envelope construction but before returning.
   */
  execute: (ctx: EnvelopeExecuteContext<TDeps>) => Promise<ResultEnvelope>;
  /** Convert the envelope to a human-readable text string. */
  renderText: (envelope: ResultEnvelope) => string;
};

/** Shared return shape — structurally identical to every per-command *Execution type. */
export type EnvelopeExecution = {
  envelope: ResultEnvelope;
  text: string;
  exitCode: 0 | 1;
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * Execute a subcommand via its spec.
 *
 * 1. Captures `startedAt`.
 * 2. Guards on --org-alias when `spec.requiresOrgAlias !== false`.
 * 3. Delegates to `spec.execute` for flag-parse + primitive + envelope.
 * 4. Renders text, computes exit code, emits json or text output.
 * 5. Returns `{ envelope, text, exitCode }`.
 */
export async function runEnvelopeCommand<TDeps>(
  spec: EnvelopeCommandSpec<TDeps>,
  argv: string[],
  globalFlags: GlobalFlags,
  io: CliIo,
  deps: TDeps
): Promise<EnvelopeExecution> {
  const startedAt = Date.now();

  if ((spec.requiresOrgAlias ?? true) && !globalFlags.orgAlias) {
    throw new Error(`The ${spec.commandName} command requires --org-alias <alias>.`);
  }

  const envelope = await spec.execute({ argv, globalFlags, startedAt, deps });
  const text = spec.renderText(envelope);
  const exitCode = exitCodeForStatus(envelope.status, globalFlags.failOn ?? 'error');

  if (globalFlags.json) {
    emitJsonOutput(envelope, globalFlags, io);
  } else {
    emitTextOutput(text, globalFlags, io);
  }

  return { envelope, text, exitCode };
}
