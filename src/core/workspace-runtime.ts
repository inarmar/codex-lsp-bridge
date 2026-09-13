import { loadConfig, type BridgeConfig } from "./config.js";
import { resolveDiagnosticsTimeout, type ResolvedDiagnosticsTimeout } from "./diagnostics-timeout.js";
import { LanguageRegistry } from "../adapters/language-registry.js";
import { LspProviderRegistry } from "./lsp-provider-registry.js";
import { WorkspaceCommandService } from "./command-service.js";
import { DirectoryDiagnostics } from "./directory-diagnostics.js";
import { CodeActionCache } from "./code-action-cache.js";
import { resolveWorkspaceRoot } from "./paths.js";

export interface WorkspaceRuntimeOptions {
  config?: BridgeConfig;
  languageRegistry?: LanguageRegistry;
  providers?: LspProviderRegistry;
  commands?: WorkspaceCommandService;
  directoryDiagnostics?: DirectoryDiagnostics;
  codeActionCache?: CodeActionCache;
}

/**
 * Root-scoped owner of live Bridge state (docs/THESAURUS.md,
 * "Workspace Runtime"): one per Workspace Root. Holds the merged Bridge Config,
 * Language Registry, LSP Provider Registry, Workspace Command Service,
 * Directory Diagnostics orchestration, and the Code Action Cache.
 * Language Servers are still created lazily by the LSP Provider Registry.
 */
export class WorkspaceRuntime {
  readonly root: string;
  readonly config: BridgeConfig;
  readonly languageRegistry: LanguageRegistry;
  readonly providers: LspProviderRegistry;
  readonly commands: WorkspaceCommandService;
  readonly directoryDiagnostics: DirectoryDiagnostics;
  readonly codeActionCache: CodeActionCache;
  readonly diagnostics: ResolvedDiagnosticsTimeout;

  private constructor(parts: WorkspaceRuntimeParts) {
    this.root = parts.root;
    this.config = parts.config;
    this.languageRegistry = parts.languageRegistry;
    this.providers = parts.providers;
    this.commands = parts.commands;
    this.directoryDiagnostics = parts.directoryDiagnostics;
    this.codeActionCache = parts.codeActionCache;
    this.diagnostics = parts.diagnostics;
  }

  /** Builds a runtime for a Workspace Root (canonicalized; no marker checks). */
  static async create(rootInput: string, options: WorkspaceRuntimeOptions = {}): Promise<WorkspaceRuntime> {
    const root = await resolveWorkspaceRoot(rootInput);
    const config = options.config ?? loadConfig(root);
    const languageRegistry = options.languageRegistry ?? LanguageRegistry.fromMergedConfig(config);
    const diagnostics = resolveDiagnosticsTimeout(root, config.diagnosticsTimeoutMs);
    const providers =
      options.providers ??
      new LspProviderRegistry(root, {
        diagnosticsTimeoutMs: diagnostics.timeoutMs,
        registry: languageRegistry
      });
    const codeActionCache = options.codeActionCache ?? new CodeActionCache();
    const commands = options.commands ?? new WorkspaceCommandService(providers, config.defaultLanguage, { codeActionCache });
    const directoryDiagnostics = options.directoryDiagnostics ?? new DirectoryDiagnostics(commands, languageRegistry, config.directoryDiagnostics);
    return new WorkspaceRuntime({
      root,
      config,
      languageRegistry,
      providers,
      commands,
      directoryDiagnostics,
      codeActionCache,
      diagnostics
    });
  }

  async dispose(): Promise<void> {
    await this.providers.dispose();
  }
}

interface WorkspaceRuntimeParts {
  root: string;
  config: BridgeConfig;
  languageRegistry: LanguageRegistry;
  providers: LspProviderRegistry;
  commands: WorkspaceCommandService;
  directoryDiagnostics: DirectoryDiagnostics;
  codeActionCache: CodeActionCache;
  diagnostics: ResolvedDiagnosticsTimeout;
}

/**
 * Composition-layer map Workspace Root → Workspace Runtime: repeated requests
 * for the same root reuse the runtime; disposal releases every spawned server.
 */
export class WorkspaceRuntimeRegistry {
  private readonly runtimes = new Map<string, WorkspaceRuntime>();

  get size(): number {
    return this.runtimes.size;
  }

  /** Resolves a Workspace Root and returns its (possibly new) runtime. */
  async get(rootInput: string): Promise<WorkspaceRuntime> {
    const canonicalRoot = await resolveWorkspaceRoot(rootInput);
    let runtime = this.runtimes.get(canonicalRoot);
    if (!runtime) {
      runtime = await WorkspaceRuntime.create(canonicalRoot);
      this.runtimes.set(canonicalRoot, runtime);
    }
    return runtime;
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.runtimes.values()].map((runtime) => runtime.dispose()));
    this.runtimes.clear();
  }
}