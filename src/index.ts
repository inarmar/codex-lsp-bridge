#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CliUsageError, parseCliArgs } from "./transport/cli.js";
import { executeOperation, OperationParseError } from "./core/operations.js";
import { WorkspaceRuntimeRegistry } from "./core/workspace-runtime.js";
import { loadConfig } from "./core/config.js";
import { LanguageRegistry } from "./adapters/language-registry.js";
import { defaultLanguageServers } from "./adapters/default-language-servers.js";
import { runStdioMcp } from "./transport/mcp.js";

/**
 * Composition entry point: the only owner of the Workspace Root → Workspace
 * Runtime map. Transport decoders produce BridgeRequests; this layer resolves
 * the root, gets/creates the runtime, and dispatches through executeOperation.
 */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    printUsage("stdout", defaultRegistry().languages());
    return;
  }
  if (args[0] === "post-tool-diagnostics") {
    runPackageScript("codex-lsp-post-tool-use.mjs", args.slice(1));
    return;
  }
  if (args[0] === "languages") {
    const root = path.resolve(readOption(args, "--root") ?? process.cwd());
    const registry = LanguageRegistry.fromMergedConfig(loadConfig(root));
    const byExtension: Record<string, { language: string; command: string }> = {};
    for (const language of registry.languages()) {
      const descriptor = registry.descriptor(language);
      for (const extension of descriptor.extensions) {
        byExtension[extension] = { language, command: descriptor.command };
      }
    }
    console.log(JSON.stringify(byExtension, null, 2));
    return;
  }

  const runtimes = new WorkspaceRuntimeRegistry();
  try {
    if (args[0] === "mcp") {
      const baseRoot = path.resolve(readOption(args, "--root") ?? process.cwd());
      await runStdioMcp({
        execute: async (request) => {
          const root = request.root !== undefined ? request.root : baseRoot;
          const runtime = await runtimes.get(root);
          return executeOperation(runtime, request.operation);
        }
      });
      return;
    }

    const request = parseCliArgs(args);
    const root = request.root !== undefined ? request.root : process.cwd();
    const runtime = await runtimes.get(root);
    const result = await executeOperation(runtime, request.operation);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await runtimes.disposeAll();
  }
}

function defaultRegistry(): LanguageRegistry {
  return LanguageRegistry.fromLanguageServers(defaultLanguageServers);
}

function readOption(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  if (index === -1) return undefined;
  return args[index + 1];
}

function printUsage(stream: "stdout" | "stderr", languages: string[]): void {
  const languageOptions = `[--language ${languages.join("|")}]`;
  const usage = `Usage:
  codex-lsp-bridge post-tool-diagnostics
  codex-lsp-bridge status [--root path]
  codex-lsp-bridge languages [--root path]
  codex-lsp-bridge diagnostics --file path [--timeout-ms n] [--root path]
  codex-lsp-bridge directory-diagnostics --dir path [--severity error|warning|information|hint] [--max-files n] [--timeout-budget-ms n] [--concurrency n] [--root path]
  codex-lsp-bridge definition <symbol> ${languageOptions} [--root path]
  codex-lsp-bridge definition --file path --line n --character n [--root path]
  codex-lsp-bridge references <symbol> ${languageOptions} [--root path]
  codex-lsp-bridge references --file path --line n --character n [--root path]
  codex-lsp-bridge symbols <query> ${languageOptions} [--root path]
  codex-lsp-bridge hover <symbol> ${languageOptions} [--root path]
  codex-lsp-bridge hover --file path --line n --character n [--root path]
  codex-lsp-bridge code-actions --file path --line n --character n [--end-line n --end-character n] [--only kind[,kind]] [--root path]
  codex-lsp-bridge apply-code-action --id <handle> [--root path]
  codex-lsp-bridge will-rename-files --old-path path --new-path path [--renamed true|false] [--root path]
  codex-lsp-bridge rename --file path --line n --character n --new-name name [--root path]
  codex-lsp-bridge mcp [--root path]`;
  if (stream === "stdout") {
    console.log(usage);
    return;
  }
  console.error(usage);
}

function runPackageScript(scriptName: string, args: string[]): void {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const scriptPath = path.join(packageRoot, "scripts", scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit"
  });
  process.exitCode = result.status ?? 1;
}

main().catch((error) => {
  if (error instanceof CliUsageError) {
    console.error(error.message);
    printUsage("stderr", defaultRegistry().languages());
  } else if (error instanceof OperationParseError) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});