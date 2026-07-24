import { invoke } from "@tauri-apps/api/core";

export interface CodexLocaleStatus {
  installed: boolean;
  version: string | null;
  chineseResourcesAvailable: boolean;
  localeOverride: string | null;
  chineseEnabled: boolean;
  restartRequired: boolean;
}

export const codexLocaleApi = {
  getStatus(): Promise<CodexLocaleStatus> {
    return invoke("get_codex_locale_status");
  },

  setSimplifiedChinese(enabled: boolean): Promise<CodexLocaleStatus> {
    return invoke("set_codex_simplified_chinese", { enabled });
  },
};
