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
    // Rotate: a tiny utility must not grow its log indefinitely.
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_LOG_BYTES {
            let _ = std::fs::rename(&path, dir.join("native-host.log.old"));
        }
    }
    Ok(std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?)
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
    fn rotation_replaces_oversized_logs() {
        let dir = tempfile::tempdir().unwrap();
        let big = "x".repeat((MAX_LOG_BYTES + 1) as usize);
        std::fs::write(dir.path().join("native-host.log"), big).unwrap();
        open_bounded(&dir.path().to_path_buf()).unwrap();
        assert!(dir.path().join("native-host.log.old").exists());
        let new_size = std::fs::metadata(dir.path().join("native-host.log"))
            .unwrap()
            .len();
        assert_eq!(new_size, 0);
    }
}
