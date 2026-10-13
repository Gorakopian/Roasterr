// Run with: node test/timing.test.js
import assert from "node:assert/strict";
import { judgeTiming, pickFrame } from "../lib/timing.js";

const step = 60;
const T0 = 1_760_000_000;
// Build a 1-minute price series from a list of closes
const series = (closes) => ({ step, candles: closes.map((c, i) => ({ t: T0 + i * step, h: c, l: c, c })) });
const kinds = (f) => f.map((x) => x.kind).sort();

// Sold too early: bought at 1, sold at 1.5, it later hit 10
let s = series([1, 1.2, 1.5, 3, 6, 10, 8]);
let f = judgeTiming({ symbol: "EARLY", firstBuy: T0, lastSell: T0 + 2 * step, bought: 100, sold: 100, held: 0, closed: true }, s, T0 + 6 * step);
assert.deepEqual(kinds(f), ["sold_early"]);
assert.equal(f[0].missedUsd, Math.round(100 * (10 - 1.5)));

// Sold too late: bought at 1, peaked at 5, sold at 0.8
s = series([1, 2, 5, 3, 0.8, 0.7]);
f = judgeTiming({ symbol: "LATE", firstBuy: T0, lastSell: T0 + 4 * step, bought: 10, sold: 10, held: 0, closed: true }, s, T0 + 5 * step);
assert.deepEqual(kinds(f), ["sold_late"]);
assert.equal(f[0].peakX, 5);

// Still holding after a round trip
f = judgeTiming({ symbol: "BAG", firstBuy: T0, lastSell: null, bought: 10, sold: 0, held: 10, closed: false }, s, T0 + 5 * step);
assert.deepEqual(kinds(f), ["held_too_long"]);

// Bought the top
s = series([2, 1.5, 0.9, 0.4]);
f = judgeTiming({ symbol: "TOP", firstBuy: T0, lastSell: T0 + 3 * step, bought: 10, sold: 10, held: 0, closed: true }, s, T0 + 3 * step);
assert.deepEqual(kinds(f), ["bought_top"]);
assert.equal(f[0].dropPct, 80);

// A clean trade gives no fades
s = series([1, 1.5, 2.5, 2.4, 2.3]);
f = judgeTiming({ symbol: "OK", firstBuy: T0, lastSell: T0 + 2 * step, bought: 10, sold: 10, held: 0, closed: true }, s, T0 + 4 * step);
assert.deepEqual(f, []);

// End to end with a fake GeckoTerminal: pool lookup + candles → a sold_early fade
const MINT = "MintAAAA1111111111111111111111111111111111";
const calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  const body = String(url).includes("/tokens/multi/")
    ? { data: [{ id: "solana_" + MINT, attributes: { address: MINT, price_usd: "9.5" }, relationships: { top_pools: { data: [{ id: "solana_PoolXYZ", type: "pool" }] } } }] }
    : { data: { attributes: { ohlcv_list: [[T0 + 120, 1.5, 1.5, 1.5, 1.5, 1], [T0, 1, 1, 1, 1, 1], [T0 + 60, 1.2, 1.2, 1.2, 1.2, 1], [T0 + 180, 3, 10, 3, 9, 1]] } } };
  return { ok: true, status: 200, json: async () => body };
};
const { fetchTokensMulti, findFades } = await import("../lib/timing.js");
const pools = await fetchTokensMulti([MINT]);
assert.deepEqual(pools[MINT], { pool: "PoolXYZ", priceUsd: 9.5 });
const debug = {};
const got = await findFades(
  [{ mint: MINT, firstBuy: T0, lastSell: T0 + 120, bought: 100, sold: 100, sells: 1, solIn: 1, usdIn: 0 }],
  { [MINT]: { symbol: "AAA" } }, 150, { pools, debug, nowTs: T0 + 240 });
assert.equal(got[0].kind, "sold_early");
assert.equal(debug.checked, 1);
assert.ok(calls.some((u) => u.includes("/pools/PoolXYZ/ohlcv/minute?aggregate=1")));

assert.deepEqual(pickFrame(3600).slice(0, 2), ["minute", 1]);
assert.deepEqual(pickFrame(86400 * 30).slice(0, 2), ["hour", 1]);
console.log("timing OK");
