import { test } from "node:test";
import assert from "node:assert/strict";

import {
  planReserve,
  reviewAction,
  refuel,
  sweep,
  runMetabolism,
  ReserveSimulationAdapter,
} from "../sdk/index.js";

test("plan: gas below floor -> refuel", () => {
  const p = planReserve({ gasPhrs: 0.005, usdcUsd: 200 });
  assert.equal(p.action, "refuel");
  assert.ok(p.needPhrs > 0);
});

test("plan: gas below floor but USDC at reserve -> alert", () => {
  const p = planReserve({ gasPhrs: 0, usdcUsd: 5 }, { usdcReserveUsd: 5 });
  assert.equal(p.action, "alert");
});

test("plan: USDC surplus -> sweep", () => {
  const p = planReserve({ gasPhrs: 0.05, usdcUsd: 5000 });
  assert.equal(p.action, "sweep");
  assert.ok(p.surplusUsd > 0);
});

test("plan: small surplus not profitable -> hold", () => {
  const p = planReserve({ gasPhrs: 0.05, usdcUsd: 100.5 });
  assert.equal(p.action, "hold");
});

test("plan: within policy -> hold", () => {
  const p = planReserve({ gasPhrs: 0.05, usdcUsd: 50 });
  assert.equal(p.action, "hold");
});

test("sentinel blocks an over-limit action", () => {
  const v = reviewAction({ network: "pharos-atlantic-testnet", amountUsd: 999999, to: "0x1111111111111111111111111111111111111111", isWrite: true, userConfirmed: true, contractKnown: true });
  assert.equal(v.decision, "block");
});

test("refuel executes and raises gas, lowers USDC", async () => {
  const a = new ReserveSimulationAdapter({ gasPhrs: 0, usdcUsd: 200, phrsPriceUsd: 0.1 });
  const r = await refuel({ adapter: a });
  assert.equal(r.executed, true);
  const b = await a.balances();
  assert.ok(b.gasPhrs >= 0.05);
  assert.ok(r.spentUsd > 0); // gas was bought with USDC
});

test("sweep moves surplus USDC into yield", async () => {
  const a = new ReserveSimulationAdapter({ gasPhrs: 0.05, usdcUsd: 5000 });
  const r = await sweep({ adapter: a });
  assert.equal(r.executed, true);
  const b = await a.balances();
  assert.ok(b.yieldUsd > 0);
  assert.ok(b.usdcUsd <= 100);
});

test("metabolism keeps the agent solvent across many ticks", async () => {
  const a = new ReserveSimulationAdapter({ gasPhrs: 0.05, usdcUsd: 200, gasBurnPerTick: 0.02 });
  const log = await runMetabolism({ adapter: a, ticks: 12 });
  const b = await a.balances();
  // Despite burning gas every tick, the reserve refuels it back — never stuck at 0 USDC.
  assert.ok(b.usdcUsd > 5);
  assert.ok(log.some((e) => e.action === "refuel"));
});
