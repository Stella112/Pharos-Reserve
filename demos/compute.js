// Pharos Reserve — x402 compute reserve demo.
//
// Shows the agent refilling inference credits with a Sentinel-gated x402/MaaS
// payment intent before it runs out of "brain fuel".

import { ReserveSimulationAdapter, computeStatus, computePlan, refuelCompute } from "../sdk/index.js";

const line = (s = "") => console.log(s);

async function main() {
  const agent = new ReserveSimulationAdapter({
    gasPhrs: 0.05,
    usdcUsd: 250,
    computeCreditUsd: 0.2,
    computeBurnPerTickUsd: 0.8,
  });

  const policy = {
    burnUsdPerMinute: 0.01,
    computeFloorMinutes: 30,
    computeTargetMinutes: 120,
    prosDiscountPct: 20,
    maaSEndpoint: "pharos-maas",
  };

  line("Pharos Reserve — x402 Compute Reserve\n");
  line("Before:");
  line(JSON.stringify(await computeStatus({ adapter: agent, policy }), null, 2));

  line("\nPlan:");
  line(JSON.stringify(await computePlan({ adapter: agent, policy }), null, 2));

  line("\nSentinel-gated refuel:");
  line(JSON.stringify(await refuelCompute({ adapter: agent, policy }), null, 2));

  line("\nAfter:");
  line(JSON.stringify(await computeStatus({ adapter: agent, policy }), null, 2));
}

main();

