//! Structured reports for status / list / diff / sync.
//!
//! Core APIs return these types. CLI renders via [`RenderText`]; UI serializes them.

use std::fmt::Write as _;

use serde::Serialize;

/// Trait for CLI-friendly text rendering of structured reports.
pub trait RenderText {
    fn render(&self) -> String;
}

// ── Status ──────────────────────────────────────────────────────────────────

/// Aggregate status for one or more tools.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusReport {
    pub tools: Vec<ToolStatus>,
}

/// Per-tool bridge readiness snapshot.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub tool: String,
    pub instructions: InstructionsStatus,
    pub skills_dir: PathPresence,
    pub mcp_config: PathPresence,
    pub skill_count: usize,
    pub mcp_server_count: usize,
}

/// Instructions file presence for a tool.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum InstructionsStatus {
    Unsupported,
    Missing {
        path: String,
    },
    Present {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        real_path: Option<String>,
        chars: usize,
    },
}

/// Whether a configured path exists on disk.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathPresence {
    pub path: String,
    pub exists: bool,
}

impl RenderText for StatusReport {
    fn render(&self) -> String {
        let mut out = String::new();
        for tool in &self.tools {
            let _ = writeln!(out, "{}", tool.render());
        }
        out
    }
}

impl ToolStatus {
    fn render(&self) -> String {
        let mut out = String::new();
        let instr_mark = match &self.instructions {
            InstructionsStatus::Unsupported => "n/a",
            InstructionsStatus::Missing { .. } => "no",
            InstructionsStatus::Present { .. } => "yes",
        };
        let _ = writeln!(
            out,
            "{}: instructions={} skills_dir={} mcp={}",
            self.tool,
            instr_mark,
            bool_mark(self.skills_dir.exists),
            bool_mark(self.mcp_config.exists)
        );
        match &self.instructions {
            InstructionsStatus::Unsupported => {
                let _ = writeln!(out, "  instructions: (unsupported)");
            }
            InstructionsStatus::Missing { path } => {
                let _ = writeln!(out, "  instructions: {path}");
            }
            InstructionsStatus::Present {
                path,
                real_path,
                chars,
            } => {
                let _ = writeln!(out, "  instructions: {path}");
                if let Some(real) = real_path {
                    let _ = writeln!(out, "  instructions_real: {real}");
                }
                let _ = writeln!(out, "  instructions_chars: {chars}");
            }
        }
        let _ = writeln!(out, "  skills:       {}", self.skills_dir.path);
        let _ = writeln!(out, "  mcp:          {}", self.mcp_config.path);
        let _ = writeln!(out, "  skill_count: {}", self.skill_count);
        let _ = writeln!(out, "  mcp_server_count: {}", self.mcp_server_count);
        out
    }
}

fn bool_mark(v: bool) -> &'static str {
    if v {
        "yes"
    } else {
        "no"
    }
}

// ── List ────────────────────────────────────────────────────────────────────

/// Skills / MCP / instructions inventory for one tool.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListReport {
    pub tool: String,
    pub skills: Vec<SkillInfo>,
    pub mcp_servers: Vec<String>,
    pub instructions: ListInstructions,
}

/// A discovered skill entry.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    pub path: String,
}

/// Instructions summary in a list report.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ListInstructions {
    Unsupported {
        path: String,
    },
    Missing {
        path: String,
    },
    Present {
        path: String,
        chars: usize,
    },
}

impl RenderText for ListReport {
    fn render(&self) -> String {
        let mut out = String::new();
        let _ = writeln!(out, "Tool: {}", self.tool);
        let _ = writeln!(out, "\nSkills:");
        if self.skills.is_empty() {
            let _ = writeln!(out, "  (none)");
        } else {
            for s in &self.skills {
                let _ = writeln!(out, "  - {} ({})", s.name, s.path);
            }
        }
        let _ = writeln!(out, "\nMCP servers:");
        if self.mcp_servers.is_empty() {
            let _ = writeln!(out, "  (none)");
        } else {
            for name in &self.mcp_servers {
                let _ = writeln!(out, "  - {name}");
            }
        }
        match &self.instructions {
            ListInstructions::Unsupported { path } => {
                let _ = writeln!(out, "\nInstructions: {path}");
                let _ = writeln!(out, "  unsupported (no stable file API)");
            }
            ListInstructions::Missing { path } => {
                let _ = writeln!(out, "\nInstructions: {path}");
                let _ = writeln!(out, "  missing");
            }
            ListInstructions::Present { path, chars } => {
                let _ = writeln!(out, "\nInstructions: {path}");
                let _ = writeln!(out, "  present ({chars} chars)");
            }
        }
        out
    }
}

// ── Diff ────────────────────────────────────────────────────────────────────

/// How a named resource differs between two tools.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffChange {
    Added,
    Removed,
    Same,
    Changed,
}

impl DiffChange {
    pub fn mark(self) -> &'static str {
        match self {
            DiffChange::Added => "+",
            DiffChange::Removed => "-",
            DiffChange::Same => "=",
            DiffChange::Changed => "~",
        }
    }
}

/// A named skill or MCP server diff entry.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedDiff {
    pub name: String,
    pub change: DiffChange,
}

/// Instructions section of a diff.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum InstructionsDiff {
    Skipped {
        reason: String,
    },
    Compared {
        identical: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        from_path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        to_path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        from_real: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        to_real: Option<String>,
        /// Human-readable comparison (paths + optional unified diff).
        summary: String,
    },
}

/// Diff between two tools.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffReport {
    pub from: String,
    pub to: String,
    pub instructions: InstructionsDiff,
    pub skills: Vec<NamedDiff>,
    pub mcp: Vec<NamedDiff>,
}

impl RenderText for DiffReport {
    fn render(&self) -> String {
        let mut out = String::new();
        let _ = writeln!(out, "## Instructions");
        match &self.instructions {
            InstructionsDiff::Skipped { reason } => {
                let _ = writeln!(out, "({reason})");
            }
            InstructionsDiff::Compared { summary, .. } => {
                out.push_str(summary);
                if !summary.ends_with('\n') {
                    out.push('\n');
                }
            }
        }

        let _ = writeln!(out, "\n## Skills");
        if self.skills.is_empty() {
            let _ = writeln!(out, "(none)");
        } else {
            for entry in &self.skills {
                let _ = writeln!(out, "{} {}", entry.change.mark(), entry.name);
            }
        }

        let _ = writeln!(out, "\n## MCP");
        if self.mcp.is_empty() {
            let _ = writeln!(out, "(none)");
        } else {
            for entry in &self.mcp {
                let _ = writeln!(out, "{} {}", entry.change.mark(), entry.name);
            }
        }
        out
    }
}

// ── Sync ────────────────────────────────────────────────────────────────────

/// Severity / outcome of a sync line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncLineStatus {
    Info,
    Ok,
    Skip,
    Plan,
    Done,
    Error,
}

/// Resource category for a sync line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncCategory {
    Meta,
    Instructions,
    Skills,
    Mcp,
}

/// One structured sync log line (CLI + UI).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncLine {
    pub category: SyncCategory,
    pub status: SyncLineStatus,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_to: Option<String>,
    /// Nested detail (e.g. instructions comparison, mcp +/-/~ names).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub detail: Vec<String>,
}

impl SyncLine {
    pub fn meta(status: SyncLineStatus, message: impl Into<String>) -> Self {
        Self {
            category: SyncCategory::Meta,
            status,
            message: message.into(),
            name: None,
            path: None,
            link_to: None,
            detail: Vec::new(),
        }
    }

    pub fn item(
        category: SyncCategory,
        status: SyncLineStatus,
        message: impl Into<String>,
    ) -> Self {
        Self {
            category,
            status,
            message: message.into(),
            name: None,
            path: None,
            link_to: None,
            detail: Vec::new(),
        }
    }

    pub fn with_name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    pub fn with_link_to(mut self, link_to: impl Into<String>) -> Self {
        self.link_to = Some(link_to.into());
        self
    }

    pub fn with_detail(mut self, detail: Vec<String>) -> Self {
        self.detail = detail;
        self
    }
}

/// Sync result for one target tool.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTargetReport {
    pub tool: String,
    pub items: Vec<SyncLine>,
}

/// Full sync run report.
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub source_tool: String,
    pub source_home: String,
    pub dry_run: bool,
    pub notes: Vec<SyncLine>,
    pub targets: Vec<SyncTargetReport>,
    pub errors: Vec<String>,
}

impl SyncReport {
    pub fn success(&self) -> bool {
        self.errors.is_empty()
    }

    pub fn push_error(&mut self, message: impl Into<String>) {
        self.errors.push(message.into());
    }
}

impl RenderText for SyncReport {
    fn render(&self) -> String {
        let mut out = String::new();
        let _ = writeln!(
            out,
            "Source: {} ({})",
            self.source_tool, self.source_home
        );
        for note in &self.notes {
            render_sync_line(&mut out, note, 2);
        }
        for target in &self.targets {
            let _ = writeln!(out, "\nTarget: {}", target.tool);
            for item in &target.items {
                render_sync_line(&mut out, item, 2);
            }
        }
        if !self.errors.is_empty() {
            let _ = writeln!(out, "\nErrors:");
            for e in &self.errors {
                let _ = writeln!(out, "  - {e}");
            }
        }
        out
    }
}

fn render_sync_line(out: &mut String, line: &SyncLine, indent: usize) {
    let pad = " ".repeat(indent);
    let _ = writeln!(out, "{pad}{}", line.message);
    for d in &line.detail {
        let _ = writeln!(out, "{pad}  {d}");
    }
}
