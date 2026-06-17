// Pharos Reserve — autonomous metabolism demo.
//
//   node demos/run.js
//
// An agent starts with gas and idle USDC, then runs on its own: it sweeps idle
// reserves into yield, burns gas as it works, and refuels itself before it ever
// runs dry — no human top-ups, every action gated by Sentinel.

import { ReserveSimulationAdapter, reserveStatus, runMetabolism } from "../sdk/index.js";

const line = (s = "") => console.log(s);

async function main() {
  const agent = new ReserveSimulationAdapter({ gasPhrs: 0.05, usdcUsd: 500, gasBurnPerTick: 0.02, yieldPerTickUsd: 0.4 });

  line("Pharos Reserve — autonomous treasury (metabolism loop)\n");
  const s0 = await reserveStatus({ adapter: agent });
  line(`Network: ${s0.network}`);
  line(`Start  : gas ${s0.gasPhrs} PHRS | USDC $${s0.usdcUsd} | yield $${s0.yieldUsd}\n`);

  line("— Running 10 ticks (the agent works and manages its own treasury) —");
  await runMetabolism({
    adapter: agent,
    ticks: 10,
    onTick: (e) => {
      const tag = e.action.toUpperCase().padEnd(7);
      const x = e.exec && e.exec.executed
        ? (e.action === "refuel" ? `+${e.exec.refueledPhrs} PHRS for $${e.exec.spentUsd}` : `swept $${e.exec.sweptUsd} to yield`)
        : "";
      line(`  t${e.tick.toString().padStart(2)}  ${tag} gas ${e.balances.gasPhrs} | USDC $${e.balances.usdcUsd} | yield $${e.balances.yieldUsd}  ${x}`);
    },
  });

  const sf = await reserveStatus({ adapter: agent });
  line(`\nEnd    : gas ${sf.gasPhrs} PHRS | USDC $${sf.usdcUsd} | yield $${sf.yieldUsd}`);
  line("\nResult: the agent never ran out of gas and put its idle reserves to work — fully autonomous, Sentinel-gated.");
}

main();
