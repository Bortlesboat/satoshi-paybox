// Dev helper: node scripts/call.mjs <tool> '<json args>'  — one stateless MCP call against dist/plugin.mjs
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const [tool, args = "{}"] = process.argv.slice(2);
const child = spawn(process.execPath, [new URL("../dist/plugin.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "inherit"] });
const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "satoshi-dev", version: "0" }, "io.modelcontextprotocol/clientCapabilities": {} };
const msg = tool === "list" ? { method: "tools/list", params: { _meta: meta } } : { method: "tools/call", params: { name: tool, arguments: JSON.parse(args), _meta: meta } };
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, ...msg }) + "\n");
for await (const line of createInterface({ input: child.stdout })) { console.log(JSON.stringify(JSON.parse(line).result ?? JSON.parse(line), null, 2)); break; }
child.kill();
