export type HttpProtocol = "sse" | "streamable-http";

export interface StdioTransport {
  kind: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface HttpTransport {
  kind: "http";
  url: string;
  headers: Record<string, string>;
  protocol: HttpProtocol;
}

export type McpTransport = StdioTransport | HttpTransport;

export interface McpServer {
  name: string;
  transport: McpTransport;
}

export interface McpDocument {
  servers: Record<string, McpServer>;
}

export function emptyDocument(): McpDocument {
  return { servers: {} };
}
