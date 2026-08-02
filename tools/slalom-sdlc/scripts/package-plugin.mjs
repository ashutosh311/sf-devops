#!/usr/bin/env node
/**
 * Assembles the Claude Code plugin — the installable form of the MCP server.
 *
 * The plugin is delivered to users by git clone, not by asset download: the
 * marketplace entry in the repo-root `.claude-plugin/marketplace.json` points at
 * the `plugin-dist` branch, and the release workflow publishes what this script
 * produces to that branch. See .github/workflows/release.yml → "Publish plugin".
 *
 * Prerequisites:
 *   pnpm -r build            (packages/mcp/dist/server.js must exist)
 *   zip                      (standard on macOS/Linux; available in GitHub Actions)
 *
 * Usage:
 *   node scripts/package-plugin.mjs [--version <semver>]
 *
 * Outputs (relative to workspace root):
 *   dist/plugin/                          — the plugin root, ready to publish
 *     .claude-plugin/plugin.json          — version stamped
 *     commands/*.md                       — /slalom-sdlc:<command> slash commands
 *     server/server.js                    — bundled MCP server
 *   dist/release/slalom-sdlc-plugin.zip   — same tree, for manual/air-gapped install
 */

import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(__dirname, "..");

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const versionIdx = args.indexOf("--version");
const version = versionIdx !== -1 ? args[versionIdx + 1] : `0.0.0-dev`;

if (!version) {
  console.error("--version argument is missing a value");
  process.exit(1);
}

// ── Locate inputs ─────────────────────────────────────────────────────────────

const pluginSrc = join(WORKSPACE_ROOT, "plugin");
const serverJs  = join(WORKSPACE_ROOT, "packages", "mcp", "dist", "server.js");

if (!existsSync(pluginSrc)) {
  console.error(`Plugin source not found: ${pluginSrc}`);
  process.exit(1);
}
if (!existsSync(serverJs)) {
  console.error(`MCP server not built. Run: pnpm -r build\nExpected: ${serverJs}`);
  process.exit(1);
}

// ── Assemble ──────────────────────────────────────────────────────────────────

const outDir     = join(WORKSPACE_ROOT, "dist", "plugin");
const releaseDir = join(WORKSPACE_ROOT, "dist", "release");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(releaseDir, { recursive: true });

// Plugin manifest, commands, README — everything checked into plugin/
cpSync(pluginSrc, outDir, { recursive: true });
console.log(`  ✓ plugin/ → dist/plugin/`);

// The bundled server. Deliberately no server.js.map: the sourcemap would put the
// original TypeScript — including every prompt template — into a directory that
// lands on the user's machine in plain text, which is exactly what compiling the
// templates into the bundle is meant to prevent.
mkdirSync(join(outDir, "server"), { recursive: true });
cpSync(serverJs, join(outDir, "server", "server.js"));
const serverKb = Math.round(statSync(serverJs).size / 1024);
console.log(`  ✓ packages/mcp/dist/server.js → dist/plugin/server/server.js (${serverKb} KB)`);

// ── Stamp the version ─────────────────────────────────────────────────────────

const manifestPath = join(outDir, ".claude-plugin", "plugin.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
manifest.version = version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
console.log(`  ✓ .claude-plugin/plugin.json → ${version}`);

// ── Zip (manual / air-gapped install path) ────────────────────────────────────

const zipPath = join(releaseDir, "slalom-sdlc-plugin.zip");
if (existsSync(zipPath)) rmSync(zipPath);
execSync(`cd "${outDir}" && zip -qr "${zipPath}" .`, { stdio: "inherit" });
console.log(`  ✓ dist/release/slalom-sdlc-plugin.zip`);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nPlugin ${version} assembled in dist/plugin/`);
console.log(`  Try it locally:  claude plugin marketplace add ${resolve(WORKSPACE_ROOT, "../..")}`);
console.log(`  Publish:         handled by .github/workflows/release.yml on a vX.Y.Z tag`);
