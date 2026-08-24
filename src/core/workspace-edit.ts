import fs from "node:fs/promises";
import path from "node:path";
import { filePathToUri, uriToFilePath } from "../utils/uri.js";

/**
 * The Workspace Edit pipeline: the only carrier of changes in the bridge.
 * Language servers return raw WorkspaceEdit structures; every edit — from a
 * tool command or from a server-initiated workspace/applyEdit — goes through
 * normalize -> validate -> preview -> apply (docs/THESAURUS.md, "Workspace Edit").
 */

export interface Position {
  line: number;
  character: number;
}

export interface TextEdit {
  range: { start: Position; end: Position };
  newText: string;
}

/** A normalized, validated text edit with resolved absolute offsets. */
export interface ResolvedTextEdit {
  start: number;
  end: number;
  newText: string;
}

export type EditOperation =
  | { kind: "textEdit"; filePath: string; edits: TextEdit[]; version?: number | null }
  | { kind: "create"; filePath: string; content?: string; overwrite: boolean; ignoreIfExists: boolean }
  | { kind: "rename"; oldPath: string; newPath: string; overwrite: boolean; ignoreIfExists: boolean }
  | { kind: "delete"; filePath: string; recursive: boolean; ignoreIfNotExists: boolean };

export interface NormalizedWorkspaceEdit {
  operations: EditOperation[];
}

export interface WorkspaceEditPreview {
  textEdits: Array<{ file: string; count: number }>;
  createdFiles: string[];
  renamedFiles: Array<{ from: string; to: string }>;
  deletedFiles: string[];
  totalTextEdits: number;
}

export interface WorkspaceEditResult {
  applied: boolean;
  failure?: string;
  changedFiles: string[];
  createdFiles: string[];
  renamedFiles: Array<{ from: string; to: string }>;
  deletedFiles: string[];
  textEditCount: number;
}

export interface ValidateContext {
  rootRealPath: string;
  /** Version of a document as known to the bridge, if the document is open. */
  documentVersion?: (uri: string) => number | undefined;
}

/** Normalizes a raw LSP WorkspaceEdit (changes | documentChanges) into operations with absolute paths. */
export async function normalizeWorkspaceEdit(raw: unknown, rootRealPath: string): Promise<NormalizedWorkspaceEdit> {
  if (!raw || typeof raw !== "object") {
    throw new Error("Workspace edit must be an object");
  }
  const record = raw as {
    changes?: Record<string, TextEdit[]>;
    documentChanges?: unknown[];
  };

  const operations: EditOperation[] = [];

  if (record.documentChanges !== undefined) {
    if (!Array.isArray(record.documentChanges)) {
      throw new Error("Workspace edit documentChanges must be an array");
    }
    for (const change of record.documentChanges) {
      operations.push(await normalizeDocumentChange(change, rootRealPath));
    }
  } else if (record.changes !== undefined) {
    if (!record.changes || typeof record.changes !== "object") {
      throw new Error("Workspace edit changes must be an object");
    }
    for (const [uri, edits] of Object.entries(record.changes)) {
      if (!Array.isArray(edits)) {
        throw new Error(`Workspace edit changes for ${uri} must be an array`);
      }
      operations.push({ kind: "textEdit", filePath: await resolveEditPath(uri, rootRealPath), edits });
    }
  }

  return { operations };
}

async function normalizeDocumentChange(change: unknown, rootRealPath: string): Promise<EditOperation> {
  if (!change || typeof change !== "object") {
    throw new Error("Workspace edit document change must be an object");
  }
  const record = change as Record<string, unknown>;

  if (record.kind === "create") {
    const options = record.options as Record<string, unknown> | undefined;
    return {
      kind: "create",
      filePath: await resolveEditPath(readString(record, "uri"), rootRealPath),
      content: typeof options?.content === "string" ? options.content : undefined,
      overwrite: options?.overwrite === true,
      ignoreIfExists: options?.ignoreIfExists === true
    };
  }
  if (record.kind === "rename") {
    const options = record.options as Record<string, unknown> | undefined;
    return {
      kind: "rename",
      oldPath: await resolveEditPath(readString(record, "oldUri"), rootRealPath),
      newPath: await resolveEditPath(readString(record, "newUri"), rootRealPath),
      overwrite: options?.overwrite === true,
      ignoreIfExists: options?.ignoreIfExists === true
    };
  }
  if (record.kind === "delete") {
    const options = record.options as Record<string, unknown> | undefined;
    return {
      kind: "delete",
      filePath: await resolveEditPath(readString(record, "uri"), rootRealPath),
      recursive: options?.recursive === true,
      ignoreIfNotExists: options?.ignoreIfNotExists === true
    };
  }

  // TextDocumentEdit: { textDocument: { uri, version }, edits: TextEdit[] }
  const textDocument = record.textDocument as { uri?: unknown; version?: unknown } | undefined;
  if (!textDocument || typeof textDocument.uri !== "string" || !Array.isArray(record.edits)) {
    throw new Error("Workspace edit document change must be a TextDocumentEdit, CreateFile, RenameFile, or DeleteFile");
  }
  return {
    kind: "textEdit",
    filePath: await resolveEditPath(textDocument.uri, rootRealPath),
    edits: record.edits as TextEdit[],
    version: typeof textDocument.version === "number" ? textDocument.version : null
  };
}

/** Validates the edit: paths inside root, no overlapping ranges, version match, file preconditions. */
export async function validateWorkspaceEdit(edit: NormalizedWorkspaceEdit, context: ValidateContext): Promise<void> {
  const textEditsByFile = new Map<string, { uri?: string; version?: number | null; edits: TextEdit[] }>();

  for (const operation of edit.operations) {
    switch (operation.kind) {
      case "textEdit": {
        const existing = textEditsByFile.get(operation.filePath);
        if (existing) {
          existing.edits.push(...operation.edits);
          if (operation.version !== undefined && operation.version !== null) {
            if (existing.version !== undefined && existing.version !== null && existing.version !== operation.version) {
              throw new Error(`Conflicting document versions for ${operation.filePath}: ${existing.version} vs ${operation.version}`);
            }
            existing.version = operation.version;
          }
        } else {
          textEditsByFile.set(operation.filePath, { version: operation.version, edits: [...operation.edits] });
        }
        break;
      }
      case "create": {
        if (await fileExists(operation.filePath)) {
          if (!operation.overwrite && !operation.ignoreIfExists) {
            throw new Error(`File already exists: ${operation.filePath}`);
          }
        } else {
          await assertParentExists(operation.filePath);
        }
        break;
      }
      case "rename": {
        if (!(await fileExists(operation.oldPath))) {
          throw new Error(`File to rename does not exist: ${operation.oldPath}`);
        }
        if (await fileExists(operation.newPath)) {
          if (!operation.overwrite && !operation.ignoreIfExists) {
            throw new Error(`Rename target already exists: ${operation.newPath}`);
          }
        }
        break;
      }
      case "delete": {
        if (!(await fileExists(operation.filePath)) && !operation.ignoreIfNotExists) {
          throw new Error(`File to delete does not exist: ${operation.filePath}`);
        }
        break;
      }
    }
  }

  for (const [filePath, group] of textEditsByFile) {
    if (!(await fileExists(filePath))) {
      throw new Error(`Cannot edit a file that does not exist: ${filePath}`);
    }
    if (group.version !== undefined && group.version !== null && context.documentVersion) {
      const known = context.documentVersion(filePathToUri(filePath));
      if (known !== undefined && known !== group.version) {
        throw new Error(`Document version mismatch for ${filePath}: server expects ${group.version}, bridge has ${known}`);
      }
    }

    // Resolve offsets against the current file content, then check overlaps.
    const text = await fs.readFile(filePath, "utf8");
    const resolved: ResolvedTextEdit[] = group.edits.map((edit) => ({
      start: positionToOffset(text, edit.range.start),
      end: positionToOffset(text, edit.range.end),
      newText: edit.newText
    }));
    resolved.sort((left, right) => left.start - right.start || left.end - right.end);
    for (let index = 1; index < resolved.length; index += 1) {
      if (resolved[index].start < resolved[index - 1].end) {
        throw new Error(`Overlapping text edits in ${filePath} at offsets ${resolved[index - 1].start} and ${resolved[index].start}`);
      }
    }
  }
}

/** Human-readable summary of the edit without touching the file system. */
export function previewWorkspaceEdit(edit: NormalizedWorkspaceEdit): WorkspaceEditPreview {
  const byFile = new Map<string, number>();
  const createdFiles: string[] = [];
  const renamedFiles: Array<{ from: string; to: string }> = [];
  const deletedFiles: string[] = [];
  let totalTextEdits = 0;

  for (const operation of edit.operations) {
    if (operation.kind === "textEdit") {
      byFile.set(operation.filePath, (byFile.get(operation.filePath) ?? 0) + operation.edits.length);
      totalTextEdits += operation.edits.length;
    } else if (operation.kind === "create") {
      createdFiles.push(operation.filePath);
    } else if (operation.kind === "rename") {
      renamedFiles.push({ from: operation.oldPath, to: operation.newPath });
    } else {
      deletedFiles.push(operation.filePath);
    }
  }

  return {
    textEdits: [...byFile.entries()].map(([file, count]) => ({ file, count })),
    createdFiles,
    renamedFiles,
    deletedFiles,
    totalTextEdits
  };
}

/** Applies the edit. Text contents are computed in memory first; a failure mid-way reports what was applied. */
export async function applyWorkspaceEdit(edit: NormalizedWorkspaceEdit): Promise<WorkspaceEditResult> {
  const changedFiles = new Set<string>();
  const createdFiles: string[] = [];
  const renamedFiles: Array<{ from: string; to: string }> = [];
  const deletedFiles: string[] = [];
  let textEditCount = 0;

  const applyTextEdits = async (operation: Extract<EditOperation, { kind: "textEdit" }>) => {
    const text = await fs.readFile(operation.filePath, "utf8");
    const resolved = operation.edits.map((edit) => ({
      start: positionToOffset(text, edit.range.start),
      end: positionToOffset(text, edit.range.end),
      newText: edit.newText
    }));
    resolved.sort((left, right) => left.start - right.start || left.end - right.end);

    let result = text;
    // Apply from the end so earlier offsets stay valid.
    for (let index = resolved.length - 1; index >= 0; index -= 1) {
      const edit = resolved[index];
      result = result.slice(0, edit.start) + edit.newText + result.slice(edit.end);
    }
    if (result !== text) {
      await fs.writeFile(operation.filePath, result, "utf8");
    }
    changedFiles.add(operation.filePath);
    textEditCount += operation.edits.length;
  };

  try {
    // Text edits first, then file operations.
    for (const operation of edit.operations) {
      if (operation.kind === "textEdit") {
        await applyTextEdits(operation);
      }
    }
    for (const operation of edit.operations) {
      if (operation.kind !== "textEdit") {
        if (operation.kind === "create") {
          if (await fileExists(operation.filePath)) {
            if (operation.ignoreIfExists && !operation.overwrite) continue;
            if (!operation.overwrite) throw new Error(`File already exists: ${operation.filePath}`);
          }
          await fs.mkdir(path.dirname(operation.filePath), { recursive: true });
          await fs.writeFile(operation.filePath, operation.content ?? "", "utf8");
          createdFiles.push(operation.filePath);
        } else if (operation.kind === "rename") {
          if (await fileExists(operation.newPath)) {
            if (operation.ignoreIfExists && !operation.overwrite) continue;
            if (!operation.overwrite) throw new Error(`Rename target already exists: ${operation.newPath}`);
          }
          await fs.mkdir(path.dirname(operation.newPath), { recursive: true });
          await fs.rename(operation.oldPath, operation.newPath);
          renamedFiles.push({ from: operation.oldPath, to: operation.newPath });
        } else {
          if (!(await fileExists(operation.filePath))) {
            if (operation.ignoreIfNotExists) continue;
            throw new Error(`File to delete does not exist: ${operation.filePath}`);
          }
          await fs.rm(operation.filePath, { recursive: operation.recursive });
          deletedFiles.push(operation.filePath);
        }
      }
    }
  } catch (error) {
    return {
      applied: false,
      failure: error instanceof Error ? error.message : String(error),
      changedFiles: [...changedFiles],
      createdFiles,
      renamedFiles,
      deletedFiles,
      textEditCount
    };
  }

  return {
    applied: true,
    changedFiles: [...changedFiles],
    createdFiles,
    renamedFiles,
    deletedFiles,
    textEditCount
  };
}

/** Converts an LSP (0-based, UTF-16 code units) position into a string offset; clamps to the line end. */
export function positionToOffset(text: string, position: Position): number {
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) {
    const newline = text.indexOf("\n", offset);
    if (newline === -1) return text.length;
    offset = newline + 1;
  }

  const newline = text.indexOf("\n", offset);
  const lineEnd = newline === -1 ? text.length : newline - (text[newline - 1] === "\r" ? 1 : 0);
  return Math.min(offset + position.character, lineEnd);
}

async function resolveEditPath(uri: unknown, rootRealPath: string): Promise<string> {
  if (typeof uri !== "string" || uri.length === 0) {
    throw new Error("Workspace edit URI must be a non-empty string");
  }
  const filePath = path.resolve(uriToFilePath(uri));
  try {
    const realFilePath = await fs.realpath(filePath);
    if (!isInsideRoot(realFilePath, rootRealPath)) {
      throw new Error(`Workspace edit target is outside workspace root: ${filePath}`);
    }
    return realFilePath;
  } catch (error) {
    if (error instanceof Error && error.message.includes("outside workspace root")) throw error;
    // The file may not exist yet (CreateFile / RenameFile target): check lexically.
    if (!isInsideRoot(filePath, rootRealPath)) {
      throw new Error(`Workspace edit target is outside workspace root: ${filePath}`);
    }
    return filePath;
  }
}

async function assertParentExists(filePath: string): Promise<void> {
  if (!(await fileExists(path.dirname(filePath)))) {
    throw new Error(`Parent directory does not exist: ${path.dirname(filePath)}`);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isInsideRoot(filePath: string, rootPath: string): boolean {
  return filePath === rootPath || filePath.startsWith(`${rootPath}${path.sep}`);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Workspace edit operation is missing '${key}'`);
  }
  return value;
}

