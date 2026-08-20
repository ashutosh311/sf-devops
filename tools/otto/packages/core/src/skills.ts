// Revenue Cloud Advanced (RCA) skill guidance, bundled from this repo's
// `devops/skills/revenue-cloud/` at build time via tsup's `.md` text loader — the
// same pattern as standards.ts and engine.ts instructions. No network fetch is
// required; the tool ships the skills it was built with. These are only injected
// into templates when `revenueCloud.enabled` is set on the project config.
import pricingProcedures        from "../../../../../devops/skills/revenue-cloud/pricing-procedures.md";
import quotingPricingRuntime    from "../../../../../devops/skills/revenue-cloud/quoting-pricing-runtime.md";
import contextDefinitionEditor  from "../../../../../devops/skills/revenue-cloud/revenue-management-context-definition-editor.md";
import demoData                 from "../../../../../devops/skills/revenue-cloud/salesforce-demo-data.md";
import docgenWorkflow           from "../../../../../devops/skills/revenue-cloud/omnistudio-docgen-workflow.md";
import orgCapabilityBaseline    from "../../../../../devops/skills/revenue-cloud/salesforce-org-capability-baseline.md";
import projectInventory         from "../../../../../devops/skills/revenue-cloud/salesforce-project-inventory.md";

/** Maps camelCase template keys to the on-disk skill filenames (for cache sync/reads). */
export const REVENUE_CLOUD_SKILL_FILES: Record<string, string> = {
  pricingProcedures:       "pricing-procedures",
  quotingPricingRuntime:   "quoting-pricing-runtime",
  contextDefinitionEditor: "revenue-management-context-definition-editor",
  demoData:                "salesforce-demo-data",
  docgenWorkflow:          "omnistudio-docgen-workflow",
  orgCapabilityBaseline:   "salesforce-org-capability-baseline",
  projectInventory:        "salesforce-project-inventory",
};

const REVENUE_CLOUD_SKILLS: Record<string, string> = {
  pricingProcedures,
  quotingPricingRuntime,
  contextDefinitionEditor,
  demoData,
  docgenWorkflow,
  orgCapabilityBaseline,
  projectInventory,
};

/** Returns the bundled Revenue Cloud skill guidance keyed by camelCase template name. */
export function getRevenueCloudSkills(): Record<string, string> {
  return { ...REVENUE_CLOUD_SKILLS };
}
