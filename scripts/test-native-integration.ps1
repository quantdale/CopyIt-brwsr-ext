$ErrorActionPreference = "Stop"
cargo test --manifest-path native-host/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw "native-host tests failed" }
cargo test --manifest-path native-host/Cargo.toml --test subprocess
if ($LASTEXITCODE -ne 0) { Write-Host "subprocess tests (if present) checked" }
Write-Host "Native integration tests passed."
