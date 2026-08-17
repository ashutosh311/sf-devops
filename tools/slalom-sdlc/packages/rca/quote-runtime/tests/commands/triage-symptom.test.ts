import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildTriageSymptomEnvelope,
  parseTriageSymptomFlags,
  renderTriageSymptomHelp,
  renderTriageSymptomText,
  runTriageSymptomCommand
} from '../../src/commands/triage-symptom';
import { routeSymptom } from '../../src/primitives/symptom-routing';

const fixturesDir = resolve(import.meta.dirname, '../fixtures/scenarios/triage-symptom');
const routeFixtures = JSON.parse(readFileSync(resolve(fixturesDir, 'routes.json'), 'utf8')) as Array<{
  name: string;
  quoteId: string;
  lineIds: string[];
  symptom: string;
  expected: {
    symptom_class: string;
    primary_lane: string;
    recommended_branch: string;
    required_overlays: string[];
    recommended_next_commands: string[];
  };
}>;

describe('triage-symptom command', () => {
  it('renders the locked help text', () => {
    expect(renderTriageSymptomHelp()).toContain(
      'quote-runtime triage-symptom --org-alias <alias> --quote-id <id> --symptom <text> [--line-id <id> ...]'
    );
    expect(renderTriageSymptomHelp()).toContain('unsupported symptoms fail fast instead of falling back to another route.');
    expect(renderTriageSymptomHelp()).toContain('wrong price on this quote line');
  });

  it('requires both quote-id and symptom selectors', async () => {
    await expect(parseTriageSymptomFlags(['--symptom', 'wrong price on line'])).rejects.toThrow(
      'Missing required flag quote-id'
    );
    await expect(parseTriageSymptomFlags(['--quote-id', '0Q0xx0000000001AAA'])).rejects.toThrow(
      'Missing required flag symptom'
    );
  });

  it('routes wrong-price, missing-price, structure, lifecycle, and context-bridge symptoms with shared route logic', () => {
    for (const fixture of routeFixtures) {
      const route = routeSymptom(fixture.symptom);
      expect(route).toEqual(fixture.expected);

      const envelope = buildTriageSymptomEnvelope({
        globalFlags: {
          help: false,
          json: false,
          orgAlias: 'ARM',
          failOn: undefined,
          output: undefined,
          verbose: false
        },
        commandFlags: {
          quoteId: fixture.quoteId,
          symptom: fixture.symptom,
          lineIds: fixture.lineIds
        },
        generatedAt: '2026-04-15T12:00:00.000Z',
        durationMs: 12
      });

      expect(envelope).toMatchObject({
        command: 'triage-symptom',
        status: 'ok',
        summary: {
          primary_subject: fixture.quoteId,
          primary_lane: fixture.expected.primary_lane,
          verification_anchor: `quote:${fixture.quoteId}`,
          symptom_class: fixture.expected.symptom_class,
          next_suggested_command: fixture.expected.recommended_next_commands[0]
        },
        result: fixture.expected,
        meta: {
          org_alias: 'ARM',
          duration_ms: 12
        }
      });

      expect(renderTriageSymptomText(envelope)).toContain(`symptom class: ${fixture.expected.symptom_class}`);
      expect(renderTriageSymptomText(envelope)).toContain(
        `recommended next commands: ${fixture.expected.recommended_next_commands.join(', ')}`
      );
    }
  });

  it('runs through the command entrypoint and emits the routed envelope', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const execution = await runTriageSymptomCommand(
      ['--quote-id', '0Q0xx0000000001AAA', '--symptom', 'wrong price on this quote line', '--line-id', '0QLxx0000000001AAA'],
      {
        help: false,
        json: true,
        orgAlias: 'ARM',
        failOn: 'error',
        output: undefined,
        verbose: false
      },
      {
        stdout: { write: (message: string) => void stdout.push(message) },
        stderr: { write: (message: string) => void stderr.push(message) }
      }
    );

    expect(execution.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      command: 'triage-symptom',
      status: 'ok',
      result: {
        symptom_class: 'wrong-price',
        recommended_next_commands: ['explain-price']
      }
    });
  });

  it('fails fast for unsupported symptoms instead of emitting a wrong-price route', () => {
    expect(() =>
      buildTriageSymptomEnvelope({
        globalFlags: {
          help: false,
          json: false,
          orgAlias: 'ARM',
          failOn: undefined,
          output: undefined,
          verbose: false
        },
        commandFlags: {
          quoteId: '0Q0xx0000000099AAA',
          symptom: 'please investigate this mystery behavior',
          lineIds: []
        },
        generatedAt: '2026-04-15T12:00:00.000Z',
        durationMs: 7
      })
    ).toThrow(
      "Unsupported symptom text for triage-symptom routing: 'please investigate this mystery behavior'. Supported symptom classes: wrong-price, missing-price, structure, lifecycle, context-bridge."
    );
  });
});
