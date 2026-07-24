use crate::codex_config::{
    codex_locale_override, get_codex_config_path, read_codex_config_text,
    update_codex_locale_override, CODEX_SIMPLIFIED_CHINESE_LOCALE,
};
use crate::config::write_text_file;
use crate::error::AppError;
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexLocaleStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub chinese_resources_available: bool,
    pub locale_override: Option<String>,
    pub chinese_enabled: bool,
    pub restart_required: bool,
}

pub fn get_status() -> Result<CodexLocaleStatus, AppError> {
    status_from_config(&read_codex_config_text()?, false)
}

pub fn set_simplified_chinese(enabled: bool) -> Result<CodexLocaleStatus, AppError> {
    let config_path = get_codex_config_path();
    let current_config = read_codex_config_text()?;
    let locale = enabled.then_some(CODEX_SIMPLIFIED_CHINESE_LOCALE);
    let updated_config = update_codex_locale_override(&current_config, locale)?;
    let changed = updated_config != current_config;

    if changed {
        write_text_file(&config_path, &updated_config)?;
    }

    status_from_config(&updated_config, changed)
}

fn status_from_config(
    config_text: &str,
    restart_required: bool,
) -> Result<CodexLocaleStatus, AppError> {
    let installation = detect_installation();
    let locale_override = codex_locale_override(config_text)?;

    Ok(CodexLocaleStatus {
        installed: installation.is_some(),
        version: installation.as_ref().and_then(|item| item.version.clone()),
        // 官方桌面包已内置简体中文；检测失败仅代表无法确认安装位置。
        chinese_resources_available: installation.is_some(),
        chinese_enabled: locale_override
            .as_deref()
            .is_some_and(|locale| locale.eq_ignore_ascii_case(CODEX_SIMPLIFIED_CHINESE_LOCALE)),
        locale_override,
        restart_required,
    })
}

#[derive(Debug, Clone)]
struct CodexInstallation {
    version: Option<String>,
}

fn detect_installation() -> Option<CodexInstallation> {
    #[cfg(windows)]
    if let Some(installation) = detect_windows_installation() {
        return Some(installation);
    }

    #[cfg(target_os = "macos")]
    {
        let candidates = [
            PathBuf::from("/Applications/Codex.app"),
            crate::config::get_home_dir().join("Applications/Codex.app"),
        ];
        if candidates.into_iter().any(|path| path.exists()) {
            return Some(CodexInstallation { version: None });
        }
    }

    #[cfg(target_os = "linux")]
    {
        let candidates = [PathBuf::from("/opt/Codex"), PathBuf::from("/usr/lib/codex")];
        if candidates.into_iter().any(|path| path.exists()) {
            return Some(CodexInstallation { version: None });
        }
    }

    None
}

#[cfg(windows)]
fn detect_windows_installation() -> Option<CodexInstallation> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    const PACKAGES_KEY: &str = r"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages";
    let packages = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(PACKAGES_KEY)
        .ok()?;
    let package_name = packages
        .enum_keys()
        .filter_map(Result::ok)
        .filter(|name| name.starts_with("OpenAI.Codex_"))
        .max()?;
    let package = packages.open_subkey(&package_name).ok()?;
    let root: String = package.get_value("PackageRootFolder").ok()?;
    if !PathBuf::from(root).exists() {
        return None;
    }

    Some(CodexInstallation {
        version: package_name
            .strip_prefix("OpenAI.Codex_")
            .and_then(|rest| rest.split('_').next())
            .map(str::to_owned),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    #[test]
    #[serial]
    fn invalid_toml_is_not_overwritten() {
        let temp = tempfile::tempdir().expect("temp home");
        let old_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());

        let path = get_codex_config_path();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "[desktop\ninvalid").unwrap();

        assert!(set_simplified_chinese(true).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "[desktop\ninvalid");

        match old_test_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
    }

    #[test]
    #[serial]
    fn enabling_an_already_enabled_locale_is_idempotent() {
        let temp = tempfile::tempdir().expect("temp home");
        let old_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());

        let path = get_codex_config_path();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let source = "[desktop]\nlocaleOverride = \"zh-CN\"\n";
        std::fs::write(&path, source).unwrap();

        let status = set_simplified_chinese(true).unwrap();
        assert!(!status.restart_required);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), source);

        match old_test_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
    }
}
