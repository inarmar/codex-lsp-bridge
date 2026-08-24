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
> (https://github.com/CodeAlive-AI/ai-driven-development/tree/main/skills/ubiquitous-language).
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
- **Command Service** `CommandService` kind:service
- **Code Action** `CodeAction` kind:command
- **Default Language Servers** `defaultLanguageServers` kind:value
- **Definition** `Definition` kind:query
- **Diagnostic** `Diagnostic` kind:value
- **Diagnostic Conclusion** `DiagnosticConclusion` kind:state avoid: `verdict`
- **Diagnostic Report** `DiagnosticReport` kind:value avoid: `DiagnosticResult`
- **Diagnostic Status** `DiagnosticStatus` kind:state
- **Diagnostic Summary** `DiagnosticSummary` kind:value
- **Diagnostics Timeout Policy** `DiagnosticsTimeoutPolicy` kind:value avoid: `timeoutBudget` (that is Directory Diagnostics)
- **Directory Diagnostics** `DirectoryDiagnostics` kind:query avoid: `directoryScan`
- **Doctor** `Doctor` kind:service avoid: `HealthCheck`
- **Document Position** `DocumentPosition` kind:value
- **File Rename Sync** `FileRenameSync` kind:process
- **Hover** `Hover` kind:query
- **Hover Info** `HoverInfo` kind:value avoid: `HoverResult`
- **Install Hint** `InstallHint` kind:concept
- **Language Descriptor** `LanguageDescriptor` kind:value
- **Language Registry** `LanguageRegistry` kind:service
- **Language Server** `LanguageServer` kind:concept avoid: `LanguageServerConfig` (that is its config type), `Lsp`
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
- **Workspace Root** `WorkspaceRoot` kind:concept avoid: `projectRoot`
- **Workspace Seed Files** `WorkspaceSeedFiles` kind:concept

## Terms

### Bridge

- **Definition**: The semantic layer between Codex CLI and local language servers; the product itself (`codex-lsp-bridge`, npm package, MCP server). Reads are unlimited; edits happen only through language-server-defined, bridge-validated Workspace Edits.
- **NOT**: A general-purpose LSP proxy or an editor plugin; it never applies an edit the language server did not return.
- **Related**: Semantic Provider, Workspace Edit, Post-Tool Diagnostics, Doctor

### Bridge Config

- **Definition**: The user-facing configuration of the whole Bridge, loaded from `~/.codex/lsp-client.json` and `<workspace>/.codex/lsp-client.json` (workspace wins): `defaultLanguage`, `diagnosticsTimeoutMs`, `hook` options, and `languageServers` — per-language entries merged field by field over the Default Language Servers layer (defaults → global → workspace). The config file keeps its historical name `lsp-client.json`.
- **NOT**: A language-server descriptor (that's Language Server via `LanguageServerConfig`) or a spawn recipe (`ServerProcessConfig`).
- **Related**: Language Descriptor, Default Language Servers, Diagnostics Timeout Policy, Supported Language

### Command Service

- **Definition**: The validated facade over one SemanticProvider: each method (`diagnostics`, `definition`, `references`, `symbols`, `hover`, `rename`, `codeActions`, `willRenameFiles`, and their `*At` variants) validates inputs (non-empty symbol, 1-based line/character) and delegates to the provider. Despite the name, all methods are queries or validated edit commands — "Command" refers to the CLI/MCP tool surface this layer serves.
- **NOT**: A write-model command bus or an aggregate command handler; nothing here mutates source files directly — edits flow through Workspace Edit.
- **Related**: Semantic Provider, Workspace Command Service, Workspace Edit

### Code Action

- **Definition**: Command listing and applying language-server code actions (quickfixes, refactors, source actions) for a file range; exposed as the `lsp_code_actions` MCP tool. Two modes: list (returns indexed actions) and apply by index. Command-only actions are executed through an internal `workspace/executeCommand`; the edit itself always flows through the Workspace Edit pipeline.
- **NOT**: A free-form code generation tool; the bridge applies only what the language server returns. `workspace/executeCommand` is never exposed to the agent as a tool.
- **Related**: Workspace Edit, Server Request

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

- **Definition**: How long file diagnostics wait for fresh results: a fixed number of milliseconds or `"auto"` (derived from workspace hints such as monorepo markers, tsconfig references, and sampled source-file count); surfaces as `timeoutMs` / `diagnosticsTimeoutMs`.
- **NOT**: The wall-clock budget of a directory scan (that's Timeout Budget — passing `timeoutBudgetMs` for file diagnostics is rejected).
- **Related**: Timeout Budget, Directory Diagnostics

### Directory Diagnostics

- **Definition**: A bounded recursive scan that runs file Diagnostics over a directory's source files with `maxFiles`, `concurrency`, a Timeout Budget, and `truncated` / `budgetTimedOut` markers; invoked via the `dir` argument of `lsp_diagnostics`.
- **NOT**: A whole-project type-check; results are per-file LSP Diagnostics, not a compiler run.
- **Related**: Timeout Budget, Source File List Cache, Diagnostic Summary

### Doctor

- **Definition**: The environment health-check (`codex-lsp-bridge doctor`, `runDoctor`) that reports per-language server availability, Codex MCP/hook/instructions wiring, build freshness, and the resolved diagnostics timeout.
- **NOT**: A diagnostic run over source code (that's Directory Diagnostics).
- **Related**: Language Server, Support Level, Install Hint, Diagnostics Timeout Policy

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
- **Related**: Language Server, Doctor, Support Level, Language Descriptor

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

- **Definition**: The Codex `PostToolUse` hook (`codex-lsp-bridge post-tool-diagnostics`) that requests Diagnostics for files touched by Write/Edit/apply_patch and feeds the result back to the agent.
- **NOT**: Any manual diagnostics call (those go through the MCP tools / CLI).
- **Related**: Diagnostic Summary, Bridge

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

- **Definition**: A short-TTL cache (`directory.sourceFileListCache`, ~5 s) of the file listing used by Directory Diagnostics; a scan-performance hint only — diagnostic contents still come from LSP calls.
- **NOT**: A cache of diagnostic results.
- **Related**: Directory Diagnostics

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

- **Definition**: The wall-clock ceiling of a Directory Diagnostics scan (`timeoutBudgetMs`, default 15000 ms), with `concurrency` bounding parallel file requests; directory-only — rejected on file diagnostics.
- **NOT**: The per-file wait (that's Diagnostics Timeout Policy, `timeoutMs`).
- **Related**: Directory Diagnostics, Diagnostics Timeout Policy

### Workspace Command Service

- **Definition**: The language-routing Command Service (`WorkspaceCommandService`): holds a `SemanticProviderRegistry` (LSP Provider Registry) plus a default language from Bridge Config, and picks the provider per call — by the `uri`/`file` argument when present, otherwise the default language. The layer every MCP tool, CLI command, and the post-tool-diagnostics hook ultimately calls.
- **NOT**: A registry itself (it delegates provider lookup); the CLI entry point composes one per workspace root.
- **Related**: Command Service, LSP Provider Registry, Bridge Config

### Workspace Edit

- **Definition**: The only carrier of changes in the bridge: an edit structure returned by a language server (`changes` / `documentChanges` with TextDocumentEdit, CreateFile, RenameFile, DeleteFile), normalized to absolute paths, validated (inside Workspace Root, non-overlapping ranges, version match), previewed, and applied by the single `applyWorkspaceEdit` pipeline (`src/core/workspace-edit.ts`).
- **NOT**: An MCP tool — never exposed to the agent; agent-side manual reproduction of a returned edit is forbidden by the safety contract.
- **Related**: Symbol Rename, Code Action, File Rename Sync, Server Request, Workspace Root

### Workspace Root

- **Definition**: The containment boundary of every query (`rootPath` / `root`): all file access stays inside it, results outside are not returned; for detached worktrees the caller must pass the real workspace root.
- **NOT**: The current working directory; must be a real workspace (`.git`, `package.json`, or `tsconfig.json`).
- **Related**: Semantic Provider, Directory Diagnostics

### Workspace Seed Files

- **Definition**: The conventional entry files per language (e.g. `src/index.ts`, `src/main.rs`) the provider opens first so a freshly started Language Server indexes the project instead of an empty document.
- **Related**: Semantic Provider, Language Server

## Forbidden

> Words that MUST NOT appear in domain-layer names: implementation details, weasel
> words, bundle-collapse terms. `use:` always points at an Index Identifier.

- `Manager` use: `LspProviderRegistry` — vague, hides responsibility; the only occurrence (`LspManager`) was renamed

## Legacy

> Names still present in the codebase but deprecated. New code MUST use the name after
> `→`. `A + B` = the old name was split; `→ —` = retired with no single successor.

- `LspManager` → `LspProviderRegistry` in: git history, docs predating the rename — renamed 2025, decision recorded in `docs/THESAURUS.md`
- `LspClientConfig` → `BridgeConfig` in: git history — type renamed; the config FILE keeps its historical name `lsp-client.json` (renaming it is breaking for existing installs)
- `LanguageServerOverride` → `LanguageDescriptor` in: git history — config entries are partial descriptors merged field by field over the defaults layer; the override type was absorbed by the descriptor format

## Unresolved

> Naming ambiguities, contradictions, and open questions. Each needs a human decision
> before the name can enter the Index. Resolve top-down by impact.

(none — all four initial items resolved by the owner on 2025: `CommandService`/`WorkspaceCommandService` and `HoverInfo` kept as canonical; `LspManager` → `LspProviderRegistry`; `LspClientConfig` → `BridgeConfig`, file name `lsp-client.json` unchanged. The file rename `lsp-client.json` → e.g. `codex-lsp-bridge.json` was deferred — revisit on the next major version if the "config for a client" wording keeps confusing.)
