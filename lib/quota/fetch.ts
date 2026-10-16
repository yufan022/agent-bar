import { AuthError } from "./auth.ts";
import { fetchCodex } from "./codex.ts";
import { fetchCursor, QuotaError } from "./cursor.ts";
import { comingSoon, errorSnapshot, type QuotaSnapshot } from "./model.ts";

export async function fetchAllAgents(): Promise<QuotaSnapshot[]> {
  return [
    await settle("cursor", "Cursor", fetchCursor),
    comingSoon("claude-code", "Claude Code"),
    await settle("codex", "Codex", fetchCodex),
    comingSoon("grok-build", "Grok Build"),
  ];
}

async function settle(
  id: string,
  name: string,
  fetchSnapshot: () => Promise<QuotaSnapshot>,
): Promise<QuotaSnapshot> {
  try {
    return await fetchSnapshot();
  } catch (error) {
    if (error instanceof QuotaError || error instanceof AuthError || error instanceof Error) {
      return errorSnapshot(id, name, error.message);
    }
    return errorSnapshot(id, name, String(error));
  }
}
