import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  applyWorkspaceEdit,
  normalizeWorkspaceEdit,
  positionToOffset,
  previewWorkspaceEdit,
  validateWorkspaceEdit,
  type NormalizedWorkspaceEdit
} from "../src/core/workspace-edit.js";
import { filePathToUri } from "../src/utils/uri.js";

describe("workspace edit engine", () => {
  let rootPath: string;
  let rootRealPath: string;

  beforeEach(async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-edit-"));
    rootRealPath = await fs.realpath(rootPath);
    await fs.writeFile(path.join(rootPath, "a.ts"), "const alpha = 1;\nconst beta = 2;\n", "utf8");
    await fs.writeFile(path.join(rootPath, "b.ts"), "import { alpha } from './a';\n", "utf8");
  });

  afterEach(async () => {
    await fs.rm(rootPath, { recursive: true, force: true });
  });

  async function normalize(raw: unknown) {
    return normalizeWorkspaceEdit(raw, rootRealPath);
  }

  async function read(relative: string): Promise<string> {
    return fs.readFile(path.join(rootPath, relative), "utf8");
  }

  it("applies a single edit from the changes form", async () => {
    const edit = await normalize({
      changes: {
        [filePathToUri(path.join(rootPath, "a.ts"))]: [
          { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } }, newText: "gamma" }
        ]
      }
    });
    await validateWorkspaceEdit(edit, { rootRealPath });

    const result = await applyWorkspaceEdit(edit);

    expect(result).toMatchObject({ applied: true, changedFiles: [path.join(rootPath, "a.ts")], textEditCount: 1 });
    await expect(read("a.ts")).resolves.toBe("const gamma = 1;\nconst beta = 2;\n");
  });

  it("applies multiple edits in one file from the end to the start", async () => {
    const edit = await normalize({
      changes: {
        [filePathToUri(path.join(rootPath, "a.ts"))]: [
          { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } }, newText: "gamma" },
          { range: { start: { line: 1, character: 6 }, end: { line: 1, character: 10 } }, newText: "delta" }
        ]
      }
    });
    await validateWorkspaceEdit(edit, { rootRealPath });

    const result = await applyWorkspaceEdit(edit);

    expect(result.applied).toBe(true);
    await expect(read("a.ts")).resolves.toBe("const gamma = 1;\nconst delta = 2;\n");
  });

  it("applies edits across several files", async () => {
    const edit = await normalize({
      changes: {
        [filePathToUri(path.join(rootPath, "a.ts"))]: [
          { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } }, newText: "gamma" }
        ],
        [filePathToUri(path.join(rootPath, "b.ts"))]: [
          { range: { start: { line: 0, character: 9 }, end: { line: 0, character: 14 } }, newText: "gamma" }
        ]
      }
    });
    await validateWorkspaceEdit(edit, { rootRealPath });

    const result = await applyWorkspaceEdit(edit);

    expect(result.changedFiles.sort()).toEqual([path.join(rootPath, "a.ts"), path.join(rootPath, "b.ts")].sort());
    await expect(read("a.ts")).resolves.toContain("gamma");
    await expect(read("b.ts")).resolves.toContain("gamma");
  });

  it("handles documentChanges with TextDocumentEdit, CreateFile, RenameFile, DeleteFile", async () => {
    await fs.writeFile(path.join(rootPath, "old.ts"), "export const moved = 1;\n", "utf8");
    const edit = await normalize({
      documentChanges: [
        {
          textDocument: { uri: filePathToUri(path.join(rootPath, "a.ts")), version: null },
          edits: [{ range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } }, newText: "gamma" }]
        },
        { kind: "create", uri: filePathToUri(path.join(rootPath, "new.ts")), options: { content: "created" } },
        {
          kind: "rename",
          oldUri: filePathToUri(path.join(rootPath, "old.ts")),
          newUri: filePathToUri(path.join(rootPath, "renamed.ts"))
        }
      ]
    });
    await validateWorkspaceEdit(edit, { rootRealPath });
    const preview = previewWorkspaceEdit(edit);
    expect(preview.totalTextEdits).toBe(1);
    expect(preview.createdFiles).toEqual([path.join(rootPath, "new.ts")]);
    expect(preview.renamedFiles).toEqual([{ from: path.join(rootPath, "old.ts"), to: path.join(rootPath, "renamed.ts") }]);

    const result = await applyWorkspaceEdit(edit);

    expect(result.applied).toBe(true);
    await expect(read("new.ts")).resolves.toBe("created");
    await expect(read("renamed.ts")).resolves.toBe("export const moved = 1;\n");
    await expect(fs.access(path.join(rootPath, "old.ts"))).rejects.toThrow();
  });

  it("rejects overlapping edits", async () => {
    const edit = await normalize({
      changes: {
        [filePathToUri(path.join(rootPath, "a.ts"))]: [
          { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 11 } }, newText: "xxx" },
          { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } }, newText: "yyy" }
        ]
      }
    });

    await expect(validateWorkspaceEdit(edit, { rootRealPath })).rejects.toThrow("Overlapping text edits");
  });

  it("rejects paths outside the workspace root", async () => {
    const outside = path.join(os.tmpdir(), "codex-lsp-edit-outside.ts");
    const edit = normalizeWorkspaceEdit(
      { changes: { [filePathToUri(outside)]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "x" }] } },
      rootRealPath
    );

    await expect(edit).rejects.toThrow("outside workspace root");
  });

  it("rejects a version mismatch against the open document cache", async () => {
    const uri = filePathToUri(path.join(rootPath, "a.ts"));
    const edit = await normalize({
      documentChanges: [
        {
          textDocument: { uri, version: 3 },
          edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "x" }]
        }
      ]
    });

    await expect(validateWorkspaceEdit(edit, { rootRealPath, documentVersion: () => 7 })).rejects.toThrow(
      "Document version mismatch"
    );
    await expect(validateWorkspaceEdit(edit, { rootRealPath, documentVersion: () => 3 })).resolves.toBeUndefined();
  });

  it("reports partial application when a later file operation fails", async () => {
    const edit = await normalize({
      documentChanges: [
        {
          textDocument: { uri: filePathToUri(path.join(rootPath, "a.ts")), version: null },
          edits: [{ range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } }, newText: "gamma" }]
        },
        { kind: "delete", uri: filePathToUri(path.join(rootPath, "missing.ts")) }
      ]
    });
    await expect(validateWorkspaceEdit(edit, { rootRealPath })).rejects.toThrow("does not exist");

    // Bypass validation to exercise the partial-failure path of apply.
    const unvalidated: NormalizedWorkspaceEdit = {
      operations: [
        ...edit.operations.filter((operation) => operation.kind === "textEdit"),
        { kind: "delete", filePath: path.join(rootPath, "missing.ts"), recursive: false, ignoreIfNotExists: false }
      ]
    };
    const result = await applyWorkspaceEdit(unvalidated);

    expect(result.applied).toBe(false);
    expect(result.failure).toContain("missing.ts");
    expect(result.changedFiles).toEqual([path.join(rootPath, "a.ts")]);
    await expect(read("a.ts")).resolves.toContain("gamma");
  });

  it("treats a CreateFile on an existing path as an error unless overwrite or ignoreIfExists", async () => {
    const existing = filePathToUri(path.join(rootPath, "a.ts"));
    const edit = await normalize({ documentChanges: [{ kind: "create", uri: existing }] });
    await expect(validateWorkspaceEdit(edit, { rootRealPath })).rejects.toThrow("already exists");

    const ignoring = await normalize({ documentChanges: [{ kind: "create", uri: existing, options: { ignoreIfExists: true } }] });
    await expect(validateWorkspaceEdit(ignoring, { rootRealPath })).resolves.toBeUndefined();
  });

  it("clamps positions to the line end and handles multi-byte text (UTF-16)", async () => {
    await fs.writeFile(path.join(rootPath, "uni.ts"), "const s = \"привет\";\n", "utf8");
    const edit = await normalize({
      changes: {
        [filePathToUri(path.join(rootPath, "uni.ts"))]: [
          { range: { start: { line: 0, character: 11 }, end: { line: 0, character: 17 } }, newText: " мир" }
        ]
      }
    });
    await validateWorkspaceEdit(edit, { rootRealPath });

    await applyWorkspaceEdit(edit);

    await expect(read("uni.ts")).resolves.toBe('const s = " мир";\n');
  });
});

describe("positionToOffset", () => {
  it("maps line/character to string offsets", () => {
    const text = "ab\nпривет\nend";
    expect(positionToOffset(text, { line: 0, character: 1 })).toBe(1);
    expect(positionToOffset(text, { line: 1, character: 2 })).toBe(5);
    expect(positionToOffset(text, { line: 2, character: 0 })).toBe(10);
  });

  it("clamps beyond the end of a line and beyond the end of the text", () => {
    const text = "ab\nend";
    expect(positionToOffset(text, { line: 0, character: 99 })).toBe(2);
    expect(positionToOffset(text, { line: 99, character: 0 })).toBe(text.length);
  });
});
