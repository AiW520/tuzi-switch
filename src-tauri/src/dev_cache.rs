use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::types::FromRegValue;
#[cfg(target_os = "windows")]
use winreg::{RegKey, RegValue};

use crate::settings::DevelopmentCacheSettings;

const MANAGED_DIR_NAME: &str = "tuzi-switch-cache";
const MARKER_FILE: &str = ".managed-cache.json";
const MARKER_KIND: &str = "tuzi-switch-development-cache-v1";
const SESSION_COMPLETED_FILE: &str = ".completed";
const MAX_DIAGNOSTICS: usize = 100;
const GLOBAL_ENV_BACKUP_FILE: &str = "dev-cache-env-backup.json";
const GLOBAL_ENV_BACKUP_KIND: &str = "tuzi-switch-development-cache-env-v1";
const MAX_REGISTRY_VALUE_BYTES: usize = 64 * 1024;
const MAX_GLOBAL_BACKUP_BYTES: u64 = 4 * 1024 * 1024;
const GLOBAL_ENV_NAMES: [&str; 8] = [
    "TEMP",
    "TMP",
    "TMPDIR",
    "npm_config_cache",
    "YARN_CACHE_FOLDER",
    "npm_config_store_dir",
    "PIP_CACHE_DIR",
    "UV_CACHE_DIR",
];
static GLOBAL_ENV_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalEnvironmentVariableStatus {
    pub name: String,
    pub expected: Option<String>,
    pub current: Option<String>,
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalEnvironmentStatus {
    pub supported: bool,
    pub enabled: bool,
    pub applied: bool,
    pub has_backup: bool,
    pub has_conflict: bool,
    pub managed_root: Option<String>,
    pub variables: Vec<GlobalEnvironmentVariableStatus>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlobalEnvironmentBackup {
    kind: String,
    managed_root: String,
    entries: BTreeMap<String, GlobalEnvironmentBackupEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlobalEnvironmentBackupEntry {
    original: Option<RawRegistryValue>,
    written: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRegistryValue {
    value_type: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheCategoryStat {
    pub id: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub directory_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevCacheScanResult {
    pub enabled: bool,
    pub configured_root: Option<String>,
    pub managed_root: Option<String>,
    pub exists: bool,
    pub size_bytes: u64,
    pub file_count: u64,
    pub directory_count: u64,
    pub expired_session_count: u64,
    pub expired_session_bytes: u64,
    pub categories: Vec<CacheCategoryStat>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevCacheCleanResult {
    pub removed_bytes: u64,
    pub removed_files: u64,
    pub removed_directories: u64,
    pub skipped_items: u64,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct LaunchCacheContext {
    pub env_vars: Vec<(String, String)>,
    pub session_dir: PathBuf,
    pub completion_marker: PathBuf,
    pub cleanup_on_session_end: bool,
}

pub fn routed_environment(
    settings: &DevelopmentCacheSettings,
    session_temp: Option<&Path>,
) -> Result<Vec<(String, String)>, String> {
    if !settings.enabled {
        return Ok(Vec::new());
    }
    let raw_root = settings
        .root_dir
        .as_deref()
        .ok_or_else(|| "已启用开发缓存，但尚未指定缓存目录".to_string())?;
    let managed_root = ensure_configured_root(raw_root)?;
    let mut env_vars = Vec::with_capacity(8);
    if settings.route_temp {
        let temp_dir = session_temp
            .map(Path::to_path_buf)
            .unwrap_or_else(|| managed_root.join("global-temp"));
        fs::create_dir_all(&temp_dir).map_err(|e| format!("创建临时缓存目录失败: {e}"))?;
        let value = temp_dir.to_string_lossy().into_owned();
        env_vars.push(("TEMP".to_string(), value.clone()));
        env_vars.push(("TMP".to_string(), value));
    }
    if settings.route_node {
        let shared = managed_root.join("shared");
        env_vars.push((
            "npm_config_cache".to_string(),
            shared.join("npm").to_string_lossy().into_owned(),
        ));
        env_vars.push((
            "YARN_CACHE_FOLDER".to_string(),
            shared.join("yarn").to_string_lossy().into_owned(),
        ));
        env_vars.push((
            "npm_config_store_dir".to_string(),
            shared.join("pnpm-store").to_string_lossy().into_owned(),
        ));
    }
    if settings.route_python {
        let shared = managed_root.join("shared");
        env_vars.push((
            "PIP_CACHE_DIR".to_string(),
            shared.join("pip").to_string_lossy().into_owned(),
        ));
        env_vars.push((
            "UV_CACHE_DIR".to_string(),
            shared.join("uv").to_string_lossy().into_owned(),
        ));
    }
    Ok(env_vars)
}

#[derive(Default)]
struct TreeStat {
    size_bytes: u64,
    file_count: u64,
    directory_count: u64,
}

pub fn validate_configured_root(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("缓存目录不能为空".to_string());
    }
    if trimmed.contains('\n') || trimmed.contains('\r') {
        return Err("缓存目录包含非法换行符".to_string());
    }

    let candidate = PathBuf::from(trimmed);
    if !candidate.is_absolute() {
        return Err("缓存目录必须使用绝对路径".to_string());
    }
    if candidate
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("缓存目录不能包含上级路径片段".to_string());
    }
    if candidate.parent().is_none() {
        return Err("不能将磁盘根目录用作缓存目录".to_string());
    }

    let home = crate::config::get_home_dir();
    if same_path(&candidate, &home) {
        return Err("不能将用户主目录用作缓存目录".to_string());
    }
    let app_config = crate::config::get_app_config_dir();
    if same_path(&candidate, &app_config) || is_within(&candidate, &app_config) {
        return Err("缓存目录不能位于兔子 Switch 配置目录中".to_string());
    }
    if let Ok(current_dir) = std::env::current_dir() {
        if same_path(&candidate, &current_dir) || is_within(&candidate, &current_dir) {
            return Err("缓存目录不能位于当前项目目录中".to_string());
        }
    }
    reject_linked_ancestors(&candidate)?;

    Ok(candidate.join(MANAGED_DIR_NAME))
}

pub fn ensure_configured_root(raw: &str) -> Result<PathBuf, String> {
    let managed_root = validate_configured_root(raw)?;
    ensure_managed_root(&managed_root)?;
    Ok(managed_root)
}

pub fn prepare_launch_context(
    settings: &DevelopmentCacheSettings,
) -> Result<Option<LaunchCacheContext>, String> {
    if !settings.enabled {
        return Ok(None);
    }
    let raw_root = settings
        .root_dir
        .as_deref()
        .ok_or_else(|| "已启用开发缓存，但尚未指定缓存目录".to_string())?;
    let managed_root = validate_configured_root(raw_root)?;
    ensure_managed_root(&managed_root)?;

    let session_id = uuid::Uuid::new_v4().simple().to_string();
    let session_dir = managed_root.join("sessions").join(session_id);
    let temp_dir = session_dir.join("temp");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("创建会话缓存目录失败: {e}"))?;
    fs::write(
        session_dir.join("lease.json"),
        format!(
            "{{\"kind\":\"{}\",\"createdAt\":{}}}",
            MARKER_KIND,
            unix_timestamp()
        ),
    )
    .map_err(|e| format!("写入缓存会话租约失败: {e}"))?;

    let mut env_vars = routed_environment(settings, Some(&temp_dir))?;
    if settings.route_temp {
        env_vars.push((
            "TMPDIR".to_string(),
            temp_dir.to_string_lossy().into_owned(),
        ));
    }

    Ok(Some(LaunchCacheContext {
        env_vars,
        completion_marker: session_dir.join(SESSION_COMPLETED_FILE),
        session_dir,
        cleanup_on_session_end: settings.cleanup_on_session_end,
    }))
}

pub fn scan(settings: &DevelopmentCacheSettings) -> Result<DevCacheScanResult, String> {
    let configured_root = settings.root_dir.clone();
    let Some(raw_root) = configured_root.as_deref() else {
        return Ok(empty_scan(settings.enabled, None, None));
    };
    let managed_root = validate_configured_root(raw_root)?;
    if !managed_root.exists() {
        return Ok(empty_scan(
            settings.enabled,
            configured_root,
            Some(managed_root.to_string_lossy().into_owned()),
        ));
    }
    verify_marker(&managed_root)?;

    let mut categories = Vec::new();
    let mut total = TreeStat::default();
    let mut warnings = Vec::new();
    for id in ["sessions", "shared", "global-temp", "projects"] {
        let path = managed_root.join(id);
        let stat = scan_tree(&path, &mut warnings)?;
        total.size_bytes = total.size_bytes.saturating_add(stat.size_bytes);
        total.file_count = total.file_count.saturating_add(stat.file_count);
        total.directory_count = total.directory_count.saturating_add(stat.directory_count);
        categories.push(CacheCategoryStat {
            id: id.to_string(),
            size_bytes: stat.size_bytes,
            file_count: stat.file_count,
            directory_count: stat.directory_count,
        });
    }

    let (expired_session_count, expired_session_bytes) =
        scan_expired_sessions(&managed_root, settings.retention_hours, &mut warnings)?;

    Ok(DevCacheScanResult {
        enabled: settings.enabled,
        configured_root,
        managed_root: Some(managed_root.to_string_lossy().into_owned()),
        exists: true,
        size_bytes: total.size_bytes,
        file_count: total.file_count,
        directory_count: total.directory_count,
        expired_session_count,
        expired_session_bytes,
        categories,
        warnings,
    })
}

pub fn clean(
    settings: &DevelopmentCacheSettings,
    include_shared: bool,
) -> Result<DevCacheCleanResult, String> {
    if include_shared && settings.enabled {
        return Err("请先关闭开发缓存并退出相关终端或 IDE，再清理共享缓存".to_string());
    }
    let raw_root = settings
        .root_dir
        .as_deref()
        .ok_or_else(|| "尚未指定缓存目录".to_string())?;
    let managed_root = validate_configured_root(raw_root)?;
    if !managed_root.exists() {
        return Ok(DevCacheCleanResult {
            removed_bytes: 0,
            removed_files: 0,
            removed_directories: 0,
            skipped_items: 0,
            errors: Vec::new(),
        });
    }
    verify_marker(&managed_root)?;

    let mut result = DevCacheCleanResult {
        removed_bytes: 0,
        removed_files: 0,
        removed_directories: 0,
        skipped_items: 0,
        errors: Vec::new(),
    };
    clean_expired_sessions(&managed_root, settings.retention_hours, &mut result)?;
    if include_shared {
        for id in ["shared", "global-temp"] {
            let path = managed_root.join(id);
            if path.exists() {
                remove_managed_tree(&managed_root, &path, &mut result);
            }
            if let Err(e) = fs::create_dir_all(&path) {
                push_diagnostic(&mut result.errors, format!("重建 {id} 目录失败: {e}"));
            }
        }
    }
    Ok(result)
}

/// Synchronize HKCU\Environment after development-cache settings change.
///
/// Enabling or changing global routing is transactional: registry values are
/// rolled back if any write or backup-file update fails. Disabling restores
/// the exact raw registry values captured before the first enable operation.
pub fn sync_global_environment(
    old: &DevelopmentCacheSettings,
    new: &DevelopmentCacheSettings,
) -> Result<GlobalEnvironmentStatus, String> {
    let _guard = GLOBAL_ENV_LOCK
        .lock()
        .map_err(|_| "全局缓存环境变量同步锁已损坏".to_string())?;
    #[cfg(target_os = "windows")]
    {
        if global_mode_enabled(new) {
            apply_global_environment(new)?;
        } else if global_mode_enabled(old) || global_backup_path().exists() {
            restore_global_environment()?;
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (old, new);
        if global_mode_enabled(new) {
            return Err("全局开发缓存环境变量目前仅支持 Windows".to_string());
        }
    }
    global_status_unlocked(new)
}

pub fn global_status(
    settings: &DevelopmentCacheSettings,
) -> Result<GlobalEnvironmentStatus, String> {
    let _guard = GLOBAL_ENV_LOCK
        .lock()
        .map_err(|_| "全局缓存环境变量状态锁已损坏".to_string())?;
    global_status_unlocked(settings)
}

/// Reconcile persisted settings at application startup without preventing
/// startup. Conflicts are deliberately left untouched and logged.
pub fn reconcile_best_effort() {
    let settings = crate::settings::get_settings().development_cache;
    let _guard = match GLOBAL_ENV_LOCK.lock() {
        Ok(guard) => guard,
        Err(_) => {
            log::warn!("全局缓存环境变量同步锁已损坏");
            return;
        }
    };
    #[cfg(target_os = "windows")]
    let result = if global_mode_enabled(&settings) {
        apply_global_environment(&settings)
    } else if global_backup_path().exists() {
        restore_global_environment()
    } else {
        Ok(())
    };
    #[cfg(not(target_os = "windows"))]
    let result: Result<(), String> = Ok(());
    if let Err(error) = result {
        log::warn!("同步全局开发缓存环境变量失败，已保留现状: {error}");
    }
}

fn global_mode_enabled(settings: &DevelopmentCacheSettings) -> bool {
    settings.enabled && settings.global_mode
}

fn desired_global_environment(
    settings: &DevelopmentCacheSettings,
) -> Result<(PathBuf, BTreeMap<String, String>), String> {
    if !global_mode_enabled(settings) {
        return Ok((PathBuf::new(), BTreeMap::new()));
    }
    let raw_root = settings
        .root_dir
        .as_deref()
        .ok_or_else(|| "启用全局开发缓存前必须指定缓存目录".to_string())?;
    let managed_root = validate_configured_root(raw_root)?;
    let shared = managed_root.join("shared");
    let mut desired = BTreeMap::new();
    if settings.route_temp {
        let value = managed_root
            .join("global-temp")
            .to_string_lossy()
            .into_owned();
        desired.insert("TEMP".to_string(), value.clone());
        desired.insert("TMP".to_string(), value.clone());
        desired.insert("TMPDIR".to_string(), value);
    }
    if settings.route_node {
        desired.insert(
            "npm_config_cache".to_string(),
            shared.join("npm").to_string_lossy().into_owned(),
        );
        desired.insert(
            "YARN_CACHE_FOLDER".to_string(),
            shared.join("yarn").to_string_lossy().into_owned(),
        );
        desired.insert(
            "npm_config_store_dir".to_string(),
            shared.join("pnpm-store").to_string_lossy().into_owned(),
        );
    }
    if settings.route_python {
        desired.insert(
            "PIP_CACHE_DIR".to_string(),
            shared.join("pip").to_string_lossy().into_owned(),
        );
        desired.insert(
            "UV_CACHE_DIR".to_string(),
            shared.join("uv").to_string_lossy().into_owned(),
        );
    }
    Ok((managed_root, desired))
}

fn global_backup_path() -> PathBuf {
    crate::config::get_app_config_dir().join(GLOBAL_ENV_BACKUP_FILE)
}

#[cfg(target_os = "windows")]
fn apply_global_environment(settings: &DevelopmentCacheSettings) -> Result<(), String> {
    let (managed_root, desired) = desired_global_environment(settings)?;
    ensure_managed_root(&managed_root)?;
    for value in desired.values() {
        let path = PathBuf::from(value);
        if !is_within(&path, &managed_root) {
            return Err(format!("拒绝写入越界的全局缓存目录: {}", path.display()));
        }
        fs::create_dir_all(&path)
            .map_err(|e| format!("创建全局缓存目录 {} 失败: {e}", path.display()))?;
    }

    let key = open_user_environment(true)?;
    let existing_backup = load_global_backup()?;
    if let Some(backup) = existing_backup.as_ref() {
        ensure_backup_owned(&key, backup)?;
    }

    let mut next_entries = existing_backup
        .as_ref()
        .map(|backup| backup.entries.clone())
        .unwrap_or_default();
    for name in desired.keys() {
        if !next_entries.contains_key(name) {
            next_entries.insert(
                name.clone(),
                GlobalEnvironmentBackupEntry {
                    original: read_registry_raw(&key, name)?.map(raw_registry_to_backup),
                    written: String::new(),
                },
            );
        }
    }

    let changed_names: BTreeSet<String> =
        next_entries.keys().chain(desired.keys()).cloned().collect();
    let snapshot = snapshot_registry(&key, &changed_names)?;

    let operation = (|| {
        let stale_names: Vec<String> = next_entries
            .keys()
            .filter(|name| !desired.contains_key(*name))
            .cloned()
            .collect();
        for name in stale_names {
            if let Some(entry) = next_entries.remove(&name) {
                write_backup_value(&key, &name, entry.original.as_ref())?;
            }
        }
        for (name, value) in &desired {
            key.set_value(name, value)
                .map_err(|e| format!("写入用户环境变量 {name} 失败: {e}"))?;
            if let Some(entry) = next_entries.get_mut(name) {
                entry.written.clone_from(value);
            }
        }
        let backup = GlobalEnvironmentBackup {
            kind: GLOBAL_ENV_BACKUP_KIND.to_string(),
            managed_root: managed_root.to_string_lossy().into_owned(),
            entries: next_entries,
        };
        write_global_backup(&backup)
    })();

    if let Err(error) = operation {
        rollback_registry(&key, &snapshot);
        return Err(format!("应用全局开发缓存失败，注册表已回滚: {error}"));
    }
    sync_process_environment(&key, &changed_names);
    broadcast_environment_change();
    Ok(())
}

#[cfg(target_os = "windows")]
fn restore_global_environment() -> Result<(), String> {
    let Some(backup) = load_global_backup()? else {
        return Ok(());
    };
    let key = open_user_environment(true)?;
    ensure_backup_owned(&key, &backup)?;
    let names: BTreeSet<String> = backup.entries.keys().cloned().collect();
    let snapshot = snapshot_registry(&key, &names)?;
    for (name, entry) in &backup.entries {
        if let Err(error) = write_backup_value(&key, name, entry.original.as_ref()) {
            rollback_registry(&key, &snapshot);
            return Err(format!(
                "恢复全局开发缓存环境变量失败，注册表已回滚: {error}"
            ));
        }
    }
    if let Err(error) = fs::remove_file(global_backup_path()) {
        rollback_registry(&key, &snapshot);
        return Err(format!(
            "删除全局缓存环境变量备份失败，注册表已回滚: {error}"
        ));
    }
    sync_process_environment(&key, &names);
    broadcast_environment_change();
    Ok(())
}

#[cfg(target_os = "windows")]
fn global_status_unlocked(
    settings: &DevelopmentCacheSettings,
) -> Result<GlobalEnvironmentStatus, String> {
    let enabled = global_mode_enabled(settings);
    let desired_result = desired_global_environment(settings);
    let (managed_root, desired) = match desired_result {
        Ok((root, desired)) => (
            (!root.as_os_str().is_empty()).then(|| root.to_string_lossy().into_owned()),
            desired,
        ),
        Err(error) => {
            return Ok(GlobalEnvironmentStatus {
                supported: true,
                enabled,
                applied: false,
                has_backup: global_backup_path().exists(),
                has_conflict: true,
                managed_root: None,
                variables: Vec::new(),
                warnings: vec![error],
            });
        }
    };
    let backup = load_global_backup()?;
    let key = open_user_environment(false)?;
    let names: BTreeSet<String> = GLOBAL_ENV_NAMES
        .iter()
        .filter(|name| {
            desired.contains_key(**name)
                || backup
                    .as_ref()
                    .is_some_and(|b| b.entries.contains_key(**name))
        })
        .map(|name| (*name).to_string())
        .collect();
    let mut variables = Vec::with_capacity(names.len());
    let mut has_conflict = false;
    let mut applied = enabled && backup.is_some();
    for name in names {
        let raw = read_registry_raw(&key, &name)?;
        let current = raw.as_ref().and_then(registry_value_as_string);
        let expected = desired.get(&name).cloned();
        let state = if let Some(entry) = backup.as_ref().and_then(|b| b.entries.get(&name)) {
            if current.as_deref() != Some(entry.written.as_str()) {
                has_conflict = true;
                applied = false;
                "conflict"
            } else if expected.as_deref() == current.as_deref() {
                "managed"
            } else {
                applied = false;
                "stale"
            }
        } else if expected.as_deref() == current.as_deref() {
            applied = false;
            "untracked"
        } else {
            applied = false;
            "notApplied"
        };
        variables.push(GlobalEnvironmentVariableStatus {
            name,
            expected,
            current,
            state: state.to_string(),
        });
    }
    Ok(GlobalEnvironmentStatus {
        supported: true,
        enabled,
        applied,
        has_backup: backup.is_some(),
        has_conflict,
        managed_root,
        variables,
        warnings: Vec::new(),
    })
}

#[cfg(target_os = "windows")]
fn open_user_environment(write: bool) -> Result<RegKey, String> {
    let access = if write {
        KEY_READ | KEY_WRITE
    } else {
        KEY_READ
    };
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags("Environment", access)
        .map_err(|e| format!("打开 HKCU\\Environment 失败: {e}"))
}

#[cfg(target_os = "windows")]
fn read_registry_raw(key: &RegKey, name: &str) -> Result<Option<RegValue>, String> {
    match key.get_raw_value(name) {
        Ok(value) => {
            if value.bytes.len() > MAX_REGISTRY_VALUE_BYTES {
                return Err(format!("用户环境变量 {name} 超过安全备份大小限制"));
            }
            Ok(Some(value))
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("读取用户环境变量 {name} 失败: {error}")),
    }
}

#[cfg(target_os = "windows")]
fn registry_value_as_string(value: &RegValue) -> Option<String> {
    match value.vtype {
        REG_SZ | REG_EXPAND_SZ => String::from_reg_value(value).ok(),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn raw_registry_to_backup(value: RegValue) -> RawRegistryValue {
    RawRegistryValue {
        value_type: registry_type_name(value.vtype).to_string(),
        bytes: value.bytes,
    }
}

#[cfg(target_os = "windows")]
fn backup_to_raw_registry(value: &RawRegistryValue) -> Result<RegValue, String> {
    if value.bytes.len() > MAX_REGISTRY_VALUE_BYTES {
        return Err("备份中的注册表值超过安全大小限制".to_string());
    }
    let vtype = registry_type_from_name(&value.value_type)
        .ok_or_else(|| format!("备份包含未知注册表值类型: {}", value.value_type))?;
    Ok(RegValue {
        bytes: value.bytes.clone(),
        vtype,
    })
}

#[cfg(target_os = "windows")]
fn registry_type_name(value_type: RegType) -> &'static str {
    match value_type {
        REG_NONE => "REG_NONE",
        REG_SZ => "REG_SZ",
        REG_EXPAND_SZ => "REG_EXPAND_SZ",
        REG_BINARY => "REG_BINARY",
        REG_DWORD => "REG_DWORD",
        REG_DWORD_BIG_ENDIAN => "REG_DWORD_BIG_ENDIAN",
        REG_LINK => "REG_LINK",
        REG_MULTI_SZ => "REG_MULTI_SZ",
        REG_RESOURCE_LIST => "REG_RESOURCE_LIST",
        REG_FULL_RESOURCE_DESCRIPTOR => "REG_FULL_RESOURCE_DESCRIPTOR",
        REG_RESOURCE_REQUIREMENTS_LIST => "REG_RESOURCE_REQUIREMENTS_LIST",
        REG_QWORD => "REG_QWORD",
    }
}

#[cfg(target_os = "windows")]
fn registry_type_from_name(name: &str) -> Option<RegType> {
    Some(match name {
        "REG_NONE" => REG_NONE,
        "REG_SZ" => REG_SZ,
        "REG_EXPAND_SZ" => REG_EXPAND_SZ,
        "REG_BINARY" => REG_BINARY,
        "REG_DWORD" => REG_DWORD,
        "REG_DWORD_BIG_ENDIAN" => REG_DWORD_BIG_ENDIAN,
        "REG_LINK" => REG_LINK,
        "REG_MULTI_SZ" => REG_MULTI_SZ,
        "REG_RESOURCE_LIST" => REG_RESOURCE_LIST,
        "REG_FULL_RESOURCE_DESCRIPTOR" => REG_FULL_RESOURCE_DESCRIPTOR,
        "REG_RESOURCE_REQUIREMENTS_LIST" => REG_RESOURCE_REQUIREMENTS_LIST,
        "REG_QWORD" => REG_QWORD,
        _ => return None,
    })
}

#[cfg(target_os = "windows")]
fn write_backup_value(
    key: &RegKey,
    name: &str,
    value: Option<&RawRegistryValue>,
) -> Result<(), String> {
    match value {
        Some(value) => key
            .set_raw_value(name, &backup_to_raw_registry(value)?)
            .map_err(|e| format!("恢复用户环境变量 {name} 失败: {e}")),
        None => match key.delete_value(name) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("删除用户环境变量 {name} 失败: {error}")),
        },
    }
}

#[cfg(target_os = "windows")]
fn snapshot_registry(
    key: &RegKey,
    names: &BTreeSet<String>,
) -> Result<BTreeMap<String, Option<RawRegistryValue>>, String> {
    let mut snapshot = BTreeMap::new();
    for name in names {
        snapshot.insert(
            name.clone(),
            read_registry_raw(key, name)?.map(raw_registry_to_backup),
        );
    }
    Ok(snapshot)
}

#[cfg(target_os = "windows")]
fn rollback_registry(key: &RegKey, snapshot: &BTreeMap<String, Option<RawRegistryValue>>) {
    for (name, value) in snapshot {
        if let Err(error) = write_backup_value(key, name, value.as_ref()) {
            log::error!("回滚用户环境变量 {name} 失败: {error}");
        }
    }
}

#[cfg(target_os = "windows")]
fn ensure_backup_owned(key: &RegKey, backup: &GlobalEnvironmentBackup) -> Result<(), String> {
    validate_global_backup(backup)?;
    let mut conflicts = Vec::new();
    for (name, entry) in &backup.entries {
        let current = read_registry_raw(key, name)?;
        if current
            .as_ref()
            .and_then(registry_value_as_string)
            .as_deref()
            != Some(entry.written.as_str())
        {
            if conflicts.len() < MAX_DIAGNOSTICS {
                conflicts.push(name.clone());
            }
        }
    }
    if conflicts.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "检测到环境变量被外部修改，已拒绝覆盖: {}",
            conflicts.join(", ")
        ))
    }
}

fn validate_global_backup(backup: &GlobalEnvironmentBackup) -> Result<(), String> {
    if backup.kind != GLOBAL_ENV_BACKUP_KIND {
        return Err("全局缓存环境变量备份标记无效".to_string());
    }
    if backup.entries.len() > GLOBAL_ENV_NAMES.len()
        || backup
            .entries
            .keys()
            .any(|name| !GLOBAL_ENV_NAMES.contains(&name.as_str()))
    {
        return Err("全局缓存环境变量备份包含非托管变量".to_string());
    }
    for entry in backup.entries.values() {
        if entry.written.len() > MAX_REGISTRY_VALUE_BYTES
            || entry
                .original
                .as_ref()
                .is_some_and(|value| value.bytes.len() > MAX_REGISTRY_VALUE_BYTES)
        {
            return Err("全局缓存环境变量备份超过安全大小限制".to_string());
        }
    }
    Ok(())
}

fn load_global_backup() -> Result<Option<GlobalEnvironmentBackup>, String> {
    let path = global_backup_path();
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("读取全局缓存环境变量备份信息失败: {error}")),
    };
    if metadata.len() > MAX_GLOBAL_BACKUP_BYTES {
        return Err("全局缓存环境变量备份文件超过安全大小限制".to_string());
    }
    let content = fs::read(&path).map_err(|e| format!("读取全局缓存环境变量备份失败: {e}"))?;
    let backup: GlobalEnvironmentBackup = serde_json::from_slice(&content)
        .map_err(|e| format!("解析全局缓存环境变量备份失败: {e}"))?;
    validate_global_backup(&backup)?;
    Ok(Some(backup))
}

fn write_global_backup(backup: &GlobalEnvironmentBackup) -> Result<(), String> {
    validate_global_backup(backup)?;
    let path = global_backup_path();
    let parent = path
        .parent()
        .ok_or_else(|| "无法确定全局缓存环境变量备份目录".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    let data = serde_json::to_vec_pretty(backup)
        .map_err(|e| format!("序列化全局缓存环境变量备份失败: {e}"))?;
    let temp_path = parent.join(format!(
        ".{GLOBAL_ENV_BACKUP_FILE}.{}.tmp",
        uuid::Uuid::new_v4().simple()
    ));
    let write_result = (|| {
        let mut file = fs::File::create(&temp_path)
            .map_err(|e| format!("创建全局缓存环境变量临时备份失败: {e}"))?;
        file.write_all(&data)
            .map_err(|e| format!("写入全局缓存环境变量临时备份失败: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("落盘全局缓存环境变量临时备份失败: {e}"))?;
        replace_backup_file(&temp_path, &path)
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

#[cfg(target_os = "windows")]
fn replace_backup_file(source: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let moved = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(format!(
            "提交全局缓存环境变量备份失败: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn replace_backup_file(source: &Path, target: &Path) -> Result<(), String> {
    fs::rename(source, target).map_err(|e| format!("提交全局缓存环境变量备份失败: {e}"))
}

#[cfg(target_os = "windows")]
fn sync_process_environment(key: &RegKey, names: &BTreeSet<String>) {
    for name in names {
        match read_registry_raw(key, name) {
            Ok(Some(value)) => {
                if let Some(value) = registry_value_as_string(&value) {
                    // This process owns synchronization; callers serialize it with GLOBAL_ENV_LOCK.
                    unsafe { std::env::set_var(name, value) };
                } else {
                    unsafe { std::env::remove_var(name) };
                }
            }
            Ok(None) => unsafe { std::env::remove_var(name) },
            Err(error) => log::warn!("同步当前进程环境变量 {name} 失败: {error}"),
        }
    }
}

#[cfg(target_os = "windows")]
fn broadcast_environment_change() {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    type Hwnd = *mut c_void;
    #[link(name = "user32")]
    extern "system" {
        fn SendMessageTimeoutW(
            hwnd: Hwnd,
            message: u32,
            wparam: usize,
            lparam: isize,
            flags: u32,
            timeout: u32,
            result: *mut usize,
        ) -> isize;
    }
    const HWND_BROADCAST: Hwnd = 0xffffusize as Hwnd;
    const WM_SETTINGCHANGE: u32 = 0x001a;
    const SMTO_ABORTIFHUNG: u32 = 0x0002;
    let environment: Vec<u16> = std::ffi::OsStr::new("Environment")
        .encode_wide()
        .chain(Some(0))
        .collect();
    let mut result = 0usize;
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            environment.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            3000,
            &mut result,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn global_status_unlocked(
    settings: &DevelopmentCacheSettings,
) -> Result<GlobalEnvironmentStatus, String> {
    Ok(GlobalEnvironmentStatus {
        supported: false,
        enabled: global_mode_enabled(settings),
        applied: false,
        has_backup: false,
        has_conflict: false,
        managed_root: None,
        variables: Vec::new(),
        warnings: vec!["全局开发缓存环境变量目前仅支持 Windows".to_string()],
    })
}

pub fn cleanup_stale_sessions_best_effort() {
    let settings = crate::settings::get_settings().development_cache;
    if settings.root_dir.is_none() {
        return;
    }
    if let Err(error) = clean(&settings, false) {
        log::warn!("清理过期开发缓存会话失败: {error}");
    }
}

fn empty_scan(
    enabled: bool,
    configured_root: Option<String>,
    managed_root: Option<String>,
) -> DevCacheScanResult {
    DevCacheScanResult {
        enabled,
        configured_root,
        managed_root,
        exists: false,
        size_bytes: 0,
        file_count: 0,
        directory_count: 0,
        expired_session_count: 0,
        expired_session_bytes: 0,
        categories: Vec::new(),
        warnings: Vec::new(),
    }
}

fn ensure_managed_root(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root.join("sessions")).map_err(|e| format!("创建缓存目录失败: {e}"))?;
    fs::create_dir_all(root.join("shared")).map_err(|e| format!("创建缓存目录失败: {e}"))?;
    fs::create_dir_all(root.join("projects")).map_err(|e| format!("创建缓存目录失败: {e}"))?;
    let marker = root.join(MARKER_FILE);
    if marker.exists() {
        verify_marker(root)?;
    } else {
        fs::write(
            &marker,
            format!("{{\"kind\":\"{MARKER_KIND}\",\"version\":1}}"),
        )
        .map_err(|e| format!("写入缓存管理标记失败: {e}"))?;
    }
    Ok(())
}

fn verify_marker(root: &Path) -> Result<(), String> {
    let marker = root.join(MARKER_FILE);
    let content = fs::read_to_string(&marker)
        .map_err(|_| "缓存管理标记不存在，已拒绝扫描或清理".to_string())?;
    if !content.contains(MARKER_KIND) {
        return Err("缓存管理标记无效，已拒绝扫描或清理".to_string());
    }
    Ok(())
}

fn scan_tree(root: &Path, warnings: &mut Vec<String>) -> Result<TreeStat, String> {
    let mut stat = TreeStat::default();
    if !root.exists() {
        return Ok(stat);
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(e) => {
                push_diagnostic(warnings, format!("无法读取目录 {}: {e}", dir.display()));
                continue;
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(e) => {
                    push_diagnostic(
                        warnings,
                        format!("无法读取文件信息 {}: {e}", path.display()),
                    );
                    continue;
                }
            };
            let file_type = metadata.file_type();
            if is_link_or_reparse(&metadata) {
                push_diagnostic(warnings, format!("已跳过链接: {}", path.display()));
            } else if file_type.is_dir() {
                stat.directory_count = stat.directory_count.saturating_add(1);
                stack.push(path);
            } else if file_type.is_file() {
                stat.file_count = stat.file_count.saturating_add(1);
                stat.size_bytes = stat.size_bytes.saturating_add(metadata.len());
            }
        }
    }
    Ok(stat)
}

fn scan_expired_sessions(
    root: &Path,
    retention_hours: u32,
    warnings: &mut Vec<String>,
) -> Result<(u64, u64), String> {
    let sessions = root.join("sessions");
    if !sessions.exists() {
        return Ok((0, 0));
    }
    let threshold = SystemTime::now()
        .checked_sub(Duration::from_secs(
            u64::from(retention_hours.max(1)) * 3600,
        ))
        .unwrap_or(UNIX_EPOCH);
    let mut count: u64 = 0;
    let mut bytes: u64 = 0;
    for entry in fs::read_dir(&sessions)
        .map_err(|e| format!("读取会话缓存目录失败: {e}"))?
        .flatten()
    {
        let path = entry.path();
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_dir() && !is_link_or_reparse(&metadata) => {}
            _ => continue,
        }
        if session_completed_before(&path, threshold) {
            let stat = scan_tree(&path, warnings)?;
            count = count.saturating_add(1);
            bytes = bytes.saturating_add(stat.size_bytes);
        }
    }
    Ok((count, bytes))
}

fn clean_expired_sessions(
    root: &Path,
    retention_hours: u32,
    result: &mut DevCacheCleanResult,
) -> Result<(), String> {
    let sessions = root.join("sessions");
    if !sessions.exists() {
        return Ok(());
    }
    let threshold = SystemTime::now()
        .checked_sub(Duration::from_secs(
            u64::from(retention_hours.max(1)) * 3600,
        ))
        .unwrap_or(UNIX_EPOCH);
    for entry in fs::read_dir(&sessions)
        .map_err(|e| format!("读取会话缓存目录失败: {e}"))?
        .flatten()
    {
        let path = entry.path();
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_dir() && !is_link_or_reparse(&metadata) => {}
            _ => {
                result.skipped_items = result.skipped_items.saturating_add(1);
                continue;
            }
        }
        if session_completed_before(&path, threshold) {
            remove_managed_tree(root, &path, result);
        }
    }
    Ok(())
}

fn session_completed_before(session: &Path, threshold: SystemTime) -> bool {
    let completed = session.join(SESSION_COMPLETED_FILE);
    completed.is_file()
        && fs::metadata(completed)
            .and_then(|metadata| metadata.modified())
            .is_ok_and(|completed_at| completed_at <= threshold)
}

fn remove_managed_tree(root: &Path, target: &Path, result: &mut DevCacheCleanResult) {
    if !is_within(target, root) || same_path(target, root) {
        result.skipped_items = result.skipped_items.saturating_add(1);
        push_diagnostic(
            &mut result.errors,
            format!("拒绝越界清理: {}", target.display()),
        );
        return;
    }
    match fs::symlink_metadata(target) {
        Ok(metadata) if is_link_or_reparse(&metadata) => {
            result.skipped_items = result.skipped_items.saturating_add(1);
            push_diagnostic(
                &mut result.errors,
                format!("已拒绝清理链接或重解析点: {}", target.display()),
            );
            return;
        }
        Err(e) => {
            result.skipped_items = result.skipped_items.saturating_add(1);
            push_diagnostic(
                &mut result.errors,
                format!("无法验证清理目标 {}: {e}", target.display()),
            );
            return;
        }
        _ => {}
    }
    let mut warnings = Vec::new();
    let stat = scan_tree(target, &mut warnings).ok();
    for warning in warnings {
        push_diagnostic(&mut result.errors, warning);
    }
    match fs::remove_dir_all(target) {
        Ok(()) => {
            if let Some(stat) = stat {
                result.removed_bytes = result.removed_bytes.saturating_add(stat.size_bytes);
                result.removed_files = result.removed_files.saturating_add(stat.file_count);
                result.removed_directories = result
                    .removed_directories
                    .saturating_add(stat.directory_count.saturating_add(1));
            }
        }
        Err(e) => {
            result.skipped_items = result.skipped_items.saturating_add(1);
            push_diagnostic(
                &mut result.errors,
                format!("清理 {} 失败: {e}", target.display()),
            );
        }
    }
}

fn is_within(path: &Path, root: &Path) -> bool {
    let path = normalize_for_compare(path);
    let root = normalize_for_compare(root);
    path.starts_with(&root) && path != root
}

fn same_path(left: &Path, right: &Path) -> bool {
    normalize_for_compare(left) == normalize_for_compare(right)
}

fn normalize_for_compare(path: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        return PathBuf::from(path.to_string_lossy().replace('/', "\\").to_lowercase());
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_path_buf()
    }
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn reject_linked_ancestors(path: &Path) -> Result<(), String> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        if candidate.exists() {
            let metadata =
                fs::symlink_metadata(candidate).map_err(|e| format!("验证缓存目录失败: {e}"))?;
            if is_link_or_reparse(&metadata) {
                return Err(format!(
                    "缓存目录不能经过符号链接或重解析点: {}",
                    candidate.display()
                ));
            }
        }
        current = candidate.parent();
    }
    Ok(())
}

fn is_link_or_reparse(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

fn push_diagnostic(target: &mut Vec<String>, message: String) {
    if target.len() < MAX_DIAGNOSTICS {
        target.push(message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "tuzi-switch-{name}-{}",
            uuid::Uuid::new_v4().simple()
        ))
    }

    #[test]
    fn managed_child_cannot_escape_root() {
        let root = PathBuf::from(r"D:\cache\tuzi-switch-cache");
        assert!(is_within(&root.join(r"sessions\abc"), &root));
        assert!(!is_within(&root, &root));
        assert!(!is_within(&PathBuf::from(r"D:\cache\other"), &root));
    }

    #[test]
    fn default_cache_settings_keep_routing_disabled() {
        let settings = DevelopmentCacheSettings::default();
        assert!(!settings.enabled);
        assert!(settings.route_temp);
        assert!(settings.route_node);
        assert!(settings.route_python);
        assert!(settings.cleanup_on_session_end);
        assert!(!settings.global_mode);
        assert_eq!(settings.retention_hours, 24);
    }

    #[test]
    fn active_session_without_completion_marker_is_never_expired() {
        let root = unique_test_root("active-cache-session");
        ensure_managed_root(&root).expect("create managed root");
        let session = root.join("sessions").join("active");
        fs::create_dir_all(session.join("temp")).expect("create active session");
        fs::write(session.join("temp").join("data.bin"), b"active").expect("write data");

        let mut warnings = Vec::new();
        let (count, bytes) = scan_expired_sessions(&root, 1, &mut warnings).expect("scan");
        assert_eq!((count, bytes), (0, 0));

        let mut result = DevCacheCleanResult {
            removed_bytes: 0,
            removed_files: 0,
            removed_directories: 0,
            skipped_items: 0,
            errors: Vec::new(),
        };
        clean_expired_sessions(&root, 1, &mut result).expect("clean");
        assert!(session.exists());
        fs::remove_dir_all(&root).expect("remove test root");
    }

    #[test]
    fn completion_marker_allows_expiry_after_protection_period() {
        let root = unique_test_root("completed-cache-session");
        ensure_managed_root(&root).expect("create managed root");
        let session = root.join("sessions").join("completed");
        fs::create_dir_all(session.join("temp")).expect("create completed session");
        fs::write(session.join("temp").join("data.bin"), b"completed").expect("write data");
        fs::write(session.join(SESSION_COMPLETED_FILE), b"").expect("mark completed");

        let future = SystemTime::now()
            .checked_add(Duration::from_secs(1))
            .expect("future threshold");
        assert!(session_completed_before(&session, future));
        fs::remove_dir_all(&root).expect("remove test root");
    }
}
