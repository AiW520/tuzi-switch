/** Shared contract. No provider credentials or arbitrary shell commands cross this bridge. */
export interface CollaborationScope {
  boardId: string;
  sessionId: string;
}
export interface CollaborationCall {
  id: string;
  scope: CollaborationScope;
  name: string;
  arguments: Record<string, unknown>;
  expiresAt: number;
}
export interface CollaborationBridge {
  start(
    scope: CollaborationScope,
    handle: (call: CollaborationCall) => Promise<unknown>,
  ): Promise<{
    id: string;
    configuration: string;
  }>;
  stop(id: string): Promise<void>;
}
export interface CodexCapabilityCatalog {
  skills: Array<{
    name: string;
    description: string;
    path: string;
    enabled: boolean;
  }>;
  servers: Array<{ name: string; tools: string[]; authStatus: string }>;
  errors: string[];
}
export interface CodexActivity {
  id: string;
  kind: string;
  label: string;
  status: string;
}
export interface CodexApproval {
  id: string;
  kind: string;
  description: string;
}
