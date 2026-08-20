import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../../../../../');
const packageDir = resolve(repoRoot, 'tools/salesforce/quote-runtime-cli');
const embeddedRuntimeEntrypoint = resolve(packageDir, 'dist/runtime/quote_runtime_cli.js');
const repoBuiltRuntimeDir = resolve(repoRoot, '.agents/skills/quoting-pricing-runtime/dist');

function runNpm(args: string[], cwd: string): string {
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) {
    throw new Error('npm_execpath is required for installed-package smoke tests.');
  }
  return execFileSync('node', [npmExecPath, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe'
  });
}

describe.skip('installed quote-runtime package smoke', () => {
  it(
    'packs, installs, and runs the quote-runtime binary outside the repo tree',
    () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'quote-runtime-install-smoke-'));
      let tarballPath: string | null = null;

      try {
        rmSync(resolve(packageDir, 'dist/runtime'), { force: true, recursive: true });
        rmSync(repoBuiltRuntimeDir, { force: true, recursive: true });

        runNpm(['run', 'build'], packageDir);

        expect(existsSync(embeddedRuntimeEntrypoint)).toBe(true);
        expect(existsSync(repoBuiltRuntimeDir)).toBe(true);

        const tarballName = runNpm(['pack'], packageDir)
          .trim()
          .split(/\r?\n/u)
          .at(-1);

        expect(tarballName).toBeTruthy();
        tarballPath = resolve(packageDir, tarballName as string);
        expect(existsSync(tarballPath)).toBe(true);

        const tarballContents = execFileSync('tar', ['-tf', tarballPath], {
          encoding: 'utf8'
        });
        expect(tarballContents).toContain('package/dist/runtime/quote_runtime_cli.js');

        runNpm(['init', '-y'], tempDir);
        runNpm(['install', tarballPath], tempDir);

        const rootHelp = execFileSync(resolve(tempDir, 'node_modules/.bin/quote-runtime'), ['--help'], {
          cwd: tempDir,
          encoding: 'utf8'
        });
        const doctorHelp = execFileSync(resolve(tempDir, 'node_modules/.bin/quote-runtime'), ['doctor', '--help'], {
          cwd: tempDir,
          encoding: 'utf8'
        });

        expect(rootHelp).toContain('quote-runtime');
        expect(rootHelp).toContain('doctor');
        expect(doctorHelp).toContain('operating mode');
        expect(doctorHelp).not.toContain('.agents/skills');
      } finally {
        if (tarballPath && existsSync(tarballPath)) {
          unlinkSync(tarballPath);
        }
        rmSync(tempDir, { force: true, recursive: true });
      }
    },
    120000
  );
});
