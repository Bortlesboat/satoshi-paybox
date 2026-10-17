import { encodeFunctionData, getAddress, parseAbi, type Address } from "viem";

/** Coinbase Wrapped BTC on Base mainnet (8 decimals, 1 cbBTC = 1 BTC). */
export const CBBTC_BASE = getAddress("0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf");
export const BASE_CHAIN = "eip155:8453";
export const CAP_USD = 500; // refuse above this unless the user explicitly confirmed
export const BASESCAN_TOKEN = `https://basescan.org/token/${CBBTC_BASE}`;

export const transferData = (to: Address, sats: bigint) =>
  encodeFunctionData({
    abi: parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]),
    functionName: "transfer",
    args: [to, sats],
  });

export const fmtBtc = (sats: bigint) => `${(Number(sats) / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} BTC`;
