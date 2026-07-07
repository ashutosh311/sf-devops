import esbuild from "esbuild";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const watch = process.argv.includes("--watch");

// mupdf is a WASM package that locates its .wasm via import.meta.url. Bundling
// would break that lookup, so we keep it external and copy its dist files into
// dist/vendor/mupdf, then load them at runtime by absolute path.
function vendorMupdf() {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("mupdf");
  const srcDir = path.dirname(entry);
  const destDir = path.resolve("dist/vendor/mupdf");
  mkdirSync(destDir, { recursive: true });
  for (const f of ["mupdf.js", "mupdf-wasm.js", "mupdf-wasm.wasm"]) {
    cpSync(path.join(srcDir, f), path.join(destDir, f));
  }
  // mupdf.js is ESM; mark the vendored folder so Node loads it as a module
  // (avoids the "reparsing as ES module" runtime warning/overhead).
  writeFileSync(path.join(destDir, "package.json"), '{"type":"module"}\n');
  console.log("Vendored mupdf ->", destDir);
}

const ctx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode", "mupdf"], // vscode: host-provided; mupdf: WASM, vendored separately
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  minify: false,
});

if (watch) {
  vendorMupdf();
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  vendorMupdf();
  console.log("Build complete.");
}
