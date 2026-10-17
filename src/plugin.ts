import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { getAddress, isAddress } from "viem";
import { evmOutputSchema, proposeEvm } from "./paybox.js";
import * as api from "./mempool.js";
import { analyze, describe, etaBlocks, satsToUsd, usd, URGENCIES, type Urgency } from "./fees.js";
import { BASE_CHAIN, BASESCAN_TOKEN, CAP_USD, CBBTC_BASE, fmtBtc, transferData } from "./cbbtc.js";

const PROTOCOL_VERSION = "2026-07-28";
const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const TYPICAL_VBYTES = 140; // one-input, two-output P2WPKH spend

const urgency = z.enum(["next_block", "30_minutes", "1_hour", "economy"]).describe("How soon the Bitcoin transaction must confirm.");
const txid = z.string().regex(/^[0-9a-f]{64}$/i, "Use a 64-hex-character Bitcoin transaction id.");
const btcAddress = z.string().regex(/^(bc1[ac-hj-np-z02-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/, "Use a mainnet Bitcoin address (bc1..., 1..., or 3...).");
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Use a 0x EVM address.");

function text(t: string, structured?: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: t }], ...(structured ? { structuredContent: structured } : {}) };
}
function fail(t: string) {
  return { content: [{ type: "text" as const, text: t }], isError: true };
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function createServer() {
  const server = new McpServer({ name: "satoshi", version: "0.1.0" }, { supportedProtocolVersions: [PROTOCOL_VERSION] });

  server.registerTool(
    "bitcoin_fee_recommendation",
    {
      title: "Should I send Bitcoin now or wait?",
      description:
        "Free, read-only. Live Bitcoin fee intelligence from the mempool: the sat/vB rate for the requested urgency, what the transaction costs in sats and USD, every fee tier, how deep the mempool queue is, and a plain SEND NOW or WAIT verdict with the savings from waiting. Call this before any on-chain Bitcoin send, or when the user asks what Bitcoin fees are doing. If fees are high and the payment is small, suggest pay_bitcoin_on_base (cbBTC on Base) as the cheap alternative.",
      inputSchema: z
        .object({
          urgency: urgency.optional().describe("Defaults to 30_minutes."),
          tx_vbytes: z.number().int().min(60).max(100000).optional().describe(`Transaction size in virtual bytes. Defaults to ${TYPICAL_VBYTES} (a typical single-input, two-output SegWit spend).`),
        })
        .strict(),
      annotations: ro,
    },
    async ({ urgency: u, tx_vbytes }) => {
      try {
        const [rec, blocks, px] = await Promise.all([api.recommended(), api.mempoolBlocks(), api.prices()]);
        const a = analyze(rec, blocks, px.USD, (u ?? "30_minutes") as Urgency, tx_vbytes ?? TYPICAL_VBYTES);
        return text(describe(a), a as unknown as Record<string, unknown>);
      } catch (e) {
        return fail(`Could not fetch fee data: ${errMsg(e)}`);
      }
    },
  );

  server.registerTool(
    "bitcoin_mempool_snapshot",
    {
      title: "Bitcoin mempool and network snapshot",
      description:
        "Free, read-only. Current Bitcoin network state: chain height, unconfirmed transaction count and total vsize, blocks needed to clear the mempool, projected fee for the next blocks, every recommended fee tier, BTC price, and difficulty-adjustment progress. Use it for 'how busy is Bitcoin right now' questions.",
      inputSchema: z.object({}).strict(),
      annotations: ro,
    },
    async () => {
      try {
        const [rec, blocks, info, px, tip, diff] = await Promise.all([api.recommended(), api.mempoolBlocks(), api.mempoolInfo(), api.prices(), api.tipHeight(), api.difficulty()]);
        const clearBlocks = Math.ceil(info.vsize / 1_000_000);
        const next = blocks.slice(0, 3).map((b, i) => `block +${i + 1}: median ${b.medianFee.toFixed(2)} sat/vB, ${b.nTx} txs`);
        const out = {
          tip_height: tip,
          btc_usd: px.USD,
          mempool_tx_count: info.count,
          mempool_vsize_mb: Math.round(info.vsize / 10_000) / 100,
          blocks_to_clear: clearBlocks,
          recommended_sat_vb: rec,
          projected_blocks: blocks.slice(0, 3).map((b) => ({ median_sat_vb: Math.round(b.medianFee * 100) / 100, tx_count: b.nTx, min_sat_vb: Math.round((b.feeRange[0] ?? 0) * 100) / 100 })),
          difficulty: { progress_pct: Math.round(diff.progressPercent * 10) / 10, estimated_change_pct: Math.round(diff.difficultyChange * 100) / 100, blocks_remaining: diff.remainingBlocks, next_retarget_height: diff.nextRetargetHeight },
        };
        const md = [
          `## Bitcoin network snapshot (block ${tip}, BTC $${px.USD.toLocaleString("en-US")})`,
          "",
          `Mempool: ${info.count.toLocaleString("en-US")} unconfirmed txs, ${out.mempool_vsize_mb} MB vsize, about ${clearBlocks} block${clearBlocks === 1 ? "" : "s"} to clear.`,
          `Fees (sat/vB): next block ${rec.fastestFee}, 30 min ${rec.halfHourFee}, 1 hour ${rec.hourFee}, economy ${rec.economyFee}, floor ${rec.minimumFee}.`,
          ...next.map((n) => `- ${n}`),
          `Difficulty: ${out.difficulty.progress_pct}% through the epoch, ${diff.remainingBlocks} blocks to retarget, estimated change ${out.difficulty.estimated_change_pct}%.`,
        ].join("\n");
        return text(md, out);
      } catch (e) {
        return fail(`Could not fetch mempool data: ${errMsg(e)}`);
      }
    },
  );

  server.registerTool(
    "bitcoin_tx_status",
    {
      title: "Check a Bitcoin transaction",
      description:
        "Free, read-only. Look up a Bitcoin transaction by txid: confirmed or not, confirmations, block height and time, fee paid, fee rate in sat/vB, total output value, and for unconfirmed transactions an estimate of how many blocks until it mines given today's mempool. Use it to answer 'did my payment go through' or 'is this transaction stuck'.",
      inputSchema: z.object({ txid }).strict(),
      annotations: ro,
    },
    async ({ txid: id }) => {
      try {
        const [t, tip, blocks, px] = await Promise.all([api.tx(id.toLowerCase()), api.tipHeight(), api.mempoolBlocks(), api.prices()]);
        const vsize = Math.ceil(t.weight / 4);
        const rate = Math.round((t.fee / vsize) * 100) / 100;
        const value = t.vout.reduce((s, o) => s + o.value, 0);
        const confirmations = t.status.confirmed && t.status.block_height !== undefined ? tip - t.status.block_height + 1 : 0;
        const eta = t.status.confirmed ? null : etaBlocks(rate, blocks);
        const out = {
          txid: t.txid,
          confirmed: t.status.confirmed,
          confirmations,
          block_height: t.status.block_height ?? null,
          block_time: t.status.block_time ? new Date(t.status.block_time * 1000).toISOString() : null,
          fee_sats: t.fee,
          fee_usd: satsToUsd(t.fee, px.USD),
          fee_rate_sat_vb: rate,
          vsize,
          output_value_sats: value,
          output_value_usd: satsToUsd(value, px.USD),
          eta_blocks: eta,
          stuck: !t.status.confirmed && eta === null,
          explorer_url: `${api.MEMPOOL}/tx/${t.txid}`,
        };
        const status = t.status.confirmed
          ? `Confirmed with ${confirmations} confirmation${confirmations === 1 ? "" : "s"} in block ${t.status.block_height} (${out.block_time}).`
          : eta === null
            ? `Unconfirmed and likely STUCK: ${rate} sat/vB is below everything in the next ${blocks.length} projected blocks. Consider RBF or CPFP.`
            : `Unconfirmed. At ${rate} sat/vB it should mine in about ${eta} block${eta === 1 ? "" : "s"} (~${eta * 10} min).`;
        const md = [`## Transaction ${t.txid.slice(0, 12)}…`, "", status, `Fee ${t.fee} sats (${usd(out.fee_usd)}) at ${rate} sat/vB for ${vsize} vB. Outputs total ${(value / 1e8).toFixed(8)} BTC (${usd(out.output_value_usd)}).`, out.explorer_url].join("\n");
        return text(md, out);
      } catch (e) {
        return fail(`Could not look up transaction: ${errMsg(e)}`);
      }
    },
  );

  server.registerTool(
    "bitcoin_address_overview",
    {
      title: "Bitcoin address balance and activity",
      description:
        "Free, read-only. Confirmed and unconfirmed balance of a mainnet Bitcoin address in BTC and USD, lifetime received and sent, transaction count, and an explorer link. Use it to check whether a payment to an address has arrived.",
      inputSchema: z.object({ address: btcAddress }).strict(),
      annotations: ro,
    },
    async ({ address: addr }) => {
      try {
        const [a, px] = await Promise.all([api.address(addr), api.prices()]);
        const confirmed = a.chain_stats.funded_txo_sum - a.chain_stats.spent_txo_sum;
        const pending = a.mempool_stats.funded_txo_sum - a.mempool_stats.spent_txo_sum;
        const out = {
          address: a.address,
          confirmed_balance_sats: confirmed,
          confirmed_balance_btc: confirmed / 1e8,
          confirmed_balance_usd: satsToUsd(confirmed, px.USD),
          unconfirmed_delta_sats: pending,
          total_received_sats: a.chain_stats.funded_txo_sum,
          total_sent_sats: a.chain_stats.spent_txo_sum,
          tx_count: a.chain_stats.tx_count,
          pending_tx_count: a.mempool_stats.tx_count,
          explorer_url: `${api.MEMPOOL}/address/${a.address}`,
        };
        const md = [
          `## ${a.address}`,
          "",
          `Confirmed balance: **${(confirmed / 1e8).toFixed(8)} BTC** (${usd(out.confirmed_balance_usd)}) across ${a.chain_stats.tx_count} transactions.`,
          pending !== 0 || a.mempool_stats.tx_count > 0 ? `Pending in mempool: ${pending >= 0 ? "+" : ""}${(pending / 1e8).toFixed(8)} BTC in ${a.mempool_stats.tx_count} unconfirmed tx.` : "Nothing pending in the mempool.",
          `Lifetime: received ${(a.chain_stats.funded_txo_sum / 1e8).toFixed(8)} BTC, sent ${(a.chain_stats.spent_txo_sum / 1e8).toFixed(8)} BTC.`,
          out.explorer_url,
        ].join("\n");
        return text(md, out);
      } catch (e) {
        return fail(`Could not look up address: ${errMsg(e)}`);
      }
    },
  );

  server.registerTool(
    "bitcoin_price",
    {
      title: "Bitcoin price",
      description: "Free, read-only. Current BTC price in USD, EUR, GBP, CAD, CHF, AUD and JPY, plus sats per US dollar. Use it to convert between BTC, sats and fiat.",
      inputSchema: z.object({}).strict(),
      annotations: ro,
    },
    async () => {
      try {
        const px = await api.prices();
        const out = { ...px, sats_per_usd: Math.round(1e8 / px.USD), as_of: new Date(px.time * 1000).toISOString() };
        return text(`BTC = $${px.USD.toLocaleString("en-US")} (€${px.EUR.toLocaleString("en-US")}, £${px.GBP.toLocaleString("en-US")}). 1 USD = ${out.sats_per_usd} sats.`, out);
      } catch (e) {
        return fail(`Could not fetch price: ${errMsg(e)}`);
      }
    },
  );

  server.registerTool(
    "pay_bitcoin_on_base",
    {
      title: "Pay in Bitcoin on Base (cbBTC)",
      description:
        `Money tool. When on-chain Bitcoin fees make a small payment silly, settle it in Bitcoin on Base instead: prepares ONE unsigned cbBTC (Coinbase Wrapped BTC, 1:1 with BTC) transfer from the PayBox user's Base wallet to a 0x address, priced from the live BTC/USD rate. Give amount_usd or amount_btc, not both. Nothing is signed here: PayBox simulates the call and the user approves with their passkey (the wallet needs cbBTC and a little ETH on Base for gas). Show the user the recipient, BTC amount and USD value from this tool's text before they approve. Transfers above $${CAP_USD} are refused unless confirm_large is true and the user explicitly confirmed the amount. Run bitcoin_fee_recommendation first so the user sees what the same payment would cost on-chain.`,
      inputSchema: z
        .object({
          to: evmAddress.describe("Recipient 0x address on Base."),
          amount_usd: z.number().gt(0).max(1_000_000).optional().describe("Amount in US dollars, converted to BTC at the live price."),
          amount_btc: z.number().gt(0).max(21).optional().describe("Amount in BTC (up to 8 decimals)."),
          memo: z.string().max(140).optional().describe("What the payment is for."),
          confirm_large: z.boolean().optional().describe(`Only true if the user explicitly confirmed a transfer above $${CAP_USD}.`),
        })
        .strict(),
      outputSchema: evmOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ to, amount_usd, amount_btc, memo, confirm_large }) => {
      if ((amount_usd === undefined) === (amount_btc === undefined)) return fail("Give exactly one of amount_usd or amount_btc.");
      if (!isAddress(to)) return fail(`${to} is not a valid EVM address.`);
      const recipient = getAddress(to);
      if (recipient === CBBTC_BASE) return fail("Refused: the recipient is the cbBTC token contract itself.");
      let px: api.Prices;
      let rec: api.Recommended | null = null;
      try {
        [px, rec] = await Promise.all([api.prices(), api.recommended().catch(() => null)]);
      } catch (e) {
        return fail(`Could not fetch the BTC price to size the payment: ${errMsg(e)}`);
      }
      const sats = amount_btc !== undefined ? BigInt(Math.round(amount_btc * 1e8)) : BigInt(Math.round((amount_usd! / px.USD) * 1e8));
      if (sats <= 0n) return fail("Amount rounds to zero satoshis.");
      const valueUsd = Math.round(satsToUsd(Number(sats), px.USD) * 100) / 100;
      if (valueUsd > CAP_USD && !confirm_large) {
        return fail(`Refused: ${usd(valueUsd)} is above the $${CAP_USD} safety cap. Ask the user to confirm the exact amount, then retry with confirm_large: true.`);
      }
      const p = proposeEvm({ chain: BASE_CHAIN, to: CBBTC_BASE, value: "0", data: transferData(recipient, sats) });
      const onchain = rec ? ` For comparison, the same payment on Bitcoin mainnet would cost about ${usd(satsToUsd(rec.halfHourFee * TYPICAL_VBYTES, px.USD))} in miner fees right now (${rec.halfHourFee} sat/vB) versus a fraction of a cent in Base gas.` : "";
      p.content[0]!.text = `Prepared: send ${fmtBtc(sats)} (${usd(valueUsd)} at $${px.USD.toLocaleString("en-US")}/BTC) as cbBTC on Base to ${recipient}${memo ? ` for "${memo}"` : ""}. Unsigned transfer() call to the cbBTC contract ${CBBTC_BASE} (${BASESCAN_TOKEN}); review and approve it in PayBox with your passkey. Nothing has been signed or paid.${onchain}`;
      return p;
    },
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
