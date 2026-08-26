//! CopyIt native messaging host library: framing, protocol, SQLite storage,
//! legacy JSON migration, vault compatibility, origin defense, and logging.
//!
//! The binary in `main.rs` is a thin CLI over this library; integration tests
//! and examples link against it directly.

pub mod db;
pub mod framing;
pub mod legacy;
pub mod logging;
mod migration;
pub mod origin;
pub mod protocol;
pub mod vault;

pub use migration::{
    backup_timestamp, data_dir, db_path, default_seed, ensure_canonical_db, hash_file,
    utc_now_iso, BackupOutcome, MigrationError, MigrationLock, MigrationOutcome,
};

/// Truncates a string to at most `max_bytes` UTF-8 without splitting a char.
pub fn safe_truncate_utf8(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

pub const MAX_TITLE_BYTES: usize = 500;
pub const MAX_DESCRIPTION_BYTES: usize = 2_000;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncation_respects_char_boundaries() {
        assert_eq!(safe_truncate_utf8("hello", 4), "hell");
        assert_eq!(safe_truncate_utf8("aé日🙂x", 4), "aé");
        assert_eq!(safe_truncate_utf8("🙂🙂", 4), "🙂");
        assert_eq!(safe_truncate_utf8("short", 100), "short");
    }

    #[test]
    fn truncation_never_produces_invalid_utf8() {
        let s = "éééé";
        for n in 0..=10 {
            let t = safe_truncate_utf8(s, n);
            assert!(std::str::from_utf8(t.as_bytes()).is_ok());
        }
    }
}
