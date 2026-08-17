import { describe, expect, it } from 'vitest';

import { runQuoteRuntimeCli } from '../src/bin/quote-runtime';

describe('quote-runtime workspace package entrypoint', () => {
  it('re-exports the canonical CLI runner through the package-owned path', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runQuoteRuntimeCli(['--help'], {
      stdout: { write: (message: string) => void stdout.push(message) },
      stderr: { write: (message: string) => void stderr.push(message) }
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join('')).toContain('inspect-pricing-waterfall');
    expect(stdout.join('')).toContain('capture-post-pst-evidence');
    expect(stdout.join('')).toContain('classify-pricing-outcome');
    expect(stdout.join('')).toContain('deploy-product-catalog-index');
  });
});
