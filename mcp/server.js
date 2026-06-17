#!/usr/bin/env node
// Pharos Reserve — stdio MCP server (zero dependencies in simulation mode).
//
// Speaks JSON-RPC 2.0 over stdin/stdout, implementing the minimal MCP surface
// (initialize, tools/list, tools/call). Holds one treasury adapter per session.
// In simulation mode it runs offline; set PRIVATE_KEY (+ optional ESCROW/RPC) to
// read real Pharos balances via the live adapter.
//
//   node mcp/server.js
//
// MCP client config:
//   { "mcpServers": { "pharos-reserve": { "command": "node", "args": ["mcp/server.js"] } } }

import {
  reserveStatus,
  reservePlan,
  refuel,
  sweep,
  reclaim,
  runMetabolism,
  ReserveSimulationAdapter,
} from "../sdk/index.js";

async function makeAdapter() {
  if (process.env.PRIVATE_KEY) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || "0";
    const { PharosReserveAdapter } = await import("../sdk/rpc-adapter.js");
    const a = new PharosReserveAdapter({
      rpcUrl: process.env.PHAROS_TESTNET_RPC,
      privateKey: process.env.PRIVATE_KEY,
      yieldVenue: process.env.YIELD_VENUE,
    });
    await a.syncNetwork();
    console.error(`[pharos-reserve] LIVE on ${a.network.name} (chain ${a.network.chainId}) as ${a.self}`);
    return a;
  }
  console.error("[pharos-reserve] simulation mode");
  return new ReserveSimulationAdapter({ gasPhrs: 0.05, usdcUsd: 500 });
}

const adapter = await makeAdapter();

const TOOLS = [
  {
    name: "reserve_status",
    description: "Read the agent's treasury: gas (PHRS), USDC, and yield balances on the current network.",
    inputSchema: { type: "object", properties: {} },
    run: () => reserveStatus({ adapter }),
  },
  {
    name: "reserve_plan",
    description: "Decide the next reserve action (refuel / sweep / hold / alert) from current balances and policy.",
    inputSchema: { type: "object", properties: { policy: { type: "object" } } },
    run: (a) => reservePlan({ adapter, policy: a.policy }),
  },
  {
    name: "reserve_refuel",
    description: "Top up gas from USDC when the agent is running low. Sentinel-gated; acts only if a refuel is needed.",
    inputSchema: { type: "object", properties: { policy: { type: "object" } } },
    run: (a) => refuel({ adapter, policy: a.policy }),
  },
  {
    name: "reserve_sweep",
    description: "Subscribe idle USDC above the working threshold into pALPHA yield. Sentinel-gated; acts only when profitable.",
    inputSchema: { type: "object", properties: { policy: { type: "object" } } },
    run: (a) => sweep({ adapter, policy: a.policy }),
  },
  {
    name: "reserve_reclaim",
    description: "Submit a redemption request to the pALPHA yield venue when working USDC is low. Sentinel-gated; funds return after the venue's queue.",
    inputSchema: { type: "object", properties: { policy: { type: "object" } } },
    run: (a) => reclaim({ adapter, policy: a.policy }),
  },
  {
    name: "reserve_run_metabolism",
    description: "Run the autonomous loop for N ticks: read balances, decide, and refuel/sweep per policy.",
    inputSchema: { type: "object", properties: { ticks: { type: "number" }, policy: { type: "object" } } },
    run: (a) => runMetabolism({ adapter, ticks: a.ticks || 1, policy: a.policy }),
  },
];

const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const err = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(req) {
  const { id, method, params } = req;
  if (method === "initialize") {
    return ok(id, { protocolVersion: "2024-11-05", serverInfo: { name: "pharos-reserve", version: "0.1.0" }, capabilities: { tools: {} } });
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    return ok(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  }
  if (method === "tools/call") {
    const tool = byName[params?.name];
    if (!tool) return err(id, -32602, `unknown tool: ${params?.name}`);
    try {
      const result = await tool.run(params.arguments || {});
      return ok(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      return ok(id, { isError: true, content: [{ type: "text", text: `error: ${e.message}` }] });
    }
  }
  if (id !== undefined) err(id, -32601, `method not found: ${method}`);
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); } catch { err(null, -32700, "parse error"); }
  }
});
