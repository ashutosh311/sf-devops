import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderPrompt,
  renderAllPrompts,
  resolveAlmTool,
  resolveProjectKey,
  OttoConfigSchema,
  QUESTIONS,
  buildOttoConfig,
  resolveExistingAnswer,
  resolveStatusTransitions,
  PHASE_TEMPLATES,
  TEST_SKILLS,
  REFINE_SKILLS,
  RELEASE_SKILLS,
  skillTemplateKey,
} from "../dist/index.js";

const story = {
  backlog: "Backlog",
  refineInProgress: "In Refinement",
  readyForDesign: "Ready for Design",
  designInProgress: "In Design",
  readyForBuild: "Ready for Build",
  inDevelopment: "In Development",
  readyForTest: "Ready for Test",
  done: "Done",
};
const epic = { notStarted: "To Do", inProgress: "In Progress", done: "Done" };
const subTask = { todo: "To Do", inDevelopment: "In Progress", readyForTest: "In Review", done: "Done" };

const base = {
  version: "1",
  generatedAt: "2026-01-01",
  toolVersion: "1",
  phases: ["discover", "refine", "design", "build", "test", "release"],
  team: { sprintLengthWeeks: 2, estimationApproach: "ta-assigns" },
  salesforce: { orgs: { sandbox: "uat" } },
  standards: { apexCoverageThreshold: 85 },
  branching: "gitflow",
  paths: { artifacts: "artifacts", standards: "devops/standards", forceApp: "force-app" },
};

const jiraCfg = {
  ...base,
  project: { name: "Demo", jiraKey: "PROJ" },
  alm: { tool: "JIRA", projectKey: "PROJ", site: "https://x.atlassian.net", email: "a@b.com" },
  jira: { statusMap: { story, epic, subTask } },
};

const adoCfg = {
  ...base,
  project: { name: "Demo" },
  alm: { tool: "ADO", organization: "https://dev.azure.com/o", project: "P" },
  ado: { statusMap: { story, epic, subTask } },
};

const localCfg = {
  ...base,
  project: { name: "Demo" },
  alm: { tool: "LOCAL", keyPrefix: "LOCAL" },
  // deliberately no jira/ado block — engine falls back to DEFAULT_STATUS_MAP
};

const jiraFieldCfg = {
  ...jiraCfg,
  design: { deliverable: { storyField: "customfield_10123" } },
};

const adoFieldCfg = {
  ...adoCfg,
  design: { deliverable: { storyField: "Custom.SolutionDescription" } },
};

const PHASES = ["discover", "refine", "design", "build", "test", "release"];

test("all example configs validate against the schema", () => {
  assert.equal(OttoConfigSchema.safeParse(jiraCfg).success, true);
  assert.equal(OttoConfigSchema.safeParse(adoCfg).success, true);
  assert.equal(OttoConfigSchema.safeParse(localCfg).success, true);
});

test("resolve helpers pick the active PM tool", () => {
  assert.equal(resolveAlmTool(jiraCfg), "JIRA");
  assert.equal(resolveAlmTool(adoCfg), "ADO");
  assert.equal(resolveAlmTool(localCfg), "LOCAL");
  assert.equal(resolveAlmTool({ ...base, project: { name: "X" } }), "JIRA");
  assert.equal(resolveProjectKey(jiraCfg), "PROJ");
  assert.equal(resolveProjectKey(adoCfg), "P");
  assert.equal(resolveProjectKey(localCfg), "LOCAL");
});

for (const [name, cfg] of [["JIRA", jiraCfg], ["ADO", adoCfg], ["LOCAL", localCfg]]) {
  test(`${name}: every template renders with no unresolved handlebars or blank status cells`, () => {
    const all = renderAllPrompts(cfg);
    for (const phase of PHASES) {
      const out = all[phase];
      assert.ok(out, `${phase} produced no output`);
      const unresolved = out.match(/\{\{[^}]+\}\}/g) || [];
      assert.deepEqual(unresolved, [], `${name}/${phase} has unresolved handlebars: ${unresolved}`);
      const blankCells = out.match(/\| \*\*\*\* \|/g) || [];
      assert.equal(blankCells.length, 0, `${name}/${phase} has blank status cells`);
    }
  });
}

test("JIRA design uses ADF/Jira MCP calls, not ADO calls", () => {
  const out = renderPrompt("design", jiraCfg);
  assert.ok(out.includes("addCommentToJiraIssue"));
  assert.ok(!out.includes("add_work_item_comment"));
  assert.ok(out.includes("Ready for Build"));
});

test("ADO design uses Azure DevOps work-item calls, not Jira calls", () => {
  const out = renderPrompt("design", adoCfg);
  assert.ok(out.includes("add_work_item_comment"));
  assert.ok(out.includes("update_work_item"));
  assert.ok(!out.includes("addCommentToJiraIssue"));
  assert.ok(out.includes("Ready for Build"));
});

test("design template supports Local mode for both tools", () => {
  for (const cfg of [jiraCfg, adoCfg]) {
    const out = renderPrompt("design", cfg);
    assert.ok(out.includes("Local mode"), "design should describe Local mode");
    assert.ok(
      out.includes("04 - Backlog/stories/{EPIC-ID}/{STORY-KEY}/refinement-notes.md"),
      "design Local mode should read refinement notes from the backlog folder"
    );
  }
});

test("refine-story sub-skill supports Local mode for both tools", () => {
  for (const cfg of [jiraCfg, adoCfg]) {
    const out = renderPrompt("refine-story", cfg);
    assert.ok(out.includes("Local mode"), "refine-story should describe Local mode");
  }
});

test("refine menu is a routing index — carries the guard, not the skills' procedures", () => {
  const out = renderPrompt("refine", jiraCfg);
  // The menu must tell the agent to re-invoke for the real procedure...
  assert.ok(/routing/i.test(out), "refine menu should describe itself as routing only");
  assert.ok(out.includes('skill: "<chosen-skill>"'), "refine menu should instruct re-invocation with a skill");
  // ...and must NOT inline a skill's procedure (the INVEST step lives in refine-story).
  assert.ok(!out.includes("3a — INVEST validation"), "refine menu should not contain the story skill's procedure");
});

test("misconfiguration (no status map) fails loudly", () => {
  const broken = { ...base, project: { name: "X" } };
  assert.throws(() => renderPrompt("design", broken), /status map/);
});

test("ADO status map falls back to nothing configured throws for ADO too", () => {
  const brokenAdo = { ...base, project: { name: "X" }, alm: { tool: "ADO", organization: "https://dev.azure.com/o", project: "P" } };
  assert.throws(() => renderPrompt("build", brokenAdo), /status map/);
});

test("LOCAL config renders without a status map (falls back to defaults, no throw)", () => {
  // A LOCAL project intentionally has no jira/ado block; the engine must supply
  // DEFAULT_STATUS_MAP so the guard never fires and stage labels still render.
  assert.doesNotThrow(() => renderPrompt("design", localCfg));
  const out = renderPrompt("design", localCfg);
  assert.ok(out.includes("Ready for Build"), "LOCAL should render default stage labels");
  assert.ok(out.includes("Local mode"), "LOCAL should describe Local mode");
});

test("design.deliverable.storyField switches design to field mode, not the full comment", () => {
  const out = renderPrompt("design", jiraFieldCfg);
  assert.ok(out.includes("customfield_10123"), "design should name the configured field");
  assert.ok(out.includes("Field mode"), "design should describe field mode");
  assert.ok(
    out.includes("flat build checklist") || out.includes("flat numbered list"),
    "design should describe the checklist deliverable, not the full comment"
  );
  assert.ok(
    !/post the full solution design as a comment/.test(out.replace(/\{\{[^}]*\}\}/g, "")),
    "design should not instruct posting the full comment when storyField is configured"
  );
  // §5c step 1 verification guard must be present so a misconfigured field key fails
  // loudly instead of silently falling back to comment mode.
  assert.ok(out.includes("isn't a valid, writable field"), "design should verify the field before writing to it");
});

test("design.deliverable.storyField keeps state-machine decisions (0a-sync, resume matrix) mode-aware", () => {
  const out = renderPrompt("design", jiraFieldCfg);
  assert.ok(
    out.includes("customfield_10123` field still empty") || out.includes("customfield_10123\\` field still empty"),
    "resume matrix should test field emptiness, not a hardcoded design comment, in field mode"
  );
  assert.ok(
    !out.includes("no design comment yet"),
    "field mode should not fall back to comment-only language in the resume matrix"
  );
});

test("build reads design.deliverable.storyField first, and still names the field as the design of record", () => {
  const out = renderPrompt("build", jiraFieldCfg);
  assert.ok(out.includes("customfield_10123"), "build should read the configured field");
  assert.ok(out.includes("getJiraIssue"), "build should fetch the field via getJiraIssue");
  assert.ok(
    !out.includes("Solution Design comment (step 1) remains the design of record"),
    "build should not contradict itself by calling the comment the design of record in field mode"
  );
});

test("build without storyField still uses the comment as the design of record (regression)", () => {
  const out = renderPrompt("build", jiraCfg);
  assert.ok(
    out.includes("Solution Design comment (step 1) remains the design of record"),
    "build should still name the comment as the design of record when storyField is not configured"
  );
});

test("ADO field mode stays platform-neutral — no JIRA vocabulary leaks into the ADO branch", () => {
  for (const phase of ["design", "build"]) {
    const out = renderPrompt(phase, adoFieldCfg);
    assert.ok(out.includes("Custom.SolutionDescription"), `${phase} should name the configured ADO field`);
    assert.ok(
      !out.includes("customfield_"),
      `${phase} must not tell an ADO project to use a JIRA customfield_ key`
    );
    assert.ok(
      !/getJiraIssue|editJiraIssue|getJiraIssueTypeMetaWithFields/.test(out),
      `${phase} must not instruct JIRA MCP calls on an ADO project`
    );
  }
});

test("field-mode verification guard is present and per-tool correct", () => {
  const jira = renderPrompt("design", jiraFieldCfg);
  assert.ok(
    jira.includes("getJiraIssueTypeMetaWithFields"),
    "JIRA should verify the field against the editable-field schema"
  );
  assert.ok(
    jira.includes("customfield_10123`), not the display name"),
    "JIRA guard should explain the internal-key requirement"
  );

  const ado = renderPrompt("design", adoFieldCfg);
  assert.ok(ado.includes("get_work_item"), "ADO should verify via get_work_item");
  assert.ok(
    ado.includes("reference name"),
    "ADO guard should explain the reference-name requirement, not JIRA's key format"
  );
  // An unset-but-valid ADO field is omitted from get_work_item, so the guard must not
  // treat absence as a failure — that would hard-stop correctly-configured projects.
  assert.ok(
    ado.includes("inconclusive and proceed"),
    "ADO guard must not treat an omitted (unpopulated) field as a config failure"
  );
});

test("field mode keeps a pre-existing design comment as a fallback source", () => {
  const out = renderPrompt("design", jiraFieldCfg);
  assert.ok(
    out.includes("or a design comment (from before"),
    "Review Mode should still consider a legacy comment when storyField is configured"
  );
});

test("no imperative literal mcp__ tool calls leak into rendered output (host-naming regression)", () => {
  // Illustrative mentions (e.g. `mcp__Salesforce_DX__get_username` as a Claude Code
  // example, or the `mcp__<server>__<tool>` pattern) are fine — this only guards
  // against reintroducing an imperative "Call `mcp__...`" instruction that hardcodes
  // one host's naming convention as the way to invoke a tool.
  const imperativeMcpCall = /\b(?:call|invoke)\s+`mcp__/i;
  for (const cfg of [jiraCfg, adoCfg, localCfg]) {
    const all = renderAllPrompts(cfg);
    for (const phase of PHASES) {
      const match = all[phase].match(imperativeMcpCall);
      assert.equal(match, null, `${phase} has an imperative literal mcp__ call: ${match}`);
    }
  }
});

// ── Test agent — sub-skill registry (see the Test Agent Vision & Plan note) ────

// An imperative instruction to move the story into the configured done status.
// Built from the resolved value (not the `{{...}}` source) because these guards
// run against rendered output. `[^.\n]` keeps the match inside one sentence, so
// a disclaimer like "this skill never transitions the story." cannot trip it.
const transitionsToDone = new RegExp(
  String.raw`transition[^.\n]{0,120}\*{0,2}${story.done}\*{0,2}`,
  "i"
);

test("no PHASE_TEMPLATES key contains ':' (B1 — illegal in a Windows filename)", () => {
  for (const key of Object.keys(PHASE_TEMPLATES)) {
    assert.ok(!key.includes(":"), `PHASE_TEMPLATES key "${key}" contains ':'`);
  }
});

test("TEST_SKILLS all compose to a registered PHASE_TEMPLATES key", () => {
  for (const skill of TEST_SKILLS) {
    const key = skillTemplateKey("test", skill);
    assert.ok(PHASE_TEMPLATES[key], `no template registered for composed key "${key}"`);
  }
});

test("REFINE_SKILLS all compose to a registered PHASE_TEMPLATES key", () => {
  for (const skill of REFINE_SKILLS) {
    const key = skillTemplateKey("refine", skill);
    assert.ok(PHASE_TEMPLATES[key], `no template registered for composed key "${key}"`);
  }
});

test("RELEASE_SKILLS all compose to a registered PHASE_TEMPLATES key", () => {
  for (const skill of RELEASE_SKILLS) {
    const key = skillTemplateKey("release", skill);
    assert.ok(PHASE_TEMPLATES[key], `no template registered for composed key "${key}"`);
  }
});

test("the release menu routes to skill instructions rather than describing them inline", () => {
  for (const cfg of [jiraCfg, adoCfg, localCfg]) {
    const out = renderPrompt("release", cfg);
    assert.match(out, /otto_prompt/, "menu must name the tool that loads a skill's instructions");
    assert.match(out, /skill: "<chosen-skill>"/, "menu must show how to request a specific skill");
    for (const skill of RELEASE_SKILLS) {
      assert.ok(out.includes(`\`${skill}\``), `menu is missing the "${skill}" skill`);
    }
    // The menu is an index only — no skill's procedure may leak into it.
    assert.ok(!out.includes("sf project deploy start"), "menu must not embed the deploy procedure");
    assert.ok(!out.includes("sf code-analyzer run"), "menu must not embed the quality-gate procedure");
  }
});

test("release-deploy carries the full deploy procedure and never transitions a story", () => {
  for (const cfg of [jiraCfg, adoCfg, localCfg]) {
    const out = renderPrompt("release-deploy", cfg);
    assert.match(out, /sf project deploy start/, "deploy skill must contain the deploy command");
    assert.match(out, /UAT sign-off/, "deploy skill must keep the sign-off gate");
    assert.match(out, /release-notes/, "deploy skill must hand off to the release-notes skill");
    assert.doesNotMatch(out, transitionsToDone, "release-deploy must not transition a story to Done");
  }
});

test("release-deploy gates the UAT deploy behind the SFCA scan, scoped to changed files", () => {
  const out = renderPrompt("release-deploy", jiraCfg);
  const gate = out.indexOf("sf code-analyzer run");
  const deploy = out.indexOf("## Step 4 — Deploy to UAT");
  assert.ok(gate !== -1, "deploy skill must run SFCA");
  assert.ok(deploy !== -1, "deploy skill must still have its UAT deploy step");
  assert.ok(gate < deploy, "the SFCA scan must come before the UAT deploy step");
  assert.match(out, /--target/, "scan must target the changed files");
  assert.match(out, /Do \*\*not\*\* scan the full org/, "scan must be limited to the release diff");
  assert.match(out, /Do not proceed to Step 3/, "blocking findings must stop the deploy");
  assert.match(out, /RISK-ACCEPTED/, "an explicit risk-accept path must be recorded, not silent");
});

test("SFCA gate severity comes from config, with defaults High / Moderate — never hardcoded", () => {
  const def = renderPrompt("release-deploy", jiraCfg);
  assert.match(def, /1 through 2 \(High and above\)/, "default failOn should render as High (levels 1-2)");
  assert.match(def, /after 2 through 3 \(Moderate and above, but below High\)/, "default warnOn should render as Moderate");

  const strict = renderPrompt("release-deploy", {
    ...jiraCfg,
    qualityGate: { sfca: { failOn: "Moderate", warnOn: "Low" } },
  });
  assert.match(strict, /1 through 3 \(Moderate and above\)/);
  assert.match(strict, /after 3 through 4 \(Low and above, but below Moderate\)/);

  // A warnOn that is not below failOn can never fire, so the warning tier is dropped.
  const noWarn = renderPrompt("release-deploy", {
    ...jiraCfg,
    qualityGate: { sfca: { failOn: "Critical", warnOn: "Critical" } },
  });
  assert.doesNotMatch(noWarn, /\*\*Warning\*\*/);
  assert.doesNotMatch(noWarn, /PASS WITH WARNINGS/);
});

test("qualityGate config validates and rejects unknown severities", () => {
  assert.equal(OttoConfigSchema.safeParse({ ...jiraCfg, qualityGate: { sfca: { failOn: "High" } } }).success, true);
  assert.equal(OttoConfigSchema.safeParse({ ...jiraCfg, qualityGate: {} }).success, true);
  assert.equal(OttoConfigSchema.safeParse({ ...jiraCfg, qualityGate: { sfca: { failOn: "Severe" } } }).success, false);
});

test("release-notes builds from the git diff + tickets, in the agreed shape, and stays read-only", () => {
  for (const cfg of [jiraCfg, adoCfg, localCfg]) {
    const out = renderPrompt("release-release-notes", cfg);
    assert.match(out, /git diff --name-status/, "must diff git for the authoritative scope");
    assert.match(out, /release-scope\.md/, "must share the scope file with deploy");
    assert.match(out, /\| Group \| Item \| Benefit \|/, "must use the Group | Item | Benefit shape");
    assert.match(out, /New/);
    assert.match(out, /Fixed/);
    assert.match(out, /Improved/);
    assert.match(out, /Technical appendix/, "must include the technical appendix");
    assert.match(out, /never transitions or edits a ticket/i, "must disclaim ticket transitions");
    assert.doesNotMatch(out, transitionsToDone, "release-notes must not transition a story");
  }
  assert.match(renderPrompt("release-release-notes", jiraCfg), /searchJiraIssuesUsingJql/);
  assert.match(renderPrompt("release-release-notes", adoCfg), /get_work_item/);
  assert.doesNotMatch(renderPrompt("release-release-notes", adoCfg), /searchJiraIssuesUsingJql/);
  assert.match(renderPrompt("release-release-notes", localCfg), /Local mode/);
});

test("impact-assessment confirms sources, is read-only/advisory, and never asserts beyond its sources", () => {
  for (const cfg of [jiraCfg, adoCfg, localCfg]) {
    const out = renderPrompt("release-impact-assessment", cfg);
    assert.match(out, /release-notes\.salesforce_release_notes\.htm/, "must propose the official release-notes URL");
    assert.match(out, /Winter '27 = 264/, "must anchor the release-number mapping");
    assert.match(out, /confirm or extend/i, "user must confirm/extend the sources");
    assert.match(out, /markitdown/, "must convert PDF/PPTX via markitdown");
    assert.match(out, /browser tool/i, "must use a browser tool when available");
    assert.match(out, /ask the user to save/i, "must fall back to user-supplied files");
    assert.match(out, /Confirmed/);
    assert.match(out, /Inferred/);
    assert.match(out, /advisory/i, "must be advisory, not gating");
    assert.match(out, /never modifies \S*force-app/, "must not write to force-app");
    assert.match(out, /impact-assessment\.md/);
    assert.doesNotMatch(out, transitionsToDone, "impact-assessment must not transition a story");
  }
});

test("release scope diff yields single-letter statuses, so renames are scanned at their new path", () => {
  const out = renderPrompt("release-deploy", jiraCfg);
  assert.match(out, /--no-renames/, "diff must disable rename detection");
  assert.doesNotMatch(out, /diff-filter=[A-Z]*[CR]/, "diff filter must not rely on C/R statuses");
  assert.doesNotMatch(out, /A \/ C \/ M \/ R/, "scan step must not key off C/R statuses");
  assert.match(out, /status \*\*A\*\* or \*\*M\*\*/, "scan step must target A and M files");
});

test("release ticket-key extraction matches the active PM tool, not just JIRA", () => {
  const jira = renderPrompt("release-release-notes", jiraCfg);
  assert.match(jira, /JIRA keys have the shape `PROJ-123`/);
  assert.doesNotMatch(jira, /AB#123/);

  const ado = renderPrompt("release-release-notes", adoCfg);
  assert.match(ado, /AB#123/, "ADO work items are referenced by numeric ID");
  assert.match(ado, /Do \*\*not\*\* build keys from the project name/);
  assert.doesNotMatch(ado, /`P-123`/);

  const local = renderPrompt("release-release-notes", localCfg);
  assert.match(local, /04 - Backlog\/stories/, "local mode matches backlog Story IDs");
  assert.match(local, /STORY-001/);
});

test("each release skill scopes the shared environment check to what it actually needs", () => {
  const deploy = renderPrompt("release-deploy", jiraCfg);
  assert.match(deploy, /Scope of this check — deploy skill/);
  assert.match(deploy, /Code Analyzer plugin/);

  for (const cfg of [jiraCfg, adoCfg, localCfg]) {
    const notes = renderPrompt("release-release-notes", cfg);
    assert.match(notes, /Scope of this check — release-notes skill/);
    assert.match(notes, /Salesforce CLI[\s\S]{0,200}\*\*not\*\* needed/, "release-notes must not require the Salesforce CLI");

    const ia = renderPrompt("release-impact-assessment", cfg);
    assert.match(ia, /Scope of this check — impact-assessment skill/);
    assert.match(ia, /nothing in it is mandatory/, "impact-assessment must not stop for shared prerequisites");
  }
});

test("deploy stops on deleted components until the user decides — never auto-generates a destructive manifest", () => {
  const out = renderPrompt("release-deploy", jiraCfg);
  const del = out.indexOf("## Step 3 — Deleted and renamed components");
  const deploy = out.indexOf("## Step 4 — Deploy to UAT");
  assert.ok(del !== -1 && del < deploy, "deletion check must come before the UAT deploy");
  assert.match(out, /never removes anything from the org/, "must explain why a plain deploy leaves deletions behind");
  assert.match(out, /deleted-components\.md/);
  assert.match(out, /--pre-destructive-changes/);
  assert.match(out, /--post-destructive-changes/);
  assert.match(out, /Do not deploy until the user makes an explicit decision/);
  assert.match(out, /Never generate or deploy a destructive manifest on your own/);
  assert.match(out, /Acknowledge manual removal/);
});

test("the SFCA scan discards any stale results file before running", () => {
  const out = renderPrompt("release-deploy", jiraCfg);
  const rm = out.indexOf("rm -f artifacts/releases/{release-tag}/sfca-results.json");
  const run = out.indexOf("sf code-analyzer run");
  assert.ok(rm !== -1 && rm < run, "stale results must be removed before the scan");
});

test("release scope keeps merge commits for key extraction and records the agreed scope separately", () => {
  for (const cfg of [jiraCfg, adoCfg, localCfg]) {
    const out = renderPrompt("release-release-notes", cfg);
    assert.doesNotMatch(out, /--no-merges/, "merge commits carry the PR title/branch and must not be dropped");
    assert.match(out, /parents=\[/, "log format must expose parent count so merges can be identified");
    assert.match(out, /Keys found in the diff/);
    assert.match(out, /Agreed release scope/);
    assert.match(out, /Which stories are in this release\?/, "standalone release-notes must collect the agreed scope");
  }
  assert.match(renderPrompt("release-deploy", jiraCfg), /recorded as the \*\*Agreed release scope\*\*/);
});

test("release scope is only reused when base and head SHAs are unchanged", () => {
  const out = renderPrompt("release-deploy", jiraCfg);
  assert.match(out, /git rev-parse \{base\} \{head\}/, "scope must record both SHAs");
  assert.match(out, /identical snapshot/);
  assert.match(out, /Never reuse a stale file/);
  assert.match(out, /their SHAs\*\* \(base SHA, head SHA\)/, "scope file must store the SHAs");
});

test("deploy pins the working tree to the scanned snapshot before scanning and before each deploy", () => {
  const out = renderPrompt("release-deploy", jiraCfg);
  const pin = out.indexOf("### Pin the working tree to the scanned snapshot");
  const scan = out.indexOf("sf code-analyzer run");
  assert.ok(pin !== -1 && pin < scan, "pin checks must precede the scan");
  assert.match(out, /git status --porcelain -- force-app\//);
  const uat = out.slice(out.indexOf("## Step 4 — Deploy to UAT"), out.indexOf("## Step 5"));
  assert.match(uat, /re-run the two pin checks/, "UAT deploy must re-check the pin");
  const prod = out.slice(out.indexOf("## Step 6 — Production deployment"), out.indexOf("## Step 7"));
  assert.match(prod, /re-run the Step 2 pin checks/, "production deploy must re-check the pin");
});

test("PR metadata comes only from PRs inside the range, and PR numbers are never tickets", () => {
  for (const cfg of [jiraCfg, adoCfg, localCfg]) {
    const out = renderPrompt("release-release-notes", cfg);
    assert.doesNotMatch(out, /gh pr list/, "must not list PRs by target branch / date");
    assert.match(out, /gh pr view N/);
    assert.match(out, /from this log only/);
    assert.match(out, /pull-request number is \*\*never\*\* a ticket reference/);
  }
});

test("ADO accepts bare #123 only on Azure Repos; LOCAL matches second-level story folders", () => {
  const ado = renderPrompt("release-release-notes", adoCfg);
  assert.match(ado, /AB#123/);
  assert.match(ado, /Bare `#123` — a work item \*\*only\*\* when the remote is Azure Repos/);
  assert.match(ado, /On GitHub \(or any other host\) a bare `#123` is a PR or issue number/);

  const local = renderPrompt("release-release-notes", localCfg);
  assert.match(local, /stories\/\{EPIC-ID\}\/\{STORY-ID\}\//, "story IDs are the second folder level");
  assert.doesNotMatch(local, /stories\/\*\/`/, "must not list the epic level as stories");
});

test("release scope defaults the base to what production has, not develop", () => {
  for (const cfg of [jiraCfg, adoCfg, localCfg]) {
    const out = renderPrompt("release-release-notes", cfg);
    assert.match(out, /default: \*\*what production has\*\*, i\.e\. `origin\/main`/);
    assert.match(out, /Do \*\*not\*\* default to `develop`/);
    assert.doesNotMatch(out, /Base\*\* — default `develop`/);
  }
});

test("release-notes boundary permits the shared scope file it must write", () => {
  const out = renderPrompt("release-release-notes", jiraCfg);
  const boundary = out.slice(out.indexOf("⛔ **Boundary.**"), out.indexOf("## Environment Check"));
  assert.match(boundary, /release-scope\.md/, "boundary must allow writing release-scope.md");
  assert.match(boundary, /release-notes\.md/);
  assert.match(boundary, /git fetch/);
  assert.match(boundary, /never touches `force-app\/`/);
});

test("the environment check lists the Release skills' extra prerequisites", () => {
  const out = renderPrompt("release-deploy", jiraCfg);
  assert.match(out, /sf code-analyzer --help/);
  assert.match(out, /java -version/);
  const ia = renderPrompt("release-impact-assessment", jiraCfg);
  assert.match(ia, /markitdown --version/);
  assert.match(ia, /Playwright/);
});

test("refine-gap-analysis stays inside the refine boundary — read-only, no drafting/transition/estimate", () => {
  for (const cfg of [jiraCfg, adoCfg, localCfg]) {
    const out = renderPrompt("refine-gap-analysis", cfg);
    // Gap analysis is a completeness check — it must never advance a story to the design gate...
    assert.ok(!out.includes("Ready for Design"), "gap-analysis must not transition stories to Ready for Design");
    // ...must explicitly disclaim estimation (the plan's boundary, mechanically enforced)...
    assert.ok(/story-point estimation/.test(out), "gap-analysis should disclaim estimation");
    // ...and must describe its evidence-backed gap output, not draft/create stories.
    assert.ok(/gap/i.test(out), "gap-analysis should describe gap identification");
    assert.ok(/evidence/i.test(out), "gap-analysis should require supporting evidence");
    assert.ok(/epic-gap-analysis\.md/.test(out), "gap-analysis should write the review artifact");
  }
});

test("refine-generate-stories stays inside the refine boundary — no status transition, no design/estimate", () => {
  for (const cfg of [jiraCfg, adoCfg, localCfg]) {
    const out = renderPrompt("refine-generate-stories", cfg);
    // Drafting must never advance a story to the design gate...
    assert.ok(!out.includes("Ready for Design"), "generate-stories must not transition stories to Ready for Design");
    // ...and must explicitly disclaim estimation (the plan's boundary, mechanically enforced).
    assert.ok(/story-point estimation/.test(out), "generate-stories should disclaim estimation");
  }
});

for (const [name, cfg] of [["JIRA", jiraCfg], ["ADO", adoCfg], ["LOCAL", localCfg]]) {
  test(`${name}: every PHASE_TEMPLATES key (including Test sub-skills) renders with no unresolved handlebars`, () => {
    for (const key of Object.keys(PHASE_TEMPLATES)) {
      const out = renderPrompt(key, cfg);
      assert.ok(out, `${key} produced no output`);
      const unresolved = out.match(/\{\{[^}]+\}\}/g) || [];
      assert.deepEqual(unresolved, [], `${name}/${key} has unresolved handlebars: ${unresolved}`);
    }
  });
}

test('"test-execute" still contains the story-closing transition (B4 — the only skill that may close the story)', () => {
  const out = renderPrompt("test-execute", jiraCfg);
  // Assert on the *resolved* status value — `statusMap.story.done` can never
  // survive rendering, so matching that literal would make this guard vacuous.
  assert.match(
    out,
    transitionsToDone,
    '"test-execute" no longer instructs a transition to the configured done status'
  );
});

test("no other Test sub-skill transitions the story to Done", () => {
  for (const skill of TEST_SKILLS.filter((s) => s !== "execute")) {
    const out = renderPrompt(skillTemplateKey("test", skill), jiraCfg);
    assert.doesNotMatch(
      out,
      transitionsToDone,
      `"${skill}" instructs a transition to the done status — only execute may`
    );
  }
});

test("the test menu routes to skill instructions rather than describing them inline", () => {
  const out = renderPrompt("test", jiraCfg);
  // The menu is an index: it must tell the agent to fetch the chosen skill's own
  // instructions. Without this the agent improvises a procedure from the
  // one-line routing table, defeating the "follow verbatim" contract.
  assert.match(out, /otto_prompt/, "menu must name the tool that loads a skill's instructions");
  assert.match(out, /skill: "<chosen-skill>"/, "menu must show how to request a specific skill");
  for (const skill of TEST_SKILLS) {
    assert.ok(out.includes(skill), `menu is missing the "${skill}" skill`);
  }
});

test("/init offers JIRA, ADO and LOCAL, and gates credential questions correctly", () => {
  const pmTool = QUESTIONS.find((q) => q.id === "pmTool");
  assert.ok(pmTool, "pmTool question must exist");
  assert.deepEqual(
    pmTool.options.map((o) => o.value).sort(),
    ["ADO", "JIRA", "LOCAL"],
    "pmTool must offer all three sources"
  );

  const shows = (id, pmToolValue) => {
    const q = QUESTIONS.find((x) => x.id === id);
    return q.when ? q.when({ pmTool: pmToolValue }) : true;
  };
  // JIRA creds only for JIRA; ADO fields only for ADO; localKeyPrefix only for LOCAL
  for (const id of ["jiraKey", "jiraSite", "jiraEmail"]) {
    assert.equal(shows(id, "JIRA"), true, `${id} should show for JIRA`);
    assert.equal(shows(id, "ADO"), false, `${id} should be hidden for ADO`);
    assert.equal(shows(id, "LOCAL"), false, `${id} should be hidden for LOCAL`);
  }
  for (const id of ["adoOrganization", "adoProject"]) {
    assert.equal(shows(id, "ADO"), true, `${id} should show for ADO`);
    assert.equal(shows(id, "LOCAL"), false, `${id} should be hidden for LOCAL`);
  }
  assert.equal(shows("localKeyPrefix", "LOCAL"), true, "localKeyPrefix should show for LOCAL");
  assert.equal(shows("localKeyPrefix", "JIRA"), false, "localKeyPrefix should be hidden for JIRA");
});

// ── Test agent — apex-unit / apex-perf must gate their deploy on user confirmation ──
//
// Both skills write new/extended Apex and then call run_apex_test, which only
// executes code already present in the org — so a deploy_metadata call is
// required before the test run, and (per the Sandbox Access and Deployment
// Standards every other deploying agent follows) that deploy must be reviewed
// and explicitly confirmed by the user, never silent.

for (const skill of ["apex-unit", "apex-perf"]) {
  test(`"test-${skill}" asks the user to confirm before deploying to an org`, () => {
    const out = renderPrompt(skillTemplateKey("test", skill), jiraCfg);
    assert.match(out, /deploy_metadata/, `"${skill}" must call deploy_metadata before running tests`);
    assert.match(
      out,
      /type\s+\*\*yes\*\*\s+to proceed/i,
      `"${skill}" must ask the user to explicitly confirm (type "yes") before deploying`
    );
    assert.match(
      out,
      /do not deploy until the user explicitly confirms/i,
      `"${skill}" must state the deploy is blocked on that confirmation`
    );
  });

  test(`"test-${skill}" deploys before running tests, not after`, () => {
    const out = renderPrompt(skillTemplateKey("test", skill), jiraCfg);
    // Match the actual invocation sentences, not any mention of the tool names
    // (the Step 3 heading explains *why* a deploy is needed by referencing
    // run_apex_test in prose, which would trip a bare-substring-index check).
    const deployIdx = out.search(/Deploy via the \*\*Salesforce DX MCP\*\*'s `deploy_metadata`/);
    const runIdx = out.search(/Run `mcp__Salesforce_DX__run_apex_test`/);
    assert.ok(deployIdx > -1 && runIdx > -1, `"${skill}" must invoke both deploy_metadata and run_apex_test`);
    assert.ok(deployIdx < runIdx, `"${skill}" must deploy before running tests`);
  });
}

// ── Test agent — write-cases must not contradict its own local mode ────────────
//
// The credential gate and the 🔌 local-mode callout both key off the same
// condition (testing.testManagement absent) but must never disagree about
// what to do about it — one is a hard stop, the other a fully valid mode.

test('"test-write-cases" credential gate does not fire on an absent testManagement block', () => {
  const out = renderPrompt("test-write-cases", jiraCfg);
  assert.doesNotMatch(
    out,
    /testing\.testManagement.{0,40}is unset.{0,80}stop immediately/is,
    "the credential gate must not tell the agent to stop immediately merely because testManagement is absent — that is local mode, not a credential failure"
  );
  assert.match(
    out,
    /testing\.testManagement.{0,20}is configured.{0,200}stop immediately/is,
    "the credential gate must condition its stop-immediately instruction on testManagement actually being configured"
  );
});

// ── Status transitions (workflow.statusTransitions) — GH-86 ────────────────────
//
// `auto` (default) must leave every prompt exactly as it renders with no workflow
// block; `confirm` must require an explicit per-transition yes; `off` must forbid
// status changes and hand them to the user. Covers every transitioning template.

const TRANSITIONING = ["refine-story", "refine", "design", "build", "test", "test-execute"];
const withMode = (cfg, mode) => ({ ...cfg, workflow: { statusTransitions: mode } });

test("workflow.statusTransitions validates and resolves (default auto)", () => {
  for (const mode of ["auto", "confirm", "off"]) {
    assert.equal(OttoConfigSchema.safeParse(withMode(jiraCfg, mode)).success, true, mode);
    assert.equal(resolveStatusTransitions(withMode(adoCfg, mode)), mode);
  }
  assert.equal(OttoConfigSchema.safeParse(withMode(jiraCfg, "sometimes")).success, false);
  assert.equal(resolveStatusTransitions(jiraCfg), "auto");
});

for (const [name, cfg] of [["JIRA", jiraCfg], ["ADO", adoCfg]]) {
  test(`${name}: explicit auto renders identically to no workflow block`, () => {
    for (const key of TRANSITIONING) {
      assert.equal(renderPrompt(key, withMode(cfg, "auto")), renderPrompt(key, cfg), key);
      assert.ok(!renderPrompt(key, cfg).includes("Status transition policy"), `${key} leaks the policy in auto mode`);
    }
  });

  for (const mode of ["confirm", "off"]) {
    test(`${name}/${mode}: transitioning templates render cleanly and carry the policy`, () => {
      for (const key of TRANSITIONING) {
        const out = renderPrompt(key, withMode(cfg, mode));
        const unresolved = out.match(/\{\{[^}]+\}\}/g) || [];
        assert.deepEqual(unresolved, [], `${key} has unresolved handlebars: ${unresolved}`);
      }
      for (const key of ["refine-story", "design", "build", "test-execute"]) {
        const out = renderPrompt(key, withMode(cfg, mode));
        assert.ok(out.includes(`Status transition policy — ${mode}`), `${key} is missing the ${mode} policy block`);
        assert.ok(out.includes("Status changes to make manually"), `${key} must hand skipped transitions to the user`);
      }
    });
  }

  test(`${name}/confirm: asks before each status change, separately from content approval`, () => {
    const policy = renderPrompt("refine-story", withMode(cfg, "confirm"));
    assert.match(policy, /wait for an explicit \*\*yes\*\* for that item/);
    assert.match(policy, /is \*\*not\*\* approval of a status change/);
    assert.match(policy, /Move \{STORY-KEY\} from '\{current status\}' to 'Ready for Design'\? \(yes \/ no\)/);
    assert.match(renderPrompt("design", withMode(cfg, "confirm")), /Move \{STORY-KEY\} from '\{current status\}' to 'Ready for Build'/);
    assert.match(renderPrompt("test-execute", withMode(cfg, "confirm")), /Move \{STORY-KEY\} from 'Ready for Test' to 'Done'/);
    assert.match(renderPrompt("build", withMode(cfg, "confirm")), /sub-task to \*\*In Progress\*\*[^\n]*ask first/);
  });

  test(`${name}/off: forbids status-changing calls and never deletes notes on transition`, () => {
    const tool = name === "ADO" ? "`update_work_item` setting `System.State`" : "`transitionJiraIssue`";
    for (const key of ["refine-story", "design", "build", "test-execute"]) {
      const out = renderPrompt(key, withMode(cfg, "off"));
      assert.ok(out.includes(`never call ${tool}`), `${key} must forbid ${tool}`);
    }
    const refine = renderPrompt("refine-story", withMode(cfg, "off"));
    assert.ok(refine.includes("**Do not change the status**"));
    assert.ok(refine.includes("**Confirm the AC update succeeded**"), "notes deletion must key off the AC push, not a transition");
    assert.ok(!refine.includes("**Confirm the transition succeeded**"));
  });
}

test("LOCAL: status-transition mode has no effect", () => {
  for (const key of TRANSITIONING) {
    assert.equal(renderPrompt(key, withMode(localCfg, "off")), renderPrompt(key, localCfg), key);
  }
});

test("/init: statusTransitions is asked for JIRA/ADO only and persisted only when non-default", () => {
  const q = QUESTIONS.find((x) => x.id === "statusTransitions");
  assert.ok(q, "statusTransitions question missing");
  assert.equal(q.default, "auto");
  assert.equal(q.when({ pmTool: "JIRA" }), true);
  assert.equal(q.when({ pmTool: "ADO" }), true);
  assert.equal(q.when({ pmTool: "LOCAL" }), false);

  const answers = {
    projectName: "Demo", pmTool: "ADO", jiraKey: "", jiraSite: "", jiraEmail: "",
    adoOrganization: "https://dev.azure.com/o", adoProject: "P", localKeyPrefix: "",
    phases: ["refine"], sprintLengthWeeks: 2, estimationApproach: "ta-assigns",
    orgSandbox: "uat", apexCoverageThreshold: 85, revenueCloudEnabled: false,
  };
  assert.equal(buildOttoConfig({ ...answers, statusTransitions: "auto" }).workflow, undefined);
  const confirmCfg = buildOttoConfig({ ...answers, statusTransitions: "confirm" });
  assert.deepEqual(confirmCfg.workflow, { statusTransitions: "confirm" });
  assert.equal(OttoConfigSchema.safeParse(confirmCfg).success, true);
  assert.equal(buildOttoConfig({ ...answers, pmTool: "LOCAL", statusTransitions: "off" }).workflow, undefined);
  assert.equal(resolveExistingAnswer("statusTransitions", confirmCfg), "confirm");
  assert.equal(resolveExistingAnswer("statusTransitions", jiraCfg), "auto");
});
