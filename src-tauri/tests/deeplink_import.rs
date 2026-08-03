use std::sync::Arc;

use tuzi_switch_lib::{
    get_codex_config_path, import_provider_from_deeplink, parse_deeplink_url, AppState, AppType,
    Database,
};

#[path = "support.rs"]
mod support;
use support::{ensure_test_home, reset_test_fs, test_mutex};

#[test]
fn deeplink_import_claude_provider_persists_to_db() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let url = "tuziswitch://v1/import?resource=provider&app=claude&name=DeepLink%20Claude&homepage=https%3A%2F%2Fexample.com&endpoint=https%3A%2F%2Fapi.example.com%2Fv1&apiKey=sk-test-claude-key&model=claude-sonnet-4&icon=claude";
    let request = parse_deeplink_url(url).expect("parse deeplink url");

    let db = Arc::new(Database::memory().expect("create memory db"));
    let state = AppState::new(db.clone());

    let provider_id = import_provider_from_deeplink(&state, request.clone())
        .expect("import provider from deeplink");

    // Verify DB state
    let providers = db.get_all_providers("claude").expect("get providers");
    let provider = providers
        .get(&provider_id)
        .expect("provider created via deeplink");

    assert_eq!(provider.name, request.name.clone().unwrap());
    assert_eq!(provider.website_url.as_deref(), request.homepage.as_deref());
    assert_eq!(provider.icon.as_deref(), Some("claude"));
    let auth_token = provider
        .settings_config
        .pointer("/env/ANTHROPIC_AUTH_TOKEN")
        .and_then(|v| v.as_str());
    let base_url = provider
        .settings_config
        .pointer("/env/ANTHROPIC_BASE_URL")
        .and_then(|v| v.as_str());
    assert_eq!(auth_token, request.api_key.as_deref());
    assert_eq!(base_url, request.endpoint.as_deref());
}

#[test]
fn deeplink_import_codex_provider_builds_auth_and_config() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let url = "tuziswitch://v1/import?resource=provider&app=codex&name=DeepLink%20Codex&endpoint=https%3A%2F%2Fapi.tu-zi.com%2Fcoding&apiKey=sk-test-codex-key&model=gpt-5.6-sol&icon=openai&enabled=true";
    let request = parse_deeplink_url(url).expect("parse deeplink url");

    let db = Arc::new(Database::memory().expect("create memory db"));
    let state = AppState::new(db.clone());

    let provider_id = import_provider_from_deeplink(&state, request.clone())
        .expect("import provider from deeplink");

    let providers = db.get_all_providers("codex").expect("get providers");
    let provider = providers
        .get(&provider_id)
        .expect("provider created via deeplink");

    assert_eq!(provider.name, request.name.clone().unwrap());
    assert!(provider.website_url.is_none());
    assert_eq!(provider.icon.as_deref(), Some("openai"));
    let auth_value = provider
        .settings_config
        .pointer("/auth/OPENAI_API_KEY")
        .and_then(|v| v.as_str());
    let config_text = provider
        .settings_config
        .get("config")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    assert_eq!(auth_value, request.api_key.as_deref());
    assert!(
        config_text.contains(request.endpoint.as_deref().unwrap()),
        "config.toml content should contain endpoint"
    );
    assert!(
        config_text.contains("model = \"gpt-5.6-sol\""),
        "config.toml content should contain model setting"
    );

    let current_provider = db
        .get_current_provider(AppType::Codex.as_str())
        .expect("get current Codex provider");
    assert_eq!(current_provider.as_deref(), Some(provider_id.as_str()));

    let live_config = std::fs::read_to_string(get_codex_config_path())
        .expect("enabled deep-link import should write Codex config.toml");
    assert!(live_config.contains("https://api.tu-zi.com/coding"));
    assert!(live_config.contains("model = \"gpt-5.6-sol\""));

    let managed_env = std::fs::read_to_string(_home.join(".codex").join(".env"))
        .expect("enabled ticket import should persist the managed Codex API key");
    assert!(
        managed_env.lines().any(|line| {
            line.starts_with("CODING") && line.ends_with("_CODEX_API_KEY=sk-test-codex-key")
        }),
        "ticket import should use the existing managed env-key architecture"
    );
}

#[test]
fn deeplink_import_codex_provider_does_not_invent_homepage() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let url = "tuziswitch://v1/import?resource=provider&app=codex&name=Codex%20No%20Homepage&endpoint=https%3A%2F%2Fapi.tu-zi.com%2Fcoding&apiKey=sk-test-codex-key&model=gpt-5.6-sol";
    let request = parse_deeplink_url(url).expect("parse deeplink url");
    let db = Arc::new(Database::memory().expect("create memory db"));
    let state = AppState::new(db.clone());

    let provider_id = import_provider_from_deeplink(&state, request)
        .expect("import Codex provider without homepage");
    let providers = db.get_all_providers("codex").expect("get providers");
    let provider = providers.get(&provider_id).expect("provider created");

    assert!(provider.website_url.is_none());
}

#[test]
fn deeplink_import_codex_provider_escapes_toml_strings() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let url = "tuziswitch://v1/import?resource=provider&app=codex&name=Escaped&endpoint=https%3A%2F%2Fapi.tu-zi.com%2Fcoding&apiKey=sk-test&model=gpt%22%0Amalicious%3Dtrue";
    let request = parse_deeplink_url(url).expect("parse deeplink url");
    let db = Arc::new(Database::memory().expect("create memory db"));
    let state = AppState::new(db.clone());

    let provider_id =
        import_provider_from_deeplink(&state, request).expect("import escaped Codex provider");
    let providers = db.get_all_providers("codex").expect("get providers");
    let config = providers
        .get(&provider_id)
        .and_then(|provider| provider.settings_config.get("config"))
        .and_then(serde_json::Value::as_str)
        .expect("stored Codex config");
    let parsed: toml::Value = toml::from_str(config).expect("generated config remains valid TOML");

    assert_eq!(
        parsed.get("model").and_then(toml::Value::as_str),
        Some("gpt\"\nmalicious=true")
    );
    assert!(parsed.get("malicious").is_none());
}
