import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { runPricingCommand } from "@otto/rca-pricing-procedure";
import { runSfxCommand } from "@otto/rca-sfx";
import { runQuoteRuntimeCommand } from "@otto/rca-quote-runtime";
import { runContextDefCommand } from "@otto/rca-context-definition";
import { validateArmMatrix } from "@otto/rca-arm-matrix";
import { readFileSync } from "node:fs";

/**
 * Revenue Cloud Advanced (RCA) MCP tools.
 *
 * These wrap the vendored pricing-procedure runtime (packages/rca/*) and call
 * its logic **in-process** — no shelling out, no external CLI install. They are
 * registered on the same MCP server that GitHub Copilot (via .mcp.json) and
 * Claude Code (via the plugin) both use, so RCA tooling reaches both surfaces
 * identically and cross-platform (including Windows).
 *
 * The tools are read-only investigators over local pricing-procedure metadata
 * files (`*.expressionSetDefinition-meta.xml`). Agents route to them from the
 * `pricing-procedures` skill when `revenueCloud.enabled` is set.
 */

const jsonResult = (envelope: unknown, exitCode: number) => ({
  content: [{ type: "text" as const, text: JSON.stringify(envelope, null, 2) }],
  ...(exitCode === 2 ? { isError: true } : {}),
});

const textResult = (text: string, exitCode: number) => ({
  content: [{ type: "text" as const, text: text.length > 0 ? text : "(no output)" }],
  ...(exitCode !== 0 ? { isError: true } : {}),
});

const INSPECT_SCHEMA = {
  file: z.string().min(1).describe("Path to one pricing-procedure ExpressionSetDefinition file (*.expressionSetDefinition-meta.xml)"),
  version: z.string().optional().describe("Version selector: 'active', an exact fullName, or 'rank:N'. Defaults to all matched versions."),
  activeOnly: z.boolean().optional().describe("Shortcut for version=active when no explicit version selector is supplied"),
  stepName: z.string().optional().describe("Exact step name selector"),
  sequence: z.string().optional().describe("Exact sequenceNumber selector"),
  actionType: z.string().optional().describe("Exact actionType selector"),
  parentStep: z.string().optional().describe("Exact parentStep selector"),
  listCandidates: z.boolean().optional().describe("List compact candidate step selectors instead of requiring an exact selector match"),
  stepNameContains: z.string().optional().describe("Substring filter for candidate discovery (only with listCandidates)"),
  verbose: z.boolean().optional().describe("Include full parameter payloads for matched steps"),
};

const DIFF_SCHEMA = {
  file: z.string().optional().describe("One file containing both versions to compare (single-file diff mode)"),
  left: z.string().optional().describe("Left-side pricing procedure file (two-file diff mode)"),
  right: z.string().optional().describe("Right-side pricing procedure file (two-file diff mode)"),
  versionLeft: z.string().optional().describe("Left version selector for single-file diff mode ('active', fullName, or 'rank:N')"),
  versionRight: z.string().optional().describe("Right version selector for single-file diff mode"),
  tag: z.string().optional().describe("Optional context tag for a compact tag-centered flow-drift summary"),
  includeChangeBuckets: z.boolean().optional().describe("Include raw semantic change buckets in the result"),
  includeRaw: z.boolean().optional().describe("Include full normalized left/right version payloads"),
  verbose: z.boolean().optional().describe("Include expanded evidence payloads"),
};

type InspectArgs = {
  file: string;
  version?: string;
  activeOnly?: boolean;
  stepName?: string;
  sequence?: string;
  actionType?: string;
  parentStep?: string;
  listCandidates?: boolean;
  stepNameContains?: string;
  verbose?: boolean;
};

type DiffArgs = {
  file?: string;
  left?: string;
  right?: string;
  versionLeft?: string;
  versionRight?: string;
  tag?: string;
  includeChangeBuckets?: boolean;
  includeRaw?: boolean;
  verbose?: boolean;
};

function pushFlag(argv: string[], flag: string, value?: string): void {
  if (value !== undefined && value !== "") {
    argv.push(flag, value);
  }
}

function inspectArgv(a: InspectArgs): string[] {
  const argv = ["--file", a.file, "--json"];
  pushFlag(argv, "--version", a.version);
  if (a.activeOnly) argv.push("--active-only");
  pushFlag(argv, "--step-name", a.stepName);
  pushFlag(argv, "--sequence", a.sequence);
  pushFlag(argv, "--action-type", a.actionType);
  pushFlag(argv, "--parent-step", a.parentStep);
  if (a.listCandidates) argv.push("--list-candidates");
  pushFlag(argv, "--step-name-contains", a.stepNameContains);
  if (a.verbose) argv.push("--verbose");
  return argv;
}

function diffArgv(a: DiffArgs): string[] {
  const argv = ["--json"];
  pushFlag(argv, "--file", a.file);
  pushFlag(argv, "--left", a.left);
  pushFlag(argv, "--right", a.right);
  pushFlag(argv, "--version-left", a.versionLeft);
  pushFlag(argv, "--version-right", a.versionRight);
  pushFlag(argv, "--tag", a.tag);
  if (a.includeChangeBuckets) argv.push("--include-change-buckets");
  if (a.includeRaw) argv.push("--include-raw");
  if (a.verbose) argv.push("--verbose");
  return argv;
}

export function registerRcaTools(server: McpServer): void {
  server.tool(
    "rca_pricing_inspect",
    "Revenue Cloud (RCA): inspect a pricing procedure (ExpressionSetDefinition) file — list candidate steps or return one exact step's details. Read-only; returns the canonical JSON result envelope.",
    INSPECT_SCHEMA,
    async (args: InspectArgs) => {
      const { envelope, exitCode } = runPricingCommand("inspect-step", inspectArgv(args));
      return jsonResult(envelope, exitCode);
    }
  );

  server.tool(
    "rca_pricing_diff",
    "Revenue Cloud (RCA): semantic diff between two pricing procedure files or two versions within one file. Read-only; returns the canonical JSON result envelope (status 'changed' when meaningful drift exists).",
    DIFF_SCHEMA,
    async (args: DiffArgs) => {
      const { envelope, exitCode } = runPricingCommand("diff", diffArgv(args));
      return jsonResult(envelope, exitCode);
    }
  );

  registerSfxTools(server);
}

/**
 * sfx discovery tools (vendored packages/rca/sfx). These run the sfx CLI
 * dispatcher in-process and capture its JSON envelope. `org-baseline` and
 * `doctor` invoke the Salesforce `sf` CLI internally (read-only) — the same
 * `sf` prerequisite that normal /design and /build already require. `commands`
 * and `project-inventory` are pure local/read-only.
 */

const DETAIL_SCHEMA = z
  .enum(["low", "standard", "deep"])
  .optional()
  .describe("Depth of inspection (default: standard)");

const PROJECT_INVENTORY_SCHEMA = {
  repo: z.string().min(1).describe("Filesystem path to the repository to inspect"),
  detail: DETAIL_SCHEMA,
};

const ORG_BASELINE_SCHEMA = {
  org: z.string().min(1).describe("Salesforce org alias or username to inspect (must be authed with the sf CLI)"),
  detail: DETAIL_SCHEMA,
};

type ProjectInventoryArgs = { repo: string; detail?: "low" | "standard" | "deep" };
type OrgBaselineArgs = { org: string; detail?: "low" | "standard" | "deep" };

function registerSfxTools(server: McpServer): void {
  server.tool(
    "rca_sfx_commands",
    "Revenue Cloud (RCA): list the sfx discovery command surface as a machine-readable envelope (command ids, purposes, inputs, flags). Read-only; use for low-context orchestration before running a discovery command.",
    {},
    async () => {
      const { envelope, exitCode } = await runSfxCommand(["commands"]);
      return jsonResult(envelope, exitCode);
    }
  );

  server.tool(
    "rca_sfx_doctor",
    "Revenue Cloud (RCA): assess Salesforce CLI (`sf`) readiness for discovery workflows and recommend exact remediation. Read-only; returns the canonical JSON result envelope.",
    {},
    async () => {
      const { envelope, exitCode } = await runSfxCommand(["doctor", "sf-cli"]);
      return jsonResult(envelope, exitCode);
    }
  );

  server.tool(
    "rca_sfx_project_inventory",
    "Revenue Cloud (RCA): scan a repository for Salesforce package roots, metadata families, and discovery hotspots. Read-only; returns the canonical JSON result envelope.",
    PROJECT_INVENTORY_SCHEMA,
    async (args: ProjectInventoryArgs) => {
      const argv = ["discover", "project-inventory", "--repo", args.repo];
      pushFlag(argv, "--detail", args.detail);
      const { envelope, exitCode } = await runSfxCommand(argv);
      return jsonResult(envelope, exitCode);
    }
  );

  server.tool(
    "rca_sfx_org_baseline",
    "Revenue Cloud (RCA): capture a read-only baseline of org capabilities, installed packages, and automation surface area via the `sf` CLI. Returns the canonical JSON result envelope. Requires an authed org alias.",
    ORG_BASELINE_SCHEMA,
    async (args: OrgBaselineArgs) => {
      const argv = ["discover", "org-baseline", "--org", args.org];
      pushFlag(argv, "--detail", args.detail);
      const { envelope, exitCode } = await runSfxCommand(argv);
      return jsonResult(envelope, exitCode);
    }
  );

  registerQuoteRuntimeTools(server);
}

/**
 * quote-runtime investigation tool (vendored packages/rca/quote-runtime). Runs
 * the quote-runtime CLI dispatcher in-process and captures its JSON envelope.
 *
 * Only the READ-ONLY investigation surface is exposed — commands that mutate an
 * org (create/upsert/price/apply/activate/repair/deploy/refresh/build) are
 * deliberately omitted so the MCP tool cannot change org state. Org-touching
 * investigators still require an authed `sf` org (the normal /design + /build
 * prerequisite); pass `--org-alias <alias>` in `args`.
 */

const QUOTE_RUNTIME_READONLY_COMMANDS = [
  "doctor",
  "triage-symptom",
  "explain-price",
  "explain-missing-price",
  "compare-quote-pricing",
  "classify-pricing-outcome",
  "inspect-pricing-waterfall",
  "inspect-rlm-context",
  "inspect-usage-rate-model",
  "inspect-pricing-product-sync",
  "inspect-quote-ready-product",
  "inspect-product-catalog-config",
  "inspect-product-config",
  "validate-product-config",
  "inspect-asset-lifecycle",
  "verify-lifecycle-provenance",
  "snapshot-quote",
  "snapshot-lines",
  "overlay-actions",
  "overlay-relationships",
  "discover-products",
  "pst-plan",
] as const;

const QUOTE_RUNTIME_SCHEMA = {
  command: z
    .enum(QUOTE_RUNTIME_READONLY_COMMANDS)
    .describe("Read-only quote-runtime investigation command to run"),
  args: z
    .array(z.string())
    .optional()
    .describe("Additional CLI arguments (e.g. ['--org-alias','myOrg','--quote-id','0Q0...','--symptom','missing price']). --json is added automatically."),
};

type QuoteRuntimeArgs = {
  command: (typeof QUOTE_RUNTIME_READONLY_COMMANDS)[number];
  args?: string[];
};

function registerQuoteRuntimeTools(server: McpServer): void {
  server.tool(
    "rca_quote_runtime_investigate",
    "Revenue Cloud (RCA): run a read-only quote-runtime investigation command (pricing waterfall, symptom triage, explain/compare price, product/quote/asset inspection, provenance) in-process. Returns the canonical JSON result envelope. Never mutates the org.",
    QUOTE_RUNTIME_SCHEMA,
    async (a: QuoteRuntimeArgs) => {
      const { envelope, exitCode } = await runQuoteRuntimeCommand(a.command, a.args ?? []);
      return jsonResult(envelope, exitCode);
    }
  );

  registerContextDefinitionTools(server);
  registerArmMatrixTool(server);
}

const ARM_MATRIX_SCHEMA = {
  path: z
    .string()
    .min(1)
    .describe("Path to an ARM approval-matrix scenario JSON file (array of rows, or an object with a 'rows' array and optional 'max_tiers')"),
};

type ArmMatrixArgs = { path: string };

/**
 * ARM approval-matrix validator tool (vendored packages/rca/arm-matrix).
 * Shares its pure logic with the runnable CLI devops/scripts/validate-arm-matrix.mjs
 * (single source, no drift). Read-only; validates a local scenario JSON and
 * returns validity, errors, warnings and boundary routing simulations.
 */
function registerArmMatrixTool(server: McpServer): void {
  server.tool(
    "rca_validate_arm_matrix",
    "Revenue Cloud (RCA) / ARM approvals: validate a three-tier approval-matrix scenario JSON (tiers, thresholds, operators, approver strategies) and compute boundary routing simulations. Read-only; returns { valid, errors, warnings, simulations }. isError when validation fails.",
    ARM_MATRIX_SCHEMA,
    async (a: ArmMatrixArgs) => {
      let document: unknown;
      try {
        document = JSON.parse(readFileSync(a.path, "utf8"));
      } catch (err) {
        return textResult(
          `error: could not read or parse ${a.path}: ${(err as Error).message}`,
          2
        );
      }
      try {
        const result = validateArmMatrix(document);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
          ...(result.valid ? {} : { isError: true }),
        };
      } catch (err) {
        return textResult(`error: ${(err as Error).message}`, 2);
      }
    }
  );
}

const CONTEXT_DEF_INSPECT_SCHEMA = {
  path: z
    .string()
    .min(1)
    .describe("Path to a Salesforce RCA Context Definition file (*.contextDefinition-meta.xml)"),
  output: z
    .enum(["summary", "json", "all"])
    .optional()
    .describe("Output shape: 'summary' (compact structural index, default), 'json' (full machine-readable structure), or 'all' (full holistic human view)"),
  node: z
    .string()
    .optional()
    .describe("Return enriched detail for a single node by name (overrides 'output')"),
};

type ContextDefInspectArgs = {
  path: string;
  output?: "summary" | "json" | "all";
  node?: string;
};

const CONTEXT_DEF_VALIDATE_SCHEMA = {
  path: z
    .string()
    .min(1)
    .describe("Path to a Salesforce RCA Context Definition file (*.contextDefinition-meta.xml)"),
  verbose: z
    .boolean()
    .optional()
    .describe("Include per-node attribute counts in the report"),
  checkAttribute: z
    .string()
    .optional()
    .describe("Trace a single context attribute across nodes and mappings"),
};

type ContextDefValidateArgs = {
  path: string;
  verbose?: boolean;
  checkAttribute?: string;
};

/**
 * context-definition-editor tools (vendored packages/rca/context-definition).
 * Zero-dependency CJS scripts run in-process; both are read-only structural
 * analysers over a local *.contextDefinition-meta.xml file (no org access).
 */
function registerContextDefinitionTools(server: McpServer): void {
  server.tool(
    "rca_context_definition_inspect",
    "Revenue Cloud (RCA): map the structure of a Context Definition XML file (nodes, attributes, mappings, remappings) for agent-driven editing. Read-only; returns a structural summary, full JSON, holistic view, or single-node detail.",
    CONTEXT_DEF_INSPECT_SCHEMA,
    async (a: ContextDefInspectArgs) => {
      const argv = [a.path];
      if (a.node) {
        argv.push("--node", a.node);
      } else if (a.output === "json") {
        argv.push("--json");
      } else if (a.output === "all") {
        argv.push("--all");
      }
      const { stdout, stderr, exitCode } = runContextDefCommand("discover", argv);
      return textResult(stderr ? `${stdout}\n${stderr}`.trim() : stdout, exitCode);
    }
  );

  server.tool(
    "rca_context_definition_validate",
    "Revenue Cloud (RCA): validate a Context Definition XML file — well-formedness, attribute/node consistency, duplicate titles, required children, hydration details and mapping consistency. Read-only; returns the validation report (isError when checks fail).",
    CONTEXT_DEF_VALIDATE_SCHEMA,
    async (a: ContextDefValidateArgs) => {
      const argv = [a.path];
      if (a.verbose) argv.push("--verbose");
      if (a.checkAttribute) argv.push("--check-attribute", a.checkAttribute);
      const { stdout, stderr, exitCode } = runContextDefCommand("validate", argv);
      return textResult(stderr ? `${stdout}\n${stderr}`.trim() : stdout, exitCode);
    }
  );
}
