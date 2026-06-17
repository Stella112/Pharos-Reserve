// Pharos Reserve — autonomous metabolism demo (with pALPHA yield).
//
//   node demos/run.js
//
// An agent starts with gas and idle USDC, then runs on its own: it subscribes
// surplus into pALPHA (the Ember Protocol RealFi vault on Pharos), burns gas and
// pays operating costs as it works, and when its working balance runs low it
// submits a redemption request and waits out pALPHA's queue before the USDC
// returns. Gas is refueled before it ever hits zero. No human top-ups; every
// action gated by Sentinel.

import { ReserveSimulationAdapter, PalphaVenue, reserveStatus, runMetabolism } from "../sdk/index.js";

const line = (s = "") => console.log(s);

async function main() {
  const agent = new ReserveSimulationAdapter({
    gasPhrs: 0.05,
    usdcUsd: 500,
    gasBurnPerTick: 0.02,
    opCostPerTickUsd: 15,                 // the agent spends as it works (settlements, fees)
    venue: new PalphaVenue({ redeemDelayTicks: 2, aprPct: 8 }),
  });

  line("Pharos Reserve — autonomous treasury (metabolism loop, pALPHA yield)\n");
  const s0 = await reserveStatus({ adapter: agent });
  line(`Network: ${s0.network}   Venue: ${agent.venue.name}`);
  line(`Start  : gas ${s0.gasPhrs} PHRS | USDC $${s0.usdcUsd} | in pALPHA $${s0.yieldUsd} | pending $${s0.pendingRedeemUsd}\n`);

  line("— Running 11 ticks —");
  await runMetabolism({
    adapter: agent,
    ticks: 11,
    onTick: (e) => {
      const tag = e.action.toUpperCase().padEnd(7);
      let x = "";
      if (e.exec && e.exec.executed) {
        if (e.action === "sweep") x = `subscribed $${e.exec.sweptUsd} to pALPHA`;
        else if (e.action === "reclaim") x = `redemption request $${e.exec.requestedUsd} (ready in ${e.exec.etaTicks} ticks)`;
        else if (e.action === "refuel") x = `+${e.exec.refueledPhrs} PHRS for $${e.exec.spentUsd}`;
      }
      const b = e.balances;
      line(`  t${e.tick.toString().padStart(2)}  ${tag} gas ${b.gasPhrs} | USDC $${b.usdcUsd} | pALPHA $${b.yieldUsd} | pending $${b.pendingRedeemUsd}   ${x}`);
    },
  });

  const sf = await reserveStatus({ adapter: agent });
  line(`\nEnd    : gas ${sf.gasPhrs} PHRS | USDC $${sf.usdcUsd} | in pALPHA $${sf.yieldUsd} | pending $${sf.pendingRedeemUsd}`);
  line("\nResult: the agent funded its own gas, earned on idle reserves in pALPHA, and");
  line("redeemed capital back through the queue when it needed it — fully autonomous.");
}

main();
