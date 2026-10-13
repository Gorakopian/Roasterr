// Run with: node test/analyze.test.js
import assert from "node:assert/strict";
import { buildPositions, summarize, isSolanaAddress, WSOL } from "../lib/analyze.js";

const W = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const GOB = "GoBLinMint1111111111111111111111111111111111";
const DED = "DeadCoinMint111111111111111111111111111111111";
const BAG = "BagCoinMint1111111111111111111111111111111111";
let t = 1_760_000_000;

// A swap: wallet SOL changes by `sol`, wallet token balance changes by `tok`
function swap(mint, sol, tok, dt = 60, viaWsol = false) {
  t += dt;
  const accountData = [
    { account: W, nativeBalanceChange: viaWsol ? -5000 : Math.round(sol * 1e9) - 5000, tokenBalanceChanges: [] },
    { account: "ata", nativeBalanceChange: 0, tokenBalanceChanges: [
      { userAccount: W, mint, rawTokenAmount: { tokenAmount: String(Math.round(tok * 1e6)), decimals: 6 } },
    ] },
  ];
  if (viaWsol) accountData[1].tokenBalanceChanges.push({ userAccount: W, mint: WSOL, rawTokenAmount: { tokenAmount: String(Math.round(sol * 1e9)), decimals: 9 } });
  return { signature: "s" + t, timestamp: t, fee: 5000, feePayer: W, accountData };
}

const txs = [
  swap(GOB, -1, 1_000_000),          // buy GOB for 1 SOL
  swap(GOB, 1.3, -1_000_000, 45),    // sell 45s later for 1.3 SOL
  swap(DED, -2, 500_000, 3600),      // buy DED for 2 SOL, never sold
  swap(BAG, -0.5, 100_000, 60, true),// buy BAG via wrapped SOL
  { signature: "airdrop", timestamp: t + 10, fee: 5000, feePayer: "other", accountData: [
    { account: W, nativeBalanceChange: 0, tokenBalanceChanges: [{ userAccount: W, mint: "Spam", rawTokenAmount: { tokenAmount: "100", decimals: 0 } }] },
  ] },
];

const built = buildPositions(txs.reverse(), W);
assert.equal(built.swaps, 4, "four trades");
assert.equal(built.positions.length, 3, "airdrop ignored");
const gob = built.positions.find(p => p.mint === GOB);
assert.ok(Math.abs(gob.solIn - 1.000005) < 1e-6 && Math.abs(gob.solOut - 1.299995) < 1e-6, "SOL in/out incl. fee");
const bag = built.positions.find(p => p.mint === BAG);
assert.ok(Math.abs(bag.solIn - 0.500005) < 1e-6, "wrapped SOL counted");

const meta = {
  [GOB]: { symbol: "GOBLIN", price: 0.002 },   // 1M sold now worth $2000 → paper hands
  [DED]: { symbol: "DEAD", price: 0.0000001 }, // worthless → rugged
  [BAG]: { symbol: "BAG", price: 0.001 },      // 100k * 0.001 = $100 held
};
const s = summarize(built, meta, 150, W);
assert.equal(s.coinsTraded, 3);
assert.equal(s.ruggedCount, 1);
assert.equal(s.fastestFlip.symbol, "GOBLIN");
assert.equal(s.fastestFlip.held, "45 seconds");
assert.equal(s.paperHands.symbol, "GOBLIN");
assert.equal(s.bagsHeld[0].symbol, "BAG");
assert.equal(s.biggestLoss.symbol, "DEAD");
assert.ok(isSolanaAddress(W) && !isSolanaAddress("0xabc") && !isSolanaAddress("hello"));
console.log("analyze OK");
console.log(JSON.stringify(s, null, 2));
