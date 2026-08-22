/**
 * Headless unit tests for PhotoShuffleCore.
 * Run: node run-tests.js
 */
"use strict";

const C = require("./shuffle-core.js");

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

{
  const g = C.calculateGrid(6000, 4000, 5, 4);
  assert("Grid: 5×4 → 20 tiles", g.tiles === 20);
  assert("Grid: tile 1200×1000", g.tileWidth === 1200 && g.tileHeight === 1000);
}

{
  const g = C.calculateGrid(6001, 4000, 10, 8);
  assert("Crop: width 6001/10 → 6000", g.cropWidth === 6000 && g.cropRight === 1);
  assert("Crop: equal tiles", g.tileWidth === 600 && g.tileHeight === 500);
}

{
  const plan = C.planShuffle(48, 0, C.createRng(1));
  assert("CHAOS 0: identity", plan.affectedCount === 0 && plan.sourceForDest.every((s, i) => s === i));
}

{
  const plan = C.planShuffle(12, 1, C.createRng(42));
  assert("CHAOS 1: all move", plan.affectedCount === 12 && plan.sourceForDest.every((s, i) => s !== i));
  C.assertPermutationValid(plan.selected, plan.sourceForDest);
  assert("CHAOS 1: valid", true);
}

{
  const plan = C.planShuffle(100, 0.2, C.createRng(7));
  let moved = 0;
  let unchanged = 0;
  for (let i = 0; i < 100; i++) {
    if (plan.sourceForDest[i] !== i) moved++;
    else unchanged++;
  }
  assert("Partial: 20 moved / 80 unchanged", plan.affectedCount === 20 && moved === 20 && unchanged === 80);
}

{
  assert("Rounding: floor(48×0.10)=4", C.affectedTileCount(48, 0.1) === 4);
  const plan = C.planShuffle(48, 0.1, C.createRng(99));
  let moved = 0;
  for (let i = 0; i < 48; i++) if (plan.sourceForDest[i] !== i) moved++;
  assert("Rounding: exactly 4 moved", plan.affectedCount === 4 && moved === 4);
}

{
  assert("Single affected → 0", C.affectedTileCount(10, 0.1) === 0);
  const plan = C.planShuffle(10, 0.1, C.createRng(3));
  assert("Single: no moves", !plan.moved && plan.sourceForDest.every((s, i) => s === i));
}

{
  let ok = true;
  for (let t = 0; t < 50; t++) {
    const plan = C.planShuffle(30, 0.5, C.createRng(1000 + t));
    try {
      C.assertPermutationValid(plan.selected, plan.sourceForDest);
    } catch (e) {
      ok = false;
      lines.push("FAIL  trial " + t + ": " + e.message);
      break;
    }
  }
  assert("Permutation: 50 plans valid", ok);
}

{
  const a = C.planShuffle(40, 0.35, C.createRng(12345));
  const b = C.planShuffle(40, 0.35, C.createRng(12345));
  assert(
    "Seed reproducibility",
    JSON.stringify(a.sourceForDest) === JSON.stringify(b.sourceForDest)
  );
}

{
  assert("Circle hits overlapping rect", C.circleIntersectsRect(10, 10, 5, 12, 8, 20, 20));
  assert("Circle misses distant rect", !C.circleIntersectsRect(0, 0, 2, 50, 50, 10, 10));
  const g = C.calculateGrid(1000, 800, 10, 8);
  assert("No stamps → null eligible", C.eligibleTilesFromStamps(g, []) === null);
  const touched = C.eligibleTilesFromStamps(g, [{ x: 50, y: 50, r: 20 }]);
  assert("Stamp in first tile", touched.length === 1 && touched[0] === 0);
}

{
  const eligible = [2, 5, 7, 11];
  const plan = C.planShuffle(20, 1, C.createRng(4), eligible);
  assert("Mask CHAOS 1: four move", plan.affectedCount === 4);
  assert(
    "Mask: only eligible moved",
    plan.sourceForDest.every((s, i) => eligible.includes(i) || s === i)
  );
}

{
  const eligible = Array.from({ length: 20 }, (_, i) => i);
  const plan = C.planShuffle(100, 0.2, C.createRng(7), eligible);
  let outside = 0;
  for (let i = 20; i < 100; i++) if (plan.sourceForDest[i] !== i) outside++;
  assert("Mask partial: 4 moved, rest of image fixed", plan.affectedCount === 4 && outside === 0);
}

{
  const plan = C.planShuffle(48, 1, C.createRng(1), []);
  assert("Empty eligible → no moves", !plan.moved);
}

{
  const a = C.planShuffle(40, 0.5, C.createRng(9));
  const b = C.planShuffle(40, 0.5, C.createRng(9), null);
  assert("Null eligible ≡ all tiles", JSON.stringify(a.sourceForDest) === JSON.stringify(b.sourceForDest));
}

{
  assert(
    "Filename",
    C.generateFilename("portrait.jpg", 10, 8, 0.25, 1) ===
      "portrait_shuffle_10x8_c0.25_001.jpg"
  );
}

console.log(lines.join("\n"));
console.log(failed === 0 ? "All " + passed + " tests passed." : passed + " passed, " + failed + " failed.");
process.exit(failed ? 1 : 0);
