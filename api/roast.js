// POST /api/roast  { address, heat }  →  { stats, roast, demo }
import { isSolanaAddress, buildPositions, summarize } from "../lib/analyze.js";
import { fetchHistory, fetchTokenInfo, fetchSolPrice } from "../lib/helius.js";
import { roastWithClaude, templateRoast } from "../lib/roast.js";
import { findFades } from "../lib/timing.js";
import { DEMO_STATS } from "../lib/demo.js";

const cache = new Map(); // address -> { at, stats }  (lives as long as the server instance)
const TTL = 10 * 60 * 1000;
const HEATS = new Set(["mild", "spicy", "nuclear"]);

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(data));
}

export async function getStats(address, heliusKey) {
  const hit = cache.get(address);
  if (hit && Date.now() - hit.at < TTL) return hit.stats;
  const txs = await fetchHistory(address, heliusKey, Number(process.env.HISTORY_PAGES) || 5);
  const built = buildPositions(txs, address);
  const info = await fetchTokenInfo(built.positions.map((p) => p.mint), heliusKey);
  const solPrice = await fetchSolPrice(heliusKey, info);
  const stats = summarize(built, info, solPrice, address);
  // Timing mistakes need price history; give it at most 25 seconds, the roast works without it
  const timeout = new Promise((resolve) => setTimeout(() => resolve([]), 25000));
  stats.fades = await Promise.race([findFades(built.positions, info, solPrice).catch(() => []), timeout]);
  cache.set(address, { at: Date.now(), stats });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return stats;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const body = await readBody(req);
  const address = String(body.address || "").trim();
  const heat = HEATS.has(body.heat) ? body.heat : "spicy";

  const heliusKey = process.env.HELIUS_API_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ROAST_MODEL || "claude-sonnet-5-5";
  const demo = !heliusKey;

  if (!demo && !isSolanaAddress(address)) {
    return send(res, 400, { error: "That doesn't look like a Solana wallet address. It should be 32 to 44 letters and numbers." });
  }

  let stats;
  if (demo) {
    stats = { ...DEMO_STATS, wallet: address || DEMO_STATS.wallet, walletShort: address ? address.slice(0, 4) + "…" + address.slice(-4) : DEMO_STATS.walletShort };
  } else {
    try {
      stats = await getStats(address, heliusKey);
    } catch (e) {
      const msg = String(e.message || e);
      if (msg === "rate_limited") return send(res, 429, { error: "Too many people getting roasted right now. Try again in a minute." });
      return send(res, 502, { error: "Couldn't read that wallet right now. Check the address and try again." });
    }
    if (!stats.trades) {
      return send(res, 404, { error: "No memecoin trades found in this wallet's recent history. Either you're clean or you're hiding the real wallet." });
    }
  }

  let roast;
  let usedClaude = false;
  if (claudeKey) {
    try { roast = await roastWithClaude(stats, heat, claudeKey, model); usedClaude = true; }
    catch { roast = templateRoast(stats); }
  } else {
    roast = templateRoast(stats);
  }

  return send(res, 200, { stats, roast, demo, ai: usedClaude });
}
