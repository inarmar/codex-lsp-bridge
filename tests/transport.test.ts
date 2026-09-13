import { describe, expect, it } from "vitest";
import { decodeToolCall, dispatch, handleJsonRpcLine, handleRequest, listTools, type McpRuntime } from "../src/transport/mcp.js";
import type { BridgeRequest } from "../src/core/operations.js";
import { OperationParseError } from "../src/core/operations.js";

/** Captures BridgeRequests and answers with canned results by operation kind. */
class RecordingRuntime implements McpRuntime {
  readonly requests: BridgeRequest[] = [];
  readonly results: Record<string, unknown> = {};
  failWith?: Error;

  async execute(request: BridgeRequest): Promise<unknown> {
    this.requests.push(request);
    if (this.failWith) throw this.failWith;
    const result = this.results[request.operation.kind];
    return result !== undefined ? result : { kind: request.operation.kind };
  }
}

function toolCall(name: string, args: Record<string, unknown>) {
  return { method: "tools/call", params: { name, arguments: args } };
}

function expectReject(runtime: McpRuntime, request: Record<string, unknown>, message: string): void {
  expect(dispatch(runtime, request)).rejects.toThrow(message);
}

function expectRejectWithCode(runtime: McpRuntime, request: Record<string, unknown>, code: number): Promise<unknown> {
  return handleRequest(runtime, { id: 1, ...request }).then((response) => {
    expect(response).toMatchObject({ id: 1, error: { code } });
  });
}

const toolsByName = new Map(listTools().map((tool) => {
  const record = tool as { name: string };
  return [record.name, tool];
}));

describe("MCP protocol surface", () => {
  it("implements the MCP initialize and tools/list handshake", async () => {
    const runtime = new RecordingRuntime();

    await expect(dispatch(runtime, { method: "initialize" })).resolves.toMatchObject({
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "codex-lsp-bridge", version: "0.5.0" }
    });
    const listed = await dispatch(runtime, { method: "tools/list" }) as { tools: unknown[] };
    const names = (listed.tools as Array<{ name: string; annotations: { readOnlyHint: boolean } }>).map((tool) => tool.name);
    expect(names).toEqual([
      "lsp_diagnostics",
      "lsp_directory_diagnostics",
      "lsp_definition",
      "lsp_references",
      "lsp_symbols",
      "lsp_hover",
      "lsp_rename",
      "lsp_code_actions",
      "lsp_apply_code_action",
      "lsp_will_rename_files",
      "lsp_status"
    ]);
    expect(listed.tools[0]).toMatchObject({
      name: "lsp_diagnostics",
      annotations: { readOnlyHint: true, destructiveHint: false }
    });
    expect(listed.tools.find((tool) => (tool as { name: string }).name === "lsp_rename")).toMatchObject({
      annotations: { readOnlyHint: false }
    });
    expect(listed.tools.find((tool) => (tool as { name: string }).name === "lsp_code_actions")).toMatchObject({
      annotations: { readOnlyHint: false }
    });
  });

  it("routes tools/call requests through the single runtime.execute", async () => {
    const runtime = new RecordingRuntime();

    await expect(dispatch(runtime, toolCall("lsp_status", {}))).resolves.toMatchObject({
      content: [{ type: "text" }],
      structuredContent: { kind: "status" }
    });
    await expect(
      dispatch(runtime, toolCall("lsp_definition", { symbol: "Editor" }))
    ).resolves.toMatchObject({ structuredContent: { kind: "definitionBySymbol" } });
    await expect(
      dispatch(runtime, toolCall("lsp_symbols", { query: "Editor", language: "typescript" }))
    ).resolves.toMatchObject({ structuredContent: { kind: "symbols" } });
    expect(runtime.requests.at(-1)).toMatchObject({ operation: { kind: "symbols", query: "Editor", language: "typescript" } });
  });

  it("decodes position and symbol modes into typed variants", async () => {
    const runtime = new RecordingRuntime();

    await expect(dispatch(runtime, toolCall("lsp_definition", { file: "src/index.ts", line: 2, character: 10 }))).resolves.toMatchObject({
      structuredContent: { kind: "definitionAt" }
    });
    expect(runtime.requests.at(-1)).toMatchObject({
      operation: { kind: "definitionAt", file: "src/index.ts", line: 2, character: 10 }
    });

    await expect(
      dispatch(runtime, toolCall("lsp_references", { symbol: "Editor", language: "rust" }))
    ).resolves.toMatchObject({ structuredContent: { kind: "referencesBySymbol" } });
    await expect(
      dispatch(runtime, toolCall("lsp_hover", { file: "src/index.ts", line: 2, character: 10 }))
    ).resolves.toMatchObject({ structuredContent: { kind: "hoverAt" } });
  });

  it("rejects definitions mixing symbol and position or partially specifying a position", async () => {
    const runtime = new RecordingRuntime();

    await expectReject(runtime, toolCall("lsp_definition", { symbol: "Editor", file: "src/a.ts", line: 1, character: 1 }), "cannot be combined");
    await expectReject(runtime, toolCall("lsp_definition", { file: "src/a.ts", line: 1 }), "character parameter must be a positive integer");
    await expectReject(runtime, toolCall("lsp_definition", { file: "src/a.ts", line: 1, character: 1, language: "typescript" }), "only valid for symbol-based lookups");
    await expectReject(runtime, toolCall("lsp_definition", {}), "symbol or file+line+character is required");
  });

  it("routes the rename tool to the renameAt operation with newName", async () => {
    const runtime = new RecordingRuntime();

    await expect(
      dispatch(runtime, toolCall("lsp_rename", { file: "src/a.ts", line: 1, character: 1, new_name: "Renamed" }))
    ).resolves.toMatchObject({ structuredContent: { kind: "renameAt" } });
    expect(runtime.requests.at(-1)).toMatchObject({
      operation: { kind: "renameAt", file: "src/a.ts", newName: "Renamed" }
    });
  });

  it("requires a cursor position for code actions with optional selection", async () => {
    const runtime = new RecordingRuntime();

    await expectReject(runtime, toolCall("lsp_code_actions", { file: "src/a.ts" }), "line parameter must be a positive integer");
    await expect(
      dispatch(runtime, toolCall("lsp_code_actions", { file: "src/a.ts", line: 3, character: 5 }))
    ).resolves.toMatchObject({ structuredContent: { kind: "listCodeActions" } });
    expect(runtime.requests.at(-1)).toMatchObject({
      operation: { kind: "listCodeActions", file: "src/a.ts", line: 3, character: 5 }
    });
    await expectReject(runtime, toolCall("lsp_code_actions", { file: "src/a.ts", line: 1, character: 1, end_line: 2 }), "must be provided together");
    await expectReject(runtime, toolCall("lsp_code_actions", { file: "src/a.ts", line: 5, character: 1, end_line: 1, end_character: 1 }), "must not precede range start");
    await expect(
      dispatch(runtime, toolCall("lsp_code_actions", { file: "src/a.ts", line: 1, character: 1, end_line: 3, end_character: 7, only: ["quickfix"] }))
    ).resolves.toMatchObject({ structuredContent: { kind: "listCodeActions" } });
    expect(runtime.requests.at(-1)).toMatchObject({ operation: { kind: "listCodeActions", endLine: 3, endCharacter: 7, only: ["quickfix"] } });
  });

  it("rejects the legacy apply index on code actions", async () => {
    const runtime = new RecordingRuntime();

    await expectReject(runtime, toolCall("lsp_code_actions", { file: "src/a.ts", line: 1, character: 1, apply: 0 }), "unexpected parameter 'apply'");
  });

  it("routes apply code action by stable handle", async () => {
    const runtime = new RecordingRuntime();

    await expect(
      dispatch(runtime, toolCall("lsp_apply_code_action", { id: "ca-1" }))
    ).resolves.toMatchObject({ structuredContent: { kind: "applyCodeAction" } });
    expect(runtime.requests.at(-1)).toMatchObject({ operation: { kind: "applyCodeAction", id: "ca-1" } });
    await expectReject(runtime, toolCall("lsp_apply_code_action", {}), "id parameter is required");
  });

  it("routes file-rename sync with renamed flag", async () => {
    const runtime = new RecordingRuntime();

    await expect(
      dispatch(runtime, toolCall("lsp_will_rename_files", { old_path: "src/a.ts", new_path: "src/b.ts" }))
    ).resolves.toMatchObject({ structuredContent: { kind: "willRenameFiles" } });
    expect(runtime.requests.at(-1)).toMatchObject({
      operation: { kind: "willRenameFiles", oldPath: "src/a.ts", newPath: "src/b.ts", renamed: false }
    });
    await expect(
      dispatch(runtime, toolCall("lsp_will_rename_files", { old_path: "src/a.ts", new_path: "src/b.ts", renamed: true }))
    ).resolves.toMatchObject({ structuredContent: { kind: "willRenameFiles" } });
    expect(runtime.requests.at(-1)).toMatchObject({ operation: { renamed: true } });
    await expectReject(runtime, toolCall("lsp_will_rename_files", { old_path: "src/a.ts", new_path: "src/b.ts", renamed: "yes" }), "must be a boolean");
    await expectReject(runtime, toolCall("lsp_will_rename_files", { old_path: "src/a.ts" }), "newPath parameter is required");
  });

  it("passes the root selector through to the runtime", async () => {
    const runtime = new RecordingRuntime();

    await expect(
      dispatch(runtime, toolCall("lsp_diagnostics", { file: "src/a.ts", root: "/tmp/pr-review" }))
    ).resolves.toMatchObject({ structuredContent: { kind: "fileDiagnostics" } });
    expect(runtime.requests.at(-1)).toMatchObject({ root: "/tmp/pr-review" });
    await expectRejectWithCode(runtime, toolCall("lsp_diagnostics", { file: "src/a.ts", root: 5 }), -32602);
  });

  it("rejects legacy direct JSON-RPC methods", async () => {
    const runtime = new RecordingRuntime();

    await expectReject(runtime, { method: "lsp.diagnostics" }, "Unsupported method");
    await expectReject(runtime, { method: "lsp.definition", params: { symbol: "Editor" } }, "Unsupported method");
    await expectRejectWithCode(runtime, { method: "lsp.hover", params: {} }, -32601);
  });

  it("formats JSON-RPC responses, ignores notifications, and reports parse errors", async () => {
    const runtime = new RecordingRuntime();

    await expect(handleRequest(runtime, { method: "notifications/initialized" })).resolves.toBeUndefined();
    await expect(handleRequest(runtime, { id: 1, method: "initialize" })).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { serverInfo: { name: "codex-lsp-bridge" } }
    });
    await expect(handleRequest(runtime, { id: "bad", method: "tools/call", params: { name: "missing" } })).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: "bad",
      error: { code: -32601, message: "Unsupported tool: missing" }
    });
    await expect(handleJsonRpcLine(runtime, "{bad json")).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" }
    });
    await expect(handleRequest(runtime, { id: "no-args", method: "tools/call", params: { name: "lsp_symbols", arguments: "bad" } })).resolves.toMatchObject({
      error: { code: -32602, message: "arguments parameter must be an object" }
    });
  });

  it("maps parameter validation failures to code -32602", async () => {
    const runtime = new RecordingRuntime();

    await expectRejectWithCode(runtime, toolCall("lsp_diagnostics", {}), -32602);
    await expectRejectWithCode(runtime, toolCall("lsp_symbols", { query: "" }), -32602);
  });

  it("maps execution failures to code -32000", async () => {
    const runtime = new RecordingRuntime();
    runtime.failWith = new Error("server exploded");

    await expectRejectWithCode(runtime, toolCall("lsp_status", {}), -32000);
  });
});

describe("MCP tool schemas", () => {
  it("declares every field with matching types per tool", () => {
    const expectations: Record<string, Record<string, string>> = {
      lsp_diagnostics: { file: "string", timeoutMs: "number" },
      lsp_directory_diagnostics: { dir: "string", severity: "string", maxFiles: "number", timeoutBudgetMs: "number", concurrency: "number" },
      lsp_definition: { symbol: "string", language: "string", file: "string", line: "number", character: "number" },
      lsp_rename: { file: "string", line: "number", character: "number", new_name: "string" },
      lsp_code_actions: { file: "string", line: "number", character: "number", end_line: "number", end_character: "number", only: "array" },
      lsp_apply_code_action: { id: "string" },
      lsp_will_rename_files: { old_path: "string", new_path: "string", renamed: "boolean" },
      lsp_status: {}
    };

    for (const [name, fields] of Object.entries(expectations)) {
      const schema = (toolsByName.get(name) as { inputSchema: { properties: Record<string, { type?: string; items?: { type?: string } }> } }).inputSchema;
      const properties = schema.properties;
      for (const [field, type] of Object.entries(fields)) {
        expect(properties[field]?.type ?? properties[field]?.items?.type).toBe(type);
      }
      expect(properties.root?.type).toBe("string");
    }
  });

  it("marks required fields exactly where the decoder demands them", () => {
    const requiredByTool: Record<string, string[]> = {
      lsp_diagnostics: ["file"],
      lsp_directory_diagnostics: ["dir"],
      lsp_definition: [],
      lsp_references: [],
      lsp_symbols: ["query"],
      lsp_hover: [],
      lsp_rename: ["file", "line", "character", "new_name"],
      lsp_code_actions: ["file", "line", "character"],
      lsp_apply_code_action: ["id"],
      lsp_will_rename_files: ["old_path", "new_path"],
      lsp_status: []
    };

    for (const [name, required] of Object.entries(requiredByTool)) {
      const schema = (toolsByName.get(name) as { inputSchema: { required?: string[] } }).inputSchema;
      const actual = [...(schema.required ?? [])].sort();
      expect(actual).toEqual([...required].sort());
    }
  });
});

describe("schema ↔ decoder conformance (mandatory)", () => {
  /** Minimal validator for the JSON Schema subset the Bridge emits. */
  function schemaAccepts(schema: Record<string, unknown>, value: unknown): boolean {
    if (schema.type === "object") {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const record = value as Record<string, unknown>;
      const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      for (const key of Object.keys(record)) {
        if (!(key in properties)) return false; // additionalProperties: false
        if (!schemaAccepts(properties[key], record[key])) return false;
      }
      const required = (schema.required ?? []) as string[];
      for (const key of required) {
        if (!(key in record)) return false;
      }
      return true;
    }
    if (schema.type === "array") {
      if (!Array.isArray(value)) return false;
      const items = schema.items as Record<string, unknown>;
      return value.every((item) => schemaAccepts(items, item));
    }
    if (schema.type === "string") {
      if (typeof value !== "string") return false;
      const enumValues = schema.enum as string[] | undefined;
      if (enumValues && !enumValues.includes(value)) return false;
      return true;
    }
    if (schema.type === "number") return typeof value === "number" && Number.isFinite(value);
    if (schema.type === "boolean") return typeof value === "boolean";
    return false;
  }

  function decodedOk(name: string, args: Record<string, unknown>): boolean {
    try {
      decodeToolCall(name, args);
      return true;
    } catch {
      return false;
    }
  }

  const toolNames = listTools().map((tool) => (tool as { name: string }).name);

  /** A valid baseline argument set per tool (transport names, no root). */
  const validArgs: Record<string, Record<string, unknown>> = {
    lsp_diagnostics: { file: "src/a.ts" },
    lsp_directory_diagnostics: { dir: "src" },
    lsp_definition: { file: "src/a.ts", line: 1, character: 1 },
    lsp_references: { file: "src/a.ts", line: 1, character: 1 },
    lsp_symbols: { query: "Editor" },
    lsp_hover: { symbol: "Editor" },
    lsp_rename: { file: "src/a.ts", line: 1, character: 1, new_name: "Renamed" },
    lsp_code_actions: { file: "src/a.ts", line: 1, character: 1 },
    lsp_apply_code_action: { id: "ca-1" },
    lsp_will_rename_files: { old_path: "src/a.ts", new_path: "src/b.ts" },
    lsp_status: {}
  };

  const wrongTypeValues: Array<[string, unknown, unknown]> = [
    ["string", 5, "ok"],
    ["number", "5", 5],
    ["boolean", "yes", true],
    ["string[]", "not-array", ["a"]]
  ];

  it("schema and decoder agree on every tool and every field", () => {
    for (const name of toolNames) {
      const tool = toolsByName.get(name) as { inputSchema: Record<string, unknown> };
      const schema = tool.inputSchema;
      const baseline = validArgs[name];
      const fields = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;

      // Valid baseline is accepted by both.
      expect(schemaAccepts(schema, baseline)).toBe(true);
      expect(decodedOk(name, baseline)).toBe(true);

      // Required fields: schema and decoder reject the same omissions.
      const required = (schema.required ?? []) as string[];
      for (const key of required) {
        const withoutKey = { ...baseline };
        delete withoutKey[key];
        expect(schemaAccepts(schema, withoutKey), `schema accepts ${name} without ${key}`).toBe(false);
        expect(decodedOk(name, withoutKey), `decoder accepts ${name} without ${key}`).toBe(false);
      }

      // Types: wrong-type field values rejected by both; right-type accepted.
      for (const [field, spec] of Object.entries(fields)) {
        const enumValues = spec.enum as string[] | undefined;
        const fieldType = (spec.type === "array" ? "string[]" : spec.type) as "string" | "number" | "boolean" | "string[]";
        const entry = wrongTypeValues.find(([type]) => type === fieldType);
        if (!entry) continue;
        const [_, wrongValue, rightValue] = entry;

        const withWrong = { ...baseline, [field]: wrongValue };
        expect(schemaAccepts(schema, withWrong), `schema accepts ${name}.${field}=${String(wrongValue)}`).toBe(false);
        expect(decodedOk(name, withWrong), `decoder accepts ${name}.${field}=${String(wrongValue)}`).toBe(false);

        // Right-type probe only for non-enum and non-positional-pairing fields:
        // enums and symbol/position pairing are cross-field rules covered below.
        if (!enumValues && field !== "symbol" && field !== "language" && field !== "line" && field !== "character" && field !== "file" && field !== "end_line" && field !== "end_character") {
          const withRight = { ...baseline, [field]: rightValue };
          expect(schemaAccepts(schema, withRight), `schema rejects valid ${name}.${field}`).toBe(true);
          expect(decodedOk(name, withRight), `decoder rejects valid ${name}.${field}`).toBe(true);
        }

        // Enum values: rejected by both when invalid.
        if (enumValues) {
          const withInvalidEnum = { ...baseline, [field]: "not-an-enum" };
          expect(schemaAccepts(schema, withInvalidEnum)).toBe(false);
          expect(decodedOk(name, withInvalidEnum)).toBe(false);
        }
      }

      // Unknown keys: rejected by both (additionalProperties: false).
      const withUnknown = { ...baseline, bogus: 1 };
      expect(schemaAccepts(schema, withUnknown)).toBe(false);
      expect(decodedOk(name, withUnknown)).toBe(false);

      // root: string accepted by both, wrong type rejected by both.
      expect(schemaAccepts(schema, { ...baseline, root: "/tmp/root" })).toBe(true);
      expect(decodedOk(name, { ...baseline, root: "/tmp/root" })).toBe(true);
      expect(schemaAccepts(schema, { ...baseline, root: 5 })).toBe(false);
      expect(decodedOk(name, { ...baseline, root: 5 })).toBe(false);
    }
  });

  it("rejects negative and fractional integers on both surfaces", async () => {
    const runtime = new RecordingRuntime();

    await expectReject(runtime, toolCall("lsp_diagnostics", { file: "src/a.ts", timeoutMs: -1 }), "positive integer");
    await expectReject(runtime, toolCall("lsp_diagnostics", { file: "src/a.ts", timeoutMs: 1.5 }), "positive integer");
    await expectReject(runtime, toolCall("lsp_directory_diagnostics", { dir: "src", concurrency: 0 }), "positive integer");
    await expectReject(runtime, toolCall("lsp_symbols", { query: "x", language: "" }), "non-empty string");
  });
});