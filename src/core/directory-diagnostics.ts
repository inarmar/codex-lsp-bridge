import fs from "node:fs/promises";
import path from "node:path";
import { summarizeConclusion } from "./diagnostics.js";
import type { WorkspaceCommandService } from "./command-service.js";
import type { DirectoryDiagnosticsConfig } from "./config.js";
import type { DirectoryDiagnosticsResult, DiagnosticStatus, DiagnosticSummary, Severity } from "./types.js";
import type { LanguageRegistry } from "../adapters/language-registry.js";

const sourceFileListCacheTtlMs = 5000;
const skippedDirectories = new Set([".git", ".next", ".turbo", "build", "coverage", "dist", "node_modules"]);

interface SourceFileListCacheEntry {
  createdAt: number;
  files: string[];
  truncated: boolean;
}

export interface DirectoryDiagnosticsRequest {
  /** Canonical absolute directory inside the Workspace Root (already resolved). */
  dir: string;
  severity?: Severity;
  maxFiles?: number;
  timeoutBudgetMs?: number;
  concurrency?: number;
}

/**
 * Bridge-level Directory Diagnostics orchestration
 * (docs/THESAURUS.md, "Directory Diagnostics"): enumerate source files, run
 * File Diagnostics per file with bounded concurrency, merge by Severity, and
 * stop scheduling new work once the Timeout Budget is exhausted
 * (already-running requests may still finish — the budget is a scheduling
 * ceiling, not a hard wall-clock deadline).
 */
export class DirectoryDiagnostics {
  private readonly sourceFileListCache = new Map<string, SourceFileListCacheEntry>();
  private readonly config: DirectoryDiagnosticsConfig;

  constructor(
    private readonly commands: WorkspaceCommandService,
    private readonly registry: LanguageRegistry,
    overrides: Partial<DirectoryDiagnosticsConfig> = {}
  ) {
    this.config = { maxFiles: 50, timeoutBudgetMs: 15000, concurrency: 2, ...overrides };
  }

  async collect(request: DirectoryDiagnosticsRequest): Promise<DirectoryDiagnosticsResult> {
    const maxFiles = request.maxFiles ?? this.config.maxFiles;
    const timeoutBudgetMs = request.timeoutBudgetMs ?? this.config.timeoutBudgetMs;
    // Guard the batching loop against degenerate injected values (decoders and
    // config already enforce positive integers on the public paths).
    const concurrency = Math.max(1, Math.floor(request.concurrency ?? this.config.concurrency));
    const extensions = this.registry.extensions();
    const startedAt = Date.now();
    const sourceFiles = await this.readCachedSourceFiles(request.dir, maxFiles, extensions);
    const summaries: DiagnosticSummary[] = [];
    let budgetTimedOut = false;

    for (let index = 0; index < sourceFiles.files.length; index += concurrency) {
      if (Date.now() - startedAt >= timeoutBudgetMs) {
        budgetTimedOut = true;
        break;
      }
      const batch = sourceFiles.files.slice(index, index + concurrency);
      summaries.push(...(await Promise.all(batch.map((diagnosticFile) => this.commands.diagnostics(diagnosticFile)))));
    }
    const summary = filterDiagnosticSummary(mergeDiagnosticSummaries(summaries), request.severity);
    const status: DiagnosticStatus = budgetTimedOut ? "timed_out" : summary.status;
    return {
      ...summary,
      status,
      ...summarizeConclusion(status, summary.total),
      timedOut: budgetTimedOut || summary.timedOut,
      directory: {
        scannedFiles: summaries.length,
        matchedFiles: sourceFiles.files.length,
        maxFiles,
        truncated: sourceFiles.truncated,
        sourceFileListCache: sourceFiles.cached ? "hit" : "miss",
        timeoutBudgetMs,
        budgetTimedOut,
        concurrency
      }
    };
  }

  private async readCachedSourceFiles(
    directory: string,
    maxFiles: number,
    extensions: string[]
  ): Promise<{ files: string[]; truncated: boolean; cached: boolean }> {
    const cacheKey = `${directory}\0${maxFiles}\0${extensions.join(",")}`;
    const cached = this.sourceFileListCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt <= sourceFileListCacheTtlMs) {
      return { files: cached.files, truncated: cached.truncated, cached: true };
    }

    const collected = await collectSourceFiles(directory, maxFiles, extensions);
    this.sourceFileListCache.set(cacheKey, {
      createdAt: Date.now(),
      files: collected.files,
      truncated: collected.truncated
    });
    return { ...collected, cached: false };
  }
}

async function collectSourceFiles(directory: string, maxFiles: number, extensions: string[]): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  let truncated = false;

  async function visit(currentDirectory: string): Promise<void> {
    if (truncated) return;
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (truncated) return;
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory() && !skippedDirectories.has(entry.name)) {
        await visit(entryPath);
        continue;
      }
      if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
        if (files.length >= maxFiles) {
          truncated = true;
          return;
        }
        files.push(entryPath);
      }
    }
  }

  await visit(directory);
  return { files, truncated };
}

function mergeDiagnosticSummaries(summaries: DiagnosticSummary[]): DiagnosticSummary {
  const items = summaries.flatMap((summary) => summary.items);
  const status: DiagnosticStatus = summaries.some((summary) => summary.status === "timed_out") ? "timed_out" : "ok";
  const unavailableReason = summaries.find((summary) => summary.status === "unavailable")?.unavailableReason;
  const bySeverity = {
    error: items.filter((item) => item.severity === "error").length,
    warning: items.filter((item) => item.severity === "warning").length,
    information: items.filter((item) => item.severity === "information").length,
    hint: items.filter((item) => item.severity === "hint").length
  };
  const effectiveStatus: DiagnosticStatus = status === "timed_out" ? "timed_out" : unavailableReason ? "unavailable" : "ok";
  return {
    status: effectiveStatus,
    ...summarizeConclusion(effectiveStatus, items.length),
    timedOut: summaries.some((summary) => summary.timedOut),
    stale: summaries.some((summary) => summary.stale),
    ...(unavailableReason ? { unavailableReason } : {}),
    total: items.length,
    bySeverity,
    items,
    summary: items.slice(0, 10).map((item, index) => `${index + 1}. ${item.severity.toUpperCase()} ${item.file}:${item.line}:${item.character} ${item.message}`)
  };
}

function filterDiagnosticSummary(summary: DiagnosticSummary, severity: Severity | undefined): DiagnosticSummary {
  if (!severity) return summary;
  const items = summary.items.filter((item) => item.severity === severity);
  return {
    ...summary,
    total: items.length,
    ...summarizeConclusion(summary.status, items.length),
    bySeverity: {
      error: items.filter((item) => item.severity === "error").length,
      warning: items.filter((item) => item.severity === "warning").length,
      information: items.filter((item) => item.severity === "information").length,
      hint: items.filter((item) => item.severity === "hint").length
    },
    items,
    summary: items.slice(0, 10).map((item, index) => `${index + 1}. ${item.severity.toUpperCase()} ${item.file}:${item.line}:${item.character} ${item.message}`)
  };
}