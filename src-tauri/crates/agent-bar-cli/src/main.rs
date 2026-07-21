//! agent-bar CLI: bridge subcommands for syncing AI coding agent configs.

use std::path::PathBuf;
use std::process::ExitCode;

use agent_bridge::BridgeCommands;
use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(
    name = "agent-bar",
    version,
    about = "agent-bar CLI — use `bridge` to sync AI coding agent global configs"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Override home directory (for testing)
    #[arg(long, global = true, value_name = "DIR", hide = true)]
    home: Option<PathBuf>,
}

#[derive(Debug, Subcommand)]
enum Commands {
    /// Sync instructions, skills, and MCP across Claude / Codex / OpenCode / Cursor
    Bridge {
        #[command(subcommand)]
        command: BridgeCommands,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let home = cli.home;
    match cli.command {
        Commands::Bridge { command } => match agent_bridge::run_bridge(command, home) {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("error: {e}");
                ExitCode::FAILURE
            }
        },
    }
}
