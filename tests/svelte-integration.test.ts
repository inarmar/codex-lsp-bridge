import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLanguageServerConfig } from "../src/adapters/language-registry.js";
import { defaultLanguageServers } from "../src/adapters/default-language-servers.js";
import { JsonRpcLspClient } from "../src/core/json-rpc-lsp-bridge.js";
import { LspSemanticProvider } from "../src/core/lsp-semantic-provider.js";
import { filePathToUri } from "../src/utils/uri.js";

const shouldRunSvelteIntegration = process.env.CODEX_LSP_RUN_SVELTE_INTEGRATION === "1";
const hasSvelteServer = shouldRunSvelteIntegration && (await commandExists("svelteserver"));

describe.skipIf(!hasSvelteServer)("Svelte language server integration", () => {
  it("round-trips diagnostics through svelteserver", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-svelte-fixture-"));
    const filePath = path.join(rootPath, "src", "App.svelte");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, "package.json"),
      JSON.stringify({ name: "codex-lsp-svelte-fixture", private: true, devDependencies: { svelte: "^5.0.0" } }),
      "utf8"
    );
    await fs.writeFile(
      filePath,
      "<script lang=\"ts\">\n  const value: string = 1;\n</script>\n\n<p>{value}</p>\n",
      "utf8"
    );

    const config = createLanguageServerConfig("svelte", defaultLanguageServers.svelte, rootPath);
    const provider = new LspSemanticProvider({
      rootPath,
      languageId: config.languageId,
      server: config.server,
      workspaceSeedFiles: config.workspaceSeedFiles,
      workspaceSeedExtensions: config.extensions,
      diagnosticsTimeoutMs: 10000,
      clientFactory: (server) => new JsonRpcLspClient(server)
    });

    try {
      const report = await provider.diagnostics(filePathToUri(filePath));
      expect(report.status).toBe("ok");
    } finally {
      await provider.dispose();
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  }, 20000);
});

async function commandExists(command: string): Promise<boolean> {
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const directory of pathEntries) {
    try {
      await fs.access(path.join(directory, command));
      return true;
    } catch {
      continue;
    }
  }
  return false;
}
