import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readCodexCredentialsFrom } from "./auth.ts";
import { usageToSnapshot } from "./codex.ts";
import { formatTrayLabel, sanitizeError, tooltipDetail } from "./model.ts";

test("tray labels and bearer redaction", () => {
  assert.equal(formatTrayLabel("Cursor", 1234, "cents"), "Cursor $12.3");
  assert.equal(formatTrayLabel("Cursor", 42, "requests"), "Cursor 42");
  const cleaned = sanitizeError("HTTP 401 Bearer secret-token-value remaining");
  assert.match(cleaned, /Bearer \[redacted\]/);
  assert.equal(cleaned.includes("secret-token-value"), false);
});

test("codex usage maps the 5-hour and weekly windows", () => {
  const usage = {
    email: "user@example.com",
    plan_type: "plus",
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        used_percent: 52,
        limit_window_seconds: 18000,
        reset_after_seconds: 9068,
        reset_at: 1790767437,
      },
      secondary_window: {
        used_percent: 8,
        limit_window_seconds: 604800,
        reset_after_seconds: 595868,
        reset_at: 1791354237,
      },
    },
    credits: {
      has_credits: false,
      unlimited: false,
      balance: "0",
    },
  };
  const snapshot = usageToSnapshot("codex", "Codex", usage);
  assert.equal(snapshot.membershipType, "plus");
  assert.equal(snapshot.email, "user@example.com");
  assert.equal(snapshot.unit, "percent");
  assert.equal(snapshot.windows.length, 2);
  assert.equal(snapshot.windows[0]?.shortLabel, "5h");
  assert.equal(snapshot.windows[0]?.usedPercent, 52);
  assert.equal(snapshot.windows[1]?.shortLabel, "7d");
  assert.equal(snapshot.windows[1]?.usedPercent, 8);
  assert.equal(snapshot.remaining, 48);
  assert.equal(snapshot.totalPercentUsed, 52);
  assert.equal(tooltipDetail(snapshot), "5h 48% · 7d 92% left");
  assert.equal(snapshot.credits, null);
});

test("empty codex usage is an error", () => {
  assert.throws(() => usageToSnapshot("codex", "Codex", {}), /No usage data returned by Codex/);
});

test("codex auth reads chatgpt tokens and rejects api keys", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bar-auth-"));
  try {
    const session = path.join(dir, "session.json");
    fs.writeFileSync(
      session,
      JSON.stringify({
        auth_mode: "chatgpt",
        OPENAI_API_KEY: null,
        tokens: {
          access_token: "access-token",
          refresh_token: "refresh-token",
          account_id: "acc-1",
        },
      }),
    );
    const creds = readCodexCredentialsFrom(session);
    assert.equal(creds.accessToken, "access-token");
    assert.equal(creds.accountId, "acc-1");
    assert.equal("refreshToken" in creds, false);

    const apiKey = path.join(dir, "api.json");
    fs.writeFileSync(apiKey, JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-test" }));
    assert.throws(
      () => readCodexCredentialsFrom(apiKey),
      /signed in with an API key/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
