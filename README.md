# Satoshi: Bitcoin fee intelligence for agents, settled on Base

A PayBox marketplace plugin built for MoonPay Hackathons, PayBox Chapter 1 (Oct 16–17, 2026). Category: Consumer finance.

Ask your agent "should I send this Bitcoin now?" and Satoshi reads the live mempool, prices every fee tier in sats and dollars, and answers **SEND NOW** or **WAIT** with the exact savings from waiting. When on-chain fees make a small payment silly, the agent can settle it as Bitcoin on Base (cbBTC) instead, with one passkey tap in PayBox.

Satoshi never holds money and never signs. The one money tool returns an unsigned proposal that PayBox validates, simulates, and asks the user to approve.

## Tools

| Tool | Cost | What it does |
|---|---|---|
| `bitcoin_fee_recommendation` | free | Live sat/vB for the requested urgency, cost in sats and USD for your transaction size, every tier, mempool depth, and a SEND NOW / WAIT verdict with savings. |
| `bitcoin_mempool_snapshot` | free | Chain height, unconfirmed tx count, MB queued, blocks to clear, projected next-block fees, BTC price, difficulty progress. |
| `bitcoin_tx_status` | free | Confirmations, block, fee and fee rate for a txid. For unconfirmed txs, blocks until it mines or a "stuck" flag. |
| `bitcoin_address_overview` | free | Confirmed and pending balance of a Bitcoin address in BTC and USD, lifetime received and sent, tx count. |
| `bitcoin_price` | free | BTC in seven fiat currencies plus sats per dollar. |
| `pay_bitcoin_on_base` | money tool | Prepares ONE unsigned cbBTC transfer on Base (`eip155:8453`) sized from the live BTC price. Refuses above $500 unless `confirm_large: true`. Shows what the same payment would cost on-chain. |

Data source: the public mempool.space API (single outbound host, no key). cbBTC on Base: `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` (8 decimals).

## Example prompts

- "Is now a good time to send Bitcoin, or should I wait an hour?"
- "How busy is the Bitcoin network right now?"
- "Did transaction f4184fc5… confirm? Is it stuck?"
- "What's the balance of bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?"
- "Fees are high. Pay Sam $25 in Bitcoin on Base instead: 0x1111…1111."

## How the money tool works

1. `pay_bitcoin_on_base` takes a recipient and either `amount_usd` or `amount_btc`.
2. It fetches the live BTC price, converts to satoshis, and encodes `transfer(to, amount)` on the cbBTC contract.
3. It returns an `io.paybox/transactionProposal` (`kind: "evm"`, `chain: "eip155:8453"`). The text tells the user the BTC amount, USD value, recipient, and the on-chain fee they avoided.
4. PayBox simulates the call and asks for the user's passkey. The plugin never sees a key.

## Develop

Requires Node 24 and pnpm 11.11.0 (PayBox plugin starter v1.0.2, protocol `2026-07-28`). On Windows use WSL2.

```bash
pnpm install
pnpm unit                      # fee-logic unit tests
pnpm test                      # typecheck + deterministic build + PayBox conformance → dist/plugin.mjs
node scripts/call.mjs list
node scripts/call.mjs bitcoin_fee_recommendation '{"urgency":"1_hour"}'
node scripts/call.mjs pay_bitcoin_on_base '{"to":"0x1111111111111111111111111111111111111111","amount_usd":25}'
```

## Upload to PayBox

1. `pnpm install --frozen-lockfile && pnpm test` must print `"status":"passed"`.
2. In the developer portal (https://developer.paybox.sh), Register with PayBox and upload only `dist/plugin.mjs`.
3. Under Test & configure, network hosts: add exactly `mempool.space` (Bitcoin mempool, fee and price data). No variables or secrets.
4. Run the hosted checks. Under Test, load tools and run `bitcoin_fee_recommendation` with `{"urgency":"1_hour"}`, then `pay_bitcoin_on_base` with `{"to":"0x1111111111111111111111111111111111111111","amount_usd":1}` and choose Validate transaction with a Base wallet (simulation only).
5. Accept the hackathon terms and Submit Project. Afterwards enable Satoshi under Unofficial plugins at app.paybox.sh/plugins to use it with your agent.

## License

MIT
