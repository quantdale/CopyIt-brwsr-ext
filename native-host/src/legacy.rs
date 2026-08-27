//! Legacy JSON source handling: typed structs matching the desktop app's
//! `snippets.json` / `config.json`, three-way load semantics (`Loaded` /
//! `Missing` / `Corrupt` — corrupt is NEVER collapsed into missing), and
//! byte-faithful ports of the desktop's category normalization rules.

use serde::{Deserialize, Serialize};
use std::path::Path;

/// Matches the desktop loader's oversize guard.
pub const MAX_DATA_FILE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum SourceLoad<T> {
    Loaded(T),
    /// File absent or empty/whitespace-only: no user data at risk.
    Missing,
    /// File exists but cannot be parsed: user data is present but unreadable.
    Corrupt(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegacyProtection {
    #[serde(default)]
    pub hint: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegacySnippet {
    pub id: u64,
    pub title: String,
    pub category: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub protection: Option<LegacyProtection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegacyVaultMeta {
    pub salt: String,
    pub nonce: String,
    pub canary: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegacyConfig {
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub theme: String,
    #[serde(default)]
    pub vault: Option<LegacyVaultMeta>,
}

/// Reads and parses a legacy JSON file preserving the desktop's exact
/// semantic distinctions (see `CopyIt/src/storage.rs`).
pub fn read_source<T: serde::de::DeserializeOwned>(path: &Path) -> SourceLoad<T> {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return SourceLoad::Missing,
        // Permission or other IO trouble means we can't verify content:
        // treat as corrupt rather than silently seeding over it.
        Err(e) => return SourceLoad::Corrupt(format!("unreadable: {e}")),
    };
    if bytes.is_empty() {
        return SourceLoad::Missing;
    }
    if bytes.len() as u64 > MAX_DATA_FILE_BYTES {
        return SourceLoad::Corrupt("file exceeds maximum supported size".to_string());
    }
    let trimmed = trim_ascii(&bytes);
    if trimmed.is_empty() {
        return SourceLoad::Missing;
    }
    match serde_json::from_slice::<T>(&bytes) {
        Ok(v) => SourceLoad::Loaded(v),
        Err(e) => SourceLoad::Corrupt(format!("unparseable JSON: {e}")),
    }
}

fn trim_ascii(bytes: &[u8]) -> &[u8] {
    fn is_ws(b: &u8) -> bool {
        matches!(b, b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c)
    }
    let start = bytes.iter().position(|b| !is_ws(b)).unwrap_or(bytes.len());
    let end = bytes.len() - bytes.iter().rev().position(|b| !is_ws(b)).unwrap_or(0);
    &bytes[start..end]
}

// ---------------------------------------------------------------------------
// Category normalization — byte-faithful port of CopyIt/src/storage.rs.
// ---------------------------------------------------------------------------

pub const UNCATEGORIZED: &str = "Uncategorized";

/// Trims, collapses whitespace, title-cases word-by-word ("GIT hub" -> "Git Hub").
pub fn normalize_category(s: &str) -> String {
    let s = s.trim();
    if s.is_empty() {
        return String::new();
    }
    s.split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => {
                    first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase()
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Case-insensitive equality with full Unicode fallback for non-ASCII input.
pub fn same_category(a: &str, b: &str) -> bool {
    if a.is_ascii() && b.is_ascii() {
        return a.eq_ignore_ascii_case(b);
    }
    a.to_lowercase() == b.to_lowercase()
}

/// Blank names and the reserved "All" filter sentinel cannot be stored.
pub fn is_reserved_category(cat: &str) -> bool {
    cat.trim().is_empty() || same_category(cat.trim(), "All")
}

/// Normalizes a stored/raw category into canonical form; reserved -> Uncategorized.
pub fn canonical_category(raw: &str) -> String {
    let cat = normalize_category(raw);
    if is_reserved_category(&cat) {
        UNCATEGORIZED.to_string()
    } else {
        cat
    }
}

/// Canonicalizes a config category list: normalize, drop reserved, dedupe
/// case-insensitively, sort. Port of the desktop app's sanitize_categories.
pub fn sanitize_categories(categories: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for c in categories {
        let cat = normalize_category(c);
        if is_reserved_category(&cat) {
            continue;
        }
        if out.iter().any(|existing| same_category(existing, &cat)) {
            continue;
        }
        out.push(cat);
    }
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_file(dir: &Path, name: &str, contents: &[u8]) -> std::path::PathBuf {
        let p = dir.join(name);
        let mut f = std::fs::File::create(&p).unwrap();
        f.write_all(contents).unwrap();
        p
    }

    #[test]
    fn missing_file_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let res = read_source::<LegacyConfig>(&dir.path().join("nope.json"));
        assert_eq!(res, SourceLoad::Missing);
    }

    #[test]
    fn empty_and_whitespace_files_are_missing_not_corrupt() {
        let dir = tempfile::tempdir().unwrap();
        write_file(dir.path(), "empty.json", b"");
        write_file(dir.path(), "ws.json", b"  \r\n\t ");
        assert_eq!(
            read_source::<LegacyConfig>(&dir.path().join("empty.json")),
            SourceLoad::Missing
        );
        assert_eq!(
            read_source::<LegacyConfig>(&ws_path(dir.path())),
            SourceLoad::Missing
        );
    }

    fn ws_path(dir: &Path) -> std::path::PathBuf {
        dir.join("ws.json")
    }

    #[test]
    fn garbage_is_corrupt_with_reason() {
        let dir = tempfile::tempdir().unwrap();
        write_file(dir.path(), "bad.json", b"this is definitely not json");
        match read_source::<LegacyConfig>(&dir.path().join("bad.json")) {
            SourceLoad::Corrupt(msg) => assert!(msg.contains("unparseable")),
            other => panic!("expected corrupt, got {other:?}"),
        }
    }

    #[test]
    fn valid_json_array_counts_as_real_data() {
        let dir = tempfile::tempdir().unwrap();
        write_file(dir.path(), "snips.json", b"[]");
        let res = read_source::<Vec<LegacySnippet>>(&dir.path().join("snips.json"));
        assert_eq!(res, SourceLoad::Loaded(vec![]));
    }

    #[test]
    fn oversized_file_is_corrupt() {
        let dir = tempfile::tempdir().unwrap();
        let big = vec![b' '; (MAX_DATA_FILE_BYTES + 1) as usize];
        write_file(dir.path(), "big.json", &big);
        match read_source::<LegacyConfig>(&dir.path().join("big.json")) {
            SourceLoad::Corrupt(msg) => assert!(msg.contains("maximum")),
            other => panic!("expected corrupt, got {other:?}"),
        }
    }

    #[test]
    fn protected_snippet_json_shape_matches_desktop() {
        let json = r#"[
            {"id":3,"title":"T","category":"Git","body":"",
             "protection":{"hint":"hello","nonce":"bm9uY2U=","ciphertext":"Y3Q="}}
        ]"#;
        let v: Vec<LegacySnippet> = serde_json::from_str(json).unwrap();
        assert_eq!(v.len(), 1);
        let p = v[0].protection.as_ref().unwrap();
        assert_eq!(
            (p.hint.as_str(), p.nonce.as_str(), p.ciphertext.as_str()),
            ("hello", "bm9uY2U=", "Y3Q=")
        );
    }

    #[test]
    fn config_defaults_are_graceful() {
        let v: LegacyConfig = serde_json::from_str("{}").unwrap();
        assert!(v.categories.is_empty());
        assert_eq!(v.theme, "");
        assert!(v.vault.is_none());
    }

    #[test]
    fn normalize_category_matches_desktop_examples() {
        assert_eq!(normalize_category("  git "), "Git");
        assert_eq!(normalize_category("GIT"), "Git");
        assert_eq!(normalize_category("gIt hUb"), "Git Hub");
        assert_eq!(normalize_category(""), "");
        assert_eq!(normalize_category("   "), "");
    }

    #[test]
    fn canonical_and_reserved_behavior_match_desktop() {
        assert_eq!(canonical_category(""), UNCATEGORIZED);
        assert_eq!(canonical_category("   "), UNCATEGORIZED);
        assert_eq!(canonical_category("all"), UNCATEGORIZED);
        assert_eq!(canonical_category("ALL"), UNCATEGORIZED);
        assert_eq!(canonical_category(" git "), "Git");
        assert!(is_reserved_category(""));
        assert!(is_reserved_category("All"));
        assert!(!is_reserved_category("Alphabet"));
    }

    #[test]
    fn same_category_unicode_fallback() {
        assert!(same_category("Git", "GIT"));
        assert!(!same_category("Git", "Hub"));
    }

    #[test]
    fn sanitize_dedupes_sorts_and_drops_reserved() {
        let raw = vec![
            "prompt".to_string(),
            "Prompt".to_string(),
            "all".to_string(),
            "".to_string(),
            " GIT ".to_string(),
        ];
        assert_eq!(
            sanitize_categories(&raw),
            vec!["Git".to_string(), "Prompt".to_string()]
        );
    }
}
