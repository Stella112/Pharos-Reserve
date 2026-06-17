// Pharos Reserve — policy engine
//
// Pure decision logic: given current balances and a reserve policy, decide the
// next action. No I/O, no keys — easy to test and clean for a security scan.

export const DEFAULT_POLICY = {
  gasFloorPhrs: 0.01,     // refuel when gas drops below this
  gasTargetPhrs: 0.05,    // refuel back up to this
  usdcReserveUsd: 5,      // never let USDC fall below this hard reserve
  sweepAboveUsd: 100,     // sweep USDC above this into yield
  minProfitMultiple: 1.5, // only act when benefit ≥ 1.5× the action's gas cost
  estActionGasUsd: 0.02,  // estimated cost of a refuel/sweep transaction
  phrsPriceUsd: 0.1,      // PHRS price for sizing a refuel (RPC adapter can override)
  estYieldAprPct: 8,      // assumed APR on swept reserves, for the profit check
};

// action ∈ "refuel" | "sweep" | "hold" | "alert"
export function planReserve(balances, policy = {}) {
  const p = { ...DEFAULT_POLICY, ...policy };
  const gasPhrs = Number(balances.gasPhrs ?? 0);
  const usdcUsd = Number(balances.usdcUsd ?? 0);

  // 1) Solvency first — keep the agent able to transact.
  if (gasPhrs < p.gasFloorPhrs) {
    const needPhrs = Number((p.gasTargetPhrs - gasPhrs).toFixed(6));
    const costUsd = Number((needPhrs * p.phrsPriceUsd).toFixed(4));
    if (usdcUsd - costUsd >= p.usdcReserveUsd) {
      return { action: "refuel", needPhrs, costUsd, reason: `gas ${gasPhrs} below floor ${p.gasFloorPhrs}` };
    }
    return { action: "alert", needPhrs, costUsd, reason: `gas below floor but refuel would breach USDC reserve ${p.usdcReserveUsd}` };
  }

  // 2) Surplus — put idle USDC to work, only when it actually pays for itself.
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
