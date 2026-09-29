import { promises as fs } from "fs";
import path from "path";
import { OttoConfigSchema, DesignDeliverableSchema, resolveAlmTool, resolveDeliverable, type DesignDeliverable, type OttoConfig } from "./schema.js";
import { getStandards } from "./standards.js";
import { resolveConfigDir, OTTO_CONFIG_DIR, LEGACY_CONFIG_DIR } from "./projectDir.js";

export interface ScaffoldResult {
  created: string[];
  updated: string[];
  preserved: string[];
}

export async function scaffoldRepo(
  config: OttoConfig,
  outputDir: string
): Promise<ScaffoldResult> {
  const result: ScaffoldResult = { created: [], updated: [], preserved: [] };

  await writeConfig(config, outputDir, result);
  await writeArtifactDirs(config, outputDir, result);
  await writeStandards(config, outputDir, result);
  await writeTriggerFrameworkPlaceholder(config, outputDir, result);
  await writeMcpConfig(config, outputDir, result);
  await writeClaudeCodeMcpConfig(config, outputDir, result);
  await writeGitignore(outputDir, result);

  return result;
}

/**
 * Agent-mode deferred flows (ALM-mode refine/design/build/data-dictionary/
 * push-backlog/sync-pm) write the fully-rendered phase prompt to
 * `<configDir>/prompts/*.md` so Copilot Agent mode can read it. Unlike
 * `config.json`, that directory is never meant to be committed — it holds
 * Slalom's proprietary SDLC prompt content, re-generated on every run. Ensure
 * it's gitignored (idempotently, so re-running `/init` on an already-scaffolded
 * project — still on `.sdlc` — picks this up too).
 */
async function writeGitignore(root: string, result: ScaffoldResult): Promise<void> {
  const file = path.join(root, ".gitignore");
  const entries = [OTTO_CONFIG_DIR, LEGACY_CONFIG_DIR].map((dir) => `${dir}/prompts/`);

  const existed = await fileExists(file);
  const current = existed ? await fs.readFile(file, "utf-8") : "";
  // \r?\n so a CRLF checkout (common on Windows) doesn't leave a trailing \r on
  // each line — otherwise the includes() check below never matches an
  // already-written entry, and /init keeps appending duplicate ignore blocks.
  const lines = current.split(/\r?\n/);
  const missing = entries.filter((entry) => !lines.includes(entry));
  if (missing.length === 0) {
    if (existed) result.preserved.push(".gitignore");
    return;
  }

  const separator = current && !current.endsWith("\n") ? "\n\n" : current ? "\n" : "";
  const block = `# Otto — generated agent-mode prompts (proprietary, never commit)\n${missing.join("\n")}\n`;
  await fs.writeFile(file, current + separator + block, "utf-8");
  (existed ? result.updated : result.created).push(".gitignore");
}

async function writeConfig(config: OttoConfig, root: string, result: ScaffoldResult): Promise<void> {
  const dir = resolveConfigDir(root);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "config.json");
  const existed = await fileExists(file);
  const toWrite = existed ? carryForwardConfigOnlyFields(config, await readJson(file)) : config;
  await fs.writeFile(file, JSON.stringify(toWrite, null, 2), "utf-8");
  const label = path.basename(dir) === LEGACY_CONFIG_DIR ? ".sdlc/config.json" : ".otto/config.json";
  (existed ? result.updated : result.created).push(label);
}

/**
 * Settings with no `/init` question — added to config.json by hand or by a skill on
 * first use (`salesforce.orgs.production`, `qualityGate`, `testing`, and the
 * `design.deliverable` extras below). A reconfigure rebuilds the config from the interview answers, so without
 * this they are silently dropped. Done here, at the one place every front end
 * (VS Code, MCP, CLI) writes the config, rather than in each front end. A value
 * already present in `next` wins; a carried value that no longer validates is dropped.
 */
export function carryForwardConfigOnlyFields(next: OttoConfig, previous: unknown): OttoConfig {
  if (!previous || typeof previous !== "object") return next;
  const prev = previous as Partial<OttoConfig>;
  const shape = OttoConfigSchema.shape;
  const out: OttoConfig = { ...next };

  const testing = shape.testing.safeParse(prev.testing);
  if (out.testing === undefined && testing.success && testing.data) out.testing = testing.data;

  const qualityGate = shape.qualityGate.safeParse(prev.qualityGate);
  if (out.qualityGate === undefined && qualityGate.success && qualityGate.data) out.qualityGate = qualityGate.data;

  const production = shape.salesforce.shape.orgs.shape.production.safeParse(prev.salesforce?.orgs?.production);
  if (!out.salesforce.orgs.production && production.success && production.data) {
    out.salesforce = { ...out.salesforce, orgs: { ...out.salesforce.orgs, production: production.data } };
  }

  const extras = designDeliverableExtras(out, prev);
  if (Object.keys(extras).length > 0) {
    out.design = { ...out.design, deliverable: { ...extras, ...out.design?.deliverable } };
  }
  return out;
}

/**
 * The `design.deliverable` fields the interview never asks for (it owns only
 * `target`, `spaceKey` and `wikiIdentifier`). Each is kept only while it still
 * means the same thing in the new config:
 * - `sections`, `granularity` — tool-agnostic, always kept.
 * - `storyField` — a JIRA field key or an ADO field reference name, so kept only
 *   when the PM tool is unchanged.
 * - `parentPageId` — a Confluence page, kept only while the effective target stays
 *   `confluence` in the same space.
 * - `wikiPath` — an ADO wiki path, kept only while the effective target stays
 *   `wiki` on the same wiki.
 */
function designDeliverableExtras(next: OttoConfig, prev: Partial<OttoConfig>): DesignDeliverable {
  const parsed = DesignDeliverableSchema.safeParse(prev.design?.deliverable);
  if (!parsed.success || !parsed.data) return {};
  const old = parsed.data;

  const prevTool = resolveAlmTool(prev as OttoConfig);
  const nextTool = resolveAlmTool(next);
  const before = resolveDeliverable({ ...prev, design: { deliverable: old } } as OttoConfig, prevTool);
  const after = resolveDeliverable(next, nextTool);

  const extras: DesignDeliverable = {};
  if (old.sections) extras.sections = old.sections;
  if (old.granularity) extras.granularity = old.granularity;
  if (old.storyField && prevTool === nextTool) extras.storyField = old.storyField;
  if (old.parentPageId && before.target === "confluence" && after.target === "confluence" && before.spaceKey === after.spaceKey) {
    extras.parentPageId = old.parentPageId;
  }
  if (old.wikiPath && before.target === "wiki" && after.target === "wiki" && before.wikiIdentifier === after.wikiIdentifier) {
    extras.wikiPath = old.wikiPath;
  }
  return extras;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return undefined;
  }
}

async function writeArtifactDirs(config: OttoConfig, root: string, result: ScaffoldResult): Promise<void> {
  const artifactsBase = path.join(root, config.paths.artifacts);

  const dirs = [
    artifactsBase,
    path.join(artifactsBase, "00 - Project"),
    path.join(artifactsBase, "00 - Inbox"),
    path.join(artifactsBase, "00 - Registers"),
    path.join(artifactsBase, "01 - Sessions"),
    path.join(artifactsBase, "02 - Current State"),
    path.join(artifactsBase, "03 - Future State"),
    path.join(artifactsBase, "04 - Backlog"),
    path.join(artifactsBase, "04 - Backlog", "pushed"),
    path.join(artifactsBase, "06 - Reference"),
    ...(config.phases.includes("release")
      ? [path.join(artifactsBase, "releases")]
      : []),
  ];

  for (const dir of dirs) {
    const existed = await fileExists(dir);
    await fs.mkdir(dir, { recursive: true });
    const gitkeep = path.join(dir, ".gitkeep");
    if (!await fileExists(gitkeep)) {
      await fs.writeFile(gitkeep, "", "utf-8");
    }
    if (!existed) {
      const rel = path.relative(root, dir);
      result.created.push(`${rel}/`);
    }
  }
}

async function writeStandards(config: OttoConfig, root: string, result: ScaffoldResult): Promise<void> {
  const dir = path.join(root, config.paths.standards);
  await fs.mkdir(dir, { recursive: true });

  const files = getStandards({ revenueCloud: config.revenueCloud?.enabled === true });

  for (const [filename, content] of Object.entries(files)) {
    const filepath = path.join(dir, filename);
    if (await fileExists(filepath)) {
      result.preserved.push(`${config.paths.standards}/${filename}`);
    } else {
      await fs.writeFile(filepath, content, "utf-8");
      result.created.push(`${config.paths.standards}/${filename}`);
    }
  }
}

async function writeTriggerFrameworkPlaceholder(config: OttoConfig, root: string, result: ScaffoldResult): Promise<void> {
  const dir = path.join(root, config.paths.forceApp, "frameworks", "trigger-framework", "classes");
  await fs.mkdir(dir, { recursive: true });

  const readme = path.join(dir, "README.md");
  if (await fileExists(readme)) {
    result.preserved.push(`${config.paths.forceApp}/frameworks/trigger-framework/classes/`);
  } else {
    await fs.writeFile(
      readme,
      `# Trigger Framework\n\nPlace \`TriggerHandler.cls\`, \`TriggerDispatcher.cls\`, and \`TriggerConfigurationSelector.cls\` in this directory.\n`,
      "utf-8"
    );
    result.created.push(`${config.paths.forceApp}/frameworks/trigger-framework/classes/`);
  }
}

/** Builds the PM-tool MCP server entry for .vscode/mcp.json (format="vscode") or .mcp.json (format="claude"). */
function buildPmMcpEntry(config: OttoConfig, format: "vscode" | "claude"): Record<string, unknown> {
  if (config.alm?.tool === "ADO") {
    // Extract the org name from the full URL, e.g. "https://dev.azure.com/MyOrg" → "MyOrg"
    const orgName = config.alm.organization.replace(/^https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "");
    // "repositories" is included alongside the work-item domains so a project can pull
    // discovery documents recursively from an Azure Repos folder (see the discover
    // agent's pull-ado-artifacts skill) — no separate server or auth is needed for it.
    // "wiki" is included so the agent can read/create/update Azure DevOps wiki pages
    // (a distinct ADO subsystem from both work items and Azure Repos) ad hoc, without
    // needing a bespoke skill — the MCP tools alone are enough once this is on.
    const args = ["-y", "@azure-devops/mcp", orgName, "-d", "core", "work", "work-items", "repositories", "wiki", "--authentication", "interactive"];
    return format === "vscode"
      ? { ado: { type: "stdio", command: "npx", args } }
      : { ado: { command: "npx", args } };
  }
  return format === "vscode"
    ? { atlassian: { type: "http", url: "https://mcp.atlassian.com/v1/mcp" } }
    : { atlassian: { type: "http", url: "https://mcp.atlassian.com/v1/mcp" } };
}

async function writeMcpConfig(config: OttoConfig, root: string, result: ScaffoldResult): Promise<void> {
  const dir = path.join(root, ".vscode");
  await fs.mkdir(dir, { recursive: true });

  const file = path.join(dir, "mcp.json");
  if (await fileExists(file)) {
    result.preserved.push(".vscode/mcp.json");
    return;
  }

  const mcpConfig = {
    servers: {
      Salesforce_DX: {
        type: "stdio",
        command: "npx",
        args: [
          "-y",
          "@salesforce/mcp",
          "--orgs",
          "DEFAULT_TARGET_ORG",
          "--toolsets",
          "orgs,metadata,data,users",
          "--tools",
          "run_apex_test",
          "--allow-non-ga-tools",
        ],
      },
      ...(buildPmMcpEntry(config, "vscode")),
    },
  };

  await fs.writeFile(file, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");
  result.created.push(".vscode/mcp.json");
}

async function writeClaudeCodeMcpConfig(config: OttoConfig, root: string, result: ScaffoldResult): Promise<void> {
  const file = path.join(root, ".mcp.json");
  if (await fileExists(file)) {
    result.preserved.push(".mcp.json");
    return;
  }

  const mcpConfig = {
    mcpServers: {
      Salesforce_DX: {
        command: "npx",
        args: [
          "-y",
          "@salesforce/mcp",
          "--orgs",
          "DEFAULT_TARGET_ORG",
          "--toolsets",
          "orgs,metadata,data,users",
          "--tools",
          "run_apex_test",
          "--allow-non-ga-tools",
        ],
      },
      ...(buildPmMcpEntry(config, "claude")),
    },
  };

  await fs.writeFile(file, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");
  result.created.push(".mcp.json");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

