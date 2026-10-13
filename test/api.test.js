// Run with: node test/api.test.js  (tests the endpoint in demo mode, no keys needed)
import assert from "node:assert/strict";
import { Readable } from "node:stream";

delete process.env.HELIUS_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
const { default: handler } = await import("../api/roast.js");

function call(method, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body || {}))]);
  req.method = method;
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      end(s) { resolve({ status: this.statusCode, body: JSON.parse(s) }); },
    };
    handler(req, res);
  });
}

const get = await call("GET");
assert.equal(get.status, 405);

const ok = await call("POST", { address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", heat: "nuclear" });
assert.equal(ok.status, 200);
assert.equal(ok.body.demo, true);
assert.equal(ok.body.stats.walletShort, "7xKX…gAsU");
assert.equal(ok.body.roast.lines.length, 4);
assert.ok(ok.body.roast.score >= 0 && ok.body.roast.score <= 100);
console.log("api OK");
console.log(JSON.stringify(ok.body.roast, null, 2));
