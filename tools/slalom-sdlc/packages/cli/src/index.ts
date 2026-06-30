import { Command } from "commander";
import { promises as fs } from "fs";
import path from "path";
import { SdlcConfigSchema, scaffoldRepo, renderAllPrompts, TOOL_VERSION, type SdlcConfig, type ScaffoldResult } from "@sdlc/core";
import { promptOutputDir, runInterview, collectStatusMapOnly } from "./interview.js";

const program = new Command();

program
  .name("slalom-sdlc")
  .description("Scaffold an AI-assisted SDLC for your Salesforce project")
  .version(TOOL_VERSION)
  .addHelpCommand(false);

// ── init / reconfigure (default — auto-detects which mode) ───────────────────

const initCommand = new Command("init")
  .description("Scaffold a repo — automatically reconfigures if config already exists (default)")
  .option("-o, --output <dir>", "Target repo path — skips the path prompt")
  .action(async (opts: { output?: string }) => {
    console.log("\nWelcome to Slalom SDLC. This will scaffold your AI-assisted SDLC.\n");

    const outputDir = await promptOutputDir(opts.output);
    const existing  = await loadExistingConfig(outputDir);

    let config: SdlcConfig;

    if (existing) {
      console.log(
        `\n  ℹ  Existing config found at ${outputDir}/.sdlc/config.json\n` +
        "     Switching to reconfigure mode — existing answers are pre-filled.\n"
      );
      const result = await runInterview(existing);
      config = result.config;
    } else {
      const result = await runInterview();
      config = result.config;
    }

    console.log("\n── Scaffolding repo ────────────────────────────────────────");
    const scaffoldResult = await scaffoldRepo(config, outputDir);
    printSummary(config, outputDir, scaffoldResult, !!existing);
  });

// ── regenerate ────────────────────────────────────────────────────────────────

const regenerateCommand = new Command("regenerate")
  .description("Regenerate all prompt files from existing config — no interview")
  .option("-o, --output <dir>", "Target repo path", process.cwd())
  .action(async (opts: { output: string }) => {
    const outputDir = path.resolve(opts.output);
    const existing  = await loadExistingConfig(outputDir);

    if (!existing) {
      console.error(`\n⚠  No .sdlc/config.json found in ${outputDir}. Run \`slalom-sdlc\` first.\n`);
      process.exit(1);
    }

    console.log("\nRegenerating prompts from existing config...");
    const rendered   = renderAllPrompts(existing);
    const promptsDir = path.join(outputDir, ".sdlc", "prompts");
    await fs.mkdir(promptsDir, { recursive: true });

    for (const [phase, content] of Object.entries(rendered)) {
      await fs.writeFile(path.join(promptsDir, `${phase}.prompt.md`), content, "utf-8");
    }

    console.log(`\n✓ Regenerated ${Object.keys(rendered).length} prompt(s) into ${promptsDir}\n`);
  });

// ── reconfigure --jira-only ──────────────────────────────────────────────────

const reconfigureCommand = new Command("reconfigure")
  .description("Re-map JIRA statuses only and regenerate prompts")
  .requiredOption("-o, --output <dir>", "Target repo path")
  .action(async (opts: { output: string }) => {
    const outputDir = path.resolve(opts.output);
    const existing  = await loadExistingConfig(outputDir);

    if (!existing) {
      console.error(`\n⚠  No .sdlc/config.json found in ${outputDir}. Run \`slalom-sdlc\` first.\n`);
      process.exit(1);
    }

    console.log("\n── JIRA Workflow ──────────────────────────────────────────────");
    const statusMap = await collectStatusMapOnly(existing);
    const updated   = { ...existing, jira: { statusMap }, generatedAt: new Date().toISOString() };

    const scaffoldResult = await scaffoldRepo(updated, outputDir);
    printSummary(updated, outputDir, scaffoldResult, true);
  });

program
  .addCommand(initCommand, { isDefault: true })
  .addCommand(regenerateCommand)
  .addCommand(reconfigureCommand);

program.parse();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadExistingConfig(outputDir: string): Promise<SdlcConfig | undefined> {
  const configPath = path.join(outputDir, ".sdlc", "config.json");
  try {
    const raw    = await fs.readFile(configPath, "utf-8");
    const parsed = SdlcConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function printSummary(
  config: SdlcConfig,
  outputDir: string,
  result: ScaffoldResult,
  wasReconfigure: boolean
) {
  const mode = wasReconfigure ? "Reconfigure" : "Scaffold";

  const fmt = (label: string, items: string[]) =>
    items.length ? `\n  ${label}\n${items.map((f) => `    + ${f}`).join("\n")}` : "";

  console.log(`
✓ ${mode} complete

  Project:  ${config.project.name} (${config.project.jiraKey})
  Phases:   ${config.phases.join(", ")}
  Sandbox:  ${config.salesforce.orgs.sandbox}
  Sprint:   ${config.team.sprintLengthWeeks}w sprints
  Output:   ${outputDir}
${fmt("Created:", result.created)}${fmt("Updated:", result.updated)}${fmt("Preserved (not overwritten):", result.preserved)}

Next steps:
  1. Add your trigger framework classes to ${config.paths.forceApp}/frameworks/trigger-framework/classes/
  2. Customise the standards files in ${config.paths.standards}/
  3. Open VS Code or Cursor and start with #sdlc/discover
`);
}
