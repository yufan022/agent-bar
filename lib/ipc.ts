import type {
  AgentsQuotaResponse,
  BridgeSyncRequest,
  BridgeSyncResponse,
} from "./ipc-types.ts";
import type { DetailsReport, DiffReport, StatusReport } from "./bridge/report.ts";

export interface AgentBarApi {
  getAgentsQuota(): Promise<AgentsQuotaResponse>;
  refreshQuota(): Promise<AgentsQuotaResponse>;
  onQuotaUpdated(callback: (payload: AgentsQuotaResponse) => void): () => void;
  onOpenSettings(callback: () => void): () => void;
  bridgeStatus(tool: string | null): Promise<StatusReport>;
  bridgeDetails(tool: string): Promise<DetailsReport>;
  bridgeDiff(from: string, to: string): Promise<DiffReport>;
  bridgeSync(request: BridgeSyncRequest): Promise<BridgeSyncResponse>;
  autostartIsEnabled(): Promise<boolean>;
  autostartEnable(): Promise<void>;
  autostartDisable(): Promise<void>;
}
