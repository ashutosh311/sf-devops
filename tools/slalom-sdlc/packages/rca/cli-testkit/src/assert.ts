/**
 * Shared assertion helper for test scripts.
 * Zero test-framework dependency — works from compiled node scripts (sfx
 * hand-rolled asserters) and from vitest tests alike.
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
