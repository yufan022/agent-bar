import * as esbuild from "esbuild";
import { chmodSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
};

const builds = [
  {
    ...shared,
    entryPoints: ["electron/main.ts"],
    format: "esm",
    outfile: "dist-electron/main.js",
  },
  {
    ...shared,
    entryPoints: ["electron/preload.ts"],
    format: "cjs",
    outfile: "dist-electron/preload.cjs",
  },
  {
    ...shared,
    entryPoints: ["lib/cli/agent-bridge.ts"],
    format: "esm",
    outfile: "dist-electron/cli/agent-bridge.js",
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    ...shared,
    entryPoints: ["lib/cli/agent-bar.ts"],
    format: "esm",
    outfile: "dist-electron/cli/agent-bar.js",
    banner: { js: "#!/usr/bin/env node" },
  },
];

mkdirSync("dist-electron/cli", { recursive: true });

if (watch) {
  const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((context) => context.watch()));
  chmodCli();
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
  chmodCli();
}

function chmodCli() {
  chmodSync("dist-electron/cli/agent-bridge.js", 0o755);
  chmodSync("dist-electron/cli/agent-bar.js", 0o755);
}
