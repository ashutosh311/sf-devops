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
import prerequisiteCheckInstruction   from "../../../../../devops/instructions/prerequisite-check.md";
import { readCachedTemplate, readCachedInstruction } from "./cache.js";

// {{#eq a b}}...{{/eq}} helper for estimation approach conditionals
Handlebars.registerHelper("eq", function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
  return a === b ? options.fn(this) : options.inverse(this);
});

export const PHASE_TEMPLATES: Record<string, string> = {
  discover: discoverTemplate,
  refine: refineTemplate,
  design: designTemplate,
  build: buildTemplate,
  test: testTemplate,
  release: releaseTemplate,
};

export interface RenderOptions {
  cacheDir?: string;
}

export function renderPrompt(phase: string, config: SdlcConfig, opts?: RenderOptions): string {
  // Prefer cached template; fall back to bundled constant
  const raw = (opts?.cacheDir ? readCachedTemplate(phase, opts.cacheDir) : null) ?? PHASE_TEMPLATES[phase];
  if (!raw) throw new Error(`No template found for phase: ${phase}`);

  // Expose phases as a boolean map so templates can use {{#if phases.release}}
  const phaseFlags = Object.fromEntries(
    Object.keys(PHASE_TEMPLATES).map((p) => [p, config.phases.includes(p as SdlcConfig["phases"][number])])
  );

  // Prefer cached instruction files; fall back to bundled imports
  const instructions = {
    deployment: (opts?.cacheDir ? readCachedInstruction("deployment", opts.cacheDir) : null) ?? deploymentInstruction,
    orgImpactAssessment: (opts?.cacheDir ? readCachedInstruction("org-impact-assessment", opts.cacheDir) : null) ?? orgImpactAssessmentInstruction,
    prerequisiteCheck: (opts?.cacheDir ? readCachedInstruction("prerequisite-check", opts.cacheDir) : null) ?? prerequisiteCheckInstruction,
  };

  const compiled = Handlebars.compile(raw, { noEscape: true });
  return compiled({ ...config, phases: phaseFlags, instructions });
}

export function renderAllPrompts(config: SdlcConfig, opts?: RenderOptions): Record<string, string> {
  return Object.fromEntries(
    config.phases.map((phase) => [phase, renderPrompt(phase, config, opts)])
  );
}
