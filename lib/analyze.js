// Turns a Solana wallet's transaction history into roastable trading stats.
// Works on Helius "enhanced transactions": for every transaction we look at how
// the wallet's SOL (and USDC/USDT) balance moved against one memecoin's balance.

export const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const STABLES = new Set([USDC, USDT]);
const QUOTES = new Set([WSOL, USDC, USDT]);
const SOL_NOISE = 0.0005; // smaller SOL moves are fees/rent, not trades

export function isSolanaAddress(s) {
  return typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
}

/** Reduce one enhanced transaction to the wallet's balance changes. */
function walletDeltas(tx, wallet) {
  let sol = 0;
  const tokens = new Map();
  for (const acc of tx.accountData || []) {
    if (acc.account === wallet) sol += (Number(acc.nativeBalanceChange) || 0) / 1e9;
    for (const ch of acc.tokenBalanceChanges || []) {
      if (ch.userAccount !== wallet) continue;
      const raw = ch.rawTokenAmount || {};
      const amt = Number(raw.tokenAmount) / Math.pow(10, Number(raw.decimals) || 0);
      if (!Number.isFinite(amt) || amt === 0) continue;
      tokens.set(ch.mint, (tokens.get(ch.mint) || 0) + amt);
    }
  }
  sol += tokens.get(WSOL) || 0;
  let usd = 0;
  for (const m of STABLES) usd += tokens.get(m) || 0;
  const coins = [...tokens.entries()].filter(([m, a]) => !QUOTES.has(m) && Math.abs(a) > 0);
  return { sol, usd, coins };
}

/**
 * Build positions from raw transactions.
 * @param {object[]} txs Helius enhanced transactions (any order)
 * @param {string} wallet the wallet address
 */
export function buildPositions(txs, wallet) {
  const sorted = [...txs].filter(t => t && !t.transactionError).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const positions = new Map();
  let feesSol = 0, swaps = 0;
  const buysPerDay = new Map();
  const hours = new Array(24).fill(0);

  for (const tx of sorted) {
    if (tx.feePayer === wallet) feesSol += (Number(tx.fee) || 0) / 1e9;
    const { sol, usd, coins } = walletDeltas(tx, wallet);
    if (coins.length !== 1) continue; // token-to-token or plain transfers: skip
    const [mint, amount] = coins[0];
    const quoteMoved = Math.abs(sol) > SOL_NOISE || Math.abs(usd) > 0.01;
    if (!quoteMoved) continue; // airdrop / transfer, not a trade
    const isBuy = amount > 0 && (sol < 0 || usd < 0);
    const isSell = amount < 0 && (sol > 0 || usd > 0);
    if (!isBuy && !isSell) continue;

    swaps++;
    const p = positions.get(mint) || {
      mint, buys: 0, sells: 0, solIn: 0, solOut: 0, usdIn: 0, usdOut: 0,
      bought: 0, sold: 0, firstBuy: null, lastSell: null, lastTs: null,
    };
    const ts = tx.timestamp || 0;
    if (isBuy) {
      p.buys++; p.bought += amount; p.solIn += Math.max(0, -sol); p.usdIn += Math.max(0, -usd);
      if (p.firstBuy === null) p.firstBuy = ts;
      const day = new Date(ts * 1000).toISOString().slice(0, 10);
      buysPerDay.set(day, (buysPerDay.get(day) || 0) + 1);
    } else {
      p.sells++; p.sold += -amount; p.solOut += Math.max(0, sol); p.usdOut += Math.max(0, usd);
      p.lastSell = ts;
    }
    p.lastTs = ts;
    hours[new Date(ts * 1000).getUTCHours()]++;
    positions.set(mint, p);
  }

  let busiestDay = null;
  for (const [day, n] of buysPerDay) if (!busiestDay || n > busiestDay.buys) busiestDay = { day, buys: n };
  const first = sorted.length ? sorted[0].timestamp : null;
  const last = sorted.length ? sorted[sorted.length - 1].timestamp : null;
  return { positions: [...positions.values()], feesSol, swaps, busiestDay, hours, first, last, scanned: sorted.length };
}

function fmtDuration(sec) {
  if (sec == null || sec < 0) return null;
  if (sec < 90) return `${Math.round(sec)} seconds`;
  if (sec < 5400) return `${Math.round(sec / 60)} minutes`;
  if (sec < 172800) return `${Math.round(sec / 3600)} hours`;
  return `${Math.round(sec / 86400)} days`;
}

/**
 * Price the positions and produce the stats the roast and the receipt use.
 * @param {ReturnType<typeof buildPositions>} built
 * @param {{[mint:string]:{symbol?:string,name?:string,price?:number|null}}} meta
 * @param {number|null} solPrice USD per SOL
 */
export function summarize(built, meta, solPrice, wallet) {
  const sp = solPrice && solPrice > 0 ? solPrice : null;
  const toSol = (usd) => (sp ? usd / sp : 0);
  const rows = built.positions.map((p) => {
    const m = meta[p.mint] || {};
    const price = typeof m.price === "number" && m.price > 0 ? m.price : null;
    const held = Math.max(0, p.bought - p.sold);
    const heldShare = p.bought > 0 ? held / p.bought : 0;
    const costSol = p.solIn + toSol(p.usdIn);
    const proceedsSol = p.solOut + toSol(p.usdOut);
    const heldValueSol = price && sp ? (held * price) / sp : 0;
    const pnlSol = proceedsSol + heldValueSol - costSol;
    const closed = heldShare < 0.01 && p.sells > 0;
    const status = closed ? "sold" : heldValueSol < costSol * 0.05 ? "rugged" : "holding";
    // Sold, and the coin is now worth far more than what they got for it
    const soldNowSol = price && sp ? (p.sold * price) / sp : 0;
    const missedSol = p.sells > 0 && soldNowSol > proceedsSol * 2 ? soldNowSol - proceedsSol : 0;
    return {
      mint: p.mint,
      symbol: (m.symbol || "").trim() || p.mint.slice(0, 4) + "…",
      buys: p.buys, sells: p.sells,
      costSol, proceedsSol, heldValueSol, pnlSol,
      pnlUsd: sp ? pnlSol * sp : null,
      multiple: costSol > 0 ? (proceedsSol + heldValueSol) / costSol : null,
      status,
      holdSeconds: closed && p.firstBuy != null && p.lastSell != null ? p.lastSell - p.firstBuy : null,
      missedSol,
    };
  }).filter(r => r.costSol > 0.0005 || r.proceedsSol > 0.0005);

  const byPnl = [...rows].sort((a, b) => b.pnlSol - a.pnlSol);
  const winners = rows.filter(r => r.pnlSol > 0);
  const totalPnlSol = rows.reduce((s, r) => s + r.pnlSol, 0);
  const flips = rows.filter(r => r.holdSeconds != null).sort((a, b) => a.holdSeconds - b.holdSeconds);
  const holds = flips.map(r => r.holdSeconds).sort((a, b) => a - b);
  const medianHold = holds.length ? holds[Math.floor(holds.length / 2)] : null;
  const paper = rows.filter(r => r.missedSol > 0).sort((a, b) => b.missedSol - a.missedSol)[0] || null;
  const rugged = rows.filter(r => r.status === "rugged");
  const bags = rows.filter(r => r.status === "holding").sort((a, b) => b.heldValueSol - a.heldValueSol);
  const night = built.hours.slice(0, 5).reduce((a, b) => a + b, 0);
  const totalHours = built.hours.reduce((a, b) => a + b, 0);

  const usd = (sol) => (sp ? Math.round(sol * sp) : null);
  const pick = (r) => r && {
    symbol: r.symbol, pnlSol: +r.pnlSol.toFixed(3), pnlUsd: usd(r.pnlSol),
    multiple: r.multiple != null ? +r.multiple.toFixed(2) : null, status: r.status,
    held: fmtDuration(r.holdSeconds),
  };

  return {
    wallet,
    walletShort: wallet.slice(0, 4) + "…" + wallet.slice(-4),
    period: built.first && built.last ? {
      from: new Date(built.first * 1000).toISOString().slice(0, 10),
      to: new Date(built.last * 1000).toISOString().slice(0, 10),
    } : null,
    scannedTransactions: built.scanned,
    trades: built.swaps,
    coinsTraded: rows.length,
    winners: winners.length,
    losers: rows.length - winners.length,
    winRate: rows.length ? Math.round((winners.length / rows.length) * 100) : 0,
    totalPnlSol: +totalPnlSol.toFixed(3),
    totalPnlUsd: usd(totalPnlSol),
    solPrice: sp,
    feesSol: +built.feesSol.toFixed(4),
    feesUsd: usd(built.feesSol),
    biggestWin: winners.length ? pick(byPnl[0]) : null,
    biggestLoss: byPnl.length && byPnl[byPnl.length - 1].pnlSol < 0 ? pick(byPnl[byPnl.length - 1]) : null,
    fastestFlip: flips[0] ? { ...pick(flips[0]) } : null,
    medianHold: fmtDuration(medianHold),
    paperHands: paper ? { symbol: paper.symbol, soldForSol: +paper.proceedsSol.toFixed(3), wouldBeWorthSol: +(paper.proceedsSol + paper.missedSol).toFixed(3), missedUsd: usd(paper.missedSol) } : null,
    ruggedCount: rugged.length,
    ruggedLostSol: +rugged.reduce((s, r) => s - r.pnlSol, 0).toFixed(3),
    bagsHeld: bags.slice(0, 3).map(pick),
    busiestDay: built.busiestDay,
    nightOwlShare: totalHours ? Math.round((night / totalHours) * 100) : 0, // share of trades 00:00-05:00 UTC
    receipt: [...rows].sort((a, b) => Math.abs(b.pnlSol) - Math.abs(a.pnlSol)).slice(0, 7).map(pick),
  };
}
