use crate::codex_locale::{self, CodexLocaleStatus};

#[tauri::command]
pub async fn get_codex_locale_status() -> Result<CodexLocaleStatus, String> {
    codex_locale::get_status().map_err(Into::into)
}

#[tauri::command]
pub async fn set_codex_simplified_chinese(enabled: bool) -> Result<CodexLocaleStatus, String> {
    codex_locale::set_simplified_chinese(enabled).map_err(Into::into)
}
