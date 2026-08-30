#![allow(non_snake_case)]

use tauri::State;

use crate::store::AppState;

/// Read the global Codex subagent concurrency setting from the active config.
#[tauri::command]
pub async fn get_codex_subagent_settings(
) -> Result<crate::codex_config::CodexSubagentSettings, String> {
    crate::codex_config::read_codex_subagent_settings().map_err(|error| error.to_string())
}

/// Set or clear the global Codex subagent concurrency setting.
///
/// The Codex switch lock serializes this update with provider and proxy writes
/// that also replace the live `config.toml`.
#[tauri::command]
pub async fn set_codex_subagent_max_concurrent_threads(
    state: State<'_, AppState>,
    value: Option<u64>,
) -> Result<crate::codex_config::CodexSubagentSettings, String> {
    let _guard = state
        .proxy_service
        .lock_switch_for_app(crate::app_config::AppType::Codex.as_str())
        .await;

    crate::codex_config::set_codex_subagent_max_concurrent_threads(value)
        .map_err(|error| error.to_string())
}
