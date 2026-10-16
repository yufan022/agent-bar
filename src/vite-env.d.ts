/// <reference types="vite/client" />

import type { AgentBarApi } from "../lib/ipc.ts";

declare global {
  interface Window {
    agentBar?: AgentBarApi;
  }
}

export {};
