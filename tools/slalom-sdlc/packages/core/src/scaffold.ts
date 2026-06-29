import { promises as fs } from "fs";
import path from "path";
import type { SdlcConfig } from "./schema.js";
import { fetchStandards } from "./standards.js";

export interface ScaffoldResult {
  created: string[];
  updated: string[];
  preserved: string[];
}

export async function scaffoldRepo(
  config: SdlcConfig,
  outputDir: string,
  bitbucketToken: string
): Promise<ScaffoldResult> {
  const result: ScaffoldResult = { created: [], updated: [], preserved: [] };

  await writeConfig(config, outputDir, result);
  await writeArtifactDirs(config, outputDir, result);
  await writeStandardsStubs(config, outputDir, result, bitbucketToken);
  await writeTriggerFrameworkPlaceholder(config, outputDir, result);
  await writeMcpConfig(config, outputDir, result);
  await writeClaudeCodeMcpConfig(config, outputDir, result);

  return result;
}

async function writeConfig(config: SdlcConfig, root: string, result: ScaffoldResult): Promise<void> {
  const dir = path.join(root, ".sdlc");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "config.json");
  const existed = await fileExists(file);
  await fs.writeFile(file, JSON.stringify(config, null, 2), "utf-8");
  (existed ? result.updated : result.created).push(".sdlc/config.json");
}

async function writeArtifactDirs(config: SdlcConfig, root: string, result: ScaffoldResult): Promise<void> {
  const dirs = [
    path.join(root, config.paths.artifacts, "discovery"),
    ...(config.phases.includes("release")
      ? [path.join(root, config.paths.artifacts, "releases")]
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

async function writeStandardsStubs(config: SdlcConfig, root: string, result: ScaffoldResult, token: string): Promise<void> {
  const dir = path.join(root, config.paths.standards);
  await fs.mkdir(dir, { recursive: true });

  const files = await fetchStandards(token);

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

async function writeTriggerFrameworkPlaceholder(config: SdlcConfig, root: string, result: ScaffoldResult): Promise<void> {
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

async function writeMcpConfig(config: SdlcConfig, root: string, result: ScaffoldResult): Promise<void> {
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
      atlassian: {
        type: "http",
        url: "https://mcp.atlassian.com/v1/mcp",
      },
    },
  };

  await fs.writeFile(file, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");
  result.created.push(".vscode/mcp.json");
}

async function writeClaudeCodeMcpConfig(config: SdlcConfig, root: string, result: ScaffoldResult): Promise<void> {
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
      atlassian: {
        type: "http",
        url: "https://mcp.atlassian.com/v1/mcp",
      },
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

