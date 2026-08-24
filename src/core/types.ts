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

export interface CodeActionItem {
  index: number;
  title: string;
  kind?: string;
  isPreferred?: boolean;
  hasEdit: boolean;
  hasCommand: boolean;
}

export interface CodeActionApplied {
  index: number;
  title: string;
  changedFiles: string[];
  createdFiles: string[];
  renamedFiles: Array<{ from: string; to: string }>;
  deletedFiles: string[];
  editCount: number;
  commandExecuted: boolean;
}

export interface CodeActionResult {
  actions: CodeActionItem[];
  applied?: CodeActionApplied;
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

export interface SemanticProvider {
  diagnostics(uri?: string, options?: DiagnosticOptions): Promise<DiagnosticReport>;
  definition(symbol: string): Promise<Location>;
  definitionAt(position: DocumentPosition): Promise<Location>;
  references(symbol: string): Promise<Location[]>;
  referencesAt(position: DocumentPosition): Promise<Location[]>;
  symbols(query: string): Promise<SymbolMatch[]>;
  hover(symbol: string): Promise<HoverInfo>;
  hoverAt(position: DocumentPosition): Promise<HoverInfo>;
  rename(position: DocumentPosition, newName: string): Promise<RenameSummary>;
  codeActions(file: string, range: Range, only?: string[], apply?: number): Promise<CodeActionResult>;
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
