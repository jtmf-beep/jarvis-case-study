// Excerpt 2 - fail closed on a damaged ledger (rewritten and shortened from JARVIS's trading sleeve).
//
// The bug this replaces: the ledger reader returned an empty list for the WHOLE file when one line did
// not parse. Every holding then looked like it had no history, and an exit rule meant for stale holdings
// sold three names per run. A second check compared the broker with itself, so it could never fail.
//
// The rule now: a run that cannot trust its ledger, or whose ledger disagrees with the broker, places no
// order at all. It writes a "blocked" hold row and raises an alarm. (The -20 % trailing stop runs before
// this point on purpose, so a blocked run still protects against a large fall.)
//
// Run: node fail-closed-ledger.js

// Parse a JSON-lines ledger and name the lines that do not parse, instead of hiding them.
function checkLedger(text) {
  const rows = [], bad = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line) return;
    try {
      const v = JSON.parse(line);
      if (v && typeof v === "object" && !Array.isArray(v)) rows.push(v); else bad.push(i + 1);
    } catch { bad.push(i + 1); }
  });
  return { rows, bad };
}

// Every name the last rebalance bought must still be held, with a 2 % quantity tolerance,
// unless a later row sold it. Holding more than was bought is fine.
function reconcile(rows, positions) {
  const held = new Map(positions.map((p) => [p.symbol, Number(p.qty)]));
  const lastIdx = rows.map((r) => r.type).lastIndexOf("rebalance");
  if (lastIdx < 0) return { ok: true, issues: [] };
  const soldLater = new Set(rows.slice(lastIdx + 1).flatMap((r) => (r.sells || [])));
  const issues = [];
  for (const o of rows[lastIdx].orders || []) {
    if (o.side !== "buy" || soldLater.has(o.symbol)) continue;
    const q = held.get(o.symbol);
    if (q === undefined) issues.push(`${o.symbol} bought but not held`);
    else if (o.filledQty && q < o.filledQty * 0.98) issues.push(`${o.symbol} held ${q} < bought ${o.filledQty}`);
  }
  return { ok: issues.length === 0, issues };
}

function decide(ledgerText, positions) {
  const lg = checkLedger(ledgerText);
  if (lg.bad.length) return { orders: "none", blocked: `ledger has unparseable line(s) ${lg.bad.join(", ")}` };
  const rc = reconcile(lg.rows, positions);
  if (!rc.ok) return { orders: "none", blocked: `ledger and broker disagree: ${rc.issues.join("; ")}` };
  return { orders: "allowed", rows: lg.rows.length };
}

if (require.main === module) {
  const assert = require("assert");
  const ledger = [
    { type: "rebalance", orders: [{ symbol: "AAA", side: "buy", filledQty: 2 }, { symbol: "BBB", side: "buy", filledQty: 1 }] },
    { type: "trailstop", sells: ["BBB"] },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n";
  const positions = [{ symbol: "AAA", qty: "2" }];

  assert.strictEqual(decide(ledger, positions).orders, "allowed");
  console.log("PASS positive control: a sound ledger that matches the broker may trade");

  const damaged = ledger.replace('{"type":"trailstop"', '{"type":"trailstop"<<');
  const d = decide(damaged, positions);
  assert.strictEqual(d.orders, "none"); assert.match(d.blocked, /line\(s\) 2/);
  console.log("PASS one unparseable line blocks every order and names the line");

  const r = decide(ledger, []);
  assert.strictEqual(r.orders, "none"); assert.match(r.blocked, /AAA bought but not held/);
  console.log("PASS a holding the ledger bought but the broker does not show blocks the run");

  assert.strictEqual(decide(ledger, [{ symbol: "AAA", qty: "5" }]).orders, "allowed");
  console.log("PASS holding more than was bought is not a mismatch");
  console.log("all checks passed");
}

module.exports = { checkLedger, reconcile, decide };
