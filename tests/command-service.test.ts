import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CommandService, WorkspaceCommandService } from "../src/core/command-service.js";
import type { ApplyCodeActionRequest, CodeActionListReport, DiagnosticReport, FileRenameSummary, HoverInfo, KnownDiagnosticsSnapshot, Location, RenameSummary, SemanticProvider, SymbolMatch } from "../src/core/types.js";

class FakeProvider implements SemanticProvider {
  constructor(private readonly label = "src") {}

  diagnostics(file: string): Promise<DiagnosticReport> {
    return Promise.resolve({
      status: "ok",
      timedOut: false,
      stale: false,
      sourceRevision: 1,
      items: [
        {
          file: `${this.label}/editor/store.ts`,
          line: 182,
          character: 7,
          severity: "error",
          message: "Property 'id' does not exist on type"
        }
      ]
    });
  }

  knownDiagnosticsSnapshot(filePath: string): Promise<KnownDiagnosticsSnapshot> {
    return Promise.resolve({ filePath, diagnostics: [] });
  }

  definition(symbol: string): Promise<Location> {
    return Promise.resolve({ file: `${this.label}/${symbol}.ts`, line: 24, character: 1 });
  }

  definitionAt(): Promise<Location> {
    return Promise.resolve({ file: "src/position.ts", line: 2, character: 3 });
  }

  references(): Promise<Location[]> {
    return Promise.resolve([{ file: "src/pages/home.tsx", line: 44, character: 9 }]);
  }

  referencesAt(): Promise<Location[]> {
    return Promise.resolve([{ file: "src/position.ts", line: 2, character: 3 }]);
  }

  symbols(query: string): Promise<SymbolMatch[]> {
    return Promise.resolve([{ name: query, file: "src/editor.ts", line: 1, character: 1 }]);
  }

  hover(symbol: string): Promise<HoverInfo> {
    return Promise.resolve({ file: "src/editor.ts", line: 1, character: 1, contents: `type ${symbol} = string` });
  }

  hoverAt(): Promise<HoverInfo> {
    return Promise.resolve({ file: "src/position.ts", line: 2, character: 3, contents: "position hover" });
  }

  rename(_position: { file: string; line: number; character: number }, newName: string): Promise<RenameSummary> {
    return Promise.resolve({
      newName,
      changedFiles: ["src/editor.ts"],
      createdFiles: [],
      renamedFiles: [],
      deletedFiles: [],
      editCount: 1
    });
  }

  listCodeActions(file: string, _range: { start: { line: number; character: number }; end: { line: number; character: number } }, _only?: string[]): Promise<CodeActionListReport> {
    return Promise.resolve({
      candidates: [
        { title: "Fix", raw: { title: "Fix", command: { title: "Fix", command: "fix" } }, hasEdit: false, hasCommand: true }
      ]
    });
  }

  applyCodeAction(request: ApplyCodeActionRequest): Promise<{ title: string; changedFiles: string[]; createdFiles: string[]; renamedFiles: { from: string; to: string }[]; deletedFiles: string[]; editCount: number; commandExecuted: boolean }> {
    return Promise.resolve({
      title: "Fix",
      changedFiles: [request.file],
      createdFiles: [],
      renamedFiles: [],
      deletedFiles: [],
      editCount: 0,
      commandExecuted: true
    });
  }

  willRenameFiles(oldPath: string, newPath: string, renamed = false): Promise<FileRenameSummary> {
    return Promise.resolve({ oldPath, newPath, renamed, changedFiles: [], createdFiles: [], renamedFiles: [], deletedFiles: [], editCount: 0 });
  }

  notifyFilesRenamed(oldPath: string, newPath: string): Promise<FileRenameSummary> {
    return this.willRenameFiles(oldPath, newPath).then((result) => ({ ...result, renamed: true, renamedFiles: [{ from: oldPath, to: newPath }] }));
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeRegistry {
  readonly defaultProvider = new FakeProvider("typescript");
  readonly fileProvider = new FakeProvider("file");
  readonly files: string[] = [];

  forLanguage() {
    return this.defaultProvider;
  }

  forFile(filePath: string) {
    this.files.push(filePath);
    return this.fileProvider;
  }
}

describe("CommandService", () => {
  it("returns compressed diagnostic summaries", async () => {
    const service = new CommandService(new FakeProvider());

    await expect(service.diagnostics("src/editor/store.ts")).resolves.toMatchObject({
      total: 1,
      summary: ["1. ERROR src/editor/store.ts:182:7 Property 'id' does not exist on type"]
    });
  });

  it("rejects empty symbol commands at the command boundary", async () => {
    const service = new CommandService(new FakeProvider());

    await expect(service.definition(" ")).rejects.toThrow("symbol is required");
    await expect(service.symbols("")).rejects.toThrow("query is required");
    await expect(service.definitionAt({ file: "", line: 1, character: 1 })).rejects.toThrow("file is required");
    await expect(service.definitionAt({ file: "src/a.ts", line: 0, character: 1 })).rejects.toThrow(
      "line must be a positive integer"
    );
  });

  it("delegates read-only semantic commands to the provider", async () => {
    const service = new CommandService(new FakeProvider());

    await expect(service.definition("useEditorStore")).resolves.toMatchObject({
      file: "src/useEditorStore.ts",
      line: 24
    });
    await expect(service.references("ProductCard")).resolves.toHaveLength(1);
    await expect(service.definitionAt({ file: "src/index.ts", line: 2, character: 10 })).resolves.toMatchObject({
      file: "src/position.ts"
    });
    await expect(service.referencesAt({ file: "src/index.ts", line: 2, character: 10 })).resolves.toHaveLength(1);
    await expect(service.symbols("Editor")).resolves.toMatchObject([{ name: "Editor" }]);
    await expect(service.hover("EditorState")).resolves.toMatchObject({ contents: "type EditorState = string" });
    await expect(service.hoverAt({ file: "src/index.ts", line: 2, character: 10 })).resolves.toMatchObject({
      contents: "position hover"
    });
  });

  it("lists code actions by stable handle and applies them", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-cmd-"));
    const filePath = path.join(dir, "editor.ts");
    await fs.writeFile(filePath, "export const x = 1;\n", "utf8");
    const service = new CommandService(new FakeProvider());

    const listed = await service.listCodeActions(
      filePath,
      { start: { line: 1, character: 1 }, end: { line: 1, character: 1 } },
      ["quickfix"]
    );
    expect(listed).toEqual([
      expect.objectContaining({ title: "Fix", id: expect.stringMatching(/^ca-\d+$/) })
    ]);
    await expect(service.applyCodeAction(listed[0].id)).resolves.toMatchObject({
      title: "Fix",
      commandExecuted: true
    });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rejects reusing an applied handle", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-cmd-"));
    const filePath = path.join(dir, "editor.ts");
    await fs.writeFile(filePath, "export const x = 1;\n", "utf8");
    const service = new CommandService(new FakeProvider());

    const listed = await service.listCodeActions(filePath, { start: { line: 1, character: 1 }, end: { line: 1, character: 1 } });
    await service.applyCodeAction(listed[0].id);
    await expect(service.applyCodeAction(listed[0].id)).rejects.toThrow("unknown or expired");
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("WorkspaceCommandService", () => {
  it("uses file-specific providers for file-position operations", async () => {
    const registry = new FakeRegistry();
    const service = new WorkspaceCommandService(registry, "typescript");

    await expect(service.diagnostics("cmd/server/main.go")).resolves.toMatchObject({
      items: [expect.objectContaining({ file: "file/editor/store.ts" })]
    });
    await expect(service.definitionAt({ file: "cmd/server/main.go", line: 1, character: 1 })).resolves.toMatchObject({
      file: "src/position.ts"
    });
    await expect(service.referencesAt({ file: "cmd/server/main.go", line: 1, character: 1 })).resolves.toHaveLength(1);
    await expect(service.hoverAt({ file: "cmd/server/main.go", line: 1, character: 1 })).resolves.toMatchObject({
      contents: "position hover"
    });
    expect(registry.files).toEqual(expect.arrayContaining([expect.stringContaining("cmd/server/main.go")]));
  });

  it("uses the default language provider for symbol-only operations", async () => {
    const registry = new FakeRegistry();
    const service = new WorkspaceCommandService(registry, "typescript");

    await expect(service.definition("Editor")).resolves.toMatchObject({ file: "typescript/Editor.ts" });
    await expect(service.references("Editor")).resolves.toHaveLength(1);
    await expect(service.symbols("Editor")).resolves.toMatchObject([{ name: "Editor" }]);
    await expect(service.hover("Editor")).resolves.toMatchObject({ contents: "type Editor = string" });
    expect(registry.files).toEqual([]);
  });

  it("honors an explicit language override for symbol-only operations", async () => {
    const registry = new FakeRegistry();
    const service = new WorkspaceCommandService(registry, "typescript");

    await expect(service.definition("Editor", "rust")).resolves.toMatchObject({ file: "typescript/Editor.ts" });
    await expect(service.symbols("Editor", "go")).resolves.toMatchObject([{ name: "Editor" }]);
  });

  it("keeps handles stable across list and apply", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-cmd-"));
    const filePath = path.join(dir, "main.go");
    await fs.writeFile(filePath, "package main\n", "utf8");
    const registry = new FakeRegistry();
    const service = new WorkspaceCommandService(registry, "typescript");

    const listed = await service.listCodeActions(
      filePath,
      { start: { line: 1, character: 1 }, end: { line: 1, character: 1 } }
    );
    await expect(service.applyCodeAction(listed[0].id)).resolves.toMatchObject({ title: "Fix" });
    await fs.rm(dir, { recursive: true, force: true });
  });
});