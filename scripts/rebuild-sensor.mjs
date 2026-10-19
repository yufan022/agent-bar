import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebuild } from "@electron/rebuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));

if (process.platform !== "darwin" || process.arch !== "arm64") {
  process.exit(0);
}

if (!existsSync(path.join(root, "node_modules/macos-temperature-sensor"))) {
  process.exit(0);
}

const electronVersion = require("electron/package.json").version;

await rebuild({
  buildPath: root,
  electronVersion,
  onlyModules: ["macos-temperature-sensor"],
  force: true,
});
