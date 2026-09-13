import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectBridgeStatus, inspectBuildFreshness } from "../src/core/status.js";
import { WorkspaceRuntime } from "../src/core/workspace-runtime.js";

describe("bridge status", () => {
  it("reports every registered language server command and workspace mapping", () => {
    const result = collectBridgeStatus(process.cwd());

    expect(result.workspaceRoot).toBe(process.cwd());
    expect(result.configFilePresent).toBe(false);
    expect(result.languages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          language: "typescript",
          command: expect.stringContaining("typescript-language-server"),
          supportLevel: "primary",
          installHint: "npm install -g typescript-language-server typescript",
          languageServerWorkspace: process.cwd()
        }),
        expect.objectContaining({ language: "rust", command: "rust-analyzer", supportLevel: "experimental" }),
        expect.objectContaining({ language: "python", command: "pyright-langserver", supportLevel: "experimental" }),
        expect.objectContaining({ language: "go", command: "gopls", supportLevel: "experimental" })
      ])
    );
    expect(result.languages.every((entry) => entry.status === "ok" || entry.status === "missing")).toBe(true);
    expect(result.codex).toEqual(
      expect.objectContaining({
        mcpConfigured: expect.any(Boolean),
        hookConfigured: expect.any(Boolean),
        instructionsConfigured: expect.any(Boolean)
      })
    );
    expect(result.build).toEqual(expect.objectContaining({ distExists: expect.any(Boolean), stale: expect.any(Boolean) }));
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        timeoutMs: expect.any(Number),
        policy: expect.stringMatching(/^(fixed|auto)$/),
        reasons: expect.any(Array)
      })
    );
    expect(result.runtime).toEqual({ activeProviders: 0 });
    expect(result.recommendations).toEqual(expect.any(Array));
  });

  it("reports the configured workspacePath when the language uses one", async () => {
    const rootPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codex-lsp-status-root-"));
    try {
      await fs.promises.mkdir(path.join(rootPath, "frontend"), { recursive: true });
      await fs.promises.mkdir(path.join(rootPath, ".codex"), { recursive: true });
      await fs.promises.writeFile(
        path.join(rootPath, ".codex", "lsp-bridge.json"),
        JSON.stringify({ languageServers: { typescript: { workspacePath: "frontend" } } }),
        "utf8"
      );
      const runtime = await WorkspaceRuntime.create(rootPath);

      const result = collectBridgeStatus(rootPath, runtime);
      expect(result.configFilePresent).toBe(true);
      expect(result.languages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            language: "typescript",
            workspacePath: "frontend",
            languageServerWorkspace: path.join(rootPath, "frontend")
          })
        ])
      );
      await runtime.dispose();
    } finally {
      await fs.promises.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("uses already-created runtime state without starting new providers", () => {
    const stub: Partial<WorkspaceRuntime> = {
      config: undefined,
      languageRegistry: undefined,
      diagnostics: undefined,
      providers: { activeProviderCount: 3 } as WorkspaceRuntime["providers"]
    };
    const result = collectBridgeStatus(process.cwd(), stub as WorkspaceRuntime);

    expect(result.languages).toEqual(expect.any(Array));
    expect(result.runtime.activeProviders).toBe(3);
  });

  it("does not treat package installs without src as stale", () => {
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-lsp-package-root-"));
    fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, "dist", "index.js"), "");

    expect(inspectBuildFreshness(packageRoot)).toEqual({ distExists: true, stale: false });

    fs.rmSync(packageRoot, { recursive: true, force: true });
  });
});