import { describe, expect, it } from 'vitest';

import type { EnvelopeSummary } from '../../src/contracts/envelope-summary';
import { makeEnvelope } from '../../src/contracts/result-envelope';

// ---------------------------------------------------------------------------
// Compile-time type assertions: if the type is wrong these lines fail tsc.
// ---------------------------------------------------------------------------

// Minimal valid summary — only required keys.
const _minimal: EnvelopeSummary = {
  primary_subject: 'quote:abc123',
  primary_lane: 'persisted_snapshot',
  status_reason: 'Quote snapshot captured.',
  next_suggested_command: null
};

// Summary with all optional standard keys.
const _full: EnvelopeSummary = {
  primary_subject: 'quote:abc123',
  primary_lane: 'quote_pricing',
  status_reason: 'All pricing validated.',
  next_suggested_command: 'capture-post-pst-evidence',
  verification_anchor: 'quote:abc123',
  symptom_class: 'ok_pricing',
  key_counts: { requested_lines: 5, ok_packets: 5 }
};

// Extra command-specific key (e.g. line_ids from overlay-actions).
const _withExtra: EnvelopeSummary = {
  primary_subject: 'quote:abc123',
  primary_lane: 'lifecycle_provenance',
  status_reason: 'Overlay applied.',
  next_suggested_command: null,
  verification_anchor: 'quote:abc123',
  line_ids: ['line1', 'line2']
};

// verification_anchor may be null (some commands set it conditionally).
const _nullAnchor: EnvelopeSummary = {
  primary_subject: 'pst-apply-quote-intent',
  primary_lane: 'configured_quote_mutation',
  status_reason: 'Submitted quote intent through PST graph mutation.',
  next_suggested_command: 'snapshot-quote',
  verification_anchor: null
};

// Suppress "declared but never read" — these are compile-time probes.
void _minimal;
void _full;
void _withExtra;
void _nullAnchor;

// ---------------------------------------------------------------------------
// Runtime assertions: makeEnvelope round-trips representative summaries
// without mutating or dropping any key.
// ---------------------------------------------------------------------------

describe('EnvelopeSummary contracts', () => {
  it('makeEnvelope preserves a minimal summary unchanged', () => {
    const summary: EnvelopeSummary = {
      primary_subject: 'doctor-preflight',
      primary_lane: 'preflight',
      status_reason: 'Doctor verified prerequisites.',
      next_suggested_command: null
    };

    const envelope = makeEnvelope({
      command: 'doctor',
      status: 'ok',
      summary,
      result: { checks: [], missing_requirements: [] },
      meta: {
        org_alias: 'ARM',
        generated_at: '2026-04-14T00:00:00Z',
        duration_ms: 0
      }
    });

    expect(envelope.summary).toEqual(summary);
  });

  it('makeEnvelope preserves a rich summary with optional keys unchanged', () => {
    const summary: EnvelopeSummary = {
      primary_subject: 'quote:abc123',
      primary_lane: 'persisted_snapshot',
      status_reason: 'Quote snapshot captured.',
      next_suggested_command: null,
      verification_anchor: 'quote:abc123',
      key_counts: { returned_lines: 3, requested_lines: 3 }
    };

    const envelope = makeEnvelope({
      command: 'snapshot-quote',
      status: 'ok',
      summary,
      result: {},
      meta: {
        org_alias: 'ARM',
        generated_at: '2026-04-14T00:00:00Z',
        duration_ms: 42
      }
    });

    expect(envelope.summary).toEqual(summary);
  });

  it('makeEnvelope preserves a symptom-routing summary with symptom_class unchanged', () => {
    const summary: EnvelopeSummary = {
      primary_subject: 'quote:abc123',
      primary_lane: 'quote_pricing',
      status_reason: 'Routed to wrong-price triage.',
      next_suggested_command: 'explain-price',
      verification_anchor: 'quote:abc123',
      symptom_class: 'wrong-price',
      key_counts: { line_ids: 2, required_overlays: 1, recommended_next_commands: 1 }
    };

    const envelope = makeEnvelope({
      command: 'triage-symptom',
      status: 'ok',
      summary,
      result: {},
      meta: {
        org_alias: 'ARM',
        generated_at: '2026-04-14T00:00:00Z',
        duration_ms: 10
      }
    });

    expect(envelope.summary).toEqual(summary);
  });

  it('makeEnvelope preserves extra command-specific summary keys unchanged', () => {
    const summary: EnvelopeSummary = {
      primary_subject: 'quote:abc123',
      primary_lane: 'lifecycle_provenance',
      status_reason: 'Overlay applied.',
      next_suggested_command: null,
      verification_anchor: 'quote:abc123',
      line_ids: ['line1', 'line2']
    };

    const envelope = makeEnvelope({
      command: 'overlay-actions',
      status: 'ok',
      summary,
      result: {},
      meta: {
        org_alias: 'ARM',
        generated_at: '2026-04-14T00:00:00Z',
        duration_ms: 5
      }
    });

    expect(envelope.summary).toEqual(summary);
  });

  it('makeEnvelope output is byte-identical to the pre-typed summary shape', () => {
    // Confirm that tightening the type did not change serialisation behaviour.
    // The zod runtime schema (jsonRecordSchema) passes any JSON object, so the
    // output JSON must be identical regardless of whether the TypeScript type
    // was Record<string,JsonValue> or EnvelopeSummary.
    const summary: EnvelopeSummary = {
      primary_subject: 'quote:abc123',
      primary_lane: 'quote_runtime_mutation',
      status_reason: 'Price quote PST graph submitted.',
      next_suggested_command: 'capture-post-pst-evidence',
      verification_anchor: 'quote:abc123'
    };

    const envelope = makeEnvelope({
      command: 'price-quote',
      status: 'ok',
      summary,
      result: {},
      meta: {
        org_alias: 'ARM',
        generated_at: '2026-04-14T00:00:00Z',
        duration_ms: 100
      }
    });

    const serialised = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
    expect(serialised['summary']).toStrictEqual(summary);
  });
});
