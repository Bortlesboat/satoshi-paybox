# Submission runbook (deadline: Sat Oct 17, 2026, 8:00 pm EDT)

Everything below is a human step. Budget 45 minutes; KYC can take longer, so start it first.

## 1. Register (do this first, in parallel with everything else)

1. Open https://developer.paybox.sh and click **Register with PayBox**.
2. Sign in to PayBox (Google / Apple / email) and enroll a passkey if prompted.
3. Complete MoonPay KYC if the portal asks. Winners must pass KYC/AML within five business days anyway.

## 2. Upload the plugin

1. Build artifact: `dist/plugin.mjs` in this repo (built in WSL2 with Node 24; `pnpm test` must say `"status":"passed"`).
2. In the portal, upload **only** `dist/plugin.mjs`.
3. **Test & configure → network hosts**: add exactly one host:
   - `mempool.space` — Bitcoin mempool, fee and price data
   No environment variables, no secrets.
4. Run the hosted checks.
5. **Test → Load tools**:
   - `bitcoin_fee_recommendation` with `{"urgency":"1_hour"}` (should return a SEND NOW / WAIT verdict)
   - `pay_bitcoin_on_base` with `{"to":"0x1111111111111111111111111111111111111111","amount_usd":1}` → choose **Validate transaction** with a Base wallet. Simulation only; nothing is sent. The wallet needs a little cbBTC for the simulation to pass; if it reverts for insufficient balance, that is expected and the proposal shape is still validated.
6. Fill in the listing: name **Satoshi**, tagline "Bitcoin fee intelligence for agents, settled on Base", category Consumer finance, repo link, demo video link (step 3).
7. Accept the MoonPay Hackathon Terms and click **Submit Project**.

## 3. Demo video (required, posted to X)

Script in `DEMO.md`. 30–45 seconds, screen recording of Claude.ai (or Grok) with the PayBox connector and Satoshi enabled under app.paybox.sh/plugins → Unofficial plugins. Post to X tagging @PayBox and @moonpay, include the repo link. Put the X post URL in the submission form.

## 4. After submitting

- Push the repo to GitHub (public, MIT): `Bortlesboat/satoshi-paybox`.
- Keep the plugin enabled so judges can run it. There is no server to keep alive; PayBox hosts the plugin and it only calls mempool.space.
