# Changelog

## Unreleased

## 0.5.0

- **Breaking: one transport-unification release.** CLI and MCP now share a
  single canonical operation layer (`BridgeRequest` → `executeOperation`):
  identical validation, path resolution, language routing, and error
  semantics on both surfaces.
- **Breaking:** split file and directory diagnostics. `lsp_diagnostics` is
  file-only (`file` required; `uri`, `dir`, no-target mode, and file-timeout
  mixing removed). Directory scans move to `lsp_directory_diagnostics`
  (`dir`, `severity`, `maxFiles`, `timeoutBudgetMs`, `concurrency`) with
  defaults in `lsp-bridge.json` (`directoryDiagnostics`). Directory budget
  semantics documented as scheduling, not hard cancellation.
- **Breaking:** code actions use stable handles. `lsp_code_actions` requires a
  cursor position (`line`, `character`) and returns actions with `id`;
  applying by zero-based `apply` index is removed. New
  `lsp_apply_code_action` applies by handle with a content-fingerprint
  staleness check (a changed source file rejects the action). Overlapping
  Known Diagnostics are automatically included in the Code Action context.
- **Breaking:** remove legacy direct JSON-RPC methods `lsp.*`; the MCP server
  implements only `initialize`, `notifications/initialized`, `tools/list`,
  and `tools/call`, all routed through the same executor as the CLI.
- **Breaking:** `doctor` is replaced by `status` (`BridgeStatus`); the CLI
  command `codex-lsp-bridge doctor` is removed.
- **Breaking:** the npm installer commands are removed (`codex-lsp-bridge
  install`/`uninstall`, the `codex-lsp-bridge-install`/`uninstall` bin entries,
  and the `smoke:install` script). Registration is manual (config.toml,
  hooks.json, AGENTS.md — documented in the README's "Codex Registration")
  or via the Codex plugin package.
- **Breaking:** `--language` is limited to symbol-only lookups
  (`definition <symbol> --language rust`, `symbols`, references, hover);
  position-based lookups reject it (the file determines the language).
- Workspace Root no longer requires project markers (`.git`, `package.json`,
  `tsconfig.json`, `Cargo.toml`) — any existing directory canonicalized with
  `realpath`; no marker warnings. Workspace-level config presence is shown
  in status.
- Add `Language Server Workspace` (`workspacePath` per language): server cwd,
  LSP root, and seed search for nested monorepo workspaces; executable search
  is Language Server Workspace `node_modules/.bin` → Workspace Root
  `node_modules/.bin` → PATH. Seed files must be relative; absolutes and
  `..` escapes are rejected at config validation.
- Shared path resolvers with symlink-escape protection, including create
  targets under symlinked parents (Workspace Root containment everywhere).
- `timeoutMs` / `timeoutBudgetMs` / `maxFiles` / coordinates are canonical
  positive integers with identical CLI/MCP validation; tool schemas and
  decoders are contract-bound and conformance-tested.
- Internal Known Diagnostics store (raw protocol-level diagnostics per file)
  feeds overlapping Code Action context and future reactive Post-Tool
  Diagnostics snapshots/deltas; not part of the public contract.

## 0.4.0

- Add validated semantic editing commands: `lsp_rename`, `lsp_code_actions`, and
  `lsp_will_rename_files`. All server-returned changes pass through the central
  `WorkspaceEdit` normalize/validate/apply pipeline; Codex remains responsible
  for the physical file move.
- Add bidirectional JSON-RPC server-request handling and synchronization for
  server-initiated `workspace/applyEdit`.
- Languages are now configured: define any language server with a `languageServers`
  entry in `lsp-bridge.json` (`command` + `extensions` required, `languageId`,
  `args`, `workspaceSeedFiles`, `installHint`, `supportLevel` optional).
  Built-in languages are the defaults layer of the same mechanism and can be
  overridden field by field.
- **Breaking (invalid configs only):** unknown or malformed `languageServers` entries
  now fail fast with a descriptive error instead of being silently ignored. Valid
  configs are unaffected.

## 0.3.3

- Publish the `--with-rust-analyzer` installer option in the CLI package.

## 0.3.2

- Add `codex-lsp-bridge install --with-rust-analyzer` to install `rust-analyzer` through `rustup` during Codex setup.

## 0.3.1

- Return `status: "unavailable"` diagnostics instead of throwing when a language server command is missing.
- Document `rust-toolchain.toml` as the preferred per-project way to request `rust-analyzer`.

## 0.3.0

- Extend automatic PostToolUse diagnostics and timeout sizing to Rust source files.
- Skip PostToolUse diagnostics quietly when an optional language server is not installed.
- Return a normal request error instead of crashing when a language server command is missing.
- Recognize `Cargo.toml` as an explicit MCP workspace root.

## 0.2.0

- Add `diagnosticsTimeoutMs: "auto"` for workspace-aware diagnostics timeout selection.
- Report resolved diagnostics timeout policy and reasons in `doctor` / `lsp_status`.
- Increase default file diagnostics timeout from 5000 ms to 15000 ms.
- Add CLI file diagnostics override with `--timeout-ms`.

## 0.1.2

- Refresh the public README installation flow for npm users.

## 0.1.1

- Make `codex-lsp-bridge --help` and `codex-lsp-bridge help` exit successfully.
- Add package smoke coverage for the published CLI help command.

## 0.1.0

Initial MVP release.

- Read-only MCP tools for diagnostics, definitions, references, symbols, hover, and status.
- Workspace-root file boundary with realpath checks and explicit `root` support for detached worktrees.
- Diagnostics trust metadata: `status`, `timedOut`, `stale`, and `sourceRevision`.
- Open document lifecycle support with `didOpen`, `didChange`, `didClose`, and restart re-sync.
- Quiet PostToolUse diagnostics hook with clean timeout suppression and duplicate error dedupe.
- Bounded directory diagnostics with `maxFiles`, `timeoutBudgetMs`, `concurrency`, and directory metadata.
- TypeScript primary support, with Rust, Python, and Go adapters marked experimental.
- Codex installer/uninstaller, plugin metadata, hooks, skill, CI, package verification, and install smoke tests.
