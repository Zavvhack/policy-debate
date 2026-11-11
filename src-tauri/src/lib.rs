//! The desktop app's Rust core.
//!
//! The window (the same web app as the browser version) cannot touch the
//! network, the disk, or the keychain by itself: its Content-Security-Policy
//! forbids all network access, and Tauri gives it no file or shell permissions.
//! Everything goes through the handful of commands in this file:
//!
//!   set_round_active   Round Mode on/off (the second lock on AI)
//!   ai_request         send one request to the Anthropic API, adding the key
//!   has_api_key / set_api_key / clear_api_key   the OS keychain
//!   fetch_url          download an article the user asked for
//!   save_file          "Save as..." dialog
//!   write_backup / backup_folder   automatic backups on disk
//!   open_external      open a web link in the normal browser
//!   claim_instance     is this the only running copy of the app?
//!
//! THE AI LOCK, PART TWO
//! The web side already refuses AI calls during a round (src/ai/lock.ts).
//! This file enforces the same rule again, independently: the API key never
//! leaves this process, and `ai_request` refuses while a round is active. So
//! even a bug in the web code could not reach the AI service mid-round.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const KEYRING_SERVICE: &str = "org.policydebate.app";
const KEYRING_USER: &str = "anthropic-api-key";
/// The only host AI requests may go to.
const AI_HOST: &str = "api.anthropic.com";
/// Largest article we will download (bytes).
const MAX_FETCH_BYTES: usize = 25 * 1024 * 1024;
/// How many backup files to keep on disk.
const KEEP_BACKUPS: usize = 40;

struct AppState {
    /// True while a round is in progress. AI requests are refused.
    round_active: AtomicBool,
    /// For fetching articles. Follows redirects, but never to a local address.
    http: reqwest::Client,
    /// For AI requests. Never follows redirects, so the key can only ever go to the one allowed host.
    ai_http: reqwest::Client,
    /// False if another copy of the app was already running when this one started.
    only_instance: bool,
    /// Held open (and locked) for as long as the app runs. Never read.
    _instance_lock: Option<fs::File>,
    /// Where the "a round is active" marker file lives.
    lock_file: PathBuf,
    backup_dir: PathBuf,
}

type CmdResult<T> = Result<T, String>;

// ---------------------------------------------------------------------------
// Round Mode
// ---------------------------------------------------------------------------

/// Called by the web side when a round starts or ends (and at start-up).
/// The state is also written to disk, so a restart mid-round stays locked.
#[tauri::command]
fn set_round_active(state: State<'_, AppState>, active: bool) -> CmdResult<()> {
    // Flip the in-memory flag first: if the disk write fails, we are still locked.
    state.round_active.store(active, Ordering::SeqCst);
    if active {
        if let Some(dir) = state.lock_file.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("Could not save the round lock: {e}"))?;
        }
        fs::write(&state.lock_file, b"round active\n").map_err(|e| format!("Could not save the round lock: {e}"))?;
    } else if state.lock_file.exists() {
        fs::remove_file(&state.lock_file).map_err(|e| format!("Could not clear the round lock: {e}"))?;
    }
    Ok(())
}

/// Is a round in progress? True if this copy of the app says so, OR if the
/// marker file is on disk (a second copy of the app started the round).
fn round_is_active(state: &AppState) -> bool {
    state.round_active.load(Ordering::SeqCst) || state.lock_file.exists()
}

// ---------------------------------------------------------------------------
// One copy of the app at a time
// ---------------------------------------------------------------------------

/// Take an exclusive lock on a file for as long as the app runs. The operating
/// system releases it when the app exits, even after a crash, so it can never
/// be left behind. Returns the open file (keep it!) and whether we are alone.
fn claim_instance_lock(path: &Path) -> (Option<fs::File>, bool) {
    let file = match fs::OpenOptions::new().create(true).write(true).truncate(false).open(path) {
        Ok(f) => f,
        // Cannot even create the file: do not block the user over it.
        Err(_) => return (None, true),
    };
    match file.try_lock() {
        Ok(()) => (Some(file), true),
        Err(fs::TryLockError::WouldBlock) => (None, false),
        // This disk does not support locks (some network drives): carry on.
        Err(fs::TryLockError::Error(_)) => (Some(file), true),
    }
}

/// Asked once at start-up. If another copy is already running, the window shows
/// a message instead of loading your files: two copies would overwrite each other.
#[tauri::command]
fn claim_instance(state: State<'_, AppState>) -> bool {
    state.only_instance
}

// ---------------------------------------------------------------------------
// AI requests
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct AiResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

/// Is this address the Anthropic API, over https, and nothing else?
fn is_allowed_ai_url(url: &str) -> bool {
    match reqwest::Url::parse(url) {
        Ok(u) => {
            u.scheme() == "https"
                && u.host_str() == Some(AI_HOST)
                && u.port().is_none()
                && u.username().is_empty()
                && u.password().is_none()
                && u.path().starts_with("/v1/")
        }
        Err(_) => false,
    }
}

/// Request headers the web side is allowed to set. The API key is never one of them.
fn is_passthrough_header(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n == "content-type" || n == "accept" || n.starts_with("anthropic-") || n.starts_with("x-stainless-")
}

fn read_key() -> CmdResult<Option<String>> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(keychain_error)?;
    match entry.get_password() {
        Ok(k) if !k.trim().is_empty() => Ok(Some(k)),
        Ok(_) => Ok(None),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(keychain_error(e)),
    }
}

fn keychain_error(e: keyring::Error) -> String {
    format!(
        "The system keychain could not be used ({e}). On Linux this needs a running keyring \
         service such as KWallet or GNOME Keyring."
    )
}

#[tauri::command]
async fn ai_request(
    state: State<'_, AppState>,
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: String,
) -> CmdResult<AiResponse> {
    // The lock comes first, before the key is even read.
    if round_is_active(&state) {
        return Err("Round Mode is on, so AI is switched off. End the round to use AI again.".into());
    }
    if !is_allowed_ai_url(&url) {
        return Err("Blocked: AI requests may only go to api.anthropic.com.".into());
    }
    let method = match method.to_ascii_uppercase().as_str() {
        "POST" => reqwest::Method::POST,
        "GET" => reqwest::Method::GET,
        other => return Err(format!("Blocked: unsupported request method {other}.")),
    };
    let key = tokio::task::spawn_blocking(read_key)
        .await
        .map_err(|e| e.to_string())??
        .ok_or_else(|| "No API key is saved yet. Add one in Settings.".to_string())?;

    let mut req = state.ai_http.request(method.clone(), &url).timeout(Duration::from_secs(600));
    for (name, value) in &headers {
        if is_passthrough_header(name) {
            req = req.header(name.as_str(), value.as_str());
        }
    }
    req = req.header("x-api-key", key);
    if method == reqwest::Method::POST {
        req = req.body(body);
    }
    // Check the lock once more immediately before sending.
    if round_is_active(&state) {
        return Err("Round Mode is on, so AI is switched off. End the round to use AI again.".into());
    }
    let res = req.send().await.map_err(|e| {
        if e.is_timeout() {
            "The AI service took too long to answer. Try again.".to_string()
        } else if e.is_connect() {
            "Could not reach the AI service. Check your internet connection.".to_string()
        } else {
            format!("The AI request failed: {e}")
        }
    })?;
    let status = res.status().as_u16();
    let headers = res
        .headers()
        .iter()
        .filter(|(name, _)| {
            let n = name.as_str();
            n == "content-type" || n == "retry-after" || n == "request-id" || n.starts_with("anthropic-") || n.starts_with("x-")
        })
        .filter_map(|(name, value)| value.to_str().ok().map(|v| (name.as_str().to_string(), v.to_string())))
        .collect();
    let body = res.text().await.map_err(|e| format!("The AI service's answer could not be read: {e}"))?;
    Ok(AiResponse { status, headers, body })
}

// ---------------------------------------------------------------------------
// API key (the OS keychain)
// ---------------------------------------------------------------------------

#[tauri::command]
async fn has_api_key() -> CmdResult<bool> {
    tokio::task::spawn_blocking(|| read_key().map(|k| k.is_some()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_api_key(key: String) -> CmdResult<()> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("The key is empty.".into());
    }
    tokio::task::spawn_blocking(move || {
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .and_then(|e| e.set_password(&key))
            .map_err(keychain_error)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn clear_api_key() -> CmdResult<()> {
    tokio::task::spawn_blocking(|| {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(keychain_error)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(keychain_error(e)),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Fetching an article
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct FetchedPage {
    url: String,
    status: u16,
    content_type: String,
    body_base64: String,
}

/// Only ordinary web addresses. Addresses on this computer or the local
/// network are refused, so a pasted link can never be used to poke at them.
fn check_fetch_url(url: &str) -> CmdResult<reqwest::Url> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "That does not look like a web address.".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http and https addresses can be fetched.".into());
    }
    let local = match parsed.host() {
        None => return Err("That address has no host name.".into()),
        Some(url::Host::Domain(d)) => {
            let d = d.to_ascii_lowercase();
            d == "localhost" || d.ends_with(".localhost") || d.ends_with(".local") || d.ends_with(".internal")
        }
        Some(url::Host::Ipv4(ip)) => ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified() || ip.is_broadcast(),
        Some(url::Host::Ipv6(ip)) => {
            ip.is_loopback() || ip.is_unspecified() || (ip.segments()[0] & 0xfe00) == 0xfc00 || (ip.segments()[0] & 0xffc0) == 0xfe80
        }
    };
    if local {
        return Err("Addresses on this computer or the local network cannot be fetched.".into());
    }
    Ok(parsed)
}

/// May a download follow this redirect? Every hop is checked like the first
/// address, so a public page cannot bounce the app to this computer or the
/// local network.
fn redirect_allowed(next_url: &str, hops_so_far: usize) -> Result<(), &'static str> {
    if hops_so_far >= 10 {
        return Err("too many redirects");
    }
    if check_fetch_url(next_url).is_err() {
        return Err("the site redirected to an address on this computer or the local network");
    }
    Ok(())
}

#[tauri::command]
async fn fetch_url(state: State<'_, AppState>, url: String) -> CmdResult<FetchedPage> {
    use futures_util::StreamExt;
    let parsed = check_fetch_url(&url)?;
    let res = state
        .http
        .get(parsed)
        .timeout(Duration::from_secs(45))
        .header("accept", "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8")
        .header("accept-language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "The site took too long to answer.".to_string()
            } else if e.is_connect() {
                "Could not connect. Check the address and your internet connection.".to_string()
            } else {
                format!("Could not fetch the page: {e}")
            }
        })?;
    let status = res.status().as_u16();
    let final_url = res.url().to_string();
    let content_type = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let mut bytes: Vec<u8> = Vec::new();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("The download was interrupted: {e}"))?;
        if bytes.len() + chunk.len() > MAX_FETCH_BYTES {
            return Err("That page is too large to fetch (over 25 MB).".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(FetchedPage {
        url: final_url,
        status,
        content_type,
        body_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

// ---------------------------------------------------------------------------
// Saving files and backups
// ---------------------------------------------------------------------------

/// Keep only safe characters, so a name can never point outside its folder.
fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.' | '(' | ')') { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_string();
    if cleaned.is_empty() {
        "file".to_string()
    } else {
        cleaned.chars().take(120).collect()
    }
}

/// Write a file so that a crash half-way never leaves a broken file behind:
/// write to a temporary name, flush to disk, then rename into place.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp-writing");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

#[tauri::command]
async fn save_file(app: AppHandle, name: String, data_base64: String) -> CmdResult<bool> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|_| "The file data was damaged.".to_string())?;
    let suggested = safe_file_name(&name);
    tokio::task::spawn_blocking(move || {
        let mut dialog = app.dialog().file().set_file_name(&suggested);
        if let Some(ext) = Path::new(&suggested).extension().and_then(|e| e.to_str()) {
            dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
        }
        let Some(choice) = dialog.blocking_save_file() else {
            return Ok(false); // the user pressed Cancel
        };
        let path = choice.into_path().map_err(|e| format!("That location cannot be used: {e}"))?;
        write_atomic(&path, &bytes).map_err(|e| format!("Could not save the file: {e}"))?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Oldest-first list of the backup files to delete so that only `keep` remain.
fn backups_to_delete(mut names: Vec<String>, keep: usize) -> Vec<String> {
    names.retain(|n| n.starts_with("policy-debate-backup_") && n.ends_with(".json"));
    names.sort(); // the timestamp in the name sorts oldest first
    let extra = names.len().saturating_sub(keep);
    names.into_iter().take(extra).collect()
}

#[tauri::command]
async fn write_backup(state: State<'_, AppState>, name: String, json: String) -> CmdResult<()> {
    let dir = state.backup_dir.clone();
    tokio::task::spawn_blocking(move || {
        fs::create_dir_all(&dir).map_err(|e| format!("Could not create the backup folder: {e}"))?;
        let mut file_name = safe_file_name(&name);
        if !file_name.ends_with(".json") {
            file_name.push_str(".json");
        }
        write_atomic(&dir.join(&file_name), json.as_bytes()).map_err(|e| format!("Could not write the backup: {e}"))?;
        let names: Vec<String> = fs::read_dir(&dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().into_string().ok())
            .collect();
        for old in backups_to_delete(names, KEEP_BACKUPS) {
            let _ = fs::remove_file(dir.join(old));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn backup_folder(state: State<'_, AppState>) -> String {
    state.backup_dir.display().to_string()
}

// ---------------------------------------------------------------------------
// Opening links
// ---------------------------------------------------------------------------

/// Open a web link in the user's normal browser. Only http and https links
/// are allowed, so nothing in the window can ask the system to open a file or run a program.
#[tauri::command]
fn open_external(url: String) -> CmdResult<()> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "That is not a web address.".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only web links can be opened.".into());
    }
    open::that_detached(parsed.as_str()).map_err(|e| format!("Could not open the link: {e}"))
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let lock_file = data_dir.join("round-active.lock");
            let agent = concat!("Mozilla/5.0 (compatible; PolicyDebate/", env!("CARGO_PKG_VERSION"), ")");
            let http = reqwest::Client::builder()
                .user_agent(agent)
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    match redirect_allowed(attempt.url().as_str(), attempt.previous().len()) {
                        Ok(()) => attempt.follow(),
                        Err(why) => attempt.error(why),
                    }
                }))
                .connect_timeout(Duration::from_secs(20))
                .build()?;
            let ai_http = reqwest::Client::builder()
                .user_agent(agent)
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(20))
                .build()?;
            let (instance_lock, only_instance) = claim_instance_lock(&data_dir.join("instance.lock"));
            app.manage(AppState {
                // If the marker file is there, a round was in progress when the app last closed: stay locked.
                round_active: AtomicBool::new(lock_file.exists()),
                http,
                ai_http,
                only_instance,
                _instance_lock: instance_lock,
                lock_file,
                backup_dir: data_dir.join("backups"),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_round_active,
            ai_request,
            has_api_key,
            set_api_key,
            clear_api_key,
            fetch_url,
            save_file,
            write_backup,
            backup_folder,
            open_external,
            claim_instance
        ])
        .run(tauri::generate_context!())
        .expect("error while running Policy Debate");
}

// ---------------------------------------------------------------------------
// Tests (run with: cargo test --manifest-path src-tauri/Cargo.toml)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_requests_only_go_to_anthropic_over_https() {
        assert!(is_allowed_ai_url("https://api.anthropic.com/v1/messages"));
        assert!(is_allowed_ai_url("https://api.anthropic.com/v1/messages?beta=true"));
        assert!(!is_allowed_ai_url("http://api.anthropic.com/v1/messages"));
        assert!(!is_allowed_ai_url("https://api.anthropic.com.evil.example/v1/messages"));
        assert!(!is_allowed_ai_url("https://evil.example/api.anthropic.com/v1/messages"));
        assert!(!is_allowed_ai_url("https://user:pw@api.anthropic.com/v1/messages"));
        assert!(!is_allowed_ai_url("https://api.anthropic.com:8443/v1/messages"));
        assert!(!is_allowed_ai_url("https://api.anthropic.com/other"));
        assert!(!is_allowed_ai_url("not a url"));
    }

    #[test]
    fn the_web_side_cannot_set_the_api_key_header() {
        assert!(is_passthrough_header("Content-Type"));
        assert!(is_passthrough_header("anthropic-version"));
        assert!(is_passthrough_header("anthropic-beta"));
        assert!(!is_passthrough_header("x-api-key"));
        assert!(!is_passthrough_header("Authorization"));
        assert!(!is_passthrough_header("Cookie"));
        assert!(!is_passthrough_header("Host"));
    }

    #[test]
    fn fetch_refuses_local_and_odd_addresses() {
        assert!(check_fetch_url("https://www.kff.org/health-reform/").is_ok());
        assert!(check_fetch_url("  http://example.com/a.pdf ").is_ok());
        for bad in [
            "file:///etc/passwd",
            "ftp://example.com/x",
            "javascript:alert(1)",
            "http://localhost:8080/",
            "http://127.0.0.1/",
            "http://10.0.0.5/admin",
            "http://192.168.1.1/",
            "http://169.254.169.254/latest/meta-data",
            "http://[::1]/",
            "http://printer.local/",
            "nonsense",
        ] {
            assert!(check_fetch_url(bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn redirects_are_checked_like_the_first_address() {
        assert!(redirect_allowed("https://www.example.org/article", 0).is_ok());
        assert!(redirect_allowed("http://127.0.0.1:8080/admin", 1).is_err());
        assert!(redirect_allowed("http://192.168.0.1/", 1).is_err());
        assert!(redirect_allowed("file:///etc/passwd", 1).is_err());
        assert!(redirect_allowed("https://www.example.org/article", 10).is_err());
    }

    #[test]
    fn only_one_copy_of_the_app_can_hold_the_instance_lock() {
        let dir = std::env::temp_dir().join(format!("pd-lock-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("instance.lock");
        let (first, alone) = claim_instance_lock(&path);
        assert!(alone, "the first copy is alone");
        let (_second, alone_too) = claim_instance_lock(&path);
        assert!(!alone_too, "a second copy must be told another one is running");
        drop(first); // the first copy exits
        let (_third, alone_again) = claim_instance_lock(&path);
        assert!(alone_again, "once the first copy has gone, a new one may start");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn file_names_cannot_escape_their_folder() {
        assert_eq!(safe_file_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_file_name("policy-debate-backup_2026-11-10_09-30-00.json"), "policy-debate-backup_2026-11-10_09-30-00.json");
        assert_eq!(safe_file_name("   "), "file");
        assert_eq!(safe_file_name(".hidden"), "hidden");
        assert!(!safe_file_name("a/b\\c:d").contains(['/', '\\', ':']));
    }

    #[test]
    fn old_backups_are_pruned_oldest_first() {
        let names: Vec<String> = (1..=5)
            .map(|d| format!("policy-debate-backup_2026-11-0{d}_10-00-00.json"))
            .chain(["notes.txt".to_string(), "policy-debate-backup_x.tmp-writing".to_string()])
            .collect();
        let gone = backups_to_delete(names, 3);
        assert_eq!(gone, vec![
            "policy-debate-backup_2026-11-01_10-00-00.json".to_string(),
            "policy-debate-backup_2026-11-02_10-00-00.json".to_string(),
        ]);
        assert!(backups_to_delete(vec!["notes.txt".into()], 0).is_empty());
    }

    #[test]
    fn atomic_write_replaces_the_file_and_leaves_no_temp_file() {
        let dir = std::env::temp_dir().join(format!("pd-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("backup.json");
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"two");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }
}
