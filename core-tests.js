/**
 * Shared PhotoShuffleCore assertions.
 * Used by tests.html (browser) and run-tests.js (Node).
 */
(function (global) {
  "use strict";

  function countMoved(sourceForDest) {
    let moved = 0;
    for (let i = 0; i < sourceForDest.length; i++) {
      if (sourceForDest[i] !== i) moved++;
    }
    return moved;
  }

  /**
   * @param {typeof global.PhotoShuffleCore} C
   * @param {(name: string, cond: boolean, detail?: string) => void} assert
   */
  function run(C, assert) {
    {
      const g = C.calculateGrid(6000, 4000, 5, 4);
      assert("Grid: 5×4 → 20 tiles", g.tiles === 20);
      assert("Grid: tile 1200×1000", g.tileWidth === 1200 && g.tileHeight === 1000);
    }

    {
      const g = C.calculateGrid(6001, 4000, 10, 8);
      assert("Crop: width 6001/10 → 6000", g.cropWidth === 6000 && g.cropRight === 1);
      assert("Crop: height unchanged", g.cropHeight === 4000 && g.cropBottom === 0);
      assert("Crop: equal tiles", g.tileWidth === 600 && g.tileHeight === 500);
    }

    {
      const plan = C.planShuffle(48, 0, C.createRng(1));
      assert("CHAOS 0: affectedCount 0", plan.affectedCount === 0);
      assert("CHAOS 0: identity", plan.sourceForDest.every((s, i) => s === i));
    }

    {
      const plan = C.planShuffle(12, 1, C.createRng(42));
      assert("CHAOS 1: all selected", plan.affectedCount === 12);
      assert("CHAOS 1: every tile moves", plan.sourceForDest.every((s, i) => s !== i));
      C.assertPermutationValid(plan.selected, plan.sourceForDest);
      assert("CHAOS 1: permutation valid", true);
    }

    {
      const plan = C.planShuffle(100, 0.2, C.createRng(7));
      assert("Partial: exactly 20 affected", plan.affectedCount === 20);
      assert("Partial: 20 selected", plan.selected.length === 20);
      const moved = countMoved(plan.sourceForDest);
      assert("Partial: 20 moved", moved === 20);
      assert("Partial: 80 unchanged", plan.sourceForDest.length - moved === 80);
      C.assertPermutationValid(plan.selected, plan.sourceForDest);
      assert("Partial: permutation valid", true);
    }

    {
      const plan = C.planShuffle(48, 0.1, C.createRng(99));
      assert("Rounding: floor(48×0.10)=4", C.affectedTileCount(48, 0.1) === 4);
      assert("Rounding: plan moves 4", plan.affectedCount === 4);
      assert("Rounding: exactly 4 positions changed", countMoved(plan.sourceForDest) === 4);
    }

    {
      assert("Single: floor(10×0.10)=1 → count 0", C.affectedTileCount(10, 0.1) === 0);
      const plan = C.planShuffle(10, 0.1, C.createRng(3));
      assert("Single: no moves", plan.affectedCount === 0 && !plan.moved);
      assert("Single: identity", plan.sourceForDest.every((s, i) => s === i));
    }

    {
      const plan = C.planShuffle(1, 1, C.createRng(1));
      assert("One tile: no rearrange", !plan.moved && plan.sourceForDest[0] === 0);
    }

    {
      let ok = true;
      let detail = "";
      for (let t = 0; t < 50; t++) {
        const plan = C.planShuffle(30, 0.5, C.createRng(1000 + t));
        try {
          C.assertPermutationValid(plan.selected, plan.sourceForDest);
        } catch (e) {
          ok = false;
          detail = "trial " + t + ": " + e.message;
          break;
        }
      }
      assert("Permutation: 50 random plans valid", ok, detail);
    }

    {
      const plan = C.planShuffle(2, 1, C.createRng(5));
      assert(
        "Two tiles: swap",
        plan.sourceForDest[0] === 1 && plan.sourceForDest[1] === 0
      );
    }

    {
      const a = C.planShuffle(40, 0.35, C.createRng(12345));
      const b = C.planShuffle(40, 0.35, C.createRng(12345));
      assert("Seed: identical selected", JSON.stringify(a.selected) === JSON.stringify(b.selected));
      assert(
        "Seed: identical permutation",
        JSON.stringify(a.sourceForDest) === JSON.stringify(b.sourceForDest)
      );
      const c = C.planShuffle(40, 0.35, C.createRng(99999));
      assert(
        "Seed: different seed differs",
        JSON.stringify(a.sourceForDest) !== JSON.stringify(c.sourceForDest)
      );
    }

    {
      assert(
        "Filename pattern",
        C.generateFilename("portrait.jpg", 10, 8, 0.25, 1) ===
          "portrait_shuffle_10x8_c0.25_001.jpg"
      );
    }

    {
      function params(overrides) {
        return Object.assign(
          {
            isJpeg: true,
            width: 100,
            height: 100,
            hor: 2,
            ver: 2,
            chaos: 0.5,
            nOut: 1,
          },
          overrides
        );
      }
      assert("Validate: reject non-jpeg", !C.validateParams(params({ isJpeg: false })).ok);
      assert(
        "Validate: reject HOR > width",
        !C.validateParams(params({ width: 10, height: 10, hor: 11 })).ok
      );
      assert("Validate: reject chaos > 1", !C.validateParams(params({ chaos: 1.1 })).ok);
      assert("Validate: ok params", C.validateParams(params({ nOut: 3 })).ok);
    }

    {
      assert("Circle hits overlapping rect", C.circleIntersectsRect(10, 10, 5, 12, 8, 20, 20));
      assert("Circle misses distant rect", !C.circleIntersectsRect(0, 0, 2, 50, 50, 10, 10));

      const g = C.calculateGrid(1000, 800, 10, 8);
      assert("No stamps → null eligible (all tiles)", C.eligibleTilesFromStamps(g, []) === null);

      const touched = C.eligibleTilesFromStamps(g, [{ x: 50, y: 50, r: 20 }]);
      assert("Stamp in first tile only", touched.length === 1 && touched[0] === 0);

      const edge = C.eligibleTilesFromStamps(g, [{ x: 100, y: 100, r: 5 }]);
      assert("Stamp on tile corner can touch 4 tiles", edge.length >= 2 && edge.length <= 4);
    }

    {
      const eligible = [2, 5, 7, 11];
      const plan = C.planShuffle(20, 1, C.createRng(4), eligible);
      assert("Mask CHAOS 1: four tiles move", plan.affectedCount === 4);
      assert(
        "Mask CHAOS 1: only eligible moved",
        plan.selected.every((i) => eligible.includes(i)) &&
          plan.sourceForDest.every((s, i) => eligible.includes(i) || s === i)
      );
      C.assertPermutationValid(plan.selected, plan.sourceForDest);
      assert("Mask CHAOS 1: permutation valid", true);
    }

    {
      const eligible = Array.from({ length: 20 }, (_, i) => i);
      const plan = C.planShuffle(100, 0.2, C.createRng(7), eligible);
      assert("Mask partial: 4 of 20 eligible", plan.affectedCount === 4);
      let outside = 0;
      for (let i = 20; i < 100; i++) if (plan.sourceForDest[i] !== i) outside++;
      assert("Mask partial: untouched tiles stay", outside === 0);
    }

    {
      const plan = C.planShuffle(48, 1, C.createRng(1), []);
      assert("Empty eligible → no moves", !plan.moved && plan.eligibleCount === 0);
    }

    {
      const a = C.planShuffle(40, 0.5, C.createRng(9));
      const b = C.planShuffle(40, 0.5, C.createRng(9), null);
      assert(
        "Null eligible ≡ all tiles",
        JSON.stringify(a.sourceForDest) === JSON.stringify(b.sourceForDest)
      );
    }

    {
      assert("parseSeed empty → null", C.parseSeed("") === null);
      assert("parseSeed 42", C.parseSeed("42") === 42);
      const h1 = C.parseSeed("abc");
      const h2 = C.parseSeed("abc");
      assert("parseSeed stable hash", h1 === h2 && h1 !== null);
    }
  }

  const api = { run };

  global.PhotoShuffleCoreTests = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
