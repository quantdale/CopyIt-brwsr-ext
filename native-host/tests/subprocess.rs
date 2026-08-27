//! Subprocess integration test: launches the compiled host exactly like
//! Chromium would (framed stdio + origin argument) against an isolated temp
//! APPDATA fixture, and walks the full V1 journey:
//!
//! hello/migrate → list categories → list snippets → fetch plaintext body →
//! protected fetch while locked → wrong password → unlock → protected copy →
//! lock → locked again → clean exit on EOF.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use copyit_native_host::vault;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};

const HOST_BIN: &str = env!("CARGO_BIN_EXE_copyit-native-host");
const TEST_ORIGIN: &str = "chrome-extension://integrationtestorigin0000000000/";
const TEST_PASSWORD: &str = "correct horse battery staple";

struct HostProcess {
    child: Child,
}

impl HostProcess {
    fn spawn(data_dir: &std::path::Path, log_dir: &std::path::Path) -> HostProcess {
        let child = Command::new(HOST_BIN)
            .arg(TEST_ORIGIN)
            .arg("--parent-window=0")
            .env("COPYIT_DATA_DIR", data_dir)
            .env("COPYIT_LOG_DIR", log_dir)
            .env("COPYIT_ALLOWED_ORIGIN", TEST_ORIGIN)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("host process spawns");
        HostProcess { child }
    }

    fn request(&mut self, method: &str, id: &str, params: Value) -> Value {
        let req = json!({
            "protocolVersion": 1,
            "requestId": id,
            "method": method,
            "params": params,
        });
        let mut stdin = self.child.stdin.as_mut().expect("stdin");
        send_frame(&mut stdin, serde_json::to_vec(&req).unwrap().as_slice());
        let response = read_response(&mut self.child);
        assert_eq!(response["requestId"], id, "request id must be echoed");
        response
    }
}

impl Drop for HostProcess {
    fn drop(&mut self) {
        // Close stdin: the host must exit cleanly.
        if let Some(stdin) = self.child.stdin.as_mut() {
            let _ = stdin.write_all(&[]);
        }
        drop(self.child.stdin.take());
        match self.child.wait() {
            Ok(status) => {
                if !status.success() {
                    panic!("host did not exit cleanly after EOF: {status}");
                }
            }
            Err(e) => panic!("wait failed: {e}"),
        }
    }
}

fn send_frame<W: Write>(w: &mut W, payload: &[u8]) {
    w.write_all(&(payload.len() as u32).to_ne_bytes()).unwrap();
    w.write_all(payload).unwrap();
    w.flush().unwrap();
}

fn read_frame<R: Read>(r: &mut R) -> Option<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    r.read_exact(&mut len_buf).ok()?;
    let len = u32::from_ne_bytes(len_buf) as usize;
    let mut payload = vec![0u8; len];
    r.read_exact(&mut payload).ok()?;
    Some(payload)
}

fn read_response(child: &mut Child) -> Value {
    let stdout = child.stdout.as_mut().expect("stdout");
    let bytes = read_frame(stdout).expect("a framed response arrives");
    serde_json::from_slice(&bytes).expect("valid JSON response")
}

/// Builds a legacy fixture directory containing two snippets, one of them
/// genuinely protected with `TEST_PASSWORD` through the same crypto contract,
/// plus matching config with a working vault.
fn build_fixture(data_dir: &std::path::Path) {
    std::fs::create_dir_all(data_dir).unwrap();

    let salt_b64 = B64.encode([7u8; 16]);
    let salt = B64.decode(&salt_b64).unwrap();
    let key = vault::derive_key(TEST_PASSWORD, &salt).unwrap();
    let canary_plain = b"copyit-vault-canary-v1";
    let (canary_nonce_b64, canary_ct_b64) = vault::encrypt(&key, canary_plain).unwrap();

    let secret_body = "The launch code is alpine-meadow.";
    let (nonce_b64, ct_b64) = vault::encrypt(&key, secret_body.as_bytes()).unwrap();

    let snippets = json!([
        {"id": 11, "title": "Plain Greeting", "category": "git", "body": "hello world"},
        {"id": 12, "title": "Launch Codes", "category": "Prompt", "body": "",
         "protection": {"hint": "The ", "nonce": nonce_b64, "ciphertext": ct_b64}}
    ]);
    let config = json!({
        "categories": ["git", "Prompt"],
        "theme": "Nord",
        "vault": {"salt": salt_b64, "nonce": canary_nonce_b64, "canary": canary_ct_b64}
    });
    std::fs::write(
        data_dir.join("snippets.json"),
        serde_json::to_string(&snippets).unwrap(),
    )
    .unwrap();
    std::fs::write(
        data_dir.join("config.json"),
        serde_json::to_string(&config).unwrap(),
    )
    .unwrap();
}

#[test]
fn full_v1_journey_over_real_framing() {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().join("appdata").join("CopyIt");
    let log_dir = tmp.path().join("logs");
    build_fixture(&data_dir);

    let mut host = HostProcess::spawn(&data_dir, &log_dir);

    // 1. hello triggers migration and reports health.
    let hello = host.request("hello", "h1", json!({}));
    assert_eq!(hello["ok"], true);
    assert_eq!(hello["result"]["dbReady"], true);
    assert_eq!(hello["result"]["migrationStatus"], "migrated");
    assert_eq!(hello["result"]["supportedSchemaVersion"], 1);
    assert_eq!(hello["result"]["dbSchemaVersion"], 1);
    assert_eq!(hello["result"]["vaultState"], "locked");
    assert_eq!(hello["result"]["protocolVersion"], 1);

    // 2. Categories reflect canonicalized legacy config.
    let cats = host.request("listCategories", "c1", json!({}));
    let names: Vec<&str> = cats["result"]["categories"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["Git", "Prompt"]);

    // 3. List preserves legacy order and never leaks bodies/ciphertext.
    let list = host.request("listSnippets", "l1", json!({"limit": 10}));
    let items = list["result"]["items"].as_array().unwrap();
    assert_eq!(list["result"]["total"], 2);
    let titles: Vec<&str> = items.iter().map(|i| i["title"].as_str().unwrap()).collect();
    assert_eq!(titles, vec!["Plain Greeting", "Launch Codes"]);
    assert_eq!(items[0]["id"], 11);
    assert_eq!(items[1]["id"], 12);
    assert_eq!(items[1]["protected"], true);
    let raw = serde_json::to_string(&list).unwrap().to_lowercase();
    assert!(
        !raw.contains("alpine-meadow"),
        "bodies must not appear in lists"
    );
    assert!(!raw.contains("ciphertext"));

    // 4. Plaintext body retrieval.
    let plain = host.request("getSnippetBody", "g1", json!({"id": 11}));
    assert_eq!(plain["result"]["body"], "hello world");

    // 5. Protected while locked → vault_locked.
    let locked = host.request("getSnippetBody", "g2", json!({"id": 12}));
    assert_eq!(locked["ok"], false);
    assert_eq!(locked["error"]["code"], "vault_locked");

    // 6. Wrong password → invalid_password.
    let wrong = host.request("unlockVault", "u1", json!({"password": "definitely-wrong"}));
    assert_eq!(wrong["error"]["code"], "invalid_password");

    // 7. Correct password unlocks.
    let unlock = host.request("unlockVault", "u2", json!({"password": TEST_PASSWORD}));
    assert_eq!(unlock["result"]["vaultState"], "unlocked");
    let hello2 = host.request("hello", "h2", json!({}));
    assert_eq!(hello2["result"]["vaultState"], "unlocked");

    // 8. Protected body now decrypts.
    let unlocked_body = host.request("getSnippetBody", "g3", json!({"id": 12}));
    assert_eq!(
        unlocked_body["result"]["body"],
        "The launch code is alpine-meadow."
    );

    // 9. Lock wipes the session key.
    let lock = host.request("lockVault", "lk1", json!({}));
    assert_eq!(lock["result"]["vaultState"], "locked");

    // 10. Protected fetch fails locked again.
    let relocked = host.request("getSnippetBody", "g4", json!({"id": 12}));
    assert_eq!(relocked["error"]["code"], "vault_locked");

    // Protocol abuse checks over the wire.
    let unknown_method = host.request("deleteEverything", "x1", json!({}));
    assert_eq!(unknown_method["error"]["code"], "unknown_method");
    let bad_params = host.request("getSnippetBody", "x2", json!({"wrong": 1}));
    assert_eq!(bad_params["error"]["code"], "invalid_params");
    let missing = host.request("getSnippetBody", "x3", json!({"id": 99999}));
    assert_eq!(missing["error"]["code"], "not_found");
    let ping = host.request("ping", "x4", json!({}));
    assert_eq!(ping["result"]["pong"], true);

    // Search works server-side.
    let found = host.request("listSnippets", "s1", json!({"query": "greeting"}));
    assert_eq!(found["result"]["total"], 1);

    // Drop closes stdin; Drop impl asserts a clean exit code.
    drop(host);

    // Legacy sources were backed up during migration.
    let entries: Vec<String> = std::fs::read_dir(&data_dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert!(entries
        .iter()
        .any(|n| n.starts_with("snippets.json.legacy-backup-")));
    assert!(entries
        .iter()
        .any(|n| n.starts_with("config.json.legacy-backup-")));
    assert!(data_dir.join("copyit.db").exists(), "canonical DB exists");
    assert!(
        !data_dir.join("snippets.json").exists(),
        "source JSON renamed to backup"
    );
}

#[test]
fn host_observes_empty_canonical_library_after_clear_all() {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().join("appdata").join("CopyIt");
    let log_dir = tmp.path().join("logs");
    build_fixture(&data_dir);

    // Establish the canonical database through the real native-host path.
    let mut host = HostProcess::spawn(&data_dir, &log_dir);
    let hello = host.request("hello", "clear-h1", json!({}));
    assert_eq!(hello["result"]["dbReady"], true);
    let before = host.request("listSnippets", "clear-before", json!({}));
    assert_eq!(before["result"]["total"], 2);
    drop(host);

    // This is the shared SQLite effect of the desktop's clear-all
    // reconciliation. Keep the operation in the test explicit so the
    // follow-up host process proves it reads the same canonical rows rather
    // than a browser-owned cache or a legacy JSON source.
    let db = rusqlite::Connection::open(data_dir.join("copyit.db")).unwrap();
    db.execute("DELETE FROM snippets", []).unwrap();
    drop(db);

    let mut host = HostProcess::spawn(&data_dir, &log_dir);
    let after = host.request("listSnippets", "clear-after", json!({}));
    assert_eq!(after["ok"], true);
    assert_eq!(after["result"]["total"], 0);
    assert!(after["result"]["items"].as_array().unwrap().is_empty());
}

#[test]
fn host_rejects_wrong_origin_argument() {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().join("appdata");
    let out = Command::new(HOST_BIN)
        .arg("chrome-extension://not-the-right-origin/")
        .env("COPYIT_DATA_DIR", &data_dir)
        .env("COPYIT_ALLOWED_ORIGIN", TEST_ORIGIN)
        .output()
        .expect("host runs");
    assert!(!out.status.success());
    assert!(out.stdout.is_empty(), "no protocol bytes on rejection");
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("refusing"),
        "diagnostic goes to stderr"
    );
    assert!(
        !data_dir.exists(),
        "user data untouched on origin rejection"
    );
}

#[test]
fn oversized_request_is_rejected_without_crash() {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().join("appdata");
    let log_dir = tmp.path().join("logs");
    let mut child = Command::new(HOST_BIN)
        .arg(TEST_ORIGIN)
        .env("COPYIT_DATA_DIR", &data_dir)
        .env("COPYIT_LOG_DIR", &log_dir)
        .env("COPYIT_ALLOWED_ORIGIN", TEST_ORIGIN)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();

    // Announce an absurd length; host must reject before allocating and quit.
    {
        let stdin = child.stdin.as_mut().unwrap();
        stdin.write_all(&[0xFF, 0xFF, 0xFF, 0x7F]).unwrap();
        stdin.flush().unwrap();
    }
    drop(child.stdin.take());
    let status = child.wait().unwrap();
    assert!(!status.success(), "host terminates after framing violation");
}
