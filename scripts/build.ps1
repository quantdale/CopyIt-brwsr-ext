$ErrorActionPreference = "Stop"
Write-Host "Building CopyIt browser extension and native host..."
cargo build --release --manifest-path native-host/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { throw "tsc failed" }
Write-Host "Build succeeded. Extension dist at extension/dist, host at native-host/target/release/copyit-native-host.exe"
