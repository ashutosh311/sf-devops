import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { BacklogData, BacklogEpic, BacklogFeature, BacklogStory } from "./backlog";

// ── Manifest ────────────────────────────────────────────────────────────────
//
// A small machine-readable registry that makes backlog generation ID-stable and
// BAU-safe. It records every epic/feature/story id, its display name, and its
// PM tool key once pushed, plus a checksum of the workbook so we can detect edits.

export interface ManifestItem {
  id: string;
  name?: string;
  epicId?: string;
  /** PM tool key (JIRA: e.g. PROJ-123; ADO: e.g. #1234). Previously called jiraKey — old manifests are auto-migrated on read. */
  pmKey?: string;
  /** @deprecated use pmKey. Present in manifests written before ADO support was added. */
  jiraKey?: string;
  sourceSession?: string;
  disregarded?: boolean;
}

export interface BacklogManifest {
  project?: string;
  updatedAt?: string;
  pushedAt?: string;
  workbookChecksum?: string;
  /** Count of pushed+disregarded items when the pending xlsx was last written.
   *  Used to detect when the manifest has been updated externally (e.g. after push-backlog)
   *  without the xlsx having been touched, so manage-backlog can auto-refresh the view. */
  workbookExcludedCount?: number;
  sessions?: string[];
  epics: ManifestItem[];
  features: ManifestItem[];
  stories: ManifestItem[];
}

const MANIFEST_FILE = "_manifest.json";
const INDEX_FILE = "_index.md";
const OPEN_QUESTIONS_FILE = "open-questions.md";
const EPICS_DIR = "epics";
const DELTAS_DIR = "deltas";

export function manifestPath(backlogDir: string): string {
  return path.join(backlogDir, MANIFEST_FILE);
}

export function readManifest(backlogDir: string): BacklogManifest | undefined {
  const p = manifestPath(backlogDir);
  if (!fs.existsSync(p)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as BacklogManifest;
    parsed.epics ??= [];
    parsed.features ??= [];
    parsed.stories ??= [];
    // Backward compat: migrate jiraKey → pmKey for manifests written before ADO support.
    const migrateItem = (m: ManifestItem): ManifestItem => {
      if (m.jiraKey && !m.pmKey) { m.pmKey = m.jiraKey; delete m.jiraKey; }
      return m;
    };
    parsed.epics = parsed.epics.map(migrateItem);
    parsed.features = parsed.features.map(migrateItem);
    parsed.stories = parsed.stories.map(migrateItem);
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeManifest(backlogDir: string, manifest: BacklogManifest): void {
  fs.mkdirSync(backlogDir, { recursive: true });
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath(backlogDir), JSON.stringify(manifest, null, 2) + "\n");
}

/** Build a manifest from full backlog data, preserving PM keys and disregarded flags already on the items. */
export function manifestFromData(data: BacklogData, prev?: BacklogManifest): BacklogManifest {
  const prevItem = (list: ManifestItem[] | undefined, id?: string): ManifestItem | undefined =>
    list?.find((m) => m.id === id);
  /** Carry forward pushed OR disregarded items that are absent from the current workbook data. */
  const carryForwardExcluded = (current: ManifestItem[], previous?: ManifestItem[]): ManifestItem[] => {
    const seen = new Set(current.map((m) => m.id).filter(Boolean));
    const preserved = (previous ?? []).filter(
      (m) => !!m.id && !seen.has(m.id) && (!!m.pmKey || !!m.disregarded)
    );
    return [...current, ...preserved];
  };
  const epicsCurrent: ManifestItem[] = (data.epics ?? []).map((e) => {
    const p = prevItem(prev?.epics, e.id);
    return {
      id: e.id ?? "", name: e.name,
      pmKey: e.pm_key || p?.pmKey,
      disregarded: (e.disregarded || "").toUpperCase() === "Y" ? true : (p?.disregarded || undefined),
    };
  });
  const featuresCurrent: ManifestItem[] = (data.features ?? []).map((f) => {
    const p = prevItem(prev?.features, f.id);
    return {
      id: f.id ?? "", name: f.name, epicId: f.epic_id,
      pmKey: f.pm_key || p?.pmKey,
      disregarded: (f.disregarded || "").toUpperCase() === "Y" ? true : (p?.disregarded || undefined),
    };
  });
  const storiesCurrent: ManifestItem[] = (data.stories ?? []).map((s) => {
    const p = prevItem(prev?.stories, s.id);
    return {
      id: s.id ?? "", name: s.user_story?.slice(0, 60), epicId: s.epic_id,
      pmKey: s.pm_key || p?.pmKey,
      disregarded: (s.disregarded || "").toUpperCase() === "Y" ? true : (p?.disregarded || undefined),
    };
  });
  return {
    project: data.project,
    pushedAt: prev?.pushedAt,
    workbookChecksum: prev?.workbookChecksum,
    epics: carryForwardExcluded(epicsCurrent, prev?.epics),
    features: carryForwardExcluded(featuresCurrent, prev?.features),
    stories: carryForwardExcluded(storiesCurrent, prev?.stories),
  };
}

// ── ID management ─────────────────────────────────────────────────────────────

function maxSeq(ids: (string | undefined)[], prefix: string): number {
  let max = 0;
  const re = new RegExp(`^${prefix}-?(\\d+)$`, "i");
  for (const id of ids) {
    const m = id?.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

export interface IdCounters {
  epic: number;
  feature: number;
  story: number;
}

/** Next-free sequence numbers so BAU deltas never collide with existing IDs.
 *  Pass the current manifest so that IDs deleted from the workbook are still
 *  counted — prevents reuse of a deleted item's ID for an unrelated new item. */
export function nextCounters(data: BacklogData, manifest?: BacklogManifest): IdCounters {
  const epicIds  = [...(data.epics    ?? []).map((e) => e.id), ...(manifest?.epics    ?? []).map((e) => e.id)];
  const featIds  = [...(data.features ?? []).map((f) => f.id), ...(manifest?.features ?? []).map((f) => f.id)];
  const storyIds = [...(data.stories  ?? []).map((s) => s.id), ...(manifest?.stories  ?? []).map((s) => s.id)];
  return {
    epic:    maxSeq(epicIds,   "EPIC"),
    feature: maxSeq(featIds,   "FEAT"),
    story:   maxSeq(storyIds,  "STORY"),
  };
}

export function formatEpicId(n: number): string {
  return `EPIC-${String(n).padStart(2, "0")}`;
}
export function formatFeatureId(n: number): string {
  return `FEAT-${String(n).padStart(2, "0")}`;
}
export function formatStoryId(n: number): string {
  return `STORY-${String(n).padStart(3, "0")}`;
}

// ── Checksums ─────────────────────────────────────────────────────────────────

export function fileChecksum(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
  } catch {
    return undefined;
  }
}

// ── Markdown rendering (split: index + per-epic + open questions) ───────────────

function sanitiseFilePart(s: string): string {
  return s.replace(/[^A-Za-z0-9 &().,_-]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function epicFileName(epic: BacklogEpic): string {
  const name = sanitiseFilePart(epic.name || "Epic");
  return `${epic.id || "EPIC"} - ${name}.md`;
}

function mdField(label: string, value?: string): string {
  const v = (value || "").trim();
  return v ? `**${label}:** ${v}\n\n` : "";
}

function renderStory(s: BacklogStory): string {
  let out = `#### ${s.id ?? ""} — ${s.user_story || "(user story)"}\n\n`;
  if (s.pm_key) out += `**PM Key:** ${s.pm_key}\n\n`;
  out += mdField("Acceptance Criteria", s.acceptance_criteria);
  out += mdField("Functional Requirements", s.functional_requirements);
  out += mdField("Solution Notes", s.solution_notes);
  out += mdField("Use Case Labels", s.use_case_labels);
  out += mdField("Size", s.size);
  out += mdField("Status", s.status);
  if (s.feature_id) out += mdField("Feature", `${s.feature_id}${s.feature_name ? ` — ${s.feature_name}` : ""}`);
  return out.trimEnd() + "\n";
}

function renderFeature(f: BacklogFeature): string {
  let out = `### ${f.id ?? ""} — ${f.name || "(feature)"}\n\n`;
  if (f.pm_key) out += `**PM Key:** ${f.pm_key}\n\n`;
  out += mdField("Description", f.description);
  out += mdField("System Components", f.system_components);
  out += mdField("Dependencies", f.dependencies);
  out += mdField("Priority", f.priority);
  out += mdField("Complexity", f.complexity);
  out += mdField("Implementation Boundary", f.implementation_boundary);
  out += mdField("Status", f.status);
  return out.trimEnd() + "\n";
}

function renderEpicFile(
  epic: BacklogEpic,
  features: BacklogFeature[],
  stories: BacklogStory[]
): string {
  let out = `# ${epic.id ?? ""} — ${epic.name || "(epic)"}\n\n`;
  if (epic.pm_key) out += `**PM Key:** ${epic.pm_key}\n\n`;
  out += mdField("Narrative Goal", epic.narrative_goal);
  out += mdField("Business Outcome", epic.business_outcome);
  out += mdField("Solution Notes", epic.solution_notes);
  out += mdField("Priority", epic.priority);
  out += mdField("Demo Narrative Slice", epic.demo_slice);
  out += mdField("Requirement IDs", epic.requirement_ids);
  out += mdField("Pain Points Addressed", epic.pain_points);
  out += mdField("Stakeholder Groups", epic.stakeholder_groups);
  out += mdField("Status", epic.status);

  if (features.length) {
    out += `\n## Features\n\n`;
    out += features.map(renderFeature).join("\n");
  }
  if (stories.length) {
    out += `\n## Stories\n\n`;
    out += stories.map(renderStory).join("\n");
  }
  return out.trimEnd() + "\n";
}

function renderIndex(data: BacklogData): string {
  const epics = data.epics ?? [];
  const stories = data.stories ?? [];
  const features = data.features ?? [];
  let out = `# Backlog Index\n\n`;
  out += `_Machine-maintained. Source of truth for the local backlog until pushed to the PM tool. `;
  out += `Each epic has its own file under \`epics/\`._\n\n`;
  out += `**Totals:** ${epics.length} epics · ${features.length} features · ${stories.length} stories\n\n`;
  out += `| Epic | Name | Priority | Stories | PM Key | File |\n`;
  out += `| --- | --- | --- | --- | --- | --- |\n`;
  for (const e of epics) {
    const count = stories.filter((s) => s.epic_id === e.id).length;
    const file = `${EPICS_DIR}/${epicFileName(e)}`;
    const nm = (e.name || "").replace(/\|/g, "\\|");
    out += `| ${e.id ?? ""} | ${nm} | ${e.priority ?? ""} | ${count} | ${e.pm_key ?? ""} | [${file}](${encodeURI(file)}) |\n`;
  }
  return out;
}

function renderOpenQuestions(data: BacklogData): string {
  const qs = data.open_questions ?? [];
  let out = `# Open Questions\n\n`;
  if (!qs.length) return out + "_None recorded._\n";
  out += `| ID | Question | Owner | Status | Priority | Source |\n`;
  out += `| --- | --- | --- | --- | --- | --- |\n`;
  for (const q of qs) {
    const question = (q.question || "").replace(/\|/g, "\\|");
    out += `| ${q.id ?? ""} | ${question} | ${q.owner ?? ""} | ${q.status ?? "Open"} | ${q.priority ?? ""} | ${q.source ?? ""} |\n`;
  }
  return out;
}

export interface WriteMarkdownResult {
  files: string[];
  epicFiles: string[];
}

/**
 * Render the full backlog into split markdown files under `backlogDir`:
 * `_index.md`, `epics/<EPIC-ID> - <name>.md`, and `open-questions.md`.
 * Stale per-epic files (epics that no longer exist) are removed so the folder
 * always mirrors the current data — existing epics are always overwritten with
 * current content, so callers must pass MERGED data in BAU mode (never a delta).
 */
export function writeBacklogMarkdown(backlogDir: string, data: BacklogData): WriteMarkdownResult {
  fs.mkdirSync(backlogDir, { recursive: true });
  const epicsDir = path.join(backlogDir, EPICS_DIR);
  fs.mkdirSync(epicsDir, { recursive: true });

  const files: string[] = [];
  const epicFiles: string[] = [];

  // Index + open questions.
  fs.writeFileSync(path.join(backlogDir, INDEX_FILE), renderIndex(data));
  files.push(INDEX_FILE);
  fs.writeFileSync(path.join(backlogDir, OPEN_QUESTIONS_FILE), renderOpenQuestions(data));
  files.push(OPEN_QUESTIONS_FILE);

  // Per-epic files.
  const wanted = new Set<string>();
  for (const epic of data.epics ?? []) {
    const feats = (data.features ?? []).filter((f) => f.epic_id === epic.id);
    const stories = (data.stories ?? []).filter((s) => s.epic_id === epic.id);
    const fname = epicFileName(epic);
    wanted.add(fname);
    fs.writeFileSync(path.join(epicsDir, fname), renderEpicFile(epic, feats, stories));
    epicFiles.push(`${EPICS_DIR}/${fname}`);
  }

  // Prune stale epic files.
  for (const existing of fs.existsSync(epicsDir) ? fs.readdirSync(epicsDir) : []) {
    if (existing.endsWith(".md") && !wanted.has(existing)) {
      try {
        fs.unlinkSync(path.join(epicsDir, existing));
      } catch {
        /* ignore */
      }
    }
  }

  return { files, epicFiles };
}

/** Write a dated delta note summarising the items a BAU session added. */
export function writeDeltaNote(
  backlogDir: string,
  sessionTitle: string,
  dateStamp: string,
  added: { epics: BacklogEpic[]; features: BacklogFeature[]; stories: BacklogStory[] }
): string {
  const deltasDir = path.join(backlogDir, DELTAS_DIR);
  fs.mkdirSync(deltasDir, { recursive: true });
  let out = `# Backlog delta — ${sessionTitle}\n\n_Added ${dateStamp}._\n\n`;
  if (added.epics.length) {
    out += `## New epics\n\n`;
    for (const e of added.epics) out += `- ${e.id} — ${e.name}\n`;
    out += `\n`;
  }
  if (added.stories.length) {
    out += `## New stories\n\n`;
    for (const s of added.stories) out += `- ${s.id} (${s.epic_id}) — ${s.user_story}\n`;
    out += `\n`;
  }
  if (!added.epics.length && !added.stories.length) out += `_No new items were extracted from this session._\n`;
  const fname = `${dateStamp} - ${sanitiseFilePart(sessionTitle)}.md`;
  fs.writeFileSync(path.join(deltasDir, fname), out);
  return `${DELTAS_DIR}/${fname}`;
}
