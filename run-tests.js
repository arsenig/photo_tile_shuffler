/**
 * Headless runner for PhotoShuffleCore tests.
 * Run: node run-tests.js
 */
"use strict";

const C = require("./shuffle-core.js");
const Tests = require("./core-tests.js");

const reporter = Tests.createReporter();
Tests.run(C, reporter.assert);

console.log(reporter.lines.join("\n"));
console.log(reporter.summary());
process.exit(reporter.failed() ? 1 : 0);
