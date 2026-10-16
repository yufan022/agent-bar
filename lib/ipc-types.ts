import type { SyncReport } from "./bridge/report.ts";

export interface BridgeSyncRequest {
  from: string;
  to: string[];
  only: string[];
  dryRun: boolean;
  prune: boolean;
  force: boolean;
}

export interface BridgeSyncResponse {
  ok: boolean;
  report: SyncReport;
}

export type { AgentsQuotaResponse } from "./quota/model.ts";
