import fs from "node:fs/promises";
import path from "node:path";

/**
 * Shared path resolution (docs/THESAURUS.md, "Workspace Path Resolver").
 *
 * The single place that turns transport path input into a canonical absolute
 * path inside the Workspace Root:
 *
 * - relative input resolves against the Workspace Root (not process.cwd());
 * - absolute input is allowed (containment still enforced);
 * - existing targets are realpath-checked, so symlink escapes are blocked;
 * - a not-yet-existing target (create/rename target) is validated through the
 *   realpath of its nearest existing parent, hardening non-existing paths
 *   under symlinked parents.
 *
 * The Workspace Root passed to these functions is expected to be canonical
 * (see resolveWorkspaceRoot); containment is checked against it.
 */

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Canonical Workspace Root: an existing directory, realpath'd, no marker checks. */
export async function resolveWorkspaceRoot(input: string): Promise<string> {
  const candidate = path.resolve(input);
  let realPath: string;
  try {
    realPath = await fs.realpath(candidate);
  } catch {
    throw new WorkspacePathError(`Workspace root does not exist: ${candidate}`);
  }
  let stat;
  try {
    stat = await fs.stat(realPath);
  } catch {
    throw new WorkspacePathError(`Workspace root does not exist: ${candidate}`);
  }
  if (!stat.isDirectory()) {
    throw new WorkspacePathError(`Workspace root is not a directory: ${candidate}`);
  }
  return realPath;
}

/** True when `filePath` is the root itself or lexically inside it. */
export function isPathInsideRoot(filePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, filePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/**
 * Resolves an existing file inside the Workspace Root. The target must exist,
 * must be a file, and its realpath must stay inside the root.
 */
export async function resolveWorkspaceFile(rootPath: string, input: string): Promise<string> {
  const absolute = toAbsolute(rootPath, input);
  const realPath = await fs.realpath(absolute).catch(() => undefined);
  if (!realPath) {
    throw new WorkspacePathError(`File not found: ${absolute}`);
  }
  if (!isPathInsideRoot(realPath, rootPath)) {
    throw new WorkspacePathError(`File is outside workspace root: ${input}`);
  }
  const stat = await fs.stat(realPath);
  if (!stat.isFile()) {
    throw new WorkspacePathError(`Not a file: ${input}`);
  }
  return realPath;
}

/**
 * Resolves an existing directory inside the Workspace Root. The target must
 * exist, must be a directory, and its realpath must stay inside the root.
 */
export async function resolveWorkspaceDirectory(rootPath: string, input: string): Promise<string> {
  const absolute = toAbsolute(rootPath, input);
  const realPath = await fs.realpath(absolute).catch(() => undefined);
  if (!realPath) {
    throw new WorkspacePathError(`Directory not found: ${absolute}`);
  }
  if (!isPathInsideRoot(realPath, rootPath)) {
    throw new WorkspacePathError(`Directory is outside workspace root: ${input}`);
  }
  const stat = await fs.stat(realPath);
  if (!stat.isDirectory()) {
    throw new WorkspacePathError(`Not a directory: ${input}`);
  }
  return realPath;
}

/**
 * Resolves a workspace target that may or may not exist yet (used for
 * create/rename file targets and file-rename sync):
 *
 * - existing target  → realpath(target) must stay inside the Workspace Root;
 * - missing target   → realpath of the nearest existing parent must stay
 *   inside the Workspace Root (blocks creating files through symlinked
 *   parents that escape the root); the lexical absolute path is returned.
 */
export async function resolveWorkspaceTarget(rootPath: string, input: string): Promise<string> {
  const absolute = toAbsolute(rootPath, input);
  const realPath = await fs.realpath(absolute).catch(() => undefined);
  if (realPath) {
    if (!isPathInsideRoot(realPath, rootPath)) {
      throw new WorkspacePathError(`File is outside workspace root: ${input}`);
    }
    return realPath;
  }

  const parentRealPath = await realpathNearestExistingParent(absolute);
  if (!parentRealPath || !isPathInsideRoot(parentRealPath, rootPath)) {
    throw new WorkspacePathError(`File is outside workspace root: ${input}`);
  }
  return absolute;
}

function toAbsolute(rootPath: string, input: string): string {
  return path.isAbsolute(input) ? path.normalize(input) : path.resolve(rootPath, input);
}

async function realpathNearestExistingParent(targetPath: string): Promise<string | undefined> {
  let directory = path.dirname(targetPath);
  while (true) {
    const realPath = await fs.realpath(directory).catch(() => undefined);
    if (realPath) return realPath;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}