// Writes the roast. Uses Claude when ANTHROPIC_API_KEY is set, otherwise a
// built-in template roast so the site still works while you set things up.

const HEAT = {
  mild: "Mild: playful teasing, like friends at a bar.",
  spicy: "Spicy: sharp and savage, but clever.",
  nuclear: "Nuclear: brutal, zero mercy toward the TRADES, maximum disrespect for the decisions.",
};

export function buildPrompt(stats, heat) {
  return `You are ROASTER, a stand-up comedian who roasts memecoin traders using their real on-chain trading data.

Rules:
- Roast only the trading: entries, exits, hold times, rugs, bags, fees, paper hands, timing, win rate.
- Never mention appearance, nationality, ethnicity, religion, gender, sexuality, health, family or anything outside the trades. No slurs, no threats.
- Use memecoin slang naturally: aped, paper hands, diamond hands, rugged, exit liquidity, bagholder, jeet, cooked, ngmi, top blast, chart, mcap.
- Use the real tickers and numbers from the data so it feels personal. Pick the most embarrassing facts.
- Each roast line is at most 25 words and lands its punchline at the end.
- Heat level: ${HEAT[heat] || HEAT.spicy}

Wallet stats (JSON, PnL in SOL and USD, hold times for fully sold coins):
${JSON.stringify(stats)}

Reply with only this JSON, nothing else:
{"score": integer 0-100 (how degenerate this trading is), "archetype": "a 2-4 word trader title", "stamp": "1-2 words in capitals for a rubber stamp, like REKT, COOKED, NGMI, EXIT LIQUIDITY", "lines": ["exactly 4 roast lines"], "tip": "one genuinely useful trading lesson based on their actual mistakes, max 18 words"}`;
}

function parseJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function clean(r) {
  if (!r || !Array.isArray(r.lines)) return null;
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 50))),
    archetype: String(r.archetype || "Unclassified Degen").slice(0, 60),
    stamp: String(r.stamp || "REKT").toUpperCase().slice(0, 24),
    lines: r.lines.slice(0, 5).map((l) => String(l).slice(0, 220)),
    tip: String(r.tip || "").slice(0, 200),
  };
}

export async function roastWithClaude(stats, heat, apiKey, model) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      messages: [{ role: "user", content: buildPrompt(stats, heat) }],
    }),
  });
  if (!res.ok) throw new Error(`claude_${res.status}`);
  const json = await res.json();
  const text = (json.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  const roast = clean(parseJson(text));
  if (!roast) throw new Error("claude_bad_json");
  return roast;
}

/** Template roast from the stats alone. Used when no Claude key is set or Claude fails. */
export function templateRoast(s) {
  const lines = [];
  if (s.paperHands) lines.push(`You sold $${s.paperHands.symbol} for ${s.paperHands.soldForSol} SOL. It would be worth ${s.paperHands.wouldBeWorthSol} SOL now. Paper hands made of tissue.`);
  if (s.fastestFlip?.held) lines.push(`You held $${s.fastestFlip.symbol} for ${s.fastestFlip.held}. Goldfish have longer commitments.`);
  if (s.ruggedCount) lines.push(`${s.ruggedCount} of your coins are basically dead. You're not a trader, you're a funeral home.`);
  if (s.biggestLoss) lines.push(`$${s.biggestLoss.symbol} took ${Math.abs(s.biggestLoss.pnlSol)} SOL off you. Someone bought a nice dinner with your exit liquidity.`);
  if (s.busiestDay?.buys >= 5) lines.push(`${s.busiestDay.buys} buys on ${s.busiestDay.day}. That's not research, that's a slot machine with extra steps.`);
  if (lines.length < 4) lines.push(`Win rate ${s.winRate}%. A coin flip is genuinely trying to be your mentor.`);
  if (lines.length < 4) lines.push(`Net result ${s.totalPnlSol} SOL across ${s.coinsTraded} coins. The chart saw you coming.`);
  const score = Math.min(100, 35 + s.coinsTraded * 2 + s.ruggedCount * 6 + (s.paperHands ? 10 : 0) + (s.winRate < 40 ? 10 : 0));
  return {
    score,
    archetype: s.totalPnlSol < 0 ? "Professional Exit Liquidity" : "Lucky Coin Flipper",
    stamp: s.totalPnlSol < 0 ? "COOKED" : "LUCKY",
    lines: lines.slice(0, 4),
    tip: s.paperHands ? "Sell half on the first 2x and let the rest ride." : "Size smaller. Most new coins go to zero, plan for that.",
  };
}
