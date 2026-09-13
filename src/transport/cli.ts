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
  type BridgeRequest
} from "../core/operations.js";

/**
 * Pure CLI argv parser (docs/THESAURUS.md, "Bridge Request"): converts CLI
 * syntax into a canonical BridgeRequest — it never creates services, runs
 * operations, reads LSP, or performs file IO. Semantic validation happens in
 * the canonical operation decoders.
 *
 * CLI numeric options arrive as strings; this layer converts them to numbers
 * (transport syntax), the operation decoders enforce positive integers.
 */

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
  }
}

interface CliTokens {
  command: string;
  positionals: string[];
  options: Map<string, string>;
}

export function parseCliArgs(argv: string[]): BridgeRequest {
  const { command, positionals, options } = tokenize(argv);

  const root = options.get("root");
  const numeric = (key: string): number | undefined => {
    const raw = options.get(key);
    if (raw === undefined) return undefined;
    return parseDecimalNumber(raw);
  };

  switch (command) {
    case "status":
      assertAllowedOptions(options, ["root"], command);
      assertNoPositionals(positionals, command);
      return { ...requestRoot(root), operation: decodeStatus({}) };
    case "diagnostics":
      assertAllowedOptions(options, ["file", "timeout-ms", "root"], command);
      assertNoPositionals(positionals, command);
      return {
        ...requestRoot(root),
        operation: decodeFileDiagnostics(withOptional("timeoutMs", numeric("timeout-ms"), { file: options.get("file") }))
      };
    case "directory-diagnostics":
      assertAllowedOptions(options, ["dir", "severity", "max-files", "timeout-budget-ms", "concurrency", "root"], command);
      assertNoPositionals(positionals, command);
      return {
        ...requestRoot(root),
        operation: decodeDirectoryDiagnostics(
          withOptionals(
            {
              dir: options.get("dir"),
              severity: options.get("severity")
            },
            [
              ["maxFiles", numeric("max-files")],
              ["timeoutBudgetMs", numeric("timeout-budget-ms")],
              ["concurrency", numeric("concurrency")]
            ]
          )
        )
      };
    case "definition":
      assertAllowedOptions(options, ["file", "line", "character", "language", "root"], command);
      return { ...requestRoot(root), operation: decodeDefinition(symbolOrPosition(command, positionals, options)) };
    case "references":
      assertAllowedOptions(options, ["file", "line", "character", "language", "root"], command);
      return { ...requestRoot(root), operation: decodeReferences(symbolOrPosition(command, positionals, options)) };
    case "hover":
      assertAllowedOptions(options, ["file", "line", "character", "language", "root"], command);
      return { ...requestRoot(root), operation: decodeHover(symbolOrPosition(command, positionals, options)) };
    case "symbols":
      assertAllowedOptions(options, ["language", "root"], command);
      assertAtMostOnePositional(positionals, command);
      return {
        ...requestRoot(root),
        operation: decodeSymbols(withOptional("language", options.get("language"), { query: positionals[0] }))
      };
    case "rename":
      assertAllowedOptions(options, ["file", "line", "character", "new-name", "root"], command);
      assertNoPositionals(positionals, command);
      return {
        ...requestRoot(root),
        operation: decodeRename(
          withOptionals(
            {
              file: options.get("file"),
              newName: options.get("new-name")
            },
            [
              ["line", numeric("line")],
              ["character", numeric("character")]
            ]
          )
        )
      };
    case "code-actions":
      assertAllowedOptions(options, ["file", "line", "character", "end-line", "end-character", "only", "root"], command);
      assertNoPositionals(positionals, command);
      return {
        ...requestRoot(root),
        operation: decodeListCodeActions(
          withOptionals(
            {
              file: options.get("file"),
              only: options.get("only") ? options.get("only")!.split(",").map((kind) => kind.trim()).filter(Boolean) : undefined
            },
            [
              ["line", numeric("line")],
              ["character", numeric("character")],
              ["endLine", numeric("end-line")],
              ["endCharacter", numeric("end-character")]
            ]
          )
        )
      };
    case "apply-code-action":
      assertAllowedOptions(options, ["id", "root"], command);
      assertNoPositionals(positionals, command);
      return { ...requestRoot(root), operation: decodeApplyCodeAction({ id: options.get("id") }) };
    case "will-rename-files":
      assertAllowedOptions(options, ["old-path", "new-path", "renamed", "root"], command);
      assertNoPositionals(positionals, command);
      return {
        ...requestRoot(root),
        operation: decodeWillRenameFiles(
          withOptional("renamed", readRenamedFlag(options.get("renamed")), {
            oldPath: options.get("old-path"),
            newPath: options.get("new-path")
          })
        )
      };
    default:
      throw new CliUsageError(`Unknown command: ${command}`);
  }
}

function assertAllowedOptions(options: Map<string, string>, allowed: string[], command: string): void {
  for (const key of options.keys()) {
    if (!allowed.includes(key)) {
      throw new CliUsageError(`Unknown option --${key} for command ${command}`);
    }
  }
}

function assertNoPositionals(positionals: string[], command: string): void {
  if (positionals.length > 0) {
    throw new CliUsageError(`Command ${command} does not accept positional arguments: ${positionals[0]}`);
  }
}

function assertAtMostOnePositional(positionals: string[], command: string): void {
  if (positionals.length > 1) {
    throw new CliUsageError(`Command ${command} accepts a single positional argument: ${positionals[0]}`);
  }
}

function requestRoot(root: string | undefined): { root?: string } {
  return root !== undefined ? { root } : {};
}

function symbolOrPosition(command: string, positionals: string[], options: Map<string, string>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (positionals.length > 0) input.symbol = positionals[0];
  if (positionals.length > 1) throw new CliUsageError(`${command} accepts a single symbol argument`);
  const file = options.get("file");
  if (file !== undefined) input.file = file;
  const line = options.get("line");
  if (line !== undefined) input.line = parseDecimalNumber(line);
  const character = options.get("character");
  if (character !== undefined) input.character = parseDecimalNumber(character);
  const language = options.get("language");
  if (language !== undefined) input.language = language;
  return input;
}

/** Strict decimal parsing: hex/exponent forms (0x10, 1e3) never reach the decoder. */
function parseDecimalNumber(raw: string): number {
  return /^[0-9]+(\.[0-9]+)?$/.test(raw.trim()) ? Number(raw) : NaN;
}

function readRenamedFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new CliUsageError("--renamed must be true or false");
}

function withOptional<A extends Record<string, unknown>, K extends string>(key: K, value: unknown, base: A): A & { [P in K]?: unknown } {
  return value === undefined ? base : { ...base, [key]: value };
}

function withOptionals(base: Record<string, unknown>, entries: Array<[string, unknown]>): Record<string, unknown> {
  for (const [key, value] of entries) {
    if (value !== undefined) base[key] = value;
  }
  return base;
}

function tokenize(argv: string[]): CliTokens {
  if (argv.length === 0) throw new CliUsageError("Missing command");
  const command = argv[0];
  const positionals: string[] = [];
  const options = new Map<string, string>();

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equalsIndex = token.indexOf("=");
    const name = equalsIndex === -1 ? token.slice(2) : token.slice(2, equalsIndex);
    if (equalsIndex !== -1) {
      options.set(name, token.slice(equalsIndex + 1));
      continue;
    }
    const rawValue = argv[index + 1];
    if (rawValue === undefined || rawValue.startsWith("--")) {
      throw new CliUsageError(`Option --${name} requires a value`);
    }
    options.set(name, rawValue);
    index += 1;
  }

  return { command, positionals, options };
}