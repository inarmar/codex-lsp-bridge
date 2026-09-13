import { summarizeDiagnostics } from "./diagnostics.js";
import { CodeActionCache } from "./code-action-cache.js";
import type { CodeActionApplied, CodeActionHandle, CodeActionSummary, DiagnosticOptions, DiagnosticSummary, DocumentPosition, FileRenameSummary, HoverInfo, Location, Range, RenameSummary, SemanticProvider, SymbolMatch } from "./types.js";
import type { SupportedLanguage } from "../adapters/language-registry.js";

export interface SemanticProviderRegistry {
  forLanguage(language: SupportedLanguage): SemanticProvider;
  forFile(filePath: string): SemanticProvider;
}

export interface CommandServiceOptions {
  codeActionCache?: CodeActionCache;
}

export class CommandService {
  constructor(
    private readonly provider: SemanticProvider,
    private readonly options: CommandServiceOptions = {}
  ) {
    this.codeActionCache = options.codeActionCache ?? new CodeActionCache();
  }

  private readonly codeActionCache: CodeActionCache;

  async diagnostics(file: string, options?: DiagnosticOptions): Promise<DiagnosticSummary> {
    assertNonEmpty("file", file);
    return summarizeDiagnostics(await this.provider.diagnostics(file, options));
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

  async listCodeActions(file: string, range: Range, only?: string[]): Promise<CodeActionSummary[]> {
    assertNonEmpty("file", file);
    assertRange(range);
    const report = await this.provider.listCodeActions(file, range, only);
    return this.codeActionCache.store(this.provider, file, report.candidates);
  }

  async applyCodeAction(id: CodeActionHandle): Promise<CodeActionApplied> {
    assertNonEmpty("id", id);
    return this.codeActionCache.apply(id);
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
    private readonly defaultLanguage: SupportedLanguage,
    private readonly options: CommandServiceOptions = {}
  ) {
    this.codeActionCache = options.codeActionCache ?? new CodeActionCache();
  }

  /** Workspace-scoped so handles stay stable between list and apply. */
  private readonly codeActionCache: CodeActionCache;

  async diagnostics(file: string, options?: DiagnosticOptions): Promise<DiagnosticSummary> {
    return this.forFile(file).diagnostics(file, options);
  }

  async definition(symbol: string, language?: SupportedLanguage): Promise<Location> {
    return this.forLanguage(language ?? this.defaultLanguage).definition(symbol);
  }

  async definitionAt(position: DocumentPosition): Promise<Location> {
    return this.forFile(position.file).definitionAt(position);
  }

  async references(symbol: string, language?: SupportedLanguage): Promise<Location[]> {
    return this.forLanguage(language ?? this.defaultLanguage).references(symbol);
  }

  async referencesAt(position: DocumentPosition): Promise<Location[]> {
    return this.forFile(position.file).referencesAt(position);
  }

  async symbols(query: string, language?: SupportedLanguage): Promise<SymbolMatch[]> {
    return this.forLanguage(language ?? this.defaultLanguage).symbols(query);
  }

  async hover(symbol: string, language?: SupportedLanguage): Promise<HoverInfo> {
    return this.forLanguage(language ?? this.defaultLanguage).hover(symbol);
  }

  async hoverAt(position: DocumentPosition): Promise<HoverInfo> {
    return this.forFile(position.file).hoverAt(position);
  }

  async rename(position: DocumentPosition, newName: string): Promise<RenameSummary> {
    return this.forFile(position.file).rename(position, newName);
  }

  async listCodeActions(file: string, range: Range, only?: string[]): Promise<CodeActionSummary[]> {
    return this.forFile(file).listCodeActions(file, range, only);
  }

  async applyCodeAction(id: CodeActionHandle): Promise<CodeActionApplied> {
    assertNonEmpty("id", id);
    return this.codeActionCache.apply(id);
  }

  async willRenameFiles(oldPath: string, newPath: string, renamed = false): Promise<FileRenameSummary> {
    return this.forFile(oldPath).willRenameFiles(oldPath, newPath, renamed);
  }

  private forLanguage(language: SupportedLanguage): CommandService {
    return new CommandService(this.manager.forLanguage(language), { codeActionCache: this.codeActionCache });
  }

  private forFile(filePath: string): CommandService {
    return new CommandService(this.manager.forFile(filePath), { codeActionCache: this.codeActionCache });
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