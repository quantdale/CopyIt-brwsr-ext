# Fresh-machine onboarding

This is the canonical bootstrap entry point for a new workstation or a fresh coding-agent environment. Complete this document before implementation work. The objective is a reproducible machine that can build, test, inspect, and operate this repository without rediscovering tooling mid-campaign.

## 1. Preflight rule

1. Clone the repository and enter its root.
2. Confirm the intended repository/branch and fetch current `origin/main`.
3. Read the repository control-plane documents before changing code: `AGENTS.md`, `README.md`, `IMPLEMENTATION_PLAN.md`, `.agent/`, `docs/`.
4. Install/verify the machine prerequisites below.
5. Enable the committed agent integrations and repository-local skills.
6. Restore dependencies from lockfiles/pins; do not casually upgrade them during bootstrap.
7. Run the baseline validation commands.
8. Only then begin a development campaign. If a prerequisite cannot be satisfied, record it as an environment blocker rather than weakening a gate.

Credentials, API keys, signing material, account logins, licensed models/assets, and other secrets are machine/user responsibilities. Never commit them.

## 2. Supported host and prerequisites

**Primary host:** Windows 10/11 with Chrome or Edge stable.

**Required machine tools**
- Git
- Node.js 24.3.0 (see `.node-version`) + npm
- Rust 1.93.1 (see `rust-toolchain.toml`)
- Chrome and/or Edge
- PowerShell
- Playwright Chromium

**Task-dependent / optional tools**
- Desktop CopyIt installation/data for real shared-database integration checks


## 3. Agent setup

- Load repository instructions before acting. Prefer committed repository state over chat history.
- Repository-local skills: No `.agents/skills` tree is committed; follow `AGENTS.md` and `.agent/` directly..
- Agent adapter/config directories present in this repository should be discovered and used in-place; do not duplicate them globally unless the harness cannot load repository-local configuration.
- Relevant committed agent surfaces: `.agent/`, `AGENTS.md` and repository docs.
- MCP policy: Use the committed `.mcp.json`: pinned `chrome-devtools` in headless/no-telemetry mode and pinned `context7`. Run `npm run mcp:preflight` / `npm run mcp:validate`; do not install duplicate global servers.
- Keep MCP/plugin authority narrow. Documentation/diagnostic MCPs are not permission to change architecture, bypass tests, or publish.
- Authentication for GitHub and coding-agent CLIs is configured separately on the machine. Never write tokens into tracked files.

## 4. Bootstrap

Run the repository's pinned bootstrap, not an improvised dependency upgrade:

```powershell
npm ci
rustup show
cargo fetch --manifest-path native-host/Cargo.toml
npx playwright install chromium
npm run mcp:preflight
npm run mcp:validate
```

The extension/native-host integration is Windows-specific. Registry installation is per-user and should be performed through the repository scripts, not manual registry edits.


## 5. Editor/LSP baseline

Use the local TypeScript server/ESLint plus rust-analyzer for `native-host/`. Keep the two toolchains separate but available in the same editor session.

The editor is optional; the language servers are not. Agents should have diagnostics/type information available before editing non-trivial code.

## 6. Baseline verification

```powershell
npm test
npm run lint
npm run build
npm run e2e
cargo test --manifest-path native-host/Cargo.toml
cargo clippy --manifest-path native-host/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path native-host/Cargo.toml -- --check
```

A fresh machine is considered **development-ready** only when the applicable non-external gates above pass. Hardware/device/signing/account gates may remain explicitly blocked if the repository already classifies them that way.

## 7. Fresh-agent instruction

Use this exact operating rule when handing the repository to a new agent:

> Read `ONBOARDING.md` first. Set up every applicable prerequisite, repository-local skill, MCP/plugin, dependency, browser/device/runtime tool, and validation gate described there. Then read the repository's durable agent state and only start implementation after preflight is green or a genuine environment blocker is recorded. Do not replace pinned tooling, skip gates, or invent work to compensate for a missing machine capability.
