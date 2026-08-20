import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseGlobalFlags, splitRootArgv } from '../../src/cli/global-flags';
import { renderRootHelp } from '../../src/cli/root-help';
import { runQuoteRuntimeCli } from '../../src/bin/quote-runtime';

const fixturePath = resolve(import.meta.dirname, '../fixtures/root-help/expected-root-help.txt');
const expectedRootHelp = readFileSync(fixturePath, 'utf8');

describe('root help conformance', () => {
  it('matches the locked root help fixture exactly', () => {
    expect(renderRootHelp()).toBe(expectedRootHelp);
  });

  it('shows only implemented commands and the exact quick-start examples', () => {
    const help = renderRootHelp();

    expect(help).toContain('Preflight and command fit:');
    expect(help).toContain('Persisted snapshots and overlays:');
    expect(help).toContain('Context and planning:');
    expect(help).toContain('  doctor');
    expect(help).toContain('  snapshot-quote');
    expect(help).toContain('  snapshot-lines');
    expect(help).toContain('  overlay-actions');
    expect(help).toContain('  overlay-relationships');
    expect(help).toContain('  inspect-pricing-waterfall');
    expect(help).toContain('  capture-post-pst-evidence');
    expect(help).toContain('  classify-pricing-outcome');
    expect(help).toContain('  create-quote');
    expect(help).toContain('  upsert-quote-lines');
    expect(help).toContain('  price-quote');
    expect(help).toContain('  build-test-quote');
    expect(help).toContain('  inspect-usage-rate-model');
    expect(help).toContain('  deploy-product-catalog-index');
    expect(help).toContain('  refresh-decision-tables');
    expect(help).toContain('  inspect-quote-ready-product');
    expect(help).toContain('  pst-apply-quote-intent');
    expect(help).toContain('  inspect-rlm-context');
    expect(help.indexOf('  inspect-pricing-waterfall')).toBeLessThan(help.indexOf('  capture-post-pst-evidence'));
    expect(help.indexOf('  capture-post-pst-evidence')).toBeLessThan(help.indexOf('  classify-pricing-outcome'));
    expect(help.indexOf('  classify-pricing-outcome')).toBeLessThan(help.indexOf('  inspect-rlm-context'));
    expect(help).toContain('  pst-plan');
    expect(help).toContain('  compare-quote-pricing');
    expect(help).toContain('  triage-symptom');
    expect(help).toContain('  explain-price');
    expect(help).toContain('  explain-missing-price');
    expect(help).toContain('  verify-lifecycle-provenance');
    expect(help).toContain('  test-pricing-change');
    expect(help).toContain('  create-lifecycle-scenario');
    expect(help).toContain('  quote-runtime doctor --org-alias <alias> --for-command doctor');
    expect(help).toContain('  quote-runtime doctor --org-alias <alias> --for-command snapshot-quote --quote-id <id>');
    expect(help).toContain('  quote-runtime snapshot-quote --org-alias <alias> --quote-id <id>');
    expect(help).toContain('  quote-runtime snapshot-lines --org-alias <alias> --quote-id <id> --line-id <id>');
    expect(help).toContain('  quote-runtime overlay-actions --org-alias <alias> --quote-id <id>');
    expect(help).toContain('  quote-runtime overlay-relationships --org-alias <alias> --quote-id <id> --line-id <id>');
    expect(help).toContain('  quote-runtime inspect-pricing-waterfall --org-alias <alias> --quote-id <id> --line-id <id>');
    expect(help).toContain('  quote-runtime capture-post-pst-evidence --org-alias <alias> --quote-id <id> --line-id <id> --line-id <id>');
    expect(help).toContain('  quote-runtime classify-pricing-outcome --org-alias <alias> --quote-id <id> --line-id <id> --expected-change <text>');
    expect(help).toContain('  quote-runtime create-quote --org-alias <alias> --name <name> --quote-account-id <id> --opportunity-id <id> --pricebook-id <id>');
    expect(help).toContain('  quote-runtime upsert-quote-lines --org-alias <alias> --quote-id <id> --pricebook-entry-id <id> --product-id <id> --quantity <number>');
    expect(help).toContain('  quote-runtime price-quote --org-alias <alias> --quote-id <id> --line-id <id> --line-field Quantity=2');
    expect(help).toContain('  quote-runtime build-test-quote --org-alias <alias> --input quote-intent.json');
    expect(help).toContain('  quote-runtime inspect-usage-rate-model --org-alias <alias> --include-samples');
    expect(help).toContain('  quote-runtime inspect-pricing-product-sync --org-alias <alias>');
    expect(help).toContain('  quote-runtime deploy-product-catalog-index --org-alias <alias>');
    expect(help).toContain('  quote-runtime refresh-decision-tables --org-alias <alias> --decision-table-api-name <name>');
    expect(help).toContain('  quote-runtime inspect-quote-ready-product --org-alias <alias> --pricebook-id <id> --term "DR suite"');
    expect(help).toContain('  quote-runtime pst-apply-quote-intent --org-alias <alias> --input quote-intent.json');
    expect(help).toContain('  quote-runtime inspect-rlm-context --org-alias <alias> --quote-id <id> --line-id <id>');
    expect(help.indexOf('  quote-runtime inspect-pricing-waterfall --org-alias <alias> --quote-id <id> --line-id <id>')).toBeLessThan(
      help.indexOf('  quote-runtime capture-post-pst-evidence --org-alias <alias> --quote-id <id> --line-id <id> --line-id <id>')
    );
    expect(help.indexOf('  quote-runtime capture-post-pst-evidence --org-alias <alias> --quote-id <id> --line-id <id> --line-id <id>')).toBeLessThan(
      help.indexOf('  quote-runtime classify-pricing-outcome --org-alias <alias> --quote-id <id> --line-id <id> --expected-change <text>')
    );
    expect(help.indexOf('  quote-runtime classify-pricing-outcome --org-alias <alias> --quote-id <id> --line-id <id> --expected-change <text>')).toBeLessThan(
      help.indexOf('  quote-runtime create-quote --org-alias <alias> --name <name> --quote-account-id <id> --opportunity-id <id> --pricebook-id <id>')
    );
    expect(help.indexOf('  quote-runtime build-test-quote --org-alias <alias> --input quote-intent.json')).toBeLessThan(
      help.indexOf('  quote-runtime inspect-usage-rate-model --org-alias <alias> --include-samples')
    );
    expect(help.indexOf('  quote-runtime inspect-usage-rate-model --org-alias <alias> --include-samples')).toBeLessThan(
      help.indexOf('  quote-runtime inspect-pricing-product-sync --org-alias <alias>')
    );
    expect(help.indexOf('  quote-runtime inspect-pricing-product-sync --org-alias <alias>')).toBeLessThan(
      help.indexOf('  quote-runtime deploy-product-catalog-index --org-alias <alias>')
    );
    expect(help.indexOf('  quote-runtime deploy-product-catalog-index --org-alias <alias>')).toBeLessThan(
      help.indexOf('  quote-runtime refresh-decision-tables --org-alias <alias> --decision-table-api-name <name>')
    );
    expect(help.indexOf('  quote-runtime refresh-decision-tables --org-alias <alias> --decision-table-api-name <name>')).toBeLessThan(
      help.indexOf('  quote-runtime inspect-quote-ready-product --org-alias <alias> --pricebook-id <id> --term "DR suite"')
    );
    expect(help.indexOf('  quote-runtime inspect-quote-ready-product --org-alias <alias> --pricebook-id <id> --term "DR suite"')).toBeLessThan(
      help.indexOf('  quote-runtime pst-apply-quote-intent --org-alias <alias> --input quote-intent.json')
    );
    expect(help.indexOf('  quote-runtime pst-apply-quote-intent --org-alias <alias> --input quote-intent.json')).toBeLessThan(
      help.indexOf('  quote-runtime inspect-rlm-context --org-alias <alias> --quote-id <id> --line-id <id>')
    );
    expect(help).toContain('  quote-runtime pst-plan --org-alias <alias> --operation-family initiate_amendment --quote-id <id>');
    expect(help).toContain('  quote-runtime compare-quote-pricing --org-alias <alias> --before-quote-id <id> --after-quote-id <id>');
    expect(help).toContain('  quote-runtime triage-symptom --org-alias <alias> --quote-id <id> --symptom "wrong price" --line-id <id>');
    expect(help).toContain('  quote-runtime explain-price --org-alias <alias> --quote-id <id> --line-id <id> --expected-change "line should use the discounted renewal price"');
    expect(help).toContain('  quote-runtime explain-missing-price --org-alias <alias> --quote-id <id> --line-id <id>');
    expect(help).toContain('  quote-runtime verify-lifecycle-provenance --org-alias <alias> --quote-id <id> --line-id <id> --asset-id <id>');
    expect(help).toContain('  quote-runtime create-lifecycle-scenario --org-alias <alias> --operation-family initiate_amendment --quote-id <id> --asset-id <id>');

    expect(help).not.toContain('.agents');
    expect(help).not.toContain('python');
  });

  it('pre-parses global flags before or after the subcommand without losing wave-4 grammar', async () => {
    expect(splitRootArgv(['--json', '--org-alias', 'ARM', 'doctor', '--verbose'])).toEqual({
      globalArgv: ['--json', '--org-alias', 'ARM', '--verbose'],
      commandName: 'doctor',
      commandArgv: []
    });

    expect(splitRootArgv(['doctor', '--json', '--org-alias', 'ARM', '--verbose'])).toEqual({
      globalArgv: ['--json', '--org-alias', 'ARM', '--verbose'],
      commandName: 'doctor',
      commandArgv: []
    });

    await expect(parseGlobalFlags(['--json', '--org-alias', 'ARM', '--fail-on', 'warn', '--verbose'])).resolves.toEqual({
      help: false,
      json: true,
      orgAlias: 'ARM',
      failOn: 'warn',
      output: undefined,
      verbose: true
    });
  });

  it('rejects unknown or malformed global-flag usage as parse errors', async () => {
    expect(() => splitRootArgv(['--bogus'])).toThrow(/Unknown global flag/i);
    expect(() => splitRootArgv(['--org-alias'])).toThrow(/Missing value for global flag/i);

    const missingCommandWrites: string[] = [];
    const missingCommandErrors: string[] = [];
    const missingCommandExitCode = await runQuoteRuntimeCli(['--org-alias', 'doctor'], {
      stdout: { write: (message: string) => void missingCommandWrites.push(message) },
      stderr: { write: (message: string) => void missingCommandErrors.push(message) }
    });

    expect(missingCommandExitCode).toBe(2);
    expect(missingCommandWrites).toEqual([]);
    expect(missingCommandErrors.join('')).toMatch(/A command is required/i);

    const writes: string[] = [];
    const errors: string[] = [];
    const exitCode = await runQuoteRuntimeCli(['doctor', '--bogus'], {
      stdout: { write: (message: string) => void writes.push(message) },
      stderr: { write: (message: string) => void errors.push(message) }
    });

    expect(exitCode).toBe(2);
    expect(writes).toEqual([]);
    expect(errors.join('')).toMatch(/Nonexistent flag: --bogus/i);
  });

  it('routes root help through the CLI entrypoint', async () => {
    const writes: string[] = [];
    const errors: string[] = [];

    const exitCode = await runQuoteRuntimeCli(['--help'], {
      stdout: { write: (message: string) => void writes.push(message) },
      stderr: { write: (message: string) => void errors.push(message) }
    });

    expect(exitCode).toBe(0);
    expect(writes.join('')).toBe(expectedRootHelp);
    expect(errors).toEqual([]);
  });
});
