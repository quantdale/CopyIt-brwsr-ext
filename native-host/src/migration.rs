//! One-time, verified, recoverable legacy JSON → SQLite migration.
//!
//! Implements the approved algorithm: cross-process lock, three-way legacy
//! load semantics (corrupt is never collapsed into missing), single-transaction
//! import into a temporary database, exhaustive verification against the
//! sources, atomic install, WAL re-open + re-verify, then uniquely-named
//! backups of the source JSON files. Sources are never deleted or modified;
//! ciphertext is copied byte-for-byte.

use crate::db::{self, DbError};
use crate::legacy::{
    self, canonical_category, sanitize_categories, LegacyConfig, LegacySnippet, SourceLoad,
};
use fs2::FileExt;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Canonical user data directory, resolved with the desktop app's semantics.
/// Debug builds accept `COPYIT_DATA_DIR` for test isolation; release builds
/// never honor arbitrary path overrides.
pub fn data_dir() -> PathBuf {
    #[cfg(debug_assertions)]
    if let Ok(dir) = std::env::var("COPYIT_DATA_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        if !appdata.is_empty() {
            let dir = PathBuf::from(appdata).join("CopyIt");
            let _ = std::fs::create_dir_all(&dir);
            return dir;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            return parent.to_path_buf();
        }
    }
    PathBuf::from(".")
}

// ---------------------------------------------------------------------------
// UTC timestamps without external dependencies.
// ---------------------------------------------------------------------------

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32)
}

fn split_unix_utc(secs: u64) -> ((i64, u32, u32), u32, u32, u32) {
    let days = (secs / 86_400) as i64;
    let rem = (secs % 86_400) as u32;
    (
        civil_from_days(days),
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
    )
}

/// ISO-8601 UTC timestamp (`2026-08-26T19:02:00Z`).
pub fn utc_now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format_unix_utc(secs)
}

pub(crate) fn format_unix_utc(secs: u64) -> String {
    let ((y, mo, d), h, mi, s) = split_unix_utc(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

/// Compact timestamp for backup file names (`20260826-190200`).
pub fn backup_timestamp(secs: u64) -> String {
    let ((y, mo, d), h, mi, s) = split_unix_utc(secs);
    format!("{y:04}{mo:02}{d:02}-{h:02}{mi:02}{s:02}")
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Cross-process migration lock.
// ---------------------------------------------------------------------------

const LOCK_WAIT_BUDGET: Duration = Duration::from_secs(15);
const LOCK_POLL_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Debug, thiserror::Error)]
pub enum MigrationError {
    #[error("another process holds the migration lock")]
    LockTimeout,
    #[error("legacy file {file}: {reason}")]
    LegacyCorrupt { file: &'static str, reason: String },
    #[error("verification failed: {0}")]
    Verification(String),
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Db(#[from] DbError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl MigrationError {
    /// Maps a migration failure to its stable protocol error code.
    pub fn error_code(&self) -> crate::protocol::ErrorCode {
        use crate::protocol::ErrorCode;
        match self {
            MigrationError::LegacyCorrupt { .. } => ErrorCode::LegacyDataCorrupt,
            MigrationError::Db(db_err) => db_err.error_code(),
            MigrationError::LockTimeout => ErrorCode::MigrationInProgress,
            MigrationError::Sqlite(error) if db::is_busy_sqlite_error(error) => {
                ErrorCode::DatabaseBusy
            }
            MigrationError::Sqlite(_) | MigrationError::Io(_) | MigrationError::Verification(_) => {
                ErrorCode::MigrationFailed
            }
        }
    }

    /// Retryable failures must not poison the host's lazy initialization.
    pub fn is_retryable(&self) -> bool {
        self.error_code().retryable()
    }
}

pub struct MigrationLock {
    _file: std::fs::File,
}

impl MigrationLock {
    /// Acquires an exclusive cross-process lock, waiting with bounded backoff.
    pub fn acquire(data_dir: &Path) -> Result<MigrationLock, MigrationError> {
        std::fs::create_dir_all(data_dir)?;
        let path = data_dir.join("migration.lock");
        let file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&path)?;
        let deadline = std::time::Instant::now() + LOCK_WAIT_BUDGET;
        loop {
            match file.try_lock_exclusive() {
                Ok(()) => return Ok(MigrationLock { _file: file }),
                Err(_) if std::time::Instant::now() < deadline => {
                    std::thread::sleep(LOCK_POLL_INTERVAL);
                }
                Err(_) => return Err(MigrationError::LockTimeout),
            }
        }
    }
}

impl Drop for MigrationLock {
    fn drop(&mut self) {
        let _ = self._file.unlock();
    }
}

// ---------------------------------------------------------------------------
// Seed content — byte-identical to CopyIt/src/seed.rs so a host-created fresh
// library equals what the desktop would have created.
// ---------------------------------------------------------------------------

const SEED_ITEMS: &[(&str, &str, &str)] = &[
    (
        "Update all repos (PowerShell)",
        "Git",
        "# Pull latest on every git repo one level under the current folder\r\nGet-ChildItem -Directory | Where-Object { Test-Path \"$($_.FullName)\\.git\" } | ForEach-Object {\r\n    Write-Host \"== $($_.Name) ==\" -ForegroundColor Cyan\r\n    git -C $_.FullName pull --ff-only\r\n}",
    ),
    (
        "Update all repos (bash)",
        "Git",
        "#!/usr/bin/env bash\n# Pull latest on every git repo under the current directory\nfind . -maxdepth 2 -type d -name .git | while read -r gitdir; do\n  repo=\"$(dirname \"$gitdir\")\"\n  echo \"== $repo ==\"\n  git -C \"$repo\" pull --ff-only\ndone",
    ),
    (
        "Discard all local changes",
        "Git",
        "# Throw away uncommitted changes and untracked files (irreversible)\ngit reset --hard HEAD\ngit clean -fd",
    ),
    (
        "Summarize this conversation",
        "Prompt",
        "Summarize our conversation so far into a concise brief. Include:\n1. The objective\n2. Key decisions and their rationale\n3. Any code/artifacts produced (reference by name)\n4. Open questions\n5. Concrete next steps\n\nUse tight bullet points. Omit small talk.",
    ),
    (
        "Generate documentation",
        "Prompt",
        "You are a senior technical writer. Given the code/context below, produce clear documentation covering: purpose, prerequisites, setup/usage with examples, configuration options, and common pitfalls. Prefer prose with short code blocks. Do not invent behavior that isn't present in the source.\n\n---\n<paste code/context here>",
    ),
    (
        "Session handoff / context transfer",
        "Prompt",
        "Export the full context of this session into a single self-contained block I can paste into a fresh chat to continue seamlessly. Include, verbatim where it matters:\n- Current objective\n- The narrative of what we've done\n- Decisions made (with rationale)\n- All artifacts in full\n- Open questions\n- Immediate next steps\n\nWrite it so a model with zero prior context can pick up exactly where we left off.",
    ),
];

pub fn default_seed() -> Vec<LegacySnippet> {
    SEED_ITEMS
        .iter()
        .enumerate()
        .map(|(i, (title, category, body))| LegacySnippet {
            id: (i as u64) + 1,
            title: (*title).to_string(),
            category: (*category).to_string(),
            body: (*body).to_string(),
            protection: None,
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Outcome types.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupOutcome {
    pub file: String,
    pub status: String,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MigrationOutcome {
    /// Database already existed and validated; JSON was not touched.
    AlreadyCanonical { schema_version: i64 },
    /// Valid legacy JSON imported, verified, installed, sources backed up.
    Migrated {
        snippets: usize,
        backups: Vec<BackupOutcome>,
    },
    /// No user data found anywhere; fresh seeded library created.
    FreshSeeded { snippets: usize },
}

impl MigrationOutcome {
    pub fn status_string(&self) -> &'static str {
        match self {
            MigrationOutcome::AlreadyCanonical { .. } => "ready",
            MigrationOutcome::Migrated { .. } => "migrated",
            MigrationOutcome::FreshSeeded { .. } => "seeded",
        }
    }
}

// ---------------------------------------------------------------------------
// Core algorithm.
// ---------------------------------------------------------------------------

pub fn db_path(data_dir: &Path) -> PathBuf {
    data_dir.join(db::DB_FILE_NAME)
}

/// Ensures the canonical SQLite database exists and is healthy, performing the
/// legacy import exactly once. Returns an open connection to the canonical DB.
pub fn ensure_canonical_db(
    data_dir: &Path,
) -> Result<(rusqlite::Connection, MigrationOutcome), MigrationError> {
    std::fs::create_dir_all(data_dir)?;
    let path = db_path(data_dir);

    if path.exists() {
        let conn = db::open_existing(&path)?;
        let version = db::schema_version(&conn)?;
        return Ok((
            conn,
            MigrationOutcome::AlreadyCanonical {
                schema_version: version,
            },
        ));
    }

    let _lock = MigrationLock::acquire(data_dir)?;

    // Re-check under the lock: another process may have finished migrating.
    if path.exists() {
        let conn = db::open_existing(&path)?;
        let version = db::schema_version(&conn)?;
        return Ok((
            conn,
            MigrationOutcome::AlreadyCanonical {
                schema_version: version,
            },
        ));
    }

    let snippets_src = legacy::read_source::<Vec<LegacySnippet>>(&data_dir.join("snippets.json"));
    let config_src = legacy::read_source::<LegacyConfig>(&data_dir.join("config.json"));

    if let SourceLoad::Corrupt(reason) = &snippets_src {
        return Err(MigrationError::LegacyCorrupt {
            file: "snippets.json",
            reason: reason.clone(),
        });
    }
    if let SourceLoad::Corrupt(reason) = &config_src {
        return Err(MigrationError::LegacyCorrupt {
            file: "config.json",
            reason: reason.clone(),
        });
    }

    let has_user_data = matches!(&snippets_src, SourceLoad::Loaded(_))
        || matches!(&config_src, SourceLoad::Loaded(_));

    let (snippets, mut config) = if has_user_data {
        let snippets = match &snippets_src {
            SourceLoad::Loaded(v) => v.clone(),
            _ => Vec::new(),
        };
        let cfg = match &config_src {
            SourceLoad::Loaded(v) => v.clone(),
            _ => LegacyConfig::default(),
        };
        (snippets, cfg)
    } else {
        (
            default_seed(),
            LegacyConfig {
                categories: vec!["Git".into(), "Prompt".into()],
                theme: "Dark".into(),
                vault: None,
            },
        )
    };
    if config.theme.is_empty() {
        config.theme = "Dark".to_string();
    }

    let outcome_kind = if has_user_data {
        "migrated"
    } else {
        "fresh-seeded"
    };
    let snippets_hash = match &snippets_src {
        SourceLoad::Loaded(_) => hash_file(&data_dir.join("snippets.json")),
        SourceLoad::Missing => "none".to_string(),
        // Unreachable: corrupt sources abort above.
        SourceLoad::Corrupt(reason) => format!("corrupt:{reason}"),
    };
    let config_hash = match &config_src {
        SourceLoad::Loaded(_) => hash_file(&data_dir.join("config.json")),
        SourceLoad::Missing => "none".to_string(),
        SourceLoad::Corrupt(reason) => format!("corrupt:{reason}"),
    };

    let tmp_path = data_dir.join(format!("copyit.db.migrating.{}", std::process::id()));
    let _ = std::fs::remove_file(&tmp_path);

    build_and_install(
        &tmp_path,
        &path,
        &snippets,
        &config,
        &[
            ("migrated_at", &utc_now_iso()),
            ("source_snippets_sha256", &snippets_hash),
            ("source_config_sha256", &config_hash),
            ("source_kind", outcome_kind),
        ],
    )?;

    // Reopen canonical with WAL and verify once more.
    let conn = db::open_existing(&path)?;

    let backups = if has_user_data {
        backup_legacy_files(data_dir, now_secs())
    } else {
        Vec::new()
    };
    sweep_stale_temp_migrations(data_dir);

    let outcome = if has_user_data {
        MigrationOutcome::Migrated {
            snippets: snippets.len(),
            backups,
        }
    } else {
        MigrationOutcome::FreshSeeded {
            snippets: snippets.len(),
        }
    };
    Ok((conn, outcome))
}

/// SHA-256 hex of a file's exact bytes, or `"none"` when absent.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn hash_file(path: &Path) -> String {
    match std::fs::read(path) {
        Ok(bytes) => hex(&Sha256::digest(&bytes)),
        Err(_) => "none".to_string(),
    }
}

fn build_and_install(
    tmp_path: &Path,
    final_path: &Path,
    snippets: &[LegacySnippet],
    config: &LegacyConfig,
    meta_rows: &[(&str, &str)],
) -> Result<(), MigrationError> {
    let conn = rusqlite::Connection::open(tmp_path)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // Rollback journal during construction; WAL is enabled after installation.
    db::migrate_forward(&conn)?;

    let now = utc_now_iso();

    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result =
        (|| -> Result<(), MigrationError> {
            // Canonical category list: sanitized config categories unioned with
            // every snippet category (mirrors the desktop's add_categories pass).
            let mut cat_source: Vec<String> = config.categories.clone();
            for s in snippets {
                cat_source.push(s.category.clone());
            }
            let categories = sanitize_categories(&cat_source);
            for (order, name) in categories.iter().enumerate() {
                conn.execute(
                    "INSERT INTO categories (name, sort_order) VALUES (?1, ?2)",
                    rusqlite::params![name, order as i64],
                )?;
            }

            for (sort_order, s) in snippets.iter().enumerate() {
                let protected = s.protection.as_ref();
                let (hint, nonce, ct): (Option<&str>, Option<&str>, Option<&str>) = match protected
                {
                    Some(p) => (
                        Some(p.hint.as_str()),
                        Some(p.nonce.as_str()),
                        Some(p.ciphertext.as_str()),
                    ),
                    None => (None, None, None),
                };
                conn.execute(
                    "INSERT INTO snippets
                    (id, title, description, category, body,
                     protection_hint, protection_nonce, protection_ciphertext,
                     sort_order, created_at, updated_at)
                 VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                    rusqlite::params![
                        s.id as i64,
                        s.title,
                        canonical_category(&s.category),
                        if protected.is_some() {
                            ""
                        } else {
                            s.body.as_str()
                        },
                        hint,
                        nonce,
                        ct,
                        sort_order as i64,
                        now,
                    ],
                )?;
            }

            let vault_params: (Option<&str>, Option<&str>, Option<&str>) = match &config.vault {
                Some(v) => (
                    Some(v.salt.as_str()),
                    Some(v.nonce.as_str()),
                    Some(v.canary.as_str()),
                ),
                None => (None, None, None),
            };
            conn.execute(
            "INSERT INTO app_config (singleton_id, theme, vault_salt, vault_nonce, vault_canary)
             VALUES (1, ?1, ?2, ?3, ?4)",
            rusqlite::params![
                if config.theme.trim().is_empty() { "Dark" } else { config.theme.trim() },
                vault_params.0,
                vault_params.1,
                vault_params.2
            ],
        )?;

            for (key, value) in meta_rows {
                db::set_migration_meta(&conn, key, value)?;
            }

            verify_imported(&conn, snippets, config)?;
            Ok(())
        })();
    match result {
        Ok(()) => conn.execute_batch("COMMIT")?,
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            let _ = conn.close();
            let _ = std::fs::remove_file(tmp_path);
            return Err(e);
        }
    }
    conn.close().map_err(|(_, e)| MigrationError::Sqlite(e))?;

    // Flush the finished temp database to disk before installing it.
    // The handle needs write access for FlushFileBuffers on Windows.
    {
        let f = std::fs::OpenOptions::new().write(true).open(tmp_path)?;
        f.sync_all()?;
    }

    std::fs::rename(tmp_path, final_path)?;
    Ok(())
}

/// Exhaustive pre-install verification (plan §6.3 step 8). Any mismatch aborts
/// the migration; sources remain untouched.
fn verify_imported(
    conn: &rusqlite::Connection,
    snippets: &[LegacySnippet],
    config: &LegacyConfig,
) -> Result<(), MigrationError> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM snippets", [], |r| r.get(0))?;
    if count != snippets.len() as i64 {
        return Err(MigrationError::Verification(format!(
            "row count {count} != legacy count {}",
            snippets.len()
        )));
    }

    for s in snippets {
        let row = conn
            .query_row(
                "SELECT title, COALESCE(description,''), category, body,
                        protection_hint, protection_nonce, protection_ciphertext
                 FROM snippets WHERE id = ?1",
                rusqlite::params![s.id as i64],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, Option<String>>(4)?,
                        r.get::<_, Option<String>>(5)?,
                        r.get::<_, Option<String>>(6)?,
                    ))
                },
            )
            .map_err(|e| MigrationError::Verification(format!("id {}: {e}", s.id)))?;

        let protected = s.protection.as_ref();
        if row.0 != s.title {
            return Err(MigrationError::Verification(format!(
                "id {}: title mismatch",
                s.id
            )));
        }
        if row.2 != canonical_category(&s.category) {
            return Err(MigrationError::Verification(format!(
                "id {}: category mismatch",
                s.id
            )));
        }
        match protected {
            Some(p) => {
                if !row.3.is_empty() {
                    return Err(MigrationError::Verification(format!(
                        "id {}: protected body must be empty",
                        s.id
                    )));
                }
                if row.4.as_deref() != Some(p.hint.as_str())
                    || row.5.as_deref() != Some(p.nonce.as_str())
                    || row.6.as_deref() != Some(p.ciphertext.as_str())
                {
                    return Err(MigrationError::Verification(format!(
                        "id {}: protection payload mismatch",
                        s.id
                    )));
                }
            }
            None => {
                if row.3 != s.body {
                    return Err(MigrationError::Verification(format!(
                        "id {}: body mismatch",
                        s.id
                    )));
                }
                if row.4.is_some() || row.5.is_some() || row.6.is_some() {
                    return Err(MigrationError::Verification(format!(
                        "id {}: unexpected protection columns",
                        s.id
                    )));
                }
            }
        }
    }

    // Category set must equal the canonicalized union.
    let mut cat_source: Vec<String> = config.categories.clone();
    for s in snippets {
        cat_source.push(s.category.clone());
    }
    let expected_categories = sanitize_categories(&cat_source);
    let mut stored: Vec<String> = {
        let mut stmt = conn.prepare("SELECT name FROM categories ORDER BY sort_order, name")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    stored.sort();
    let mut expected_sorted = expected_categories.clone();
    expected_sorted.sort();
    if stored != expected_sorted {
        return Err(MigrationError::Verification(
            "category set mismatch".to_string(),
        ));
    }

    // Theme + vault metadata exactness.
    let cfg = db::load_config(conn)?
        .ok_or_else(|| MigrationError::Verification("missing app_config row".into()))?;
    if cfg.theme != config.theme && !(config.theme.trim().is_empty() && cfg.theme == "Dark") {
        return Err(MigrationError::Verification("theme mismatch".to_string()));
    }
    match (&config.vault, cfg.vault_meta()) {
        (None, None) => {}
        (Some(want), Some(got)) => {
            if want.salt != got.salt || want.nonce != got.nonce || want.canary != got.canary {
                return Err(MigrationError::Verification(
                    "vault metadata mismatch".to_string(),
                ));
            }
        }
        _ => {
            return Err(MigrationError::Verification(
                "vault presence mismatch".to_string(),
            ))
        }
    }

    db::verify_lightweight(conn)?;
    Ok(())
}

/// Renames legacy JSON sources to uniquely named backups. Never deletes them;
/// failures are reported, not fatal (the verified DB stays canonical).
fn backup_legacy_files(data_dir: &Path, now_secs_value: u64) -> Vec<BackupOutcome> {
    let ts = backup_timestamp(now_secs_value);
    let mut out = Vec::new();
    for name in ["snippets.json", "config.json"] {
        let src = data_dir.join(name);
        if !src.exists() {
            out.push(BackupOutcome {
                file: name.into(),
                status: "absent".into(),
                backup_path: None,
            });
            continue;
        }
        match unique_backup_path(data_dir, name, &ts) {
            Some(dest) => match std::fs::rename(&src, &dest) {
                Ok(()) => out.push(BackupOutcome {
                    file: name.into(),
                    status: "backed-up".into(),
                    backup_path: Some(dest.file_name().unwrap().to_string_lossy().into_owned()),
                }),
                Err(_) => {
                    // Do NOT delete or overwrite the JSON; report the warning.
                    out.push(BackupOutcome {
                        file: name.into(),
                        status: "backup-failed".into(),
                        backup_path: None,
                    })
                }
            },
            None => out.push(BackupOutcome {
                file: name.into(),
                status: "backup-failed".into(),
                backup_path: None,
            }),
        }
    }
    out
}

fn unique_backup_path(data_dir: &Path, name: &str, ts: &str) -> Option<PathBuf> {
    let base = data_dir.join(format!("{name}.legacy-backup-{ts}"));
    if !base.exists() {
        return Some(base);
    }
    for n in 1..10_000u32 {
        let candidate = data_dir.join(format!("{name}.legacy-backup-{ts}.{n}"));
        if !candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

/// Removes leftover temporary migration databases. Safe because the caller
/// holds the migration lock and the canonical DB has just been installed and
/// verified, so no surviving user data can live exclusively inside a temp file.
fn sweep_stale_temp_migrations(data_dir: &Path) {
    let prefix = "copyit.db.migrating.";
    if let Ok(entries) = std::fs::read_dir(data_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with(prefix) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::legacy::LegacyProtection;
    #[test]
    fn retryability_classification_preserves_terminal_failures() {
        assert!(MigrationError::LockTimeout.is_retryable());
        assert!(!MigrationError::LegacyCorrupt {
            file: "snippets.json",
            reason: "invalid JSON".into(),
        }
        .is_retryable());
        assert!(!MigrationError::Verification("row mismatch".into()).is_retryable());
        assert!(!MigrationError::Io(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "denied",
        ))
        .is_retryable());
    }

    fn write(path: &Path, contents: &str) {
        std::fs::write(path, contents).unwrap();
    }

    fn snippet_json(id: u64, title: &str, cat: &str, body: &str) -> String {
        format!(
            r#"{{"id":{id},"title":"{title}","category":"{cat}","body":"{}"}}"#,
            body.replace('"', "\\\"")
        )
    }

    #[test]
    fn timestamps_render_iso_and_backup_format() {
        assert_eq!(format_unix_utc(0), "1970-01-01T00:00:00Z");
        // 2026-08-26T19:02:00Z == 1787770920
        assert_eq!(format_unix_utc(1_787_770_920), "2026-08-26T19:02:00Z");
        assert_eq!(backup_timestamp(1_787_770_920), "20260826-190200");
    }

    #[test]
    fn fresh_dir_seeds_the_desktop_default_library() {
        let dir = tempfile::tempdir().unwrap();
        let (_conn, outcome) = ensure_canonical_db(dir.path()).unwrap();
        assert_eq!(outcome, MigrationOutcome::FreshSeeded { snippets: 6 });

        let (ids, titles): (Vec<i64>, Vec<String>) = {
            let conn = db::open_existing(&db_path(dir.path())).unwrap();
            let mut stmt = conn
                .prepare("SELECT id, title FROM snippets ORDER BY sort_order")
                .unwrap();
            let rows: Vec<(i64, String)> = stmt
                .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            rows.into_iter().unzip()
        };
        assert_eq!(ids, vec![1, 2, 3, 4, 5, 6]);
        assert_eq!(titles[0], "Update all repos (PowerShell)");
    }

    #[test]
    fn second_launch_is_already_canonical_and_never_reimports() {
        let dir = tempfile::tempdir().unwrap();
        ensure_canonical_db(dir.path()).unwrap();
        // Leave a poisoned legacy file behind: it must be ignored entirely.
        write(&dir.path().join("snippets.json"), "garbage");
        let (_conn, outcome) = ensure_canonical_db(dir.path()).unwrap();
        assert!(matches!(
            outcome,
            MigrationOutcome::AlreadyCanonical { schema_version: 1 }
        ));
    }

    #[test]
    fn valid_legacy_json_is_imported_with_ids_order_and_backups() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let snips = format!(
            "[{},{}]",
            snippet_json(42, "Second", "prompt", "body two"),
            snippet_json(7, "First", "git", "body one")
        );
        write(&d.join("snippets.json"), &snips);
        write(
            &d.join("config.json"),
            r#"{"categories":["git","PROMPT"],"theme":"Nord"}"#,
        );

        let (conn, outcome) = ensure_canonical_db(d).unwrap();
        let MigrationOutcome::Migrated {
            snippets: 2,
            backups,
        } = outcome
        else {
            panic!("expected migrated, got {outcome:?}");
        };
        assert!(backups
            .iter()
            .any(|b| b.file == "snippets.json" && b.status == "backed-up"));
        assert!(backups
            .iter()
            .any(|b| b.file == "config.json" && b.status == "backed-up"));

        // IDs preserved exactly; array order becomes sort_order.
        let mut stmt = conn
            .prepare("SELECT id, title, category FROM snippets ORDER BY sort_order")
            .unwrap();
        let rows: Vec<(i64, String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            rows,
            vec![
                (42, "Second".into(), "Prompt".into()),
                (7, "First".into(), "Git".into())
            ]
        );

        let theme: String = conn
            .query_row(
                "SELECT theme FROM app_config WHERE singleton_id=1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(theme, "Nord");

        // Sources renamed away, originals gone, backups exist.
        assert!(!d.join("snippets.json").exists());
        assert!(!d.join("config.json").exists());
    }

    #[test]
    fn protected_payloads_survive_byte_for_byte() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let p = LegacyProtection {
            hint: "aGludA==".into(),
            nonce: "24bytebm9uY2Vub25jZQ==".into(),
            ciphertext: "c2VjcmV0Y2lwaGVydGV4dA==".into(),
        };
        let json = serde_json::json!([{
            "id": 5,
            "title": "Locked",
            "category": "Prompt",
            "body": "",
            "protection": {"hint": p.hint, "nonce": p.nonce, "ciphertext": p.ciphertext}
        }])
        .to_string();
        write(&d.join("snippets.json"), &json);
        write(
            &d.join("config.json"),
            r#"{"categories":["prompt"],"theme":"Dark"}"#,
        );

        let (conn, _) = ensure_canonical_db(d).unwrap();
        let (body, hint, nonce, ct): (String, Option<String>, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT body, protection_hint, protection_nonce, protection_ciphertext FROM snippets WHERE id=5",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(body, "");
        assert_eq!(hint.unwrap(), "aGludA==");
        assert_eq!(nonce.unwrap(), "24bytebm9uY2Vub25jZQ==");
        assert_eq!(ct.unwrap(), "c2VjcmV0Y2lwaGVydGV4dA==");
    }

    #[test]
    fn corrupt_legacy_snippets_abort_migration_and_preserve_sources() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        write(&d.join("snippets.json"), "this is definitely not json");
        write(&d.join("config.json"), r#"{"theme":"Nord"}"#);

        let err = ensure_canonical_db(d).unwrap_err();
        assert!(matches!(
            err,
            MigrationError::LegacyCorrupt {
                file: "snippets.json",
                ..
            }
        ));

        // Nothing was created or destroyed.
        assert!(!d.join("copyit.db").exists());
        assert_eq!(
            std::fs::read_to_string(d.join("snippets.json")).unwrap(),
            "this is definitely not json"
        );
        assert!(!d.join("snippets.json.corrupt").exists());
    }

    #[test]
    fn corrupt_config_also_aborts() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        write(&d.join("snippets.json"), "[]");
        write(&d.join("config.json"), "{oops");
        assert!(matches!(
            ensure_canonical_db(d),
            Err(MigrationError::LegacyCorrupt {
                file: "config.json",
                ..
            })
        ));
    }

    #[test]
    fn empty_json_array_is_real_empty_data_not_first_run() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        write(&d.join("snippets.json"), "[]");
        let (conn, outcome) = ensure_canonical_db(d).unwrap();
        assert!(matches!(
            outcome,
            MigrationOutcome::Migrated { snippets: 0, .. }
        ));
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM snippets", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "an explicitly emptied library must stay empty");
    }

    #[test]
    fn zero_byte_files_behave_as_missing_and_seed_fresh() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        write(&d.join("snippets.json"), "");
        write(&d.join("config.json"), "");
        let (_conn, outcome) = ensure_canonical_db(d).unwrap();
        assert!(matches!(
            outcome,
            MigrationOutcome::FreshSeeded { snippets: 6 }
        ));
        // Zero-byte files are preserved as backups anyway (they existed).
    }

    #[test]
    fn vault_metadata_is_preserved_exactly() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        write(&d.join("snippets.json"), "[]");
        write(
            &d.join("config.json"),
            r#"{"categories":[],"theme":"Solarized","vault":{"salt":"cw==","nonce":"bg==","canary":"Yw=="}}"#,
        );
        let (conn, _) = ensure_canonical_db(d).unwrap();
        let cfg = db::load_config(&conn).unwrap().unwrap();
        assert!(cfg.vault_is_configured());
        let meta = cfg.vault_meta().unwrap();
        assert_eq!(
            (
                meta.salt.as_str(),
                meta.nonce.as_str(),
                meta.canary.as_str()
            ),
            ("cw==", "bg==", "Yw==")
        );
    }

    #[test]
    fn migration_records_audit_metadata_with_source_hashes() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        write(&d.join("snippets.json"), "[]");
        write(&d.join("config.json"), "{}");
        let (conn, _) = ensure_canonical_db(d).unwrap();
        let migrated_at = db::get_migration_meta(&conn, "migrated_at").unwrap();
        assert!(migrated_at.unwrap().ends_with('Z'));
        let kind = db::get_migration_meta(&conn, "source_kind")
            .unwrap()
            .unwrap();
        assert_eq!(kind, "migrated");
        // Hashes are recorded even though the backup was renamed away.
        let snip_hash = db::get_migration_meta(&conn, "source_snippets_sha256")
            .unwrap()
            .unwrap();
        assert_eq!(snip_hash.len(), 64, "sha256 hex expected");
    }

    #[test]
    fn stale_temp_databases_are_swept_after_success() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        write(&d.join("copyit.db.migrating.999999"), "leftover junk");
        ensure_canonical_db(d).unwrap();
        assert!(!d.join("copyit.db.migrating.999999").exists());
    }

    #[test]
    fn concurrent_launch_waits_for_lock_then_reuses_result() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let guard = MigrationLock::acquire(d).unwrap();

        let d2 = d.to_path_buf();
        let handle = std::thread::spawn(move || ensure_canonical_db(&d2));

        std::thread::sleep(Duration::from_millis(150));
        drop(guard);

        let result = handle.join().unwrap().unwrap();
        // First-run seed happens under our released lock; child observes canonical.
        assert!(matches!(
            result.1,
            MigrationOutcome::FreshSeeded { .. } | MigrationOutcome::AlreadyCanonical { .. }
        ));
    }

    #[test]
    fn existing_valid_db_short_circuits_without_lock_or_import() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        ensure_canonical_db(d).unwrap();
        // Poison everything: none of it may matter.
        write(&d.join("snippets.json"), "junk that must be ignored");
        let held = MigrationLock::acquire(d).unwrap(); // hold the lock ourselves
        let res = ensure_canonical_db(d); // must not need the lock
        assert!(res.is_ok());
        drop(held);
    }

    #[test]
    fn repeated_backups_never_overwrite_and_collisions_get_suffixes() {
        // Deterministic test of TWO real invariants (no wall-clock, no sleep):
        //   1. Two backup operations (even in the same timestamp second) must
        //      never clobber an earlier backup.
        //   2. Same-timestamp filename collisions are resolved with `.1`, `.2`, …
        // The fixed timestamp is passed straight into the backup helper, so the
        // result cannot depend on whether the clock rolls over a second boundary.
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let fixed_secs = 1_787_700_000u64; // deterministic UTC instant
        let ts = backup_timestamp(fixed_secs);

        write(&d.join("snippets.json"), "first");
        write(&d.join("config.json"), "{}");

        // First backup run.
        let first = backup_legacy_files(d, fixed_secs);
        let first_snip = first.iter().find(|b| b.file == "snippets.json").unwrap();
        assert_eq!(first_snip.status, "backed-up");
        let expected_first = format!("snippets.json.legacy-backup-{ts}");
        assert_eq!(
            first_snip.backup_path.as_deref(),
            Some(expected_first.as_str())
        );
        assert!(d.join(format!("snippets.json.legacy-backup-{ts}")).exists());

        // Simulate a concurrent migration arriving in the SAME timestamp second:
        // sources reappear and are backed up again. Must NOT overwrite the first.
        write(&d.join("snippets.json"), "second");
        write(&d.join("config.json"), "{}");
        let second = backup_legacy_files(d, fixed_secs);
        let second_snip = second.iter().find(|b| b.file == "snippets.json").unwrap();
        let expected_second = format!("snippets.json.legacy-backup-{ts}.1");
        assert_eq!(
            second_snip.backup_path.as_deref(),
            Some(expected_second.as_str())
        );
        assert_ne!(first_snip.backup_path, second_snip.backup_path);

        // Both backups survive, with exact original contents — nothing clobbered.
        assert!(d.join(format!("snippets.json.legacy-backup-{ts}")).exists());
        assert!(d
            .join(format!("snippets.json.legacy-backup-{ts}.1"))
            .exists());
        assert_eq!(
            std::fs::read_to_string(d.join(format!("snippets.json.legacy-backup-{ts}"))).unwrap(),
            "first"
        );
        assert_eq!(
            std::fs::read_to_string(d.join(format!("snippets.json.legacy-backup-{ts}.1"))).unwrap(),
            "second"
        );
        assert!(
            !d.join("snippets.json").exists(),
            "source renamed away both times"
        );
    }

    #[test]
    fn unique_backup_path_increments_existing_suffixes() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let name = "snippets.json";
        let ts = "20260827-000000";
        write(&d.join(format!("{name}.legacy-backup-{ts}")), "a");
        write(&d.join(format!("{name}.legacy-backup-{ts}.1")), "b");
        // Next candidate must be .2, never reusing an existing path.
        let next = unique_backup_path(d, name, ts).unwrap();
        assert_eq!(
            next.file_name().unwrap().to_string_lossy(),
            format!("{name}.legacy-backup-{ts}.2")
        );
        assert!(!next.exists());
    }

    #[test]
    fn seed_matches_desktop_reference_bodies() {
        let seed = default_seed();
        assert_eq!(seed.len(), 6);
        assert_eq!(seed[0].title, "Update all repos (PowerShell)");
        assert!(seed[0].body.contains("pull --ff-only"));
        assert_eq!(seed[2].body, "# Throw away uncommitted changes and untracked files (irreversible)\ngit reset --hard HEAD\ngit clean -fd");
        assert!(seed[5].body.contains("zero prior context"));
    }
}
