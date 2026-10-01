#!/usr/bin/env node
/**
 * Developer-only helper (not shipped): builds the impact-assessment deck from the compiled shell and
 * a findings register, so the deck can be opened and printed without running an assessment.
 *
 *   node scripts/preview-impact-deck.mjs [register.json] [out.html] [--pdf out.pdf]
 *
 * Defaults to the test fixture and ./impact-assessment.preview.html. --pdf prints the result with a
 * Chromium-family browser found on PATH or in a standard macOS/Windows/Linux location.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { releaseImpactDeckShell } = await import(pathToFileURL(resolve(here, "../packages/core/dist/index.js")).href);

const args = process.argv.slice(2);
const pdfIdx = args.indexOf("--pdf");
const pdfOut = pdfIdx !== -1 ? resolve(args.splice(pdfIdx, 2)[1]) : undefined;
const registerPath = resolve(args[0] ?? resolve(here, "../packages/core/test/fixtures/sample-findings.json"));
const htmlOut = resolve(args[1] ?? "impact-assessment.preview.html");

// The register is inserted as JSON; "</" is escaped so a string can never end the script block.
const json = JSON.stringify(JSON.parse(readFileSync(registerPath, "utf8")), null, 2).replace(/<\//g, "<\\/");
writeFileSync(htmlOut, releaseImpactDeckShell.replace("__FINDINGS_JSON__", () => json));
console.log(`wrote ${htmlOut}`);

if (pdfOut) {
  const candidates = [
    "google-chrome", "chromium", "chromium-browser", "microsoft-edge", "chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  const browser = candidates.find((c) => (c.includes("/") || c.includes("\\") ? existsSync(c) : which(c)));
  if (!browser) { console.error("no Chromium-family browser found; open the HTML and use Print → Save as PDF"); process.exit(1); }
  execFileSync(browser, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfOut}`, pathToFileURL(htmlOut).href], { stdio: "inherit" });
  console.log(`wrote ${pdfOut} using ${browser}`);
}

function which(cmd) {
  try { execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" }); return true; } catch { return false; }
}
