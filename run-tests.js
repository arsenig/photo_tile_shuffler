/**
 * Headless runner for PhotoShuffleCore tests.
 * Run: node run-tests.js
 */
"use strict";

const C = require("./shuffle-core.js");
const Tests = require("./core-tests.js");

let passed = 0;
let failed = 0;
const lines = [];

function assert(name, cond, detail) {
  if (cond) {
    passed++;
    lines.push("PASS  " + name);
  } else {
    failed++;
    lines.push("FAIL  " + name + (detail ? " — " + detail : ""));
  }
}

Tests.run(C, assert);

console.log(lines.join("\n"));
console.log(failed === 0 ? "All " + passed + " tests passed." : passed + " passed, " + failed + " failed.");
process.exit(failed ? 1 : 0);
