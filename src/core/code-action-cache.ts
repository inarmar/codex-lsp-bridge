import crypto from "node:crypto";
import fs from "node:fs/promises";
import type { CodeActionApplied, CodeActionCandidate, CodeActionHandle, CodeActionSummary, SemanticProvider } from "./types.js";

/**
 * Bounded runtime-owned store of raw Language Server Code Actions
 * (docs/THESAURUS.md, "Code Action Cache"). Maps an opaque Code Action Handle
 * to the provider instance, canonical source file, the content fingerprint
 * captured at list time, and the raw `Command | CodeAction`.
 *
 * Handles are single-use and stale-guarded: apply re-reads the source file and
 * compares its content fingerprint to the one captured at list time; a changed
 * document rejects the action as stale. The guarantee covers the source
 * document of the action; changes to other files are caught by server-supplied
 * document versions / WorkspaceEdit validation.
 */
export class CodeActionCache {
  private readonly entries = new Map<CodeActionHandle, CacheEntry>();
  private nextId = 1;

  constructor(private readonly maxEntries: number = 100) {}

  get size(): number {
    return this.entries.size;
  }

  /**
   * Stores raw candidates for one provider/file; returns agent-facing
   * summaries carrying fresh handles.
   */
  async store(provider: SemanticProvider, filePath: string, candidates: CodeActionCandidate[]): Promise<CodeActionSummary[]> {
    const contentFingerprint = await hashFile(filePath);
    return candidates.map((candidate) => {
      const id = `ca-${this.nextId++}`;
      this.entries.set(id, {
        id,
        provider,
        filePath,
        contentFingerprint,
        raw: candidate.raw,
        title: candidate.title,
        kind: candidate.kind,
        preferred: candidate.isPreferred,
        createdAt: Date.now()
      });
      this.evictIfOverflow();
      return {
        id,
        title: candidate.title,
        ...(candidate.kind !== undefined ? { kind: candidate.kind } : {}),
        ...(candidate.isPreferred !== undefined ? { preferred: candidate.isPreferred } : {})
      };
    });
  }

  /**
   * Applies the action for a handle. Unknown/expired handles and stale
   * documents (content fingerprint mismatch) reject; the handle is invalidated
   * regardless of outcome (single-use).
   */
  async apply(id: CodeActionHandle): Promise<CodeActionApplied> {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error(`Code action handle is unknown or expired: ${id}`);
    }
    this.entries.delete(id);
    const currentFingerprint = await hashFile(entry.filePath).catch(() => undefined);
    if (currentFingerprint !== entry.contentFingerprint) {
      throw new Error(`Code action is stale: ${entry.filePath} changed since the action was listed`);
    }
    return entry.provider.applyCodeAction({ file: entry.filePath, raw: entry.raw });
  }

  private evictIfOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      let oldest: CacheEntry | undefined;
      for (const entry of this.entries.values()) {
        if (!oldest || entry.createdAt < oldest.createdAt) oldest = entry;
      }
      if (!oldest) return;
      this.entries.delete(oldest.id);
    }
  }
}

interface CacheEntry {
  id: CodeActionHandle;
  provider: SemanticProvider;
  filePath: string;
  contentFingerprint: string;
  raw: unknown;
  title: string;
  kind?: string;
  preferred?: boolean;
  createdAt: number;
}

async function hashFile(filePath: string): Promise<string> {
  const text = await fs.readFile(filePath, "utf8");
  return crypto.createHash("sha256").update(text).digest("hex");
}