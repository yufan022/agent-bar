import type { AgentBarApi } from "../lib/ipc.ts";

function client(): AgentBarApi {
  if (!window.agentBar) {
    throw "agent-bar desktop bridge is unavailable";
  }
  return window.agentBar;
}

function unwrap<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return Promise.reject(message);
  });
}

export function getAgentsQuota() {
  return unwrap(client().getAgentsQuota());
}

export function refreshQuota() {
  return unwrap(client().refreshQuota());
}

export function onQuotaUpdated(
  callback: Parameters<AgentBarApi["onQuotaUpdated"]>[0],
): () => void {
  return client().onQuotaUpdated(callback);
}

export function onOpenSettings(callback: () => void): () => void {
  return client().onOpenSettings(callback);
}

export function onOpenMonitor(callback: () => void): () => void {
  return client().onOpenMonitor(callback);
}

export function monitorSample() {
  return unwrap(client().monitorSample());
}

export function bridgeStatus(tool: string | null) {
  return unwrap(client().bridgeStatus(tool));
}

export function bridgeDetails(tool: string) {
  return unwrap(client().bridgeDetails(tool));
}

export function bridgeDiff(from: string, to: string) {
  return unwrap(client().bridgeDiff(from, to));
}

export function bridgeSync(request: Parameters<AgentBarApi["bridgeSync"]>[0]) {
  return unwrap(client().bridgeSync(request));
}

export function autostartIsEnabled() {
  return unwrap(client().autostartIsEnabled());
}

export function autostartEnable() {
  return unwrap(client().autostartEnable());
}

export function autostartDisable() {
  return unwrap(client().autostartDisable());
}
