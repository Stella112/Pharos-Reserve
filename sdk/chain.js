// Pharos Reserve — chain layer
//
// The Reserve never holds, reads, or prints private keys. Writes go through an
// injected `signer` from the caller's runtime. The default adapter is a
// deterministic in-memory simulation so the skill runs offline with zero
// dependencies; swap in the RPC adapter for real Pharos balances.

import { PalphaVenue } from "./yield.js";

export const PHAROS = {
  testnet: {
    name: "pharos-testnet",
    chainId: 688688,
    rpcUrl: "https://testnet.dplabs-internal.com",
    explorer: "https://testnet.pharosscan.xyz",
    usdc: "0xcfc8330f4bcab529c625d12781b1c19466a9fc8b",
  },
  atlantic: {
    name: "pharos-atlantic-testnet",
    chainId: 688689,
    rpcUrl: "https://atlantic.dplabs-internal.com",
    explorer: "https://atlantic.pharosscan.xyz",
    usdc: "0xcfc8330f4bcab529c625d12781b1c19466a9fc8b",
  },
};

export function networkByChainId(chainId) {
  const id = Number(chainId);
  return Object.values(PHAROS).find((n) => n.chainId === id) || PHAROS.atlantic;
}

export function isAddress(a) {
  return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
}

const round = (n, d = 6) => Number(n.toFixed(d));

// Base interface — the surface a real RPC adapter must implement.
export class ReserveAdapter {
  get network() { throw new Error("not implemented"); }
  get self() { throw new Error("not implemented"); }
  async balances() { throw new Error("not implemented"); }
  async refuel(/* { amountPhrs, signer } */) { throw new Error("not implemented"); }
  async sweep(/* { amountUsd, signer } */) { throw new Error("not implemented"); }
}

// Deterministic in-memory treasury for offline demos and tests. Models an agent
// that burns gas as it works, spends on operations, and parks idle USDC in a
// request-based yield venue (pALPHA) it can redeem from when it needs capital.
export class ReserveSimulationAdapter extends ReserveAdapter {
  constructor({
    gasPhrs = 0.05, usdcUsd = 200,
    phrsPriceUsd = 0.1, gasBurnPerTick = 0.02, opCostPerTickUsd = 0,
    computeCreditUsd = 5, computeBurnPerTickUsd = 0.8,
    venue = new PalphaVenue(),
    network = PHAROS.atlantic, self = "0x1111111111111111111111111111111111111111",
  } = {}) {
    super();
    this._network = network;
    this._self = self;
    this.phrsPriceUsd = phrsPriceUsd;
    this.gasBurnPerTick = gasBurnPerTick;
    this.opCostPerTickUsd = opCostPerTickUsd;
    this.computeBurnPerTickUsd = computeBurnPerTickUsd;
    this.venue = venue;
    this._gas = gasPhrs;
    this._usdc = usdcUsd;
    this._computeCreditUsd = computeCreditUsd;
    this._tx = 0;
  }

  get network() { return this._network; }
  get self() { return this._self; }
  _txHash() { this._tx += 1; return "0xsim" + String(this._tx).padStart(60, "0"); }

  async balances() {
    return {
      gasPhrs: round(this._gas),
      usdcUsd: round(this._usdc, 2),
      yieldUsd: this.venue.depositedUsd,
      pendingRedeemUsd: this.venue.pendingUsd(),
      computeCreditUsd: round(this._computeCreditUsd, 2),
    };
  }

  // Buy PHRS gas with USDC at the configured price.
  async refuel({ amountPhrs }) {
    const spentUsd = round(amountPhrs * this.phrsPriceUsd, 4);
    if (this._usdc < spentUsd) throw new Error("insufficient USDC to refuel");
    this._usdc -= spentUsd;
    this._gas += amountPhrs;
    return { txHash: this._txHash(), refueledPhrs: round(amountPhrs), spentUsd };
  }

  // Subscribe surplus USDC into the yield venue (pALPHA).
  async sweep({ amountUsd }) {
    if (this._usdc < amountUsd) throw new Error("insufficient USDC to sweep");
    this._usdc -= amountUsd;
    const res = this.venue.subscribe(amountUsd);
    return { txHash: this._txHash(), sweptUsd: round(amountUsd, 2), ...res };
  }

  // Submit a redemption request to the venue — USDC arrives after the queue.
  async reclaim({ amountUsd }) {
    const res = this.venue.requestRedeem(amountUsd);
    return { txHash: this._txHash(), ...res };
  }

  // Prepare and simulate an x402/MaaS compute refuel. The SDK returns a payment
  // intent; production runtimes decide whether/how to execute it.
  async refuelCompute({ refuelCreditUsd, paymentUsd, paymentIntent }) {
    if (this._usdc < paymentUsd) throw new Error("insufficient USDC to fund compute refuel intent");
    this._usdc -= paymentUsd;
    this._computeCreditUsd += refuelCreditUsd;
    return {
      txHash: this._txHash(),
      x402Intent: paymentIntent,
      computeCreditAddedUsd: round(refuelCreditUsd, 4),
      spentUsd: round(paymentUsd, 4),
    };
  }

  // Advance one unit of time: burn gas, pay operating costs, accrue yield, and
  // credit any matured redemptions back to USDC.
  async tick() {
    this._gas = Math.max(0, round(this._gas - this.gasBurnPerTick));
    if (this.opCostPerTickUsd) this._usdc = Math.max(0, round(this._usdc - this.opCostPerTickUsd, 2));
    this._computeCreditUsd = Math.max(0, round(this._computeCreditUsd - this.computeBurnPerTickUsd, 2));
    this.venue.tick();
    const matured = this.venue.claimMatured();
    if (matured > 0) this._usdc = round(this._usdc + matured, 2);
  }
}
