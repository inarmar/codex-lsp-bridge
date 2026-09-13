import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLanguageServerConfig, LanguageRegistry, resolveLanguageServerWorkspace } from "../src/adapters/language-registry.js";
import { defaultLanguageServers } from "../src/adapters/default-language-servers.js";
import { filePathToUri, uriToFilePath } from "../src/utils/uri.js";

describe("language registry", () => {
  const registry = LanguageRegistry.fromLanguageServers(defaultLanguageServers);

  it("creates immutable language server command configs", () => {
    const config = createLanguageServerConfig("typescript", registry.descriptor("typescript"), ".");

    expect(config).toMatchObject({
      language: "typescript",
      languageId: "typescript",
      installHint: "npm install -g typescript-language-server typescript",
      supportLevel: "primary",
      workspaceSeedFiles: expect.arrayContaining(["src/proxy.ts"]),
      languageServerWorkspace: path.resolve("."),
      server: { command: "typescript-language-server", args: ["--stdio"] }
    });
    expect(path.isAbsolute(config.server.cwd)).toBe(true);
    expect(config.server.cwd).toBe(config.languageServerWorkspace);
  });

  it("resolves a nested language server workspace and keeps the root as containment boundary", () => {
    const rootPath = path.resolve("fake-repo");
    const custom = LanguageRegistry.fromLanguageServers({
      typescript: { ...defaultLanguageServers.typescript, workspacePath: "frontend" }
    });
    const config = createLanguageServerConfig("typescript", custom.descriptor("typescript"), rootPath);

    expect(config.languageServerWorkspace).toBe(path.join(rootPath, "frontend"));
    expect(config.server.cwd).toBe(config.languageServerWorkspace);
    expect(config.workspaceRootPath).toBe(rootPath);
  });

  it("rejects language server workspaces outside the workspace root", () => {
    const rootPath = path.resolve("fake-repo");

    expect(() =>
      LanguageRegistry.fromLanguageServers({
        rust: { ...defaultLanguageServers.rust, workspacePath: "../outside" }
      })
    ).toThrow("field 'workspacePath' must be a relative path inside the workspace root");

    expect(() => resolveLanguageServerWorkspace(rootPath, "up/../../escape")).toThrow(
      "workspacePath must be a relative path"
    );
  });

  it("rejects absolute and escaping workspaceSeedFiles at config validation", () => {
    expect(() =>
      LanguageRegistry.fromLanguageServers({
        zig: { command: "zls", extensions: [".zig"], workspaceSeedFiles: ["/etc/passwd"] }
      })
    ).toThrow("field 'workspaceSeedFiles' must be an array of relative paths");

    expect(() =>
      LanguageRegistry.fromLanguageServers({
        zig: { command: "zls", extensions: [".zig"], workspaceSeedFiles: ["../outside/main.zig"] }
      })
    ).toThrow("field 'workspaceSeedFiles' must be an array of relative paths");
  });

  it("rejects absolute workspacePath at config validation", () => {
    expect(() =>
      LanguageRegistry.fromLanguageServers({
        zig: { command: "zls", extensions: [".zig"], workspacePath: "/abs/workspace" }
      })
    ).toThrow("field 'workspacePath' must be a relative path");
  });


  it("detects supported languages from file extensions", () => {
    expect(registry.detectByExtension("src/app.tsx")).toBe("typescript");
    expect(registry.detectByExtension("src/main.rs")).toBe("rust");
    expect(registry.detectByExtension("src/main.py")).toBe("python");
    expect(registry.detectByExtension("cmd/server/main.go")).toBe("go");
    expect(() => registry.detectByExtension("README.md")).toThrow("Unsupported file extension");
  });

  it("lists languages from the defaults layer", () => {
    expect(registry.languages()).toEqual(["typescript", "rust", "python", "go", "svelte"]);
    expect(createLanguageServerConfig("go", registry.descriptor("go"), ".")).toMatchObject({
      language: "go",
      languageId: "go",
      installHint: "go install golang.org/x/tools/gopls@latest",
      supportLevel: "experimental",
      server: expect.objectContaining({ command: "gopls" })
    });
  });

  it("fills descriptor defaults for entries that only define the required fields", () => {
    const minimal = LanguageRegistry.fromLanguageServers({
      zig: { command: "zls", extensions: [".zig"] }
    });

    expect(minimal.descriptor("zig")).toEqual({
      languageId: "zig",
      command: "zls",
      args: [],
      extensions: [".zig"],
      workspaceSeedFiles: [],
      installHint: 'install "zls" and make sure it is available on PATH',
      supportLevel: "experimental"
    });
    expect(minimal.detectByExtension("src/main.zig")).toBe("zig");
    expect(minimal.extensions()).toEqual([".zig"]);
  });

  it("rejects entries without required fields and languages colliding on an extension", () => {
    const base = { rust: { command: "rust-analyzer", extensions: [".rs"] } };

    expect(() => LanguageRegistry.fromLanguageServers({ ...base, incomplete: { command: "some-server" } })).toThrow(
      "languageServers.incomplete: missing required field 'extensions'"
    );
    expect(() => LanguageRegistry.fromLanguageServers({ ...base, colliding: { command: "another-server", extensions: [".rs"] } })).toThrow(
      'languageServers.colliding: extension ".rs" is already used by language "rust"'
    );
    expect(() => LanguageRegistry.fromLanguageServers({ ...base, garbage: "not an object" })).toThrow(
      "languageServers.garbage: expected an object"
    );
    expect(() => LanguageRegistry.fromLanguageServers({ ...base, badArgs: { command: "some-server", extensions: [".zig"], args: "--stdio" } })).toThrow(
      "languageServers.badArgs: field 'args' must be an array of strings"
    );
  });
});

describe("file URI helpers", () => {
  it("round-trips file paths through file URIs", () => {
    const filePath = path.resolve("src/index.ts");

    expect(uriToFilePath(filePathToUri(filePath))).toBe(filePath);
    expect(() => uriToFilePath("https://example.com/file.ts")).toThrow("Only file:// URIs are supported");
  });
});
