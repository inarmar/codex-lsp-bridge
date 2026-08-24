import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLanguageServerConfig, LanguageRegistry } from "../src/adapters/language-registry.js";
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
      server: { command: "typescript-language-server", args: ["--stdio"] }
    });
    expect(path.isAbsolute(config.server.cwd)).toBe(true);
  });

  it("detects supported languages from file extensions", () => {
    expect(registry.detectByExtension("src/app.tsx")).toBe("typescript");
    expect(registry.detectByExtension("src/main.rs")).toBe("rust");
    expect(registry.detectByExtension("src/main.py")).toBe("python");
    expect(registry.detectByExtension("cmd/server/main.go")).toBe("go");
    expect(() => registry.detectByExtension("README.md")).toThrow("Unsupported file extension");
  });

  it("lists languages from the defaults layer", () => {
    expect(registry.languages()).toEqual(["typescript", "rust", "python", "go"]);
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
