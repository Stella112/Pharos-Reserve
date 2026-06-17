// Pharos Reserve — live RPC adapter (real Pharos balances).
//
// Reads the agent's real gas (native PHRS) and USDC balances from Pharos, so
// `reserve_status` and `reserve_plan` operate on live on-chain data. A sweep is
// a real USDC transfer to a configurable yield/treasury address — set it to the
// pALPHA (Ember Protocol) vault on Pharos mainnet (chain 1672) for real RealFi
// yield. Gas refuel needs a swap venue (DEX) and is left to the deployment; the
// simulation adapter demonstrates the full autonomous loop (including pALPHA's
// request-based redemption queue) offline.
//
// Requires `ethers` (npm i ethers). The key is injected by the runtime and lives
// only here — never in the browser, never in the repo.

import { ethers } from "ethers";
import { PHAROS, networkByChainId } from "./chain.js";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address,uint256) returns (bool)",
];

export class PharosReserveAdapter {
  constructor({ rpcUrl, privateKey, usdcAddress, yieldVenue, network = PHAROS.atlantic }) {
    this._network = network;
    this.usdcAddress = usdcAddress || network.usdc;
    this.yieldVenue = yieldVenue; // where a sweep sends USDC (e.g. a vault/treasury)
    this.provider = new ethers.JsonRpcProvider(rpcUrl || network.rpcUrl, undefined, { staticNetwork: true });
    this.signer = privateKey ? new ethers.Wallet(privateKey, this.provider) : null;
    this.usdc = new ethers.Contract(this.usdcAddress, ERC20_ABI, this.signer || this.provider);
    this._yieldUsd = 0;
  }

  get network() { return this._network; }
  get self() { return this.signer ? this.signer.address : null; }

  async syncNetwork() {
    const { chainId } = await this.provider.getNetwork();
    this._network = networkByChainId(chainId);
    return this._network;
  }

  async balances() {
    const owner = this.self;
    const [gasWei, usdcUnits] = await Promise.all([
      this.provider.getBalance(owner),
      this.usdc.balanceOf(owner),
    ]);
    return {
      gasPhrs: Number(ethers.formatEther(gasWei)),
      usdcUsd: Number(ethers.formatUnits(usdcUnits, 6)),
      yieldUsd: this._yieldUsd,
    };
  }

  // Real USDC transfer into the yield/treasury venue.
  async sweep({ amountUsd }) {
    if (!this.yieldVenue) throw new Error("set yieldVenue to sweep on-chain");
    const units = ethers.parseUnits(String(amountUsd), 6);
    const tx = await this.usdc.transfer(this.yieldVenue, units);
    await tx.wait();
    this._yieldUsd += Number(amountUsd);
    return { txHash: tx.hash, explorer: `${this._network.explorer}/tx/${tx.hash}`, sweptUsd: Number(amountUsd) };
  }

  // Buying gas with USDC requires a swap venue (DEX) — wire one per deployment.
  async refuel() {
    throw new Error("live refuel needs a swap venue (DEX); balances are read live, run the metabolism demo in simulation");
  }
}
