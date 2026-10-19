import type {
  AgentsQuotaResponse,
  BridgeSyncRequest,
  BridgeSyncResponse,
} from "./ipc-types.ts";
import type { DetailsReport, DiffReport, StatusReport } from "./bridge/report.ts";
import type { MonitorSnapshot } from "./monitor/model.ts";

export interface AgentBarApi {
  getAgentsQuota(): Promise<AgentsQuotaResponse>;
  refreshQuota(): Promise<AgentsQuotaResponse>;
  onQuotaUpdated(callback: (payload: AgentsQuotaResponse) => void): () => void;
  onOpenSettings(callback: () => void): () => void;
  onOpenMonitor(callback: () => void): () => void;
  monitorSample(): Promise<MonitorSnapshot>;
  bridgeStatus(tool: string | null): Promise<StatusReport>;
  bridgeDetails(tool: string): Promise<DetailsReport>;
  bridgeDiff(from: string, to: string): Promise<DiffReport>;
  bridgeSync(request: BridgeSyncRequest): Promise<BridgeSyncResponse>;
  autostartIsEnabled(): Promise<boolean>;
  autostartEnable(): Promise<void>;
  autostartDisable(): Promise<void>;
}
