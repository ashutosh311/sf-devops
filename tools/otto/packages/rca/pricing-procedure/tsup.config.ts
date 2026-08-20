import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: true,
  clean: true,
  // @xmldom/xmldom is a runtime dependency; bundle it so the MCP server's
  // esbuild step (which resolves this package) gets a self-contained module.
  noExternal: ["@xmldom/xmldom"],
});
