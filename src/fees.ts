/** Pure fee-intelligence logic. No I/O, unit-tested. */
import type { MempoolBlock, Recommended } from "./mempool.js";

export type Urgency = "next_block" | "30_minutes" | "1_hour" | "economy";
export type Verdict = "send_now" | "wait";

const TIER: Record<Urgency, keyof Recommended> = {
  next_block: "fastestFee",
  "30_minutes": "halfHourFee",
  "1_hour": "hourFee",
  economy: "economyFee",
};
const CHEAPER: Record<Urgency, Urgency | null> = { next_block: "30_minutes", "30_minutes": "1_hour", "1_hour": "economy", economy: null };
export const LABEL: Record<Urgency, string> = {
  next_block: "next block (~10 min)",
  "30_minutes": "~30 minutes",
  "1_hour": "~1 hour",
  economy: "economy (hours+)",
};
export const URGENCIES = Object.keys(TIER) as Urgency[];

export const satsToUsd = (sats: number, btcUsd: number) => Math.round((sats / 1e8) * btcUsd * 10000) / 10000;
export const usd = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
/** Waiting is only worth recommending when it saves a meaningful share AND a meaningful amount. */
export const MIN_SAVINGS_PCT = 30;
export const MIN_SAVINGS_USD = 0.25;

export type Tier = { sat_vb: number; fee_sats: number; fee_usd: number };
export type Analysis = {
  urgency: Urgency;
  fee_rate_sat_vb: number;
  tx_vbytes: number;
  fee_sats: number;
  fee_usd: number;
  verdict: Verdict;
  reason: string;
  wait_for: Urgency | null;
  wait_fee_rate_sat_vb: number | null;
  savings_sats: number;
  savings_usd: number;
  savings_pct: number;
  mempool_blocks_queued: number;
  next_block_median_sat_vb: number | null;
  tiers: Record<Urgency, Tier>;
  btc_usd: number;
};

export function analyze(rec: Recommended, blocks: MempoolBlock[], btcUsd: number, urgency: Urgency, vbytes: number): Analysis {
  const tiers = {} as Record<Urgency, Tier>;
  for (const u of URGENCIES) {
    const rate = rec[TIER[u]];
    const sats = Math.ceil(rate * vbytes);
    tiers[u] = { sat_vb: rate, fee_sats: sats, fee_usd: satsToUsd(sats, btcUsd) };
  }
  const me = tiers[urgency];
  const cheaperKey = CHEAPER[urgency];
  const cheaper = cheaperKey ? tiers[cheaperKey] : null;
  const floor = Math.max(1, rec.minimumFee);
  const nearFloor = me.sat_vb <= Math.max(3, floor * 2);
  const savingsSats = cheaper ? Math.max(0, me.fee_sats - cheaper.fee_sats) : 0;
  const savingsUsd = satsToUsd(savingsSats, btcUsd);
  const savingsPct = cheaper && me.fee_sats > 0 ? Math.round((savingsSats / me.fee_sats) * 100) : 0;
  const queued = `${blocks.length}${blocks.length >= 8 ? "+" : ""}`;
  const level = me.sat_vb >= 20 ? "Fees are elevated" : "Fees are moderate";

  let verdict: Verdict = "send_now";
  let reason: string;
  if (nearFloor) {
    reason = `${me.sat_vb} sat/vB is at the mempool floor. Waiting cannot get meaningfully cheaper.`;
  } else if (urgency === "next_block") {
    reason = `You asked for next-block confirmation, so pay the ${me.sat_vb} sat/vB tier now.`;
  } else if (cheaper && cheaperKey && savingsPct >= MIN_SAVINGS_PCT && savingsUsd >= MIN_SAVINGS_USD) {
    verdict = "wait";
    reason = `${level} with ${queued} blocks queued. Targeting "${LABEL[cheaperKey]}" instead of "${LABEL[urgency]}" drops the rate from ${me.sat_vb} to ${cheaper.sat_vb} sat/vB and saves ${savingsPct}% (${usd(savingsUsd)}).`;
  } else if (cheaper && savingsSats > 0) {
    reason = `Waiting for the "${LABEL[cheaperKey!]}" tier would only save ${savingsSats} sats (${usd(savingsUsd)}), which is not worth the delay. Send at ${me.sat_vb} sat/vB.`;
  } else {
    reason = `No cheaper tier is available for this urgency. Send at ${me.sat_vb} sat/vB.`;
  }
  const wait = verdict === "wait";
  return {
    urgency,
    fee_rate_sat_vb: me.sat_vb,
    tx_vbytes: vbytes,
    fee_sats: me.fee_sats,
    fee_usd: me.fee_usd,
    verdict,
    reason,
    wait_for: wait ? cheaperKey : null,
    wait_fee_rate_sat_vb: wait && cheaper ? cheaper.sat_vb : null,
    savings_sats: wait ? savingsSats : 0,
    savings_usd: wait ? savingsUsd : 0,
    savings_pct: wait ? savingsPct : 0,
    mempool_blocks_queued: blocks.length,
    next_block_median_sat_vb: blocks[0] ? Math.round(blocks[0].medianFee * 100) / 100 : null,
    tiers,
    btc_usd: btcUsd,
  };
}

export function describe(a: Analysis): string {
  const head =
    a.verdict === "send_now"
      ? "SEND NOW"
      : `WAIT. Target "${a.wait_for ? LABEL[a.wait_for] : ""}" at ${a.wait_fee_rate_sat_vb} sat/vB and save ${a.savings_sats} sats (${usd(a.savings_usd)})`;
  const rows = URGENCIES.map((u) => `| ${LABEL[u]} | ${a.tiers[u].sat_vb} | ${a.tiers[u].fee_sats} | ${usd(a.tiers[u].fee_usd)} |`);
  const queued = `${a.mempool_blocks_queued}${a.mempool_blocks_queued >= 8 ? "+" : ""}`;
  return [
    `## Bitcoin fee check: ${head}`,
    "",
    `Target ${LABEL[a.urgency]}: **${a.fee_rate_sat_vb} sat/vB** = ${a.fee_sats} sats (${usd(a.fee_usd)}) for a ${a.tx_vbytes} vB transaction. BTC = $${a.btc_usd.toLocaleString("en-US")}.`,
    "",
    a.reason,
    "",
    `Mempool: ${queued} blocks queued, next block median ${a.next_block_median_sat_vb ?? "?"} sat/vB.`,
    "",
    "| Tier | sat/vB | fee (sats) | fee (USD) |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}

/** Estimate how many blocks until a transaction at `rate` sat/vB is mined, from projected mempool blocks. */
export function etaBlocks(rate: number, blocks: MempoolBlock[]): number | null {
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (b && rate >= (b.feeRange[0] ?? 0)) return i + 1;
  }
  return blocks.length === 0 ? 1 : null;
}
