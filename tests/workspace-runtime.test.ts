import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkspaceDirectory, resolveWorkspaceFile, resolveWorkspaceRoot, resolveWorkspaceTarget, WorkspacePathError } from "../src/core/paths.js";
import { WorkspaceRuntime, WorkspaceRuntimeRegistry } from "../src/core/workspace-runtime.js";

const tempRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-runtime-"));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, ".codex"), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("resolveWorkspaceRoot", () => {
  it("accepts a root without project markers", async () => {
    const root = await makeRoot();
    await expect(resolveWorkspaceRoot(root)).resolves.toBe(await fs.realpath(root));
  });

  it("rejects nonexistent and non-directory roots", async () => {
    const root = await makeRoot();
    await expect(resolveWorkspaceRoot(path.join(root, "missing"))).rejects.toThrow("does not exist");
    const filePath = path.join(root, "file.ts");
    await fs.writeFile(filePath, "x");
    await expect(resolveWorkspaceRoot(filePath)).rejects.toThrow("not a directory");
  });

  it("canonicalizes a symlinked root via realpath", async () => {
    const realRoot = await makeRoot();
    const alias = path.join(os.tmpdir(), `codex-lsp-root-alias-${Date.now()}`);
    tempRoots.push(alias);
    await fs.symlink(realRoot, alias);
    await expect(resolveWorkspaceRoot(alias)).resolves.toBe(await fs.realpath(realRoot));
  });

  it("resolves relative root input against the process cwd", async () => {
    const root = await makeRoot();
    const resolved = await resolveWorkspaceRoot(root);
    await expect(resolveWorkspaceRoot(path.relative(process.cwd(), resolved))).resolves.toBe(resolved);
  });
});

describe("WorkspaceRuntimeRegistry", () => {
  it("reuses the runtime for repeated requests of the same root", async () => {
    const root = await makeRoot();
    const runtimes = new WorkspaceRuntimeRegistry();
    const first = await runtimes.get(root);
    const second = await runtimes.get(root);
    expect(second).toBe(first);
    expect(runtimes.size).toBe(1);
    await runtimes.disposeAll();
  });

  it("creates independent runtimes for different roots", async () => {
    const firstRoot = await makeRoot();
    const secondRoot = await makeRoot();
    const runtimes = new WorkspaceRuntimeRegistry();
    const first = await runtimes.get(firstRoot);
    const second = await runtimes.get(secondRoot);
    expect(first).not.toBe(second);
    expect(first.root).not.toBe(second.root);
    expect(runtimes.size).toBe(2);
    await runtimes.disposeAll();
  });

  it("loads the config from the selected root", async () => {
    const root = await makeRoot();
    await fs.writeFile(
      path.join(root, ".codex", "lsp-bridge.json"),
      JSON.stringify({ defaultLanguage: "rust" }),
      "utf8"
    );
    const runtimes = new WorkspaceRuntimeRegistry();
    const runtime = await runtimes.get(root);
    expect(runtime.config.defaultLanguage).toBe("rust");
    await runtimes.disposeAll();
  });

  it("disposes every spawned provider on disposeAll", async () => {
    const root = await makeRoot();
    const runtimes = new WorkspaceRuntimeRegistry();
    const runtime = await runtimes.get(root);
    runtime.providers.forLanguage("typescript");
    expect(runtime.providers.activeProviderCount).toBe(1);
    await runtimes.disposeAll();
    expect(runtimes.size).toBe(0);
  });
});

describe("shared path resolvers", () => {
  it("resolves relative and absolute file input inside the root", async () => {
    const root = await makeRoot();
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    const filePath = path.join(root, "src", "a.ts");
    await fs.writeFile(filePath, "export const a = 1;\n");

    await expect(resolveWorkspaceFile(root, "src/a.ts")).resolves.toBe(filePath);
    await expect(resolveWorkspaceFile(root, filePath)).resolves.toBe(filePath);
  });

  it("never resolves files outside the root", async () => {
    const root = await makeRoot();
    const outside = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-outside-")), "a.ts");
    tempRoots.push(path.dirname(outside));
    await fs.writeFile(outside, "x");

    await expect(resolveWorkspaceFile(root, outside)).rejects.toThrow("outside workspace root");
    await expect(resolveWorkspaceFile(root, "../a.ts")).rejects.toThrow("File not found");
  });

  it("blocks symlinked files that escape the root", async () => {
    const root = await makeRoot();
    const outside = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-outside-")), "a.ts");
    tempRoots.push(path.dirname(outside));
    await fs.writeFile(outside, "x");
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    const link = path.join(root, "src", "linked.ts");
    await fs.symlink(outside, link);

    await expect(resolveWorkspaceFile(root, link)).rejects.toThrow("outside workspace root");
  });

  it("blocks create targets under symlinked parents that escape the root", async () => {
    const root = await makeRoot();
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-outside-"));
    tempRoots.push(outsideDir);
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    const linkDir = path.join(root, "src", "link");
    await fs.symlink(outsideDir, linkDir);

    await expect(resolveWorkspaceTarget(root, path.join(linkDir, "new.ts"))).rejects.toThrow("outside workspace root");
    await expect(resolveWorkspaceTarget(root, path.join(root, "src", "fresh.ts"))).resolves.toBe(path.join(root, "src", "fresh.ts"));
  });

  it("resolves existing targets to their realpath and allows legitimate missing ones", async () => {
    const root = await makeRoot();
    const filePath = path.join(root, "existing.ts");
    await fs.writeFile(filePath, "x");

    await expect(resolveWorkspaceTarget(root, filePath)).resolves.toBe(filePath);
    await expect(resolveWorkspaceTarget(root, "missing-new.ts")).resolves.toBe(path.resolve(root, "missing-new.ts"));
  });

  it("resolves and validates directories", async () => {
    const root = await makeRoot();
    await fs.mkdir(path.join(root, "src"), { recursive: true });

    await expect(resolveWorkspaceDirectory(root, "src")).resolves.toBe(path.join(root, "src"));
    await expect(resolveWorkspaceDirectory(root, path.join(root, "nope"))).rejects.toThrow("Directory not found");
    await expect(resolveWorkspaceFile(root, "src")).rejects.toThrow("Not a file");
  });

  it("surfaces path errors as WorkspacePathError", async () => {
    const root = await makeRoot();
    const error = await resolveWorkspaceFile(root, "missing.ts").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(WorkspacePathError);
  });
});

describe("WorkspaceRuntime.Create", () => {
  it("builds a runtime wiring config, registry, providers, and services", async () => {
    const root = await makeRoot();
    const runtime = await WorkspaceRuntime.create(root);

    expect(runtime.root).toBe(await fs.realpath(root));
    expect(runtime.config.directoryDiagnostics).toEqual({ maxFiles: 50, timeoutBudgetMs: 15000, concurrency: 2 });
    expect(runtime.languageRegistry.extensions()).toEqual(expect.arrayContaining([".ts", ".rs"]));
    expect(runtime.commands).toBeDefined();
    expect(runtime.directoryDiagnostics).toBeDefined();
    expect(runtime.codeActionCache.size).toBe(0);
    await runtime.dispose();
  });
});