# Pharos Reserve

**Autonomous treasury for AI agents — keeps an agent solvent and productive on Pharos, gated by Sentinel.**

Most agent skills *spend*. Pharos Reserve is the skill that keeps an agent *able*
to spend: it monitors the agent's own gas and stablecoin balances, refuels gas
before it runs dry, sweeps idle reserves into yield when it pays off, and refuses
to act when it would breach a hard reserve — all with no human top-ups, and every
move cleared by a Sentinel gate.

It is the metabolism of an autonomous agent: earn, settle, refuel, repeat.

## Where it fits

Pharos Reserve is the counterweight to settlement in a full agent-finance stack:

- **Credit Bureau** scores counterparties
- **Atlas Council** decides and gates
- **Clearing House** settles (spends)
- **Reserve** keeps the agent solvent (replenishes)

Clearing House moves money out; Reserve makes sure there's always gas and a
working balance to move it with. Together they let an agent run indefinitely
without a human babysitting its wallet.

## The metabolism loop

Each tick the Reserve reads balances and acts per policy:

```
read balances → plan → (refuel | sweep | hold | alert) → Sentinel gate → execute
```

- **refuel** — gas dropped below the floor → buy gas back up to target from USDC
- **sweep** — idle USDC above the working threshold → move surplus into yield
- **hold** — balances are within policy, or a sweep wouldn't pay for itself
- **alert** — gas is low but refueling would breach the hard USDC reserve

A profitability guardrail (default ≥ 1.5× the action's gas cost) stops the agent
from churning fees on unprofitable moves.

## Run locally

No install required — the SDK and demo are dependency-free and run on Node 18+.

```
npm test     # 9 tests, Node's built-in runner
npm run demo # autonomous metabolism loop: sweep idle USDC, refuel before empty
npm run mcp  # start the stdio MCP server
```

Example demo output:

```
t 1  SWEEP   gas 0.05 | USDC $500 | yield $0      swept $400 to yield
t 4  REFUEL  gas 0    | USDC $100 | yield $401.2  +0.05 PHRS for $0.005
t 7  REFUEL  gas 0    | USDC $100 | yield $402.4  +0.05 PHRS for $0.005
```

The agent never runs out of gas and puts its idle reserves to work — on its own.

## Tools

| Tool | Purpose |
| --- | --- |
| `reserve_status` | Read the agent's gas, USDC, and yield balances. |
| `reserve_plan` | Decide the next action (refuel / sweep / hold / alert) from policy. |
| `reserve_refuel` | Top up gas from USDC when low — Sentinel-gated. |
| `reserve_sweep` | Move idle USDC above the threshold into yield — Sentinel-gated. |
| `reserve_run_metabolism` | Run the autonomous loop for N ticks. |

### SDK usage

```js
import { ReserveSimulationAdapter, runMetabolism } from "pharos-reserve";

const agent = new ReserveSimulationAdapter({ gasPhrs: 0.05, usdcUsd: 500 });
await runMetabolism({ adapter: agent, ticks: 10 });
```

### MCP usage — call it from an AI agent

The skill ships an stdio MCP server, so any MCP client (Claude Code, Cursor,
Claude Desktop) can drive it. Add it with an absolute path to `mcp/server.js`:

```json
{
  "mcpServers": {
    "pharos-reserve": { "command": "node", "args": ["./mcp/server.js"] }
  }
}
```

Then prompt: *"Use pharos-reserve: check my treasury, then run the metabolism for 5 ticks."*

## On-chain integration (Pharos)

The live adapter (`sdk/rpc-adapter.js`) reads the agent's **real** gas (PHRS) and
USDC balances from Pharos, so `reserve_status` and `reserve_plan` operate on live
on-chain data. Set the key and it goes live:

```
PRIVATE_KEY=0x... npm run mcp
```

- Networks: Pharos Atlantic Testnet `688689` (and Pharos Testnet `688688`)
- USDC: `0xcfc8330f4bcab529c625d12781b1c19466a9fc8b`
- A **sweep** is a real USDC transfer to a configurable `YIELD_VENUE`. Gas refuel
  needs a swap venue (DEX); the simulation adapter demonstrates the full loop
  offline. The core stays zero-dependency; the live adapter uses `ethers`.

## Safety model

Reserve never executes a write unless the Sentinel gate returns `approve`. It
never requests, stores, or prints private keys — writes are signed by a
caller-supplied signer. The gate blocks unsupported networks, over-limit
actions, invalid/zero destinations, and unauthorized writes — clean for runtime
security scanning (no shell-out, no filesystem abuse, no key handling).

## Project shape

```
.
├── sdk/            # zero-dep treasury SDK (chain, policy, sentinel, reserve) + live adapter
├── mcp/server.js   # stdio MCP server exposing the tools
├── demos/run.js    # autonomous metabolism demo
├── test/           # Node built-in test suite
├── skills/pharos-reserve/SKILL.md
└── README.md
```

## Phase 2

In the Agent Arena, Reserve powers the self-sustaining side of a **Treasurer
Steward** agent: it earns through Clearing House settlements, sweeps profits to
yield, and keeps itself fueled — an agent that funds its own operation
indefinitely.

## License

MIT
