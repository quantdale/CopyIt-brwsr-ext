//! Chromium native messaging framing.
//!
//! Each message is UTF-8 JSON prefixed by a 32-bit NATIVE-endian length.
//! stdout is protocol-only: this module never logs.

use std::io::{Read, Write};

/// Hard cap for browser→host frames. Rejects absurd lengths before allocating.
pub const MAX_REQUEST_BYTES: u32 = 1_048_576;

/// Host→browser response ceiling, comfortably below Chromium's 1 MB limit.
pub const MAX_RESPONSE_BYTES: usize = 900 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    #[error("clean end of stream")]
    Eof,
    #[error("stream ended mid-frame")]
    UnexpectedEof,
    #[error("frame exceeds maximum size")]
    TooLarge,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

fn read_exact_or_eof<R: Read>(reader: &mut R, buf: &mut [u8]) -> Result<usize, FrameError> {
    let mut filled = 0;
    while filled < buf.len() {
        match reader.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(FrameError::Io(e)),
        }
    }
    Ok(filled)
}

/// Reads one framed message. Returns `Ok(None)` on clean EOF at a frame boundary,
/// which is the host's signal to exit.
pub fn read_message<R: Read>(reader: &mut R) -> Result<Option<Vec<u8>>, FrameError> {
    let mut len_buf = [0u8; 4];
    let n = read_exact_or_eof(reader, &mut len_buf)?;
    if n == 0 {
        return Ok(None);
    }
    if n < 4 {
        return Err(FrameError::UnexpectedEof);
    }
    let len = u32::from_ne_bytes(len_buf);
    if len > MAX_REQUEST_BYTES {
        return Err(FrameError::TooLarge);
    }
    let mut payload = vec![0u8; len as usize];
    reader
        .read_exact(&mut payload)
        .map_err(|_| FrameError::UnexpectedEof)?;
    Ok(Some(payload))
}

/// Writes one framed response. Refuses responses above the internal ceiling so
/// oversized data can never reach (and be truncated by) the browser pipe.
pub fn write_message<W: Write>(writer: &mut W, message: &[u8]) -> Result<(), FrameError> {
    if message.len() > MAX_RESPONSE_BYTES {
        return Err(FrameError::TooLarge);
    }
    let len = (message.len() as u32).to_ne_bytes();
    writer.write_all(&len)?;
    writer.write_all(message)?;
    writer.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn frame(msg: &[u8]) -> Vec<u8> {
        let mut out = (msg.len() as u32).to_ne_bytes().to_vec();
        out.extend_from_slice(msg);
        out
    }

    #[test]
    fn reads_one_valid_message() {
        let payload = br#"{"hello":"world"}"#;
        let mut cursor = Cursor::new(frame(payload));
        let msg = read_message(&mut cursor).unwrap().unwrap();
        assert_eq!(msg, payload.to_vec());
    }

    #[test]
    fn reads_multiple_sequential_messages() {
        let mut data = Vec::new();
        data.extend_from_slice(&frame(b"one"));
        data.extend_from_slice(&frame(b"two"));
        data.extend_from_slice(&frame(b"three"));
        let mut cursor = Cursor::new(data);
        assert_eq!(read_message(&mut cursor).unwrap().unwrap(), b"one".to_vec());
        assert_eq!(read_message(&mut cursor).unwrap().unwrap(), b"two".to_vec());
        assert_eq!(read_message(&mut cursor).unwrap().unwrap(), b"three".to_vec());
        assert!(read_message(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn eof_at_boundary_is_none() {
        let mut cursor = Cursor::new(Vec::<u8>::new());
        assert!(read_message(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn eof_mid_length_is_error() {
        let mut cursor = Cursor::new(vec![1, 2]);
        assert!(matches!(
            read_message(&mut cursor),
            Err(FrameError::UnexpectedEof)
        ));
    }

    #[test]
    fn eof_mid_payload_is_error() {
        let mut data = (64u32).to_ne_bytes().to_vec();
        data.extend_from_slice(b"only a few bytes");
        let mut cursor = Cursor::new(data);
        assert!(matches!(
            read_message(&mut cursor),
            Err(FrameError::UnexpectedEof)
        ));
    }

    #[test]
    fn oversized_length_is_rejected_before_allocation() {
        let mut data = (u32::MAX).to_ne_bytes().to_vec();
        data.extend_from_slice(b"junk");
        let mut cursor = Cursor::new(data);
        assert!(matches!(read_message(&mut cursor), Err(FrameError::TooLarge)));
    }

    #[test]
    fn write_refuses_responses_over_the_cap() {
        let big = vec![0u8; MAX_RESPONSE_BYTES + 1];
        let mut out = Vec::new();
        assert!(matches!(
            write_message(&mut out, &big),
            Err(FrameError::TooLarge)
        ));
        assert!(out.is_empty(), "nothing may be written for an refused frame");
    }

    #[test]
    fn write_then_read_round_trips() {
        let payload = br#"{"ok":true}"#;
        let mut buf = Vec::new();
        write_message(&mut buf, payload).unwrap();
        let mut cursor = Cursor::new(buf);
        assert_eq!(read_message(&mut cursor).unwrap().unwrap(), payload.to_vec());
    }

    #[test]
    fn arbitrary_binary_payloads_round_trip() {
        // Invalid-UTF-8 bytes must survive framing; protocol layer rejects them later.
        let payload = vec![0xff, 0xfe, 0x00, 0x80];
        let mut buf = Vec::new();
        write_message(&mut buf, &payload).unwrap();
        let mut cursor = Cursor::new(buf);
        assert_eq!(read_message(&mut cursor).unwrap().unwrap(), payload);
    }
}
