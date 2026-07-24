import { invoke } from "@tauri-apps/api/core";
import type { SessionMessage, SessionMeta } from "@/types";

export interface DeleteSessionOptions {
  providerId: string;
  sessionId: string;
  sourcePath: string;
}

export interface DeleteSessionResult extends DeleteSessionOptions {
  success: boolean;
  error?: string;
}

export interface CodexHistoryIssue {
  sourceKind: string;
  path: string;
  message: string;
}

export interface CodexHistoryProviderBucketPreview {
  providerId: string;
  sessions: number;
}

export interface CodexHistoryUnificationPreview {
  totalSessions: number;
  activeSessions: number;
  archivedSessions: number;
  alreadyUnified: number;
  pendingMigration: number;
  metadataOnly: number;
  jsonlFiles: number;
  pendingJsonlFiles: number;
  stateRows: number;
  pendingStateRows: number;
  providerBuckets: CodexHistoryProviderBucketPreview[];
  skippedFiles: number;
  issues: CodexHistoryIssue[];
}

export interface CodexHistoryUnificationResult {
  migratedJsonlFiles: number;
  migratedStateRows: number;
  skippedFiles: number;
  skippedReason?: string;
  issues: CodexHistoryIssue[];
}

export const sessionsApi = {
  async list(): Promise<SessionMeta[]> {
    return await invoke("list_sessions");
  },

  async getMessages(
    providerId: string,
    sourcePath: string,
  ): Promise<SessionMessage[]> {
    return await invoke("get_session_messages", { providerId, sourcePath });
  },

  async previewCodexHistoryUnification(): Promise<CodexHistoryUnificationPreview> {
    return await invoke("preview_codex_history_unification");
  },

  async unifyAllCodexHistory(): Promise<CodexHistoryUnificationResult> {
    return await invoke("unify_all_codex_history");
  },

  async delete(options: DeleteSessionOptions): Promise<boolean> {
    const { providerId, sessionId, sourcePath } = options;
    return await invoke("delete_session", {
      providerId,
      sessionId,
      sourcePath,
    });
  },

  async deleteMany(
    items: DeleteSessionOptions[],
  ): Promise<DeleteSessionResult[]> {
    return await invoke("delete_sessions", { items });
  },

  async launchTerminal(options: {
    command: string;
    cwd?: string | null;
    customConfig?: string | null;
  }): Promise<boolean> {
    const { command, cwd, customConfig } = options;
    return await invoke("launch_session_terminal", {
      command,
      cwd,
      customConfig,
    });
  },
};
