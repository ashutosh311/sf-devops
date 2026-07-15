import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import AdmZip from "adm-zip";
import {
  DEFAULT_CACHE_DIR,
  readSyncMetadata,
  writeSyncMetadata,
  validateCacheManifest,
  type CacheManifest,
  type SyncMetadata,
} from "@sdlc/core";
import { getGitHubToken, githubGet, downloadAsset, type GitHubRelease } from "./github";

const INSTRUCTIONS_OWNER = "Slalom";
const INSTRUCTIONS_REPO  = "salesforce-devops";
const INSTRUCTIONS_ASSET_NAME = "instructions.zip";
const VSIX_ASSET_PREFIX = "slalom-sdlc-";
const VSIX_ASSET_SUFFIX = ".vsix";

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface SyncStatus {
  activeVersion: string | null;
  lastSuccessfulSync: string | null;
  lastCheck: string | null;
  lastError: string | null;
  usingCache: boolean;
}

/** A release that ships a real `.vsix` extension build, as opposed to an
 *  instructions-only release. Consumed by extensionUpdate.ts and the /about command. */
export interface LatestExtensionRelease {
  tag: string;
  htmlUrl: string;
  vsixAsset: { name: string; url: string; size: number; digest: string | null };
}

// Read via getLatestKnownRelease() below. Written opportunistically inside runSync() —
// piggybacks on the release object the daily instruction sync already fetches, so
// checking for a newer extension build costs zero extra GitHub API calls.
const LATEST_RELEASE_INFO_KEY = "slalom-sdlc.latestKnownRelease.info";

export class InstructionSyncService {
  private readonly cacheDir = DEFAULT_CACHE_DIR;
  private readonly currentDir = path.join(this.cacheDir, "current");

  async syncIfDue(_context: vscode.ExtensionContext): Promise<void> {
    const meta = readSyncMetadata(this.currentDir);
    if (meta.lastCheck) {
      const elapsed = Date.now() - new Date(meta.lastCheck).getTime();
      if (elapsed < SYNC_INTERVAL_MS) return;
    }
    // Background sync is always silent — never interrupts the user with an auth prompt
    await this.runSync(_context, meta, { interactive: false });
  }

  async forceSync(context: vscode.ExtensionContext): Promise<void> {
    const meta = readSyncMetadata(this.currentDir);
    // User explicitly asked to sync — allow an interactive GitHub sign-in prompt
    await this.runSync(context, meta, { interactive: true });
  }

  getStatus(): SyncStatus {
    const meta = readSyncMetadata(this.currentDir);
    const usingCache = fs.existsSync(this.currentDir) && validateCacheManifest(this.currentDir);
    return { ...meta, usingCache };
  }

  /** Most recent GitHub release the daily sync has observed that ships a `.vsix` — i.e. a
   *  real extension build. Null until a sync has observed one. */
  getLatestKnownRelease(context: vscode.ExtensionContext): LatestExtensionRelease | null {
    return context.globalState.get<LatestExtensionRelease>(LATEST_RELEASE_INFO_KEY) ?? null;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async runSync(
    context: vscode.ExtensionContext,
    meta: SyncMetadata,
    opts: { interactive: boolean }
  ): Promise<void> {
    const now = new Date().toISOString();
    const updatedMeta: SyncMetadata = { ...meta, lastCheck: now, lastError: null };

    try {
      const token = await getGitHubToken(context, opts.interactive);
      if (!token) {
        updatedMeta.lastError = "No GitHub token available. Sign in to GitHub in VS Code or set SLALOM_SDLC_GITHUB_TOKEN.";
        writeSyncMetadata(this.currentDir, updatedMeta);
        return;
      }

      const release = await this.fetchLatestRelease(token);

      // Record this regardless of how the instructions sync itself turns out — a release
      // that ships a .vsix means a real extension build exists, which is exactly what the
      // update nudge/self-updater needs to know about.
      const vsixAsset = release.assets.find(
        (a) => a.name.startsWith(VSIX_ASSET_PREFIX) && a.name.endsWith(VSIX_ASSET_SUFFIX)
      );
      if (vsixAsset) {
        const info: LatestExtensionRelease = {
          tag: release.tag_name,
          htmlUrl: release.html_url,
          vsixAsset: {
            name: vsixAsset.name,
            url: vsixAsset.url,
            size: vsixAsset.size,
            digest: vsixAsset.digest,
          },
        };
        await context.globalState.update(LATEST_RELEASE_INFO_KEY, info);
      }

      const asset = release.assets.find((a) => a.name === INSTRUCTIONS_ASSET_NAME);
      if (!asset) {
        updatedMeta.lastError = `Release ${release.tag_name} has no asset named "${INSTRUCTIONS_ASSET_NAME}".`;
        writeSyncMetadata(this.currentDir, updatedMeta);
        return;
      }

      // Skip download if already on this version
      if (meta.activeVersion === release.tag_name && validateCacheManifest(this.currentDir)) {
        updatedMeta.lastSuccessfulSync = meta.lastSuccessfulSync;
        updatedMeta.activeVersion = release.tag_name;
        writeSyncMetadata(this.currentDir, updatedMeta);
        return;
      }

      const zipBuffer = await downloadAsset(asset.url, token);
      const stagingDir = path.join(this.cacheDir, `pending-${Date.now()}`);
      this.extractAndValidate(zipBuffer, stagingDir);
      this.atomicSwap(stagingDir);

      updatedMeta.lastSuccessfulSync = now;
      updatedMeta.activeVersion = release.tag_name;
      writeSyncMetadata(this.currentDir, updatedMeta);
    } catch (err) {
      updatedMeta.lastError = String(err);
      writeSyncMetadata(this.currentDir, updatedMeta);
    }
  }

  private fetchLatestRelease(token: string): Promise<GitHubRelease> {
    return githubGet<GitHubRelease>(
      `/repos/${INSTRUCTIONS_OWNER}/${INSTRUCTIONS_REPO}/releases/latest`,
      token
    );
  }

  private extractAndValidate(zipBuffer: Buffer, stagingDir: string): void {
    fs.mkdirSync(stagingDir, { recursive: true });

    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(stagingDir, true);

    // Read and validate manifest
    const manifestPath = path.join(stagingDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      throw new Error("Downloaded zip is missing manifest.json");
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as CacheManifest;
    if (!manifest.schemaVersion || !manifest.version || !manifest.files) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      throw new Error("manifest.json has unexpected schema");
    }

    for (const [filename, entry] of Object.entries(manifest.files)) {
      const filePath = path.join(stagingDir, filename);
      if (!fs.existsSync(filePath)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        throw new Error(`manifest.json references missing file: ${filename}`);
      }
      const content = fs.readFileSync(filePath);
      if (content.length !== entry.size) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        throw new Error(`Checksum size mismatch for ${filename}`);
      }
      const digest = "sha256:" + crypto.createHash("sha256").update(content).digest("hex");
      if (digest !== entry.checksum) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        throw new Error(`Checksum mismatch for ${filename}`);
      }
    }
  }

  private atomicSwap(stagingDir: string): void {
    const oldDir = this.currentDir + ".old";

    // Remove any previous old dir
    if (fs.existsSync(oldDir)) {
      fs.rmSync(oldDir, { recursive: true, force: true });
    }

    // Rotate: current → old, staging → current
    if (fs.existsSync(this.currentDir)) {
      fs.renameSync(this.currentDir, oldDir);
    }

    fs.renameSync(stagingDir, this.currentDir);

    // Clean up old dir
    if (fs.existsSync(oldDir)) {
      fs.rmSync(oldDir, { recursive: true, force: true });
    }
  }
}
