//! Core library for agent-bridge: sync instructions, skills, and MCP configs
//! across Claude Code, Codex, OpenCode, Cursor, Pi, and OMP (user-global scope).
//!
//! Instructions and skills are synced via symlinks to the source's canonical
//! path. Cursor does not support file-based instruction sync (User Rules have
//! no stable file API), so only skills and MCP are synced for that tool.

pub mod adapters;
pub mod error;
pub mod fsutil;
pub mod instructions;
pub mod mcp;
pub mod paths;
pub mod report;
pub mod skills;
pub mod symlink;
pub mod sync;
pub mod tool;

pub use adapters::ToolAdapter;
pub use error::{Error, Result};
pub use paths::ToolPaths;
pub use report::{
    DetailsInstructions, DetailsReport, DiffChange, DiffReport, InstructionsDiff,
    InstructionsStatus, NamedDiff, PathPresence, RenderText, SkillInfo, StatusReport, SyncCategory,
    SyncLine, SyncLineStatus, SyncReport, SyncTargetReport, ToolStatus,
};
pub use sync::{details, diff, status, sync, SyncOptions};
pub use tool::{SyncKinds, ToolId, WriteMode};
