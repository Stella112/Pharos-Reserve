# Pharos Reserve — operations reference

Machine-readable specs for the treasury operations. Balance reads are concrete
`cast` commands; decisions and writes run through the SDK / MCP tools (the policy
engine and Sentinel gate) and, for yield, the pALPHA (Ember) vault. Addresses
resolve from [`assets/networks.json`](../assets/networks.json).

Resolved values (Pharos Atlantic Testnet):

- `RPC` = `https://atlantic.dplabs-internal.com`
- `USDC` = `0xcfc8330f4bcab529c625d12781b1c19466a9fc8b` (6 decimals)
- `AGENT` = the operating wallet address (read from `$PRIVATE_KEY`, or passed explicitly)

pALPHA (yield) lives on **Pharos mainnet (1672)** via Ember Protocol; subscribe/
redeem are submitted there.

---

## read-treasury

**Overview.** Read the agent's live gas (native PHRS) and USDC balances — the
inputs every decision is made from.

**Command Template.**
```bash
cast balance $AGENT --rpc-url $RPC                                   # gas (PHRS), in wei
cast call $USDC "balanceOf(address)(uint256)" $AGENT --rpc-url $RPC  # USDC, 6-decimal base units
```

**Output Parsing.**
| Field | Description |
| --- | --- |
| gas (wei) | Divide by 1e18 for PHRS; compare to `gasFloorPhrs`. |
| USDC (base units) | Divide by 1e6 for USD; compare to `reclaimBelowUsd` / `sweepAboveUsd`. |

**Agent Guidelines.**
1. Read both balances, normalize to PHRS and USD.
2. Pass them to `reserve_plan` (or `planReserve`) to get the next action.

---

## plan-the-next-action

**Overview.** Apply the reserve policy to current balances and return exactly one
action: `refuel`, `reclaim`, `sweep`, `hold`, or `alert`. Pure logic, no I/O.

**Command Template.**
```bash
node -e "import('pharos-reserve').then(async m => { \
  const a = new m.ReserveSimulationAdapter(); \
  console.log(await m.reservePlan({ adapter: a })); })"
```
Or call the MCP tool `reserve_plan`. Over RPC, feed `read-treasury` output into
`planReserve({ gasPhrs, usdcUsd, yieldUsd, pendingRedeemUsd }, policy)`.

**Output Parsing.**
| Field | Description |
| --- | --- |
| action | refuel / reclaim / sweep / hold / alert. |
| reason | Human-readable justification. |
| needPhrs / costUsd / reclaimUsd / surplusUsd | Sizing for the chosen action. |

**Agent Guidelines.**
1. Never act without a plan; the plan encodes the hard reserve and profitability guardrail.
2. Execute only the returned action, then re-read and re-plan.

---

## refuel-gas

**Overview.** Buy PHRS gas from USDC when gas is below the floor, up to the
target — Sentinel-gated. On-chain this is a swap on a Pharos DEX; the SDK models
it and exposes `reserve_refuel`.

**Parameters.**
| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| policy | object | no | Overrides for `gasFloorPhrs`, `gasTargetPhrs`, `phrsPriceUsd`. |

**Error Handling.**
| Condition | Cause | Suggested action |
| --- | --- | --- |
| `insufficient USDC to refuel` | USDC below the refuel cost + reserve | Trigger `reclaim` from pALPHA first. |
| Sentinel `block` | Over limit / bad destination | Inspect `reasons`; do not retry blindly. |

**Agent Guidelines.**
1. Call `reserve_refuel`; it no-ops unless the plan is `refuel`.
2. Confirm gas returned to target; report the tx.

---

## sweep-to-palpha

**Overview.** Subscribe idle USDC above the working threshold into pALPHA, only
when the expected yield clears the profitability guardrail (≥ 1.5× the action's
gas cost). Sentinel-gated.

**Agent Guidelines.**
1. Call `reserve_sweep`; it acts only when the plan is `sweep`.
2. On-chain, this approves USDC to the Ember vault and calls its subscribe entrypoint (mainnet 1672).
3. Record the deposited amount as a pALPHA position.

---

## reclaim-from-palpha

**Overview.** Submit a pALPHA **redemption request** when working USDC runs low.
pALPHA is request-based: the USDC is paid out after the redemption window, not
instantly. Reserve tracks the pending redemption and won't double-request.

**Agent Guidelines.**
1. Call `reserve_reclaim`; it acts only when the plan is `reclaim`.
2. On-chain, this submits a withdraw request to the Ember vault (approve + sign).
3. Surface the pending redemption in `reserve_status` until it clears, then the USDC returns.

---

## metabolism-loop

**Overview.** The autonomous read → plan → act cycle. Each tick: read balances,
plan, execute the one action, advance. Keeps the agent solvent with no human
input.

**Command Template.**
```bash
npm run demo            # offline metabolism with pALPHA yield
# or MCP: reserve_run_metabolism { "ticks": 8 }
```

**Agent Guidelines.**
1. Run on a schedule (per block, per minute, or per task).
2. Each action is independently Sentinel-gated; a blocked action halts only that step.

---

## x402-compute-reserve

**Overview.** Keep an agent's model-call capacity online. The compute reserve
estimates inference spend, calculates runway in minutes, and prepares a capped
x402/MaaS payment intent when credits fall below the floor.

**SDK / MCP tools.**

| Tool | Description |
| --- | --- |
| `reserve_compute_status` | Read inference credit, estimated burn, runway, and health. |
| `reserve_plan_compute_refuel` | Decide whether to hold, refuel compute, reclaim from yield, or alert. |
| `reserve_refuel_compute` | Prepare a Sentinel-gated x402/MaaS payment intent and simulate the refuel. |

**Default policy.**

```json
{
  "computeFloorMinutes": 30,
  "computeTargetMinutes": 120,
  "prosDiscountPct": 20,
  "maxComputeRefuelUsd": 100,
  "maaSEndpoint": "pharos-maas",
  "approvedMaaSEndpoints": ["pharos-maas", "zan-maas", "x402-paymaster"]
}
```

**Decision outputs.**

| Action | Meaning |
| --- | --- |
| `hold` | Runway is above the floor. |
| `refuel_compute` | Working USDC can safely fund a capped x402/MaaS compute refill. |
| `reclaim_for_compute` | Working USDC is low but yield can be reclaimed before compute refuel. |
| `alert` | Endpoint is unapproved or funding would breach reserve policy. |

**Agent Guidelines.**

1. Treat compute refuels as value-moving intents, even when they are not executed by this SDK.
2. Do not call unapproved MaaS endpoints.
3. Do not exceed `maxComputeRefuelUsd`.
4. Route real payments through Clearing House or an approved x402 paymaster.
5. Re-read runway after a refuel and keep the payment receipt with the agent's accountability log.
