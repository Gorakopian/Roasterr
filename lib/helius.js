// Data fetching: wallet history and token info from Helius, SOL price from Jupiter.
import { WSOL } from "./analyze.js";

const BASE = "https://mainnet.helius-rpc.com";

/** Up to `pages` x 100 most recent transactions for a wallet. */
export async function fetchHistory(address, apiKey, pages = 5) {
  const all = [];
  let before = null;
  for (let i = 0; i < pages; i++) {
    const url = new URL(`${BASE}/v0/addresses/${address}/transactions`);
    url.searchParams.set("api-key", apiKey);
    url.searchParams.set("limit", "100");
    if (before) url.searchParams.set("before-signature", before);
    const res = await fetch(url);
    if (res.status === 429) throw new Error("rate_limited");
    if (!res.ok) {
      if (i > 0) break; // keep what we already have
      throw new Error(`helius_${res.status}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    before = batch[batch.length - 1].signature;
    if (batch.length < 100) break;
  }
  return all;
}

/** Symbols and current USD prices for up to 100 mints. */
export async function fetchTokenInfo(mints, apiKey) {
  const out = {};
  const ids = [...new Set(mints)].slice(0, 100);
  if (!ids.length) return out;
  const res = await fetch(`${BASE}/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "roaster", method: "getAssetBatch", params: { ids } }),
  });
  if (!res.ok) return out;
  const json = await res.json();
  for (const a of json.result || []) {
    if (!a || !a.id) continue;
    const ti = a.token_info || {};
    out[a.id] = {
      symbol: ti.symbol || a.content?.metadata?.symbol || "",
      name: a.content?.metadata?.name || "",
      price: ti.price_info?.price_per_token ?? null,
    };
  }
  return out;
}

/** Current USD prices from Jupiter (covers most memecoins, unlike Helius). Returns {mint: price}. */
export async function fetchJupiterPrices(mints) {
  const out = {};
  const ids = [...new Set(mints)];
  for (let i = 0; i < ids.length; i += 50) {
    try {
      const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${ids.slice(i, i + 50).join(",")}`);
      if (!res.ok) continue;
      const j = await res.json();
      for (const [mint, v] of Object.entries(j || {})) {
        const p = Number(v?.usdPrice);
        if (p > 0) out[mint] = p;
      }
    } catch { /* keep going */ }
  }
  return out;
}

/** USD price of SOL. Tries Jupiter, then Helius token info. */
export async function fetchSolPrice(apiKey, tokenInfo) {
  try {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${WSOL}`);
    if (res.ok) {
      const j = await res.json();
      const p = Number(j?.[WSOL]?.usdPrice);
      if (p > 0) return p;
    }
  } catch { /* fall through */ }
  const fromHelius = tokenInfo?.[WSOL]?.price;
  if (fromHelius > 0) return fromHelius;
  try {
    const info = await fetchTokenInfo([WSOL], apiKey);
    if (info[WSOL]?.price > 0) return info[WSOL].price;
  } catch { /* ignore */ }
  return null;
}
