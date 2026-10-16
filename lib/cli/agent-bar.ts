import { runCli } from "./run.ts";

process.exit(runCli("agent-bar", process.argv.slice(2)));
