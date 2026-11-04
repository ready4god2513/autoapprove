// Builds the extension into dist/. The same folder loads in Chrome, Firefox,
// and Safari.
//
//   node scripts/build.mjs           one-off build
//   node scripts/build.mjs --watch   rebuild TypeScript on change
//
// Each entry point is bundled into a standalone IIFE because content scripts
// are classic scripts, not ES modules. Files in static/ (manifest, HTML) are
// copied as-is; in watch mode, re-run the build after changing those.

import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("static", "dist", { recursive: true });

const ctx = await esbuild.context({
  entryPoints: ["src/background.ts", "src/content.ts", "src/options.ts"],
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: ["chrome121", "firefox142", "safari16"],
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
