use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn validate_dev_cache_root(path: String) -> Result<String, String> {
    crate::dev_cache::validate_configured_root(&path)
        .map(|managed| managed.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn scan_dev_cache() -> Result<crate::dev_cache::DevCacheScanResult, String> {
    let settings = crate::settings::get_settings().development_cache;
    tauri::async_runtime::spawn_blocking(move || crate::dev_cache::scan(&settings))
        .await
        .map_err(|e| format!("扫描开发缓存任务失败: {e}"))?
}

#[tauri::command]
pub async fn clean_dev_cache(
    #[allow(non_snake_case)] includeShared: bool,
) -> Result<crate::dev_cache::DevCacheCleanResult, String> {
    let settings = crate::settings::get_settings().development_cache;
    tauri::async_runtime::spawn_blocking(move || crate::dev_cache::clean(&settings, includeShared))
        .await
        .map_err(|e| format!("清理开发缓存任务失败: {e}"))?
}

#[tauri::command]
pub async fn get_dev_cache_global_status(
) -> Result<crate::dev_cache::GlobalEnvironmentStatus, String> {
    let settings = crate::settings::get_settings().development_cache;
    tauri::async_runtime::spawn_blocking(move || crate::dev_cache::global_status(&settings))
        .await
        .map_err(|e| format!("读取全局开发缓存状态失败: {e}"))?
}

#[tauri::command]
pub async fn open_dev_cache_directory(app: AppHandle) -> Result<bool, String> {
    let settings = crate::settings::get_settings().development_cache;
    let raw_root = settings
        .root_dir
        .as_deref()
        .ok_or_else(|| "尚未指定缓存目录".to_string())?;
    let managed_root = crate::dev_cache::ensure_configured_root(raw_root)?;
    app.opener()
        .open_path(managed_root.to_string_lossy().into_owned(), None::<String>)
        .map_err(|e| format!("打开开发缓存目录失败: {e}"))?;
    Ok(true)
}
