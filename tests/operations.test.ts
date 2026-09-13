import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  decodeApplyCodeAction,
  decodeDefinition,
  decodeDirectoryDiagnostics,
  decodeFileDiagnostics,
  decodeListCodeActions,
  decodeRename,
  decodeWillRenameFiles,
  executeOperation,
  OperationParseError
} from "../src/core/operations.js";
import { WorkspaceCommandService } from "../src/core/command-service.js";
import { DirectoryDiagnostics } from "../src/core/directory-diagnostics.js";
import { WorkspaceRuntime } from "../src/core/workspace-runtime.js";
import { LanguageRegistry } from "../src/adapters/language-registry.js";
import { defaultLanguageServers } from "../src/adapters/default-language-servers.js";
import type { ApplyCodeActionRequest, CodeActionListReport, DiagnosticReport, FileRenameSummary, HoverInfo, KnownDiagnosticsSnapshot, Location, RenameSummary, SemanticProvider, SymbolMatch } from "../src/core/types.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function fakeProvider(label: string): SemanticProvider {
  return {
    diagnostics(file: string): Promise<DiagnosticReport> {
      return Promise.resolve({
        status: "ok",
        timedOut: false,
        stale: false,
        sourceRevision: 1,
        items:
          label === "default"
            ? []
            : [{ file: `${label}/editor.ts`, line: 1, character: 1, severity: "error", message: `${label} diagnostic` }]
      });
    },
    knownDiagnosticsSnapshot(filePath: string): Promise<KnownDiagnosticsSnapshot> {
      return Promise.resolve({ filePath, diagnostics: [] });
    },
    definition(symbol: string): Promise<Location> {
      return Promise.resolve({ file: `${label}/${symbol}.ts`, line: 1, character: 1 });
    },
    definitionAt(): Promise<Location> {
      return Promise.resolve({ file: `${label}/position.ts`, line: 2, character: 3 });
    },
    references(): Promise<Location[]> {
      return Promise.resolve([]);
    },
    referencesAt(): Promise<Location[]> {
      return Promise.resolve([{ file: `${label}/position.ts`, line: 2, character: 3 }]);
    },
    symbols(query: string): Promise<SymbolMatch[]> {
      return Promise.resolve([{ name: query, file: `${label}/editor.ts`, line: 1, character: 1 }]);
    },
    hover(symbol: string): Promise<HoverInfo> {
      return Promise.resolve({ file: `${label}/editor.ts`, line: 1, character: 1, contents: `type ${symbol}` });
    },
    hoverAt(): Promise<HoverInfo> {
      return Promise.resolve({ file: `${label}/position.ts`, line: 2, character: 3, contents: "hover" });
    },
    rename(_position: { file: string; line: number; character: number }, newName: string): Promise<RenameSummary> {
      return Promise.resolve({ newName, changedFiles: [], createdFiles: [], renamedFiles: [], deletedFiles: [], editCount: 0 });
    },
    listCodeActions(): Promise<CodeActionListReport> {
      return Promise.resolve({ candidates: [] });
    },
    applyCodeAction(request: ApplyCodeActionRequest): Promise<{ title: string; changedFiles: string[]; createdFiles: string[]; renamedFiles: { from: string; to: string }[]; deletedFiles: string[]; editCount: number; commandExecuted: boolean }> {
      return Promise.resolve({
        title: "Fix",
        changedFiles: [request.file],
        createdFiles: [],
        renamedFiles: [],
        deletedFiles: [],
        editCount: 1,
        commandExecuted: false
      });
    },
    willRenameFiles(oldPath: string, newPath: string, renamed = false): Promise<FileRenameSummary> {
      return Promise.resolve({ oldPath, newPath, renamed, changedFiles: [], createdFiles: [], renamedFiles: [], deletedFiles: [], editCount: 0 });
    },
    notifyFilesRenamed(oldPath: string, newPath: string): Promise<FileRenameSummary> {
      return this.willRenameFiles(oldPath, newPath).then((result) => ({ ...result, renamed: true, renamedFiles: [{ from: oldPath, to: newPath }] }));
    },
    dispose(): Promise<void> {
      return Promise.resolve();
    }
  };
}

class FakeRegistry {
  readonly requestedLanguages: string[] = [];
  readonly requestedFiles: string[] = [];
  readonly seenDiagnostics: Array<{ file: string; timeoutMs?: number }> = [];

  forLanguage(language: string): SemanticProvider {
    this.requestedLanguages.push(language);
    return fakeProvider(language === "rust" ? "rust" : "default");
  }

  forFile(filePath: string): SemanticProvider {
    this.requestedFiles.push(filePath);
    const provider = fakeProvider("default");
    return {
      ...provider,
      diagnostics: (file: string, options?: { timeoutMs?: number }) => {
        this.seenDiagnostics.push({ file, timeoutMs: options?.timeoutMs });
        return provider.diagnostics(file, options);
      }
    };
  }
}

async function makeRuntime(): Promise<{ runtime: WorkspaceRuntime; registry: FakeRegistry }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-ops-"));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n", "utf8");

  const registry = new FakeRegistry();
  const config = undefined; // defaults
  const languageRegistry = LanguageRegistry.fromLanguageServers(defaultLanguageServers);
  const commands = new WorkspaceCommandService(registry, "typescript");
  const directoryDiagnostics = new DirectoryDiagnostics(commands, languageRegistry);
  const runtime = await WorkspaceRuntime.create(root, {
    config,
    commands,
    directoryDiagnostics
  });
  return { runtime, registry };
}

describe("canonical operation decoders", () => {
  it("enforces positive integers and required fields", () => {
    expect(() => decodeFileDiagnostics({ file: "src/a.ts", timeoutMs: -1 })).toThrow(OperationParseError);
    expect(() => decodeFileDiagnostics({ file: "src/a.ts", timeoutMs: 1.5 })).toThrow("positive integer");
    expect(() => decodeFileDiagnostics({ file: "" })).toThrow("file parameter is required");
    expect(() => decodeDirectoryDiagnostics({ dir: "src", severity: "fatal" })).toThrow("one of error, warning");
    expect(() => decodeRename({ file: "x", line: 1, character: 1 })).toThrow("newName parameter is required");
    expect(() => decodeApplyCodeAction({})).toThrow("id parameter is required");
    expect(() => decodeWillRenameFiles({ oldPath: "a", newPath: "b", renamed: "yes" })).toThrow("must be a boolean");
    expect(decodeWillRenameFiles({ oldPath: "a", newPath: "b" })).toMatchObject({ kind: "willRenameFiles", renamed: false });
  });

  it("rejects unknown parameters", () => {
    expect(() => decodeFileDiagnostics({ file: "src/a.ts", uri: "file:///x" })).toThrow("unexpected parameter 'uri'");
    expect(() => decodeListCodeActions({ file: "x", line: 1, character: 1, apply: 0 })).toThrow("unexpected parameter 'apply'");
  });

  it("pairs endLine/endCharacter for code actions", () => {
    expect(() => decodeListCodeActions({ file: "x", line: 1, character: 1, endLine: 3 })).toThrow("must be provided together");
    expect(() => decodeListCodeActions({ file: "x", line: 5, character: 1, endLine: 3, endCharacter: 1 })).toThrow("must not precede range start");
    expect(decodeListCodeActions({ file: "x", line: 1, character: 1, endLine: 3, endCharacter: 7 })).toMatchObject({
      kind: "listCodeActions",
      endLine: 3,
      endCharacter: 7
    });
  });

  it("decodes definition into exactly one typed variant", () => {
    expect(decodeDefinition({ symbol: "Editor", language: "rust" })).toEqual({ kind: "definitionBySymbol", symbol: "Editor", language: "rust" });
    expect(decodeDefinition({ file: "src/a.ts", line: 2, character: 10 })).toEqual({ kind: "definitionAt", file: "src/a.ts", line: 2, character: 10 });
    expect(() => decodeDefinition({ symbol: "Editor", file: "src/a.ts", line: 1, character: 1 })).toThrow("cannot be combined");
  });
});

describe("executeOperation", () => {
  it("resolves file diagnostics against the workspace root and routes by file", async () => {
    const { runtime, registry } = await makeRuntime();

    const result = await executeOperation(runtime, { kind: "fileDiagnostics", file: "src/a.ts", timeoutMs: 3000 });
    expect(result).toMatchObject({ total: 0 });
    expect(registry.seenDiagnostics).toEqual([
      { file: path.join(runtime.root, "src", "a.ts"), timeoutMs: 3000 }
    ]);
  });

  it("rejects file diagnostics outside the root", async () => {
    const { runtime } = await makeRuntime();
    await expect(executeOperation(runtime, { kind: "fileDiagnostics", file: "../outside.ts" })).rejects.toThrow("File not found");
  });

  it("routes position operations by the resolved file and symbol operations by language", async () => {
    const { runtime, registry } = await makeRuntime();

    await expect(executeOperation(runtime, { kind: "definitionAt", file: "src/a.ts", line: 1, character: 1 })).resolves.toMatchObject({
      file: "default/position.ts"
    });
    await expect(executeOperation(runtime, { kind: "definitionBySymbol", symbol: "Editor", language: "rust" })).resolves.toMatchObject({
      file: "rust/Editor.ts"
    });
    await expect(executeOperation(runtime, { kind: "symbols", query: "Editor" })).resolves.toMatchObject([{ name: "Editor" }]);

    expect(registry.requestedLanguages).toContain("rust");
    expect(registry.requestedFiles).toEqual([path.join(runtime.root, "src", "a.ts")]);
  });

  it("executes status against the runtime state", async () => {
    const { runtime } = await makeRuntime();
    const status = await executeOperation(runtime, { kind: "status" }) as { workspaceRoot: string; runtime: { activeProviders: number } };
    expect(status.workspaceRoot).toBe(runtime.root);
    expect(status.runtime.activeProviders).toBe(0);
  });

  it("executes directory diagnostics with a resolved directory", async () => {
    const { runtime } = await makeRuntime();
    const result = await executeOperation(runtime, { kind: "directoryDiagnostics", dir: "src" }) as { directory: { matchedFiles: number; truncated: boolean } };
    expect(result.directory).toMatchObject({ matchedFiles: 1, truncated: false });
  });

  it("forms a cursor range when no selection is given for code actions", async () => {
    const { runtime } = await makeRuntime();
    await expect(
      executeOperation(runtime, { kind: "listCodeActions", file: "src/a.ts", line: 1, character: 1 })
    ).resolves.toEqual([]);
  });

  it("executes willRenameFiles with canonicalized targets", async () => {
    const { runtime } = await makeRuntime();
    await expect(
      executeOperation(runtime, { kind: "willRenameFiles", oldPath: "src/a.ts", newPath: "src/b.ts" })
    ).resolves.toMatchObject({
      oldPath: path.join(runtime.root, "src", "a.ts"),
      newPath: path.join(runtime.root, "src", "b.ts"),
      renamed: false
    });
    await expect(
      executeOperation(runtime, { kind: "willRenameFiles", oldPath: "src/a.ts", newPath: "src/b.ts", renamed: true })
    ).resolves.toMatchObject({ renamed: true });
  });
});