import type { JsonValue } from './result-envelope';

/**
 * Agent-facing summary attached to every quote-runtime result envelope.
 *
 * Design rules (surveyed across all 38 commands):
 *   - Keys present in ALL 38 commands are required.
 *   - Keys present in a subset are optional:
 *       verification_anchor : 24 / 38 commands
 *       symptom_class       :  4 / 38 commands (symptom-routing lane)
 *       key_counts          : ~18 / 38 commands (shape varies per command)
 *   - Command-specific extras remain allowed via the index signature.
 *     Values must be JsonValue-compatible so envelope serialisation
 *     stays byte-identical.
 *
 * The zod runtime schema (jsonRecordSchema inside result-envelope.ts) is
 * intentionally NOT changed — this is a type-level-only constraint.
 */
export type EnvelopeSummary = {
  /** Entity the command acted on: quote id, order id, product id, or a label */
  primary_subject: string;
  /** Processing lane (e.g. 'quote_pricing', 'plan_only', 'persisted_snapshot') */
  primary_lane: string;
  /** Human-readable explanation of the status outcome */
  status_reason: string;
  /** Command the agent should invoke next; null when there is no suggestion */
  next_suggested_command: string | null;
  /** Stable reference string for auditing; present in 24/38 commands */
  verification_anchor?: string | null;
  /** Route class chosen by symptom-routing commands; present in 4/38 commands */
  symptom_class?: string;
  /** Command-specific count summary; shape varies; present in ~18/38 commands */
  key_counts?: Record<string, JsonValue>;
  /** Extra command-specific keys (e.g. line_ids in overlay-actions) */
  [key: string]: JsonValue | undefined;
};
