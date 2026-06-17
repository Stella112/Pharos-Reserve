---
name: pharos-reserve
description: Autonomous treasury for AI agents on Pharos — monitors the agent's own gas and USDC, refuels gas before it runs dry, sweeps idle reserves into yield, and refuses to breach a hard reserve. Use when an agent must stay solvent and productive without human top-ups. Every action is Sentinel-gated; the skill never handles private keys.
---

# Pharos Reserve

The execution-fuel layer of the agent-finance stack. Where Clearing House
*spends*, Reserve keeps the agent *able* to spend: it manages the agent's own
treasury so it can run indefinitely with no human refills.

## When to use

- An autonomous agent needs to keep gas above a floor to keep transacting.
- Idle stablecoin should be put to work (yield) instead of sitting dead.
- You want a safe, policy-bounded "metabolism" loop, not ad-hoc transfers.

## Capabilities

- **Refuel** — buy gas (PHRS) from USDC when it drops below the floor, up to a target.
- **Sweep** — move idle USDC above a working threshold into yield, only when it pays for itself (≥ 1.5× the action's gas cost).
- **Hold / Alert** — hold within policy; alert when refueling would breach the hard USDC reserve.
- **Metabolism loop** — run the read → plan → act cycle autonomously for N ticks.

## Tools

- `reserve_status` — gas, USDC, and yield balances.
- `reserve_plan` — the next action from policy: refuel / sweep / hold / alert.
- `reserve_refuel` — Sentinel-gated gas top-up.
- `reserve_sweep` — Sentinel-gated surplus-to-yield.
- `reserve_run_metabolism` — the autonomous loop.

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
