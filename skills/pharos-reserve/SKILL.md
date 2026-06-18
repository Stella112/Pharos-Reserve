---
name: pharos-reserve
description: Autonomous treasury for AI agents on Pharos — monitors gas, USDC, pALPHA yield reserves, and x402/MaaS compute runway; refuels gas and inference credits before they run dry; sweeps idle reserves into yield; and refuses to breach hard policy limits. Use when an agent must stay solvent, funded, and productive without human top-ups. Every action is Sentinel-gated; the skill never handles private keys.
---

# Pharos Reserve

The execution-fuel layer of the agent-finance stack. Where Clearing House
*spends*, Reserve keeps the agent *able* to spend: it manages the agent's own
treasury so it can run indefinitely with no human refills, including the
compute credits it needs to keep calling models.

## Prerequisites

- **Foundry** (`cast`) to read live balances on-chain, or **Node 18+** for the SDK / MCP server.
- A funded operating wallet (PHRS + USDC). The key stays in the caller's shell (`$PRIVATE_KEY`); the skill never reads or stores it.
- Network, USDC, and pALPHA addresses resolve from `assets/networks.json`.

## Capability Index

| User Need | Capability | Detailed Instructions |
| --- | --- | --- |
| "check my treasury", "how much gas / USDC do I have", "am I solvent" | `cast balance` + `cast call balanceOf` | → [references/reserve.md#read-treasury](../../references/reserve.md#read-treasury) |
| "what should I do next", "plan my treasury", "is anything needed" | SDK `reserve_plan` (policy engine) | → [references/reserve.md#plan-the-next-action](../../references/reserve.md#plan-the-next-action) |
| "refuel gas", "I'm running low on gas" | SDK `reserve_refuel` | → [references/reserve.md#refuel-gas](../../references/reserve.md#refuel-gas) |
| "put idle USDC to work", "sweep to yield", "deposit into pALPHA" | SDK `reserve_sweep` → pALPHA subscribe | → [references/reserve.md#sweep-to-palpha](../../references/reserve.md#sweep-to-palpha) |
| "get capital back", "redeem from pALPHA", "working balance is low" | SDK `reserve_reclaim` → pALPHA redeem request | → [references/reserve.md#reclaim-from-palpha](../../references/reserve.md#reclaim-from-palpha) |
| "run autonomously", "keep me solvent", "metabolism loop" | SDK `reserve_run_metabolism` | → [references/reserve.md#metabolism-loop](../../references/reserve.md#metabolism-loop) |

## x402 Compute Reserve

Use the compute reserve when an agent needs to keep model-call capacity online.
It monitors inference credit, estimates runway in minutes, and prepares capped
x402/MaaS payment intents when runway drops below policy.

Tools:

- `reserve_compute_status` - inference credit, burn rate, runway minutes, and health.
- `reserve_plan_compute_refuel` - plan a capped x402/MaaS compute refuel.
- `reserve_refuel_compute` - Sentinel-gated x402/MaaS payment intent for inference credits.

Default policy: `computeFloorMinutes 30`, `computeTargetMinutes 120`,
`prosDiscountPct 20`, `maxComputeRefuelUsd 100`, approved endpoint
`pharos-maas`. The module prepares intents and fails closed; real x402 payment
execution remains with the caller or Clearing House.

## When to use

- An autonomous agent needs to keep gas above a floor to keep transacting.
- An autonomous agent needs to keep inference credits above a runway floor so it can keep thinking.
- Idle stablecoin should be put to work (yield) instead of sitting dead.
- You want a safe, policy-bounded "metabolism" loop, not ad-hoc transfers.

## Capabilities

- **Refuel** — buy gas (PHRS) from USDC when it drops below the floor, up to a target.
- **Sweep** — subscribe idle USDC above a working threshold into pALPHA (Ember Protocol) yield, only when it pays for itself (≥ 1.5× the action's gas cost).
- **Reclaim** — submit a pALPHA redemption request when working USDC runs low; USDC returns after the venue's queue.
- **Hold / Alert** — hold within policy; alert when refueling would breach the hard reserve and a redemption is already queued.
- **Metabolism loop** — run the read → plan → act cycle autonomously for N ticks.

## Tools

- `reserve_status` — gas, USDC, pALPHA position, and pending redemptions.
- `reserve_plan` — the next action from policy: refuel / reclaim / sweep / hold / alert.
- `reserve_refuel` — Sentinel-gated gas top-up.
- `reserve_sweep` — Sentinel-gated subscribe-to-pALPHA.
- `reserve_reclaim` — Sentinel-gated pALPHA redemption request.
- `reserve_run_metabolism` — the autonomous loop.

Compute tools are also available:

- `reserve_compute_status` - inference credit, burn rate, runway minutes, and health.
- `reserve_plan_compute_refuel` - plan a capped x402/MaaS compute refuel.
- `reserve_refuel_compute` - Sentinel-gated x402/MaaS payment intent for inference credits.

## Yield venue

Models **pALPHA** (Ember Protocol) on Pharos — a request-based RealFi vault:
subscribe to deposit, redemption-request to withdraw (queued, pays USDC after the
window). Live adapter targets the Ember vault on Pharos mainnet (`1672`); the
request flow is demonstrated in simulation.

## Policy (defaults)

`gasFloorPhrs 0.01`, `gasTargetPhrs 0.05`, `usdcReserveUsd 5`,
`sweepAboveUsd 100`, `minProfitMultiple 1.5`. All overridable per call.

## Safety

Every write passes the Sentinel gate (network allowlist, action limit, valid
destination, authorizing mandate). The skill never reads or stores keys — the
runtime injects a signer. Pure decision logic, no shell-out, no filesystem
abuse.

## Network

Pharos Atlantic Testnet (chain `688689`) and Pharos Testnet (`688688`). The live
adapter reads real on-chain gas and USDC balances; USDC `0xcfc8330f4bcab529c625d12781b1c19466a9fc8b`.

## Composition

Pairs with **Clearing House** (settlement): Clearing House spends, Reserve
replenishes. Accepts the same Sentinel verdict shape as **Atlas Council**, and a
**Credit Bureau** verdict can gate where reserves are deployed.
