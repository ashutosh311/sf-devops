#!/usr/bin/env node
/**
 * Assembles the GitHub Copilot pack — the user-level installable form of the SDLC
 * commands for GitHub Copilot CLI and the Copilot desktop app.
 *
 * Copilot discovers custom commands as "custom agents" in `~/.copilot/agents/`
 * (user level) or `.github/agents/` (repo level). This pack mirrors how the VSIX
 * and the Claude plugin are one-time user installs: a bundled MCP server, the
 * agent profiles, and an installer that copies the agents into `~/.copilot/agents/`
 * and registers the server in `~/.copilot/mcp-config.json`. Once installed the
 * agents work across every project the consultant opens, with no per-project setup.
 *
 * Single source of truth: the canonical templates in `copilot/agents/*.agent.md`
 * (the same ones the repo's `.github/agents/` are generated from). Here the
 * `${SLALOM_SDLC_SERVER}` placeholder is rewritten to `__SLALOM_SDLC_SERVER__`, a
 * token the installer resolves to the absolute path of the installed server.
 *
 * Prerequisites:
 *   packages/mcp/dist/server.js must exist (build the mcp package first)
 *   zip (standard on macOS/Linux; available in GitHub Actions)
 *
 * Usage:
 *   node scripts/package-copilot.mjs [--version <semver>]
 *
 * Outputs (relative to workspace root):
 *   dist/copilot/                          — the pack root, ready to publish
 *     server/server.js                     — bundled MCP server
 *     agents/*.agent.md                    — Copilot custom agents (installer-resolved path)
 *     install.sh                           — user-level installer
 *     README.md                            — install instructions
 *   dist/release/slalom-sdlc-copilot.zip   — same tree, for download / air-gapped install
 */

import { execSync } from "node:child_process";
import {
  cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync, readdirSync,
} from "node:fs";
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

// The token the installer replaces with the absolute path of the installed server.
const SERVER_TOKEN = "__SLALOM_SDLC_SERVER__";

// ── Locate inputs ─────────────────────────────────────────────────────────────

const templateDir = join(WORKSPACE_ROOT, "copilot", "agents");
const serverJs    = join(WORKSPACE_ROOT, "packages", "mcp", "dist", "server.js");

if (!existsSync(templateDir)) {
  console.error(`Agent templates not found: ${templateDir}`);
  process.exit(1);
}
if (!existsSync(serverJs)) {
  console.error(`MCP server not built.\nExpected: ${serverJs}`);
  process.exit(1);
}

const templates = readdirSync(templateDir).filter((f) => f.endsWith(".agent.md")).sort();
if (templates.length === 0) {
  console.error(`No *.agent.md templates found in ${templateDir}`);
  process.exit(1);
}

// ── Assemble ──────────────────────────────────────────────────────────────────

const outDir     = join(WORKSPACE_ROOT, "dist", "copilot");
const releaseDir = join(WORKSPACE_ROOT, "dist", "release");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "agents"), { recursive: true });
mkdirSync(join(outDir, "server"), { recursive: true });
mkdirSync(releaseDir, { recursive: true });

// Agents — templates with the server placeholder rewritten to the installer token.
for (const name of templates) {
  const src = readFileSync(join(templateDir, name), "utf-8");
  const rendered = src.replaceAll("${SLALOM_SDLC_SERVER}", SERVER_TOKEN);
  writeFileSync(join(outDir, "agents", name), rendered, "utf-8");
}
console.log(`  ✓ copilot/agents/ → dist/copilot/agents/ (${templates.length} agents)`);

// The bundled server. Deliberately no server.js.map — the sourcemap would put the
// original TypeScript, including every prompt template, into plain text on the
// user's machine, defeating the point of compiling the templates into the bundle.
cpSync(serverJs, join(outDir, "server", "server.js"));
const serverKb = Math.round(statSync(serverJs).size / 1024);
console.log(`  ✓ packages/mcp/dist/server.js → dist/copilot/server/server.js (${serverKb} KB)`);

// Installer + README, checked in under copilot/pack/.
const packDir = join(WORKSPACE_ROOT, "copilot", "pack");
for (const file of ["install.sh", "README.md"]) {
  const srcFile = join(packDir, file);
  if (!existsSync(srcFile)) {
    console.error(`Pack file missing: ${srcFile}`);
    process.exit(1);
  }
  cpSync(srcFile, join(outDir, file));
}
console.log(`  ✓ copilot/pack/{install.sh,README.md} → dist/copilot/`);

// Stamp the version into a VERSION file the installer can echo.
writeFileSync(join(outDir, "VERSION"), `${version}\n`, "utf-8");
console.log(`  ✓ VERSION → ${version}`);

// ── Zip (download / air-gapped install path) ──────────────────────────────────

const zipPath = join(releaseDir, "slalom-sdlc-copilot.zip");
if (existsSync(zipPath)) rmSync(zipPath);
execSync(`cd "${outDir}" && zip -qr "${zipPath}" .`, { stdio: "inherit" });
console.log(`  ✓ dist/release/slalom-sdlc-copilot.zip`);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nCopilot pack ${version} assembled in dist/copilot/`);
console.log(`  Try it locally:  (cd dist/copilot && ./install.sh)`);
console.log(`  Publish:         handled by .github/workflows/release.yml on a vX.Y.Z tag`);
