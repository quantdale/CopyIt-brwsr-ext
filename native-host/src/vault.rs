//! Port of the desktop CopyIt vault (`CopyIt/src/vault.rs`).
//!
//! Cryptography MUST stay byte-compatible with the existing desktop app:
//! - Argon2id, RFC 9106 moderate params: m = 19 MiB, t = 2, p = 1, 32-byte key.
//! - XChaCha20-Poly1305 AEAD with a fresh random 24-byte nonce per encryption.
//! - Standard (padded) base64 for salt / nonce / ciphertext.
//! - Vault unlock is verified by authenticated-decrypting the canary and
//!   comparing it to `CANARY_PLAINTEXT`.

use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::RngCore;
use zeroize::Zeroize;

/// Derived vault key length in bytes.
pub const KEY_LEN: usize = 32;
/// Argon2id salt length in bytes.
pub const SALT_LEN: usize = 16;
/// XChaCha20-Poly1305 nonce length in bytes.
pub const NONCE_LEN: usize = 24;

/// Canary plaintext. Authenticated decryption of this exact value proves the
/// derived key is correct. MUST NEVER CHANGE or existing vaults stop unlocking.
pub const CANARY_PLAINTEXT: &[u8] = b"copyit-vault-canary-v1";

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum VaultError {
    #[error("key derivation failed")]
    KeyDerivation(String),
    #[error("encoding error")]
    Encoding(String),
    #[error("encryption failed")]
    Encryption(String),
    #[error("decryption failed")]
    Decryption,
}

fn cipher(key: &[u8; KEY_LEN]) -> XChaCha20Poly1305 {
    XChaCha20Poly1305::new(key.into())
}

pub fn decode_b64(s: &str) -> Result<Vec<u8>, VaultError> {
    BASE64
        .decode(s.trim().as_bytes())
        .map_err(|e| VaultError::Encoding(e.to_string()))
}

pub fn encode_b64(data: &[u8]) -> String {
    BASE64.encode(data)
}

/// Derives the 32-byte vault key with the exact desktop KDF parameters.
pub fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; KEY_LEN], VaultError> {
    let params =
        Params::new(19 * 1024, 2, 1, None).map_err(|e| VaultError::KeyDerivation(e.to_string()))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; KEY_LEN];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| VaultError::KeyDerivation(e.to_string()))?;
    Ok(out)
}

fn random_nonce() -> [u8; NONCE_LEN] {
    let mut buf = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    buf
}

/// Encrypts plaintext under `key`, returning `(nonce_b64, ciphertext_b64)`
/// exactly as the desktop stores them.
pub fn encrypt(key: &[u8; KEY_LEN], plaintext: &[u8]) -> Result<(String, String), VaultError> {
    let nonce_bytes = random_nonce();
    let nonce = XNonce::from_slice(&nonce_bytes);
    let ct = cipher(key)
        .encrypt(nonce, plaintext)
        .map_err(|e| VaultError::Encryption(e.to_string()))?;
    Ok((encode_b64(&nonce_bytes), encode_b64(&ct)))
}

/// Decrypts base64 nonce + ciphertext produced by the desktop app or this host.
/// Authentication failure yields `VaultError::Decryption` and never partial text.
pub fn decrypt(
    key: &[u8; KEY_LEN],
    nonce_b64: &str,
    ciphertext_b64: &str,
) -> Result<Vec<u8>, VaultError> {
    let nonce_bytes = decode_b64(nonce_b64)?;
    if nonce_bytes.len() != NONCE_LEN {
        return Err(VaultError::Encoding(format!(
            "nonce must be {NONCE_LEN} bytes"
        )));
    }
    let ct = decode_b64(ciphertext_b64)?;
    let nonce = XNonce::from_slice(&nonce_bytes);
    cipher(key)
        .decrypt(nonce, ct.as_ref())
        .map_err(|_| VaultError::Decryption)
}

/// Verifies a candidate password against stored vault metadata by deriving the
/// key with the stored salt and authenticated-decrypting the canary.
/// Returns the derived key on success.
pub fn verify_password(
    password: &str,
    salt_b64: &str,
    canary_nonce_b64: &str,
    canary_ct_b64: &str,
) -> Result<[u8; KEY_LEN], VaultError> {
    let salt = decode_b64(salt_b64)?;
    let key = derive_key(password, &salt)?;
    match decrypt(&key, canary_nonce_b64, canary_ct_b64) {
        Ok(plain) => {
            if plain.as_slice() == CANARY_PLAINTEXT {
                Ok(key)
            } else {
                Err(VaultError::Decryption)
            }
        }
        Err(_) => Err(VaultError::Decryption),
    }
}

/// Decrypts a protected snippet body to UTF-8 text.
pub fn decrypt_body(
    key: &[u8; KEY_LEN],
    nonce_b64: &str,
    ciphertext_b64: &str,
) -> Result<String, VaultError> {
    let bytes = decrypt(key, nonce_b64, ciphertext_b64)?;
    String::from_utf8(bytes).map_err(|_| VaultError::Encoding("body is not valid UTF-8".into()))
}

/// Zeroizes a derived key buffer when dropped from host memory.
pub fn zeroize_key(mut key: [u8; KEY_LEN]) -> [u8; KEY_LEN] {
    key.zeroize();
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_PASSWORD: &str = "correct horse battery staple";

    fn fixed_salt() -> String {
        encode_b64(&[
            0x00u8, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,
            0x0e, 0x0f,
        ])
    }

    #[test]
    fn canary_round_trip_verifies_correct_password() {
        use chacha20poly1305::aead::Payload;
        let salt = decode_b64(&fixed_salt()).unwrap();
        let key = derive_key(TEST_PASSWORD, &salt).unwrap();
        // Deterministic canary: encrypt with a fixed nonce via direct cipher use.
        let nonce_bytes = [0x30u8; NONCE_LEN];
        let nonce = XNonce::from_slice(&nonce_bytes);
        let ct = cipher(&key)
            .encrypt(
                nonce,
                Payload {
                    msg: CANARY_PLAINTEXT,
                    aad: &[],
                },
            )
            .unwrap();
        let canary_b64 = encode_b64(&ct);
        let canary_nonce_b64 = encode_b64(&nonce_bytes);

        let derived = verify_password(TEST_PASSWORD, &fixed_salt(), &canary_nonce_b64, &canary_b64);
        assert_eq!(derived.unwrap(), key);
    }

    #[test]
    fn wrong_password_fails_canary_verification() {
        use chacha20poly1305::aead::Payload;
        let salt = decode_b64(&fixed_salt()).unwrap();
        let key = derive_key(TEST_PASSWORD, &salt).unwrap();
        let nonce_bytes = [0x30u8; NONCE_LEN];
        let nonce = XNonce::from_slice(&nonce_bytes);
        let ct = cipher(&key)
            .encrypt(
                nonce,
                Payload {
                    msg: CANARY_PLAINTEXT,
                    aad: &[],
                },
            )
            .unwrap();
        let wrong = verify_password(
            "wrong password entirely",
            &fixed_salt(),
            &encode_b64(&nonce_bytes),
            &encode_b64(&ct),
        );
        assert_eq!(wrong.unwrap_err(), VaultError::Decryption);
    }

    #[test]
    fn body_round_trip_and_tamper_detection() {
        let salt = decode_b64(&fixed_salt()).unwrap();
        let key = derive_key(TEST_PASSWORD, &salt).unwrap();
        let body = "Synthetic cross-compatibility prompt body.";
        let (nonce_b64, ct_b64) = encrypt(&key, body.as_bytes()).unwrap();
        assert_eq!(decrypt_body(&key, &nonce_b64, &ct_b64).unwrap(), body);

        // Tamper: flip one ciphertext byte after decoding/re-encoding.
        let mut raw = decode_b64(&ct_b64).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 0x01;
        let tampered = encode_b64(&raw);
        assert_eq!(
            decrypt_body(&key, &nonce_b64, &tampered).unwrap_err(),
            VaultError::Decryption
        );
    }

    #[test]
    fn malformed_base64_and_bad_nonce_lengths_are_rejected() {
        let salt = decode_b64(&fixed_salt()).unwrap();
        let key = derive_key(TEST_PASSWORD, &salt).unwrap();
        assert!(matches!(
            decrypt(&key, "!!!not-base64!!!", "AAAA"),
            Err(VaultError::Encoding(_))
        ));
        let short_nonce = encode_b64(&[0u8; 12]);
        assert!(matches!(
            decrypt_body(&key, &short_nonce, "AAAA"),
            Err(VaultError::Encoding(_))
        ));
    }

    #[test]
    fn kdf_matches_desktop_reference_vector() {
        // Reference vector generated with the identical desktop parameters
        // (Argon2id m=19MiB t=2 p=1, 16-byte salt). The desktop repo asserts
        // the same expected hex in its own test suite (cross-repo contract).
        let salt = decode_b64(&fixed_salt()).unwrap();
        let key = derive_key(TEST_PASSWORD, &salt).unwrap();
        let _ = key;
        // Full vector equality is asserted against the committed JSON fixture:
        let fixture = include_str!("../../protocol/test-vectors/vault-vector.json");
        let v: serde_json::Value = serde_json::from_str(fixture).unwrap();
        let expected_hex = v["expected"]["keyHex"].as_str().unwrap();
        assert_eq!(hex_encode(&key), expected_hex);
    }

    pub(crate) fn hex_encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}
