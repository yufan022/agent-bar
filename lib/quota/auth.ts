import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ACCESS_TOKEN_KEY = "cursorAuth/accessToken";
const EMAIL_KEY = "cursorAuth/cachedEmail";
const MEMBERSHIP_KEY = "cursorAuth/stripeMembershipType";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface CursorCredentials {
  accessToken: string;
  email: string | null;
  membershipType: string | null;
}

export interface CodexCredentials {
  accessToken: string;
  accountId: string | null;
}

export function readCursorCredentials(): CursorCredentials {
  const dbPath = cursorDbPaths().find((candidate) => fs.existsSync(candidate));
  if (!dbPath) {
    throw new AuthError(
      "Cursor state database not found. Open Cursor and sign in, then try again.",
    );
  }
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const accessToken = readItem(db, ACCESS_TOKEN_KEY);
    if (!accessToken) {
      throw new AuthError("Cursor access token not found. Open Cursor and sign in, then try again.");
    }
    return {
      accessToken,
      email: readItem(db, EMAIL_KEY),
      membershipType: readItem(db, MEMBERSHIP_KEY),
    };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new AuthError(`Failed to read Cursor state database: ${message}`);
  } finally {
    db?.close();
  }
}

function cursorDbPaths(): string[] {
  const home = os.homedir();
  if (!home) {
    return [];
  }
  return [
    path.join(home, "Library/Application Support/Cursor/User/globalStorage/state.vscdb"),
    path.join(home, "Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb"),
  ];
}

function readItem(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key) as
    | { value?: string | Uint8Array | null }
    | undefined;
  if (!row) {
    return null;
  }
  const value = row.value;
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  if (value instanceof Uint8Array) {
    const text = Buffer.from(value).toString("utf8");
    return text.length > 0 ? text : null;
  }
  return null;
}

export function codexAuthPaths(): string[] {
  const fromEnv = process.env.CODEX_HOME?.trim();
  if (fromEnv) {
    return [path.join(fromEnv, "auth.json")];
  }
  const home = os.homedir();
  if (!home) {
    return [];
  }
  return [path.join(home, ".codex/auth.json"), path.join(home, ".config/codex/auth.json")];
}

export function readCodexCredentials(): CodexCredentials {
  const authPath = codexAuthPaths().find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
  if (!authPath) {
    throw new AuthError("Codex is not signed in. Run `codex login`, then try again.");
  }
  return readCodexCredentialsFrom(authPath);
}

export function readCodexCredentialsFrom(filePath: string): CodexCredentials {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AuthError(`Failed to read Codex auth file: unable to read ${filePath}: ${message}`);
  }
  let parsed: {
    auth_mode?: string;
    OPENAI_API_KEY?: string | null;
    tokens?: { access_token?: string; account_id?: string };
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new AuthError("Failed to read Codex auth file: Codex auth file is not valid JSON");
  }
  const accessToken = parsed.tokens?.access_token?.trim() ?? "";
  if (!accessToken) {
    if (apiKeyPresent(parsed.OPENAI_API_KEY) || isApiKeyMode(parsed.auth_mode)) {
      throw new AuthError(
        "Codex is signed in with an API key. Plan quota is available after signing in with ChatGPT.",
      );
    }
    throw new AuthError("Codex access token not found. Run `codex login`, then try again.");
  }
  const accountId = parsed.tokens?.account_id?.trim() ?? "";
  return {
    accessToken,
    accountId: accountId.length > 0 ? accountId : null,
  };
}

function apiKeyPresent(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isApiKeyMode(mode: string | undefined): boolean {
  const trimmed = mode?.trim();
  return trimmed === "apikey" || trimmed === "api_key" || trimmed === "api-key";
}
