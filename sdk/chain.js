// Pharos Reserve — chain layer
//
// The Reserve never holds, reads, or prints private keys. Writes go through an
// injected `signer` from the caller's runtime. The default adapter is a
// deterministic in-memory simulation so the skill runs offline with zero
// dependencies; swap in the RPC adapter for real Pharos balances.

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
// that burns gas as it works and earns yield on swept reserves.
export class ReserveSimulationAdapter extends ReserveAdapter {
  constructor({
    gasPhrs = 0.05, usdcUsd = 200, yieldUsd = 0,
    phrsPriceUsd = 0.1, gasBurnPerTick = 0.02, yieldPerTickUsd = 0.5,
    network = PHAROS.atlantic, self = "0x1111111111111111111111111111111111111111",
  } = {}) {
    super();
    this._network = network;
    this._self = self;
    this.phrsPriceUsd = phrsPriceUsd;
    this.gasBurnPerTick = gasBurnPerTick;
    this.yieldPerTickUsd = yieldPerTickUsd;
    this._gas = gasPhrs;
    this._usdc = usdcUsd;
    this._yield = yieldUsd;
    this._tx = 0;
  }

  get network() { return this._network; }
  get self() { return this._self; }
  _txHash() { this._tx += 1; return "0xsim" + String(this._tx).padStart(60, "0"); }

  async balances() {
    return { gasPhrs: round(this._gas), usdcUsd: round(this._usdc, 2), yieldUsd: round(this._yield, 2) };
  }

  // Buy PHRS gas with USDC at the configured price.
  async refuel({ amountPhrs }) {
    const spentUsd = round(amountPhrs * this.phrsPriceUsd, 4);
    if (this._usdc < spentUsd) throw new Error("insufficient USDC to refuel");
    this._usdc -= spentUsd;
    this._gas += amountPhrs;
    return { txHash: this._txHash(), refueledPhrs: round(amountPhrs), spentUsd };
  }

  // Move surplus USDC into the yield position.
  async sweep({ amountUsd }) {
    if (this._usdc < amountUsd) throw new Error("insufficient USDC to sweep");
    this._usdc -= amountUsd;
    this._yield += amountUsd;
    return { txHash: this._txHash(), sweptUsd: round(amountUsd, 2) };
  }

  // Advance one unit of time: the agent burns gas, the yield position accrues.
  async tick() {
    this._gas = Math.max(0, round(this._gas - this.gasBurnPerTick));
    if (this._yield > 0) this._yield = round(this._yield + this.yieldPerTickUsd, 2);
  }
}
