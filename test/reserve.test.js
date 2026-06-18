import { test } from "node:test";
import assert from "node:assert/strict";

import {
  planReserve,
  planComputeReserve,
  computeStatusFromBalances,
  computePlan,
  refuelCompute,
  reviewAction,
  refuel,
  sweep,
  reclaim,
  runMetabolism,
  ReserveSimulationAdapter,
  PalphaVenue,
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

test("pALPHA venue: subscribe, request redeem, claim after the queue", () => {
  const v = new PalphaVenue({ redeemDelayTicks: 2 });
  v.subscribe(300);
  assert.equal(v.depositedUsd, 300);
  const r = v.requestRedeem(120);
  assert.equal(r.requestedUsd, 120);
  assert.equal(v.pendingUsd(), 120);
  assert.equal(v.claimMatured(), 0); // not ready until the window passes
  v.tick();
  v.tick();
  assert.equal(v.claimMatured(), 120);
  assert.equal(v.pendingUsd(), 0);
});

test("plan: low working USDC with yield -> reclaim", () => {
  const p = planReserve({ gasPhrs: 0.05, usdcUsd: 20, yieldUsd: 400, pendingRedeemUsd: 0 });
  assert.equal(p.action, "reclaim");
  assert.ok(p.reclaimUsd > 0);
});

test("plan: low USDC but a redemption is already queued -> hold", () => {
  const p = planReserve({ gasPhrs: 0.05, usdcUsd: 20, yieldUsd: 400, pendingRedeemUsd: 200 });
  assert.equal(p.action, "hold");
});

test("reclaim submits a redemption request to the venue", async () => {
  const a = new ReserveSimulationAdapter({ gasPhrs: 0.05, usdcUsd: 20, venue: new PalphaVenue({ redeemDelayTicks: 2 }) });
  a.venue.subscribe(400);
  const r = await reclaim({ adapter: a });
  assert.equal(r.executed, true);
  assert.ok(r.requestedUsd > 0);
  assert.ok((await a.balances()).pendingRedeemUsd > 0);
});

test("metabolism redeems from pALPHA and the USDC returns after the queue", async () => {
  const a = new ReserveSimulationAdapter({ gasPhrs: 0.05, usdcUsd: 500, opCostPerTickUsd: 15, venue: new PalphaVenue({ redeemDelayTicks: 2 }) });
  const log = await runMetabolism({ adapter: a, ticks: 8 });
  assert.ok(log.some((e) => e.action === "sweep"));
  assert.ok(log.some((e) => e.action === "reclaim"));
  assert.ok((await a.balances()).usdcUsd > 50); // capital came back through the queue
});

test("compute: low runway -> x402 refuel intent with PROS discount", () => {
  const p = planComputeReserve(
    { usdcUsd: 100, computeCreditUsd: 0.1 },
    { burnUsdPerMinute: 0.01, computeFloorMinutes: 30, computeTargetMinutes: 120, prosDiscountPct: 20 },
  );
  assert.equal(p.action, "refuel_compute");
  assert.equal(p.paymentIntent.protocol, "x402");
  assert.equal(p.paymentIntent.payAsset, "PROS");
  assert.ok(p.discountUsd > 0);
});

test("compute: enough runway -> hold", () => {
  const p = planComputeReserve(
    { usdcUsd: 100, computeCreditUsd: 10 },
    { burnUsdPerMinute: 0.01, computeFloorMinutes: 30, computeTargetMinutes: 120 },
  );
  assert.equal(p.action, "hold");
});

test("compute: unapproved MaaS endpoint -> alert", () => {
  const p = planComputeReserve(
    { usdcUsd: 100, computeCreditUsd: 0 },
    { maaSEndpoint: "unknown-maas", approvedMaaSEndpoints: ["pharos-maas"] },
  );
  assert.equal(p.action, "alert");
});

test("compute: refuel executes in simulation and raises compute credits", async () => {
  const a = new ReserveSimulationAdapter({ usdcUsd: 100, computeCreditUsd: 0.1 });
  const before = await computeStatusFromBalances(await a.balances(), { burnUsdPerMinute: 0.01 });
  const r = await refuelCompute({ adapter: a, policy: { burnUsdPerMinute: 0.01, computeFloorMinutes: 30, computeTargetMinutes: 120 } });
  const after = await computeStatusFromBalances(await a.balances(), { burnUsdPerMinute: 0.01 });
  assert.equal(r.executed, true);
  assert.ok(after.computeCreditUsd > before.computeCreditUsd);
});

test("compute plan includes balances for agent clients", async () => {
  const a = new ReserveSimulationAdapter({ usdcUsd: 100, computeCreditUsd: 0.1 });
  const p = await computePlan({ adapter: a, policy: { burnUsdPerMinute: 0.01 } });
  assert.ok(p.balances);
  assert.equal(p.action, "refuel_compute");
});
