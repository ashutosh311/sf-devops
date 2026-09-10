import { promises as fs } from "fs";
import path from "path";
import type { OttoConfig } from "./schema.js";
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
  const lines = current.split("\n");
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
  await fs.writeFile(file, JSON.stringify(config, null, 2), "utf-8");
  const label = path.basename(dir) === LEGACY_CONFIG_DIR ? ".sdlc/config.json" : ".otto/config.json";
  (existed ? result.updated : result.created).push(label);
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
    const args = ["-y", "@azure-devops/mcp", orgName, "-d", "core", "work", "work-items", "--authentication", "interactive"];
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

