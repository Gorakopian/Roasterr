// Local test server only (Vercel does not use this file): `npm run dev`, then open http://localhost:3000
// Reads keys from a .env file in the project folder, if present.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import handler from "../api/roast.js";

const root = new URL("../", import.meta.url);
const envPath = new URL(".env", root);

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const port = Number(process.env.PORT) || 3000;
http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/roast")) return handler(req, res);
    if (req.url === "/" || req.url.startsWith("/?")) {
      res.setHeader("content-type", "text/html; charset=utf-8");
      return res.end(await readFile(new URL("index.html", root)));
    }
    res.statusCode = 404; res.end("Not found");
  } catch (e) {
    res.statusCode = 500; res.end("Server error");
  }
}).listen(port, () => {
  const mode = process.env.HELIUS_API_KEY ? "live wallets" : "demo data (no HELIUS_API_KEY)";
  console.log(`Roaster running on http://localhost:${port} using ${mode}`);
});
