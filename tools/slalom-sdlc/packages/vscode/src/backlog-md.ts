import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { BacklogData, BacklogEpic, BacklogFeature, BacklogStory } from "./backlog";

// ── Manifest ────────────────────────────────────────────────────────────────
//
// A small machine-readable registry that makes backlog generation ID-stable and
// BAU-safe. It records every epic/feature/story id, its display name, and its
// JIRA key once pushed, plus a checksum of the workbook so we can detect edits.

export interface ManifestItem {
  id: string;
  name?: string;
  epicId?: string;
  jiraKey?: string;
  sourceSession?: string;
}

export interface BacklogManifest {
  project?: string;
  updatedAt?: string;
  pushedAt?: string;
  workbookChecksum?: string;
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

/** Build a manifest from full backlog data, preserving JIRA keys already on the items. */
export function manifestFromData(data: BacklogData, prev?: BacklogManifest): BacklogManifest {
  const prevKey = (list: ManifestItem[] | undefined, id?: string): string | undefined =>
    list?.find((m) => m.id === id)?.jiraKey || undefined;
  return {
    project: data.project,
    pushedAt: prev?.pushedAt,
    workbookChecksum: prev?.workbookChecksum,
    epics: (data.epics ?? []).map((e) => ({
      id: e.id ?? "", name: e.name, jiraKey: e.jira_key || prevKey(prev?.epics, e.id),
    })),
    features: (data.features ?? []).map((f) => ({
      id: f.id ?? "", name: f.name, epicId: f.epic_id, jiraKey: f.jira_key || prevKey(prev?.features, f.id),
    })),
    stories: (data.stories ?? []).map((s) => ({
      id: s.id ?? "", name: s.user_story?.slice(0, 60), epicId: s.epic_id,
      jiraKey: s.jira_key || prevKey(prev?.stories, s.id),
    })),
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
  if (s.jira_key) out += `**JIRA:** ${s.jira_key}\n\n`;
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
  if (f.jira_key) out += `**JIRA:** ${f.jira_key}\n\n`;
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
  if (epic.jira_key) out += `**JIRA:** ${epic.jira_key}\n\n`;
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
  out += `_Machine-maintained. Source of truth for the local backlog until pushed to JIRA. `;
  out += `Each epic has its own file under \`epics/\`._\n\n`;
  out += `**Totals:** ${epics.length} epics · ${features.length} features · ${stories.length} stories\n\n`;
  out += `| Epic | Name | Priority | Stories | JIRA Key | File |\n`;
  out += `| --- | --- | --- | --- | --- | --- |\n`;
  for (const e of epics) {
    const count = stories.filter((s) => s.epic_id === e.id).length;
    const file = `${EPICS_DIR}/${epicFileName(e)}`;
    const nm = (e.name || "").replace(/\|/g, "\\|");
    out += `| ${e.id ?? ""} | ${nm} | ${e.priority ?? ""} | ${count} | ${e.jira_key ?? ""} | [${file}](${encodeURI(file)}) |\n`;
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
