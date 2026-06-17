// Pharos Reserve — Sentinel gate
//
// Mirrors the Sentinel Shield decision layer used across the stack (Atlas
// Council, Clearing House) so the Reserve runs standalone. Every value-moving
// action is screened before it executes. The shape is compatible, so the real
// Atlas Sentinel can be dropped in.

import { isAddress } from "./chain.js";

export const DEFAULT_GATE_POLICY = {
  allowedNetworks: ["pharos-testnet", "pharos-atlantic-testnet", 688688, 688689],
  maxActionUsd: 5000,
  requireUserConfirmedForWrites: true,
  requireKnownContractForWrites: true,
};

const ZERO = "0x0000000000000000000000000000000000000000";

export function reviewAction(action = {}, policy = {}) {
  const p = { ...DEFAULT_GATE_POLICY, ...policy };
  const blocks = [];
  const escalations = [];

  const net = action.network;
  if (net !== undefined && !p.allowedNetworks.includes(net)) {
    blocks.push(`network not allowed: ${net}`);
  }

  if (action.isWrite) {
    if (p.requireUserConfirmedForWrites && action.userConfirmed !== true) {
      blocks.push("write action requires an authorizing reserve mandate");
    }
    if (p.requireKnownContractForWrites && action.contractKnown === false) {
      escalations.push("counterparty/venue is not on the known-contract allowlist");
    }
  }

  if (typeof action.amountUsd === "number") {
    if (action.amountUsd <= 0) blocks.push("amount must be greater than zero");
    if (action.amountUsd > p.maxActionUsd) {
      blocks.push(`amount ${action.amountUsd} exceeds policy limit ${p.maxActionUsd}`);
    }
  }

  if (action.to !== undefined && (!isAddress(action.to) || action.to === ZERO)) {
    blocks.push("destination address is missing or invalid (drain-pattern guard)");
  }

  let decision = "approve";
  if (escalations.length) decision = "escalate";
  if (blocks.length) decision = "block";

  const reasons = decision === "approve" ? ["all gates passed"] : [...blocks, ...escalations];
  return { decision, reasons };
}

export function isApproved(verdict) {
  return verdict && verdict.decision === "approve";
}
