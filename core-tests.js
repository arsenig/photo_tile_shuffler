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

      const paint = { r: 20, points: [{ x: 50, y: 50 }], erase: false };
      const erase = { r: 20, points: [{ x: 50, y: 50 }], erase: true };
      assert(
        "Paint stroke selects first tile",
        JSON.stringify(C.eligibleTilesFromStrokes(g, [paint])) === "[0]"
      );
      assert(
        "Paint then erase → no mask",
        C.eligibleTilesFromStrokes(g, [paint, erase]) === null
      );
      assert(
        "Paint, erase, paint → selected again",
        JSON.stringify(C.eligibleTilesFromStrokes(g, [paint, erase, paint])) === "[0]"
      );
      assert("Erase only → no mask", C.eligibleTilesFromStrokes(g, [erase]) === null);

      const cropped = C.calculateGrid(1001, 800, 10, 8);
      const miss = { r: 0.2, points: [{ x: 1000.9, y: 50 }], erase: false };
      const missed = C.eligibleTilesFromStrokes(cropped, [miss]);
      assert("Paint on crop strip → empty eligible", missed && missed.length === 0);

      const sampled = C.stampsFromStroke({
        r: 10,
        points: [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
        ],
      });
      assert("stampsFromStroke samples along a segment", sampled.length >= 3);
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
      // Two tight clusters: dark tiles 0..9, bright tiles 10..19.
      function brightness(i) {
        return i < 10 ? [20 + i, 20 + i, 20 + i] : [200 + (i - 10), 200 + (i - 10), 200 + (i - 10)];
      }
      const gray = Array.from({ length: 20 }, (_, i) => brightness(i));
      const selected = Array.from({ length: 20 }, (_, i) => i);
      const map = C.createSimilarityDerangementMap(selected, gray, C.createRng(11));
      let crossCluster = 0;
      map.forEach(function (source, dest) {
        if (dest < 10 !== source < 10) crossCluster++;
      });
      assert("Subtle gray: all 20 tiles mapped", map.size === 20);
      assert("Subtle gray: swaps stay inside brightness cluster", crossCluster === 0);
      C.assertPermutationValid(selected, C.buildSourceForDest(20, map));
      assert("Subtle gray: permutation valid", true);
    }

    {
      // Sky / grass / brick: similar luminance, clearly different hue.
      const palette = [
        [70, 130, 220],
        [80, 170, 90],
        [190, 70, 60],
      ];
      const colors = Array.from({ length: 30 }, (_, i) => palette[i % 3]);
      const selected = Array.from({ length: 30 }, (_, i) => i);
      const map = C.createSimilarityDerangementMap(selected, colors, C.createRng(23));
      let crossColor = 0;
      map.forEach(function (source, dest) {
        if (dest % 3 !== source % 3) crossColor++;
      });
      assert("Subtle color: swaps keep the same hue group", crossColor === 0);
      assert(
        "Subtle color: nothing stays put",
        Array.from(map.keys()).every((dest) => map.get(dest) !== dest)
      );
    }

    {
      // Odd counts cannot pair up cleanly; the leftover must still move.
      const desc = [[0], [1], [200]];
      const map = C.createSimilarityDerangementMap([0, 1, 2], desc, C.createRng(5));
      assert("Subtle odd: 3 tiles form a cycle", map.size === 3);
      assert(
        "Subtle odd: leftover tile still moves",
        map.get(0) !== 0 && map.get(1) !== 1 && map.get(2) !== 2
      );
      C.assertPermutationValid([0, 1, 2], C.buildSourceForDest(3, map));
      assert("Subtle odd: permutation valid", true);
    }

    {
      // No cluster at all: every tile is far from every other, but all must move.
      const desc = Array.from({ length: 7 }, (_, i) => [i * 1000]);
      const selected = [0, 1, 2, 3, 4, 5, 6];
      const map = C.createSimilarityDerangementMap(selected, desc, C.createRng(31));
      assert("Subtle fallback: every tile still swapped", map.size === 7);
      C.assertPermutationValid(selected, C.buildSourceForDest(7, map));
      assert("Subtle fallback: permutation valid", true);
    }

    {
      const desc = Array.from({ length: 64 }, (_, i) => [i < 32 ? 10 : 240]);
      const plain = C.planShuffle(64, 0.5, C.createRng(77));
      const subtle = C.planShuffle(64, 0.5, C.createRng(77), null, { descriptors: desc });
      assert("Subtle plan: same affected count", subtle.affectedCount === plain.affectedCount);
      assert("Subtle plan: same selected tiles", JSON.stringify(subtle.selected) === JSON.stringify(plain.selected));
      assert("Subtle plan: reports similar pairing", subtle.pairing === "similar");
      assert("Plain plan: reports random pairing", plain.pairing === "random");
      C.assertPermutationValid(subtle.selected, subtle.sourceForDest);
      assert("Subtle plan: permutation valid", true);

      function totalDistance(plan) {
        let sum = 0;
        for (const dest of plan.selected) {
          sum += C.descriptorDistance(desc[dest], desc[plan.sourceForDest[dest]]);
        }
        return sum;
      }
      assert("Subtle plan: lower descriptor distance than random", totalDistance(subtle) < totalDistance(plain));
    }

    {
      const desc = Array.from({ length: 40 }, (_, i) => [(i * 37) % 256]);
      const a = C.planShuffle(40, 0.5, C.createRng(4242), null, { descriptors: desc });
      const b = C.planShuffle(40, 0.5, C.createRng(4242), null, { descriptors: desc });
      assert(
        "Subtle plan: seed reproducible",
        JSON.stringify(a.sourceForDest) === JSON.stringify(b.sourceForDest)
      );
      const rng = C.createRng(4242);
      const v1 = C.planShuffle(40, 0.5, rng, null, { descriptors: desc });
      const v2 = C.planShuffle(40, 0.5, rng, null, { descriptors: desc });
      assert(
        "Subtle plan: consecutive variants differ",
        JSON.stringify(v1.sourceForDest) !== JSON.stringify(v2.sourceForDest)
      );
    }

    {
      const partial = [];
      partial[0] = [1];
      const plan = C.planShuffle(20, 1, C.createRng(8), null, { descriptors: partial });
      assert("Subtle plan: missing descriptors → random fallback", plan.pairing === "random");
      assert("Subtle plan: fallback still moves every tile", plan.affectedCount === 20);
      C.assertPermutationValid(plan.selected, plan.sourceForDest);
      assert("Subtle plan: fallback permutation valid", true);
    }

    {
      const desc = Array.from({ length: 20 }, (_, i) => [i]);
      const plan = C.planShuffle(20, 1, C.createRng(6), [3, 8, 14], { descriptors: desc });
      assert("Subtle plan: respects brush mask", plan.affectedCount === 3);
      assert(
        "Subtle plan: unmasked tiles stay",
        plan.sourceForDest.every((s, i) => [3, 8, 14].includes(i) || s === i)
      );
      C.assertPermutationValid(plan.selected, plan.sourceForDest);
      assert("Subtle plan: masked permutation valid", true);
    }

    {
      assert(
        "descriptorDistance: identical → 0",
        C.descriptorDistance([10, 20, 30], [10, 20, 30]) === 0
      );
      assert(
        "descriptorDistance: closer brightness wins",
        C.descriptorDistance([100, 100, 100], [110, 110, 110]) <
          C.descriptorDistance([100, 100, 100], [200, 200, 200])
      );
      assert(
        "descriptorDistance: missing descriptor → Infinity",
        C.descriptorDistance(null, [1, 2, 3]) === Infinity
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
