---
thesaurus-format: "2.0"
skill: ubiquitous-language
---

# Project Thesaurus

> Domain glossary following DDD ubiquitous language. Every name in code, APIs, docs,
> and conversations comes from here. Add the term here BEFORE using it in code.
>
> **Reconstructed, not authored.** An AI agent mined this vocabulary from the codebase —
> the names are evidence found in code and are binding; the definitions are a
> reconstruction of what the code seems to mean and may be wrong until a domain expert
> confirms them. Maintained by the `ubiquitous-language` skill
> (<https://github.com/CodeAlive-AI/ai-driven-development/tree/main/skills/ubiquitous-language>).
>
> **How to use (grep-first):** `rg -n -i '<word>' THESAURUS.md` — the shape of the hit
> line tells you what to do:
>
> - ``- **Term** `Identifier` kind:… avoid: …`` (Index) → use the Identifier, even if
>   your word was under `avoid:`
> - ``- `Word` use: `X` `` (Forbidden) → banned; use `X`
> - ``- `Old` → `New` in: …`` (Legacy) → use `New` in new code
> - `### Term — …` under Unresolved → open question; ask before deciding
> - no hit → new concept: add an Index line + `### Term` entry first
> Handy: `rg 'kind:event'` · `rg 'ctx:Billing'` · `rg -F '**Term**'` · `rg '^### Term( \(|$)'`
>
> **Rules:** one canonical Identifier per concept; every name lives in exactly one
> registry line; `avoid:`/Forbidden/Legacy names never appear in new code; on rename,
> update code, docs, API, DB — and add a Legacy line.

## Index

- **Bridge** `codex-lsp-bridge` kind:concept avoid: `proxy`, `wrapper`
- **Bridge Config** `BridgeConfig` kind:value
- **Bridge Operation** `BridgeOperation` kind:value
- **Bridge Request** `BridgeRequest` kind:value
- **Bridge Status** `BridgeStatus` kind:service
- **Command Service** `CommandService` kind:service
- **Code Action** `CodeAction` kind:command
- **Code Action Cache** `CodeActionCache` kind:concept
- **Code Action Handle** `CodeActionHandle` kind:value
- **Apply Code Action** `applyCodeAction` kind:command
- **Default Language Servers** `defaultLanguageServers` kind:value
- **Definition** `Definition` kind:query
- **Diagnostic** `Diagnostic` kind:value
- **Diagnostic Conclusion** `DiagnosticConclusion` kind:state avoid: `verdict`
- **Diagnostic Report** `DiagnosticReport` kind:value avoid: `DiagnosticResult`
- **Diagnostic Status** `DiagnosticStatus` kind:state
- **Diagnostic Summary** `DiagnosticSummary` kind:value
- **Diagnostics Timeout Policy** `DiagnosticsTimeoutPolicy` kind:value avoid: `timeoutBudget` (that is Timeout Budget)
- **Directory Diagnostics** `DirectoryDiagnostics` kind:query avoid: `directoryScan`
- **File Diagnostics** `fileDiagnostics` kind:query
- **Document Position** `DocumentPosition` kind:value
- **File Rename Sync** `FileRenameSync` kind:process
- **Hover** `Hover` kind:query
- **Hover Info** `HoverInfo` kind:value avoid: `HoverResult`
- **Install Hint** `InstallHint` kind:concept
- **Known Diagnostics** `KnownDiagnostics` kind:value
- **Known Diagnostics Delta** `KnownDiagnosticsDelta` kind:value
- **Known Diagnostics Snapshot** `KnownDiagnosticsSnapshot` kind:value
- **Language Descriptor** `LanguageDescriptor` kind:value
- **Language Registry** `LanguageRegistry` kind:service
- **Language Server** `LanguageServer` kind:concept avoid: `LanguageServerConfig` (that is its config type), `Lsp`
- **Language Server Workspace** `LanguageServerWorkspace` kind:concept
- **LSP Client** `LspClient` kind:service
- **LSP Provider Registry** `LspProviderRegistry` kind:service
- **Location** `Location` kind:value
- **Post-Tool Diagnostics** `PostToolDiagnostics` kind:process avoid: `postToolUseHook`
- **References** `References` kind:query
- **Semantic Provider** `SemanticProvider` kind:service avoid: `LspService`, `SemanticLayer`
- **Server Request** `ServerRequest` kind:concept
- **Severity** `Severity` kind:value
- **Source File List Cache** `SourceFileListCache` kind:concept
- **Source Revision** `SourceRevision` kind:concept avoid: `diagnosticsVersion`
- **Staleness** `Stale` kind:state avoid: `outdated`
- **Supported Language** `SupportedLanguage` kind:concept
- **Support Level** `SupportLevel` kind:state
- **Symbol Match** `SymbolMatch` kind:value
- **Symbol Rename** `SymbolRename` kind:command
- **Symbols** `Symbols` kind:query avoid: `WorkspaceSymbol`
- **Timeout Budget** `TimeoutBudget` kind:value avoid: `timeoutMs` (that is Diagnostics Timeout Policy)
- **Workspace Command Service** `WorkspaceCommandService` kind:service
- **Workspace Edit** `WorkspaceEdit` kind:value
- **Workspace Path Resolver** `resolveWorkspacePath` kind:service avoid: `resolveFileInsideRoot`
- **Workspace Root** `WorkspaceRoot` kind:concept avoid: `projectRoot`
- **Workspace Root Resolution** `resolveWorkspaceRoot` kind:service
- **Workspace Runtime** `WorkspaceRuntime` kind:service avoid: `BridgeRuntime`
- **Workspace Seed Files** `WorkspaceSeedFiles` kind:concept

## Terms

### Bridge

- **Definition**: The semantic layer between Codex CLI and local language servers; the product itself (`codex-lsp-bridge`, npm package, MCP server). Reads are unlimited; edits happen only through language-server-defined, bridge-validated Workspace Edits.
- **NOT**: A general-purpose LSP proxy or an editor plugin; it never applies an edit the language server did not return.
- **Related**: Semantic Provider, Workspace Edit, Post-Tool Diagnostics, Bridge Status

### Bridge Config

- **Definition**: The user-facing configuration of the whole Bridge, loaded from `~/.codex/lsp-bridge.json` and `<workspace>/.codex/lsp-bridge.json` (workspace wins): `defaultLanguage`, `diagnosticsTimeoutMs`, `hook` options, and `languageServers` — per-language entries merged field by field over the Default Language Servers layer (defaults → global → workspace). The config file have renamed to `lsp-bridge.json`.
- **NOT**: A language-server descriptor (that's Language Server via `LanguageServerConfig`) or a spawn recipe (`ServerProcessConfig`).
- **Related**: Language Descriptor, Default Language Servers, Diagnostics Timeout Policy, Supported Language

### Command Service

- **Definition**: The validated facade over one SemanticProvider: each method (`diagnostics`, `definition`, `references`, `symbols`, `hover`, `rename`, `codeActions`, `willRenameFiles`, and their `*At` variants) validates inputs (non-empty symbol, 1-based line/character) and delegates to the provider. Despite the name, all methods are queries or validated edit commands — "Command" refers to the CLI/MCP tool surface this layer serves.
- **NOT**: A write-model command bus or an aggregate command handler; nothing here mutates source files directly — edits flow through Workspace Edit.
- **Related**: Semantic Provider, Workspace Command Service, Workspace Edit

### Code Action

- **Definition**: Command listing Language Server code actions (quickfixes, refactors, source actions) for a file range; exposed as the `lsp_code_actions` MCP tool. The Bridge builds the LSP request itself: required cursor position (line/character) plus optional selection (end line/character) forms the range, and overlapping Known Diagnostics are automatically placed into `CodeActionContext.diagnostics`. Returns agent-facing summaries carrying a Code Action Handle; the raw actions are retained in the Code Action Cache. Command-only actions are executed internally via `workspace/executeCommand`; edits always flow through the Workspace Edit pipeline.
- **NOT**: A free-form code generation tool; applying is a separate Apply Code Action operation; the bridge applies only what the language server returns.
- **Related**: Code Action Handle, Apply Code Action, Workspace Edit, Known Diagnostics, Server Request

### Default Language Servers

- **Definition**: The defaults layer of Bridge Config language servers: TypeScript, Rust, Python, Go as ordinary Language Descriptor records (`default-language-servers.ts`). The only place in code where concrete language names appear; identical in format and treatment to user-supplied descriptors — built-in languages are not a separate mechanism.
- **NOT**: A registry or a runtime structure (that's Language Registry); just data, merged like any other config layer.
- **Related**: Language Descriptor, Language Registry, Bridge Config

### Definition

- **Definition**: Query that resolves a symbol name or a Document Position to the Location of its declaration; exposed as the `lsp_definition` MCP tool (`definition` / `definitionAt`).
- **NOT**: A reference listing (that's References) or a symbol search (that's Symbols).
- **Related**: References, Symbols, Hover, Location, Document Position

### Diagnostic

- **Definition**: A single LSP diagnostic item for a file/position with a Severity, message, and optional source and code.
- **NOT**: The overall result of a diagnostics request (that's Diagnostic Report or Diagnostic Summary).
- **Related**: Severity, Diagnostic Report, Diagnostic Summary

### Diagnostic Conclusion

- **Definition**: The interpreted outcome of a diagnostics request: `diagnostics_clean`, `diagnostics_found`, `inconclusive`, or `unavailable`; `inconclusive` covers timed-out requests so a timeout is never reported as "clean".
- **NOT**: The transport-level state (that's Diagnostic Status); a `timed_out` status maps to an `inconclusive` conclusion, not to "no errors".
- **Related**: Diagnostic Status, Diagnostic Summary, Staleness

### Diagnostic Report

- **Definition**: The raw provider-level result of a diagnostics call: status, timedOut, stale, unavailableReason, sourceRevision, and the Diagnostic items.
- **NOT**: The user/agent-facing form with counts and conclusion (that's Diagnostic Summary).
- **Related**: Diagnostic, Diagnostic Status, Diagnostic Summary, Source Revision

### Diagnostic Status

- **Definition**: The transport state of a diagnostics request: `ok`, `timed_out`, or `unavailable`.
- **NOT**: The interpreted verdict (that's Diagnostic Conclusion).
- **Related**: Diagnostic Conclusion, Diagnostic Report

### Diagnostic Summary

- **Definition**: The agent-facing result produced by `summarizeDiagnostics`: Diagnostic Conclusion, message, totals by Severity, items, and a compact `summary[]` of strings; the shape returned by the CLI and MCP tools.
- **NOT**: The raw provider output (that's Diagnostic Report).
- **Related**: Diagnostic, Diagnostic Conclusion, Severity

### Diagnostics Timeout Policy

- **Definition**: How long File Diagnostics wait for fresh results: a fixed number of milliseconds or `"auto"` (derived from workspace hints such as monorepo markers, tsconfig references, and sampled source-file count); surfaces as `timeoutMs` / `diagnosticsTimeoutMs`. Positive integer only.
- **NOT**: The wall-clock budget of a directory scan (that's Timeout Budget — passing `timeoutBudgetMs` for file diagnostics is rejected).
- **Related**: Timeout Budget, File Diagnostics, Directory Diagnostics

### Directory Diagnostics

- **Definition**: A bounded recursive scan orchestration run by the Workspace Runtime over File Diagnostics: enumerate source files (`maxFiles` limit, Source File List Cache), run file Diagnostics per file with `concurrency`, merge results by Severity, and stop scheduling new work once the Timeout Budget (`timeoutBudgetMs`) is exhausted — already-running requests may still finish, so the budget is a scheduling budget, not a hard wall-clock deadline. Exposed as `lsp_directory_diagnostics` / `directory-diagnostics`.
- **NOT**: A whole-project type-check; results are per-file LSP Diagnostics, not a compiler run. Not part of file diagnostics (`timeoutMs` for a directory is rejected).
- **Related**: Timeout Budget, Source File List Cache, Diagnostic Summary, File Diagnostics, Workspace Runtime

### Apply Code Action

- **Definition**: Operation that applies a previously listed Code Action by its stable Code Action Handle: checks handle existence/expiry, re-reads the source document and compares its content fingerprint to the fingerprint captured at list time (changed → reject as stale), re-synchronizes the document with the Language Server, resolves a data-backed action if needed, then applies its WorkspaceEdit through the Workspace Edit pipeline and/or executes its command. Exposed as `lsp_apply_code_action` / `apply-code-action --id`.
- **NOT**: The list step (that's Code Action); the old `apply` index argument — handles are opaque and bounded by the Code Action Cache.
- **Related**: Code Action, Code Action Handle, Code Action Cache, Workspace Edit, Staleness

### Bridge Operation

- **Definition**: The canonical, transport-neutral operation union (`BridgeOperation`): `status`, `fileDiagnostics`, `directoryDiagnostics`, `definitionBySymbol`/`definitionAt`, `referencesBySymbol`/`referencesAt`, `symbols`, `hoverBySymbol`/`hoverAt`, `renameAt`, `listCodeActions`, `applyCodeAction`, `willRenameFiles`. Each variant carries typed, validated fields; positions and numeric options are positive integers.
- **NOT**: A transport message (`tools/call` params or CLI argv are transport syntax) or the request envelope (that's Bridge Request).
- **Related**: Bridge Request, Operation Decoder

### Bridge Request

- **Definition**: The canonical request envelope `{ root?, operation }` produced by both transport decoders (CLI `parseCliArgs`, MCP `tools/call` handler) and consumed by `executeOperation`. `root` is a workspace selector (optional override for detached worktrees / different workspace), never an argument of a specific operation.
- **NOT**: Transport-specific syntax; operation arguments live inside `operation`.
- **Related**: Bridge Operation, Workspace Root, Workspace Runtime

### Bridge Status

- **Definition**: The single health/configuration operation (`status` / `lsp_status` / `collectBridgeStatus`): resolved Bridge Config, per-language server availability and Language Server Workspace, executable resolution, seed-file availability, diagnostics configuration, Codex integration state, build freshness, and already-known runtime state. Status never starts all Language Servers just to answer.
- **NOT**: A diagnostics run over source code (that's Directory Diagnostics); the CLI `doctor` command, which was retired in favor of `status`.
- **Related**: Language Server, Support Level, Install Hint, Diagnostics Timeout Policy, Workspace Runtime

### Code Action Cache

- **Definition**: The bounded, runtime-owned store of raw Language Server Code Actions (`CodeActionCache` in `WorkspaceRuntime`): maps an opaque Code Action Handle to the provider instance, canonical source file, content fingerprint captured at list time, and the raw `Command | CodeAction`. Bounded/expiring so the runtime does not accumulate actions indefinitely; a handle is invalidated on apply.
- **NOT**: The provider's protocol cache or raw diagnostics store.
- **Related**: Code Action Handle, Apply Code Action, Workspace Runtime

### Code Action Handle

- **Definition**: Opaque identifier (`CodeActionHandle`) of a previously listed Code Action, bound to the Workspace Runtime, provider/language, canonical file, and the document content fingerprint at list time. Lets the agent apply an action by stable id instead of recomputing the list and picking by an unstable array index.
- **NOT**: An LSP protocol id; the `apply` index of the legacy contract.
- **Related**: Code Action, Apply Code Action, Code Action Cache

### File Diagnostics

- **Definition**: File-scoped diagnostics operation (`fileDiagnostics` / `lsp_diagnostics`): opens one document, waits up to `timeoutMs` for a fresh `publishDiagnostics` (Source Revision-based), and returns the Diagnostic Summary. `file` is required; `timeoutMs` is an optional positive integer defaulting to the Diagnostics Timeout Policy.
- **NOT**: Directory Diagnostics (a scan orchestration over many files); the retired no-target mode that listed whatever documents happen to be open.
- **Related**: Diagnostic Summary, Diagnostics Timeout Policy, Known Diagnostics, Directory Diagnostics

### Known Diagnostics

- **Definition**: Internal protocol-level state: the raw LSP diagnostics (with full ranges) the Bridge has already received via `textDocument/publishDiagnostics`, stored per canonical document by the Semantic Provider. It feeds two consumers: overlapping `CodeActionContext.diagnostics` for Code Actions and a future reactive Post-Tool Diagnostics (Known Diagnostics Snapshot/Delta). It deliberately does not extend the domain `Diagnostic` type.
- **NOT**: A workspace-wide check — it cannot mean *workspace clean*: only diagnostics the server already published, no re-scan of files. Not part of the public CLI/MCP contract.
- **Related**: File Diagnostics, Code Action, Post-Tool Diagnostics

### Known Diagnostics Delta

- **Definition**: Difference between two Known Diagnostics Snapshots; the future input for a long-lived-process Post-Tool Diagnostics hook (replacing per-file process spawn). Internal capability only, not a public operation.
- **Related**: Known Diagnostics Snapshot, Post-Tool Diagnostics

### Known Diagnostics Snapshot

- **Definition**: A point-in-time packet of Known Diagnostics for one file (`knownDiagnosticsSnapshot(filePath)`): the raw 0-based LSP diagnostics with full ranges. Used today for overlapping Code Action context; the basis of a reactive hook delta later.
- **Related**: Known Diagnostics, Code Action

### Language Server Workspace

- **Definition**: The directory inside the Workspace Root relative to which one Language Server runs (`workspacePath` in the language entry, default `"."`): its process cwd, LSP `rootUri`/`workspaceFolders`, Workspace Seed Files, and primary local-executable search base. Defaults to the Workspace Root but that is a default, not a domain invariant; enables nested frontend workspaces in monorepos. Still falls back to Workspace Root `node_modules/.bin` and PATH for the executable.
- **NOT**: The Bridge containment boundary (that stays the Workspace Root) or the Workspace Root itself (they may differ).
- **Related**: Workspace Root, Workspace Runtime, Workspace Seed Files

### Workspace Path Resolver

- **Definition**: Shared resolvers turning transport path input into a canonical absolute path inside the Workspace Root (`resolveWorkspaceFile`, `resolveWorkspaceDirectory`, `resolveWorkspaceTarget`): relative input resolves against the root, absolute input is allowed, existing targets are realpath-checked for symlink escapes, and the target for a not-yet-existing file (create/rename target) is validated by realpath of its nearest existing parent. Containment uses the Workspace Root, not `process.cwd()`.
- **NOT**: Path syntax parsing inside transports; the Workspace Edit pipeline still applies edits, but uses the same containment semantics.
- **Related**: Workspace Root, Workspace Edit

### Workspace Root Resolution

- **Definition**: Single shared resolver (`resolveWorkspaceRoot`): resolves relative input against `process.cwd()`, requires an existing directory, canonicalizes via `realpath`, and performs no project-marker checks (no `.git`/`package.json`/`tsconfig.json`/`Cargo.toml` heuristics and no warnings for their absence). An explicit `--root` is valid as an existing directory; accidental overly-broad roots are a separate future policy (e.g. `requireWorkspaceConfig`), not markers.
- **NOT**: Language Server discovery; default root selection in the composition layer (`--root` or `process.cwd()`).
- **Related**: Workspace Root, Workspace Runtime

### Workspace Runtime

- **Definition**: The root-scoped owner of live Bridge state (`WorkspaceRuntime`): one per Workspace Root; owns the merged Bridge Config, Language Registry, LSP Provider Registry, Workspace Command Service, Directory Diagnostics resources/cache, and the Code Action Cache, plus their lifecycle (`dispose`). Language Servers are still created lazily by the LSP Provider Registry. Created/reused by the composition layer per resolved Workspace Root.
- **NOT**: A dependency container for everything (the Workspace Command Service stays a language-routing façade); a separate `BridgeRuntime` beyond the root map is deliberately not introduced.
- **Related**: Workspace Root, Workspace Command Service, LSP Provider Registry, Directory Diagnostics, Code Action Cache

### Document Position

- **Definition**: A file path plus 1-based line and character; the input form of the `*At` query variants (`definitionAt`, `referencesAt`, `hoverAt`).
- **NOT**: An LSP protocol `Position` (0-based, no file) or a Location (a result, not an input).
- **Related**: Location, Definition, References, Hover

### File Rename Sync

- **Definition**: Process keeping language-server state consistent around a file rename performed by the agent: `workspace/willRenameFiles` before the move returns reference updates applied through the Workspace Edit pipeline; `workspace/didRenameFiles` (`notifyFilesRenamed`) after the move updates the server's file-system model. Exposed as the `lsp_will_rename_files` MCP tool; the physical file operation stays with the agent.
- **NOT**: A file rename tool — the bridge never moves files itself in the minimal version.
- **Related**: Workspace Edit, Semantic Provider

### Hover

- **Definition**: Query that returns type/signature information for a symbol name or a Document Position; exposed as the `lsp_hover` MCP tool.
- **NOT**: A definition jump (that's Definition).
- **Related**: Definition, Document Position, Hover Info

### Hover Info

- **Definition**: The result of a Hover query: file, line, character, and the `contents` string with type/signature information from the language server.
- **NOT**: The query itself (that's Hover); kept with the `Info` suffix by owner decision — LSP-idiomatic, mirrors how users phrase "hover info".
- **Related**: Hover, Location

### Install Hint

- **Definition**: The per-language command string telling the user how to install the Language Server (e.g. `npm install -g typescript-language-server typescript`); defaults to an instruction naming the descriptor's `command`.
- **Related**: Language Server, Bridge Status, Support Level, Language Descriptor

### Language Descriptor

- **Definition**: The complete record describing one language: `languageId`, `command`, `args`, `extensions`, `workspaceSeedFiles`, `installHint`, `supportLevel`. One format for the defaults layer and for user config layers; required after merging: `command` and `extensions`.
- **NOT**: A runtime server process config (that's `ServerProcessConfig`, built from a descriptor at provider creation) or a registry (that's Language Registry).
- **Related**: Language Registry, Default Language Servers, Bridge Config

### Language Registry

- **Definition**: The validator and access layer over merged Bridge Config language servers (`LanguageRegistry`): validates descriptors (required fields, no extension collisions), exposes `languages()` / `descriptor()` / `detectByExtension()` / `extensions()`. The single source of truth about languages at runtime.
- **NOT**: The merge mechanism (that's the Bridge Config cascade: defaults → global → workspace) or a provider cache (that's LSP Provider Registry).
- **Related**: Language Descriptor, Bridge Config, LSP Provider Registry, Supported Language

### Language Server

- **Definition**: An external LSP server process the Bridge talks to for one Supported Language (typescript-language-server, rust-analyzer, pyright-langserver, gopls); configured via `LanguageServerConfig` / `ServerProcessConfig`.
- **NOT**: The Bridge's own client side (that's LSP Client) or the semantic façade (that's Semantic Provider).
- **Related**: LSP Client, Semantic Provider, Supported Language, Language Descriptor

### LSP Client

- **Definition**: The JSON-RPC conversation partner that spawns and speaks LSP to one Language Server process (`LspClient` interface, `JsonRpcLspClient` implementation).
- **NOT**: The semantic façade the tools call (that's Semantic Provider).
- **Related**: Language Server, Semantic Provider

### Location

- **Definition**: A query result pointing at a file with 1-based line/character (and optional `Range`) where a definition or reference lives.
- **NOT**: A query input (that's Document Position).
- **Related**: Document Position, Definition, References, Symbol Match

### LSP Provider Registry

- **Definition**: The per-language factory and cache of SemanticProviders (`LspProviderRegistry`, `src/core/lsp-provider-registry.ts`): builds one `LspSemanticProvider` per Supported Language, returns the cached instance on every call (language servers are expensive to start), routes by file extension via `forFile` (through its Language Registry), and disposes all spawned servers. Implements `SemanticProviderRegistry`; built per workspace root from the merged Bridge Config.
- **NOT**: The semantic layer itself (that's Semantic Provider) or the raw JSON-RPC conversation (that's LSP Client).
- **Related**: Semantic Provider, Language Server, Language Registry, Supported Language

### Post-Tool Diagnostics

- **Definition**: The Codex `PostToolUse` hook (`codex-lsp-bridge post-tool-diagnostics`) that requests File Diagnostics for files touched by Write/Edit/apply_patch and feeds the result back to the agent. A future long-lived-process variant consumes Known Diagnostics Snapshot/Delta instead of spawning per file.
- **NOT**: Any manual diagnostics call (those go through the MCP tools / CLI); a workspace-wide check.
- **Related**: Diagnostic Summary, File Diagnostics, Known Diagnostics, Bridge

### References

- **Definition**: Query that lists all Locations referencing a symbol name or a Document Position; exposed as the `lsp_references` MCP tool.
- **Related**: Definition, Location, Document Position

### Semantic Provider

- **Definition**: The per-language service interface the Bridge exposes: diagnostics, definition, references, symbols, hover, symbol rename, code actions, file rename sync, and dispose (`SemanticProvider`, implemented by `LspSemanticProvider`; registered per language via `SemanticProviderRegistry`).
- **NOT**: The raw JSON-RPC client (that's LSP Client) or the per-call façade (Command Service).
- **Related**: LSP Client, Language Server, Workspace Seed Files, Workspace Root, Workspace Edit

### Server Request

- **Definition**: A JSON-RPC request from the language server to the bridge (server → bridge direction), e.g. `workspace/applyEdit`, `workspace/configuration`, `client/registerCapability`. The bridge must answer every server request; unanswered ones hang the server. Server-initiated `workspace/applyEdit` is routed into the same Workspace Edit pipeline as tool-initiated edits.
- **NOT**: A bridge-to-server request (that's the ordinary client request path).
- **Related**: LSP Client, Workspace Edit

### Severity

- **Definition**: The diagnostic level: `error`, `warning`, `information`, or `hint` (mapped from LSP numeric severities by `lspSeverityToText`).
- **Related**: Diagnostic, Diagnostic Summary

### Source File List Cache

- **Definition**: A short-TTL cache (`directory.sourceFileListCache`, ~5 s) of the file listing used by Directory Diagnostics; owned by the Workspace Runtime. A scan-performance hint only — diagnostic contents still come from LSP calls.
- **NOT**: A cache of diagnostic results.
- **Related**: Directory Diagnostics, Workspace Runtime

### Source Revision

- **Definition**: The monotonic per-document counter bumped on each `textDocument/publishDiagnostics` notification; lets the Bridge tell "fresh result for this edit" from "result from before the edit".
- **Related**: Staleness, Diagnostic Report

### Staleness

- **Definition**: The `stale` flag: a diagnostics request timed out AND the latest Source Revision predates the request — the answer is known to be outdated.
- **NOT**: A timeout itself (timed-out but possibly fresh), and NOT an error; stale/inconclusive results must be reported as pending/unknown, never as clean.
- **Related**: Source Revision, Diagnostic Conclusion, Diagnostic Status

### Supported Language

- **Definition**: Any language name present in the Language Registry — from the Default Language Servers layer or added by a config layer (`SupportedLanguage`, now an alias for string). Detected from file extension via the registry.
- **NOT**: A closed hardcoded list; the union of four language names is dead.
- **Related**: Language Registry, Default Language Servers, Support Level

### Support Level

- **Definition**: Per-language maturity marker: `primary` or `experimental` (default `experimental`). There is deliberately no `custom` value — built-in and user-added languages are indistinguishable.
- **NOT**: A distinction between default and user languages (that distinction does not exist).
- **Related**: Supported Language, Language Descriptor

### Symbol Match

- **Definition**: One result of a Symbols query: a Location enriched with the symbol's `name`, optional `kind`, and `containerName`.
- **NOT**: A raw LSP protocol symbol (internal `LspSymbol`) or the symbol-name resolution step (`resolveSingleSymbol`).
- **Related**: Symbols, Location

### Symbol Rename

- **Definition**: Command renaming a symbol at a Document Position across the workspace via `textDocument/prepareRename` (when supported) → `textDocument/rename` → Workspace Edit pipeline; exposed as the `lsp_rename` MCP tool. The result reports the old symbol, new name, changed files, and edit count.
- **NOT**: A text search-and-replace; the language server computes every occurrence. The agent never applies the returned edit manually.
- **Related**: Workspace Edit, Document Position, References

### Symbols

- **Definition**: Query that searches workspace symbols by name via `workspace/symbol`; exposed as the `lsp_symbols` MCP tool, returning Symbol Matches.
- **Related**: Symbol Match, Definition, References

### Timeout Budget

- **Definition**: The wall-clock scheduling ceiling of a Directory Diagnostics scan (`timeoutBudgetMs`, default 15000 ms): after exhaustion, no new file diagnostics are scheduled, but already-running requests may complete — so it is not a hard cancellation deadline. `concurrency` bounds parallel file requests; directory-only — rejected on file diagnostics. Defaults live in `BridgeConfig.directoryDiagnostics`.
- **NOT**: The per-file wait (that's Diagnostics Timeout Policy, `timeoutMs`).
- **Related**: Directory Diagnostics, Diagnostics Timeout Policy, Bridge Config

### Workspace Command Service

- **Definition**: The language-routing Command Service (`WorkspaceCommandService`): holds a `SemanticProviderRegistry` (LSP Provider Registry), the default language from Bridge Config, and the Code Action Cache; picks the provider per call — by the `file` argument when present, otherwise the default language (or an explicit symbol-operation language override). The layer every MCP tool, CLI command, and the post-tool-diagnostics hook ultimately calls; it owns Code Action list/apply handle orchestration.
- **NOT**: A registry itself (it delegates provider lookup); created per Workspace Root by the Workspace Runtime.
- **Related**: Command Service, LSP Provider Registry, Bridge Config, Workspace Runtime, Code Action Cache

### Workspace Edit

- **Definition**: The only carrier of changes in the bridge: an edit structure returned by a language server (`changes` / `documentChanges` with TextDocumentEdit, CreateFile, RenameFile, DeleteFile), normalized to absolute paths, validated (inside Workspace Root, non-overlapping ranges, version match), previewed, and applied by the single `applyWorkspaceEdit` pipeline (`src/core/workspace-edit.ts`).
- **NOT**: An MCP tool — never exposed to the agent; agent-side manual reproduction of a returned edit is forbidden by the safety contract.
- **Related**: Symbol Rename, Code Action, File Rename Sync, Server Request, Workspace Root

### Workspace Root

- **Definition**: The canonical file boundary of one Bridge workspace (`rootPath` / `root`): an existing directory canonicalized via `realpath`. It defines where the workspace-level Bridge Config lives (`<root>/.codex/lsp-bridge.json`), the containment boundary for file access and Workspace Edits, and the key of one Workspace Runtime. Workspace Root is **not** determined by project markers (.git/package.json/tsconfig.json/Cargo.toml) and is **not** obliged to equal the Language Server Workspace, the LSP `rootUri`, `workspaceFolders`, or `node_modules/.bin` location. The default root is `--root` or `process.cwd()`; per-request `root` remains an optional workspace selector.
- **NOT**: The current working directory; a Language Server runtime root (that's Language Server Workspace).
- **Related**: Workspace Root Resolution, Workspace Runtime, Language Server Workspace, Semantic Provider

### Workspace Seed Files

- **Definition**: The conventional entry files per language (e.g. `src/index.ts`, `src/main.rs`) the provider opens first so a freshly started Language Server indexes the project instead of an empty document. Contractually relative paths inside the Language Server Workspace (absolute paths and `..` escapes are rejected at config validation) — in a monorepo they resolve against the language's workspace, not the Workspace Root.
- **Related**: Semantic Provider, Language Server, Language Server Workspace

## Forbidden

> Words that MUST NOT appear in domain-layer names: implementation details, weasel
> words, bundle-collapse terms. `use:` always points at an Index Identifier.

- `Manager` use: `LspProviderRegistry` — vague, hides responsibility; the only occurrence (`LspManager`) was renamed

## Legacy

> Names still present in the codebase but deprecated. New code MUST use the name after
> `→`. `A + B` = the old name was split; `→ —` = retired with no single successor.

- `LspManager` → `LspProviderRegistry` in: git history, docs predating the rename — renamed 2025, decision recorded in `docs/THESAURUS.md`
- `LspClientConfig` → `BridgeConfig` in: git history — type renamed; the config FILE also renamed to `lsp-bridge.json`
- `LanguageServerOverride` → `LanguageDescriptor` in: git history — config entries are partial descriptors merged field by field over the defaults layer; the override type was absorbed by the descriptor format
- `Doctor` → `BridgeStatus` in: CLI `doctor` command and `runDoctor` — retired in the transport-unification refactor; `status` (`collectBridgeStatus`) is the single health/configuration operation
- Code Action `apply` index → `CodeActionHandle` in: `lsp_code_actions` apply argument, CLI `--apply` — retired; apply is a separate `applyCodeAction` operation by stable handle

## Unresolved

> Naming ambiguities, contradictions, and open questions. Each needs a human decision
> before the name can enter the Index. Resolve top-down by impact.

(none — all four initial items resolved by the owner on 2025: `CommandService`/`WorkspaceCommandService` and `HoverInfo` kept as canonical; `LspManager` → `LspProviderRegistry`; `LspClientConfig` → `BridgeConfig`. The file `lsp-client.json` renamed to `lsp-bridge.json`)
