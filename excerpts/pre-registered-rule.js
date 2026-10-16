// Excerpt 3 - a pre-registered promote/cut rule (rewritten and shortened from JARVIS's trade lab).
//
// The lab runs several prompt variants side by side on paper. Each day, for each variant, it takes the
// mean 5-day return (in excess of the S&P 500 ETF) of the names it called "up" minus the names it called
// "flat": one number per date. The rule that judges those numbers was written down, versioned and
// committed BEFORE the lab had enough data to judge, and its thresholds were not fitted on that data.
// Changing a threshold means a new version with a new date, not an edit.
//
// Run: node pre-registered-rule.js

const RULE = Object.freeze({
  version: 1,
  PROMOTE_MIN_DATES: 20, // at least 20 separate signal dates
  PROMOTE_MIN_UP: 60,    // at least 60 "up" calls in total
  PROMOTE_T: 2.6,        // five variants are judged at once: Bonferroni for 5 tests at 5 % two-sided
  CUT_AFTER_DATES: 20,   // after 20 dates, cut a variant whose upper 95 % bound is below zero
  CUT_CRIT: 2.09,        // t critical value for about 19 degrees of freedom
  CUT_MIN_UP: 20,        // or cut it as "starved" if it made fewer than 20 up calls in 20 run dates
});

// spreads: one up-minus-flat number per signal date; se: its standard error (in the original the
// larger of a date-clustered SE and a Newey-West SE, because 5-day windows overlap); upCalls: total.
function judge({ spreads, se, upCalls, runDates, upBeatsMarket }) {
  const n = spreads.length;
  const mean = n ? spreads.reduce((a, b) => a + b, 0) / n : 0;
  const t = se > 0 ? mean / se : 0;
  if (runDates >= RULE.CUT_AFTER_DATES && upCalls < RULE.CUT_MIN_UP) return { verdict: "cut", why: "starved" };
  if (n >= RULE.CUT_AFTER_DATES && mean + RULE.CUT_CRIT * se < 0) return { verdict: "cut", why: "reliably worse than its own flats" };
  if (n >= RULE.PROMOTE_MIN_DATES && upCalls >= RULE.PROMOTE_MIN_UP && t >= RULE.PROMOTE_T && upBeatsMarket)
    return { verdict: "promote", t: +t.toFixed(2) };
  return { verdict: "insufficient", n, upCalls, t: +t.toFixed(2) };
}

if (require.main === module) {
  const assert = require("assert");
  const days = (k, v) => Array.from({ length: k }, () => v);
  // The state of the real lab when the rule was written: one spread date, nine up calls.
  assert.strictEqual(judge({ spreads: [0.0373], se: 0, upCalls: 9, runDates: 2, upBeatsMarket: true }).verdict, "insufficient");
  console.log("PASS a large spread on one date is not evidence: insufficient");
  assert.strictEqual(judge({ spreads: days(25, 0.015), se: 0.005, upCalls: 70, runDates: 25, upBeatsMarket: true }).verdict, "promote");
  console.log("PASS 25 dates, 70 up calls, t = 3.0 and up calls beating the market: promote");
  assert.strictEqual(judge({ spreads: days(25, 0.015), se: 0.005, upCalls: 70, runDates: 25, upBeatsMarket: false }).verdict, "insufficient");
  console.log("PASS the same spread with up calls that lose to the market: not promoted");
  assert.strictEqual(judge({ spreads: days(22, -0.02), se: 0.005, upCalls: 40, runDates: 22, upBeatsMarket: false }).why, "reliably worse than its own flats");
  assert.strictEqual(judge({ spreads: days(3, 0.01), se: 0.01, upCalls: 4, runDates: 21, upBeatsMarket: true }).why, "starved");
  console.log("PASS cut rules: reliably negative, and starved");
  assert.throws(() => { "use strict"; RULE.PROMOTE_T = 2.0; });
  console.log("PASS the rule object cannot be loosened at run time");
  console.log("all checks passed");
}

module.exports = { RULE, judge };
