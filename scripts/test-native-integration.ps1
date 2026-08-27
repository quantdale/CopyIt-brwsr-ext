$ErrorActionPreference = "Stop"
cargo test --manifest-path native-host/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw "native-host tests failed" }
cargo test --manifest-path native-host/Cargo.toml --test subprocess
if ($LASTEXITCODE -ne 0) { throw "native-host subprocess tests failed" }
Write-Host "Native integration tests passed."
