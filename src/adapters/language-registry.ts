import fs from "node:fs";
import path from "node:path";
import type { ServerProcessConfig } from "../core/json-rpc-lsp-bridge.js";

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

  static fromLanguageServers(entries: Record<string, unknown>): LanguageRegistry {
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

  private add(language: string, entry: unknown): void {
    const normalized = normalizeDescriptor(language, entry);
    if (typeof normalized === "string") {
      throw new Error(normalized);
    }
    const collision = normalized.extensions.find((extension) => this.extensionOwners.has(extension));
    if (collision) {
      throw new Error(`languageServers.${language}: extension "${collision}" is already used by language "${this.extensionOwners.get(collision)}"`);
    }
    this.descriptors.set(language, normalized);
    for (const extension of normalized.extensions) this.extensionOwners.set(extension, language);
  }
}

function normalizeDescriptor(language: string, entry: unknown): LanguageDescriptor | string {
  if (!entry || typeof entry !== "object") return `languageServers.${language}: expected an object`;
  const record = entry as Record<string, unknown>;
  const problems: string[] = [];

  const command = readNonEmptyString(record.command);
  if (!command) {
    problems.push(record.command === undefined ? `missing required field 'command'` : `field 'command' must be a non-empty string`);
  }

  const extensions = readExtensions(record.extensions);
  if (!extensions) {
    problems.push(record.extensions === undefined ? `missing required field 'extensions'` : `field 'extensions' must be a non-empty array of extensions starting with '.'`);
  }

  if (record.languageId !== undefined && !readNonEmptyString(record.languageId)) {
    problems.push(`field 'languageId' must be a non-empty string`);
  }
  if (record.args !== undefined && !readStringArray(record.args)) {
    problems.push(`field 'args' must be an array of strings`);
  }
  if (record.workspaceSeedFiles !== undefined && !readStringArray(record.workspaceSeedFiles)) {
    problems.push(`field 'workspaceSeedFiles' must be an array of strings`);
  }
  if (record.installHint !== undefined && !readNonEmptyString(record.installHint)) {
    problems.push(`field 'installHint' must be a non-empty string`);
  }
  if (record.supportLevel !== undefined && record.supportLevel !== "primary" && record.supportLevel !== "experimental") {
    problems.push(`field 'supportLevel' must be "primary" or "experimental"`);
  }

  if (problems.length > 0) return `languageServers.${language}: ${problems.join("; ")}`;

  return {
    languageId: readNonEmptyString(record.languageId) ?? language,
    command: command!,
    args: readStringArray(record.args) ?? [],
    extensions: extensions!,
    workspaceSeedFiles: readStringArray(record.workspaceSeedFiles) ?? [],
    installHint: readNonEmptyString(record.installHint) ?? `install "${command}" and make sure it is available on PATH`,
    supportLevel: record.supportLevel === "primary" ? "primary" : "experimental"
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
