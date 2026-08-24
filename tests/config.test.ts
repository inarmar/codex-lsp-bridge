import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";
import { LanguageRegistry } from "../src/adapters/language-registry.js";

describe("config", () => {
  let rootPath = "";
  let homePath = "";
  const originalCodexHome = process.env.CODEX_HOME;

  afterEach(async () => {
    if (rootPath) await fs.rm(rootPath, { recursive: true, force: true });
    if (homePath) await fs.rm(homePath, { recursive: true, force: true });
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  });

  it("merges global and project lsp-client config", async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-config-root-"));
    homePath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-config-home-"));
    process.env.CODEX_HOME = path.join(homePath, ".codex");
    await fs.mkdir(process.env.CODEX_HOME, { recursive: true });
    await fs.mkdir(path.join(rootPath, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(process.env.CODEX_HOME, "lsp-client.json"),
      JSON.stringify({ diagnosticsTimeoutMs: 3000, hook: { maxFiles: 9 }, defaultLanguage: "python" })
    );
    await fs.writeFile(
      path.join(rootPath, ".codex", "lsp-client.json"),
      JSON.stringify({ hook: { verbosePending: true }, defaultLanguage: "typescript" })
    );

    expect(loadConfig(rootPath)).toMatchObject({
      defaultLanguage: "typescript",
      diagnosticsTimeoutMs: 3000,
      hook: { maxFiles: 9, verbosePending: true }
    });
  });

  it("uses a diagnostics timeout suitable for cold language-server analysis by default", async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-config-root-"));
    homePath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-config-home-"));
    process.env.CODEX_HOME = path.join(homePath, ".codex");

    expect(loadConfig(rootPath)).toMatchObject({
      diagnosticsTimeoutMs: 15000
    });
  });

  it("accepts auto diagnostics timeout policy", async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-config-root-"));
    homePath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-config-home-"));
    process.env.CODEX_HOME = path.join(homePath, ".codex");
    await fs.mkdir(process.env.CODEX_HOME, { recursive: true });
    await fs.writeFile(path.join(process.env.CODEX_HOME, "lsp-client.json"), JSON.stringify({ diagnosticsTimeoutMs: "auto" }));

    expect(loadConfig(rootPath)).toMatchObject({
      diagnosticsTimeoutMs: "auto"
    });
  });

  it("accepts Rust as the default language", async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-config-root-"));
    await fs.mkdir(path.join(rootPath, ".codex"), { recursive: true });
    await fs.writeFile(path.join(rootPath, ".codex", "lsp-client.json"), JSON.stringify({ defaultLanguage: "rust" }));

    expect(loadConfig(rootPath)).toMatchObject({
      defaultLanguage: "rust"
    });
  });

  it("merges language server entries field by field over the defaults layer", async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-config-root-"));
    homePath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-config-home-"));
    process.env.CODEX_HOME = path.join(homePath, ".codex");
    await fs.mkdir(process.env.CODEX_HOME, { recursive: true });
    await fs.writeFile(
      path.join(process.env.CODEX_HOME, "lsp-client.json"),
      JSON.stringify({ languageServers: { rust: { args: ["--log", "verbose"] } } })
    );
    await fs.mkdir(path.join(rootPath, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, ".codex", "lsp-client.json"),
      JSON.stringify({ languageServers: { rust: { command: "my-analyzer" } } })
    );

    const config = loadConfig(rootPath);
    expect(config.languageServers.rust).toMatchObject({
      command: "my-analyzer",
      args: ["--log", "verbose"],
      extensions: [".rs"]
    });
    const registry = LanguageRegistry.fromMergedConfig(config);
    expect(registry.descriptor("rust").command).toBe("my-analyzer");
    expect(registry.detectByExtension("src/main.rs")).toBe("rust");
  });

  it("accepts a new language defined entirely in config", async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-config-root-"));
    await fs.mkdir(path.join(rootPath, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, ".codex", "lsp-client.json"),
      JSON.stringify({
        defaultLanguage: "zig",
        languageServers: { zig: { command: "zls", extensions: [".zig"], installHint: "npm install -g zls" } }
      })
    );

    const config = loadConfig(rootPath);
    const registry = LanguageRegistry.fromMergedConfig(config);
    expect(config.defaultLanguage).toBe("zig");
    expect(registry.languages()).toEqual(["typescript", "rust", "python", "go", "zig"]);
    expect(registry.descriptor("zig")).toMatchObject({ command: "zls", installHint: "npm install -g zls" });
    expect(registry.detectByExtension("src/main.zig")).toBe("zig");
  });

  it("falls back to typescript when the default language is unknown", async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-config-root-"));
    await fs.mkdir(path.join(rootPath, ".codex"), { recursive: true });
    await fs.writeFile(path.join(rootPath, ".codex", "lsp-client.json"), JSON.stringify({ defaultLanguage: "java" }));

    expect(loadConfig(rootPath)).toMatchObject({
      defaultLanguage: "typescript"
    });
  });

  it("fails fast on incomplete and colliding language server entries", async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-config-root-"));
    await fs.mkdir(path.join(rootPath, ".codex"), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, ".codex", "lsp-client.json"),
      JSON.stringify({ languageServers: { zig: { command: "zls" } } })
    );

    expect(() => loadConfig(rootPath)).toThrow("languageServers.zig: missing required field 'extensions'");

    await fs.writeFile(
      path.join(rootPath, ".codex", "lsp-client.json"),
      JSON.stringify({ languageServers: { myts: { command: "other-server", extensions: [".ts"] } } })
    );

    expect(() => loadConfig(rootPath)).toThrow('languageServers.myts: extension ".ts" is already used by language "typescript"');
  });
});
