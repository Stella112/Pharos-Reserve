// Pharos Reserve — x402 Compute Reserve module.
//
// Keeps the agent's "brain fuel" above an operating runway. This module is
// intentionally endpoint-agnostic: it prepares a capped x402/MaaS payment
// intent, applies the PROS discount policy when enabled, and fails closed when
// balances or endpoint policy do not permit a refuel.

export const DEFAULT_COMPUTE_POLICY = {
  computeFloorMinutes: 30,
  computeTargetMinutes: 120,
  avgTokensPerMinute: 1200,
  costPer1kTokensUsd: 0.01,
  minComputeRefuelUsd: 1,
  maxComputeRefuelUsd: 100,
  usdcReserveUsd: 5,
  prosDiscountPct: 20,
  preferProsDiscount: true,
  maaSEndpoint: "pharos-maas",
  approvedMaaSEndpoints: ["pharos-maas", "zan-maas", "x402-paymaster"],
  x402IntentTtlMinutes: 15,
};

const round = (n, d = 4) => Number(Number(n).toFixed(d));

export function estimateComputeBurnUsdPerMinute(policy = {}) {
  const p = { ...DEFAULT_COMPUTE_POLICY, ...policy };
  if (Number(p.burnUsdPerMinute) > 0) return Number(p.burnUsdPerMinute);
  return Math.max(0.0001, (Number(p.avgTokensPerMinute) / 1000) * Number(p.costPer1kTokensUsd));
}

export function computeStatusFromBalances(balances = {}, policy = {}) {
  const p = { ...DEFAULT_COMPUTE_POLICY, ...policy };
  const burnUsdPerMinute = estimateComputeBurnUsdPerMinute(p);
  const computeCreditUsd = Number(balances.computeCreditUsd ?? 0);
  const runwayMinutes = burnUsdPerMinute > 0 ? computeCreditUsd / burnUsdPerMinute : Infinity;
  const health =
    runwayMinutes <= 0 ? "empty" :
    runwayMinutes < p.computeFloorMinutes ? "low" :
    runwayMinutes < p.computeTargetMinutes ? "watch" :
    "healthy";

  return {
    computeCreditUsd: round(computeCreditUsd, 2),
    burnUsdPerMinute: round(burnUsdPerMinute, 6),
    runwayMinutes: round(runwayMinutes, 2),
    floorMinutes: p.computeFloorMinutes,
    targetMinutes: p.computeTargetMinutes,
    health,
  };
}

// action ∈ "refuel_compute" | "reclaim_for_compute" | "hold" | "alert"
export function planComputeReserve(balances = {}, policy = {}) {
  const p = { ...DEFAULT_COMPUTE_POLICY, ...policy };
  const status = computeStatusFromBalances(balances, p);
  const usdcUsd = Number(balances.usdcUsd ?? 0);
  const yieldUsd = Number(balances.yieldUsd ?? 0);
  const pendingRedeemUsd = Number(balances.pendingRedeemUsd ?? 0);
  const endpointAllowed = p.approvedMaaSEndpoints.includes(p.maaSEndpoint);

  if (!endpointAllowed) {
    return {
      action: "alert",
      status,
      reason: `MaaS endpoint ${p.maaSEndpoint} is not approved`,
    };
  }

  if (status.runwayMinutes >= p.computeFloorMinutes) {
    return {
      action: "hold",
      status,
      reason: `compute runway ${status.runwayMinutes}m is above floor ${p.computeFloorMinutes}m`,
    };
  }

  const targetCreditUsd = status.burnUsdPerMinute * p.computeTargetMinutes;
  const neededCreditUsd = Math.max(0, targetCreditUsd - status.computeCreditUsd);
  const cappedCreditUsd = Math.min(
    Math.max(neededCreditUsd, p.minComputeRefuelUsd),
    p.maxComputeRefuelUsd,
  );
  const discountPct = p.preferProsDiscount ? Number(p.prosDiscountPct) : 0;
  const paymentUsd = round(cappedCreditUsd * (1 - discountPct / 100), 4);
  const discountUsd = round(cappedCreditUsd - paymentUsd, 4);
  const availableUsd = round(Math.max(0, usdcUsd - p.usdcReserveUsd), 2);

  if (availableUsd >= paymentUsd) {
    return {
      action: "refuel_compute",
      status,
      refuelCreditUsd: round(cappedCreditUsd, 4),
      paymentUsd,
      discountUsd,
      payAsset: discountPct > 0 ? "PROS" : "USDC",
      protocol: "x402",
      endpoint: p.maaSEndpoint,
      intentTtlMinutes: p.x402IntentTtlMinutes,
      reason: `compute runway ${status.runwayMinutes}m below floor ${p.computeFloorMinutes}m`,
      paymentIntent: {
        protocol: "x402",
        endpoint: p.maaSEndpoint,
        purpose: "maas_inference_refuel",
        payAsset: discountPct > 0 ? "PROS" : "USDC",
        amountUsd: paymentUsd,
        grossComputeCreditUsd: round(cappedCreditUsd, 4),
        discountPct,
        discountUsd,
        expiresInMinutes: p.x402IntentTtlMinutes,
      },
    };
  }

  const canReclaim = yieldUsd > 0 && pendingRedeemUsd === 0;
  if (canReclaim) {
    return {
      action: "reclaim_for_compute",
      status,
      reclaimUsd: Math.min(yieldUsd, p.maxComputeRefuelUsd),
      reason: `compute low and working USDC cannot fund MaaS refuel without breaching reserve`,
    };
  }

  return {
    action: "alert",
    status,
    paymentUsd,
    availableUsd,
    reason: `compute low, but available USDC ${availableUsd} cannot cover x402 payment ${paymentUsd}`,
  };
}

