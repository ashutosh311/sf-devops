#!/usr/bin/env node
/**
 * Builds release assets for the Slalom SDLC instruction bundle.
 *
 * Prerequisites:
 *   pnpm -r build            (core package must be built first)
 *   zip                      (standard on macOS/Linux; available in GitHub Actions)
 *
 * Usage:
 *   node scripts/package-instructions.mjs [--version <semver>]
 *
 * Outputs (relative to workspace root):
 *   dist/release/instructions.zip   — zip containing 9 instruction files + manifest.json
 *   dist/release/manifest.json      — standalone copy of the manifest
 *   dist/release/*.vsix             — copied from packages/vscode/ if present
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(WORKSPACE_ROOT, "../..");

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const versionIdx = args.indexOf("--version");
const version = versionIdx !== -1 ? args[versionIdx + 1] : `dev-${new Date().toISOString().slice(0, 10)}`;

if (!version) {
  console.error("--version argument is missing a value");
  process.exit(1);
}

// ── Load phase templates from built core ─────────────────────────────────────

const coreDist = join(WORKSPACE_ROOT, "packages", "core", "dist", "index.js");
if (!existsSync(coreDist)) {
  console.error(`Core package not built. Run: pnpm -r build\nExpected: ${coreDist}`);
  process.exit(1);
}

const core = await import(coreDist);
const PHASE_TEMPLATES = core.PHASE_TEMPLATES;

if (!PHASE_TEMPLATES || typeof PHASE_TEMPLATES !== "object") {
  console.error("PHASE_TEMPLATES not exported from core. Ensure packages/core/src/engine.ts exports it.");
  process.exit(1);
}

// ── Locate instruction markdown files ────────────────────────────────────────

const INSTRUCTION_FILES = {
  "deployment": join(REPO_ROOT, "devops", "instructions", "deployment.md"),
  "org-impact-assessment": join(REPO_ROOT, "devops", "instructions", "org-impact-assessment.md"),
  "prerequisite-check": join(REPO_ROOT, "devops", "instructions", "prerequisite-check.md"),
};

for (const [name, filePath] of Object.entries(INSTRUCTION_FILES)) {
  if (!existsSync(filePath)) {
    console.error(`Instruction file not found: ${filePath} (expected for "${name}")`);
    process.exit(1);
  }
}

// ── Prepare staging directory ─────────────────────────────────────────────────

const stagingDir = join(WORKSPACE_ROOT, "dist", "release", "_staging");
const outputDir  = join(WORKSPACE_ROOT, "dist", "release");

if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
mkdirSync(outputDir,  { recursive: true });

// ── Write files to staging and build manifest ─────────────────────────────────

const manifestFiles = {};

function writeAndChecksum(filename, content) {
  const buf = Buffer.from(content, "utf-8");
  writeFileSync(join(stagingDir, filename), buf);
  const checksum = "sha256:" + createHash("sha256").update(buf).digest("hex");
  manifestFiles[filename] = { checksum, size: buf.length };
}

// Phase templates
for (const [phase, templateStr] of Object.entries(PHASE_TEMPLATES)) {
  writeAndChecksum(`${phase}.md`, templateStr);
  console.log(`  ✓ ${phase}.md`);
}

// Instruction includes
for (const [name, filePath] of Object.entries(INSTRUCTION_FILES)) {
  const content = readFileSync(filePath, "utf-8");
  writeAndChecksum(`${name}.md`, content);
  console.log(`  ✓ ${name}.md`);
}

// Manifest
const manifest = {
  schemaVersion: "1",
  version,
  publishedAt: new Date().toISOString(),
  files: manifestFiles,
};

const manifestJson = JSON.stringify(manifest, null, 2);
writeFileSync(join(stagingDir, "manifest.json"), manifestJson, "utf-8");
console.log(`  ✓ manifest.json`);

// ── Zip ───────────────────────────────────────────────────────────────────────

const zipPath = join(outputDir, "instructions.zip");
if (existsSync(zipPath)) rmSync(zipPath);

execSync(`zip -j "${zipPath}" "${stagingDir}"/*`, { stdio: "inherit" });

// Write standalone manifest copy next to the zip
writeFileSync(join(outputDir, "manifest.json"), manifestJson, "utf-8");

// ── Copy VSIX if present ──────────────────────────────────────────────────────

const vsixDir = join(WORKSPACE_ROOT, "packages", "vscode");
const vsixFiles = existsSync(vsixDir)
  ? readdirSync(vsixDir).filter((f) => f.endsWith(".vsix"))
  : [];

for (const vsix of vsixFiles) {
  copyFileSync(join(vsixDir, vsix), join(outputDir, vsix));
  console.log(`  ✓ ${vsix} (copied)`);
}

// ── Cleanup staging ────────────────────────────────────────────────────────────

rmSync(stagingDir, { recursive: true, force: true });

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nRelease assets ready in dist/release/`);
console.log(`  instructions.zip — ${Object.keys(manifestFiles).length} instruction files + manifest`);
console.log(`  manifest.json    — version ${version}`);
if (vsixFiles.length) console.log(`  ${vsixFiles.join(", ")} — VSIX extension`);
console.log(`\nUpload these files as assets to a GitHub Release on Slalom/salesforce-devops.`);
