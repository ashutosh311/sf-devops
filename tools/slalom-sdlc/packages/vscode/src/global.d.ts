// Ambient global injected at build time by esbuild's `define` (see esbuild.mjs).
// Declared here purely so `tsc --noEmit` (which never runs esbuild) type-checks
// cleanly. The real value only ever exists transiently inside the release
// workflow's build step — see src/usage.ts for the full explanation.
declare const __USAGE_ENDPOINT_URL__: string;
