//! Bounded file logging for diagnostics.
//!
//! Hard rules: never log prompt bodies, vault passwords, derived keys,
//! decrypted text, or full ciphertext dumps. Only method names, request IDs,
//! durations, safe error codes, and version information are recorded.
//! stdout remains protocol-only in native mode.

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const MAX_LOG_BYTES: u64 = 256 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum LogInitError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub struct Logger {
    inner: Option<Mutex<std::fs::File>>,
}

impl Logger {
    /// Opens (or rotates) the diagnostic log. Debug builds accept
    /// `COPYIT_LOG_DIR`; release builds use `%LOCALAPPDATA%\CopyIt\logs`.
    pub fn init() -> Logger {
        #[cfg(debug_assertions)]
        let base = match std::env::var("COPYIT_LOG_DIR") {
            Ok(dir) if !dir.is_empty() => PathBuf::from(dir),
            _ => default_log_dir(),
        };
        #[cfg(not(debug_assertions))]
        let base = default_log_dir();

        match open_bounded(&base) {
            Ok(file) => Logger {
                inner: Some(Mutex::new(file)),
            },
            Err(_) => Logger { inner: None },
        }
    }

    pub fn disabled() -> Logger {
        Logger { inner: None }
    }

    /// Writes one structured line. Never panics; logging failures are silent.
    pub fn log(&self, level: &str, event: &str, fields: &[(&str, &str)]) {
        let Some(file) = &self.inner else { return };
        let mut line = format!("{} {} {}\n", crate::migration::utc_now_iso(), level, event);
        for (k, v) in fields {
            line.push_str(&format!("  {k}={v}\n"));
        }
        if let Ok(mut guard) = file.lock() {
            let Ok(current_len) = guard.metadata().map(|meta| meta.len()) else {
                return;
            };
            let line_len = line.len() as u64;
            if line_len > MAX_LOG_BYTES {
                let _ = guard.set_len(0);
                return;
            }
            if current_len.saturating_add(line_len) > MAX_LOG_BYTES && guard.set_len(0).is_err() {
                return;
            }
            let _ = guard.write_all(line.as_bytes());
            let _ = guard.flush();
        }
    }
}

fn default_log_dir() -> PathBuf {
    match std::env::var("LOCALAPPDATA") {
        Ok(dir) if !dir.is_empty() => PathBuf::from(dir).join("CopyIt").join("logs"),
        _ => PathBuf::from("."),
    }
}

fn open_bounded(dir: &PathBuf) -> Result<std::fs::File, LogInitError> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join("native-host.log");
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_LOG_BYTES {
            let backup = dir.join("native-host.log.old");
            if replace_backup(&path, &backup).is_err() {
                // Rotation is best-effort, but an oversized active log must
                // never continue growing when the backup cannot be replaced.
                truncate_active(&path)?;
            }
        }
    }
    Ok(std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?)
}

fn replace_backup(path: &std::path::Path, backup: &std::path::Path) -> std::io::Result<()> {
    match std::fs::remove_file(backup) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    std::fs::rename(path, backup)
}

fn truncate_active(path: &std::path::Path) -> std::io::Result<()> {
    std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_structured_lines_without_sensitive_content() {
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("COPYIT_LOG_DIR", dir.path());
        let logger = Logger::init();
        logger.log(
            "info",
            "request",
            &[("method", "listSnippets"), ("code", "ok")],
        );
        drop(logger);
        std::env::remove_var("COPYIT_LOG_DIR");

        let text = std::fs::read_to_string(dir.path().join("native-host.log")).unwrap();
        assert!(text.contains("method=listSnippets"));
        assert!(text.contains("code=ok"));
    }

    #[test]
    fn repeated_rotation_replaces_existing_backup_and_stays_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("native-host.log");
        let backup = dir.path().join("native-host.log.old");
        let first = format!("first-{}", "x".repeat((MAX_LOG_BYTES + 1) as usize));
        std::fs::write(&path, &first).unwrap();

        open_bounded(&dir.path().to_path_buf()).unwrap();
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), first);
        assert_eq!(std::fs::metadata(&path).unwrap().len(), 0);

        let second = format!("second-{}", "y".repeat((MAX_LOG_BYTES + 1) as usize));
        std::fs::write(&path, &second).unwrap();
        std::fs::write(&backup, b"stale backup").unwrap();
        open_bounded(&dir.path().to_path_buf()).unwrap();
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), second);
        assert_eq!(std::fs::metadata(&path).unwrap().len(), 0);
    }

    #[test]
    fn missing_log_directory_is_created() {
        let dir = tempfile::tempdir()
            .unwrap()
            .path()
            .join("nested")
            .join("logs");
        let file = open_bounded(&dir).unwrap();
        drop(file);
        assert!(dir.join("native-host.log").exists());
    }

    #[test]
    fn failed_rotation_truncates_active_log_without_panicking() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("native-host.log");
        let backup = dir.path().join("native-host.log.old");
        std::fs::write(&path, "x".repeat((MAX_LOG_BYTES + 1) as usize)).unwrap();
        std::fs::create_dir(&backup).unwrap();

        let result = open_bounded(&dir.path().to_path_buf());
        assert!(result.is_ok());
        assert_eq!(std::fs::metadata(&path).unwrap().len(), 0);
        assert!(backup.is_dir());
    }
    #[test]
    fn active_log_is_bounded_during_writes() {
        let dir = tempfile::tempdir().unwrap();
        let logger = Logger {
            inner: Some(Mutex::new(open_bounded(&dir.path().to_path_buf()).unwrap())),
        };
        for _ in 0..2_000 {
            logger.log("info", "request", &[("method", "listSnippets")]);
        }
        logger.log("info", "request", &[("code", "ok")]);

        let path = dir.path().join("native-host.log");
        assert!(std::fs::metadata(&path).unwrap().len() <= MAX_LOG_BYTES);
        assert!(std::fs::read_to_string(path).unwrap().contains("code=ok"));
    }
}
