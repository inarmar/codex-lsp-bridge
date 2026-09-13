export type Severity = "error" | "warning" | "information" | "hint";

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  file: string;
  line: number;
  character: number;
  range?: Range;
}

export interface DocumentPosition {
  file: string;
  line: number;
  character: number;
}

export interface Diagnostic {
  file: string;
  line: number;
  character: number;
  severity: Severity;
  message: string;
  source?: string;
  code?: string | number;
}

export type DiagnosticStatus = "ok" | "timed_out" | "unavailable";
export type DiagnosticConclusion = "diagnostics_clean" | "diagnostics_found" | "inconclusive" | "unavailable";

export interface DiagnosticReport {
  status: DiagnosticStatus;
  timedOut: boolean;
  stale: boolean;
  unavailableReason?: string;
  sourceRevision?: number;
  items: Diagnostic[];
}

export interface DiagnosticOptions {
  timeoutMs?: number;
}

export interface SymbolMatch extends Location {
  name: string;
  kind?: string;
  containerName?: string;
}

export interface HoverInfo {
  file: string;
  line: number;
  character: number;
  contents: string;
}

export interface RenameSummary {
  oldName?: string;
  newName: string;
  changedFiles: string[];
  createdFiles: string[];
  renamedFiles: Array<{ from: string; to: string }>;
  deletedFiles: string[];
  editCount: number;
}

/** A raw LSP diagnostic with its full range, as received from publishDiagnostics. */
export interface RawLspDiagnostic {
  range: { start: Position; end: Position };
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

/**
 * Internal Known Diagnostics capability (docs/THESAURUS.md, "Known Diagnostics
 * Snapshot"): point-in-time raw diagnostics for one file; feeds overlapping
 * Code Action context and, later, a reactive Post-Tool Diagnostics delta.
 */
export interface KnownDiagnosticsSnapshot {
  filePath: string;
  diagnostics: RawLspDiagnostic[];
}

export type CodeActionHandle = string;

/** Agent-facing summary of a listed action; carries the opaque handle. */
export interface CodeActionSummary {
  id: CodeActionHandle;
  title: string;
  kind?: string;
  preferred?: boolean;
}

/** Provider-level listing: summaries + the raw payload the cache retains. */
export interface CodeActionCandidate {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  raw: unknown;
  hasEdit: boolean;
  hasCommand: boolean;
}

export interface CodeActionListReport {
  candidates: CodeActionCandidate[];
}

export interface ApplyCodeActionRequest {
  file: string;
  raw: unknown;
}

export interface CodeActionApplied {
  title: string;
  changedFiles: string[];
  createdFiles: string[];
  renamedFiles: Array<{ from: string; to: string }>;
  deletedFiles: string[];
  editCount: number;
  commandExecuted: boolean;
}

export interface FileRenameSummary {
  oldPath: string;
  newPath: string;
  renamed: boolean;
  changedFiles: string[];
  createdFiles: string[];
  renamedFiles: Array<{ from: string; to: string }>;
  deletedFiles: string[];
  editCount: number;
}

export interface DirectoryDiagnosticsResult extends DiagnosticSummary {
  directory: {
    scannedFiles: number;
    matchedFiles: number;
    maxFiles: number;
    truncated: boolean;
    sourceFileListCache: "hit" | "miss";
    timeoutBudgetMs: number;
    budgetTimedOut: boolean;
    concurrency: number;
  };
}

export interface SemanticProvider {
  diagnostics(file: string, options?: DiagnosticOptions): Promise<DiagnosticReport>;
  knownDiagnosticsSnapshot(filePath: string): Promise<KnownDiagnosticsSnapshot>;
  definition(symbol: string): Promise<Location>;
  definitionAt(position: DocumentPosition): Promise<Location>;
  references(symbol: string): Promise<Location[]>;
  referencesAt(position: DocumentPosition): Promise<Location[]>;
  symbols(query: string): Promise<SymbolMatch[]>;
  hover(symbol: string): Promise<HoverInfo>;
  hoverAt(position: DocumentPosition): Promise<HoverInfo>;
  rename(position: DocumentPosition, newName: string): Promise<RenameSummary>;
  listCodeActions(file: string, range: Range, only?: string[]): Promise<CodeActionListReport>;
  applyCodeAction(request: ApplyCodeActionRequest): Promise<CodeActionApplied>;
  willRenameFiles(oldPath: string, newPath: string): Promise<FileRenameSummary>;
  notifyFilesRenamed(oldPath: string, newPath: string): Promise<FileRenameSummary>;
  dispose(): Promise<void>;
}

export interface DiagnosticSummary {
  status: DiagnosticStatus;
  conclusion: DiagnosticConclusion;
  message: string;
  timedOut: boolean;
  stale: boolean;
  unavailableReason?: string;
  sourceRevision?: number;
  total: number;
  bySeverity: Record<Severity, number>;
  items: Diagnostic[];
  summary: string[];
}