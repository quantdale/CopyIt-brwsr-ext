//! Deterministic CopyIt certification fixture generator.
//! Creates an isolated `%APPDATA%\CopyIt\copyit.db` with known synthetic data
//! so real-browser E2E can run reproducibly without depending on the user's
//! actual vault password or snippet content.
//!
//! Synthetic values (all non-secret test data):
//!   password = "correct horse battery staple"
//!   protected body = "COPYIT_CERT_PROTECTED_BODY_2026"

use std::path::PathBuf;

use chacha20poly1305::{aead::Aead, KeyInit, XChaCha20Poly1305, XNonce};
use copyit_native_host::{db, vault};

const CERT_PASSWORD: &str = "correct horse battery staple";
const CERT_PROTECTED_BODY: &str = "COPYIT_CERT_PROTECTED_BODY_2026";
const CERT_PLAIN_ALPHA_BODY: &str = "CERT_PLAIN_ALPHA_BODY_2026";
const CERT_PLAIN_CHARLIE_BODY: &str = "CERT_PLAIN_CHARLIE_BODY_2026";

// Deterministic vault salt = 00 01 02 ... 0F (base64 AAECAwQFBgcICQoLDA0ODw==)
const CERT_SALT_B64: &str = "AAECAwQFBgcICQoLDA0ODw==";
// Canary nonce = 24 ASCII '0' (base64 MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw)
const CERT_VAULT_NONCE_B64: &str = "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw";
// Protected snippet nonce = 24 ASCII '012...' (base64 MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIz)
const CERT_PROTECTED_NONCE_B64: &str = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIz";

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: cert_fixture <APPDATA_root_dir> [--print-env]");
        eprintln!("  Creates <APPDATA_root_dir>/CopyIt/copyit.db with deterministic fixture");
        std::process::exit(2);
    }
    let appdata_root = PathBuf::from(&args[1]);
    let data_dir = appdata_root.join("CopyIt");
    std::fs::create_dir_all(&data_dir).expect("create data dir");

    let db_path = data_dir.join(db::DB_FILE_NAME);
    if db_path.exists() {
        std::fs::remove_file(&db_path).expect("remove existing db");
        // Also remove WAL/SHM sidecars if left over
        let _ = std::fs::remove_file(data_dir.join("copyit.db-wal"));
        let _ = std::fs::remove_file(data_dir.join("copyit.db-shm"));
        let _ = std::fs::remove_file(data_dir.join("migration.lock"));
    }

    // Derive key and create vault canary + protected ciphertext deterministically.
    let salt_bytes = vault::decode_b64(CERT_SALT_B64).expect("salt b64");
    let key = vault::derive_key(CERT_PASSWORD, &salt_bytes).expect("derive key");
    let vault_nonce_bytes = vault::decode_b64(CERT_VAULT_NONCE_B64).expect("vault nonce");
    assert_eq!(vault_nonce_bytes.len(), vault::NONCE_LEN);
    let protected_nonce_bytes =
        vault::decode_b64(CERT_PROTECTED_NONCE_B64).expect("protected nonce");
    assert_eq!(protected_nonce_bytes.len(), vault::NONCE_LEN);

    // Encrypt canary deterministically with vault nonce
    let cipher = XChaCha20Poly1305::new((&key).into());
    let canary_nonce = XNonce::from_slice(&vault_nonce_bytes);
    let canary_ct = cipher
        .encrypt(canary_nonce, vault::CANARY_PLAINTEXT)
        .expect("encrypt canary");
    let canary_b64 = vault::encode_b64(&canary_ct);

    // Encrypt protected body deterministically with protected nonce
    let prot_nonce = XNonce::from_slice(&protected_nonce_bytes);
    let prot_ct = cipher
        .encrypt(prot_nonce, CERT_PROTECTED_BODY.as_bytes())
        .expect("encrypt protected");
    let prot_ct_b64 = vault::encode_b64(&prot_ct);

    // Verify round-trip before writing DB (hard fail if crypto drifts)
    let dec =
        vault::decrypt_body(&key, CERT_PROTECTED_NONCE_B64, &prot_ct_b64).expect("decrypt verify");
    assert_eq!(dec, CERT_PROTECTED_BODY);
    let verify_key = vault::verify_password(
        CERT_PASSWORD,
        CERT_SALT_B64,
        CERT_VAULT_NONCE_B64,
        &canary_b64,
    )
    .expect("verify canary");
    assert_eq!(verify_key, key);

    // Now create DB
    let conn = rusqlite::Connection::open(&db_path).expect("open db");
    db::apply_pragmas(&conn).expect("pragmas");
    db::migrate_forward(&conn).expect("migrate");

    // Insert categories (deterministic order)
    for (order, name) in ["Cert-A", "Cert-B"].iter().enumerate() {
        conn.execute(
            "INSERT INTO categories (name, sort_order) VALUES (?1, ?2)",
            rusqlite::params![name, order as i64],
        )
        .expect("insert category");
    }

    let now = "2026-08-27T00:00:00Z";

    // Snippet 1: Plain Alpha, Cert-A
    conn.execute(
        "INSERT INTO snippets (id, title, description, category, body, protection_hint, protection_nonce, protection_ciphertext, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, NULL, ?6, ?7, ?7)",
        rusqlite::params![
            1i64,
            "Plain Alpha",
            "Alpha description - tooltip only",
            "Cert-A",
            CERT_PLAIN_ALPHA_BODY,
            0i64,
            now
        ],
    )
    .expect("insert alpha");

    // Snippet 2: Protected Bravo, Cert-A
    conn.execute(
        "INSERT INTO snippets (id, title, description, category, body, protection_hint, protection_nonce, protection_ciphertext, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        rusqlite::params![
            2i64,
            "Protected Bravo",
            "Bravo protected tooltip",
            "Cert-A",
            "",
            "vault",
            CERT_PROTECTED_NONCE_B64,
            prot_ct_b64,
            1i64,
            now
        ],
    )
    .expect("insert bravo");

    // Snippet 3: Plain Charlie, Cert-B
    conn.execute(
        "INSERT INTO snippets (id, title, description, category, body, protection_hint, protection_nonce, protection_ciphertext, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, NULL, ?6, ?7, ?7)",
        rusqlite::params![
            3i64,
            "Plain Charlie",
            "Charlie description",
            "Cert-B",
            CERT_PLAIN_CHARLIE_BODY,
            2i64,
            now
        ],
    )
    .expect("insert charlie");

    // App config with vault
    conn.execute(
        "INSERT INTO app_config (singleton_id, theme, vault_salt, vault_nonce, vault_canary) VALUES (1, ?1, ?2, ?3, ?4)",
        rusqlite::params!["Dark", CERT_SALT_B64, CERT_VAULT_NONCE_B64, canary_b64],
    )
    .expect("insert app_config");

    // Verify counts
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM snippets", [], |r| r.get(0))
        .expect("count");
    assert_eq!(count, 3);
    drop(conn);

    // Re-open via open_existing to ensure file is valid WAL db
    let conn2 = db::open_existing(&db_path).expect("open_existing verify");
    let (_, total) = db::list_snippets(&conn2, None, None, 0, 100).expect("list");
    assert_eq!(total, 3);
    let cats = db::list_categories(&conn2).expect("cats");
    // Cert-A count 2, Cert-B count 1
    assert_eq!(cats.len(), 2);
    drop(conn2);

    println!("CERT_FIXTURE OK");
    println!("  data_dir: {}", data_dir.display());
    println!("  db_path: {}", db_path.display());
    println!("  password: {}", CERT_PASSWORD);
    println!("  protected_body: {}", CERT_PROTECTED_BODY);
    println!("  protected_title: Protected Bravo");
    println!("  categories: Cert-A (2), Cert-B (1)");
    println!("  vault_salt: {}", CERT_SALT_B64);
    println!("  vault_nonce: {}", CERT_VAULT_NONCE_B64);
    println!("  vault_canary: {}", canary_b64);
    println!("  protected_nonce: {}", CERT_PROTECTED_NONCE_B64);
    println!("  protected_ciphertext: {}", prot_ct_b64);

    if args.iter().any(|a| a == "--print-env") {
        // Helper for Node tests to capture env
        println!("APPDATA={}", appdata_root.display());
    }
}
