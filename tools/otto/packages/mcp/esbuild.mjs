import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/server.js",
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  minify: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  define: {
    // Usage-tracking endpoint (a SAS URL — the credential itself). Same secret
    // as packages/vscode/esbuild.mjs, already present in the release
    // workflow's "Build packages" step env. Never committed; local/dev builds
    // compile in "" (tracking disabled). See src/usage.ts for the consuming
    // code and src/global.d.ts for the ambient declaration that keeps
    // `tsc --noEmit` happy without esbuild.
    __USAGE_ENDPOINT_URL__: JSON.stringify(process.env.OTTO_USAGE_ENDPOINT ?? ""),
  },
});

if (watch) {
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("Build complete.");
}
