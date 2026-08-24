import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultLanguageServers } from "../adapters/default-language-servers.js";
import { LanguageRegistry, type LanguageServerEntry, type SupportedLanguage } from "../adapters/language-registry.js";
import { readDiagnosticsTimeoutPolicy, type DiagnosticsTimeoutPolicy } from "./diagnostics-timeout.js";

export interface BridgeConfig {
  defaultLanguage: SupportedLanguage;
  diagnosticsTimeoutMs: DiagnosticsTimeoutPolicy;
  hook: {
    maxFiles: number;
    verbosePending: boolean;
  };
  languageServers: Record<string, LanguageServerEntry>;
}

const defaults: BridgeConfig = {
  defaultLanguage: "typescript",
  diagnosticsTimeoutMs: 15000,
  hook: {
    maxFiles: 5,
    verbosePending: false
  },
  languageServers: { ...defaultLanguageServers }
};

export function loadConfig(rootPath: string): BridgeConfig {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const globalConfig = readConfig(path.join(codexHome, "lsp-client.json"));
  const localConfig = readConfig(path.join(rootPath, ".codex", "lsp-client.json"));
  const config = mergeConfig(defaults, globalConfig, localConfig);
  const registry = LanguageRegistry.fromMergedConfig(config);
  if (!registry.has(config.defaultLanguage)) {
    return { ...config, defaultLanguage: defaults.defaultLanguage };
  }
  return config;
}

function readConfig(filePath: string): Partial<BridgeConfig> {
  if (!fs.existsSync(filePath)) return {};
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<BridgeConfig>;
  return parsed && typeof parsed === "object" ? parsed : {};
}

function mergeConfig(...configs: Partial<BridgeConfig>[]): BridgeConfig {
  return configs.reduce<BridgeConfig>(
    (merged, config) => ({
      defaultLanguage: typeof config.defaultLanguage === "string" ? config.defaultLanguage : merged.defaultLanguage,
      diagnosticsTimeoutMs: readDiagnosticsTimeoutPolicy(config.diagnosticsTimeoutMs, merged.diagnosticsTimeoutMs),
      hook: {
        maxFiles: readPositiveNumber(config.hook?.maxFiles, merged.hook.maxFiles),
        verbosePending: typeof config.hook?.verbosePending === "boolean" ? config.hook.verbosePending : merged.hook.verbosePending
      },
      languageServers: mergeLanguageServers(merged.languageServers, config.languageServers)
    }),
    { ...defaults, hook: { ...defaults.hook }, languageServers: { ...defaults.languageServers } }
  );
}

function mergeLanguageServers(
  base: Record<string, LanguageServerEntry>,
  overlay: Record<string, LanguageServerEntry> | undefined
): Record<string, LanguageServerEntry> {
  const merged: Record<string, LanguageServerEntry> = { ...base };
  for (const [language, entry] of Object.entries(overlay ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    const current: LanguageServerEntry = { ...merged[language] };
    for (const [key, value] of Object.entries(entry)) {
      if (value !== undefined) (current as Record<string, unknown>)[key] = value;
    }
    merged[language] = current;
  }
  return merged;
}

function readPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
