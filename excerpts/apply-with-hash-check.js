// Excerpt 1 - the APPLY pattern (rewritten and shortened from JARVIS's APPLY scripts).
//
// Files that can move real money are never edited by the assistant directly. The assistant writes a
// script; the owner runs its self-test, and then runs it. The script refuses to write unless
// the target is exactly the version it was written against, every anchor occurs exactly once, and the
// patched file still parses and passes its own self-test. Otherwise the original comes back.
//
// Run: node apply-with-hash-check.js        (demo on temporary files; touches nothing else)
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto"), cp = require("child_process");

// Line endings are normalised before hashing, so a checkout with CRLF and one with LF hash the same.
const sha = (text) => crypto.createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");

function applyPatch(file, { expectedSha, marker, replacements, check }) {
  const before = fs.readFileSync(file, "utf8");
  if (before.includes(marker)) return { skipped: "already applied" }; // a second run is a no-op
  if (sha(before) !== expectedSha) throw new Error("target is not the expected version - nothing written");
  let text = before;
  for (const { from, to } of replacements) {
    const n = text.split(from).length - 1;
    if (n !== 1) throw new Error(`anchor found ${n} times - nothing written`);
    text = text.replace(from, () => to); // a function, so "$&" in the new code is not expanded
  }
  fs.copyFileSync(file, file + ".bak");
  fs.writeFileSync(file, text);
  try {
    cp.execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }); // still valid JavaScript?
    if (check) check(file);                                                 // and its own self-test passes?
  } catch (e) {
    fs.copyFileSync(file + ".bak", file); // roll back
    throw new Error("check failed after writing - original restored");
  }
  return { applied: replacements.length };
}

if (require.main === module) {
  const assert = require("assert");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-demo-"));
  const file = path.join(dir, "executor.js");
  const original = "function sell(p) {\n  return p.loss > 0.3;\n}\nmodule.exports = { sell };\n";
  const spec = {
    expectedSha: sha(original),
    marker: "PATCH-stop-20",
    replacements: [{ from: "  return p.loss > 0.3;", to: "  return p.loss >= 0.2; // PATCH-stop-20" }],
    check: (f) => { delete require.cache[f]; assert.strictEqual(require(f).sell({ loss: 0.2 }), true); },
  };

  fs.writeFileSync(file, original);
  assert.deepStrictEqual(applyPatch(file, spec), { applied: 1 });
  assert.deepStrictEqual(applyPatch(file, spec), { skipped: "already applied" });
  console.log("PASS applies once; the second run does nothing");

  fs.writeFileSync(file, original.replace("0.3", "0.25")); // someone changed the file since the patch was written
  assert.throws(() => applyPatch(file, spec), /not the expected version/);
  assert.ok(fs.readFileSync(file, "utf8").includes("0.25"));
  console.log("PASS refuses a file at an unexpected version and writes nothing");

  fs.writeFileSync(file, original);
  const broken = { ...spec, replacements: [{ from: "  return p.loss > 0.3;", to: "  return p.loss >= ; // PATCH-stop-20" }] };
  assert.throws(() => applyPatch(file, broken), /original restored/);
  assert.strictEqual(fs.readFileSync(file, "utf8"), original);
  console.log("PASS a patch that breaks the file is rolled back byte for byte");

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("all checks passed");
}

module.exports = { applyPatch, sha };
