/** Thin client for the public mempool.space REST API (no key, single outbound host). */
export const MEMPOOL = "https://mempool.space";
const TIMEOUT_MS = 4000;

export type Recommended = { fastestFee: number; halfHourFee: number; hourFee: number; economyFee: number; minimumFee: number };
export type MempoolBlock = { blockSize: number; blockVSize: number; nTx: number; totalFees: number; medianFee: number; feeRange: number[] };
export type MempoolInfo = { count: number; vsize: number; total_fee: number; fee_histogram: [number, number][] };
export type Prices = { time: number; USD: number; EUR: number; GBP: number; CAD: number; CHF: number; AUD: number; JPY: number };
export type TxStatus = { confirmed: boolean; block_height?: number; block_hash?: string; block_time?: number };
export type Tx = { txid: string; fee: number; weight: number; size: number; status: TxStatus; vin: unknown[]; vout: { value: number }[] };
export type AddressStats = { funded_txo_count: number; funded_txo_sum: number; spent_txo_count: number; spent_txo_sum: number; tx_count: number };
export type AddressInfo = { address: string; chain_stats: AddressStats; mempool_stats: AddressStats };
export type Difficulty = { progressPercent: number; difficultyChange: number; estimatedRetargetDate: number; remainingBlocks: number; nextRetargetHeight: number };

async function request(path: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${MEMPOOL}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new Error(`mempool.space unreachable (${e instanceof Error ? e.message : "network error"}). Try again in a moment.`);
  }
  if (res.status === 404) throw new Error(`mempool.space has no record of ${path.split("/").pop() ?? path}.`);
  if (!res.ok) throw new Error(`mempool.space returned HTTP ${res.status} for ${path}.`);
  return res;
}

export async function getJson<T>(path: string): Promise<T> {
  return (await (await request(path)).json()) as T;
}

export async function getText(path: string): Promise<string> {
  return (await request(path)).text();
}

export const recommended = () => getJson<Recommended>("/api/v1/fees/recommended");
export const mempoolBlocks = () => getJson<MempoolBlock[]>("/api/v1/fees/mempool-blocks");
export const mempoolInfo = () => getJson<MempoolInfo>("/api/mempool");
export const prices = () => getJson<Prices>("/api/v1/prices");
export const difficulty = () => getJson<Difficulty>("/api/v1/difficulty-adjustment");
export const tipHeight = async () => Number.parseInt(await getText("/api/blocks/tip/height"), 10);
export const tx = (txid: string) => getJson<Tx>(`/api/tx/${txid}`);
export const address = (addr: string) => getJson<AddressInfo>(`/api/address/${addr}`);
