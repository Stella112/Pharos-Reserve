# Pharos Reserve

**Autonomous treasury for AI agents — keeps an agent solvent and productive on Pharos, gated by Sentinel.**

Most agent skills *spend*. Pharos Reserve is the skill that keeps an agent *able*
to spend: it monitors the agent's own gas and stablecoin balances, refuels gas
before it runs dry, sweeps idle reserves into yield when it pays off, and refuses
to act when it would breach a hard reserve — all with no human top-ups, and every
move cleared by a Sentinel gate.

It is the metabolism of an autonomous agent: earn, settle, refuel, repeat.

New in this module: **x402 Compute Reserve**. Reserve also tracks inference
runway so an agent does not go dark when model-call credits run low. It prepares
capped x402/MaaS payment intents for compute refuels, applies the configured
PROS discount policy, and fails closed if the endpoint or spend amount is
outside policy.

## Where it fits

Pharos Reserve is the counterweight to settlement in a full agent-finance stack:

- **Credit Bureau** scores counterparties
- **Atlas Council** decides and gates
- **Clearing House** settles (spends)
- **Reserve** keeps the agent solvent (replenishes)

With the x402 Compute Reserve module, Reserve replenishes four operating
buckets: gas, working USDC, yield liquidity, and model-call runway.

Clearing House moves money out; Reserve makes sure there's always gas and a
working balance to move it with. Together they let an agent run indefinitely
without a human babysitting its wallet.

## The metabolism loop

Each tick the Reserve reads balances and acts per policy:

```
read balances → plan → (refuel | sweep | hold | alert) → Sentinel gate → execute
```

- **refuel** — gas dropped below the floor → buy gas back up to target from USDC
- **sweep** — idle USDC above the working threshold → subscribe it into pALPHA yield
- **reclaim** — working USDC ran low → submit a pALPHA redemption request; USDC returns after the queue
- **hold** — balances are within policy, or a sweep wouldn't pay for itself
- **alert** — gas is low, USDC is at the hard reserve, and a redemption is already queued

A profitability guardrail (default ≥ 1.5× the action's gas cost) stops the agent
from churning fees on unprofitable moves.

Compute refuel is part of the same loop: if inference runway drops below the
configured floor, Reserve prepares a capped x402/MaaS payment intent before the
agent runs out of model-call capacity.

### Yield venue: pALPHA (Ember Protocol)

The yield side models **[pALPHA](https://port.pharos.xyz/)**, the RealFi vault on
Pharos built on Ember Protocol — and it models it *accurately*: pALPHA is
**request-based**, not an instant pool. A sweep **subscribes** USDC into the
vault; pulling capital back is a **redemption request** that queues and pays out
USDC after the redemption window (days on mainnet). Reserve tracks the pending
redemption and only acts once it clears — so the agent respects pALPHA's real
mechanics instead of assuming instant liquidity.

## Run locally

No install required — the SDK and demo are dependency-free and run on Node 18+.

```
npm test     # 19 tests, Node's built-in runner
npm run demo # autonomous metabolism: subscribe to pALPHA, refuel, redeem on demand
npm run demo:compute # x402 compute reserve: plan and refill inference credits
npm run mcp  # start the stdio MCP server
```

Example demo output:

```
t 1  SWEEP   gas 0.05 | USDC $500    | pALPHA $0     | pending $0     subscribed $400 to pALPHA
t 5  RECLAIM gas 0.03 | USDC $39.99  | pALPHA $400   | pending $0     redemption request $200 (ready in 2 ticks)
t 6  HOLD    gas 0.01 | USDC $24.99  | pALPHA $200   | pending $200
t 7  REFUEL  gas 0    | USDC $209.99 | pALPHA $200   | pending $0     +0.05 PHRS for $0.005
```

The agent funds its own gas, earns on idle reserves in pALPHA, and redeems
capital back through the queue when it needs it — on its own.

## Tools

| Tool | Purpose |
| --- | --- |
| `reserve_status` | Read the agent's gas, USDC, and yield balances. |
| `reserve_plan` | Decide the next action (refuel / sweep / hold / alert) from policy. |
| `reserve_refuel` | Top up gas from USDC when low — Sentinel-gated. |
| `reserve_sweep` | Subscribe idle USDC above the threshold into pALPHA — Sentinel-gated. |
| `reserve_reclaim` | Submit a pALPHA redemption request when working USDC is low — Sentinel-gated. |
| `reserve_run_metabolism` | Run the autonomous loop for N ticks. |
| `reserve_compute_status` | Read inference credit, burn rate, runway minutes, and health. |
| `reserve_plan_compute_refuel` | Plan a capped x402/MaaS compute refuel. |
| `reserve_refuel_compute` | Prepare a Sentinel-gated x402/MaaS payment intent for inference credits. |

### SDK usage

```js
import { ReserveSimulationAdapter, runMetabolism } from "pharos-reserve";

const agent = new ReserveSimulationAdapter({ gasPhrs: 0.05, usdcUsd: 500 });
await runMetabolism({ adapter: agent, ticks: 10 });
```

### x402 Compute Reserve

The compute module keeps an agent from going dark when model-call credits run
low. It estimates inference runway, applies the configured PROS discount policy,
and prepares a capped x402/MaaS payment intent. It does not execute real token
transfers or handle private keys; production runtimes can route the intent
through Clearing House or an approved x402 paymaster.

```bash
npm run demo:compute
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

**pALPHA on mainnet.** The yield venue models pALPHA (Ember Protocol), which runs
on **Pharos mainnet (chain `1672`)** with a real subscribe → redeem-request →
USDC-payout flow. The live adapter is documented to target the Ember vault there;
because pALPHA settles real funds over a multi-day window, the request-based
behavior is demonstrated faithfully in simulation rather than on testnet.

## Safety model

Reserve never executes a write unless the Sentinel gate returns `approve`. It
never requests, stores, or prints private keys — writes are signed by a
caller-supplied signer. The gate blocks unsupported networks, over-limit
actions, invalid/zero destinations, and unauthorized writes — clean for runtime
security scanning (no shell-out, no filesystem abuse, no key handling).

## Project shape

```
.
├── sdk/            # zero-dep treasury SDK (chain, policy, sentinel, reserve, yield) + live adapter
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
