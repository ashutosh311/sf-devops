#!/usr/bin/env node
/**
 * Generates the repository-level GitHub Copilot custom agents from the canonical
 * templates in tools/otto/copilot/agents/.
 *
 * Copilot CLI and the Copilot desktop app discover custom agents from
 * `.github/agents/*.agent.md` at the repo root. These are the Copilot equivalent
 * of the Claude Code plugin's `plugin/commands/*.md`. To avoid drift, both come
 * from one source: the templates under `copilot/agents/`, which carry a
 * `${OTTO_SERVER}` placeholder for the MCP server path.
 *
 * This script substitutes that placeholder with the repo-relative path to the
 * built MCP server and writes the result to `<repo-root>/.github/agents/`.
 *
 * Usage:
 *   node scripts/generate-copilot-agents.mjs           # write .github/agents/
 *   node scripts/generate-copilot-agents.mjs --check    # verify only (CI); non-zero on drift
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(__dirname, "..");            // tools/otto
const REPO_ROOT = resolve(WORKSPACE_ROOT, "../..");         // repo root

const TEMPLATE_DIR = join(WORKSPACE_ROOT, "copilot", "agents");
const OUTPUT_DIR = join(REPO_ROOT, ".github", "agents");

// The MCP server path baked into the repo-level agents, relative to the repo root
// so it resolves the same way for anyone who clones this repo and runs `copilot`.
const REPO_SERVER_PATH = "tools/otto/packages/mcp/dist/server.js";

const GENERATED_BANNER =
  "<!-- GENERATED FILE — do not edit. Source: tools/otto/copilot/agents/. " +
  "Regenerate: node tools/otto/scripts/generate-copilot-agents.mjs -->\n";

const checkOnly = process.argv.includes("--check");

if (!existsSync(TEMPLATE_DIR)) {
  console.error(`Template directory not found: ${TEMPLATE_DIR}`);
  process.exit(1);
}

const templates = readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith(".agent.md"));

if (templates.length === 0) {
  console.error(`No *.agent.md templates found in ${TEMPLATE_DIR}`);
  process.exit(1);
}

function render(templateContent) {
  const body = templateContent.replaceAll("${OTTO_SERVER}", REPO_SERVER_PATH);
  // Insert the generated banner immediately after the closing frontmatter fence so
  // the YAML frontmatter stays first in the file (required by Copilot).
  const parts = body.split(/^---\s*$/m);
  if (parts.length >= 3) {
    // parts[0] = "" (before first ---), parts[1] = frontmatter, rest = body
    const frontmatter = parts[1];
    const rest = parts.slice(2).join("---");
    return `---${frontmatter}---\n${GENERATED_BANNER}${rest.replace(/^\n/, "")}`;
  }
  return GENERATED_BANNER + body;
}

let drift = false;
const written = [];
const expected = new Set(templates.map((name) => name));

if (!checkOnly) mkdirSync(OUTPUT_DIR, { recursive: true });

for (const name of templates.sort()) {
  const src = readFileSync(join(TEMPLATE_DIR, name), "utf-8");
  const rendered = render(src);
  const outPath = join(OUTPUT_DIR, name);

  if (checkOnly) {
    const current = existsSync(outPath) ? readFileSync(outPath, "utf-8") : null;
    if (current !== rendered) {
      drift = true;
      console.error(`✗ out of date: .github/agents/${name}`);
    }
  } else {
    writeFileSync(outPath, rendered, "utf-8");
    written.push(name);
    console.log(`  ✓ .github/agents/${name}`);
  }
}

// Detect (and, when writing, remove) stale agent files that no longer have a
// corresponding template, so Copilot doesn't keep discovering removed agents.
const stale = existsSync(OUTPUT_DIR)
  ? readdirSync(OUTPUT_DIR).filter((f) => f.endsWith(".agent.md") && !expected.has(f))
  : [];

for (const name of stale) {
  if (checkOnly) {
    drift = true;
    console.error(`✗ stale (no template): .github/agents/${name}`);
  } else {
    rmSync(join(OUTPUT_DIR, name));
    console.log(`  ✗ removed stale .github/agents/${name}`);
  }
}

if (checkOnly) {
  if (drift) {
    console.error(
      "\n.github/agents/ is out of sync with copilot/agents/ templates.\n" +
        "Run: node tools/otto/scripts/generate-copilot-agents.mjs"
    );
    process.exit(1);
  }
  console.log(`✓ .github/agents/ is in sync (${templates.length} agents)`);
} else {
  console.log(`\nGenerated ${written.length} Copilot agent(s) in .github/agents/`);
}
