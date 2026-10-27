//! Native-file adapters for additional tools. Their login and active-model state stay tool-owned.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

static LOCK: Mutex<()> = Mutex::new(());
const MAX_BYTES: u64 = 1024 * 1024;
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NativeTool {
    Grokbuild,
    Pi,
    Mcode,
}
impl NativeTool {
    fn id(self) -> &'static str {
        match self {
            Self::Grokbuild => "grokbuild",
            Self::Pi => "pi",
            Self::Mcode => "mcode",
        }
    }
    fn path(self) -> Result<PathBuf, String> {
        let home = crate::config::get_home_dir();
        // Preview builds never follow environment overrides into real tool directories.
        let fallback = match self {
            Self::Grokbuild => home.join(".grok/config.toml"),
            Self::Pi => home.join(".pi/agent/models.json"),
            Self::Mcode => home.join(".minimax/config.yaml"),
        };
        #[cfg(not(feature = "local-preview"))]
        {
            let vars: &[&str] = match self {
                Self::Grokbuild => &[],
                Self::Pi => &["PI_CODING_AGENT_DIR"],
                Self::Mcode => &["MINIMAX_DATA_DIR", "MAVIS_DATA_DIR"],
            };
            for var in vars {
                if let Some(dir) = std::env::var_os(var).filter(|v| !v.is_empty()) {
                    let dir = PathBuf::from(dir);
                    if !dir.is_absolute() {
                        return Err(format!("{var} must be an absolute directory"));
                    }
                    return Ok(dir.join(if self == Self::Pi {
                        "models.json"
                    } else {
                        "config.yaml"
                    }));
                }
            }
        }
        Ok(fallback)
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: String,
    pub providers: BTreeMap<String, Value>,
    pub current: Option<String>,
    pub path: String,
    pub can_restore: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub revision: String,
    pub id: String,
    pub config: Option<Value>,
    #[serde(default)]
    pub select: bool,
}
#[derive(Serialize, Deserialize)]
struct Backup {
    before: Option<Vec<u8>>,
    after: String,
    #[serde(default)]
    target: String,
}
fn digest(bytes: Option<&[u8]>) -> String {
    bytes
        .map(|v| format!("{:x}", Sha256::digest(v)))
        .unwrap_or_else(|| "missing".into())
}
fn read_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if !meta.is_file() || meta.len() > MAX_BYTES {
                return Err("Configuration must be a regular file under 1 MiB".into());
            }
            fs::read(path)
                .map(Some)
                .map_err(|_| "Cannot read native configuration".into())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Cannot inspect native configuration".into()),
    }
}
fn decode(tool: NativeTool, bytes: Option<&[u8]>) -> Result<Value, String> {
    let text = std::str::from_utf8(bytes.unwrap_or_default())
        .map_err(|_| "Native configuration is not UTF-8")?;
    if text.trim().is_empty() {
        return Ok(json!({}));
    }
    let value = match tool {
        NativeTool::Grokbuild => toml::from_str::<toml::Value>(text)
            .ok()
            .and_then(|v| serde_json::to_value(v).ok()),
        NativeTool::Pi => json5::from_str(text).ok(),
        NativeTool::Mcode => serde_yaml::from_str(text).ok(),
    }
    .ok_or("Invalid native configuration; original file was preserved")?;
    if !value.is_object() {
        return Err("Native configuration root must be an object".into());
    }
    Ok(value)
}
fn node_key(tool: NativeTool) -> &'static str {
    match tool {
        NativeTool::Grokbuild => "model",
        NativeTool::Pi => "providers",
        NativeTool::Mcode => "custom_provider",
    }
}
fn providers(tool: NativeTool, value: &Value) -> Result<BTreeMap<String, Value>, String> {
    match value.get(node_key(tool)) {
        None | Some(Value::Null) => Ok(BTreeMap::new()),
        Some(Value::Object(map)) => Ok(map.iter().map(|(k, v)| (k.clone(), v.clone())).collect()),
        _ => Err("Native providers must be an object".into()),
    }
}
fn validate(id: &str, tool: NativeTool, value: &Value) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 100
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Provider ID must use letters, digits, - or _".into());
    }
    if !value.is_object() {
        return Err("Provider configuration must be an object".into());
    }
    let (base, key, api) = match tool {
        NativeTool::Grokbuild => (
            value.get("base_url"),
            value.get("api_key").or_else(|| value.get("env_key")),
            value.get("api_backend"),
        ),
        NativeTool::Pi => (value.get("baseUrl"), value.get("apiKey"), value.get("api")),
        NativeTool::Mcode => (
            value.pointer("/options/baseURL"),
            value.pointer("/options/apiKey"),
            value.get("api"),
        ),
    };
    let url = base
        .and_then(Value::as_str)
        .and_then(|s| url::Url::parse(s).ok())
        .ok_or("Enter a valid endpoint")?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Enter an HTTP(S) endpoint without embedded credentials".into());
    }
    if key
        .and_then(Value::as_str)
        .is_none_or(|s| s.trim().is_empty())
    {
        return Err("An API key or tool-native environment reference is required".into());
    }
    let allowed: &[&str] = if tool == NativeTool::Grokbuild {
        &["responses", "chat"]
    } else {
        &[
            "openai-completions",
            "openai-responses",
            "anthropic-messages",
        ]
    };
    if !api
        .and_then(Value::as_str)
        .is_some_and(|v| allowed.contains(&v))
    {
        return Err("Unsupported API format".into());
    }
    if tool == NativeTool::Grokbuild {
        for field in ["name", "model"] {
            if value
                .get(field)
                .and_then(Value::as_str)
                .is_none_or(|s| s.trim().is_empty())
            {
                return Err(format!("Missing {field}"));
            }
        }
        if value
            .get("context_window")
            .and_then(Value::as_u64)
            .is_none_or(|n| n == 0)
        {
            return Err("Positive context_window required".into());
        }
    } else if tool == NativeTool::Pi {
        if value
            .get("models")
            .and_then(Value::as_array)
            .is_none_or(|models| {
                models.is_empty()
                    || models.iter().any(|v| {
                        v.get("id")
                            .and_then(Value::as_str)
                            .is_none_or(|s| s.trim().is_empty())
                    })
            })
        {
            return Err("Add models with nonempty IDs".into());
        }
    } else if value
        .get("models")
        .and_then(Value::as_object)
        .is_none_or(|models| {
            models.is_empty()
                || models
                    .iter()
                    .any(|(id, v)| id.trim().is_empty() || !v.is_object())
        })
    {
        return Err("Add at least one model".into());
    }
    Ok(())
}
fn encode(tool: NativeTool, value: &Value) -> Result<Vec<u8>, String> {
    match tool {
        NativeTool::Grokbuild => toml::to_string_pretty(value)
            .map(String::into_bytes)
            .map_err(|_| "Cannot encode Grok TOML".into()),
        NativeTool::Pi => {
            serde_json::to_vec_pretty(value).map_err(|_| "Cannot encode Pi JSON".into())
        }
        NativeTool::Mcode => serde_yaml::to_string(value)
            .map(String::into_bytes)
            .map_err(|_| "Cannot encode MiniMax YAML".into()),
    }
}
/// Private temporary file is synced before atomic replacement. Existing parent permissions stay intact.
pub(crate) fn private_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid path")?;
    if !parent.exists() {
        fs::create_dir_all(parent).map_err(|_| "Cannot create configuration directory")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
                .map_err(|_| "Cannot protect configuration directory")?;
        }
    }
    let mut tmp =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "Cannot prepare atomic write")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tmp.as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| "Cannot protect configuration file")?;
    }
    tmp.write_all(bytes)
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(|_| "Cannot write configuration")?;
    tmp.persist(path)
        .map_err(|_| "Cannot replace configuration atomically")?;
    Ok(())
}
fn backup_path(tool: NativeTool) -> PathBuf {
    crate::config::get_app_config_dir()
        .join("native-tool-backups")
        .join(format!("{}.json", tool.id()))
}
fn snapshot(tool: NativeTool, path: &Path, backup: &Path) -> Result<Snapshot, String> {
    let bytes = read_bytes(path)?;
    let revision = digest(bytes.as_deref());
    let value = decode(tool, bytes.as_deref())?;
    Ok(Snapshot {
        providers: providers(tool, &value)?,
        current: if tool == NativeTool::Grokbuild {
            value
                .pointer("/models/default")
                .and_then(Value::as_str)
                .map(str::to_owned)
        } else {
            None
        },
        can_restore: fs::read(backup)
            .ok()
            .and_then(|b| serde_json::from_slice::<Backup>(&b).ok())
            .is_some_and(|b| b.after == revision && b.target == path.to_string_lossy()),
        revision,
        path: path.to_string_lossy().into(),
    })
}
fn apply(tool: NativeTool, path: &Path, backup: &Path, change: Change) -> Result<Snapshot, String> {
    let before = read_bytes(path)?;
    if digest(before.as_deref()) != change.revision {
        return Err("Configuration changed outside the assistant. Refresh before saving.".into());
    }
    let mut root = decode(tool, before.as_deref())?;
    let mut nodes = providers(tool, &root)?;
    if tool == NativeTool::Mcode
        && nodes
            .get(&change.id)
            .and_then(|v| v.get("kind"))
            .and_then(Value::as_str)
            .is_some_and(|v| v != "custom")
    {
        return Err("MiniMax Code owns this account provider; edit it in MiniMax Code".into());
    }
    if tool == NativeTool::Mcode {
        let prefix = format!("custom_provider:{}/", change.id);
        for field in ["defaultModel", "defaultLightModel"] {
            if let Some(model) = root
                .get(field)
                .and_then(Value::as_str)
                .and_then(|s| s.strip_prefix(&prefix))
            {
                if !change.config.as_ref().is_some_and(|v| {
                    v.get("enabled") != Some(&Value::Bool(false))
                        && v.get("models").and_then(|m| m.get(model)).is_some_and(|m| {
                            m.is_object() && m.get("enabled") != Some(&Value::Bool(false))
                        })
                }) {
                    return Err("Select another default model in MiniMax Code before removing or disabling its model".into());
                }
            }
        }
    }
    if let Some(config) = change.config {
        validate(&change.id, tool, &config)?;
        nodes.insert(change.id.clone(), config);
    } else {
        if tool == NativeTool::Grokbuild
            && root.pointer("/models/default").and_then(Value::as_str) == Some(change.id.as_str())
        {
            return Err("Select another Grok profile before removing the current profile".into());
        }
        if tool == NativeTool::Mcode {
            let prefix = format!("custom_provider:{}/", change.id);
            if ["defaultModel", "defaultLightModel"].iter().any(|k| {
                root.get(k)
                    .and_then(Value::as_str)
                    .is_some_and(|s| s.starts_with(&prefix))
            }) {
                return Err(
                    "Select another model in MiniMax Code before removing this provider".into(),
                );
            }
        }
        nodes.remove(&change.id);
    }
    root[node_key(tool)] = serde_json::to_value(nodes).map_err(|_| "Cannot encode providers")?;
    if change.select {
        if tool != NativeTool::Grokbuild {
            return Err("Choose the active model in the native tool".into());
        }
        if !root[node_key(tool)]
            .get(&change.id)
            .is_some_and(Value::is_object)
        {
            return Err("Profile not found".into());
        }
        if root.get("models").is_none() {
            root["models"] = json!({});
        }
        if !root["models"].is_object() {
            return Err("Invalid Grok models table".into());
        }
        root["models"]["default"] = json!(change.id);
    }
    let bytes = if tool == NativeTool::Grokbuild {
        let original = std::str::from_utf8(before.as_deref().unwrap_or_default())
            .map_err(|_| "Invalid TOML encoding")?;
        let mut doc = original
            .parse::<toml_edit::DocumentMut>()
            .map_err(|_| "Invalid Grok TOML")?;
        let replacement = String::from_utf8(encode(tool, &root)?)
            .map_err(|_| "Invalid TOML encoding")?
            .parse::<toml_edit::DocumentMut>()
            .map_err(|_| "Cannot encode Grok model tables")?;
        doc["model"] = replacement["model"].clone();
        if change.select {
            doc["models"]["default"] = replacement["models"]["default"].clone();
        }
        doc.to_string().into_bytes()
    } else {
        encode(tool, &root)?
    };
    let saved_backup = Backup {
        before,
        after: digest(Some(&bytes)),
        target: path.to_string_lossy().into_owned(),
    };
    private_write(
        backup,
        &serde_json::to_vec(&saved_backup).map_err(|_| "Cannot encode backup")?,
    )?;
    if digest(read_bytes(path)?.as_deref()) != change.revision {
        return Err("Native configuration changed while preparing the save".into());
    }
    private_write(path, &bytes)?;
    snapshot(tool, path, backup)
}
struct FileLock(PathBuf);
impl Drop for FileLock {
    fn drop(&mut self) {
        let _ = fs::remove_dir(&self.0);
    }
}
fn file_lock(path: &Path) -> Result<FileLock, String> {
    let parent = path.parent().ok_or("Invalid path")?;
    if !parent.exists() {
        fs::create_dir_all(parent).map_err(|_| "Cannot create tool directory")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
                .map_err(|_| "Cannot protect tool directory")?;
        }
    }
    let lock = PathBuf::from(format!("{}.lock", path.display()));
    fs::create_dir(&lock)
        .map_err(|_| "Tool configuration is busy; retry after the other writer finishes")?;
    Ok(FileLock(lock))
}
#[tauri::command]
pub fn native_tool_read(tool: NativeTool) -> Result<Snapshot, String> {
    let _guard = LOCK.lock().map_err(|_| "Native tool lock unavailable")?;
    snapshot(tool, &tool.path()?, &backup_path(tool))
}
#[tauri::command]
pub fn native_tool_write(tool: NativeTool, change: Change) -> Result<Snapshot, String> {
    let _guard = LOCK.lock().map_err(|_| "Native tool lock unavailable")?;
    let path = tool.path()?;
    let _file = file_lock(&path)?;
    apply(tool, &path, &backup_path(tool), change)
}
#[tauri::command]
pub fn native_tool_restore(tool: NativeTool, revision: String) -> Result<Snapshot, String> {
    let _guard = LOCK.lock().map_err(|_| "Native tool lock unavailable")?;
    let path = tool.path()?;
    let _file = file_lock(&path)?;
    restore(tool, &path, &backup_path(tool), &revision)
}
fn restore(
    tool: NativeTool,
    path: &Path,
    backup: &Path,
    revision: &str,
) -> Result<Snapshot, String> {
    let saved: Backup =
        serde_json::from_slice(&fs::read(backup).map_err(|_| "No backup available")?)
            .map_err(|_| "Invalid backup")?;
    if saved.target != path.to_string_lossy()
        || saved.after != revision
        || digest(read_bytes(path)?.as_deref()) != revision
    {
        return Err("Native configuration changed; refusing to overwrite external edits".into());
    }
    match saved.before {
        Some(bytes) => private_write(path, &bytes)?,
        None => fs::remove_file(path).map_err(|_| "Cannot restore absent configuration")?,
    }
    snapshot(tool, path, backup)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config(tool: NativeTool) -> Value {
        match tool {
            NativeTool::Grokbuild => {
                json!({"name":"Synthetic","model":"grok-synthetic","base_url":"https://example.invalid/v1","api_key":"SYNTHETIC","api_backend":"responses","context_window":500000})
            }
            NativeTool::Pi => {
                json!({"baseUrl":"https://example.invalid/v1","apiKey":"SYNTHETIC","api":"openai-completions","models":[{"id":"synthetic"}]})
            }
            NativeTool::Mcode => {
                json!({"options":{"baseURL":"https://example.invalid/v1","apiKey":"SYNTHETIC"},"api":"openai-completions","models":{"synthetic":{}}})
            }
        }
    }
    #[test]
    fn all_adapters_preserve_unrelated_values_and_restore_exact_bytes() {
        for tool in [NativeTool::Grokbuild, NativeTool::Pi, NativeTool::Mcode] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("config");
            let backup = dir.path().join("backup");
            let original = encode(tool, &json!({"unrelated":{"preserve":true}})).unwrap();
            fs::write(&path, &original).unwrap();
            let saved = apply(
                tool,
                &path,
                &backup,
                Change {
                    revision: digest(Some(&original)),
                    id: "synthetic".into(),
                    config: Some(config(tool)),
                    select: tool == NativeTool::Grokbuild,
                },
            )
            .unwrap();
            assert!(saved.providers.contains_key("synthetic"));
            assert_eq!(
                decode(tool, read_bytes(&path).unwrap().as_deref()).unwrap()["unrelated"]
                    ["preserve"],
                true
            );
            restore(tool, &path, &backup, &saved.revision).unwrap();
            assert_eq!(fs::read(path).unwrap(), original);
        }
    }
    #[test]
    fn external_changes_and_invalid_input_never_replace_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("models.json");
        let backup = dir.path().join("backup");
        fs::write(&path, b"{\"other\":true}").unwrap();
        assert!(apply(
            NativeTool::Pi,
            &path,
            &backup,
            Change {
                revision: "missing".into(),
                id: "synthetic".into(),
                config: Some(config(NativeTool::Pi)),
                select: false
            }
        )
        .is_err());
        assert!(validate("../../bad", NativeTool::Pi, &config(NativeTool::Pi)).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "{\"other\":true}");
    }
    #[test]
    fn removal_checks_mcode_default_and_grok_selected_profile() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config");
        let backup = dir.path().join("backup");
        for (tool, root) in [
            (
                NativeTool::Mcode,
                json!({"defaultModel":"custom_provider:demo/model","custom_provider":{"demo":{}}}),
            ),
            (
                NativeTool::Grokbuild,
                json!({"models":{"default":"demo"},"model":{"demo":{}}}),
            ),
        ] {
            let bytes = encode(tool, &root).unwrap();
            fs::write(&path, &bytes).unwrap();
            assert!(apply(
                tool,
                &path,
                &backup,
                Change {
                    revision: digest(Some(&bytes)),
                    id: "demo".into(),
                    config: None,
                    select: false
                }
            )
            .is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
    }
    #[test]
    fn restore_refuses_external_edits_and_new_files_are_private() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pi/models.json");
        let backup = dir.path().join("backup");
        let saved = apply(
            NativeTool::Pi,
            &path,
            &backup,
            Change {
                revision: "missing".into(),
                id: "demo".into(),
                config: Some(config(NativeTool::Pi)),
                select: false,
            },
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::write(&path, b"{}").unwrap();
        assert!(restore(NativeTool::Pi, &path, &backup, &saved.revision).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"{}");
    }
}
