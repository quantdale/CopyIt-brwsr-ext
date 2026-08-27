//! Wire protocol types, the stable error-code contract, and request validation.
//!
//! Envelope (protocol version 1):
//!   request : { protocolVersion, requestId, method, params }
//!   success : { protocolVersion, requestId, ok: true,  result }
//!   failure : { protocolVersion, requestId, ok: false, error: { code, message, retryable } }

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u32 = 1;

/// Methods understood by this host. Keep in sync with docs/protocol.md.
pub mod method {
    pub const HELLO: &str = "hello";
    pub const LIST_CATEGORIES: &str = "listCategories";
    pub const LIST_SNIPPETS: &str = "listSnippets";
    pub const GET_SNIPPET_BODY: &str = "getSnippetBody";
    pub const UNLOCK_VAULT: &str = "unlockVault";
    pub const LOCK_VAULT: &str = "lockVault";
    pub const PING: &str = "ping";

    pub const ALL: &[&str] = &[
        HELLO,
        LIST_CATEGORIES,
        LIST_SNIPPETS,
        GET_SNIPPET_BODY,
        UNLOCK_VAULT,
        LOCK_VAULT,
        PING,
    ];
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    InvalidRequest,
    UnsupportedProtocolVersion,
    UnknownMethod,
    InvalidParams,
    NativeHostInternal,
    MigrationInProgress,
    MigrationFailed,
    LegacyDataCorrupt,
    DatabaseUnavailable,
    DatabaseBusy,
    UnsupportedSchemaVersion,
    NotFound,
    VaultNotConfigured,
    VaultLocked,
    InvalidPassword,
    DecryptFailed,
    ResponseTooLarge,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::InvalidRequest => "invalid_request",
            ErrorCode::UnsupportedProtocolVersion => "unsupported_protocol_version",
            ErrorCode::UnknownMethod => "unknown_method",
            ErrorCode::InvalidParams => "invalid_params",
            ErrorCode::NativeHostInternal => "native_host_internal",
            ErrorCode::MigrationInProgress => "migration_in_progress",
            ErrorCode::MigrationFailed => "migration_failed",
            ErrorCode::LegacyDataCorrupt => "legacy_data_corrupt",
            ErrorCode::DatabaseUnavailable => "database_unavailable",
            ErrorCode::DatabaseBusy => "database_busy",
            ErrorCode::UnsupportedSchemaVersion => "unsupported_schema_version",
            ErrorCode::NotFound => "not_found",
            ErrorCode::VaultNotConfigured => "vault_not_configured",
            ErrorCode::VaultLocked => "vault_locked",
            ErrorCode::InvalidPassword => "invalid_password",
            ErrorCode::DecryptFailed => "decrypt_failed",
            ErrorCode::ResponseTooLarge => "response_too_large",
        }
    }

    /// Concise user-safe text. Never includes internals, paths, SQL, or bodies.
    fn default_message(self) -> &'static str {
        match self {
            ErrorCode::InvalidRequest => "The request could not be understood.",
            ErrorCode::UnsupportedProtocolVersion => {
                "The native host protocol version is not supported. Reinstall the native host."
            }
            ErrorCode::UnknownMethod => "The requested operation does not exist.",
            ErrorCode::InvalidParams => "The request parameters are invalid.",
            ErrorCode::NativeHostInternal => "An unexpected internal error occurred.",
            ErrorCode::MigrationInProgress => "The prompt library is still migrating. Try again shortly.",
            ErrorCode::MigrationFailed => "Migrating your library to SQLite failed.",
            ErrorCode::LegacyDataCorrupt => {
                "A legacy data file is damaged. Your files were preserved; restore or repair them before continuing."
            }
            ErrorCode::DatabaseUnavailable => "The prompt database could not be opened.",
            ErrorCode::DatabaseBusy => "The prompt database is busy. Try again shortly.",
            ErrorCode::UnsupportedSchemaVersion => {
                "The database was created by a newer version. Update the native host."
            }
            ErrorCode::NotFound => "That prompt no longer exists.",
            ErrorCode::VaultNotConfigured => "No vault has been configured yet.",
            ErrorCode::VaultLocked => "This prompt is protected. Unlock the vault first.",
            ErrorCode::InvalidPassword => "Incorrect vault password.",
            ErrorCode::DecryptFailed => "Decryption failed for this protected prompt.",
            ErrorCode::ResponseTooLarge => "The response exceeded protocol limits.",
        }
    }

    fn retryable(self) -> bool {
        matches!(
            self,
            ErrorCode::DatabaseBusy | ErrorCode::MigrationInProgress
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Request {
    pub protocol_version: u32,
    pub request_id: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub protocol_version: u32,
    pub request_id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorBody>,
}

impl Response {
    pub fn success(request_id: &str, result: Value) -> Self {
        Response {
            protocol_version: PROTOCOL_VERSION,
            request_id: request_id.to_string(),
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(request_id: &str, code: ErrorCode) -> Self {
        Response::failure_with_message(request_id, code, None)
    }

    pub fn failure_with_message(request_id: &str, code: ErrorCode, message: Option<&str>) -> Self {
        Response {
            protocol_version: PROTOCOL_VERSION,
            request_id: request_id.to_string(),
            ok: false,
            result: None,
            error: Some(ErrorBody {
                code: code.as_str().to_string(),
                message: message
                    .map(str::to_string)
                    .unwrap_or_else(|| code.default_message().to_string()),
                retryable: code.retryable(),
            }),
        }
    }
}

/// Parses raw frame bytes into a validated [`Request`], mapping any problem to
/// a protocol failure response with a stable error code.
pub fn parse_request(bytes: &[u8]) -> Result<Request, Response> {
    let text =
        std::str::from_utf8(bytes).map_err(|_| Response::failure("", ErrorCode::InvalidRequest))?;
    let req: Request =
        serde_json::from_str(text).map_err(|_| Response::failure("", ErrorCode::InvalidRequest))?;
    let mut req = req;
    if req.params.is_null() {
        req.params = serde_json::json!({});
    }
    if req.request_id.is_empty() || req.request_id.len() > 128 {
        return Err(Response::failure("", ErrorCode::InvalidRequest));
    }
    if req.protocol_version != PROTOCOL_VERSION {
        return Err(Response::failure(
            &req.request_id.clone(),
            ErrorCode::UnsupportedProtocolVersion,
        ));
    }
    Ok(req)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse_ok(body: &[u8]) -> Request {
        parse_request(body).unwrap()
    }

    fn parse_err(body: &[u8]) -> String {
        let resp = parse_request(body).unwrap_err();
        assert!(!resp.ok);
        resp.error.unwrap().code
    }

    #[test]
    fn parses_valid_request() {
        let req =
            parse_ok(br#"{"protocolVersion":1,"requestId":"abc-1","method":"ping","params":{}}"#);
        assert_eq!(req.method, "ping");
        assert_eq!(req.request_id, "abc-1");
        assert_eq!(req.params, json!({}));
    }

    #[test]
    fn params_default_to_empty_object() {
        let req = parse_ok(br#"{"protocolVersion":1,"requestId":"x","method":"hello"}"#);
        assert_eq!(req.params, json!({}));
    }

    #[test]
    fn rejects_invalid_json_and_invalid_utf8() {
        assert_eq!(parse_err(b"not json"), "invalid_request");
        assert_eq!(parse_err(&[0xff, 0xfe]), "invalid_request");
    }

    #[test]
    fn rejects_wrong_protocol_version() {
        let code = parse_err(br#"{"protocolVersion":99,"requestId":"r","method":"ping"}"#);
        assert_eq!(code, "unsupported_protocol_version");
    }

    #[test]
    fn rejects_missing_fields_and_bad_shapes() {
        assert_eq!(
            parse_err(br#"{"protocolVersion":1,"method":"ping"}"#),
            "invalid_request"
        );
        assert_eq!(
            parse_err(br#"{"protocolVersion":1,"requestId":"","method":"ping"}"#),
            "invalid_request"
        );
        // Unknown top-level fields are rejected to catch protocol drift early.
        assert_eq!(
            parse_err(br#"{"protocolVersion":1,"requestId":"a","method":"ping","extra":1}"#),
            "invalid_request"
        );
    }

    #[test]
    fn failure_responses_echo_request_id_and_use_stable_codes() {
        let resp = Response::failure("req-42", ErrorCode::VaultLocked);
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["requestId"], "req-42");
        assert_eq!(v["ok"], false);
        assert_eq!(v["error"]["code"], "vault_locked");
        assert_eq!(v["error"]["retryable"], false);
        assert!(v.get("result").is_none());
    }

    #[test]
    fn success_responses_carry_result_only() {
        let resp = Response::success("req-7", json!({"pong": true}));
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["result"]["pong"], true);
        assert!(v.get("error").is_none());
    }

    #[test]
    fn busy_errors_are_marked_retryable() {
        let v = serde_json::to_value(Response::failure("r", ErrorCode::DatabaseBusy)).unwrap();
        assert_eq!(v["error"]["retryable"], true);
        assert_eq!(v["error"]["code"], "database_busy");
    }

    #[test]
    fn all_documented_error_codes_render() {
        let codes = [
            ErrorCode::InvalidRequest,
            ErrorCode::UnsupportedProtocolVersion,
            ErrorCode::UnknownMethod,
            ErrorCode::InvalidParams,
            ErrorCode::NativeHostInternal,
            ErrorCode::MigrationInProgress,
            ErrorCode::MigrationFailed,
            ErrorCode::LegacyDataCorrupt,
            ErrorCode::DatabaseUnavailable,
            ErrorCode::DatabaseBusy,
            ErrorCode::UnsupportedSchemaVersion,
            ErrorCode::NotFound,
            ErrorCode::VaultNotConfigured,
            ErrorCode::VaultLocked,
            ErrorCode::InvalidPassword,
            ErrorCode::DecryptFailed,
            ErrorCode::ResponseTooLarge,
        ];
        for c in codes {
            assert!(!c.as_str().is_empty());
        }
    }
}
