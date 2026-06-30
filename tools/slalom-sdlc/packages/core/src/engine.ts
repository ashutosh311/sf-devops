import Handlebars from "handlebars";
import type { SdlcConfig } from "./schema.js";
import { discoverTemplate } from "./templates/discover.js";
import { refineTemplate } from "./templates/refine.js";
import { designTemplate } from "./templates/design.js";
import { buildTemplate } from "./templates/build.js";
import { testTemplate } from "./templates/test.js";
import { releaseTemplate } from "./templates/release.js";
import deploymentInstruction          from "../../../../../devops/instructions/deployment.md";
import orgImpactAssessmentInstruction from "../../../../../devops/instructions/org-impact-assessment.md";

// {{#eq a b}}...{{/eq}} helper for estimation approach conditionals
Handlebars.registerHelper("eq", function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
  return a === b ? options.fn(this) : options.inverse(this);
});

const PHASE_TEMPLATES: Record<string, string> = {
  discover: discoverTemplate,
  refine: refineTemplate,
  design: designTemplate,
  build: buildTemplate,
  test: testTemplate,
  release: releaseTemplate,
};

export function renderPrompt(phase: string, config: SdlcConfig): string {
  const raw = PHASE_TEMPLATES[phase];
  if (!raw) throw new Error(`No template found for phase: ${phase}`);

  // Expose phases as a boolean map so templates can use {{#if phases.release}}
  const phaseFlags = Object.fromEntries(
    Object.keys(PHASE_TEMPLATES).map((p) => [p, config.phases.includes(p as SdlcConfig["phases"][number])])
  );

  const instructions = {
    deployment: deploymentInstruction,
    orgImpactAssessment: orgImpactAssessmentInstruction,
  };

  const compiled = Handlebars.compile(raw, { noEscape: true });
  return compiled({ ...config, phases: phaseFlags, instructions });
}

export function renderAllPrompts(config: SdlcConfig): Record<string, string> {
  return Object.fromEntries(
    config.phases.map((phase) => [phase, renderPrompt(phase, config)])
  );
}
