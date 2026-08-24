import fs from "node:fs/promises";
import path from "node:path";
import type { LspClient, ServerProcessConfig } from "./json-rpc-lsp-client.js";
import { lspSeverityToText } from "./diagnostics.js";
import type { Diagnostic, DiagnosticOptions, DiagnosticReport, DocumentPosition, HoverInfo, Location, Position, RenameSummary, SemanticProvider, SymbolMatch } from "./types.js";
import {
  applyWorkspaceEdit as applyEdit,
  normalizeWorkspaceEdit,
  validateWorkspaceEdit,
  type NormalizedWorkspaceEdit,
  type WorkspaceEditResult
} from "./workspace-edit.js";
import { filePathToUri, uriToFilePath } from "../utils/uri.js";

interface LspDiagnostic {
  range: { start: Position; end: Position };
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

interface LspLocation {
  uri: string;
  range: { start: Position; end: Position };
}

interface LspSymbol {
  name: string;
  kind?: number;
  containerName?: string;
  location: LspLocation;
}

interface LspHover {
  contents: string | { value: string } | Array<string | { value: string }>;
}

interface LspPrepareRename {
  range: { start: Position; end: Position };
  placeholder?: string;
}

const defaultDiagnosticsTimeoutMs = 15000;

export interface LspSemanticProviderOptions {
  rootPath: string;
  languageId: string;
  server: ServerProcessConfig;
  clientFactory: (config: ServerProcessConfig) => LspClient;
  workspaceSeedFiles?: string[];
  workspaceSeedExtensions?: string[];
  diagnosticsTimeoutMs?: number;
}

export class LspSemanticProvider implements SemanticProvider {
  private initialized = false;
  private workspaceDocumentOpened = false;
  private diagnosticsByUri = new Map<string, Diagnostic[]>();
  private diagnosticsRevisionByUri = new Map<string, number>();
  private openedDocumentsByUri = new Map<string, { text: string; version: number }>();
  private diagnosticsWaitersByUri = new Map<
    string,
    Array<{
      minRevision: number;
      resolve: () => void;
      timer: NodeJS.Timeout;
    }>
  >();
  private readonly rootRealPathPromise: Promise<string>;
  private editQueue: Promise<unknown> = Promise.resolve();
  private client: LspClient;

  constructor(private readonly options: LspSemanticProviderOptions) {
    this.rootRealPathPromise = fs.realpath(options.rootPath);
    this.client = options.clientFactory(options.server);
    this.client.on("notification", (method: string, params: unknown) => {
      if (method === "textDocument/publishDiagnostics") {
        this.captureDiagnostics(params);
      }
    });
    this.client.on("request", (id, method, params) => {
      this.handleServerRequest(id, method, params);
    });
    this.client.on("exit", () => {
      this.initialized = false;
      this.workspaceDocumentOpened = false;
      this.openedDocumentsByUri.clear();
    });
  }

  async diagnostics(uri?: string, options: DiagnosticOptions = {}): Promise<DiagnosticReport> {
    const initialized = await this.ensureInitializedForDiagnostics();
    if (!initialized.ok) {
      return {
        status: "unavailable",
        timedOut: false,
        stale: false,
        unavailableReason: initialized.reason,
        items: []
      };
    }

    if (uri) {
      const document = await this.resolveDocument(uri);
      const currentRevision = this.diagnosticsRevisionByUri.get(document.uri) ?? 0;
      const openedDocument = await this.openOrUpdateDocument(document.uri);
      let timedOut = false;
      if (openedDocument.changed || !this.diagnosticsByUri.has(document.uri)) {
        timedOut = !(await this.waitForDiagnostics(document.uri, currentRevision + 1, options.timeoutMs));
      }
      const sourceRevision = this.diagnosticsRevisionByUri.get(document.uri);
      return {
        status: timedOut ? "timed_out" : "ok",
        timedOut,
        stale: timedOut && sourceRevision !== undefined && sourceRevision <= currentRevision,
        sourceRevision,
        items: [...(this.diagnosticsByUri.get(document.uri) ?? [])]
      };
    }

    return {
      status: "ok",
      timedOut: false,
      stale: false,
      items: [...this.diagnosticsByUri.values()].flat()
    };
  }

  private async ensureInitializedForDiagnostics(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await this.ensureInitialized();
      return { ok: true };
    } catch (error) {
      if (isMissingLanguageServerError(error)) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
      throw error;
    }
  }

  async definition(symbol: string): Promise<Location> {
    const match = await this.resolveSingleSymbol(symbol);
    return this.definitionAt(match);
  }

  async definitionAt(position: DocumentPosition): Promise<Location> {
    const document = await this.openOrUpdateDocument(filePathToUri(position.file));
    if (this.options.languageId === "typescript") {
      const sourceDefinitions = await this.client.request<LspLocation[] | null>("workspace/executeCommand", {
        command: "_typescript.goToSourceDefinition",
        arguments: [document.uri, toLspPosition(position)]
      });
      if (!sourceDefinitions || sourceDefinitions.length === 0) {
        throw new Error(`No source definition found at ${formatPosition(position)}`);
      }
      return this.toLocation(sourceDefinitions[0]);
    }

    const result = await this.client.request<LspLocation | LspLocation[] | null>("textDocument/definition", {
      textDocument: { uri: document.uri },
      position: toLspPosition(position)
    });
    const location = Array.isArray(result) ? result[0] : result;
    if (!location) throw new Error(`No definition found at ${formatPosition(position)}`);
    return this.toLocation(location);
  }

  async references(symbol: string): Promise<Location[]> {
    const match = await this.resolveSingleSymbol(symbol);
    return this.referencesAt(match);
  }

  async referencesAt(position: DocumentPosition): Promise<Location[]> {
    const document = await this.openOrUpdateDocument(filePathToUri(position.file));
    const result = await this.client.request<LspLocation[]>("textDocument/references", {
      textDocument: { uri: document.uri },
      position: toLspPosition(position),
      context: { includeDeclaration: true }
    });
    return result.map((location) => this.toLocation(location));
  }

  async symbols(query: string): Promise<SymbolMatch[]> {
    await this.ensureInitialized();
    await this.ensureWorkspaceDocumentOpened();
    const symbols = await this.client.request<LspSymbol[]>("workspace/symbol", { query });
    return symbols.map((symbol) => ({
      ...this.toLocation(symbol.location),
      name: symbol.name,
      kind: typeof symbol.kind === "number" ? symbolKindName(symbol.kind) : undefined,
      containerName: symbol.containerName
    }));
  }

  async hover(symbol: string): Promise<HoverInfo> {
    const match = await this.resolveSingleSymbol(symbol);
    return this.hoverAt(match);
  }

  async hoverAt(position: DocumentPosition): Promise<HoverInfo> {
    const document = await this.openOrUpdateDocument(filePathToUri(position.file));
    const result = await this.client.request<LspHover | null>("textDocument/hover", {
      textDocument: { uri: document.uri },
      position: toLspPosition(position)
    });
    if (!result) throw new Error(`No hover information found at ${formatPosition(position)}`);

    return {
      file: document.filePath,
      line: position.line,
      character: position.character,
      contents: normalizeHoverContents(result.contents)
    };
  }

  async rename(position: DocumentPosition, newName: string): Promise<RenameSummary> {
    if (newName.trim().length === 0) throw new Error("New name is required");
    const document = await this.openOrUpdateDocument(filePathToUri(position.file));
    const lspPosition = toLspPosition(position);

    const oldName = await this.prepareRename(document.uri, lspPosition);

    const edit = await this.client.request<unknown | null>("textDocument/rename", {
      textDocument: { uri: document.uri },
      position: lspPosition,
      newName
    });
    if (!edit) throw new Error(`The language server cannot rename the symbol at ${formatPosition(position)}`);

    const result = await this.applyWorkspaceEdit(edit);
    if (!result.applied) {
      throw new Error(result.failure ?? "Applying the rename edit failed");
    }

    return {
      ...(oldName !== undefined ? { oldName } : {}),
      newName,
      changedFiles: result.changedFiles,
      createdFiles: result.createdFiles,
      renamedFiles: result.renamedFiles,
      deletedFiles: result.deletedFiles,
      editCount: result.textEditCount
    };
  }

  /** Returns the placeholder for the symbol under the cursor, or undefined when the server has no prepareRename. */
  private async prepareRename(uri: string, lspPosition: Position): Promise<string | undefined> {
    let prepare: LspPrepareRename | null;
    try {
      prepare = await this.client.request<LspPrepareRename | null>("textDocument/prepareRename", {
        textDocument: { uri },
        position: lspPosition
      });
    } catch {
      return undefined; // prepareRename is optional — fall back to a direct rename request
    }
    if (!prepare) {
      throw new Error("The cursor is not on a renameable symbol");
    }

    const range = "range" in prepare ? prepare.range : prepare;
    if (!rangeContains(range, lspPosition)) {
      throw new Error("The cursor is not on a renameable symbol");
    }
    return "placeholder" in prepare && typeof prepare.placeholder === "string" ? prepare.placeholder : undefined;
  }

  async dispose(): Promise<void> {
    if (this.initialized) {
      for (const uri of this.openedDocumentsByUri.keys()) {
        this.client.notify("textDocument/didClose", {
          textDocument: { uri }
        });
      }
    }
    this.openedDocumentsByUri.clear();
    await this.client.stop();
  }

  private handleServerRequest(id: number, method: string, params: unknown): void {
    if (method === "workspace/applyEdit") {
      const edit = (params as { edit?: unknown } | null)?.edit;
      void this.applyWorkspaceEdit(edit)
        .then((result) => {
          this.client.respond(id, {
            applied: result.applied,
            ...(result.failure ? { failureReason: result.failure } : {})
          });
        })
        .catch((error: unknown) => {
          this.client.respond(id, {
            applied: false,
            failureReason: error instanceof Error ? error.message : String(error)
          });
        });
      return;
    }
    if (method === "workspace/configuration") {
      const items = (params as { items?: unknown[] } | null)?.items ?? [];
      this.client.respond(id, items.map(() => ({})));
      return;
    }
    // window/workDoneProgress/create, window/showMessageRequest,
    // client/(un)registerCapability, unknown methods: acknowledge so the
    // server never hangs.
    this.client.respond(id, null);
  }

  /** The single entry point for applying server-returned edits; serialized so concurrent edits cannot interleave. */
  async applyWorkspaceEdit(raw: unknown): Promise<WorkspaceEditResult> {
    const run = async (): Promise<WorkspaceEditResult> => {
      const rootRealPath = await this.rootRealPathPromise;
      const edit = await normalizeWorkspaceEdit(raw, rootRealPath);
      await validateWorkspaceEdit(edit, {
        rootRealPath,
        documentVersion: (uri) => this.openedDocumentsByUri.get(uri)?.version
      });
      const result = await applyEdit(edit);
      if (result.applied) {
        await this.syncAfterWorkspaceEdit(edit);
      }
      return result;
    };

    const previous = this.editQueue;
    const next = previous.then(run, run);
    this.editQueue = next.catch(() => undefined);
    return next;
  }

  private async syncAfterWorkspaceEdit(edit: NormalizedWorkspaceEdit): Promise<void> {
    const createdUris: string[] = [];
    const renamedUris: Array<{ oldUri: string; newUri: string }> = [];
    const deletedUris: string[] = [];

    for (const operation of edit.operations) {
      if (operation.kind === "textEdit") {
        const uri = filePathToUri(operation.filePath);
        if (this.openedDocumentsByUri.has(uri)) {
          await this.openOrUpdateDocument(uri);
        }
      } else if (operation.kind === "create") {
        createdUris.push(filePathToUri(operation.filePath));
      } else if (operation.kind === "rename") {
        renamedUris.push({ oldUri: filePathToUri(operation.oldPath), newUri: filePathToUri(operation.newPath) });
        const oldUri = filePathToUri(operation.oldPath);
        if (this.openedDocumentsByUri.has(oldUri)) {
          this.client.notify("textDocument/didClose", { textDocument: { uri: oldUri } });
          this.openedDocumentsByUri.delete(oldUri);
        }
      } else {
        deletedUris.push(filePathToUri(operation.filePath));
        const uri = filePathToUri(operation.filePath);
        if (this.openedDocumentsByUri.has(uri)) {
          this.client.notify("textDocument/didClose", { textDocument: { uri } });
          this.openedDocumentsByUri.delete(uri);
        }
      }
    }

    if (createdUris.length > 0) {
      this.client.notify("workspace/didCreateFiles", { files: createdUris.map((uri) => ({ uri })) });
    }
    if (renamedUris.length > 0) {
      this.client.notify("workspace/didRenameFiles", {
        files: renamedUris.map(({ oldUri, newUri }) => ({ oldUri, newUri }))
      });
    }
    if (deletedUris.length > 0) {
      this.client.notify("workspace/didDeleteFiles", { files: deletedUris.map((uri) => ({ uri })) });
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    await this.client.request("initialize", {
      processId: process.pid,
      rootPath: this.options.rootPath,
      rootUri: filePathToUri(this.options.rootPath),
      workspaceFolders: [
        {
          uri: filePathToUri(this.options.rootPath),
          name: path.basename(this.options.rootPath)
        }
      ],
      capabilities: {
        general: {
          positionEncodings: ["utf-16"]
        },
        textDocument: {
          publishDiagnostics: {},
          definition: {},
          references: {},
          hover: {},
          rename: { prepareSupport: true },
          codeAction: {
            dataSupport: true,
            resolveSupport: { properties: ["edit"] }
          }
        },
        workspace: {
          symbol: {},
          executeCommand: {},
          workspaceEdit: {
            documentChanges: true,
            resourceOperations: ["create", "rename", "delete"],
            failureHandling: "abort"
          },
          fileOperations: {
            willRename: true,
            didRename: true
          }
        }
      }
    });
    this.client.notify("initialized", {});
    this.initialized = true;
  }

  private async openOrUpdateDocument(uri: string): Promise<{ uri: string; filePath: string; changed: boolean }> {
    await this.ensureInitialized();
    const document = await this.resolveDocument(uri);
    const { filePath } = document;
    const text = await fs.readFile(filePath, "utf8");
    const opened = this.openedDocumentsByUri.get(document.uri);

    if (!opened) {
      this.openedDocumentsByUri.set(document.uri, { text, version: 1 });
      this.client.notify("textDocument/didOpen", {
        textDocument: {
          uri: document.uri,
          languageId: this.options.languageId,
          version: 1,
          text
        }
      });
      return { ...document, changed: true };
    }

    if (opened.text === text) return { ...document, changed: false };

    const version = opened.version + 1;
    this.openedDocumentsByUri.set(document.uri, { text, version });
    this.client.notify("textDocument/didChange", {
      textDocument: {
        uri: document.uri,
        version
      },
      contentChanges: [{ text }]
    });
    return { ...document, changed: true };
  }

  private async ensureWorkspaceDocumentOpened(): Promise<void> {
    if (this.workspaceDocumentOpened) return;

    const seedFile = await this.findWorkspaceSeedFile();
    if (!seedFile) {
      throw new Error(`No ${this.options.languageId} workspace seed file found under ${this.options.rootPath}`);
    }

    await this.openOrUpdateDocument(filePathToUri(seedFile));
    this.workspaceDocumentOpened = true;
  }

  private async findWorkspaceSeedFile(): Promise<string | undefined> {
    for (const relativePath of this.options.workspaceSeedFiles ?? []) {
      const filePath = path.join(this.options.rootPath, relativePath);
      if (await fileExists(filePath)) return filePath;
    }

    return findFirstSourceFile(this.options.rootPath, this.options.workspaceSeedExtensions ?? []);
  }

  private async resolveSingleSymbol(symbol: string): Promise<SymbolMatch> {
    const matches = (await this.symbols(symbol)).filter((match) => match.name === symbol);
    if (matches.length === 0) throw new Error(`Symbol not found: ${symbol}`);
    if (matches.length > 1) {
      const locations = matches.map((match) => `${path.relative(this.options.rootPath, match.file)}:${match.line}`).join(", ");
      throw new Error(`Symbol is ambiguous: ${symbol} (${locations})`);
    }
    return matches[0];
  }

  private captureDiagnostics(params: unknown): void {
    if (!isPublishDiagnosticsParams(params)) return;

    const revision = (this.diagnosticsRevisionByUri.get(params.uri) ?? 0) + 1;
    this.diagnosticsRevisionByUri.set(params.uri, revision);
    this.diagnosticsByUri.set(
      params.uri,
      params.diagnostics.map((diagnostic) => ({
        file: uriToFilePath(params.uri),
        line: diagnostic.range.start.line + 1,
        character: diagnostic.range.start.character + 1,
        severity: lspSeverityToText(diagnostic.severity),
        message: diagnostic.message,
        source: diagnostic.source,
        code: diagnostic.code
      }))
    );
    this.resolveDiagnosticsWaiters(params.uri, revision);
  }

  private waitForDiagnostics(uri: string, minRevision: number, timeoutMs = this.options.diagnosticsTimeoutMs ?? defaultDiagnosticsTimeoutMs): Promise<boolean> {
    const currentRevision = this.diagnosticsRevisionByUri.get(uri) ?? 0;
    if (currentRevision >= minRevision) return Promise.resolve(true);

    return new Promise((resolve) => {
      const waiters = this.diagnosticsWaitersByUri.get(uri) ?? [];
      const waiter = {
        minRevision,
        resolve: () => resolve(true),
        timer: undefined as unknown as NodeJS.Timeout
      };
      const timer = setTimeout(() => {
        const nextWaiters = (this.diagnosticsWaitersByUri.get(uri) ?? []).filter((candidate) => candidate !== waiter);
        if (nextWaiters.length > 0) this.diagnosticsWaitersByUri.set(uri, nextWaiters);
        else this.diagnosticsWaitersByUri.delete(uri);
        resolve(false);
      }, timeoutMs);

      waiter.timer = timer;
      waiters.push(waiter);
      this.diagnosticsWaitersByUri.set(uri, waiters);
    });
  }

  private async resolveDocument(uri: string): Promise<{ uri: string; filePath: string }> {
    const inputPath = path.resolve(uriToFilePath(uri));
    let realFilePath: string;
    try {
      realFilePath = await fs.realpath(inputPath);
    } catch {
      const canonicalUri = filePathToUri(inputPath);
      if (this.openedDocumentsByUri.has(canonicalUri)) {
        this.client.notify("textDocument/didClose", {
          textDocument: { uri: canonicalUri }
        });
        this.openedDocumentsByUri.delete(canonicalUri);
      }
      throw new Error(`File not found: ${inputPath}`);
    }

    const realRootPath = await this.rootRealPathPromise;
    if (!isInsideRoot(realFilePath, realRootPath)) {
      throw new Error(`File is outside workspace root: ${inputPath}`);
    }

    return {
      uri: filePathToUri(realFilePath),
      filePath: realFilePath
    };
  }

  private resolveDiagnosticsWaiters(uri: string, revision: number): void {
    const waiters = this.diagnosticsWaitersByUri.get(uri) ?? [];
    const pending = [];
    for (const waiter of waiters) {
      if (revision >= waiter.minRevision) {
        clearTimeout(waiter.timer);
        waiter.resolve();
      } else {
        pending.push(waiter);
      }
    }

    if (pending.length > 0) this.diagnosticsWaitersByUri.set(uri, pending);
    else this.diagnosticsWaitersByUri.delete(uri);
  }

  private toLocation(location: LspLocation): Location {
    return {
      file: uriToFilePath(location.uri),
      line: location.range.start.line + 1,
      character: location.range.start.character + 1,
      range: location.range
    };
  }
}

function normalizeHoverContents(contents: LspHover["contents"]): string {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents.map((item) => (typeof item === "string" ? item : item.value)).join("\n\n");
  }
  return contents.value;
}

function isPublishDiagnosticsParams(value: unknown): value is { uri: string; diagnostics: LspDiagnostic[] } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { uri?: unknown; diagnostics?: unknown };
  return typeof candidate.uri === "string" && Array.isArray(candidate.diagnostics);
}

function isMissingLanguageServerError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Failed to start LSP server");
}

function toLspPosition(position: DocumentPosition): Position {
  return {
    line: position.line - 1,
    character: position.character - 1
  };
}

function rangeContains(range: { start: Position; end: Position }, position: Position): boolean {
  if (position.line < range.start.line || position.line > range.end.line) return false;
  if (position.line === range.start.line && position.character < range.start.character) return false;
  if (position.line === range.end.line && position.character > range.end.character) return false;
  return true;
}

function formatPosition(position: DocumentPosition): string {
  return `${position.file}:${position.line}:${position.character}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function isInsideRoot(filePath: string, rootPath: string): boolean {
  return filePath === rootPath || filePath.startsWith(`${rootPath}${path.sep}`);
}

function symbolKindName(kind: number): string {
  const names: Record<number, string> = {
    1: "File",
    2: "Module",
    3: "Namespace",
    4: "Package",
    5: "Class",
    6: "Method",
    7: "Property",
    8: "Field",
    9: "Constructor",
    10: "Enum",
    11: "Interface",
    12: "Function",
    13: "Variable",
    14: "Constant",
    15: "String",
    16: "Number",
    17: "Boolean",
    18: "Array",
    19: "Object",
    20: "Key",
    21: "Null",
    22: "EnumMember",
    23: "Struct",
    24: "Event",
    25: "Operator",
    26: "TypeParameter"
  };
  return names[kind] ?? `Unknown(${kind})`;
}

const skippedDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out"
]);

async function findFirstSourceFile(rootPath: string, extensions: string[]): Promise<string | undefined> {
  if (extensions.length === 0) return undefined;

  const queue = [rootPath];
  while (queue.length > 0) {
    const directory = queue.shift()!;
    const entries = await readDirectory(directory);
    const sorted = entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? 1 : -1;
      return left.name.localeCompare(right.name);
    });

    for (const entry of sorted) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isFile() && extensions.includes(path.extname(entry.name))) return entryPath;
      if (entry.isDirectory() && !skippedDirectories.has(entry.name)) queue.push(entryPath);
    }
  }

  return undefined;
}

async function readDirectory(directory: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}
