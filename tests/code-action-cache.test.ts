import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodeActionCache } from "../src/core/code-action-cache.js";
import type { ApplyCodeActionRequest, CodeActionApplied, SemanticProvider } from "../src/core/types.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

class ApplyingProvider implements SemanticProvider {
  readonly applied: Array<{ file: string; raw: unknown }> = [];

  applyCodeAction(request: ApplyCodeActionRequest): Promise<CodeActionApplied> {
    this.applied.push(request);
    return Promise.resolve({
      title: "Fix",
      changedFiles: [request.file],
      createdFiles: [],
      renamedFiles: [],
      deletedFiles: [],
      editCount: 1,
      commandExecuted: false
    });
  }

  diagnostics(): Promise<never> {
    throw new Error("not used");
  }
  knownDiagnosticsSnapshot(): Promise<never> {
    throw new Error("not used");
  }
  definition(): Promise<never> {
    throw new Error("not used");
  }
  definitionAt(): Promise<never> {
    throw new Error("not used");
  }
  references(): Promise<never> {
    throw new Error("not used");
  }
  referencesAt(): Promise<never> {
    throw new Error("not used");
  }
  symbols(): Promise<never> {
    throw new Error("not used");
  }
  hover(): Promise<never> {
    throw new Error("not used");
  }
  hoverAt(): Promise<never> {
    throw new Error("not used");
  }
  rename(): Promise<never> {
    throw new Error("not used");
  }
  listCodeActions(): Promise<never> {
    throw new Error("not used");
  }
  willRenameFiles(): Promise<never> {
    throw new Error("not used");
  }
  notifyFilesRenamed(): Promise<never> {
    throw new Error("not used");
  }
  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

const candidate = (title: string, raw?: unknown) => ({
  title,
  raw: raw ?? { title, command: { title, command: "fix" } },
  hasEdit: false,
  hasCommand: true
});

describe("CodeActionCache", () => {
  it("stores candidates and applies them by opaque handle", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-ca-"));
    tempRoots.push(root);
    const filePath = path.join(root, "a.ts");
    await fs.writeFile(filePath, "export const a = 1;\n", "utf8");
    const provider = new ApplyingProvider();
    const cache = new CodeActionCache();

    const summaries = await cache.store(provider, filePath, [candidate("Fix A"), candidate("Fix B")]);
    expect(summaries).toEqual([
      { id: expect.stringMatching(/^ca-\d+$/), title: "Fix A" },
      { id: expect.stringMatching(/^ca-\d+$/), title: "Fix B" }
    ]);
    expect(summaries[0].id).not.toBe(summaries[1].id);

    await expect(cache.apply(summaries[0].id)).resolves.toMatchObject({ title: "Fix", editCount: 1 });
    expect(provider.applied).toHaveLength(1);
    expect(provider.applied[0]).toMatchObject({ file: filePath });
  });

  it("rejects stale handles when the source document changed after listing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-ca-"));
    tempRoots.push(root);
    const filePath = path.join(root, "a.ts");
    await fs.writeFile(filePath, "export const a = 1;\n", "utf8");
    const provider = new ApplyingProvider();
    const cache = new CodeActionCache();

    const summaries = await cache.store(provider, filePath, [candidate("Fix A")]);
    await fs.writeFile(filePath, "export const a = 2;\n", "utf8");

    await expect(cache.apply(summaries[0].id)).rejects.toThrow("is stale");
    expect(provider.applied).toHaveLength(0);
  });

  it("invalidates a handle after use and rejects unknown handles", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-ca-"));
    tempRoots.push(root);
    const filePath = path.join(root, "a.ts");
    await fs.writeFile(filePath, "x", "utf8");
    const cache = new CodeActionCache();
    const summaries = await cache.store(new ApplyingProvider(), filePath, [candidate("Fix A")]);

    await cache.apply(summaries[0].id);
    await expect(cache.apply(summaries[0].id)).rejects.toThrow("unknown or expired");
    await expect(cache.apply("ca-999")).rejects.toThrow("unknown or expired");
  });

  it("evicts the oldest handle when the cache exceeds its bound", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-ca-"));
    tempRoots.push(root);
    const filePath = path.join(root, "a.ts");
    await fs.writeFile(filePath, "x", "utf8");
    const provider = new ApplyingProvider();
    const cache = new CodeActionCache(2);

    const first = await cache.store(provider, filePath, [candidate("Oldest")]);
    const second = await cache.store(provider, filePath, [candidate("Middle")]);
    const third = await cache.store(provider, filePath, [candidate("Newest")]);

    expect(cache.size).toBe(2);
    await expect(cache.apply(first[0].id)).rejects.toThrow("unknown or expired");
    await expect(cache.apply(second[0].id)).resolves.toBeDefined();
    await expect(cache.apply(third[0].id)).resolves.toBeDefined();
  });
});