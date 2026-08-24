// Fake LSP server used by json-rpc-server-requests.test.ts.
// Protocol: on the first notification from the bridge, sends one
// server-to-bridge request (workspace/configuration, id 42); records the
// bridge's response to that request into the file given as argv[2]; answers
// every bridge request (e.g. shutdown) with result null.
import fs from "node:fs";

const output = process.argv[2];
let buffer = "";
let sentRequest = false;

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const match = /Content-Length:\s*(\d+)/i.exec(buffer.slice(0, headerEnd));
    if (!match) return;
    const bodyEnd = headerEnd + 4 + Number(match[1]);
    if (buffer.length < bodyEnd) return;
    const message = JSON.parse(buffer.slice(headerEnd + 4, bodyEnd));
    buffer = buffer.slice(bodyEnd);
    handle(message);
  }
});

function send(message) {
  const body = JSON.stringify(message);
  const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
  process.stdout.write(Buffer.from(frame, "utf8"));
}

function handle(message) {
  if (message.id !== undefined && message.method !== undefined) {
    send({ jsonrpc: "2.0", id: message.id, result: null });
    return;
  }
  if (message.id === 42) {
    fs.writeFileSync(output, JSON.stringify(message));
    return;
  }
  if (message.method && !sentRequest) {
    sentRequest = true;
    send({ jsonrpc: "2.0", id: 42, method: "workspace/configuration", params: { items: [{}] } });
  }
}
