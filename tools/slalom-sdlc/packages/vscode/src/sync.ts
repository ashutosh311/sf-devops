import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import * as https from "node:https";
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

const INSTRUCTIONS_OWNER = "Slalom";
const INSTRUCTIONS_REPO  = "salesforce-devops";
const INSTRUCTIONS_ASSET_NAME = "instructions.zip";

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface SyncStatus {
  activeVersion: string | null;
  lastSuccessfulSync: string | null;
  lastCheck: string | null;
  lastError: string | null;
  usingCache: boolean;
}

interface GitHubRelease {
  tag_name: string;
  published_at: string;
  assets: Array<{ id: number; name: string; url: string }>;
}

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

  // ── Private ──────────────────────────────────────────────────────────────

  private async runSync(
    context: vscode.ExtensionContext,
    meta: SyncMetadata,
    opts: { interactive: boolean }
  ): Promise<void> {
    const now = new Date().toISOString();
    const updatedMeta: SyncMetadata = { ...meta, lastCheck: now, lastError: null };

    try {
      const token = await this.getGitHubToken(context, opts.interactive);
      if (!token) {
        updatedMeta.lastError = "No GitHub token available. Sign in to GitHub in VS Code or set SLALOM_SDLC_GITHUB_TOKEN.";
        writeSyncMetadata(this.currentDir, updatedMeta);
        return;
      }

      const release = await this.fetchLatestRelease(token);
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

      const zipBuffer = await this.downloadAsset(asset.url, token);
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

  private async getGitHubToken(
    context: vscode.ExtensionContext,
    interactive: boolean
  ): Promise<string | null> {
    // 1. VS Code GitHub auth session.
    //    - Background sync (silent): reuse an existing session only; never prompt.
    //    - Manual sync (interactive): allow VS Code to prompt the user to sign in / grant the
    //      `repo` scope once, so the Copilot login can be upgraded to read private releases.
    try {
      const session = await vscode.authentication.getSession(
        "github",
        ["repo"],
        interactive ? { createIfNone: true } : { silent: true }
      );
      if (session?.accessToken) return session.accessToken;
    } catch {
      // auth provider unavailable or user cancelled the prompt — fall through to env vars
    }

    // 2. Environment variable fallbacks for headless / non-VS Code usage
    return (
      process.env.SLALOM_SDLC_GITHUB_TOKEN ??
      process.env.GITHUB_TOKEN ??
      process.env.GH_TOKEN ??
      null
    );
  }

  private fetchLatestRelease(token: string): Promise<GitHubRelease> {
    return this.githubGet<GitHubRelease>(
      `/repos/${INSTRUCTIONS_OWNER}/${INSTRUCTIONS_REPO}/releases/latest`,
      token
    );
  }

  private downloadAsset(assetApiUrl: string, token: string): Promise<Buffer> {
    // GitHub asset download requires Accept: application/octet-stream + auth
    const url = new URL(assetApiUrl);
    return new Promise((resolve, reject) => {
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/octet-stream",
          "User-Agent": "slalom-sdlc-vscode",
        },
      };

      const follow = (redirectUrl: string) => {
        const rUrl = new URL(redirectUrl);
        https.get({ hostname: rUrl.hostname, path: rUrl.pathname + rUrl.search, headers: { "User-Agent": "slalom-sdlc-vscode" } }, collect);
      };

      const collect = (res: import("node:http").IncomingMessage) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          follow(res.headers.location!);
          res.resume();
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Asset download failed: HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      };

      https.get(options, collect).on("error", reject);
    });
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

  private githubGet<T>(apiPath: string, token: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: "api.github.com",
        path: apiPath,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "slalom-sdlc-vscode",
        },
      };

      https.get(options, (res) => {
        if (res.statusCode === 404) {
          reject(new Error(`GitHub API 404: ${apiPath}. Check repo name and token permissions.`));
          res.resume();
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API error: HTTP ${res.statusCode} for ${apiPath}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T);
          } catch (e) {
            reject(new Error(`Failed to parse GitHub API response: ${String(e)}`));
          }
        });
        res.on("error", reject);
      }).on("error", reject);
    });
  }
}
