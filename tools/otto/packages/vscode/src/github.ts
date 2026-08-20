import * as vscode from "vscode";
import * as https from "node:https";

// Shared GitHub REST helpers used by both the daily instruction sync
// (sync.ts) and the extension self-update check (extensionUpdate.ts) —
// kept in one place so token resolution, redirect handling, and API
// error handling only need to be gotten right once.

export interface GitHubReleaseAsset {
  id: number;
  name: string;
  /** GitHub API asset URL — requires Accept: application/octet-stream + auth to download. */
  url: string;
  size: number;
  /** e.g. "sha256:abcd..." — present on all release assets, used to verify downloads. */
  digest: string | null;
}

export interface GitHubRelease {
  tag_name: string;
  published_at: string;
  html_url: string;
  assets: GitHubReleaseAsset[];
}

export async function getGitHubToken(
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
    process.env.OTTO_GITHUB_TOKEN ??
    process.env.SLALOM_SDLC_GITHUB_TOKEN ??
    process.env.GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    null
  );
}

export function downloadAsset(assetApiUrl: string, token: string): Promise<Buffer> {
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

export function githubGet<T>(apiPath: string, token: string): Promise<T> {
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

