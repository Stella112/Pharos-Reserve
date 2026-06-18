// Pharos Reserve — treasury operations
//
// Reads balances, plans the next action from policy, and executes refuel/sweep
// through the Sentinel gate. The autonomous "metabolism" loop ties them together
// so an agent stays solvent and productive with no human top-ups.

import { reviewAction, isApproved } from "./sentinel.js";
import { planReserve } from "./policy.js";
import { computeStatusFromBalances, planComputeReserve } from "./compute.js";

export async function reserveStatus({ adapter }) {
  const b = await adapter.balances();
  return { network: adapter.network.name, self: adapter.self, ...b };
}

export async function reservePlan({ adapter, policy }) {
  const balances = await adapter.balances();
  return { ...planReserve(balances, policy), balances };
}

export async function computeStatus({ adapter, policy }) {
  const balances = await adapter.balances();
  return { network: adapter.network.name, self: adapter.self, ...computeStatusFromBalances(balances, policy), balances };
}

export async function computePlan({ adapter, policy }) {
  const balances = await adapter.balances();
  return { ...planComputeReserve(balances, policy), balances };
}

// Prepare a Sentinel-gated x402/MaaS payment intent to refill inference credits.
export async function refuelCompute({ adapter, policy, signer }) {
  const balances = await adapter.balances();
  const plan = planComputeReserve(balances, policy);
  if (plan.action !== "refuel_compute") {
    return { kind: "refuel_compute", executed: false, reason: `no compute refuel (${plan.action})`, plan };
  }

  const verdict = reviewAction(
    { type: "reserve_compute_refuel", network: adapter.network.name, amountUsd: plan.paymentUsd, isWrite: false, contractKnown: true, userConfirmed: true },
    policy
  );
  if (!isApproved(verdict)) return { kind: "refuel_compute", executed: false, sentinel: verdict.decision, reasons: verdict.reasons };

  if (typeof adapter.refuelCompute !== "function") {
    return { kind: "refuel_compute", executed: false, sentinel: "approve", reason: "adapter does not implement compute refuel execution", paymentIntent: plan.paymentIntent };
  }

  const res = await adapter.refuelCompute({ ...plan, signer });
  return { kind: "refuel_compute", executed: true, sentinel: "approve", network: adapter.network.name, ...res, reason: plan.reason };
}

// Top up gas from USDC when the agent is running low.
export async function refuel({ adapter, policy, signer }) {
  const balances = await adapter.balances();
  const plan = planReserve(balances, policy);
  if (plan.action !== "refuel") {
    return { kind: "refuel", executed: false, reason: `no refuel needed (${plan.action})`, plan };
  }
  const verdict = reviewAction(
    { type: "reserve_refuel", network: adapter.network.name, amountUsd: plan.costUsd, to: adapter.self, isWrite: true, contractKnown: true, userConfirmed: true },
    policy
  );
  if (!isApproved(verdict)) return { kind: "refuel", executed: false, sentinel: verdict.decision, reasons: verdict.reasons };

  const res = await adapter.refuel({ amountPhrs: plan.needPhrs, signer });
  return { kind: "refuel", executed: true, sentinel: "approve", network: adapter.network.name, ...res, reason: plan.reason };
}

// Move idle USDC above the working threshold into yield.
export async function sweep({ adapter, policy, signer }) {
  const balances = await adapter.balances();
  const plan = planReserve(balances, policy);
  if (plan.action !== "sweep") {
    return { kind: "sweep", executed: false, reason: `no sweep (${plan.action})`, plan };
  }
  const verdict = reviewAction(
    { type: "reserve_sweep", network: adapter.network.name, amountUsd: plan.surplusUsd, to: adapter.self, isWrite: true, contractKnown: true, userConfirmed: true },
    policy
  );
  if (!isApproved(verdict)) return { kind: "sweep", executed: false, sentinel: verdict.decision, reasons: verdict.reasons };

  const res = await adapter.sweep({ amountUsd: plan.surplusUsd, signer });
  return { kind: "sweep", executed: true, sentinel: "approve", network: adapter.network.name, ...res, reason: plan.reason };
}

// Submit a redemption request to the yield venue (pALPHA) when the agent needs
// working capital back. The request queues and is paid out as USDC after the
// venue's redemption window — the metabolism loop accounts for that delay.
export async function reclaim({ adapter, policy, signer }) {
  const balances = await adapter.balances();
  const plan = planReserve(balances, policy);
  if (plan.action !== "reclaim") {
    return { kind: "reclaim", executed: false, reason: `no reclaim (${plan.action})`, plan };
  }
  const verdict = reviewAction(
    { type: "reserve_reclaim", network: adapter.network.name, amountUsd: plan.reclaimUsd, to: adapter.self, isWrite: true, contractKnown: true, userConfirmed: true },
    policy
  );
  if (!isApproved(verdict)) return { kind: "reclaim", executed: false, sentinel: verdict.decision, reasons: verdict.reasons };

  const res = await adapter.reclaim({ amountUsd: plan.reclaimUsd, signer });
  return { kind: "reclaim", executed: true, sentinel: "approve", network: adapter.network.name, ...res, reason: plan.reason };
}

// The metabolism loop: each tick, read balances, decide, and act per policy.
export async function runMetabolism({ adapter, policy, ticks = 1, onTick } = {}) {
  const log = [];
  for (let i = 0; i < ticks; i++) {
    const balances = await adapter.balances();
    const compute = planComputeReserve(balances, policy);
    const plan = ["refuel_compute", "reclaim_for_compute", "alert"].includes(compute.action) ? compute : planReserve(balances, policy);
    const entry = { tick: i + 1, action: plan.action, reason: plan.reason, balances };
    if (plan.action === "refuel") entry.exec = await refuel({ adapter, policy });
    else if (plan.action === "sweep") entry.exec = await sweep({ adapter, policy });
    else if (plan.action === "reclaim") entry.exec = await reclaim({ adapter, policy });
    else if (plan.action === "reclaim_for_compute") entry.exec = await reclaim({ adapter, policy });
    else if (plan.action === "refuel_compute") entry.exec = await refuelCompute({ adapter, policy });
    log.push(entry);
    if (onTick) onTick(entry);
    if (adapter.tick) await adapter.tick();
  }
  return log;
}
