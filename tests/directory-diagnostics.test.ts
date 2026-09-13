import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceCommandService } from "../src/core/command-service.js";
import { DirectoryDiagnostics } from "../src/core/directory-diagnostics.js";
import { LanguageRegistry } from "../src/adapters/language-registry.js";
import { defaultLanguageServers } from "../src/adapters/default-language-servers.js";
import type { DiagnosticReport, SemanticProvider } from "../src/core/types.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

interface CountingProvider extends SemanticProvider {
  readonly calledFiles: string[];
  delayMs?: number;
}

function countingProvider(): CountingProvider {
  const provider: CountingProvider = {
    calledFiles: [],
    async diagnostics(file: string): Promise<DiagnosticReport> {
      this.calledFiles.push(file);
      if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      return {
        status: "ok",
        timedOut: false,
        stale: false,
        sourceRevision: 1,
        items:
          file.endsWith("clean.ts")
            ? []
            : [
                { file, line: 1, character: 1, severity: "error", message: "boom" },
                { file, line: 2, character: 1, severity: "warning", message: "careful" }
              ]
      };
    },
    knownDiagnosticsSnapshot(filePath: string): Promise<{ filePath: string; diagnostics: never[] }> {
      return Promise.resolve({ filePath, diagnostics: [] });
    },
    definition(): Promise<{ file: string; line: number; character: number }> {
      throw new Error("not used");
    },
    definitionAt(): Promise<{ file: string; line: number; character: number }> {
      throw new Error("not used");
    },
    references(): Promise<never[]> {
      throw new Error("not used");
    },
    referencesAt(): Promise<never[]> {
      throw new Error("not used");
    },
    symbols(): Promise<never[]> {
      throw new Error("not used");
    },
    hover(): Promise<never> {
      throw new Error("not used");
    },
    hoverAt(): Promise<never> {
      throw new Error("not used");
    },
    rename(): Promise<never> {
      throw new Error("not used");
    },
    listCodeActions(): Promise<never> {
      throw new Error("not used");
    },
    applyCodeAction(): Promise<never> {
      throw new Error("not used");
    },
    willRenameFiles(): Promise<never> {
      throw new Error("not used");
    },
    notifyFilesRenamed(): Promise<never> {
      throw new Error("not used");
    },
    dispose(): Promise<void> {
      return Promise.resolve();
    }
  };
  return provider;
}

class FakeRegistry {
  constructor(readonly provider: CountingProvider) {}

  forLanguage(): CountingProvider {
    return this.provider;
  }

  forFile(): CountingProvider {
    return this.provider;
  }
}

async function makeDirectory(rootPath: string, files: string[]): Promise<void> {
  await fs.mkdir(path.join(rootPath, "src"), { recursive: true });
  for (const name of files) {
    await fs.writeFile(path.join(rootPath, "src", name), "export const x = 1;\n", "utf8");
  }
  await fs.writeFile(path.join(rootPath, "src", "clean.ts"), "export const clean = 1;\n", "utf8");
}

describe("DirectoryDiagnostics", () => {
  it("stops scheduling new work once the timeout budget is exhausted", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-dir-"));
    tempRoots.push(root);
    await makeDirectory(root, ["a.ts", "b.ts", "c.ts"]);
    const provider = countingProvider();
    provider.delayMs = 30;
    const commands = new WorkspaceCommandService(new FakeRegistry(provider), "typescript");
    const directory = new DirectoryDiagnostics(commands, LanguageRegistry.fromLanguageServers(defaultLanguageServers), {
      maxFiles: 50,
      timeoutBudgetMs: 1,
      concurrency: 1
    });

    const result = await directory.collect({ dir: path.join(root, "src") });
    expect(result.directory.budgetTimedOut).toBe(true);
    expect(result.directory.scannedFiles).toBeLessThan(4);
    expect(result.directory.matchedFiles).toBe(4);
    expect(provider.calledFiles.length).toBe(result.directory.scannedFiles);
  });

  it("runs file diagnostics in concurrency-bounded batches", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-dir-"));
    tempRoots.push(root);
    await makeDirectory(root, ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"]);
    const provider = countingProvider();
    const commands = new WorkspaceCommandService(new FakeRegistry(provider), "typescript");
    const directory = new DirectoryDiagnostics(commands, LanguageRegistry.fromLanguageServers(defaultLanguageServers), {
      maxFiles: 50,
      timeoutBudgetMs: 60000,
      concurrency: 2
    });

    const result = await directory.collect({ dir: path.join(root, "src") });
    expect(result.directory.budgetTimedOut).toBe(false);
    expect(result.directory.scannedFiles).toBe(7); // 6 files + clean.ts
    expect(result.total).toBe(12); // two diagnostics per dirty file
    expect(provider.calledFiles).toHaveLength(7);
  });

  it("applies severity as a result filter", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-dir-"));
    tempRoots.push(root);
    await makeDirectory(root, ["a.ts"]);
    const provider = countingProvider();
    const commands = new WorkspaceCommandService(new FakeRegistry(provider), "typescript");
    const directory = new DirectoryDiagnostics(commands, LanguageRegistry.fromLanguageServers(defaultLanguageServers), {
      maxFiles: 50,
      timeoutBudgetMs: 60000,
      concurrency: 2
    });

    const result = await directory.collect({ dir: path.join(root, "src"), severity: "error" });
    expect(result.total).toBe(1);
    expect(result.items.every((item) => item.severity === "error")).toBe(true);
    expect(result.bySeverity.error).toBe(1);
    expect(result.bySeverity.warning).toBe(0);
  });

  it("truncates the file listing at maxFiles", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-dir-"));
    tempRoots.push(root);
    await makeDirectory(root, ["a.ts", "b.ts", "c.ts"]);
    const provider = countingProvider();
    const commands = new WorkspaceCommandService(new FakeRegistry(provider), "typescript");
    const directory = new DirectoryDiagnostics(commands, LanguageRegistry.fromLanguageServers(defaultLanguageServers), {
      maxFiles: 2,
      timeoutBudgetMs: 60000,
      concurrency: 2
    });

    const result = await directory.collect({ dir: path.join(root, "src") });
    expect(result.directory.truncated).toBe(true);
    expect(result.directory.matchedFiles).toBe(2);
    expect(provider.calledFiles.length).toBe(2);
  });

  it("reuses the source file list cache within its TTL", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-dir-"));
    tempRoots.push(root);
    await makeDirectory(root, ["a.ts"]);
    const provider = countingProvider();
    const commands = new WorkspaceCommandService(new FakeRegistry(provider), "typescript");
    const directory = new DirectoryDiagnostics(commands, LanguageRegistry.fromLanguageServers(defaultLanguageServers), {
      maxFiles: 50,
      timeoutBudgetMs: 60000,
      concurrency: 2
    });

    await directory.collect({ dir: path.join(root, "src") });
    const result = await directory.collect({ dir: path.join(root, "src") });
    expect(result.directory.sourceFileListCache).toBe("hit");
  });

  it("honors request-level overrides of every option", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-dir-"));
    tempRoots.push(root);
    await makeDirectory(root, ["a.ts", "b.ts", "c.ts", "d.ts"]);
    const provider = countingProvider();
    const commands = new WorkspaceCommandService(new FakeRegistry(provider), "typescript");
    const directory = new DirectoryDiagnostics(commands, LanguageRegistry.fromLanguageServers(defaultLanguageServers), {
      maxFiles: 50,
      timeoutBudgetMs: 60000,
      concurrency: 2
    });

    const result = await directory.collect({ dir: path.join(root, "src"), maxFiles: 1, concurrency: 1 });
    expect(result.directory.truncated).toBe(true);
    expect(result.directory.maxFiles).toBe(1);
    expect(result.directory.concurrency).toBe(1);
  });
});