import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readDiagnosticsTimeoutPolicy, type DiagnosticsTimeoutPolicy } from "./diagnostics-timeout.js";
import type { SupportedLanguage } from "../adapters/language-config.js";

export interface BridgeConfig {
  defaultLanguage: SupportedLanguage;
  diagnosticsTimeoutMs: DiagnosticsTimeoutPolicy;
  hook: {
    maxFiles: number;
    verbosePending: boolean;
  };
  languageServers: Partial<Record<SupportedLanguage, { command?: string; args?: string[] }>>;
}

const defaults: BridgeConfig = {
  defaultLanguage: "typescript",
  diagnosticsTimeoutMs: 15000,
  hook: {
    maxFiles: 5,
    verbosePending: false
  },
  languageServers: {}
};

export function loadConfig(rootPath: string): BridgeConfig {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const globalConfig = readConfig(path.join(codexHome, "lsp-client.json"));
  const localConfig = readConfig(path.join(rootPath, ".codex", "lsp-client.json"));
  return mergeConfig(defaults, globalConfig, localConfig);
}

function readConfig(filePath: string): Partial<BridgeConfig> {
  if (!fs.existsSync(filePath)) return {};
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<BridgeConfig>;
  return parsed && typeof parsed === "object" ? parsed : {};
}

function mergeConfig(...configs: Partial<BridgeConfig>[]): BridgeConfig {
  return configs.reduce<BridgeConfig>(
    (merged, config) => ({
      defaultLanguage: isSupportedLanguage(config.defaultLanguage) ? config.defaultLanguage : merged.defaultLanguage,
      diagnosticsTimeoutMs: readDiagnosticsTimeoutPolicy(config.diagnosticsTimeoutMs, merged.diagnosticsTimeoutMs),
      hook: {
        maxFiles: readPositiveNumber(config.hook?.maxFiles, merged.hook.maxFiles),
        verbosePending: typeof config.hook?.verbosePending === "boolean" ? config.hook.verbosePending : merged.hook.verbosePending
      },
      languageServers: {
        ...merged.languageServers,
        ...config.languageServers
      }
    }),
    { ...defaults, hook: { ...defaults.hook }, languageServers: { ...defaults.languageServers } }
  );
}

function readPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return value === "typescript" || value === "rust" || value === "python" || value === "go";
}
