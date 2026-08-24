---
name: lsp
description: Use codex-lsp-bridge for semantic diagnostics, navigation, hover, validated LSP edits, and status checks.
---

# codex-lsp-bridge

Use `codex-lsp-bridge` for semantic navigation, diagnostics, and language-server-defined edits.

## Core rules

- Use `lsp_definition`, `lsp_references`, `lsp_hover`, and `lsp_symbols` for semantic navigation.
- Use `lsp_diagnostics` to inspect language-server diagnostics.
- Use `lsp_rename` for symbol renames.
- Use `lsp_code_actions` for quick fixes and refactors.
- Use `lsp_will_rename_files` before moving or renaming supported source files when references may need updating.
- Apply semantic edits only through bridge-validated `WorkspaceEdit` values. Do not reproduce or apply returned edits manually.
- After every semantic write, run `lsp_diagnostics` for the affected supported files.
- Treat timed out or stale diagnostics as inconclusive.

## Symbol rename

For symbol renames:

1. Call `lsp_rename` at the symbol occurrence with the new name.
2. Let the bridge validate and apply the returned `WorkspaceEdit`.
3. Run `lsp_diagnostics` on affected files.

Do not replace symbol references manually when `lsp_rename` is available.

## Code actions

For quick fixes and refactors:

1. Call `lsp_code_actions` for the narrowest relevant file and range.
2. Select the language-server-provided action that matches the intended change.
3. Let the bridge resolve and apply the action.
4. Run `lsp_diagnostics` on affected files.

Prefer language-server code actions over manually reproducing the same refactor or fix.

## File rename or move

For source-file moves or renames:

1. Call `lsp_will_rename_files(old_path, new_path)`.
2. Let the bridge validate and apply the returned `WorkspaceEdit`.
3. Perform the physical file move or rename.
4. Notify the language server with `workspace/didRenameFiles` when supported.
5. Run `lsp_diagnostics` on affected files.

`lsp_will_rename_files` updates semantic references; it does not move the file.

## WorkspaceEdit

The bridge must validate and apply all language-server edits.

Required handling:

- `WorkspaceEdit.changes`;
- `WorkspaceEdit.documentChanges`;
- `TextDocumentEdit`;
- `CreateFile`, `RenameFile`, and `DeleteFile` when returned;
- negotiated LSP position encoding;
- multiple edits in one file without offset drift;
- overlapping-edit rejection;
- document versions when supplied;
- normalized workspace paths;
- rejection of edits outside the workspace root;
- multi-file edits without silent partial application;
- synchronization of changed documents and files with the language server.

Codex must not bypass this pipeline by applying LSP edits manually.

## Diagnostics

- Prefer file diagnostics over broad directory scans.
- During code review, audit, or investigation, run `lsp_diagnostics` for changed supported files or the smallest representative set before final findings.
- For large TypeScript workspaces, use file diagnostics `timeoutMs` when needed.
- For directory diagnostics, bound `maxFiles`, `timeoutBudgetMs`, and `concurrency`.
- Report `directory.truncated` and `directory.budgetTimedOut` when present.
- Treat `status: "timed_out"` and `conclusion: "inconclusive"` as unknown, not clean.
- Treat `conclusion: "diagnostics_clean"` as no diagnostics returned for that request, not as a full project check.
- Use repository-native checks when the task requires broader verification.

## Workspace selection

- Prefer file-position inputs for `lsp_definition`, `lsp_references`, and `lsp_hover` when the exact occurrence is known.
- Pass `root` when the intended workspace cannot be inferred reliably from the file path.
- Use `lsp_status` when language-server availability, workspace selection, or hook state is unclear.
- If LSP is unavailable, use the narrowest repository-native alternative.
