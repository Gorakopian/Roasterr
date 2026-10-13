// Timing mistakes ("fades"): sold too early, sold too late, held a round trip, bought the top.
// Uses free price history (candles) from GeckoTerminal, no API key needed.

const GT = "https://api.geckoterminal.com/api/v2";

// [timeframe, aggregate, seconds per candle]. We pick the finest one that covers buy → now in 1000 candles.
const FRAMES = [
  ["minute", 1, 60], ["minute", 5, 300], ["minute", 15, 900],
  ["hour", 1, 3600], ["hour", 4, 14400], ["day", 1, 86400],
];
export function pickFrame(spanSeconds) {
  for (const f of FRAMES) if (spanSeconds <= f[2] * 990) return f;
  return FRAMES[FRAMES.length - 1];
}

async function gt(path) {
  const res = await fetch(GT + path, { headers: { accept: "application/json" } });
  if (res.status === 429) throw new Error("gt_rate_limited");
  if (!res.ok) throw new Error(`gt_${res.status}`);
  return res.json();
}

/** Price candles (USD) for one coin, from its biggest pool. */
export async function fetchCandles(mint, fromTs, nowTs) {
  const pools = await gt(`/networks/solana/tokens/${mint}/pools?page=1`);
  const first = pools?.data?.[0];
  const pool = first?.attributes?.address || (first?.id || "").split("_")[1];
  if (!pool) return null;
  const [tf, agg, step] = pickFrame(nowTs - fromTs + 3600);
  const j = await gt(`/networks/solana/pools/${pool}/ohlcv/${tf}?aggregate=${agg}&limit=1000&currency=usd&token=${mint}`);
  const candles = (j?.data?.attributes?.ohlcv_list || [])
    .map((c) => ({ t: Number(c[0]), h: Number(c[2]), l: Number(c[3]), c: Number(c[4]) }))
    .filter((c) => c.t > 0 && c.h > 0 && c.c > 0)
    .sort((a, b) => a.t - b.t);
  return candles.length ? { step, candles } : null;
}

function priceAt(series, ts) {
  const { candles, step } = series;
  let best = null;
  for (const c of candles) {
    if (c.t <= ts) best = c;
    if (c.t > ts) break;
  }
  if (best && ts - best.t <= step * 3) return best.c;
  // no candle at that moment: take the nearest one
  let near = candles[0];
  for (const c of candles) if (Math.abs(c.t - ts) < Math.abs(near.t - ts)) near = c;
  return near.c;
}

function maxHigh(series, from, to) {
  let m = 0;
  for (const c of series.candles) if (c.t + series.step > from && c.t <= to && c.h > m) m = c.h;
  return m;
}

const fmtX = (x) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10) + "x";

/**
 * Judge one position against its price history.
 * @param {{symbol:string, firstBuy:number, lastSell:number|null, bought:number, sold:number, held:number, closed:boolean}} p
 * @param {{step:number, candles:{t:number,h:number,l:number,c:number}[]}} series
 * @param {number} nowTs
 * @returns {object[]} zero or more fades
 */
export function judgeTiming(p, series, nowTs) {
  if (!series || !series.candles.length || !p.firstBuy) return [];
  const out = [];
  const step = series.step;
  const buyPx = priceAt(series, p.firstBuy);
  const end = p.closed && p.lastSell ? p.lastSell : nowTs;
  const exitPx = p.closed && p.lastSell ? priceAt(series, p.lastSell) : series.candles[series.candles.length - 1].c;
  const peakHeld = Math.max(buyPx, maxHigh(series, p.firstBuy + step, end));
  if (!(buyPx > 0 && exitPx > 0)) return out;

  // Sold too early: it kept pumping after the sell
  if (p.closed && p.lastSell && p.sold > 0) {
    const peakAfter = maxHigh(series, p.lastSell + step, nowTs);
    if (peakAfter >= exitPx * 2) {
      out.push({
        symbol: p.symbol, kind: "sold_early",
        what: `sold, then it went ${fmtX(peakAfter / exitPx)} higher`,
        afterX: +(peakAfter / exitPx).toFixed(1),
        missedUsd: Math.round(p.sold * (peakAfter - exitPx)),
      });
    }
  }

  // Round trip: was up big while holding, then gave it all back
  if (peakHeld >= buyPx * 2 && exitPx <= peakHeld * 0.5) {
    const amount = p.closed ? p.sold : p.held;
    out.push({
      symbol: p.symbol, kind: p.closed ? "sold_late" : "held_too_long",
      what: p.closed
        ? `was up ${fmtX(peakHeld / buyPx)}, sold at ${fmtX(exitPx / buyPx)}`
        : `was up ${fmtX(peakHeld / buyPx)}, still holding at ${fmtX(exitPx / buyPx)}`,
      peakX: +(peakHeld / buyPx).toFixed(1),
      exitX: +(exitPx / buyPx).toFixed(2),
      gaveBackUsd: Math.round(amount * (peakHeld - exitPx)),
    });
  }

  // Bought the top: never went meaningfully higher after the buy, then dumped
  if (peakHeld <= buyPx * 1.15 && exitPx <= buyPx * 0.6) {
    out.push({
      symbol: p.symbol, kind: "bought_top",
      what: `bought the top, down ${Math.round((1 - exitPx / buyPx) * 100)}% from entry`,
      dropPct: Math.round((1 - exitPx / buyPx) * 100),
    });
  }
  return out;
}

const size = (f) => f.missedUsd || f.gaveBackUsd || (f.dropPct || 0);

/**
 * Check the biggest positions for timing mistakes.
 * Stops early (keeping what it has) if the price service rate-limits.
 */
export async function findFades(positions, meta, solPrice, { maxCoins = 6, nowTs = Math.floor(Date.now() / 1000) } = {}) {
  const sp = solPrice > 0 ? solPrice : 0;
  const ranked = positions
    .filter((p) => p.firstBuy)
    .map((p) => ({ p, cost: p.solIn + (sp ? p.usdIn / sp : 0) }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, maxCoins);

  const fades = [];
  for (const { p } of ranked) {
    const held = Math.max(0, p.bought - p.sold);
    const pos = {
      symbol: ((meta[p.mint] || {}).symbol || "").trim() || p.mint.slice(0, 4) + "…",
      firstBuy: p.firstBuy, lastSell: p.lastSell, bought: p.bought, sold: p.sold, held,
      closed: p.sells > 0 && held / (p.bought || 1) < 0.01,
    };
    try {
      const series = await fetchCandles(p.mint, p.firstBuy, nowTs);
      fades.push(...judgeTiming(pos, series, nowTs));
    } catch (e) {
      if (String(e.message).includes("rate_limited")) break;
    }
  }
  return fades.sort((a, b) => size(b) - size(a)).slice(0, 5);
}
