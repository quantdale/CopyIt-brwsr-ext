//! Native messaging origin defense.
//!
//! Chromium launches the host with the requesting extension's origin as an
//! argument (`chrome-extension://<id>/`, plus `--parent-window=...` on
//! Windows). The host must reject any unexpected origin BEFORE servicing data
//! requests. Origins supplied inside JSON are never authoritative.

/// The deterministic extension ID derived from the manifest key committed in
/// `extension/manifest.json` (see `scripts/get-extension-id.mjs`).
///
/// DO NOT hand-edit. A regression test derives the expected value from the
/// committed manifest `key` and fails on drift, so this constant and the
/// browser it defends always agree.
pub const EXTENSION_ID: &str = "mmiopnfmhmmlmhcdjklelfcdahmgchfc";

pub fn expected_origin() -> String {
    format!("chrome-extension://{EXTENSION_ID}/")
}

#[derive(Debug, PartialEq, Eq)]
pub enum OriginCheck {
    Allowed,
    Rejected { reason: &'static str },
}

/// Validates the argv the browser passed at process start.
///
/// Debug builds may override the expected origin via `COPYIT_ALLOWED_ORIGIN`
/// for integration tests with a mock extension ID; release builds ignore it.
pub fn validate_args(args: &[String]) -> OriginCheck {
    let expected = {
        #[cfg(debug_assertions)]
        {
            if let Ok(custom) = std::env::var("COPYIT_ALLOWED_ORIGIN") {
                if !custom.is_empty() {
                    custom
                } else {
                    expected_origin()
                }
            } else {
                expected_origin()
            }
        }
        #[cfg(not(debug_assertions))]
        {
            expected_origin()
        }
    };

    // The first non-flag argument must be exactly the allowed origin.
    for arg in args {
        if arg.starts_with("--") {
            continue; // --parent-window=<hwnd> and similar flags are ignorable.
        }
        return if *arg == expected {
            OriginCheck::Allowed
        } else {
            OriginCheck::Rejected {
                reason: "unexpected native messaging origin",
            }
        };
    }
    OriginCheck::Rejected {
        reason: "no origin argument provided",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn accepts_the_deterministic_origin() {
        assert_eq!(
            validate_args(&args(&[
                "chrome-extension://mmiopnfmhmmlmhcdjklelfcdahmgchfc/"
            ])),
            OriginCheck::Allowed
        );
    }

    #[test]
    fn accepts_origin_with_parent_window_flag() {
        assert_eq!(
            validate_args(&args(&[
                "chrome-extension://mmiopnfmhmmlmhcdjklelfcdahmgchfc/",
                "--parent-window=1234567",
            ])),
            OriginCheck::Allowed
        );
    }

    #[test]
    fn rejects_unknown_origins() {
        assert!(matches!(
            validate_args(&args(&[
                "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaapaaaaaa/"
            ])),
            OriginCheck::Rejected { .. }
        ));
    }

    #[test]
    fn rejects_missing_or_flag_only_argv() {
        assert!(matches!(
            validate_args(&args(&[])),
            OriginCheck::Rejected {
                reason: "no origin argument provided"
            }
        ));
        assert!(matches!(
            validate_args(&args(&["--parent-window=1"])),
            OriginCheck::Rejected { .. }
        ));
    }

    #[test]
    fn origin_prefix_is_never_enough() {
        assert!(matches!(
            validate_args(&args(&[
                "chrome-extension://mmiopnfmhmmlmhcdjklelfcdahmgchfc/evil?x"
            ])),
            OriginCheck::Rejected { .. }
        ));
    }

    #[test]
    fn extension_id_is_well_formed() {
        assert_eq!(EXTENSION_ID.len(), 32);
        assert!(EXTENSION_ID.bytes().all(|b| b.is_ascii_lowercase()));
    }

    #[test]
    fn extension_id_derives_from_committed_manifest_key() {
        // Byte-for-byte reproduction of scripts/get-extension-id.mjs against the
        // committed manifest. This is the guard that keeps EXTENSION_ID in sync
        // with the public key users actually load into Chrome/Edge.
        use base64::engine::general_purpose::STANDARD as B64;
        use base64::Engine as _;
        use sha2::{Digest, Sha256};

        let raw = include_str!("../../extension/manifest.json");
        let v: serde_json::Value = serde_json::from_str(raw).expect("manifest parses");
        let key = v["key"]
            .as_str()
            .expect("manifest carries a deterministic key");
        let der = B64.decode(key).expect("key is standard base64");
        let digest = Sha256::digest(&der);
        let derived: String = digest
            .iter()
            .take(16)
            .flat_map(|&b| [b >> 4, b & 0x0F])
            .map(|nibble| char::from(b'a' + nibble))
            .collect();
        assert_eq!(derived.len(), 32);
        assert_eq!(
            derived, EXTENSION_ID,
            "host origin and manifest key have drifted"
        );
        assert_eq!(expected_origin(), format!("chrome-extension://{derived}/"));
    }
}
