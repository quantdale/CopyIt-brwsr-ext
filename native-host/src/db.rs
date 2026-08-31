//! Canonical SQLite storage for the shared CopyIt library.
//!
//! Schema versioning: every schema change is a forward migration recorded in
//! `schema_migrations`. A database newer than `MAX_SUPPORTED_SCHEMA_VERSION`
//! is refused (`unsupported_schema_version`) instead of guessed at.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

/// Highest schema version this binary understands.
pub const MAX_SUPPORTED_SCHEMA_VERSION: i64 = 1;

pub const DB_FILE_NAME: &str = "copyit.db";

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("database schema version {found} is newer than supported {supported}")]
    UnsupportedSchemaVersion { found: i64, supported: i64 },
    #[error("database is busy")]
    Busy,
    #[error("integrity check failed: {0}")]
    Integrity(String),
    #[error("sqlite error: {0}")]
    Rusqlite(rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub(crate) fn is_busy_sqlite_error(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(failure, _)
            if matches!(
                failure.code,
                rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
            )
    )
}

impl From<rusqlite::Error> for DbError {
    fn from(error: rusqlite::Error) -> Self {
        if is_busy_sqlite_error(&error) {
            DbError::Busy
        } else {
            DbError::Rusqlite(error)
        }
    }
}

impl DbError {
    /// Maps a database failure to its stable protocol error code.
    pub fn error_code(&self) -> crate::protocol::ErrorCode {
        use crate::protocol::ErrorCode;
        match self {
            DbError::Busy => ErrorCode::DatabaseBusy,
            DbError::UnsupportedSchemaVersion { .. } => ErrorCode::UnsupportedSchemaVersion,
            DbError::Rusqlite(error) if is_busy_sqlite_error(error) => ErrorCode::DatabaseBusy,
            _ => ErrorCode::DatabaseUnavailable,
        }
    }
}

const SCHEMA_V1: &str = r#"
CREATE TABLE schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    applied_at  TEXT NOT NULL
);

CREATE TABLE snippets (
    id                      INTEGER PRIMARY KEY,
    title                   TEXT NOT NULL,
    description             TEXT,
    category                TEXT NOT NULL,
    body                    TEXT NOT NULL DEFAULT '',
    protection_hint         TEXT,
    protection_nonce        TEXT,
    protection_ciphertext   TEXT,
    sort_order              INTEGER NOT NULL,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL,

    CHECK (
      (protection_hint IS NULL AND protection_nonce IS NULL AND protection_ciphertext IS NULL)
      OR
      (protection_hint IS NOT NULL AND protection_nonce IS NOT NULL AND protection_ciphertext IS NOT NULL AND body = '')
    )
);

CREATE INDEX idx_snippets_sort_order
    ON snippets(sort_order, id);

CREATE INDEX idx_snippets_category
    ON snippets(category COLLATE NOCASE);

CREATE TABLE categories (
    name       TEXT PRIMARY KEY COLLATE NOCASE,
    sort_order INTEGER NOT NULL
);

CREATE TABLE app_config (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    theme        TEXT NOT NULL,
    vault_salt   TEXT,
    vault_nonce  TEXT,
    vault_canary TEXT,
    CHECK (
      (vault_salt IS NULL AND vault_nonce IS NULL AND vault_canary IS NULL)
      OR
      (vault_salt IS NOT NULL AND vault_nonce IS NOT NULL AND vault_canary IS NOT NULL)
    )
);

CREATE TABLE migration_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

/// Applies connection pragmas required by the storage contract.
/// WAL allows the desktop app to write while the native host reads.
pub fn apply_pragmas(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "busy_timeout", 3000)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

/// Opens an existing canonical database, validates it and applies forward migrations.
pub fn open_existing(path: &std::path::Path) -> Result<Connection, DbError> {
    let conn = Connection::open(path)?;
    apply_pragmas(&conn)?;
    migrate_forward(&conn)?;
    verify_lightweight(&conn)?;
    Ok(conn)
}

/// Current applied schema version; 0 when no migrations table exists yet.
pub fn schema_version(conn: &Connection) -> Result<i64, DbError> {
    let has_table: Option<String> = conn
        .query_row(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if has_table.is_none() {
        return Ok(0);
    }
    // A schema_migrations row exists only after its migration committed.
    let max: Option<i64> =
        conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })?;
    Ok(max.unwrap_or(0))
}

fn record_migration(conn: &Connection, version: i64, name: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
        params![version, name, crate::migration::utc_now_iso()],
    )?;
    Ok(())
}

/// Applies all pending forward migrations. Refuses databases newer than supported.
pub fn migrate_forward(conn: &Connection) -> Result<(), DbError> {
    let current = schema_version(conn)?;
    if current > MAX_SUPPORTED_SCHEMA_VERSION {
        return Err(DbError::UnsupportedSchemaVersion {
            found: current,
            supported: MAX_SUPPORTED_SCHEMA_VERSION,
        });
    }
    if current < 1 {
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| -> Result<(), DbError> {
            conn.execute_batch(SCHEMA_V1)?;
            record_migration(conn, 1, "initial_schema")?;
            Ok(())
        })();
        match result {
            Ok(()) => conn.execute_batch("COMMIT")?,
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(e);
            }
        }
    }
    Ok(())
}

/// Lightweight health check used after opening/migrating.
pub fn verify_lightweight(conn: &Connection) -> Result<(), DbError> {
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(DbError::Integrity(integrity));
    }
    let fk_violations =
        conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get::<_, i64>(0)
        })?;
    if fk_violations != 0 {
        return Err(DbError::Integrity(format!(
            "{fk_violations} foreign key violations"
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Read-side query repository (V1 exposes no write methods over the protocol).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct SnippetMeta {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub category: String,
    #[serde(rename = "protected")]
    pub is_protected: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CategoryInfo {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Clone)]
pub struct AppConfigRow {
    pub theme: String,
    pub vault_salt: Option<String>,
    pub vault_nonce: Option<String>,
    pub vault_canary: Option<String>,
}

impl AppConfigRow {
    pub fn vault_is_configured(&self) -> bool {
        self.vault_salt.is_some()
    }

    pub fn vault_meta(&self) -> Option<vault_shim::VaultMeta> {
        Some(vault_shim::VaultMeta {
            salt: self.vault_salt.clone()?,
            nonce: self.vault_nonce.clone()?,
            canary: self.vault_canary.clone()?,
        })
    }
}

/// Narrow re-export shim so db.rs does not depend on migration internals.
pub(crate) mod vault_shim {
    #[derive(Debug, Clone)]
    pub struct VaultMeta {
        pub salt: String,
        pub nonce: String,
        pub canary: String,
    }
}

pub const PAGE_LIMIT_CAP: i64 = 200;

/// Escapes SQL LIKE wildcards in user input; always used with bound params
/// plus `ESCAPE '\'` so user data can never alter query structure.
fn escape_like(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        if c == '\\' || c == '%' || c == '_' {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn search_filter(
    query: Option<&str>,
    category: Option<&str>,
) -> (Vec<&'static str>, Vec<Box<dyn rusqlite::types::ToSql>>) {
    let mut clauses: Vec<&'static str> = Vec::new();
    let mut binds: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    if let Some(q) = query.map(str::trim).filter(|q| !q.is_empty()) {
        clauses.push(
            "(title LIKE ? ESCAPE '\\' COLLATE NOCASE
             OR description LIKE ? ESCAPE '\\' COLLATE NOCASE
             OR category LIKE ? ESCAPE '\\' COLLATE NOCASE
             OR body LIKE ? ESCAPE '\\' COLLATE NOCASE)",
        );
        let pattern = format!("%{}%", escape_like(q));
        for _ in 0..4 {
            binds.push(Box::new(pattern.clone()));
        }
    }
    if let Some(cat) = category.filter(|c| !c.is_empty()) {
        clauses.push("category = ? COLLATE NOCASE");
        binds.push(Box::new(cat.to_string()));
    }
    (clauses, binds)
}

fn where_sql(clauses: &[&'static str]) -> String {
    if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    }
}

pub fn list_categories(conn: &Connection) -> Result<Vec<CategoryInfo>, DbError> {
    let mut stmt = conn.prepare_cached(
        "SELECT c.name, COUNT(s.id) AS snippet_count
         FROM categories c
         LEFT JOIN snippets s ON s.category = c.name COLLATE NOCASE
         GROUP BY c.name
         ORDER BY c.sort_order, c.name",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(CategoryInfo {
                name: row.get(0)?,
                count: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Categories referenced only by snippets (legacy configs may omit them).
    let missing: Vec<CategoryInfo> = {
        let mut stmt = conn.prepare_cached(
            "SELECT DISTINCT category, COUNT(*) FROM snippets s
             WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = s.category COLLATE NOCASE)
             GROUP BY category ORDER BY category",
        )?;
        let collected = stmt
            .query_map([], |row| {
                Ok(CategoryInfo {
                    name: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        collected
    };
    let mut all = rows;
    all.extend(missing);
    Ok(all)
}

pub fn list_snippets(
    conn: &Connection,
    query: Option<&str>,
    category: Option<&str>,
    offset: i64,
    limit: i64,
) -> Result<(Vec<SnippetMeta>, i64), DbError> {
    let limit = limit.clamp(1, PAGE_LIMIT_CAP);
    let offset = offset.max(0);
    let (clauses, mut binds) = search_filter(query, category);
    let where_clause = where_sql(&clauses);

    let total: i64 = {
        let sql = format!("SELECT COUNT(*) FROM snippets{where_clause}");
        let mut stmt = conn.prepare_cached(&sql)?;
        stmt.query_row(
            rusqlite::params_from_iter(binds.iter().map(|b| b.as_ref())),
            |row| row.get(0),
        )?
    };

    let sql = format!(
        "SELECT id, title, COALESCE(description, ''), category,
                (protection_ciphertext IS NOT NULL) AS protected
         FROM snippets{where_clause}
         ORDER BY sort_order, id
         LIMIT ? OFFSET ?"
    );
    binds.push(Box::new(limit));
    binds.push(Box::new(offset));
    let mut stmt = conn.prepare_cached(&sql)?;
    let items = stmt
        .query_map(
            rusqlite::params_from_iter(binds.iter().map(|b| b.as_ref())),
            row_to_meta,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok((items, total))
}

fn row_to_meta(row: &Row<'_>) -> rusqlite::Result<SnippetMeta> {
    Ok(SnippetMeta {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        category: row.get(3)?,
        is_protected: row.get::<_, i64>(4)? != 0,
    })
}

#[derive(Debug, Clone)]
pub struct SnippetBody {
    pub body: String,
    pub protection_nonce: Option<String>,
    pub protection_ciphertext: Option<String>,
}

impl SnippetBody {
    pub fn is_protected(&self) -> bool {
        self.protection_ciphertext.is_some()
    }
}

pub fn snippet_body(conn: &Connection, id: i64) -> Result<Option<SnippetBody>, DbError> {
    let mut stmt = conn.prepare_cached(
        "SELECT body, protection_nonce, protection_ciphertext FROM snippets WHERE id = ?1",
    )?;
    let row = stmt
        .query_row(params![id], |row| {
            Ok(SnippetBody {
                body: row.get(0)?,
                protection_nonce: row.get(1)?,
                protection_ciphertext: row.get(2)?,
            })
        })
        .optional()?;
    Ok(row)
}

pub fn load_config(conn: &Connection) -> Result<Option<AppConfigRow>, DbError> {
    let mut stmt =
        conn.prepare_cached("SELECT theme, vault_salt, vault_nonce, vault_canary FROM app_config WHERE singleton_id = 1")?;
    let row = stmt
        .query_row([], |row| {
            Ok(AppConfigRow {
                theme: row.get(0)?,
                vault_salt: row.get(1)?,
                vault_nonce: row.get(2)?,
                vault_canary: row.get(3)?,
            })
        })
        .optional()?;
    Ok(row)
}

pub fn get_migration_meta(conn: &Connection, key: &str) -> Result<Option<String>, DbError> {
    let mut stmt = conn.prepare_cached("SELECT value FROM migration_meta WHERE key = ?1")?;
    let row = stmt.query_row(params![key], |row| row.get(0)).optional()?;
    Ok(row)
}

pub fn set_migration_meta(conn: &Connection, key: &str, value: &str) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO migration_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_pragmas(&conn).unwrap();
        migrate_forward(&conn).unwrap();
        conn
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_snippet(
        conn: &Connection,
        id: i64,
        title: &str,
        description: Option<&str>,
        category: &str,
        body: &str,
        protected: bool,
        sort_order: i64,
    ) {
        let hint: Option<String> = if protected {
            Some("aGludA==".into())
        } else {
            None
        };
        conn.execute(
            "INSERT INTO snippets (id, title, description, category, body, protection_hint, protection_nonce, protection_ciphertext, sort_order, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
            params![
                id,
                title,
                description,
                category,
                if protected { "" } else { body },
                hint,
                if protected { Some("bm9uY2UyNA==") } else { None },
                if protected { Some("Y2lwaGVydGV4dA==") } else { None },
                sort_order
            ],
        )
        .unwrap();
    }

    #[test]
    fn creates_v1_schema_and_records_version() {
        let conn = memory_db();
        assert_eq!(schema_version(&conn).unwrap(), 1);
        assert!(verify_lightweight(&conn).is_ok());
    }

    #[test]
    fn migration_is_idempotent_on_fresh_connection() {
        let conn = memory_db();
        migrate_forward(&conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), 1);
    }

    #[test]
    fn future_schema_version_is_refused() {
        let conn = Connection::open_in_memory().unwrap();
        apply_pragmas(&conn).unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (99, 'future', 'x')",
            [],
        )
        .unwrap();
        let err = migrate_forward(&conn).unwrap_err();
        assert!(matches!(
            err,
            DbError::UnsupportedSchemaVersion {
                found: 99,
                supported: 1
            }
        ));
    }

    #[test]
    fn sqlite_busy_and_locked_errors_are_retryable() {
        for code in [
            rusqlite::ErrorCode::DatabaseBusy,
            rusqlite::ErrorCode::DatabaseLocked,
        ] {
            let sqlite = rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error {
                    code,
                    extended_code: code as i32,
                },
                None,
            );
            let error = DbError::from(sqlite);
            assert!(matches!(error, DbError::Busy));
            assert_eq!(error.error_code(), crate::protocol::ErrorCode::DatabaseBusy);
        }
    }

    #[test]
    fn list_orders_by_sort_order_then_id_and_reports_total() {
        let conn = memory_db();
        insert_snippet(&conn, 7, "B", None, "Git", "b", false, 0);
        insert_snippet(&conn, 3, "A", None, "Git", "a", false, 0);
        insert_snippet(&conn, 9, "C", None, "Prompt", "c", false, 5);
        let (items, total) = list_snippets(&conn, None, None, 0, 100).unwrap();
        assert_eq!(total, 3);
        let ids: Vec<i64> = items.iter().map(|s| s.id).collect();
        assert_eq!(ids, vec![3, 7, 9]);
    }

    #[test]
    fn pagination_boundaries_are_stable() {
        let conn = memory_db();
        for i in 1..=10 {
            insert_snippet(&conn, i, &format!("S{i}"), None, "G", "", false, i);
        }
        let (page1, total) = list_snippets(&conn, None, None, 0, 4).unwrap();
        assert_eq!(total, 10);
        assert_eq!(page1.len(), 4);
        let (page3, _) = list_snippets(&conn, None, None, 8, 4).unwrap();
        assert_eq!(page3.len(), 2);
        let ids: Vec<i64> = page1.iter().map(|s| s.id).collect();
        assert_eq!(ids, vec![1, 2, 3, 4]);
    }

    #[test]
    fn limit_is_hard_capped() {
        let conn = memory_db();
        for i in 1..=250 {
            insert_snippet(&conn, i, &format!("S{i}"), None, "G", "", false, i);
        }
        let (_, total) = list_snippets(&conn, None, None, 0, 100_000).unwrap();
        let (items, _) = list_snippets(&conn, None, None, 0, 100_000).unwrap();
        assert_eq!(total, 250);
        assert_eq!(items.len(), PAGE_LIMIT_CAP as usize);
    }

    #[test]
    fn search_matches_title_description_category_and_body() {
        let conn = memory_db();
        insert_snippet(
            &conn,
            1,
            "Alpha Rocket",
            None,
            "Git",
            "plain body",
            false,
            0,
        );
        insert_snippet(
            &conn,
            2,
            "Beta",
            Some("describes gamma rays"),
            "Prompt",
            "x",
            false,
            1,
        );
        insert_snippet(&conn, 3, "Delta", None, "Gambling", "y", false, 2);
        insert_snippet(
            &conn,
            4,
            "Epsilon",
            None,
            "Misc",
            "contains gammatone",
            false,
            3,
        );

        let expected_matches = [("rocket", 1), ("gamma", 2), ("gambl", 1), ("gammat", 1)];
        for (q, want) in expected_matches {
            let (_, total) = list_snippets(&conn, Some(q), None, 0, 100).unwrap();
            assert_eq!(total, want, "query {q}");
        }
        let (_, none) = list_snippets(&conn, Some("zzz-nothing"), None, 0, 100).unwrap();
        assert_eq!(none, 0);
    }

    #[test]
    fn protected_bodies_are_not_searchable() {
        let conn = memory_db();
        insert_snippet(&conn, 1, "Locked Secret", None, "G", "", true, 0);
        let (_, by_body) = list_snippets(&conn, Some("TOPSECRET"), None, 0, 100).unwrap();
        assert_eq!(
            by_body, 0,
            "ciphertext/plaintext body must not be searchable"
        );
        let (_, by_title) = list_snippets(&conn, Some("locked secret"), None, 0, 100).unwrap();
        assert_eq!(by_title, 1, "title remains searchable while protected");
    }

    #[test]
    fn like_wildcards_in_query_are_literal() {
        let conn = memory_db();
        insert_snippet(&conn, 1, "100% done", None, "G", "", false, 0);
        insert_snippet(&conn, 2, "abc", None, "G", "", false, 1);
        let (_, total) = list_snippets(&conn, Some("%"), None, 0, 100).unwrap();
        assert_eq!(total, 1);
        let (_, underscore) = list_snippets(&conn, Some("a_c"), None, 0, 100).unwrap();
        assert_eq!(underscore, 0, "'_' must not act as a wildcard");
    }

    #[test]
    fn category_filter_is_exact_case_insensitive() {
        let conn = memory_db();
        insert_snippet(&conn, 1, "A", None, "Git", "", false, 0);
        insert_snippet(&conn, 2, "B", None, "GitHub", "", false, 1);
        let (items, total) = list_snippets(&conn, None, Some("git"), 0, 100).unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].id, 1);
    }

    #[test]
    fn list_results_never_include_body_or_ciphertext() {
        let conn = memory_db();
        insert_snippet(&conn, 1, "Secret", None, "G", "TOP SECRET BODY", true, 0);
        let json =
            serde_json::to_string(&list_snippets(&conn, None, None, 0, 100).unwrap().0[0]).unwrap();
        assert!(!json.contains("TOP SECRET BODY"));
        assert!(!json.to_lowercase().contains("cipher"));
        assert!(!json.to_lowercase().contains("nonce"));
    }

    #[test]
    fn body_lookup_distinguishes_plaintext_protected_missing() {
        let conn = memory_db();
        insert_snippet(&conn, 1, "Plain", None, "G", "hello world", false, 0);
        insert_snippet(&conn, 2, "Locked", None, "G", "", true, 1);

        let plain = snippet_body(&conn, 1).unwrap().unwrap();
        assert!(!plain.is_protected());
        assert_eq!(plain.body, "hello world");

        let locked = snippet_body(&conn, 2).unwrap().unwrap();
        assert!(locked.is_protected());

        assert!(snippet_body(&conn, 999).unwrap().is_none());
    }

    #[test]
    fn categories_list_with_counts_including_snippet_only_categories() {
        let conn = memory_db();
        insert_snippet(&conn, 1, "A", None, "Git", "", false, 0);
        insert_snippet(&conn, 2, "B", None, "Git", "", false, 1);
        conn.execute(
            "INSERT INTO categories (name, sort_order) VALUES ('Git', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO categories (name, sort_order) VALUES ('Prompt', 1)",
            [],
        )
        .unwrap();

        let cats = list_categories(&conn).unwrap();
        let git = cats.iter().find(|c| c.name == "Git").unwrap();
        assert_eq!(git.count, 2);
        let prompt = cats.iter().find(|c| c.name == "Prompt").unwrap();
        assert_eq!(prompt.count, 0);
    }

    #[test]
    fn config_round_trips_with_vault_triple_null_or_present() {
        let conn = memory_db();
        assert!(load_config(&conn).unwrap().is_none());
        conn.execute(
            "INSERT INTO app_config (singleton_id, theme) VALUES (1, 'Dark')",
            [],
        )
        .unwrap();
        let cfg = load_config(&conn).unwrap().unwrap();
        assert_eq!(cfg.theme, "Dark");
        assert!(!cfg.vault_is_configured());

        conn.execute(
            "UPDATE app_config SET vault_salt='cw==', vault_nonce='bg==', vault_canary='Yw==' WHERE singleton_id=1",
            [],
        )
        .unwrap();
        let cfg = load_config(&conn).unwrap().unwrap();
        assert!(cfg.vault_is_configured());
        let meta = cfg.vault_meta().unwrap();
        assert_eq!(meta.salt, "cw==");

        // CHECK constraint rejects a partial vault triple.
        let partial = conn.execute(
            "UPDATE app_config SET vault_salt='cw==', vault_nonce=NULL WHERE singleton_id=1",
            [],
        );
        assert!(partial.is_err());
    }

    #[test]
    fn protected_rows_must_have_empty_body_constraint() {
        let conn = memory_db();
        let err = conn.execute(
            "INSERT INTO snippets (id, title, category, body, protection_hint, protection_nonce, protection_ciphertext, sort_order, created_at, updated_at)
             VALUES (1,'X','G','not empty','h','n','c',0,'t','t')",
            [],
        );
        assert!(
            err.is_err(),
            "CHECK constraint must reject protected rows with a body"
        );
    }

    #[test]
    fn migration_meta_upsert_works() {
        let conn = memory_db();
        set_migration_meta(&conn, "k", "v1").unwrap();
        set_migration_meta(&conn, "k", "v2").unwrap();
        assert_eq!(get_migration_meta(&conn, "k").unwrap().unwrap(), "v2");
        assert!(get_migration_meta(&conn, "missing").unwrap().is_none());
    }

    #[test]
    fn wal_mode_is_enabled_for_shared_access() {
        // WAL requires a file-backed database; in-memory DBs always report "memory".
        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open(dir.path().join("wal.db")).unwrap();
        apply_pragmas(&conn).unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
        let busy: i64 = conn
            .query_row("PRAGMA busy_timeout", [], |r| r.get(0))
            .unwrap();
        assert_eq!(busy, 3000);
    }
}
