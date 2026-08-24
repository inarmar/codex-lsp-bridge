import { describe, expect, it } from "vitest";
import { dispatch, handleJsonRpcLine, handleRequest } from "../src/transport/mcp.js";
import { CommandService } from "../src/core/command-service.js";
import type { CodeActionResult, DiagnosticReport, FileRenameSummary, HoverInfo, Location, RenameSummary, SemanticProvider, SymbolMatch } from "../src/core/types.js";

class EmptyProvider implements SemanticProvider {
  constructor(private readonly label = "default") {}
  readonly diagnosticTimeouts: Array<number | undefined> = [];

  diagnostics(_uri?: string, options?: { timeoutMs?: number }): Promise<DiagnosticReport> {
    this.diagnosticTimeouts.push(options?.timeoutMs);
    return Promise.resolve({
      status: "ok",
      timedOut: false,
      stale: false,
      items:
        this.label === "default"
          ? []
          : [
              {
                file: `${this.label}/src/a.ts`,
                line: 1,
                character: 1,
                severity: "error",
                message: `${this.label} diagnostic`
              }
            ]
    });
  }
  definition(): Promise<Location> {
    return Promise.resolve({ file: "src/a.ts", line: 1, character: 1 });
  }
  definitionAt(): Promise<Location> {
    return Promise.resolve({ file: "src/position.ts", line: 2, character: 3 });
  }
  references(): Promise<Location[]> {
    return Promise.resolve([]);
  }
  referencesAt(): Promise<Location[]> {
    return Promise.resolve([{ file: "src/position.ts", line: 2, character: 3 }]);
  }
  symbols(): Promise<SymbolMatch[]> {
    return Promise.resolve([]);
  }
  hover(): Promise<HoverInfo> {
    return Promise.resolve({ file: "src/a.ts", line: 1, character: 1, contents: "hover" });
  }
  hoverAt(): Promise<HoverInfo> {
    return Promise.resolve({ file: "src/position.ts", line: 2, character: 3, contents: "position hover" });
  }
  rename(_position: { file: string; line: number; character: number }, newName: string): Promise<RenameSummary> {
    return Promise.resolve({
      newName,
      changedFiles: ["src/a.ts"],
      createdFiles: [],
      renamedFiles: [],
      deletedFiles: [],
      editCount: 1
    });
  }
  codeActions(): Promise<CodeActionResult> {
    return Promise.resolve({ actions: [] });
  }
  willRenameFiles(oldPath: string, newPath: string, renamed = false): Promise<FileRenameSummary> {
    return Promise.resolve({ oldPath, newPath, renamed, changedFiles: [], createdFiles: [], renamedFiles: [], deletedFiles: [], editCount: 0 });
  }
  notifyFilesRenamed(oldPath: string, newPath: string): Promise<FileRenameSummary> {
    return this.willRenameFiles(oldPath, newPath, true);
  }
  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

describe("MCP dispatch", () => {
  it("implements the MCP initialize and tools/list handshake", async () => {
    const service = new CommandService(new EmptyProvider());

    await expect(dispatch(service, { method: "initialize" })).resolves.toMatchObject({
      capabilities: { tools: {} },
      serverInfo: { name: "codex-lsp-bridge" }
    });
    await expect(dispatch(service, { method: "tools/list" })).resolves.toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: "lsp_diagnostics",
          annotations: expect.objectContaining({ readOnlyHint: true, destructiveHint: false })
        }),
        expect.objectContaining({ name: "lsp_definition" }),
        expect.objectContaining({ name: "lsp_references" }),
        expect.objectContaining({ name: "lsp_symbols" }),
        expect.objectContaining({ name: "lsp_hover" }),
        expect.objectContaining({ name: "lsp_rename", annotations: expect.objectContaining({ readOnlyHint: false }) }),
        expect.objectContaining({ name: "lsp_code_actions", annotations: expect.objectContaining({ readOnlyHint: false }) }),
        expect.objectContaining({ name: "lsp_will_rename_files", annotations: expect.objectContaining({ readOnlyHint: false }) }),
        expect.objectContaining({ name: "lsp_status" })
      ])
    });
  });

  it("routes supported lsp methods", async () => {
    const service = new CommandService(new EmptyProvider());

    await expect(dispatch(service, { method: "lsp.diagnostics" })).resolves.toMatchObject({ total: 0 });
    await expect(dispatch(service, { method: "lsp.definition", params: { symbol: "Editor" } })).resolves.toMatchObject({
      file: "src/a.ts"
    });
    await expect(
      dispatch(service, { method: "lsp.definition", params: { file: "src/index.ts", line: 2, character: 10 } })
    ).resolves.toMatchObject({
      file: "src/position.ts"
    });
  });

  it("routes MCP tools/call requests to the canonical LSP command handlers", async () => {
    const service = new CommandService(new EmptyProvider());

    await expect(
      dispatch(service, { method: "tools/call", params: { name: "lsp_symbols", arguments: { query: "Editor" } } })
    ).resolves.toMatchObject({
      content: [{ type: "text" }],
      structuredContent: []
    });
    await expect(
      dispatch(service, {
        method: "tools/call",
        params: { name: "lsp_definition", arguments: { file: "src/index.ts", line: 2, character: 10 } }
      })
    ).resolves.toMatchObject({
      structuredContent: { file: "src/position.ts" }
    });
    await expect(
      dispatch(service, { method: "tools/call", params: { name: "lsp_rename", arguments: { file: "src/a.ts", line: 1, character: 1, new_name: "Renamed" } } })
    ).resolves.toMatchObject({ structuredContent: { newName: "Renamed" } });
    await expect(
      dispatch(service, { method: "tools/call", params: { name: "lsp_code_actions", arguments: { file: "src/a.ts" } } })
    ).resolves.toMatchObject({ structuredContent: { actions: [] } });
    await expect(
      dispatch(service, { method: "tools/call", params: { name: "lsp_will_rename_files", arguments: { old_path: "src/a.ts", new_path: "src/b.ts" } } })
    ).resolves.toMatchObject({ structuredContent: { renamed: false, oldPath: "src/a.ts", newPath: "src/b.ts" } });
    await expect(
      dispatch(service, { method: "tools/call", params: { name: "lsp_status", arguments: {} } }, { status: () => ({ ok: true }) })
    ).resolves.toMatchObject({
      structuredContent: { ok: true }
    });
  });

  it("passes timeoutMs to file diagnostics and rejects directory-only timeoutBudgetMs for files", async () => {
    const provider = new EmptyProvider();
    const service = new CommandService(provider);

    await expect(
      dispatch(service, {
        method: "tools/call",
        params: { name: "lsp_diagnostics", arguments: { file: "src/index.ts", timeoutMs: 15000 } }
      })
    ).resolves.toMatchObject({
      structuredContent: { total: 0 }
    });
    expect(provider.diagnosticTimeouts).toEqual([15000]);

    await expect(
      dispatch(service, {
        method: "tools/call",
        params: { name: "lsp_diagnostics", arguments: { file: "src/index.ts", timeoutBudgetMs: 15000 } }
      })
    ).rejects.toThrow("timeoutBudgetMs is only valid for directory diagnostics");
  });

  it("allows MCP runtimes to select a scoped workspace service from tool arguments", async () => {
    const defaultService = new CommandService(new EmptyProvider());
    const scopedService = new CommandService(new EmptyProvider("detached"));
    const seenParams: Record<string, unknown>[] = [];

    await expect(
      dispatch(
        defaultService,
        {
          method: "tools/call",
          params: {
            name: "lsp_diagnostics",
            arguments: { file: "/tmp/pr-review/src/a.ts", root: "/tmp/pr-review" }
          }
        },
        {
          serviceForParams: (params) => {
            seenParams.push(params);
            return scopedService;
          }
        }
      )
    ).resolves.toMatchObject({
      structuredContent: {
        total: 1,
        items: [{ file: "detached/src/a.ts", message: "detached diagnostic" }]
      }
    });
    expect(seenParams).toEqual([{ file: "/tmp/pr-review/src/a.ts", root: "/tmp/pr-review" }]);
  });

  it("keeps the default MCP service when no root argument is provided", async () => {
    const defaultService = new CommandService(new EmptyProvider());
    const scopedService = new CommandService(new EmptyProvider("detached"));
    let scopedCalls = 0;

    await expect(
      dispatch(
        defaultService,
        {
          method: "tools/call",
          params: {
            name: "lsp_diagnostics",
            arguments: { file: "/tmp/pr-review/src/a.ts" }
          }
        },
        {
          serviceForParams: () => {
            scopedCalls += 1;
            return scopedService;
          }
        }
      )
    ).resolves.toMatchObject({
      structuredContent: {
        total: 0
      }
    });
    expect(scopedCalls).toBe(0);
  });

  it("passes directory diagnostics through the runtime with optional root and severity", async () => {
    const service = new CommandService(new EmptyProvider());

    await expect(
      dispatch(
        service,
        {
          method: "tools/call",
          params: {
            name: "lsp_diagnostics",
            arguments: { dir: "/tmp/pr-review/src", root: "/tmp/pr-review", severity: "error", maxFiles: 3, timeoutBudgetMs: 1000, concurrency: 2 }
          }
        },
        {
          directoryDiagnostics: async (request) => request
        }
      )
    ).resolves.toMatchObject({
      structuredContent: {
        dir: "/tmp/pr-review/src",
        root: "/tmp/pr-review",
        severity: "error",
        maxFiles: 3,
        timeoutBudgetMs: 1000,
        concurrency: 2
      }
    });
  });

  it("formats JSON-RPC responses and ignores notifications", async () => {
    const service = new CommandService(new EmptyProvider());

    await expect(handleRequest(service, { method: "notifications/initialized" })).resolves.toBeUndefined();
    await expect(handleRequest(service, { id: 1, method: "initialize" })).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { serverInfo: { name: "codex-lsp-bridge" } }
    });
    await expect(handleRequest(service, { id: "bad", method: "tools/call", params: { name: "missing" } })).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: "bad",
      error: { code: -32601, message: "Unsupported tool: missing" }
    });
    await expect(handleJsonRpcLine(service, "{bad json")).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" }
    });
    await expect(handleRequest(service, { id: 2, method: "lsp.hover", params: {} })).resolves.toMatchObject({
      error: { code: -32602, message: "symbol parameter is required" }
    });
  });

  it("fails closed for unsupported methods and missing parameters", async () => {
    const service = new CommandService(new EmptyProvider());

    await expect(dispatch(service, { method: "unknown" })).rejects.toThrow("Unsupported method");
    await expect(dispatch(service, { method: "lsp.hover", params: {} })).rejects.toThrow("symbol parameter is required");
    await expect(dispatch(service, { method: "lsp.hover", params: { file: "src/index.ts" } })).rejects.toThrow(
      "line parameter is required"
    );
    await expect(dispatch(service, { method: "tools/call", params: { name: "lsp_symbols", arguments: "bad" } })).rejects.toThrow(
      "arguments parameter must be an object"
    );
  });
});
