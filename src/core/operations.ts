import type { WorkspaceRuntime } from "./workspace-runtime.js";
import { collectBridgeStatus } from "./status.js";
import { resolveWorkspaceDirectory, resolveWorkspaceFile, resolveWorkspaceTarget } from "./paths.js";
import type { Severity } from "./types.js";
import type { SupportedLanguage } from "../adapters/language-registry.js";

/**
 * Canonical operation layer (docs/THESAURUS.md, "Bridge Operation",
 * "Bridge Request"). Transports produce a BridgeRequest by decoding their own
 * syntax; executeOperation is the single semantic dispatch point. Semantic
 * validation (required fields, positive integers, symbol vs position mode)
 * lives here, never in the transports.
 */

export class OperationParseError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface BridgeRequest {
  /** Workspace selector (optional override); never an operation argument. */
  root?: string;
  operation: BridgeOperation;
}

export type BridgeOperation =
  | { kind: "status" }
  | { kind: "fileDiagnostics"; file: string; timeoutMs?: number }
  | { kind: "directoryDiagnostics"; dir: string; severity?: Severity; maxFiles?: number; timeoutBudgetMs?: number; concurrency?: number }
  | { kind: "definitionBySymbol"; symbol: string; language?: SupportedLanguage }
  | { kind: "definitionAt"; file: string; line: number; character: number }
  | { kind: "referencesBySymbol"; symbol: string; language?: SupportedLanguage }
  | { kind: "referencesAt"; file: string; line: number; character: number }
  | { kind: "symbols"; query: string; language?: SupportedLanguage }
  | { kind: "hoverBySymbol"; symbol: string; language?: SupportedLanguage }
  | { kind: "hoverAt"; file: string; line: number; character: number }
  | { kind: "renameAt"; file: string; line: number; character: number; newName: string }
  | { kind: "listCodeActions"; file: string; line: number; character: number; endLine?: number; endCharacter?: number; only?: string[] }
  | { kind: "applyCodeAction"; id: string }
  | { kind: "willRenameFiles"; oldPath: string; newPath: string; renamed?: boolean };

/** Rejects keys the operation does not declare (matches schemas' additionalProperties:false). */
function assertOnlyKeys(input: Record<string, unknown>, allowed: string[], operation: string): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      throw new OperationParseError(`${operation}: unexpected parameter '${key}'`);
    }
  }
}

function readRequiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OperationParseError(`${key} parameter is required`);
  }
  return value;
}

function readOptionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OperationParseError(`${key} parameter must be a non-empty string`);
  }
  return value;
}

function readOptionalPositiveInteger(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!isPositiveInteger(value)) {
    throw new OperationParseError(`${key} parameter must be a positive integer`);
  }
  return value;
}

function readRequiredPositiveInteger(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (!isPositiveInteger(value)) {
    throw new OperationParseError(`${key} parameter must be a positive integer`);
  }
  return value;
}

function readOptionalSeverity(input: Record<string, unknown>): Severity | undefined {
  const value = input.severity;
  if (value === undefined) return undefined;
  if (value !== "error" && value !== "warning" && value !== "information" && value !== "hint") {
    throw new OperationParseError(`severity parameter must be one of error, warning, information, hint`);
  }
  return value;
}

function readOptionalStringArray(input: Record<string, unknown>, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new OperationParseError(`${key} parameter must be an array of strings`);
  }
  return value;
}

function readOptionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new OperationParseError(`${key} parameter must be a boolean`);
  }
  return value;
}

function readOptionalLanguage(input: Record<string, unknown>): SupportedLanguage | undefined {
  return readOptionalString(input, "language");
}

function hasPosition(input: Record<string, unknown>): boolean {
  return input.file !== undefined || input.line !== undefined || input.character !== undefined;
}

function readPosition(input: Record<string, unknown>, operation: string): { file: string; line: number; character: number } {
  assertOnlyKeys(input, ["file", "line", "character", "language"], operation);
  if (input.language !== undefined) {
    throw new OperationParseError(`${operation}: 'language' is only valid for symbol-based lookups`);
  }
  const file = readRequiredString(input, "file");
  const line = readRequiredPositiveInteger(input, "line");
  const character = readRequiredPositiveInteger(input, "character");
  return { file, line, character };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function decodeStatus(input: Record<string, unknown>): BridgeOperation {
  assertOnlyKeys(input, [], "status");
  return { kind: "status" };
}

export function decodeFileDiagnostics(input: Record<string, unknown>): BridgeOperation {
  assertOnlyKeys(input, ["file", "timeoutMs"], "diagnostics");
  const operation: BridgeOperation = {
    kind: "fileDiagnostics",
    file: readRequiredString(input, "file")
  };
  const timeoutMs = readOptionalPositiveInteger(input, "timeoutMs");
  if (timeoutMs !== undefined) (operation as { timeoutMs?: number }).timeoutMs = timeoutMs;
  return operation;
}

export function decodeDirectoryDiagnostics(input: Record<string, unknown>): BridgeOperation {
  assertOnlyKeys(input, ["dir", "severity", "maxFiles", "timeoutBudgetMs", "concurrency"], "directory diagnostics");
  const operation: BridgeOperation = {
    kind: "directoryDiagnostics",
    dir: readRequiredString(input, "dir")
  };
  const severity = readOptionalSeverity(input);
  if (severity !== undefined) (operation as { severity?: Severity }).severity = severity;
  const maxFiles = readOptionalPositiveInteger(input, "maxFiles");
  if (maxFiles !== undefined) (operation as { maxFiles?: number }).maxFiles = maxFiles;
  const timeoutBudgetMs = readOptionalPositiveInteger(input, "timeoutBudgetMs");
  if (timeoutBudgetMs !== undefined) (operation as { timeoutBudgetMs?: number }).timeoutBudgetMs = timeoutBudgetMs;
  const concurrency = readOptionalPositiveInteger(input, "concurrency");
  if (concurrency !== undefined) (operation as { concurrency?: number }).concurrency = concurrency;
  return operation;
}

export function decodeDefinition(input: Record<string, unknown>): BridgeOperation {
  assertOnlyKeys(input, ["symbol", "file", "line", "character", "language"], "definition");
  if (input.symbol !== undefined) {
    if (hasPosition(input)) {
      throw new OperationParseError("definition: symbol and file/line/character cannot be combined");
    }
    return { kind: "definitionBySymbol", symbol: readRequiredString(input, "symbol"), ...withLanguage(input) };
  }
  if (hasPosition(input)) {
    return { kind: "definitionAt", ...readPosition(input, "definition") };
  }
  throw new OperationParseError("definition: symbol or file+line+character is required");
}

export function decodeReferences(input: Record<string, unknown>): BridgeOperation {
  assertOnlyKeys(input, ["symbol", "file", "line", "character", "language"], "references");
  if (input.symbol !== undefined) {
    if (hasPosition(input)) {
      throw new OperationParseError("references: symbol and file/line/character cannot be combined");
    }
    return { kind: "referencesBySymbol", symbol: readRequiredString(input, "symbol"), ...withLanguage(input) };
  }
  if (hasPosition(input)) {
    return { kind: "referencesAt", ...readPosition(input, "references") };
  }
  throw new OperationParseError("references: symbol or file+line+character is required");
}

export function decodeHover(input: Record<string, unknown>): BridgeOperation {
  assertOnlyKeys(input, ["symbol", "file", "line", "character", "language"], "hover");
  if (input.symbol !== undefined) {
    if (hasPosition(input)) {
      throw new OperationParseError("hover: symbol and file/line/character cannot be combined");
    }
    return { kind: "hoverBySymbol", symbol: readRequiredString(input, "symbol"), ...withLanguage(input) };
  }
  if (hasPosition(input)) {
    return { kind: "hoverAt", ...readPosition(input, "hover") };
  }
  throw new OperationParseError("hover: symbol or file+line+character is required");
}

export function decodeSymbols(input: Record<string, unknown>): BridgeOperation {
  assertOnlyKeys(input, ["query", "language"], "symbols");
  const operation: BridgeOperation = { kind: "symbols", query: readRequiredString(input, "query") };
  const language = readOptionalLanguage(input);
  if (language !== undefined) (operation as { language?: SupportedLanguage }).language = language;
  return operation;
}

export function decodeRename(input: Record<string, unknown>): BridgeOperation {
  assertOnlyKeys(input, ["file", "line", "character", "newName"], "rename");
  return {
    kind: "renameAt",
    file: readRequiredString(input, "file"),
    line: readRequiredPositiveInteger(input, "line"),
    character: readRequiredPositiveInteger(input, "character"),
    newName: readRequiredString(input, "newName")
  };
}

export function decodeListCodeActions(input: Record<string, unknown>): BridgeOperation {
  assertOnlyKeys(input, ["file", "line", "character", "endLine", "endCharacter", "only"], "code actions");
  const line = readRequiredPositiveInteger(input, "line");
  const character = readRequiredPositiveInteger(input, "character");
  const operation: BridgeOperation = {
    kind: "listCodeActions",
    file: readRequiredString(input, "file"),
    line,
    character
  };
  const endLine = readOptionalPositiveInteger(input, "endLine");
  const endCharacter = readOptionalPositiveInteger(input, "endCharacter");
  if (endLine !== undefined || endCharacter !== undefined) {
    if (endLine === undefined || endCharacter === undefined) {
      throw new OperationParseError("code actions: endLine and endCharacter must be provided together");
    }
    (operation as { endLine?: number }).endLine = endLine;
    (operation as { endCharacter?: number }).endCharacter = endCharacter;
    if (endLine < line || (endLine === line && endCharacter < character)) {
      throw new OperationParseError("code actions: range end must not precede range start");
    }
  }
  const only = readOptionalStringArray(input, "only");
  if (only !== undefined) (operation as { only?: string[] }).only = only;
  return operation;
}

export function decodeApplyCodeAction(input: Record<string, unknown>): BridgeOperation {
  assertOnlyKeys(input, ["id"], "apply code action");
  return { kind: "applyCodeAction", id: readRequiredString(input, "id") };
}

export function decodeWillRenameFiles(input: Record<string, unknown>): BridgeOperation {
  assertOnlyKeys(input, ["oldPath", "newPath", "renamed"], "file rename");
  return {
    kind: "willRenameFiles",
    oldPath: readRequiredString(input, "oldPath"),
    newPath: readRequiredString(input, "newPath"),
    renamed: readOptionalBoolean(input, "renamed") ?? false
  };
}

function withLanguage(input: Record<string, unknown>): { language?: SupportedLanguage } {
  const language = readOptionalLanguage(input);
  return language !== undefined ? { language } : {};
}

/**
 * The single semantic dispatch point. Paths are resolved against the
 * Workspace Root here; transports never resolve files or routes languages.
 */
export async function executeOperation(runtime: WorkspaceRuntime, operation: BridgeOperation): Promise<unknown> {
  switch (operation.kind) {
    case "status":
      return collectBridgeStatus(runtime.root, runtime);
    case "fileDiagnostics":
      return runtime.commands.diagnostics(
        await resolveWorkspaceFile(runtime.root, operation.file),
        operation.timeoutMs !== undefined ? { timeoutMs: operation.timeoutMs } : undefined
      );
    case "directoryDiagnostics":
      return runtime.directoryDiagnostics.collect({
        dir: await resolveWorkspaceDirectory(runtime.root, operation.dir),
        ...(operation.severity !== undefined ? { severity: operation.severity } : {}),
        ...(operation.maxFiles !== undefined ? { maxFiles: operation.maxFiles } : {}),
        ...(operation.timeoutBudgetMs !== undefined ? { timeoutBudgetMs: operation.timeoutBudgetMs } : {}),
        ...(operation.concurrency !== undefined ? { concurrency: operation.concurrency } : {})
      });
    case "definitionBySymbol":
      return runtime.commands.definition(operation.symbol, operation.language);
    case "definitionAt":
      return runtime.commands.definitionAt({
        file: await resolveWorkspaceFile(runtime.root, operation.file),
        line: operation.line,
        character: operation.character
      });
    case "referencesBySymbol":
      return runtime.commands.references(operation.symbol, operation.language);
    case "referencesAt":
      return runtime.commands.referencesAt({
        file: await resolveWorkspaceFile(runtime.root, operation.file),
        line: operation.line,
        character: operation.character
      });
    case "symbols":
      return runtime.commands.symbols(operation.query, operation.language);
    case "hoverBySymbol":
      return runtime.commands.hover(operation.symbol, operation.language);
    case "hoverAt":
      return runtime.commands.hoverAt({
        file: await resolveWorkspaceFile(runtime.root, operation.file),
        line: operation.line,
        character: operation.character
      });
    case "renameAt":
      return runtime.commands.rename(
        {
          file: await resolveWorkspaceFile(runtime.root, operation.file),
          line: operation.line,
          character: operation.character
        },
        operation.newName
      );
    case "listCodeActions": {
      const file = await resolveWorkspaceFile(runtime.root, operation.file);
      const end = operation.endLine !== undefined ? { line: operation.endLine, character: operation.endCharacter as number } : undefined;
      const endPosition = end ?? { line: operation.line, character: operation.character };
      return runtime.commands.listCodeActions(
        file,
        {
          start: { line: operation.line, character: operation.character },
          end: endPosition
        },
        operation.only
      );
    }
    case "applyCodeAction":
      return runtime.commands.applyCodeAction(operation.id);
    case "willRenameFiles": {
      const oldPath = await resolveWorkspaceTarget(runtime.root, operation.oldPath);
      const newPath = await resolveWorkspaceTarget(runtime.root, operation.newPath);
      return runtime.commands.willRenameFiles(oldPath, newPath, operation.renamed ?? false);
    }
  }
}