import { runCli } from "./run.ts";

process.exit(runCli("agent-bridge", process.argv.slice(2)));
