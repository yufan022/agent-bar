import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AgentBarApi } from "../lib/ipc.ts";
import type { AgentsQuotaResponse, BridgeSyncRequest } from "../lib/ipc-types.ts";
import type { MonitorSnapshot } from "../lib/monitor/model.ts";

const api: AgentBarApi = {
  getAgentsQuota: () => ipcRenderer.invoke("quota:get"),
  refreshQuota: () => ipcRenderer.invoke("quota:refresh"),
  onQuotaUpdated: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: AgentsQuotaResponse) => {
      callback(payload);
    };
    ipcRenderer.on("quota-updated", listener);
    return () => {
      ipcRenderer.removeListener("quota-updated", listener);
    };
  },
  onOpenSettings: (callback) => {
    const listener = () => {
      callback();
    };
    ipcRenderer.on("open-settings", listener);
    return () => {
      ipcRenderer.removeListener("open-settings", listener);
    };
  },
  onOpenMonitor: (callback) => {
    const listener = () => {
      callback();
    };
    ipcRenderer.on("open-monitor", listener);
    return () => {
      ipcRenderer.removeListener("open-monitor", listener);
    };
  },
  monitorSample: () => ipcRenderer.invoke("monitor:sample") as Promise<MonitorSnapshot>,
  bridgeStatus: (tool) => ipcRenderer.invoke("bridge:status", tool),
  bridgeDetails: (tool) => ipcRenderer.invoke("bridge:details", tool),
  bridgeDiff: (from, to) => ipcRenderer.invoke("bridge:diff", from, to),
  bridgeSync: (request: BridgeSyncRequest) => ipcRenderer.invoke("bridge:sync", request),
  autostartIsEnabled: () => ipcRenderer.invoke("autostart:is-enabled"),
  autostartEnable: () => ipcRenderer.invoke("autostart:enable"),
  autostartDisable: () => ipcRenderer.invoke("autostart:disable"),
};

contextBridge.exposeInMainWorld("agentBar", api);
