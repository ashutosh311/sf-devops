/**
 * spec-names guard (plan 022 Q3/Q4)
 *
 * Q3 added: spec names ≡ ALL_COMMAND_NAMES, wave/group consistency, summary/quickStart/run.
 * Q4 removed: ownership and selectorPolicy drift guards — those maps are now DERIVED from
 * the specs themselves (plan 022 Q4), making the comparisons structurally impossible to drift.
 * The map contents are verified via selector-functions.test.ts instead.
 */

import { describe, expect, it } from 'vitest';

import { ALL_COMMAND_NAMES } from '../../src/contracts/command-names';
import { ALL_COMMAND_SPECS } from '../../src/commands/all-commands';
import { EXECUTABLE_COMMANDS } from '../../src/registry/command-registry';

describe('spec-names guard (plan 022 Q3)', () => {
  it('spec names set ≡ ALL_COMMAND_NAMES (both directions)', () => {
    const specNames = ALL_COMMAND_SPECS.map((s) => s.name);

    // Every spec name appears in ALL_COMMAND_NAMES
    for (const name of specNames) {
      expect(ALL_COMMAND_NAMES).toContain(name);
    }

    // Every ALL_COMMAND_NAMES name appears in specs
    for (const name of ALL_COMMAND_NAMES) {
      expect(specNames).toContain(name);
    }

    // Counts match (no duplicates or omissions)
    expect(specNames.length).toBe(ALL_COMMAND_NAMES.length);
  });

  it('all spec names are also in EXECUTABLE_COMMANDS (all specs are executable)', () => {
    const specNames = ALL_COMMAND_SPECS.map((s) => s.name);
    for (const name of specNames) {
      expect(EXECUTABLE_COMMANDS).toContain(name);
    }
    expect(specNames.length).toBe(EXECUTABLE_COMMANDS.length);
  });

  it('spec wave assignments are 1, 2, or 3 and group_names are consistent', () => {
    const WAVE_GROUP_NAMES = {
      1: 'Preflight and command fit',
      2: 'Persisted snapshots and overlays',
      3: 'Context and planning'
    } as const;

    for (const spec of ALL_COMMAND_SPECS) {
      expect([1, 2, 3]).toContain(spec.wave);
      expect(spec.group_name).toBe(WAVE_GROUP_NAMES[spec.wave]);
    }
  });

  it('each spec has a non-empty summary, quickStart, renderHelp, and run', () => {
    for (const spec of ALL_COMMAND_SPECS) {
      expect(spec.summary.length).toBeGreaterThan(0);
      const quickStarts = typeof spec.quickStart === 'string' ? [spec.quickStart] : [...spec.quickStart];
      expect(quickStarts.length).toBeGreaterThan(0);
      for (const qs of quickStarts) {
        expect(qs).toContain('quote-runtime');
        expect(qs).toContain(spec.name);
      }
      expect(typeof spec.renderHelp).toBe('function');
      expect(typeof spec.run).toBe('function');
    }
  });

  it('every spec carries ownership and selectorPolicy (Q4: maps derived from specs, not static)', () => {
    for (const spec of ALL_COMMAND_SPECS) {
      // ownership
      expect(typeof spec.ownership.primary_owner).toBe('string');
      expect(Array.isArray(spec.ownership.secondary_escalation)).toBe(true);
      expect(Array.isArray(spec.ownership.shared_library_dependencies)).toBe(true);

      // selectorPolicy
      expect(Array.isArray(spec.selectorPolicy.required_selectors)).toBe(true);
      expect(Array.isArray(spec.selectorPolicy.recommended_selectors)).toBe(true);
      expect(typeof spec.selectorPolicy.status_reason).toBe('string');
    }
  });
});
