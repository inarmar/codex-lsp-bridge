import { describe, expect, it } from "vitest";
import { CliUsageError, parseCliArgs } from "../src/transport/cli.js";

describe("parseCliArgs", () => {
  it("maps the status command to the canonical status operation", () => {
    expect(parseCliArgs(["status"])).toEqual({ operation: { kind: "status" } });
    expect(parseCliArgs(["status", "--root", "/tmp/root"])).toEqual({ root: "/tmp/root", operation: { kind: "status" } });
  });

  it("parses file diagnostics with a numeric timeout", () => {
    expect(parseCliArgs(["diagnostics", "--file", "src/a.ts"])).toEqual({
      operation: { kind: "fileDiagnostics", file: "src/a.ts" }
    });
    expect(parseCliArgs(["diagnostics", "--file", "src/a.ts", "--timeout-ms", "15000"])).toEqual({
      operation: { kind: "fileDiagnostics", file: "src/a.ts", timeoutMs: 15000 }
    });
  });

  it("rejects file diagnostics without a target file (no no-target mode)", () => {
    expect(() => parseCliArgs(["diagnostics"])).toThrow("file parameter is required");
    expect(() => parseCliArgs(["diagnostics", "--timeout-ms", "5000"])).toThrow("file parameter is required");
  });

  it("rejects directory-only options on file diagnostics", () => {
    expect(() => parseCliArgs(["diagnostics", "--file", "src/a.ts", "--timeout-budget-ms", "100"])).toThrow(
      "Unknown option --timeout-budget-ms for command diagnostics"
    );
    expect(() => parseCliArgs(["diagnostics", "--file", "src/a.ts", "--max-files", "3"])).toThrow(
      "Unknown option --max-files for command diagnostics"
    );
  });

  it("parses directory diagnostics with all options", () => {
    expect(
      parseCliArgs([
        "directory-diagnostics",
        "--dir",
        "src",
        "--severity",
        "error",
        "--max-files",
        "10",
        "--timeout-budget-ms",
        "5000",
        "--concurrency",
        "2"
      ])
    ).toEqual({
      operation: {
        kind: "directoryDiagnostics",
        dir: "src",
        severity: "error",
        maxFiles: 10,
        timeoutBudgetMs: 5000,
        concurrency: 2
      }
    });
  });

  it("rejects file-only options on directory diagnostics", () => {
    expect(() => parseCliArgs(["directory-diagnostics", "--dir", "src", "--timeout-ms", "100"])).toThrow(
      "Unknown option --timeout-ms for command directory-diagnostics"
    );
  });

  it("distinguishes symbol and position modes for definition/references/hover", () => {
    expect(parseCliArgs(["definition", "Editor", "--language", "rust"])).toEqual({
      operation: { kind: "definitionBySymbol", symbol: "Editor", language: "rust" }
    });
    expect(parseCliArgs(["definition", "--file", "src/a.ts", "--line", "2", "--character", "10"])).toEqual({
      operation: { kind: "definitionAt", file: "src/a.ts", line: 2, character: 10 }
    });
    expect(parseCliArgs(["references", "Editor"])).toEqual({ operation: { kind: "referencesBySymbol", symbol: "Editor" } });
    expect(parseCliArgs(["hover", "--file", "src/a.ts", "--line", "1", "--character", "1"])).toEqual({
      operation: { kind: "hoverAt", file: "src/a.ts", line: 1, character: 1 }
    });
  });

  it("rejects --language on position-based lookups", () => {
    expect(() =>
      parseCliArgs(["definition", "--file", "src/a.ts", "--line", "2", "--character", "10", "--language", "rust"])
    ).toThrow("only valid for symbol-based lookups");
  });

  it("rejects partially specified positions", () => {
    expect(() => parseCliArgs(["definition", "--file", "src/a.ts", "--line", "2"])).toThrow(
      "character parameter must be a positive integer"
    );
  });

  it("parses symbol search with language", () => {
    expect(parseCliArgs(["symbols", "Editor"])).toEqual({ operation: { kind: "symbols", query: "Editor" } });
    expect(parseCliArgs(["symbols", "Editor", "--language", "go"])).toEqual({
      operation: { kind: "symbols", query: "Editor", language: "go" }
    });
  });

  it("parses rename with newName", () => {
    expect(parseCliArgs(["rename", "--file", "src/a.ts", "--line", "1", "--character", "1", "--new-name", "Renamed"])).toEqual({
      operation: { kind: "renameAt", file: "src/a.ts", line: 1, character: 1, newName: "Renamed" }
    });
    expect(() => parseCliArgs(["rename", "--file", "src/a.ts", "--line", "1", "--character", "1"])).toThrow(
      "newName parameter is required"
    );
  });

  it("parses code-actions with required position, optional selection and only", () => {
    expect(() => parseCliArgs(["code-actions", "--file", "src/a.ts"])).toThrow(
      "line parameter must be a positive integer"
    );
    expect(parseCliArgs(["code-actions", "--file", "src/a.ts", "--line", "1", "--character", "1"])).toEqual({
      operation: { kind: "listCodeActions", file: "src/a.ts", line: 1, character: 1 }
    });
    expect(
      parseCliArgs([
        "code-actions",
        "--file",
        "src/a.ts",
        "--line",
        "1",
        "--character",
        "1",
        "--end-line",
        "3",
        "--end-character",
        "7",
        "--only",
        "quickfix,refactor"
      ])
    ).toEqual({
      operation: { kind: "listCodeActions", file: "src/a.ts", line: 1, character: 1, endLine: 3, endCharacter: 7, only: ["quickfix", "refactor"] }
    });
  });

  it("parses apply-code-action by id", () => {
    expect(parseCliArgs(["apply-code-action", "--id", "ca-12"])).toEqual({
      operation: { kind: "applyCodeAction", id: "ca-12" }
    });
    expect(() => parseCliArgs(["apply-code-action"])).toThrow("id parameter is required");
  });

  it("parses file-rename sync with renamed flag", () => {
    expect(parseCliArgs(["will-rename-files", "--old-path", "src/a.ts", "--new-path", "src/b.ts"])).toEqual({
      operation: { kind: "willRenameFiles", oldPath: "src/a.ts", newPath: "src/b.ts", renamed: false }
    });
    expect(parseCliArgs(["will-rename-files", "--old-path", "src/a.ts", "--new-path", "src/b.ts", "--renamed", "true"])).toEqual({
      operation: { kind: "willRenameFiles", oldPath: "src/a.ts", newPath: "src/b.ts", renamed: true }
    });
    expect(() => parseCliArgs(["will-rename-files", "--old-path", "src/a.ts", "--new-path", "src/b.ts", "--renamed", "yes"])).toThrow(
      "--renamed must be true or false"
    );
  });

  it("rejects the legacy apply index and unknown commands", () => {
    expect(() => parseCliArgs(["code-actions", "--file", "src/a.ts", "--line", "1", "--character", "1", "--apply", "0"])).toThrow(
      "Unknown option --apply for command code-actions"
    );
    expect(() => parseCliArgs(["doctor"])).toThrow("Unknown command: doctor");
  });

  it("validates numeric options as positive integers", () => {
    expect(() => parseCliArgs(["diagnostics", "--file", "src/a.ts", "--timeout-ms", "-5"])).toThrow(
      "must be a positive integer"
    );
    expect(() => parseCliArgs(["diagnostics", "--file", "src/a.ts", "--timeout-ms", "abc"])).toThrow(
      "must be a positive integer"
    );
    expect(() => parseCliArgs(["diagnostics", "--file", "src/a.ts", "--timeout-ms", "1.5"])).toThrow(
      "must be a positive integer"
    );
    expect(() => parseCliArgs(["definition", "--file", "src/a.ts", "--line", "0", "--character", "1"])).toThrow(
      "must be a positive integer"
    );
  });

  it("requires a value for options and a command", () => {
    expect(() => parseCliArgs([])).toThrow("Missing command");
    expect(() => parseCliArgs(["status", "--root"])).toThrow("Option --root requires a value");
  });

  it("rejects positional arguments for commands that do not declare them", () => {
    expect(() => parseCliArgs(["status", "foo"])).toThrow("does not accept positional arguments");
    expect(() => parseCliArgs(["diagnostics", "foo", "--file", "src/a.ts"])).toThrow("does not accept positional arguments");
    expect(() => parseCliArgs(["directory-diagnostics", "extra", "--dir", "src"])).toThrow("does not accept positional arguments");
    expect(() => parseCliArgs(["apply-code-action", "extra", "--id", "ca-1"])).toThrow("does not accept positional arguments");
    expect(() => parseCliArgs(["rename", "extra", "--file", "src/a.ts", "--line", "1", "--character", "1", "--new-name", "x"])).toThrow(
      "does not accept positional arguments"
    );
  });

  it("rejects multi-value positionals for symbol commands", () => {
    expect(() => parseCliArgs(["symbols", "a", "b"])).toThrow("accepts a single positional argument");
    expect(() => parseCliArgs(["definition", "a", "b"])).toThrow("accepts a single symbol argument");
  });

  it("rejects hex and exponent numeric forms exactly like JSON numbers", () => {
    expect(() => parseCliArgs(["diagnostics", "--file", "src/a.ts", "--timeout-ms", "0x10"])).toThrow(
      "must be a positive integer"
    );
    expect(() => parseCliArgs(["diagnostics", "--file", "src/a.ts", "--timeout-ms", "1e3"])).toThrow(
      "must be a positive integer"
    );
    expect(() => parseCliArgs(["definition", "--file", "src/a.ts", "--line", "0x2", "--character", "1"])).toThrow(
      "must be a positive integer"
    );
    expect(() => parseCliArgs(["directory-diagnostics", "--dir", "src", "--concurrency", "0x2"])).toThrow(
      "must be a positive integer"
    );
  });
});