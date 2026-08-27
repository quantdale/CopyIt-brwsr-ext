//! Regenerates `protocol/test-vectors/vault-vector.json` using this host's
//! implementation of the desktop crypto contract (fixed nonces/salt).
//!
//! Run from repo root:
//!   cargo run --manifest-path native-host/Cargo.toml --example gen-test-vector

use copyit_native_host::vault;

fn main() {
    let password = "correct horse battery staple";
    let salt_b64 = "AAECAwQFBgcICQoLDA0ODw=="; // 16 bytes 0x00..0x0F
    let canary_nonce_b64 = "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw"; // 24 bytes of ASCII '0'
    let body_nonce_b64 = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIz"; // repeating ASCII digits
    let plaintext_body =
        "This is a synthetic test prompt body for CopyIt cross-compatibility testing.";
    let canary_plaintext = "copyit-vault-canary-v1";

    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine as _;
    use chacha20poly1305::aead::{Aead, KeyInit, Payload};
    use chacha20poly1305::{XChaCha20Poly1305, XNonce};

    let salt = B64.decode(salt_b64).expect("salt");
    let key = vault::derive_key(password, &salt).expect("kdf");

    let canary_nonce = B64.decode(canary_nonce_b64).expect("canary nonce");
    let cipher = XChaCha20Poly1305::new((&key).into());
    let canary_ct = cipher
        .encrypt(
            XNonce::from_slice(&canary_nonce),
            Payload {
                msg: canary_plaintext.as_bytes(),
                aad: &[],
            },
        )
        .expect("canary encrypt");

    let body_nonce = B64.decode(body_nonce_b64).expect("nonce");
    let body_ct = cipher
        .encrypt(
            XNonce::from_slice(&body_nonce),
            Payload {
                msg: plaintext_body.as_bytes(),
                aad: &[],
            },
        )
        .expect("body encrypt");

    // Independent verification of what we just produced.
    vault::verify_password(
        password,
        salt_b64,
        canary_nonce_b64,
        &B64.encode(&canary_ct),
    )
    .expect("self-verify canary");

    let key_hex: String = key.iter().map(|b| format!("{b:02x}")).collect();

    let vector = serde_json::json!({
        "description": "Synthetic non-secret cross-compatibility vector. The desktop CopyIt app must produce byte-identical outputs for these fixed inputs, proving the native host can decrypt desktop-protected snippets (and vice versa).",
        "password": password,
        "inputs": {
            "saltB64": salt_b64,
            "canaryNonceB64": canary_nonce_b64,
            "nonceB64": body_nonce_b64,
            "plaintextBody": plaintext_body,
            "canaryPlaintext": canary_plaintext
        },
        "expected": {
            "keyHex": key_hex,
            "canaryCiphertextB64": B64.encode(&canary_ct),
            "ciphertextB64": B64.encode(&body_ct)
        },
        "algorithm": {
            "kdf": "argon2id m=19456 t=2 p=1 keyLen=32",
            "cipher": "xchacha20poly1305",
            "encoding": "base64 standard with padding"
        }
    });

    std::fs::write(
        "protocol/test-vectors/vault-vector.json",
        serde_json::to_string_pretty(&vector).unwrap() + "\n",
    )
    .expect("write vector");
    println!("wrote protocol/test-vectors/vault-vector.json");
}
