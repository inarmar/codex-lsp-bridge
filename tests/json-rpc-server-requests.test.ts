import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JsonRpcLspClient } from "../src/core/json-rpc-lsp-client.js";

const fakeServerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-lsp-server.mjs");

describe("JsonRpcLspClient server-to-bridge requests", () => {
  it("responds to server requests with the same id", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lsp-bridge-client-"));
    const output = path.join(dir, "responses.json");

    const client = new JsonRpcLspClient({
      command: process.execPath,
      args: [fakeServerPath, output],
      cwd: dir
    });
    try {
      const seen = new Promise<void>((resolve) => {
        client.on("request", (id, method, params) => {
          expect(id).toBe(42);
          expect(method).toBe("workspace/configuration");
          expect(params).toEqual({ items: [{}] });
          client.respond(id, [{ someSetting: true }]);
          resolve();
        });
      });
      client.notify("initialized", {});
      await seen;
      await expect(client.stop()).resolves.toBeUndefined();

      const response = JSON.parse(await fs.readFile(output, "utf8")) as { result: unknown };
      expect(response.result).toEqual([{ someSetting: true }]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
