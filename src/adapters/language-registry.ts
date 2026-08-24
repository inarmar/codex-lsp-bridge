import fs from "node:fs";
import path from "node:path";
import type { ServerProcessConfig } from "../core/json-rpc-lsp-client.js";

/**
 * Any language name known to the Language Registry: from the defaults layer
 * (default-language-servers.ts) or added by a config layer. Alias kept for
 * the domain term "Supported Language" (docs/THESAURUS.md).
 */
export type SupportedLanguage = string;

export type SupportLevel = "primary" | "experimental";

/**
 * The complete record describing one language. One format for the defaults
 * layer and for user config layers. Required after merging: command, extensions.
 */
export interface LanguageDescriptor {
  languageId: string;
  command: string;
  args: string[];
  extensions: string[];
  workspaceSeedFiles: string[];
  installHint: string;
  supportLevel: SupportLevel;
}

/** A possibly-partial language entry as written in one config layer. */
export type LanguageServerEntry = Partial<LanguageDescriptor>;

/** Runtime-resolved server config built from a LanguageDescriptor. */
export interface LanguageServerConfig {
  language: string;
  languageId: string;
  server: ServerProcessConfig;
  extensions: string[];
  workspaceSeedFiles: string[];
  installHint: string;
  supportLevel: SupportLevel;
}

/**
 * Validator and access layer over merged Bridge Config language servers.
 * The single source of truth about languages at runtime.
 */
export class LanguageRegistry {
  private readonly descriptors = new Map<string, LanguageDescriptor>();
  private readonly extensionOwners = new Map<string, string>();

  static fromLanguageServers(entries: Record<string, LanguageServerEntry>): LanguageRegistry {
    const registry = new LanguageRegistry();
    for (const [language, entry] of Object.entries(entries ?? {})) {
      registry.add(language, entry);
    }
    return registry;
  }

  static fromMergedConfig(config: { languageServers: Record<string, LanguageServerEntry> }): LanguageRegistry {
    return LanguageRegistry.fromLanguageServers(config.languageServers);
  }

  languages(): string[] {
    return [...this.descriptors.keys()];
  }

  has(language: string): boolean {
    return this.descriptors.has(language);
  }

  descriptor(language: string): LanguageDescriptor {
    const descriptor = this.descriptors.get(language);
    if (!descriptor) throw new Error(`Unsupported language: ${language}`);
    return descriptor;
  }

  detectByExtension(filePath: string): string {
    const extension = path.extname(filePath);
    const language = this.extensionOwners.get(extension);
    if (language) return language;
    throw new Error(`Unsupported file extension for LSP language detection: ${filePath}`);
  }

  extensions(): string[] {
    return [...new Set([...this.descriptors.values()].flatMap((descriptor) => descriptor.extensions))];
  }

  private add(language: string, entry: LanguageServerEntry): void {
    const descriptor = normalizeDescriptor(language, entry);
    if (!descriptor) return; // invalid entries are skipped; Phase 2 turns this into an error
    if (descriptor.extensions.some((extension) => this.extensionOwners.has(extension))) return; // first language wins; Phase 2 turns this into an error
    this.descriptors.set(language, descriptor);
    for (const extension of descriptor.extensions) this.extensionOwners.set(extension, language);
  }
}

function normalizeDescriptor(language: string, entry: LanguageServerEntry): LanguageDescriptor | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const command = readNonEmptyString(entry.command);
  const extensions = readExtensions(entry.extensions);
  if (!command || !extensions) return undefined;
  return {
    languageId: readNonEmptyString(entry.languageId) ?? language,
    command,
    args: readStringArray(entry.args) ?? [],
    extensions,
    workspaceSeedFiles: readStringArray(entry.workspaceSeedFiles) ?? [],
    installHint: readNonEmptyString(entry.installHint) ?? `install "${command}" and make sure it is available on PATH`,
    supportLevel: entry.supportLevel === "primary" ? "primary" : "experimental"
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readExtensions(value: unknown): string[] | undefined {
  const extensions = readStringArray(value);
  if (!extensions || extensions.length === 0) return undefined;
  return extensions.every((extension) => extension.startsWith(".")) ? extensions : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return [...value];
}

export function createLanguageServerConfig(
  language: string,
  descriptor: LanguageDescriptor,
  rootPath: string
): LanguageServerConfig {
  return {
    language,
    languageId: descriptor.languageId,
    extensions: [...descriptor.extensions],
    workspaceSeedFiles: [...descriptor.workspaceSeedFiles],
    installHint: descriptor.installHint,
    supportLevel: descriptor.supportLevel,
    server: {
      command: resolveServerCommand(rootPath, descriptor.command),
      args: [...descriptor.args],
      cwd: path.resolve(rootPath)
    }
  };
}

function resolveServerCommand(rootPath: string, command: string): string {
  const localCommand = path.join(rootPath, "node_modules", ".bin", command);
  if (fs.existsSync(localCommand)) return localCommand;
  if (process.platform === "win32" && fs.existsSync(`${localCommand}.cmd`)) return `${localCommand}.cmd`;
  return command;
}
