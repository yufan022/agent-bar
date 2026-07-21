//! agent-bridge CLI: sync AI coding agent global configs.

use std::path::PathBuf;
use std::process::ExitCode;

use agent_bridge::BridgeCommands;
use clap::Parser;

#[derive(Debug, Parser)]
#[command(
    name = "agent-bridge",
    version,
    about = "Sync instructions, skills, and MCP configs across Claude Code, Codex, OpenCode, and Cursor (user-global)"
)]
struct Cli {
    #[command(subcommand)]
    command: BridgeCommands,

    /// Override home directory (for testing)
    #[arg(long, global = true, value_name = "DIR", hide = true)]
    home: Option<PathBuf>,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match agent_bridge::run_bridge(cli.command, cli.home) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
