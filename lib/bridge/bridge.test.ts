import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeInstructions, formatInstructionsComparison, linkInstructions } from "./instructions.ts";
import { readMcp, rewriteSseUrlToStreamableHttp, sseConversionsForCodex, writeMcp, normalizeMcpForTool } from "./mcp/mcp.ts";
import { emptyDocument, type McpDocument, type McpServer } from "./mcp/types.ts";
import {
  rewriteEnvClaudeToCursor,
  rewriteEnvClaudeToOpencode,
  rewriteEnvCursorToClaude,
  rewriteEnvOpencodeToClaude,
} from "./mcp/env-syntax.ts";
import { pathsForTool } from "./paths.ts";
import { renderDiff, renderSync } from "./report.ts";
import { linkSkill, listSkills, pruneSkillLinks } from "./skills.ts";
import { ensureSymlink } from "./symlink.ts";
import { diff, sync } from "./sync.ts";
import { ToolAdapter } from "./adapters.ts";
import type { SyncKinds } from "./tool.ts";

function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bar-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function stdioServer(name: string): McpServer {
  return {
    name,
    transport: {
      kind: "stdio",
      command: "npx",
      args: ["-y", "demo"],
      env: { TOKEN: "Bearer ${API_KEY}" },
    },
  };
}

function documentOf(servers: McpServer[]): McpDocument {
  const doc = emptyDocument();
  for (const server of servers) {
    doc.servers[server.name] = server;
  }
  return doc;
}

test("tool paths match the global layout", () => {
  const home = "/tmp/home";
  const claude = pathsForTool("claude", home);
  assert.equal(claude.instructions, path.join(home, ".claude/CLAUDE.md"));
  assert.equal(claude.skillsDir, path.join(home, ".claude/skills"));
  assert.equal(claude.mcpConfig, path.join(home, ".claude.json"));
  const cursor = pathsForTool("cursor", home);
  assert.equal(cursor.instructions, null);
  assert.equal(cursor.skillsDir, path.join(home, ".cursor/skills"));
  assert.equal(cursor.mcpConfig, path.join(home, ".cursor/mcp.json"));
  const omp = pathsForTool("omp", home);
  assert.equal(omp.instructions, path.join(home, ".omp/agent/AGENTS.md"));
  assert.equal(omp.mcpConfig, path.join(home, ".omp/agent/mcp.json"));
});

test("env syntax round-trips across cursor and opencode", () => {
  const claude = "Bearer ${API_KEY}";
  const cursor = rewriteEnvClaudeToCursor(claude);
  assert.equal(cursor, "Bearer ${env:API_KEY}");
  assert.equal(rewriteEnvCursorToClaude(cursor), claude);
  const open = rewriteEnvClaudeToOpencode("Bearer ${TOKEN}");
  assert.equal(open, "Bearer {env:TOKEN}");
  assert.equal(rewriteEnvOpencodeToClaude(open), "Bearer ${TOKEN}");
  assert.equal(rewriteEnvClaudeToOpencode("${VAR:-fallback}"), "{env:VAR}");
});

test("symlinks are created once and real files need force", () => {
  withTempDir((dir) => {
    const src = path.join(dir, "src.md");
    const link = path.join(dir, "link.md");
    fs.writeFileSync(src, "hi");
    assert.equal(ensureSymlink(link, src, false, "test"), "Created");
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(ensureSymlink(link, src, false, "test"), "Unchanged");

    const dst = path.join(dir, "dst.md");
    fs.writeFileSync(dst, "b");
    assert.throws(() => ensureSymlink(dst, src, false, "test"));
    assert.equal(ensureSymlink(dst, src, true, "test"), "Created");
  });
});

test("instruction links follow the canonical source", () => {
  withTempDir((dir) => {
    const src = path.join(dir, "CLAUDE.md");
    const mid = path.join(dir, "mid.md");
    const dst = path.join(dir, "AGENTS.md");
    writeInstructions(src, "hello");
    assert.equal(fs.readFileSync(src, "utf8"), "hello\n");
    fs.symlinkSync(src, mid);
    assert.equal(linkInstructions(dst, mid, false), "Created");
    assert.equal(fs.realpathSync(dst), fs.realpathSync(src));
  });
});

test("instruction comparison distinguishes identical paths from identical text", () => {
  const same = formatInstructionsComparison(
    "claude",
    "codex",
    "/a/CLAUDE.md",
    "/b/AGENTS.md",
    "/real/file.md",
    "/real/file.md",
    "same",
    "same",
  );
  assert.match(same, /\(identical\)/);
  assert.match(same, /\/real\/file\.md/);
  const differ = formatInstructionsComparison(
    "claude",
    "codex",
    "/a/CLAUDE.md",
    "/b/AGENTS.md",
    "/a/CLAUDE.md",
    "/b/AGENTS.md",
    "hello\n",
    "hello\n",
  );
  assert.match(differ, /\(content identical; paths differ\)/);
  assert.equal(differ.includes("(identical)\n  real_path"), false);
});

test("skill links and prune only remove source-owned symlinks", () => {
  withTempDir((dir) => {
    const srcRoot = path.join(dir, "src_skills");
    const dstRoot = path.join(dir, "dst_skills");
    fs.mkdirSync(srcRoot, { recursive: true });
    const skill = path.join(srcRoot, "demo");
    fs.mkdirSync(skill);
    fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: demo\n");
    const listed = listSkills(srcRoot);
    assert.equal(listed.length, 1);
    const link = path.join(dstRoot, "demo");
    const realPath = listed[0]?.realPath ?? skill;
    assert.equal(linkSkill(link, realPath, false), "Created");
    assert.equal(linkSkill(link, realPath, false), "Unchanged");
    assert.deepEqual(pruneSkillLinks(dstRoot, new Set(["demo"]), srcRoot), []);
  });

  withTempDir((dir) => {
    const srcRoot = path.join(dir, "src_skills");
    const dstRoot = path.join(dir, "dst_skills");
    fs.mkdirSync(srcRoot, { recursive: true });
    fs.mkdirSync(dstRoot, { recursive: true });
    const dangling = path.join(dstRoot, "gone-skill");
    fs.symlinkSync(path.join(srcRoot, "gone-skill"), dangling);
    assert.deepEqual(pruneSkillLinks(dstRoot, new Set(), srcRoot), ["gone-skill"]);

    const external = path.join(dstRoot, "external-skill");
    fs.symlinkSync(path.join(dir, "other_skills", "external-skill"), external);
    assert.deepEqual(pruneSkillLinks(dstRoot, new Set(), srcRoot), []);
    assert.equal(fs.lstatSync(external).isSymbolicLink(), true);
  });
});

test("mcp round-trips env syntax, protocols, and unrelated config", () => {
  withTempDir((dir) => {
    const claude = path.join(dir, ".claude.json");
    const cursor = path.join(dir, "mcp.json");
    const doc = documentOf([stdioServer("demo")]);
    writeMcp("claude", claude, doc, "safe");
    const back = readMcp("claude", claude);
    writeMcp("cursor", cursor, back, "safe");
    const raw = fs.readFileSync(cursor, "utf8");
    assert.match(raw, /\$\{env:API_KEY\}/);
    const cursorDoc = readMcp("cursor", cursor);
    const transport = cursorDoc.servers.demo?.transport;
    assert.equal(transport?.kind, "stdio");
    if (transport?.kind === "stdio") {
      assert.equal(transport.env.TOKEN, "Bearer ${API_KEY}");
    }

    const first = documentOf([stdioServer("a"), stdioServer("b")]);
    writeMcp("claude", claude, first, "safe");
    writeMcp("claude", claude, documentOf([stdioServer("a")]), "prune");
    const pruned = readMcp("claude", claude);
    assert.equal(Boolean(pruned.servers.a), true);
    assert.equal(Boolean(pruned.servers.b), false);

    fs.writeFileSync(claude, '{\n  "theme": "dark",\n  "mcpServers": {}\n}\n');
    writeMcp("claude", claude, doc, "safe");
    const preserved = fs.readFileSync(claude, "utf8");
    assert.match(preserved, /"theme"/);
    assert.match(preserved, /demo/);
  });
});

test("sse urls are rewritten only for codex", () => {
  assert.equal(
    rewriteSseUrlToStreamableHttp("https://mcp.asana.com/sse"),
    "https://mcp.asana.com/mcp",
  );
  assert.equal(
    rewriteSseUrlToStreamableHttp("https://Example.com/SSE"),
    "https://Example.com/mcp",
  );
  assert.equal(
    rewriteSseUrlToStreamableHttp("https://example.com/sse?token=1"),
    "https://example.com/mcp?token=1",
  );
  assert.equal(
    rewriteSseUrlToStreamableHttp("https://example.com/asses"),
    "https://example.com/asses",
  );
  withTempDir((dir) => {
    const codex = path.join(dir, "config.toml");
    const doc = documentOf([
      {
        name: "asana",
        transport: {
          kind: "http",
          url: "https://mcp.asana.com/sse",
          headers: {},
          protocol: "sse",
        },
      },
      {
        name: "notion",
        transport: {
          kind: "http",
          url: "https://mcp.notion.com/mcp",
          headers: {},
          protocol: "streamable-http",
        },
      },
    ]);
    assert.deepEqual(sseConversionsForCodex(doc), ["asana"]);
    writeMcp("codex", codex, doc, "safe");
    const raw = fs.readFileSync(codex, "utf8");
    assert.match(raw, /mcp\.asana\.com\/mcp/);
    assert.equal(raw.includes("mcp.asana.com/sse"), false);
    const readBack = readMcp("codex", codex);
    assert.deepEqual(normalizeMcpForTool("codex", doc), readBack);

    const kept = path.join(dir, "config-comments.toml");
    fs.writeFileSync(
      kept,
      '# keep me\nmodel = "gpt-5"\n\n[notice]\nfoo = "bar"\n\n[mcp_servers.old]\ncommand = "old"\n',
    );
    writeMcp("codex", kept, doc, "safe");
    const merged = fs.readFileSync(kept, "utf8");
    assert.match(merged, /# keep me/);
    assert.match(merged, /model = "gpt-5"/);
    assert.match(merged, /foo = "bar"/);
    assert.match(merged, /command = "old"/);
    assert.match(merged, /mcp\.asana\.com\/mcp/);
  });
});

test("pi and omp mcp writes preserve neighboring keys", () => {
  withTempDir((dir) => {
    const pi = path.join(dir, "pi.json");
    fs.writeFileSync(
      pi,
      '{\n  "settings": { "toolPrefix": "mcp", "idleTimeout": 10 },\n  "mcpServers": {}\n}\n',
    );
    writeMcp("pi", pi, documentOf([stdioServer("demo")]), "safe");
    const raw = fs.readFileSync(pi, "utf8");
    assert.match(raw, /"settings"/);
    assert.match(raw, /toolPrefix/);
    assert.match(raw, /\$\{API_KEY\}/);

    const omp = path.join(dir, "omp.json");
    fs.writeFileSync(
      omp,
      '{\n  "$schema": "https://example.invalid/schema.json",\n  "disabledServers": ["skip-me"],\n  "mcpServers": {}\n}\n',
    );
    writeMcp("omp", omp, documentOf([stdioServer("demo")]), "safe");
    const ompRaw = fs.readFileSync(omp, "utf8");
    assert.match(ompRaw, /"\$schema"/);
    assert.match(ompRaw, /disabledServers/);
    assert.match(ompRaw, /skip-me/);
  });
});

function setupClaudeHome(home: string): void {
  fs.mkdirSync(path.join(home, ".claude/skills/demo"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude/CLAUDE.md"), "# Claude rules\nAlways test.\n");
  fs.writeFileSync(
    path.join(home, ".claude/skills/demo/SKILL.md"),
    "---\nname: demo\ndescription: demo skill\n---\n\nDo the demo.\n",
  );
  const doc = documentOf([
    {
      name: "demo",
      transport: {
        kind: "stdio",
        command: "npx",
        args: ["-y", "pkg"],
        env: { KEY: "${SECRET}" },
      },
    },
  ]);
  ToolAdapter.forTool("claude", home).writeMcp(doc, "safe");
}

test("sync links claude into cursor, codex, pi, and omp", () => {
  withTempDir((home) => {
    setupClaudeHome(home);
    const report = sync({
      from: "claude",
      to: ["cursor", "codex", "opencode"],
      kinds: { instructions: true, skills: true, mcp: true },
      dryRun: false,
      prune: false,
      force: false,
      home,
    });
    const rendered = renderSync(report);
    assert.equal(report.errors.length, 0, rendered);
    assert.match(rendered, /instructions: skipped \(cursor has no file-based instructions\)/);
    assert.equal(fs.lstatSync(path.join(home, ".cursor/skills/demo")).isSymbolicLink(), true);
    assert.equal(fs.lstatSync(path.join(home, ".codex/AGENTS.md")).isSymbolicLink(), true);
    assert.match(fs.readFileSync(path.join(home, ".codex/AGENTS.md"), "utf8"), /Always test/);
    assert.equal(
      fs.realpathSync(path.join(home, ".claude/CLAUDE.md")),
      fs.realpathSync(path.join(home, ".codex/AGENTS.md")),
    );
    assert.match(fs.readFileSync(path.join(home, ".codex/config.toml"), "utf8"), /mcp_servers/);

    fs.mkdirSync(path.join(home, ".pi/agent"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".pi/agent/mcp.json"),
      '{\n  "settings": { "toolPrefix": "mcp" },\n  "mcpServers": {}\n}\n',
    );
    const piReport = sync({
      from: "claude",
      to: ["pi"],
      kinds: { instructions: true, skills: true, mcp: true },
      dryRun: false,
      prune: false,
      force: false,
      home,
    });
    assert.equal(piReport.errors.length, 0, renderSync(piReport));
    assert.match(fs.readFileSync(path.join(home, ".pi/agent/mcp.json"), "utf8"), /toolPrefix/);
    assert.equal(fs.lstatSync(path.join(home, ".pi/agent/skills/demo")).isSymbolicLink(), true);
  });
});

test("sync converts claude sse mcp for codex once", () => {
  withTempDir((home) => {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".claude.json"),
      `{
  "mcpServers": {
    "asana": { "type": "sse", "url": "https://mcp.asana.com/sse" },
    "notion": { "type": "http", "url": "https://mcp.notion.com/mcp" }
  }
}
`,
    );
    const kinds: SyncKinds = { instructions: false, skills: false, mcp: true };
    const first = sync({
      from: "claude",
      to: ["codex"],
      kinds,
      dryRun: false,
      prune: false,
      force: false,
      home,
    });
    const rendered = renderSync(first);
    assert.equal(first.errors.length, 0, rendered);
    assert.match(rendered, /converting SSE → streamable HTTP for Codex/);
    const codex = ToolAdapter.forTool("codex", home).readMcp();
    const asana = codex.servers.asana?.transport;
    assert.equal(asana?.kind, "http");
    if (asana?.kind === "http") {
      assert.equal(asana.protocol, "streamable-http");
      assert.equal(asana.url, "https://mcp.asana.com/mcp");
    }
    const second = sync({
      from: "claude",
      to: ["codex"],
      kinds,
      dryRun: false,
      prune: false,
      force: false,
      home,
    });
    assert.match(renderSync(second), /mcp: unchanged/);
  });
});

test("instruction sync requires force when the target is a real file", () => {
  withTempDir((home) => {
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude/CLAUDE.md"), "from claude\n");
    fs.writeFileSync(path.join(home, ".codex/AGENTS.md"), "old codex copy\n");
    const kinds: SyncKinds = { instructions: true, skills: false, mcp: false };
    const blocked = sync({
      from: "claude",
      to: ["codex"],
      kinds,
      dryRun: false,
      prune: false,
      force: false,
      home,
    });
    assert.equal(blocked.errors.length > 0, true);
    assert.match(renderSync(blocked), /instructions: ERROR/);
    const forced = sync({
      from: "claude",
      to: ["codex"],
      kinds,
      dryRun: false,
      prune: false,
      force: true,
      home,
    });
    assert.equal(forced.errors.length, 0, renderSync(forced));
    assert.equal(fs.lstatSync(path.join(home, ".codex/AGENTS.md")).isSymbolicLink(), true);
    fs.unlinkSync(path.join(home, ".codex/AGENTS.md"));
    fs.writeFileSync(path.join(home, ".claude/CLAUDE.md"), "alpha\n");
    fs.writeFileSync(path.join(home, ".codex/AGENTS.md"), "beta\n");
    const compared = renderDiff(diff("claude", "codex", home));
    assert.match(compared, /## Instructions/);
    assert.match(compared, /claude:/);
    assert.match(compared, /codex:/);
    assert.match(compared, /alpha|beta/);
  });
});
