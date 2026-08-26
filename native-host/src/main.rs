//! CopyIt native messaging host entry point.
//!
//! Default mode is Chromium native messaging over stdin/stdout with strict
//! framing; stdout carries protocol bytes ONLY. Explicit developer diagnostic
//! switches (`--self-test`, `--version`, `--print-data-dir`, `--check-db`,
//! `--migrate-only`) use human-readable output because the browser never
//! launched them as a native host.

use copyit_native_host::{
    db, ensure_canonical_db, data_dir, db_path, framing,
    logging::{self, Logger},
    origin,
    protocol::{self, method, ErrorCode, Request, Response},
    safe_truncate_utf8, vault, MigrationError,
    MAX_DESCRIPTION_BYTES, MAX_TITLE_BYTES,
};
use std::io::BufReader;
use std::sync::atomic::{AtomicU32, Ordering};
use zeroize::Zeroize;

const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    match args.first().map(String::as_str) {
        Some("--version") => {
            println!(
                "copyit-native-host {} (protocol v{}, max schema v{})",
                HOST_VERSION,
                protocol::PROTOCOL_VERSION,
                db::MAX_SUPPORTED_SCHEMA_VERSION
            );
        }
        Some("--print-data-dir") => {
            println!("{}", data_dir().display());
        }
        Some("--self-test") => std::process::exit(self_test()),
        Some("--check-db") => std::process::exit(check_db()),
        Some("--migrate-only") => std::process::exit(migrate_only()),
        _ => std::process::exit(native_mode(&args)),
    }
}

// ---------------------------------------------------------------------------
// Native messaging mode.
// ---------------------------------------------------------------------------

fn native_mode(args: &[String]) -> i32 {
    // Origin defense runs before anything touches user data or stdout.
    if let origin::OriginCheck::Rejected { reason } = origin::validate_args(args) {
        eprintln!("copyit-native-host: refusing to start: {reason}");
        return 2;
    }

    let logger = logging::Logger::init();
    logger.log("info", "start", &[("hostVersion", HOST_VERSION)]);

    let stdin = std::io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let mut host = Host::new(logger);
    let mut framing_violation = false;

    loop {
        let bytes = match framing::read_message(&mut reader) {
            Ok(Some(b)) => b,
            Ok(None) => break, // clean EOF at frame boundary
            Err(e) => {
                let kind = match &e {
                    framing::FrameError::Eof => "eof",
                    framing::FrameError::UnexpectedEof => "unexpected_eof",
                    framing::FrameError::TooLarge => "too_large",
                    framing::FrameError::Io(_) => "io",
                };
                host.logger.log("error", "frame_read", &[("kind", kind)]);
                // A frame that violates the size contract is a protocol
                // violation, not a normal disconnect.
                framing_violation = !matches!(e, framing::FrameError::Eof | framing::FrameError::UnexpectedEof);
                break;
            }
        };

        let response = match protocol::parse_request(&bytes) {
            Ok(req) => host.handle(req),
            Err(prebuilt) => prebuilt,
        };

        match serde_json::to_vec(&response) {
            Ok(body) => {
                let stdout = std::io::stdout();
                let mut out = stdout.lock();
                match framing::write_message(&mut out, &body) {
                    Ok(()) => {}
                    Err(framing::FrameError::TooLarge) => {
                        // Replace an oversized payload with a safe failure frame.
                        let fallback =
                            Response::failure(&response.request_id, ErrorCode::ResponseTooLarge);
                        if let Ok(fb) = serde_json::to_vec(&fallback) {
                            let _ = framing::write_message(&mut out, &fb);
                        }
                    }
                    Err(_) => break,
                }
            }
            Err(_) => break,
        }
    }

    host.logger.log("info", "stop", &[]);
    drop(host);
    if framing_violation { 1 } else { 0 }
}

// ---------------------------------------------------------------------------
// Request handling.
// ---------------------------------------------------------------------------

struct Host {
    conn: Option<rusqlite::Connection>,
    init_failure: Option<(ErrorCode, String)>,
    last_outcome: Option<&'static str>,
    vault_key: Option<[u8; vault::KEY_LEN]>,
    unlock_failures: AtomicU32,
    logger: Logger,
}

impl Drop for Host {
    fn drop(&mut self) {
        self.lock_vault();
    }
}

impl Host {
    fn new(logger: Logger) -> Host {
        Host {
            conn: None,
            init_failure: None,
            last_outcome: None,
            vault_key: None,
            unlock_failures: AtomicU32::new(0),
            logger,
        }
    }

    /// Lazily opens/migrates the canonical database exactly once per process.
    fn connection(&mut self) -> Result<&rusqlite::Connection, (ErrorCode, String)> {
        if self.conn.is_none() && self.init_failure.is_none() {
            let started = std::time::Instant::now();
            match ensure_canonical_db(&data_dir()) {
                Ok((conn, outcome)) => {
                    let status = outcome.status_string();
                    self.logger.log(
                        "info",
                        "migration",
                        &[
                            ("status", status),
                            ("durationMs", &started.elapsed().as_millis().to_string()),
                        ],
                    );
                    self.last_outcome = Some(status);
                    self.conn = Some(conn);
                }
                Err(e) => {
                    let code = e.error_code();
                    self.logger.log(
                        "error",
                        "migration",
                        &[
                            ("code", code.as_str()),
                            ("durationMs", &started.elapsed().as_millis().to_string()),
                        ],
                    );
                    let msg = safe_migration_message(&e);
                    self.init_failure = Some((code, msg.clone()));
                    return Err((code, msg));
                }
            }
        }
        if let Some(failure) = &self.init_failure {
            return Err(failure.clone());
        }
        Ok(self.conn.as_ref().expect("database initialized above"))
    }

    fn handle(&mut self, req: Request) -> Response {
        let started = std::time::Instant::now();
        let response = self.dispatch(&req);
        self.logger.log(
            "info",
            "request",
            &[
                ("method", req.method.as_str()),
                ("durationMs", &started.elapsed().as_millis().to_string()),
                ("ok", if response.ok { "true" } else { "false" }),
            ],
        );
        response
    }

    fn dispatch(&mut self, req: &Request) -> Response {
        match req.method.as_str() {
            method::HELLO => self.hello(req),
            method::PING => Response::success(
                &req.request_id,
                serde_json::json!({ "pong": true, "hostVersion": HOST_VERSION }),
            ),
            method::LIST_CATEGORIES => self.list_categories(req),
            method::LIST_SNIPPETS => self.list_snippets(req),
            method::GET_SNIPPET_BODY => self.get_snippet_body(req),
            method::UNLOCK_VAULT => self.unlock_vault(req),
            method::LOCK_VAULT => {
                self.lock_vault();
                Response::success(&req.request_id, serde_json::json!({ "vaultState": "locked" }))
            }
            _ => Response::failure(&req.request_id, ErrorCode::UnknownMethod),
        }
    }

    fn hello(&mut self, req: &Request) -> Response {
        let (db_ready, db_schema, last_error) = match self.connection() {
            Ok(conn) => match db::schema_version(conn) {
                Ok(v) => (true, serde_json::json!(v), None),
                Err(e) => (false, serde_json::json!(null), Some(code_json(e.error_code()))),
            },
            Err((code, _)) => (false, serde_json::json!(null), Some(code_json(code))),
        };
        let migration_status = if db_ready {
            self.last_outcome.unwrap_or("ready")
        } else {
            "failed"
        };

        let mut result = serde_json::json!({
            "protocolVersion": protocol::PROTOCOL_VERSION,
            "hostVersion": HOST_VERSION,
            "supportedSchemaVersion": db::MAX_SUPPORTED_SCHEMA_VERSION,
            "dbSchemaVersion": db_schema,
            "vaultState": self.vault_state(),
            "migrationStatus": migration_status,
            "dbReady": db_ready,
        });
        if let Some(code) = last_error {
            result["lastErrorCode"] = code;
        }
        Response::success(&req.request_id, result)
    }

    fn vault_state(&self) -> &'static str {
        let configured = self
            .conn
            .as_ref()
            .and_then(|c| db::load_config(c).ok())
            .flatten()
            .map(|cfg| cfg.vault_is_configured())
            .unwrap_or(false);
        if !configured {
            return "not_configured";
        }
        if self.vault_key.is_some() {
            "unlocked"
        } else {
            "locked"
        }
    }

    fn list_categories(&mut self, req: &Request) -> Response {
        let conn = match self.connection() {
            Ok(c) => c,
            Err((code, msg)) => {
                return Response::failure_with_message(&req.request_id, code, Some(&msg))
            }
        };
        match db::list_categories(conn) {
            Ok(cats) => {
                Response::success(&req.request_id, serde_json::json!({ "categories": cats }))
            }
            Err(_) => Response::failure_with_message(
                &req.request_id,
                ErrorCode::DatabaseUnavailable,
                Some("Could not read categories."),
            ),
        }
    }

    fn list_snippets(&mut self, req: &Request) -> Response {
        #[derive(serde::Deserialize, Default)]
        #[serde(default, rename_all = "camelCase", deny_unknown_fields)]
        struct Params {
            query: Option<String>,
            category: Option<String>,
            offset: Option<i64>,
            limit: Option<i64>,
        }
        let params: Params = match serde_json::from_value(req.params.clone()) {
            Ok(p) => p,
            Err(_) => return Response::failure(&req.request_id, ErrorCode::InvalidParams),
        };
        if params.query.as_deref().map(str::len).unwrap_or(0) > 512 {
            return Response::failure(&req.request_id, ErrorCode::InvalidParams);
        }
        if params.category.as_deref().map(str::len).unwrap_or(0) > 256 {
            return Response::failure(&req.request_id, ErrorCode::InvalidParams);
        }
        let limit = params.limit.unwrap_or(100);
        let offset = params.offset.unwrap_or(0);

        let conn = match self.connection() {
            Ok(c) => c,
            Err((code, msg)) => {
                return Response::failure_with_message(&req.request_id, code, Some(&msg))
            }
        };
        match db::list_snippets(
            conn,
            params.query.as_deref(),
            params.category.as_deref(),
            offset,
            limit,
        ) {
            Ok((items, total)) => {
                let capped: Vec<serde_json::Value> = items
                    .into_iter()
                    .map(|mut item| {
                        item.title = safe_truncate_utf8(&item.title, MAX_TITLE_BYTES);
                        item.description =
                            safe_truncate_utf8(&item.description, MAX_DESCRIPTION_BYTES);
                        serde_json::to_value(&item).expect("serializable metadata")
                    })
                    .collect();
                let page_size = limit.clamp(1, db::PAGE_LIMIT_CAP);
                let has_more = (offset + capped.len() as i64) < total;
                Response::success(
                    &req.request_id,
                    serde_json::json!({
                        "items": capped,
                        "total": total,
                        "offset": offset.max(0),
                        "pageSize": page_size,
                        "hasMore": has_more,
                    }),
                )
            }
            Err(e) => Response::failure_with_message(
                &req.request_id,
                e.error_code(),
                Some("Could not read prompts."),
            ),
        }
    }

    fn get_snippet_body(&mut self, req: &Request) -> Response {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Params {
            id: i64,
        }
        let params: Params = match serde_json::from_value(req.params.clone()) {
            Ok(p) => p,
            Err(_) => return Response::failure(&req.request_id, ErrorCode::InvalidParams),
        };
        let conn = match self.connection() {
            Ok(c) => c,
            Err((code, msg)) => {
                return Response::failure_with_message(&req.request_id, code, Some(&msg))
            }
        };
        let record = match db::snippet_body(conn, params.id) {
            Ok(r) => r,
            Err(_) => {
                return Response::failure_with_message(
                    &req.request_id,
                    ErrorCode::DatabaseUnavailable,
                    Some("Could not read the prompt."),
                )
            }
        };
        let Some(record) = record else {
            return Response::failure(&req.request_id, ErrorCode::NotFound);
        };

        if !record.is_protected() {
            return Response::success(&req.request_id, serde_json::json!({ "body": record.body }));
        }

        // Protected: requires a session-unlocked vault.
        let Some(key) = self.vault_key.as_ref() else {
            return Response::failure(&req.request_id, ErrorCode::VaultLocked);
        };
        let nonce = record.protection_nonce.unwrap_or_default();
        let ciphertext = record.protection_ciphertext.unwrap_or_default();
        match vault::decrypt_body(key, &nonce, &ciphertext) {
            Ok(body) => Response::success(&req.request_id, serde_json::json!({ "body": body })),
            Err(_) => Response::failure(&req.request_id, ErrorCode::DecryptFailed),
        }
    }

    fn unlock_vault(&mut self, req: &Request) -> Response {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Params {
            password: String,
        }
        let params: Params = match serde_json::from_value(req.params.clone()) {
            Ok(p) => p,
            Err(_) => return Response::failure(&req.request_id, ErrorCode::InvalidParams),
        };
        if params.password.len() > 1024 {
            return Response::failure(&req.request_id, ErrorCode::InvalidPassword);
        }

        let conn = match self.connection() {
            Ok(c) => c,
            Err((code, msg)) => {
                return Response::failure_with_message(&req.request_id, code, Some(&msg))
            }
        };
        let meta = match db::load_config(conn) {
            Ok(Some(cfg)) => cfg.vault_meta(),
            Ok(None) | Err(_) => None,
        };
        let Some(meta) = meta else {
            return Response::failure(&req.request_id, ErrorCode::VaultNotConfigured);
        };

        // Small bounded backoff after repeated failures to blunt rapid retries.
        let failures = self.unlock_failures.load(Ordering::Relaxed);
        if failures > 0 {
            let delay_ms = 100u64.saturating_mul(1 << failures.min(5)).min(2_000);
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        }

        match vault::verify_password(&params.password, &meta.salt, &meta.nonce, &meta.canary) {
            Ok(key) => {
                self.unlock_failures.store(0, Ordering::Relaxed);
                self.lock_vault(); // replace any stale key
                self.vault_key = Some(key);
                Response::success(
                    &req.request_id,
                    serde_json::json!({ "vaultState": "unlocked" }),
                )
            }
            Err(_) => {
                self.unlock_failures.fetch_add(1, Ordering::Relaxed);
                Response::failure(&req.request_id, ErrorCode::InvalidPassword)
            }
        }
    }

    /// Zeroizes and drops any derived key. The vault starts locked every launch.
    fn lock_vault(&mut self) {
        if let Some(mut key) = self.vault_key.take() {
            key.zeroize();
        }
    }
}

fn code_json(code: ErrorCode) -> serde_json::Value {
    serde_json::json!(code.as_str())
}

/// Safe-migration failure text: stable, human-readable, free of internals.
fn safe_migration_message(e: &MigrationError) -> String {
    match e {
        MigrationError::LegacyCorrupt { file, .. } => format!(
            "The legacy data file {file} is damaged and was preserved. No changes were made."
        ),
        MigrationError::LockTimeout => {
            "Another CopyIt component holds the migration lock. Try again shortly.".to_string()
        }
        _ => "Migrating your library to SQLite failed. Your original files are untouched."
            .to_string(),
    }
}

// ---------------------------------------------------------------------------
// Developer diagnostics (human-readable stdout; browser never launches these).
// ---------------------------------------------------------------------------

fn self_test() -> i32 {
    let mut failures = 0;

    macro_rules! check {
        ($name:expr, $expr:expr) => {
            match $expr {
                Ok(details) => println!("PASS {}{}", $name, details),
                Err(msg) => {
                    println!("FAIL {} {}", $name, msg);
                    failures += 1;
                }
            }
        };
    }

    check!("framing_round_trip", || -> Result<String, String> {
        let payload = br#"{"probe":1}"#;
        let mut buf = Vec::new();
        framing::write_message(&mut buf, payload).map_err(|e| e.to_string())?;
        let mut cursor = std::io::Cursor::new(buf);
        let read = framing::read_message(&mut cursor).map_err(|e| e.to_string())?;
        if read.as_deref() == Some(payload.as_slice()) {
            Ok(String::new())
        } else {
            Err("payload mismatch".into())
        }
    }());

    check!("protocol_parse", || -> Result<String, String> {
        let req =
            protocol::parse_request(br#"{"protocolVersion":1,"requestId":"t","method":"ping"}"#)
                .map_err(|_| "valid request rejected".to_string())?;
        if req.method == "ping" {
            Ok(String::new())
        } else {
            Err("wrong method parsed".into())
        }
    }());

    check!("vault_test_vector", verify_embedded_vector());

    check!("sqlite_smoke", || -> Result<String, String> {
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let (conn, _) = ensure_canonical_db(dir.path()).map_err(|e| e.to_string())?;
        let (_, total) = db::list_snippets(&conn, None, None, 0, 10).map_err(|e| e.to_string())?;
        Ok(format!(" ({total} seeded rows visible)"))
    }());

    check!("utf8_truncation", {
        let s = "aé日🙂x";
        let t = safe_truncate_utf8(s, 4);
        if t == "aé" {
            Ok(String::new())
        } else {
            Err(format!("unexpected truncation result: {t:?}"))
        }
    });

    if failures == 0 {
        println!("SELF-TEST OK");
        0
    } else {
        println!("SELF-TEST FAILED ({failures})");
        1
    }
}

/// Verifies the committed cross-compatibility vault vector through this host's
/// independent implementation of the desktop crypto contract.
fn verify_embedded_vector() -> Result<String, String> {
    let raw = include_str!("../../protocol/test-vectors/vault-vector.json");
    let v: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let password = v["password"].as_str().ok_or("vector missing password")?;
    let salt = v["inputs"]["saltB64"].as_str().ok_or("vector missing salt")?;
    let canary_nonce = v["inputs"]["canaryNonceB64"]
        .as_str()
        .ok_or("vector missing canary nonce")?;
    let expected_canary = v["expected"]["canaryCiphertextB64"]
        .as_str()
        .ok_or("vector missing canary ct")?;

    let key = vault::verify_password(password, salt, canary_nonce, expected_canary)
        .map_err(|_| "canary verification failed".to_string())?;

    let expected_hex = v["expected"]["keyHex"].as_str().ok_or("vector missing keyHex")?;
    let actual_hex: String = key.iter().map(|b| format!("{b:02x}")).collect();
    if actual_hex != expected_hex {
        return Err("derived key does not match committed vector".into());
    }

    let body = v["inputs"]["plaintextBody"]
        .as_str()
        .ok_or("vector missing plaintext")?;
    let nonce = v["inputs"]["nonceB64"].as_str().ok_or("vector missing nonce")?;
    let ct = v["expected"]["ciphertextB64"]
        .as_str()
        .ok_or("vector missing ciphertext")?;
    let decrypted =
        vault::decrypt_body(&key, nonce, ct).map_err(|_| "fixture body failed to decrypt")?;
    if decrypted != body {
        return Err("decrypted body mismatch".into());
    }
    Ok(" (desktop-compatible KDF/cipher verified)".into())
}

fn check_db() -> i32 {
    let dir = data_dir();
    println!("Data dir: {}", dir.display());
    let path = db_path(&dir);
    if !path.exists() {
        println!("Database: absent (first launch will migrate or seed)");
        return 0;
    }
    match db::open_existing(&path) {
        Ok(conn) => {
            let version = db::schema_version(&conn).unwrap_or(-1);
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM snippets", [], |r| r.get(0))
                .unwrap_or(0);
            let vault_cfg = db::load_config(&conn)
                .ok()
                .flatten()
                .map(|c| c.vault_is_configured());
            println!("Database : {}", path.display());
            println!("Schema   : v{version}");
            println!("Snippets : {count}");
            println!(
                "Vault    : {}",
                match vault_cfg {
                    Some(true) => "configured (session-scoped unlock)",
                    Some(false) => "not configured",
                    None => "unknown",
                }
            );
            0
        }
        Err(e) => {
            println!("FAIL could not open database: {e}");
            1
        }
    }
}

fn migrate_only() -> i32 {
    let dir = data_dir();
    println!("Migrating in {}", dir.display());
    match ensure_canonical_db(&dir) {
        Ok((_conn, outcome)) => {
            println!("{}", serde_json::to_string_pretty(&outcome).unwrap_or_default());
            0
        }
        Err(e) => {
            println!("FAIL {}: {}", e.error_code().as_str(), e);
            1
        }
    }
}
