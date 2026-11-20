export interface CreativeAccountState {
  status: string;
  generation: number;
  identity: { userId: string; displayName: string; username: string } | null;
}
export interface CreativeAccountKey {
  id: string;
  name: string;
  masked_key: string;
  group: string;
  status: number;
  is_expired?: boolean;
  expired_time: number;
}
export interface CreativeAccountBinding {
  schemaVersion: 1;
  id: string;
  accountOrigin: string;
  userId: string;
  tokenId: string;
  name: string;
  keyMask: string;
  group: string;
  updatedAt: number;
}
export interface CreativeAccountBridge {
  collaboration?: import('./collaboration-types').CollaborationBridge;
  /** Optional native discussion backend; independent of Rabbit account login. */
  localCodex?: CreativeCodexBridge;
  state: CreativeAccountState;
  selectedKeyId?: string;
  manageAccount: () => void;
  /** Only built-in public tool IDs; never accepts credentials or arbitrary URLs. */
  openExternalTool?: (toolId: string) => Promise<void>;
  /** Native manual transport is independent of account connection state. */
  requestManual?: (url: string, init: RequestInit) => Promise<Response>;
  /** User-triggered image operations. No arbitrary destination path or URL. */
  imageAction?: (
    action: "copy" | "save" | "reveal",
    blob: Blob,
    name?: string,
  ) => Promise<"copied" | "saved" | "revealed" | "cancelled">;
  copyText?: (text: string) => Promise<void>;
  /** Materialize original video and copy its file, copy its path, or reveal it. */
  videoAction?: (
    action: "copy" | "copy-path" | "reveal",
    blob: Blob,
  ) => Promise<"copied" | "path-copied" | "revealed">;
  /** Save original media through a native dialog; no caller-controlled path. */
  saveMedia?: (
    blob: Blob,
    name: string,
    kind: "video" | "audio" | "archive",
  ) => Promise<"saved" | "cancelled">;
  listKeys: (
    page: number,
    search: string,
  ) => Promise<{ items: CreativeAccountKey[]; has_more: boolean }>;
  listBindings: () => Promise<CreativeAccountBinding[]>;
  bindKey: (tokenId: string) => Promise<CreativeAccountBinding>;
  request: (
    reference: string,
    url: string,
    init: RequestInit,
  ) => Promise<Response>;
}

export interface CreativeCodexModel {
  id: string;
  name: string;
  efforts: string[];
  defaultEffort: string | null;
  supportsImages: boolean;
}
export interface CreativeCodexBridge {
  capabilities?: () => Promise<import('./collaboration-types').CodexCapabilityCatalog>;
  approve?: (requestId: string, approvalId: string, allow: boolean) => Promise<void>;
  probe: () => Promise<{ models: CreativeCodexModel[]; defaultModel: string }>;
  request: (input: {
    model: string;
    effort?: string;
    prompt: string;
    images: string[];
    collaborationId?: string;
    sessionId?: string;
    userPrompt?: string;
    onActivity?: (value: import('./collaboration-types').CodexActivity) => void;
    onApproval?: (value: import('./collaboration-types').CodexApproval & { requestId: string }) => void;
    signal: AbortSignal;
    onUpdate: (value: { content: string; reasoning: string }) => void;
  }) => Promise<{ content: string; reasoning: string }>;
}
