# Repository-Local Add-ons — Implementation (2026-08-28)

Implements the two `RECOMMEND` add-ons from
[`REPOSITORY_LOCAL_ADDONS_MASTER_PLAN.md`](./REPOSITORY_LOCAL_ADDONS_MASTER_PLAN.md)
as **repository-local MCP servers**. Additive only: no existing integration was
touched and no global/user-wide configuration was mutated.

> **Historical handoff:** The Phase 0 branch/HEAD inventory below records the add-on implementation snapshot from 2026-08-28. It is not the current release branch or certification evidence; the extension release is now consolidated on `main`. See `docs/certification.md` for current status.

## Phase 0 — Repo truth

- Implementation HEAD: `5d678f6` (branch `main`). The topic branches
  `feature/copyit-v1-completion-20260828` and `plan/repo-local-addons-2026-08-28`
  were merged into `main` and deleted earlier; `main` is the only branch locally
  and remotely.
- Working tree was clean before these changes.
- Governance read: `AGENTS.md`, `.agent/EXECUTION_PROMPT.md`, the active campaign
  doc, and the master plan.

## Phase 1 — Inventory (PROTECTED)

Searched the full tracked tree for every surface named in the plan
(`.mcp.json`, `mcp.json`, `.vscode/mcp.json`, `.cursor/**`, `.claude/**`,
`.opencode/**`, `opencode.json*`, `.pi/**`, `AGENTS.md`, `.agent/**`, package
manifests, lockfiles, CI workflows, docs naming MCPs/skills/plugins).

**Result: no pre-existing MCP/plugin/skill/agent-integration config exists.**
The PROTECTED set is empty; both recommended tools are net-new. A repo-wide grep
for `mcpServers|context7|chrome-devtools` matched only the plan document.

## Phase 2 — Feasibility + upstream verification (pinned versions, no `latest`)

### 1. Chrome DevTools MCP

- Canonical upstream: `github.com/ChromeDevTools/chrome-devtools-mcp`; npm package
  **`chrome-devtools-mcp`**. (The `@chrome-devtools/mcp` scope returns 404 — not used.)
- **Pinned: `1.8.0`** (latest published at implementation; bin `chrome-devtools-mcp`).
- Node: `^20.19.0 || ^22.12.0 || >=23`.
- Maintenance: active (Google Chrome DevTools team).
- Runtime: requires Google Chrome / Chrome for Testing current stable; uses puppeteer.
  Configured `--headless` with a throwaway puppeteer profile, so it never attaches
  to the user's real browser/profile or exposes real vault contents.
- Privacy: `--no-usage-statistics` + `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1` disable
  Google usage statistics and npm registry update checks.
- Advisories: none found in the public npm registry at implementation time.

### 2. Context7 MCP

- Canonical upstream: `github.com/upstash/context7`; npm package
  **`@upstash/context7-mcp`**.
- **Pinned: `4.0.3`** (latest published at implementation; bin `context7-mcp`).
- Node: `>=20.18.1`.
- Maintenance: active (Upstash).
- Scope: fetches public library documentation only; **no** `%APPDATA%` / CopyIt DB
  access. Docs-only, per plan constraint.
- Optional token: `CONTEXT7_API_TOKEN` may be set externally for higher rate limits;
  no token is present or committed in this repo.

## Phase 3 — Implementation (files added)

- **`.mcp.json`** — repository-tracked MCP config in the universal `mcpServers`
  format (recognized by Claude Code, Cursor, VS Code/Copilot, Windsurf, Cline, and
  GitHub Copilot). Both servers are `npx`-pinned (ephemeral, launched from the repo
  cwd, no global install):
  - `chrome-devtools`: `npx -y chrome-devtools-mcp@1.8.0 --headless --no-usage-statistics`;
    env `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1`
  - `context7`: `npx -y @upstash/context7-mcp@4.0.3`; env `{}`
- **`scripts/mcp-preflight.mjs`** — Phase 4 guardrail check (no network, no contact
  with protected environments).
- **`scripts/mcp-validate.mjs`** — Phase 5 launcher that proves the MCP `initialize`
  handshake over stdio on a safe synthetic target.
- **`package.json`** — added `mcp:preflight` and `mcp:validate` scripts (merged into
  the existing `scripts` block; nothing removed).

## Phase 4 — Preflight result

`npm run mcp:preflight` → `MCP PREFLIGHT: PASS` (servers: chrome-devtools, context7).

Checks enforced: unique server ids; no unpinned `latest`; command is repo-scoped
(`npx`), never a global/absolute path; no `--browser-url`; no `%APPDATA%`/CopyIt
references; no embedded secret-like values.

## Phase 5 — Functional validation (safe synthetic target)

`npm run mcp:validate` → `MCP VALIDATE: PASS (2/2)`.

- `chrome_devtools@1.8.0` — caps: `logging, tools` (initialized under `--headless`
  with a throwaway profile; no real user profile/vault touched).
- `Context7@4.0.3` — caps: `prompts, resources, tools` (initialized; docs-only, no
  local database).

Relevant existing gates: the new files are config plus plain Node ESM dev scripts
with **zero dependencies**. `node --check` passes on both. No extension or
native-host source was changed, so their test suites are out of scope and were not
weakened.

## Phase 6 — Preservation audit (before/after)

- **Zero removals:** no MCP/plugin/skill/agent config existed before; nothing removed.
- **Zero hidden global changes:** only repo-tracked files added; no home-directory MCP
  registry, user-wide editor setting, global npm/cargo install, PATH, or shell profile
  was modified.
- **Zero secret leakage:** `.mcp.json` contains only package names, pinned versions,
  and environment-variable *names* (no literal secrets). Repo-wide grep for
  `sk-`/`AKIA`/`ghp_`/token patterns: none.
- **Zero unrelated dependency churn:** `package.json` `devDependencies` unchanged; only
  two `scripts` entries added. No lockfile churn.
- **Zero weakening of authority:** extension permissions and native-messaging origin
  checks are untouched. The MCPs are assistance surfaces only (per plan §Secrets,
  privacy and authority) and grant no test/release/device/security authority.

## Phase 7 — Activation

- Agents that auto-discover `.mcp.json` (Claude Code, Cursor, VS Code/Copilot,
  Windsurf, Cline, GitHub Copilot) load both servers from the repo root on the next
  session; `npx` fetches the pinned packages on first use.
- **OpenCode (`opencode-go/hy3`) note:** the archived OpenCode reads `./.opencode.json`
  with a top-level `mcpServers` block; the live `opencode-go` schema could not be
  verified from this environment. If `opencode-go` does **not** auto-discover
  `.mcp.json`, copy the identical `mcpServers` object from `.mcp.json` into a
  repo-local `.opencode.json` at the repo root — the server definitions are unchanged.
- Both servers run headless / docs-only by default. Never pass `--browser-url` to
  `chrome-devtools` (that would attach to a running user browser), and never point
  either server at `%APPDATA%/CopyIt`.

## Environment-variable names (declared in config; no literals committed)

- `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS` (value `"1"`)
- `CONTEXT7_API_TOKEN` (optional, external only — not present in config)

## Blocked / rejected

- None. No item required `GLOBAL_SCOPE_BLOCKED`.
