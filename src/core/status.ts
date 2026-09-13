import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLanguageServerConfig, findServerExecutable, LanguageRegistry, resolveLanguageServerWorkspace } from "../adapters/language-registry.js";
import { loadConfig, configFile } from "./config.js";
import { resolveDiagnosticsTimeout, type ResolvedDiagnosticsTimeout } from "./diagnostics-timeout.js";
import type { WorkspaceRuntime } from "./workspace-runtime.js";

/**
 * Bridge Status (docs/THESAURUS.md, "Bridge Status"): the single
 * health/configuration operation. Reports resolved configuration, per-language
 * server availability and Language Server Workspace, executable resolution,
 * seed-file availability, diagnostics configuration, Codex integration state,
 * build freshness, and already-known runtime state — without starting all
 * Language Servers just to answer.
 */
export interface BridgeStatusLanguage {
  language: string;
  command: string;
  status: "ok" | "missing";
  supportLevel: "primary" | "experimental";
  installHint: string;
  workspacePath?: string;
  languageServerWorkspace?: string;
  path?: string;
  seedFile?: string;
}

export interface BridgeCodexState {
  mcpConfigured: boolean;
  hookConfigured: boolean;
  instructionsConfigured: boolean;
}

export interface BridgeStatus {
  workspaceRoot: string;
  configFilePresent: boolean;
  languages: BridgeStatusLanguage[];
  codex: BridgeCodexState;
  build: {
    distExists: boolean;
    stale: boolean;
  };
  diagnostics: ResolvedDiagnosticsTimeout;
  runtime: {
    activeProviders: number;
  };
  recommendations: string[];
}

export function collectBridgeStatus(rootPath: string, runtime?: WorkspaceRuntime): BridgeStatus {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const config = runtime?.config ?? loadConfig(rootPath);
  const diagnostics = runtime ? runtime.diagnostics : resolveDiagnosticsTimeout(rootPath, config.diagnosticsTimeoutMs);
  const registry = runtime?.languageRegistry ?? LanguageRegistry.fromMergedConfig(config);
  const languages: BridgeStatusLanguage[] = registry.languages().map((language) => {
    const descriptor = registry.descriptor(language);
    const workspacePath = descriptor.workspacePath ?? ".";
    const languageServerWorkspace = resolveLanguageServerWorkspace(rootPath, workspacePath);
    const serverConfig = createLanguageServerConfig(language, descriptor, rootPath);
    const executablePath = findExecutable(languageServerWorkspace, rootPath, serverConfig.server.command);
    return {
      language,
      command: serverConfig.server.command,
      status: (executablePath ? "ok" : "missing") as BridgeStatusLanguage["status"],
      supportLevel: serverConfig.supportLevel,
      installHint: serverConfig.installHint,
      ...(descriptor.workspacePath !== undefined ? { workspacePath: descriptor.workspacePath } : {}),
      languageServerWorkspace,
      seedFile: findSeedFile(languageServerWorkspace, serverConfig.workspaceSeedFiles, serverConfig.extensions),
      ...(executablePath ? { path: executablePath } : {})
    };
  });
  const codex = {
    mcpConfigured: readText(path.join(codexHome, "config.toml")).includes("[mcp_servers.codex-lsp-bridge]"),
    hookConfigured: readText(path.join(codexHome, "hooks.json")).includes("codex-lsp-bridge:post-tool-diagnostics"),
    instructionsConfigured: readText(path.join(codexHome, "AGENTS.md")).includes("BEGIN codex-lsp-bridge")
  };
  const build = inspectBuildFreshness(packageRoot);
  const recommendations = buildRecommendations(languages, codex, build);
  return {
    workspaceRoot: rootPath,
    configFilePresent: fs.existsSync(path.join(rootPath, ".codex", configFile)),
    languages,
    codex,
    build,
    diagnostics,
    runtime: {
      activeProviders: runtime?.providers.activeProviderCount ?? 0
    },
    recommendations
  };
}

function buildRecommendations(
  languages: BridgeStatus["languages"],
  codex: BridgeCodexState,
  build: BridgeStatus["build"]
): string[] {
  const recommendations: string[] = [];
  for (const language of languages) {
    if (language.status === "missing") {
      recommendations.push(`Install ${language.language} language server: ${language.installHint}`);
    }
  }
  if (!codex.mcpConfigured || !codex.hookConfigured || !codex.instructionsConfigured) {
    recommendations.push("Run codex-lsp-bridge install and restart Codex.");
  }
  if (!build.distExists || build.stale) {
    recommendations.push("Run npm run build before using the local package.");
  }
  return recommendations;
}

function findExecutable(languageServerWorkspace: string, workspaceRootPath: string, command: string): string | undefined {
  if (command.includes(path.sep)) {
    return isExecutable(command) ? command : undefined;
  }

  const local = findServerExecutable(languageServerWorkspace, workspaceRootPath, command);
  if (local) return local;

  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];

  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (isExecutable(candidate)) return candidate;
    }
  }

  return undefined;
}

function findSeedFile(languageServerWorkspace: string, seedFiles: string[], extensions: string[]): string | undefined {
  for (const seed of seedFiles) {
    const filePath = path.join(languageServerWorkspace, seed);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return filePath;
  }
  return findFirstSourceFile(languageServerWorkspace, extensions);
}

function findFirstSourceFile(rootPath: string, extensions: string[]): string | undefined {
  const skipped = new Set([".git", ".next", ".turbo", "build", "coverage", "dist", "node_modules"]);
  const queue = [rootPath];
  while (queue.length > 0) {
    const directory = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isFile() && extensions.includes(path.extname(entry.name))) return entryPath;
      if (entry.isDirectory() && !skipped.has(entry.name)) queue.push(entryPath);
    }
  }
  return undefined;
}

export function inspectBuildFreshness(packageRoot: string): { distExists: boolean; stale: boolean } {
  const distIndex = path.join(packageRoot, "dist", "index.js");
  if (!fs.existsSync(distIndex)) return { distExists: false, stale: true };
  const sourceRoot = path.join(packageRoot, "src");
  if (!fs.existsSync(sourceRoot)) return { distExists: true, stale: false };
  return {
    distExists: true,
    stale: newestMtime(sourceRoot) > fs.statSync(distIndex).mtimeMs
  };
}

function newestMtime(directory: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(entryPath));
    else newest = Math.max(newest, fs.statSync(entryPath).mtimeMs);
  }
  return newest;
}

function readText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}