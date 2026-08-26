import { JsonRpcLspClient } from "./json-rpc-lsp-bridge.js";
import { LspSemanticProvider } from "./lsp-semantic-provider.js";
import type { SemanticProvider } from "./types.js";
import { defaultLanguageServers } from "../adapters/default-language-servers.js";
import { createLanguageServerConfig, LanguageRegistry } from "../adapters/language-registry.js";

export interface LspProviderRegistryOptions {
  diagnosticsTimeoutMs?: number;
  registry?: LanguageRegistry;
}

export class LspProviderRegistry {
  private readonly providers = new Map<string, SemanticProvider>();
  private readonly registry: LanguageRegistry;

  constructor(
    private readonly rootPath: string,
    private readonly options: LspProviderRegistryOptions = {}
  ) {
    this.registry = options.registry ?? LanguageRegistry.fromLanguageServers(defaultLanguageServers);
  }

  forLanguage(language: string): SemanticProvider {
    const existing = this.providers.get(language);
    if (existing) return existing;

    const config = createLanguageServerConfig(language, this.registry.descriptor(language), this.rootPath);
    const provider = new LspSemanticProvider({
      rootPath: this.rootPath,
      languageId: config.languageId,
      server: config.server,
      workspaceSeedFiles: config.workspaceSeedFiles,
      workspaceSeedExtensions: config.extensions,
      diagnosticsTimeoutMs: this.options.diagnosticsTimeoutMs,
      clientFactory: (server) => new JsonRpcLspClient(server)
    });
    this.providers.set(language, provider);
    return provider;
  }

  forFile(filePath: string): SemanticProvider {
    return this.forLanguage(this.registry.detectByExtension(filePath));
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.providers.values()].map((provider) => provider.dispose()));
    this.providers.clear();
  }
}
