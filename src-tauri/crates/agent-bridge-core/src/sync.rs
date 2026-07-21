//! Sync engine: copy/link resources from one tool to others.

use std::collections::BTreeSet;
use std::path::PathBuf;

use crate::adapters::ToolAdapter;
use crate::error::{Error, Result};
use crate::instructions;
use crate::mcp::{normalize_mcp_for_tool, sse_conversions_for_codex};
use crate::report::{
    DetailsInstructions, DetailsReport, DiffChange, DiffReport, InstructionsDiff, NamedDiff,
    SkillInfo, StatusReport, SyncCategory, SyncLine, SyncLineStatus, SyncReport,
    SyncTargetReport,
};
use crate::skills;
use crate::tool::{SyncKinds, ToolId, WriteMode};

/// Options for a sync run.
#[derive(Debug, Clone)]
pub struct SyncOptions {
    pub from: ToolId,
    pub to: Vec<ToolId>,
    pub kinds: SyncKinds,
    pub dry_run: bool,
    pub prune: bool,
    pub force: bool,
    /// Optional home override for tests.
    pub home: Option<PathBuf>,
}

fn adapter(tool: ToolId, home: &Option<PathBuf>) -> Result<ToolAdapter> {
    match home {
        Some(h) => Ok(ToolAdapter::in_home(tool, h)),
        None => ToolAdapter::new(tool),
    }
}

/// Run a sync according to `opts`.
pub fn sync(opts: &SyncOptions) -> Result<SyncReport> {
    if opts.to.is_empty() {
        return Err(Error::Message("at least one --to target is required".into()));
    }
    for t in &opts.to {
        if *t == opts.from {
            return Err(Error::SameSourceAndTarget(opts.from.to_string()));
        }
    }

    let source = adapter(opts.from, &opts.home)?;
    let mut report = SyncReport {
        source_tool: source.id().to_string(),
        source_home: source.paths().home.display().to_string(),
        dry_run: opts.dry_run,
        notes: Vec::new(),
        targets: Vec::new(),
        errors: Vec::new(),
    };

    let source_supports_instructions = source.supports_instructions();
    let source_instructions_path = if opts.kinds.instructions && source_supports_instructions {
        source.instructions_real_path()?
    } else {
        None
    };
    let skills = if opts.kinds.skills {
        source.list_skills()?
    } else {
        Vec::new()
    };
    let mcp = if opts.kinds.mcp {
        source.read_mcp()?
    } else {
        Default::default()
    };

    if opts.kinds.instructions {
        if !source_supports_instructions {
            report.notes.push(SyncLine::item(
                SyncCategory::Instructions,
                SyncLineStatus::Skip,
                format!(
                    "instructions: skipped ({} has no file-based instructions)",
                    source.id()
                ),
            ));
        } else {
            match &source_instructions_path {
                Some(path) => report.notes.push(
                    SyncLine::item(
                        SyncCategory::Instructions,
                        SyncLineStatus::Info,
                        format!("instructions source: {}", path.display()),
                    )
                    .with_path(path.display().to_string()),
                ),
                None => report.notes.push(SyncLine::item(
                    SyncCategory::Instructions,
                    SyncLineStatus::Skip,
                    "instructions: source file missing (skip links)",
                )),
            }
        }
    }
    if opts.kinds.skills {
        report.notes.push(SyncLine::item(
            SyncCategory::Skills,
            SyncLineStatus::Info,
            format!("read {} skill(s)", skills.len()),
        ));
    }
    if opts.kinds.mcp {
        report.notes.push(SyncLine::item(
            SyncCategory::Mcp,
            SyncLineStatus::Info,
            format!("read {} MCP server(s)", mcp.servers.len()),
        ));
    }

    let write_mode = if opts.prune {
        WriteMode::Prune
    } else {
        WriteMode::Safe
    };

    for target_id in &opts.to {
        let target = adapter(*target_id, &opts.home)?;
        let mut items = Vec::new();

        if opts.kinds.instructions {
            if !target.supports_instructions() {
                items.push(SyncLine::item(
                    SyncCategory::Instructions,
                    SyncLineStatus::Skip,
                    format!(
                        "instructions: skipped ({} has no file-based instructions)",
                        target.id()
                    ),
                ));
            } else if let Some(source_real) = &source_instructions_path {
                if let Some(link_path) = target.instructions_path() {
                    let target_real = target.instructions_real_path()?;
                    if target_real.as_ref() == Some(source_real) {
                        items.push(SyncLine::item(
                            SyncCategory::Instructions,
                            SyncLineStatus::Ok,
                            "instructions: unchanged",
                        ));
                    } else if opts.dry_run {
                        let src_body = source.read_instructions()?.unwrap_or_default();
                        let dst_body = target.read_instructions()?.unwrap_or_default();
                        let comparison = instructions::format_instructions_comparison(
                            &format!("{} (source)", source.id()),
                            &format!("{} (target)", target.id()),
                            source.instructions_path(),
                            target.instructions_path(),
                            Some(source_real.as_path()),
                            target_real.as_deref(),
                            &src_body,
                            &dst_body,
                        );
                        let detail: Vec<String> = comparison.lines().map(str::to_string).collect();
                        items.push(
                            SyncLine::item(
                                SyncCategory::Instructions,
                                SyncLineStatus::Plan,
                                format!(
                                    "instructions: would symlink {} -> {}",
                                    link_path.display(),
                                    source_real.display()
                                ),
                            )
                            .with_path(link_path.display().to_string())
                            .with_link_to(source_real.display().to_string())
                            .with_detail(detail),
                        );
                    } else {
                        match target.link_instructions(source_real, opts.force) {
                            Ok(action) => items.push(
                                SyncLine::item(
                                    SyncCategory::Instructions,
                                    SyncLineStatus::Done,
                                    format!(
                                        "instructions: {:?} {} -> {}",
                                        action,
                                        link_path.display(),
                                        source_real.display()
                                    ),
                                )
                                .with_path(link_path.display().to_string())
                                .with_link_to(source_real.display().to_string()),
                            ),
                            Err(e) => {
                                report.push_error(format!("{} instructions: {e}", target.id()));
                                items.push(SyncLine::item(
                                    SyncCategory::Instructions,
                                    SyncLineStatus::Error,
                                    format!("instructions: ERROR {e}"),
                                ));
                            }
                        }
                    }
                }
            } else {
                items.push(SyncLine::item(
                    SyncCategory::Instructions,
                    SyncLineStatus::Skip,
                    "instructions: skipped (source missing or unsupported)",
                ));
            }
        }

        if opts.kinds.skills {
            if !target.supports_skills_sync() {
                items.push(SyncLine::item(
                    SyncCategory::Skills,
                    SyncLineStatus::Skip,
                    format!(
                        "skills: skipped ({} skill sync is disabled)",
                        target.id()
                    ),
                ));
            } else {
                let keep: BTreeSet<String> = skills.iter().map(|s| s.name.clone()).collect();
                for skill in &skills {
                    if opts.dry_run {
                        let link = target.paths().skill_dir(&skill.name);
                        items.push(
                            SyncLine::item(
                                SyncCategory::Skills,
                                SyncLineStatus::Plan,
                                format!(
                                    "skill '{}': would symlink {} -> {}",
                                    skill.name,
                                    link.display(),
                                    skill.real_path.display()
                                ),
                            )
                            .with_name(skill.name.clone())
                            .with_path(link.display().to_string())
                            .with_link_to(skill.real_path.display().to_string()),
                        );
                        continue;
                    }
                    match target.link_skill(&skill.name, &skill.real_path, opts.force) {
                        Ok(action) => items.push(
                            SyncLine::item(
                                SyncCategory::Skills,
                                SyncLineStatus::Done,
                                format!("skill '{}': {:?}", skill.name, action),
                            )
                            .with_name(skill.name.clone()),
                        ),
                        Err(e) => {
                            report.push_error(format!(
                                "{} skill '{}': {e}",
                                target.id(),
                                skill.name
                            ));
                            items.push(
                                SyncLine::item(
                                    SyncCategory::Skills,
                                    SyncLineStatus::Error,
                                    format!("skill '{}': ERROR {e}", skill.name),
                                )
                                .with_name(skill.name.clone()),
                            );
                        }
                    }
                }
                if opts.prune {
                    let source_skills = source.paths().skills_dir.clone();
                    if opts.dry_run {
                        let orphans = skills::list_orphan_skill_links(
                            &target.paths().skills_dir,
                            &keep,
                            Some(&source_skills),
                        )?;
                        if orphans.is_empty() {
                            items.push(SyncLine::item(
                                SyncCategory::Skills,
                                SyncLineStatus::Ok,
                                "skills prune: no orphan symlinks",
                            ));
                        } else {
                            for name in orphans {
                                items.push(
                                    SyncLine::item(
                                        SyncCategory::Skills,
                                        SyncLineStatus::Plan,
                                        format!("skill '{name}': would prune symlink"),
                                    )
                                    .with_name(name),
                                );
                            }
                        }
                    } else {
                        let removed = skills::prune_skill_links(
                            &target.paths().skills_dir,
                            &keep,
                            Some(&source_skills),
                        )?;
                        for name in removed {
                            items.push(
                                SyncLine::item(
                                    SyncCategory::Skills,
                                    SyncLineStatus::Done,
                                    format!("skill '{name}': pruned symlink"),
                                )
                                .with_name(name),
                            );
                        }
                    }
                }
            }
        }

        if opts.kinds.mcp {
            let existing = target.read_mcp()?;
            let to_write = normalize_mcp_for_tool(*target_id, &mcp);
            if *target_id == ToolId::Codex {
                for name in sse_conversions_for_codex(&mcp) {
                    items.push(
                        SyncLine::item(
                            SyncCategory::Mcp,
                            SyncLineStatus::Info,
                            format!(
                                "mcp '{name}': converting SSE → streamable HTTP for Codex"
                            ),
                        )
                        .with_name(name),
                    );
                }
            }
            if existing == to_write && write_mode == WriteMode::Safe {
                items.push(SyncLine::item(
                    SyncCategory::Mcp,
                    SyncLineStatus::Ok,
                    "mcp: unchanged",
                ));
            } else if opts.dry_run {
                let src_names: BTreeSet<_> = to_write.servers.keys().cloned().collect();
                let dst_names: BTreeSet<_> = existing.servers.keys().cloned().collect();
                let mut detail = Vec::new();
                for n in src_names.difference(&dst_names) {
                    detail.push(format!("+ {n}"));
                }
                for n in dst_names.difference(&src_names) {
                    if write_mode == WriteMode::Prune {
                        detail.push(format!("- {n}"));
                    }
                }
                for n in src_names.intersection(&dst_names) {
                    if existing.servers.get(n) != to_write.servers.get(n) {
                        detail.push(format!("~ {n}"));
                    }
                }
                items.push(
                    SyncLine::item(
                        SyncCategory::Mcp,
                        SyncLineStatus::Plan,
                        format!(
                            "mcp: would write {} server(s) ({write_mode:?})",
                            to_write.servers.len()
                        ),
                    )
                    .with_detail(detail),
                );
            } else {
                target.write_mcp(&mcp, write_mode)?;
                items.push(
                    SyncLine::item(
                        SyncCategory::Mcp,
                        SyncLineStatus::Done,
                        format!(
                            "mcp: wrote {} ({:?})",
                            target.paths().mcp_config.display(),
                            write_mode
                        ),
                    )
                    .with_path(target.paths().mcp_config.display().to_string()),
                );
            }
        }

        report.targets.push(SyncTargetReport {
            tool: target.id().to_string(),
            items,
        });
    }

    Ok(report)
}

/// Diff instructions / skills / mcp between two tools.
pub fn diff(from: ToolId, to: ToolId, home: Option<PathBuf>) -> Result<DiffReport> {
    if from == to {
        return Err(Error::SameSourceAndTarget(from.to_string()));
    }
    let source = adapter(from, &home)?;
    let target = adapter(to, &home)?;

    let instructions = match (source.supports_instructions(), target.supports_instructions()) {
        (false, false) => InstructionsDiff::Skipped {
            reason: format!(
                "skipped: neither {from} nor {to} supports file-based instructions"
            ),
        },
        (false, true) => InstructionsDiff::Skipped {
            reason: format!("skipped: {from} does not support file-based instructions"),
        },
        (true, false) => InstructionsDiff::Skipped {
            reason: format!("skipped: {to} does not support file-based instructions"),
        },
        (true, true) => {
            let src_real = source.instructions_real_path()?;
            let dst_real = target.instructions_real_path()?;
            let src_i = source.read_instructions()?.unwrap_or_default();
            let dst_i = target.read_instructions()?.unwrap_or_default();
            let summary = instructions::format_instructions_comparison(
                &format!("{from}"),
                &format!("{to}"),
                source.instructions_path(),
                target.instructions_path(),
                src_real.as_deref(),
                dst_real.as_deref(),
                &src_i,
                &dst_i,
            );
            let identical = src_real == dst_real;
            InstructionsDiff::Compared {
                identical,
                from_path: source
                    .instructions_path()
                    .map(|p| p.display().to_string()),
                to_path: target.instructions_path().map(|p| p.display().to_string()),
                from_real: src_real.as_ref().map(|p| p.display().to_string()),
                to_real: dst_real.as_ref().map(|p| p.display().to_string()),
                summary,
            }
        }
    };

    let src_skills: BTreeSet<_> = source
        .list_skills()?
        .into_iter()
        .map(|s| s.name)
        .collect();
    let dst_skills: BTreeSet<_> = target
        .list_skills()?
        .into_iter()
        .map(|s| s.name)
        .collect();
    let mut skills = Vec::new();
    for n in src_skills.difference(&dst_skills) {
        skills.push(NamedDiff {
            name: n.clone(),
            change: DiffChange::Added,
        });
    }
    for n in dst_skills.difference(&src_skills) {
        skills.push(NamedDiff {
            name: n.clone(),
            change: DiffChange::Removed,
        });
    }
    for n in src_skills.intersection(&dst_skills) {
        skills.push(NamedDiff {
            name: n.clone(),
            change: DiffChange::Same,
        });
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));

    let src_mcp = source.read_mcp()?;
    let dst_mcp = target.read_mcp()?;
    let src_for_target = normalize_mcp_for_tool(to, &src_mcp);
    let src_names: BTreeSet<_> = src_for_target.servers.keys().cloned().collect();
    let dst_names: BTreeSet<_> = dst_mcp.servers.keys().cloned().collect();
    let mut mcp_diff = Vec::new();
    for n in src_names.difference(&dst_names) {
        mcp_diff.push(NamedDiff {
            name: n.clone(),
            change: DiffChange::Added,
        });
    }
    for n in dst_names.difference(&src_names) {
        mcp_diff.push(NamedDiff {
            name: n.clone(),
            change: DiffChange::Removed,
        });
    }
    for n in src_names.intersection(&dst_names) {
        let change = if src_for_target.servers.get(n) == dst_mcp.servers.get(n) {
            DiffChange::Same
        } else {
            DiffChange::Changed
        };
        mcp_diff.push(NamedDiff {
            name: n.clone(),
            change,
        });
    }
    mcp_diff.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(DiffReport {
        from: from.to_string(),
        to: to.to_string(),
        instructions,
        skills,
        mcp: mcp_diff,
    })
}

/// Status for all tools (or one).
pub fn status(tool: Option<ToolId>, home: Option<PathBuf>) -> Result<StatusReport> {
    let tools: Vec<ToolId> = match tool {
        Some(t) => vec![t],
        None => ToolId::ALL.to_vec(),
    };
    let mut statuses = Vec::new();
    for t in tools {
        let adapter = adapter(t, &home)?;
        statuses.push(adapter.tool_status()?);
    }
    Ok(StatusReport { tools: statuses })
}

/// Show skills, MCP servers, and instructions for a tool.
pub fn details(tool: ToolId, home: Option<PathBuf>) -> Result<DetailsReport> {
    let adapter = adapter(tool, &home)?;
    let skills = adapter
        .list_skills()?
        .into_iter()
        .map(|s| SkillInfo {
            name: s.name,
            path: s.real_path.display().to_string(),
        })
        .collect();
    let mcp = adapter.read_mcp()?;
    let mcp_servers = mcp.names().into_iter().map(str::to_string).collect();
    let instructions = if !adapter.supports_instructions() {
        DetailsInstructions::Unsupported {
            path: adapter.instructions_path_display(),
        }
    } else {
        match adapter.read_instructions()? {
            Some(body) => DetailsInstructions::Present {
                path: adapter.instructions_path_display(),
                chars: body.chars().count(),
            },
            None => DetailsInstructions::Missing {
                path: adapter.instructions_path_display(),
            },
        }
    };
    Ok(DetailsReport {
        tool: tool.to_string(),
        skills,
        mcp_servers,
        instructions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::{McpDocument, McpServer, McpTransport};
    use crate::report::RenderText;
    use std::collections::BTreeMap;
    use std::fs;
    use tempfile::tempdir;

    fn setup_claude_home(home: &std::path::Path) {
        let _ = fs::create_dir_all(home.join(".claude/skills/demo"));
        let _ = fs::write(
            home.join(".claude/CLAUDE.md"),
            "# Claude rules\nAlways test.\n",
        );
        let _ = fs::write(
            home.join(".claude/skills/demo/SKILL.md"),
            "---\nname: demo\ndescription: demo skill\n---\n\nDo the demo.\n",
        );
        let mut env = BTreeMap::new();
        env.insert("KEY".into(), "${SECRET}".into());
        let mut doc = McpDocument::default();
        doc.servers.insert(
            "demo".into(),
            McpServer {
                name: "demo".into(),
                transport: McpTransport::Stdio {
                    command: "npx".into(),
                    args: vec!["-y".into(), "pkg".into()],
                    env,
                },
            },
        );
        let adapter = ToolAdapter::in_home(ToolId::Claude, home);
        let _ = adapter.write_mcp(&doc, WriteMode::Safe);
    }

    #[test]
    fn sync_claude_to_cursor_and_codex() {
        let dir = match tempdir() {
            Ok(d) => d,
            Err(_) => return,
        };
        let home = dir.path();
        setup_claude_home(home);

        let report = match sync(&SyncOptions {
            from: ToolId::Claude,
            to: vec![ToolId::Cursor, ToolId::Codex, ToolId::OpenCode],
            kinds: SyncKinds::all(),
            dry_run: false,
            prune: false,
            force: false,
            home: Some(home.to_path_buf()),
        }) {
            Ok(r) => r,
            Err(e) => panic!("{e}"),
        };
        assert!(report.success(), "{}", report.render());
        assert!(
            report.render().contains("instructions: skipped (cursor has no file-based instructions)"),
            "expected cursor instructions skip, got:\n{}",
            report.render()
        );
        assert!(
            report
                .render()
                .contains("skills: skipped (cursor skill sync is disabled)"),
            "expected cursor skills skip, got:\n{}",
            report.render()
        );

        let cursor = ToolAdapter::in_home(ToolId::Cursor, home);
        assert!(cursor.read_instructions().ok().flatten().is_none());
        assert!(!home.join(".cursor/rules/agent-bridge.mdc").exists());
        assert!(!home.join(".cursor/skills/demo").exists());

        let cursor_mcp = match cursor.read_mcp() {
            Ok(d) => d,
            Err(e) => panic!("{e}"),
        };
        assert!(cursor_mcp.servers.contains_key("demo"));

        let codex = ToolAdapter::in_home(ToolId::Codex, home);
        let codex_instr_path = home.join(".codex/AGENTS.md");
        assert!(
            codex_instr_path
                .symlink_metadata()
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false),
            "codex instructions should be a symlink"
        );
        let codex_instr = match codex.read_instructions() {
            Ok(Some(s)) => s,
            other => panic!("codex instructions: {other:?}"),
        };
        assert!(codex_instr.contains("Always test"));

        let claude_real = match ToolAdapter::in_home(ToolId::Claude, home).instructions_real_path()
        {
            Ok(Some(p)) => p,
            other => panic!("claude real path: {other:?}"),
        };
        let codex_real = match codex.instructions_real_path() {
            Ok(Some(p)) => p,
            other => panic!("codex real path: {other:?}"),
        };
        assert_eq!(claude_real, codex_real);

        let codex_raw = match fs::read_to_string(home.join(".codex/config.toml")) {
            Ok(s) => s,
            Err(e) => panic!("{e}"),
        };
        assert!(codex_raw.contains("mcp_servers") || codex_raw.contains("[mcp_servers"));
    }

    #[test]
    fn sync_claude_sse_to_codex_converts_protocol() {
        let dir = match tempdir() {
            Ok(d) => d,
            Err(_) => return,
        };
        let home = dir.path();
        let _ = fs::create_dir_all(home.join(".claude"));
        let _ = fs::write(
            home.join(".claude.json"),
            r#"{
  "mcpServers": {
    "asana": {
      "type": "sse",
      "url": "https://mcp.asana.com/sse"
    },
    "notion": {
      "type": "http",
      "url": "https://mcp.notion.com/mcp"
    }
  }
}
"#,
        );

        let report = match sync(&SyncOptions {
            from: ToolId::Claude,
            to: vec![ToolId::Codex],
            kinds: SyncKinds {
                instructions: false,
                skills: false,
                mcp: true,
            },
            dry_run: false,
            prune: false,
            force: false,
            home: Some(home.to_path_buf()),
        }) {
            Ok(r) => r,
            Err(e) => panic!("{e}"),
        };
        assert!(report.success(), "{}", report.render());
        assert!(
            report
                .render()
                .contains("converting SSE → streamable HTTP for Codex"),
            "expected conversion notice, got:\n{}",
            report.render()
        );

        let codex = ToolAdapter::in_home(ToolId::Codex, home);
        let codex_mcp = match codex.read_mcp() {
            Ok(d) => d,
            Err(e) => panic!("{e}"),
        };
        match &codex_mcp.servers["asana"].transport {
            McpTransport::Http { protocol, url, .. } => {
                assert_eq!(*protocol, crate::mcp::HttpProtocol::StreamableHttp);
                assert_eq!(url, "https://mcp.asana.com/mcp");
            }
            _ => panic!("expected http"),
        }

        // Second sync should be a no-op (no perpetual rewrite from protocol mismatch).
        let report2 = match sync(&SyncOptions {
            from: ToolId::Claude,
            to: vec![ToolId::Codex],
            kinds: SyncKinds {
                instructions: false,
                skills: false,
                mcp: true,
            },
            dry_run: false,
            prune: false,
            force: false,
            home: Some(home.to_path_buf()),
        }) {
            Ok(r) => r,
            Err(e) => panic!("{e}"),
        };
        assert!(
            report2.render().contains("mcp: unchanged"),
            "expected unchanged after conversion, got:\n{}",
            report2.render()
        );
    }

    #[test]
    fn sync_instructions_requires_force_for_real_file() {
        let dir = match tempdir() {
            Ok(d) => d,
            Err(_) => return,
        };
        let home = dir.path();
        let _ = fs::create_dir_all(home.join(".claude"));
        let _ = fs::create_dir_all(home.join(".codex"));
        let _ = fs::write(home.join(".claude/CLAUDE.md"), "from claude\n");
        let _ = fs::write(home.join(".codex/AGENTS.md"), "old codex copy\n");

        let report = match sync(&SyncOptions {
            from: ToolId::Claude,
            to: vec![ToolId::Codex],
            kinds: SyncKinds {
                instructions: true,
                skills: false,
                mcp: false,
            },
            dry_run: false,
            prune: false,
            force: false,
            home: Some(home.to_path_buf()),
        }) {
            Ok(r) => r,
            Err(e) => panic!("{e}"),
        };
        assert!(!report.success(), "expected conflict without --force");
        assert!(
            report.render().contains("instructions: ERROR"),
            "expected error line, got:\n{}",
            report.render()
        );

        let report_force = match sync(&SyncOptions {
            from: ToolId::Claude,
            to: vec![ToolId::Codex],
            kinds: SyncKinds {
                instructions: true,
                skills: false,
                mcp: false,
            },
            dry_run: false,
            prune: false,
            force: true,
            home: Some(home.to_path_buf()),
        }) {
            Ok(r) => r,
            Err(e) => panic!("{e}"),
        };
        assert!(report_force.success(), "{}", report_force.render());
        let link = home.join(".codex/AGENTS.md");
        assert!(
            link.symlink_metadata()
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false)
        );
    }

    #[test]
    fn diff_instructions_shows_paths_then_content() {
        let dir = match tempdir() {
            Ok(d) => d,
            Err(_) => return,
        };
        let home = dir.path();
        let _ = fs::create_dir_all(home.join(".claude"));
        let _ = fs::create_dir_all(home.join(".codex"));
        let _ = fs::write(home.join(".claude/CLAUDE.md"), "alpha\n");
        let _ = fs::write(home.join(".codex/AGENTS.md"), "beta\n");

        let report = match diff(ToolId::Claude, ToolId::Codex, Some(home.to_path_buf())) {
            Ok(r) => r,
            Err(e) => panic!("{e}"),
        };
        let out = report.render();
        assert!(out.contains("## Instructions"), "{out}");
        assert!(out.contains("claude:"), "{out}");
        assert!(out.contains("codex:"), "{out}");
        assert!(out.contains("alpha") || out.contains("beta"), "{out}");
    }
}
