import { summarizeDiagnostics } from "./diagnostics.js";
import type { CodeActionResult, DiagnosticOptions, DiagnosticSummary, DocumentPosition, FileRenameSummary, HoverInfo, Location, Range, RenameSummary, SemanticProvider, SymbolMatch } from "./types.js";
import { uriToFilePath } from "../utils/uri.js";
import type { SupportedLanguage } from "../adapters/language-registry.js";

export interface SemanticProviderRegistry {
  forLanguage(language: SupportedLanguage): SemanticProvider;
  forFile(filePath: string): SemanticProvider;
}

export class CommandService {
  constructor(private readonly provider: SemanticProvider) {}

  async diagnostics(uri?: string, options?: DiagnosticOptions): Promise<DiagnosticSummary> {
    return summarizeDiagnostics(await this.provider.diagnostics(uri, options));
  }

  async definition(symbol: string): Promise<Location> {
    assertNonEmpty("symbol", symbol);
    return this.provider.definition(symbol);
  }

  async definitionAt(position: DocumentPosition): Promise<Location> {
    assertPosition(position);
    return this.provider.definitionAt(position);
  }

  async references(symbol: string): Promise<Location[]> {
    assertNonEmpty("symbol", symbol);
    return this.provider.references(symbol);
  }

  async referencesAt(position: DocumentPosition): Promise<Location[]> {
    assertPosition(position);
    return this.provider.referencesAt(position);
  }

  async symbols(query: string): Promise<SymbolMatch[]> {
    assertNonEmpty("query", query);
    return this.provider.symbols(query);
  }

  async hover(symbol: string): Promise<HoverInfo> {
    assertNonEmpty("symbol", symbol);
    return this.provider.hover(symbol);
  }

  async hoverAt(position: DocumentPosition): Promise<HoverInfo> {
    assertPosition(position);
    return this.provider.hoverAt(position);
  }

  async rename(position: DocumentPosition, newName: string): Promise<RenameSummary> {
    assertPosition(position);
    assertNonEmpty("newName", newName);
    return this.provider.rename(position, newName);
  }

  async codeActions(file: string, range: Range, only?: string[], apply?: number): Promise<CodeActionResult> {
    assertNonEmpty("file", file);
    assertRange(range);
    if (apply !== undefined && (!Number.isInteger(apply) || apply < 0)) throw new Error("apply must be a non-negative integer");
    return this.provider.codeActions(file, range, only, apply);
  }

  async willRenameFiles(oldPath: string, newPath: string, renamed = false): Promise<FileRenameSummary> {
    assertNonEmpty("oldPath", oldPath);
    assertNonEmpty("newPath", newPath);
    return renamed ? this.provider.notifyFilesRenamed(oldPath, newPath) : this.provider.willRenameFiles(oldPath, newPath);
  }
}

export class WorkspaceCommandService {
  constructor(
    private readonly manager: SemanticProviderRegistry,
    private readonly defaultLanguage: SupportedLanguage
  ) {}

  async diagnostics(uri?: string, options?: DiagnosticOptions): Promise<DiagnosticSummary> {
    const service = uri ? this.forFile(uriToFilePath(uri)) : this.forDefaultLanguage();
    return service.diagnostics(uri, options);
  }

  async definition(symbol: string): Promise<Location> {
    return this.forDefaultLanguage().definition(symbol);
  }

  async definitionAt(position: DocumentPosition): Promise<Location> {
    return this.forFile(position.file).definitionAt(position);
  }

  async references(symbol: string): Promise<Location[]> {
    return this.forDefaultLanguage().references(symbol);
  }

  async referencesAt(position: DocumentPosition): Promise<Location[]> {
    return this.forFile(position.file).referencesAt(position);
  }

  async symbols(query: string): Promise<SymbolMatch[]> {
    return this.forDefaultLanguage().symbols(query);
  }

  async hover(symbol: string): Promise<HoverInfo> {
    return this.forDefaultLanguage().hover(symbol);
  }

  async hoverAt(position: DocumentPosition): Promise<HoverInfo> {
    return this.forFile(position.file).hoverAt(position);
  }

  async rename(position: DocumentPosition, newName: string): Promise<RenameSummary> {
    return this.forFile(position.file).rename(position, newName);
  }

  async codeActions(file: string, range: Range, only?: string[], apply?: number): Promise<CodeActionResult> {
    return this.forFile(file).codeActions(file, range, only, apply);
  }

  async willRenameFiles(oldPath: string, newPath: string, renamed = false): Promise<FileRenameSummary> {
    return this.forFile(oldPath).willRenameFiles(oldPath, newPath, renamed);
  }

  private forDefaultLanguage(): CommandService {
    return new CommandService(this.manager.forLanguage(this.defaultLanguage));
  }

  private forFile(filePath: string): CommandService {
    return new CommandService(this.manager.forFile(filePath));
  }
}

function assertNonEmpty(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
}

function assertRange(range: Range): void {
  assertPosition({ file: "<range>", line: range.start.line, character: range.start.character });
  assertPosition({ file: "<range>", line: range.end.line, character: range.end.character });
  if (range.end.line < range.start.line || (range.end.line === range.start.line && range.end.character < range.start.character)) {
    throw new Error("range end must not precede range start");
  }
}

function assertPosition(position: DocumentPosition): void {
  assertNonEmpty("file", position.file);
  if (!Number.isInteger(position.line) || position.line < 1) {
    throw new Error("line must be a positive integer");
  }
  if (!Number.isInteger(position.character) || position.character < 1) {
    throw new Error("character must be a positive integer");
  }
}
