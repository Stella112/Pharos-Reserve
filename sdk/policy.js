// Pharos Reserve — policy engine
//
// Pure decision logic: given current balances and a reserve policy, decide the
// next action. No I/O, no keys — easy to test and clean for a security scan.

export const DEFAULT_POLICY = {
  gasFloorPhrs: 0.01,     // refuel when gas drops below this
  gasTargetPhrs: 0.05,    // refuel back up to this
  usdcReserveUsd: 5,      // never let USDC fall below this hard reserve
  reclaimBelowUsd: 50,    // redeem from yield when working USDC drops below this
  reclaimChunkUsd: 200,   // size of a redemption request
  sweepAboveUsd: 100,     // subscribe USDC above this into yield
  minProfitMultiple: 1.5, // only act when benefit ≥ 1.5× the action's gas cost
  estActionGasUsd: 0.02,  // estimated cost of a refuel/sweep transaction
  phrsPriceUsd: 0.1,      // PHRS price for sizing a refuel (RPC adapter can override)
  estYieldAprPct: 8,      // assumed APR on swept reserves, for the profit check
};

// action ∈ "refuel" | "reclaim" | "sweep" | "hold" | "alert"
export function planReserve(balances, policy = {}) {
  const p = { ...DEFAULT_POLICY, ...policy };
  const gasPhrs = Number(balances.gasPhrs ?? 0);
  const usdcUsd = Number(balances.usdcUsd ?? 0);
  const yieldUsd = Number(balances.yieldUsd ?? 0);
  const pendingRedeemUsd = Number(balances.pendingRedeemUsd ?? 0);

  // Capital can be pulled from yield only if some is deposited and no redemption
  // is already queued (pALPHA processes one request through its window).
  const canReclaim = yieldUsd > 0 && pendingRedeemUsd === 0;
  const reclaimUsd = Number(Math.min(yieldUsd, p.reclaimChunkUsd).toFixed(2));

  // 1) Solvency first — keep the agent able to transact.
  if (gasPhrs < p.gasFloorPhrs) {
    const needPhrs = Number((p.gasTargetPhrs - gasPhrs).toFixed(6));
    const costUsd = Number((needPhrs * p.phrsPriceUsd).toFixed(4));
    if (usdcUsd - costUsd >= p.usdcReserveUsd) {
      return { action: "refuel", needPhrs, costUsd, reason: `gas ${gasPhrs} below floor ${p.gasFloorPhrs}` };
    }
    if (canReclaim) {
      return { action: "reclaim", reclaimUsd, reason: `gas low and USDC at the hard reserve — redeeming from yield to refuel` };
    }
    return { action: "alert", needPhrs, costUsd, reason: `gas below floor, USDC at reserve, and a redemption is already queued` };
  }

  // 2) Working capital low — redeem from yield (queued, arrives after the window).
  if (usdcUsd < p.reclaimBelowUsd && canReclaim) {
    return { action: "reclaim", reclaimUsd, reason: `working USDC ${usdcUsd} below ${p.reclaimBelowUsd} — submitting a redemption request` };
  }

  // 3) Surplus — put idle USDC to work, only when it actually pays for itself.
  if (usdcUsd > p.sweepAboveUsd) {
    const surplusUsd = Number((usdcUsd - p.sweepAboveUsd).toFixed(2));
    const dailyYieldUsd = Number(((surplusUsd * (p.estYieldAprPct / 100)) / 365).toFixed(4));
    if (dailyYieldUsd >= p.minProfitMultiple * p.estActionGasUsd) {
      return { action: "sweep", surplusUsd, dailyYieldUsd, reason: `USDC ${usdcUsd} above sweep threshold ${p.sweepAboveUsd}` };
    }
    return { action: "hold", reason: `surplus too small to sweep profitably (daily yield ${dailyYieldUsd} < ${p.minProfitMultiple}× gas ${p.estActionGasUsd})` };
  }

  return { action: "hold", reason: "balances within policy" };
}
