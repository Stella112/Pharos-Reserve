// Pharos Reserve — yield venue (pALPHA / Ember Protocol model)
//
// Models pALPHA, the RealFi yield vault on Pharos (built on Ember Protocol):
// a REQUEST-BASED venue, not an instant pool. You subscribe to deposit, submit a
// redemption request that queues and processes after a delay, then receive USDC.
// The live adapter targets the real Ember vault on Pharos mainnet (chain 1672);
// this deterministic model lets the metabolism loop run offline.

const round = (n, d = 2) => Number(n.toFixed(d));

export class PalphaVenue {
  // redeemDelayTicks models pALPHA's multi-day redemption queue (1 tick ≈ 1 day).
  constructor({ name = "pALPHA (Ember Protocol)", redeemDelayTicks = 2, aprPct = 8 } = {}) {
    this.name = name;
    this.redeemDelayTicks = redeemDelayTicks;
    this.aprPct = aprPct;
    this.depositedUsd = 0;
    this.pending = []; // [{ amountUsd, readyAtTick }]
    this._tick = 0;
  }

  // Subscribe: deposit USDC into the vault.
  subscribe(amountUsd) {
    this.depositedUsd = round(this.depositedUsd + amountUsd);
    return { venue: this.name, subscribedUsd: round(amountUsd), positionUsd: this.depositedUsd };
  }

  // Submit a redemption request — queued, payable after the delay.
  requestRedeem(amountUsd) {
    const amt = round(Math.min(amountUsd, this.depositedUsd));
    this.depositedUsd = round(this.depositedUsd - amt);
    const readyAtTick = this._tick + this.redeemDelayTicks;
    this.pending.push({ amountUsd: amt, readyAtTick });
    return { venue: this.name, requestedUsd: amt, readyAtTick, etaTicks: this.redeemDelayTicks };
  }

  // Pay out any matured redemption requests; returns USDC released this moment.
  claimMatured() {
    const matured = this.pending.filter((p) => p.readyAtTick <= this._tick);
    if (!matured.length) return 0;
    this.pending = this.pending.filter((p) => p.readyAtTick > this._tick);
    return round(matured.reduce((s, p) => s + p.amountUsd, 0));
  }

  pendingUsd() {
    return round(this.pending.reduce((s, p) => s + p.amountUsd, 0));
  }

  position() {
    return { venue: this.name, depositedUsd: this.depositedUsd, pendingRedeemUsd: this.pendingUsd(), redeemDelayTicks: this.redeemDelayTicks };
  }

  // Advance time: accrue yield on the deposited principal.
  tick() {
    this._tick += 1;
    if (this.depositedUsd > 0) {
      this.depositedUsd = round(this.depositedUsd + (this.depositedUsd * (this.aprPct / 100)) / 365);
    }
  }
}
