import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, etaBlocks, satsToUsd } from "../src/fees.ts";
import type { MempoolBlock, Recommended } from "../src/mempool.ts";

const block = (min: number, median: number): MempoolBlock => ({ blockSize: 1, blockVSize: 1e6, nTx: 1000, totalFees: 1, medianFee: median, feeRange: [min, median, median * 2] });

test("quiet mempool: send now at the floor", () => {
  const rec: Recommended = { fastestFee: 2, halfHourFee: 1, hourFee: 1, economyFee: 1, minimumFee: 1 };
  const a = analyze(rec, [block(1, 1.5)], 80_000, "30_minutes", 140);
  assert.equal(a.verdict, "send_now");
  assert.equal(a.fee_sats, 140);
  assert.equal(a.savings_sats, 0);
});

test("congested mempool: wait when the cheaper tier saves 30%+", () => {
  const rec: Recommended = { fastestFee: 60, halfHourFee: 40, hourFee: 20, economyFee: 8, minimumFee: 2 };
  const a = analyze(rec, Array.from({ length: 8 }, () => block(20, 30)), 80_000, "30_minutes", 140);
  assert.equal(a.verdict, "wait");
  assert.equal(a.wait_for, "1_hour");
  assert.equal(a.savings_sats, (40 - 20) * 140);
  assert.equal(a.savings_pct, 50);
});

test("tiny absolute savings: send now even at 67% relative savings", () => {
  const rec: Recommended = { fastestFee: 6, halfHourFee: 6, hourFee: 2, economyFee: 1, minimumFee: 1 };
  const a = analyze(rec, Array.from({ length: 8 }, () => block(1, 2)), 30_000, "30_minutes", 140);
  assert.equal(a.verdict, "send_now"); // 560 sats ≈ $0.17 saved, below the $0.25 floor
  assert.equal(a.savings_sats, 0);
});

test("meaningful savings in dollars triggers wait", () => {
  const rec: Recommended = { fastestFee: 6, halfHourFee: 6, hourFee: 2, economyFee: 1, minimumFee: 1 };
  const a = analyze(rec, Array.from({ length: 8 }, () => block(1, 2)), 80_000, "30_minutes", 1000);
  assert.equal(a.verdict, "wait"); // 4000 sats ≈ $3.20 saved
});

test("next_block urgency never waits", () => {
  const rec: Recommended = { fastestFee: 60, halfHourFee: 40, hourFee: 20, economyFee: 8, minimumFee: 2 };
  const a = analyze(rec, [block(20, 30)], 80_000, "next_block", 140);
  assert.equal(a.verdict, "send_now");
});

test("economy has no cheaper tier", () => {
  const rec: Recommended = { fastestFee: 60, halfHourFee: 40, hourFee: 20, economyFee: 8, minimumFee: 2 };
  const a = analyze(rec, [block(20, 30)], 80_000, "economy", 140);
  assert.equal(a.verdict, "send_now");
  assert.equal(a.wait_for, null);
});

test("eta from projected blocks", () => {
  const blocks = [block(10, 20), block(5, 8), block(1, 2)];
  assert.equal(etaBlocks(25, blocks), 1);
  assert.equal(etaBlocks(6, blocks), 2);
  assert.equal(etaBlocks(1, blocks), 3);
  assert.equal(etaBlocks(0.5, blocks), null);
});

test("sats to usd", () => {
  assert.equal(satsToUsd(100_000_000, 80_000), 80_000);
  assert.equal(satsToUsd(140, 80_000), 0.112);
});
