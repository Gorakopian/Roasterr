# Roaster

Paste a Solana wallet address, Roaster reads its memecoin trades and roasts you for them on a shareable receipt.

## What's inside

| File | What it does |
|---|---|
| `index.html` | The website: wallet box, heat level, the receipt card, save image, post on X |
| `api/roast.js` | The server part: reads the wallet, works out the stats, asks Claude for the roast |
| `lib/analyze.js` | Turns raw transactions into profit/loss per coin, hold times, rugs, paper hands |
| `lib/helius.js` | Fetches the wallet history, token names and prices |
| `lib/roast.js` | The roast prompt for Claude, plus a backup roast if Claude isn't set up |
| `lib/demo.js` | Fake wallet used in demo mode |
| `server.js` | Lets you run it on your own computer |

## The two keys you need

1. **Helius** (reads the blockchain). Sign up at helius.dev, the free plan is enough to start. Copy your API key from the dashboard.
2. **Anthropic** (writes the roast). Go to console.anthropic.com, add some credit, create an API key. Each roast is one short request, so the cost per roast is very small. Check the pricing page there for the exact rate.

Without keys the site still runs in **demo mode**: it shows a made-up wallet so you can see everything work.
With only the Helius key it reads real wallets but uses a simpler built-in roast.

## Put it online (free, about 15 minutes)

1. Make a free account on **github.com**. Click **New repository**, name it `roaster`, create it.
2. On the new repository page click **uploading an existing file** and drag in everything from this folder (not the `.env` file if you made one). Click **Commit changes**.
3. Make a free account on **vercel.com** and log in with GitHub.
4. Click **Add New → Project**, pick the `roaster` repository, click **Import**.
5. Open **Environment Variables** and add:
   - `HELIUS_API_KEY` = your Helius key
   - `ANTHROPIC_API_KEY` = your Anthropic key
6. Click **Deploy**. After a minute you get a link like `roaster-abc.vercel.app`. That's your live site.

You can connect your own domain later in Vercel under **Settings → Domains**.

## Run it on your own computer (optional)

1. Install Node.js (version 18 or newer) from nodejs.org.
2. Copy `.env.example` to `.env` and paste your keys in.
3. In this folder run `npm run dev` and open http://localhost:3000.

`npm test` checks the trade analysis and the server in demo mode.

## Settings you can change

- `ROAST_MODEL`: which Claude model writes the roast (default `claude-sonnet-5-5`; `claude-haiku-5-5` is cheaper and faster).
- `HISTORY_PAGES`: how far back to look, in pages of 100 transactions (default 5).

## Good to know

- It only reads public blockchain data. Nobody connects a wallet and nothing is stored.
- Trades are coins swapped against SOL, USDC or USDT. Coin-to-coin swaps and airdrops are skipped.
- Profit/loss for coins still held uses today's price. A coin with no price is counted as dead.
- The keys stay on the server. Never put them in `index.html`.
- Before you promote it widely, add a rate limit so nobody can spam roasts on your Anthropic credit.
