import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { BridgeRequest } from "../core/operations.js";
import {
  decodeApplyCodeAction,
  decodeDefinition,
  decodeDirectoryDiagnostics,
  decodeFileDiagnostics,
  decodeHover,
  decodeListCodeActions,
  decodeReferences,
  decodeRename,
  decodeStatus,
  decodeSymbols,
  decodeWillRenameFiles,
  OperationParseError,
  type BridgeOperation
} from "../core/operations.js";

/**
 * MCP transport (docs/THESAURUS.md): supports only the standard MCP protocol
 * methods (initialize, notifications/initialized, tools/list, tools/call).
 * Tools are described by a contract table shared with the canonical operation
 * decoders — each tool's JSON Schema and its decoding rules are derived from
 * the same field spec, and a mandatory conformance test asserts they never
 * diverge. The runtime only provides execute(BridgeRequest); there is no
 * second semantic dispatch path.
 */

export const serverVersion = "0.5.0";

class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

interface ToolField {
  name: string;
  type: "string" | "number" | "boolean" | "string[]";
  required?: boolean;
  description?: string;
  enumValues?: string[];
}

interface ToolSpec {
  name: string;
  description: string;
  readOnly: boolean;
  fields: ToolField[];
  /** Maps transport argument names to canonical operation field names. */
  toCanonical: (args: Record<string, unknown>) => Record<string, unknown>;
  decode: (input: Record<string, unknown>) => BridgeOperation;
}

const toolSpecs: ToolSpec[] = [
  {
    name: "lsp_diagnostics",
    description: "Return compressed LSP diagnostics for one file, waiting up to timeoutMs for a fresh publishDiagnostics result.",
    readOnly: true,
    fields: [
      { name: "file", type: "string", required: true, description: "File path to diagnose (relative to the workspace root or absolute)." },
      { name: "timeoutMs", type: "number", description: "Maximum wait for fresh diagnostics in milliseconds." }
    ],
    toCanonical: (args) => copyByName(args, ["file", "timeoutMs"]),
    decode: decodeFileDiagnostics
  },
  {
    name: "lsp_directory_diagnostics",
    description: "Run bounded recursive File Diagnostics over a directory: maxFiles cap, concurrency, and a timeoutBudgetMs scheduling budget (in-flight requests may finish).",
    readOnly: true,
    fields: [
      { name: "dir", type: "string", required: true, description: "Directory path to scan (relative to the workspace root or absolute)." },
      { name: "severity", type: "string", enumValues: ["error", "warning", "information", "hint"], description: "Result filter by severity." },
      { name: "maxFiles", type: "number", description: "Maximum source files to diagnose." },
      { name: "timeoutBudgetMs", type: "number", description: "Maximum directory diagnostics scheduling budget in milliseconds." },
      { name: "concurrency", type: "number", description: "Maximum concurrent file diagnostics." }
    ],
    toCanonical: (args) => copyByName(args, ["dir", "severity", "maxFiles", "timeoutBudgetMs", "concurrency"]),
    decode: decodeDirectoryDiagnostics
  },
  {
    name: "lsp_definition",
    description: "Find the semantic definition. Pass symbol (optionally with language) or file + line + character; exactly one mode.",
    readOnly: true,
    fields: [
      { name: "symbol", type: "string" },
      { name: "language", type: "string", description: "Language for symbol-only lookups (default from bridge config)." },
      { name: "file", type: "string" },
      { name: "line", type: "number" },
      { name: "character", type: "number" }
    ],
    toCanonical: (args) => copyByName(args, ["symbol", "language", "file", "line", "character"]),
    decode: decodeDefinition
  },
  {
    name: "lsp_references",
    description: "Find semantic references. Pass symbol (optionally with language) or file + line + character; exactly one mode.",
    readOnly: true,
    fields: [
      { name: "symbol", type: "string" },
      { name: "language", type: "string", description: "Language for symbol-only lookups (default from bridge config)." },
      { name: "file", type: "string" },
      { name: "line", type: "number" },
      { name: "character", type: "number" }
    ],
    toCanonical: (args) => copyByName(args, ["symbol", "language", "file", "line", "character"]),
    decode: decodeReferences
  },
  {
    name: "lsp_symbols",
    description: "Search workspace symbols by query.",
    readOnly: true,
    fields: [
      { name: "query", type: "string", required: true },
      { name: "language", type: "string", description: "Language for symbol-only lookups (default from bridge config)." }
    ],
    toCanonical: (args) => copyByName(args, ["query", "language"]),
    decode: decodeSymbols
  },
  {
    name: "lsp_hover",
    description: "Return hover/type information. Pass symbol (optionally with language) or file + line + character; exactly one mode.",
    readOnly: true,
    fields: [
      { name: "symbol", type: "string" },
      { name: "language", type: "string", description: "Language for symbol-only lookups (default from bridge config)." },
      { name: "file", type: "string" },
      { name: "line", type: "number" },
      { name: "character", type: "number" }
    ],
    toCanonical: (args) => copyByName(args, ["symbol", "language", "file", "line", "character"]),
    decode: decodeHover
  },
  {
    name: "lsp_rename",
    description: "Rename a symbol across the workspace. The language server computes every occurrence and the bridge validates and applies the edit; never apply the returned edit manually. Follow up with lsp_diagnostics.",
    readOnly: false,
    fields: [
      { name: "file", type: "string", required: true },
      { name: "line", type: "number", required: true },
      { name: "character", type: "number", required: true },
      { name: "new_name", type: "string", required: true, description: "New name for the symbol." }
    ],
    toCanonical: (args) => copyByName(args, ["file", "line", "character"], { new_name: "newName" }),
    decode: decodeRename
  },
  {
    name: "lsp_code_actions",
    description: "List code actions at a cursor position (optional selection). Returns actions with stable handles; apply one via lsp_apply_code_action.",
    readOnly: false,
    fields: [
      { name: "file", type: "string", required: true },
      { name: "line", type: "number", required: true, description: "1-based cursor line." },
      { name: "character", type: "number", required: true, description: "1-based cursor character." },
      { name: "end_line", type: "number", description: "1-based selection end line; requires end_character." },
      { name: "end_character", type: "number", description: "1-based selection end character; requires end_line." },
      { name: "only", type: "string[]", description: "Optional LSP CodeActionKind filters." }
    ],
    toCanonical: (args) => copyByName(args, ["file", "line", "character", "only"], { end_line: "endLine", end_character: "endCharacter" }),
    decode: decodeListCodeActions
  },
  {
    name: "lsp_apply_code_action",
    description: "Apply a previously listed code action by its stable handle. Stale actions (source file changed since listing) are rejected.",
    readOnly: false,
    fields: [{ name: "id", type: "string", required: true, description: "Code Action Handle from lsp_code_actions." }],
    toCanonical: (args) => copyByName(args, ["id"]),
    decode: decodeApplyCodeAction
  },
  {
    name: "lsp_will_rename_files",
    description: "Request semantic import/reference updates before a physical file move, or notify the server after Codex has moved it. Codex remains responsible for the physical move.",
    readOnly: false,
    fields: [
      { name: "old_path", type: "string", required: true, description: "Current file path." },
      { name: "new_path", type: "string", required: true, description: "Destination file path." },
      { name: "renamed", type: "boolean", description: "Set true after Codex has physically moved the file." }
    ],
    toCanonical: (args) => copyByName(args, ["renamed"], { old_path: "oldPath", new_path: "newPath" }),
    decode: decodeWillRenameFiles
  },
  {
    name: "lsp_status",
    description: "Return codex-lsp-bridge status: resolved config, language server availability, Language Server Workspaces, Codex integration state, build freshness, and known runtime state.",
    readOnly: true,
    fields: [],
    toCanonical: () => ({}),
    decode: decodeStatus
  }
];

export interface McpRuntime {
  /** Executes a canonical BridgeRequest (root resolution is host-side). */
  execute: (request: BridgeRequest) => Promise<unknown>;
}

interface Request {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export function listTools(): unknown[] {
  return toolSpecs.map((spec) => ({
    name: spec.name,
    description: spec.description,
    annotations: {
      readOnlyHint: spec.readOnly,
      destructiveHint: false,
      idempotentHint: spec.readOnly,
      openWorldHint: false
    },
    inputSchema: buildInputSchema(spec.fields)
  }));
}

/** JSON Schema for a tool, derived from the same spec the decoder validates. */
function buildInputSchema(fields: ToolField[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of fields) {
    const schema: Record<string, unknown> =
      field.type === "string[]"
        ? { type: "array", items: { type: "string" } }
        : { type: field.type };
    if (field.enumValues) schema.enum = field.enumValues;
    if (field.description) schema.description = field.description;
    properties[field.name] = schema;
    if (field.required) required.push(field.name);
  }
  if (properties.root === undefined) {
    properties.root = { type: "string", description: "Optional workspace root for detached worktrees." };
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false
  };
}

export async function runStdioMcp(runtime: McpRuntime): Promise<void> {
  const rl = createInterface({ input, output });

  for await (const line of rl) {
    if (line.trim().length === 0) continue;
    const response = await handleJsonRpcLine(runtime, line);
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}

export async function handleJsonRpcLine(runtime: McpRuntime, line: string): Promise<JsonRpcResponse | undefined> {
  try {
    return handleRequest(runtime, JSON.parse(line) as Request);
  } catch {
    return {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error"
      }
    };
  }
}

export async function handleRequest(runtime: McpRuntime, request: Request): Promise<JsonRpcResponse | undefined> {
  if (request.id === undefined) {
    return undefined;
  }

  try {
    const result = await dispatch(runtime, request);
    return { jsonrpc: "2.0", id: request.id, result };
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: error instanceof JsonRpcError ? error.code : -32000,
        message: error instanceof Error ? error.message : "Unknown error"
      }
    };
  }
}

export async function dispatch(runtime: McpRuntime, request: Request): Promise<unknown> {
  if (request.method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: "codex-lsp-bridge",
        version: serverVersion
      }
    };
  }
  if (request.method === "tools/list") {
    return { tools: listTools() };
  }
  if (request.method === "tools/call") {
    const params = request.params ?? {};
    const name = params.name;
    if (typeof name !== "string") throw new JsonRpcError(-32602, "name parameter is required");
    const rawArguments = params.arguments ?? {};
    if (!rawArguments || typeof rawArguments !== "object" || Array.isArray(rawArguments)) {
      throw new JsonRpcError(-32602, "arguments parameter must be an object");
    }
    const result = await callTool(runtime, name, rawArguments as Record<string, unknown>);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ],
      structuredContent: result
    };
  }

  throw new JsonRpcError(-32601, `Unsupported method: ${request.method ?? "undefined"}`);
}

async function callTool(runtime: McpRuntime, name: string, transportArgs: Record<string, unknown>): Promise<unknown> {
  return runtime.execute(decodeToolCall(name, transportArgs));
}

/**
 * Decodes a tools/call invocation into a canonical BridgeRequest. Exported for
 * the mandatory schema↔decoder conformance tests.
 */
export function decodeToolCall(name: string, transportArgs: Record<string, unknown>): BridgeRequest {
  const spec = toolSpecs.find((candidate) => candidate.name === name);
  if (!spec) throw new JsonRpcError(-32601, `Unsupported tool: ${name}`);

  let canonical: Record<string, unknown>;
  let root: string | undefined;
  try {
    if (transportArgs.root !== undefined) {
      if (typeof transportArgs.root !== "string") {
        throw new OperationParseError("root parameter must be a string");
      }
      root = transportArgs.root;
    }
    // additionalProperties:false on the schema — reject unknown keys here so
    // the schema and the decoder can never disagree.
    const declaredNames = new Set([...spec.fields.map((field) => field.name), "root"]);
    for (const key of Object.keys(transportArgs)) {
      if (!declaredNames.has(key)) {
        throw new OperationParseError(`${spec.name}: unexpected parameter '${key}'`);
      }
    }
    const operationArgs: Record<string, unknown> = { ...transportArgs };
    delete operationArgs.root;
    canonical = spec.toCanonical(operationArgs);
  } catch (error) {
    throw toProtocolError(error);
  }

  let operation: BridgeOperation;
  try {
    operation = spec.decode(canonical);
  } catch (error) {
    throw toProtocolError(error);
  }

  return { ...(root !== undefined ? { root } : {}), operation };
}

function toProtocolError(error: unknown): JsonRpcError {
  if (error instanceof OperationParseError) return new JsonRpcError(-32602, error.message);
  return new JsonRpcError(-32602, error instanceof Error ? error.message : "Invalid parameters");
}

/** Copies fields by (transport name → canonical name) mapping. */
function copyByName(
  args: Record<string, unknown>,
  names: string[],
  aliases: Record<string, string> = {}
): Record<string, unknown> {
  const canonical: Record<string, unknown> = {};
  for (const name of names) {
    if (args[name] !== undefined) {
      canonical[aliases[name] ?? name] = args[name];
    }
  }
  for (const [transportName, canonicalName] of Object.entries(aliases)) {
    if (args[transportName] !== undefined) {
      canonical[canonicalName] = args[transportName];
    }
  }
  return canonical;
}