/**
 * Photo Tile Shuffle — pure algorithm (no DOM / canvas).
 * Attach to window for classic <script> loading (file:// compatible).
 */
(function (global) {
  "use strict";

  function range(n) {
    return Array.from({ length: n }, (_, i) => i);
  }

  function swap(arr, i, j) {
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }

  /**
   * Mulberry32 — small seeded PRNG. Returns floats in [0, 1).
   * @param {number} seed
   * @returns {() => number}
   */
  function createRng(seed) {
    let t = seed >>> 0;
    return function rng() {
      t = (t + 0x6d2b79f5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Unseeded RNG using crypto when available.
   * @returns {() => number}
   */
  function createUnseededRng() {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      return function rng() {
        const buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        return buf[0] / 4294967296;
      };
    }
    return Math.random;
  }

  /**
   * Parse optional seed string/number into a 32-bit integer, or null if empty.
   * @param {string|number|null|undefined} seedInput
   * @returns {number|null}
   */
  function parseSeed(seedInput) {
    if (seedInput === null || seedInput === undefined) return null;
    const s = String(seedInput).trim();
    if (s === "") return null;
    if (/^-?\d+$/.test(s)) {
      return Number(s) >>> 0;
    }
    // Hash non-numeric strings stably
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /**
   * Compute cropped grid geometry. Crops excess from right/bottom only.
   * @param {number} width
   * @param {number} height
   * @param {number} hor
   * @param {number} ver
   */
  function calculateGrid(width, height, hor, ver) {
    const cropWidth = width - (width % hor);
    const cropHeight = height - (height % ver);
    const tileWidth = cropWidth / hor;
    const tileHeight = cropHeight / ver;
    const tiles = hor * ver;
    return {
      sourceWidth: width,
      sourceHeight: height,
      cropWidth,
      cropHeight,
      cropRight: width - cropWidth,
      cropBottom: height - cropHeight,
      hor,
      ver,
      tileWidth,
      tileHeight,
      tiles,
    };
  }

  /**
   * Row-major tile index → pixel origin of that tile in the cropped image.
   */
  function tileOrigin(index, hor, tileWidth, tileHeight) {
    const col = index % hor;
    const row = Math.floor(index / hor);
    return { x: col * tileWidth, y: row * tileHeight };
  }

  /**
   * Number of tiles allowed to move under CHAOS, with the single-tile rule.
   * `poolSize` is TILES when no brush is used, or the count of brush-touched tiles.
   * Returns 0 when a derangement is impossible without exceeding CHAOS.
   */
  function affectedTileCount(poolSize, chaos) {
    const n = Math.floor(poolSize * chaos);
    if (n < 2) return 0;
    return n;
  }

  /**
   * True if circle (cx, cy, r) intersects axis-aligned rect [rx, ry, rw, rh].
   */
  function circleIntersectsRect(cx, cy, r, rx, ry, rw, rh) {
    const closestX = Math.max(rx, Math.min(cx, rx + rw));
    const closestY = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy <= r * r;
  }

  /**
   * Tile indices whose rectangles intersect any brush stamp.
   * Stamps are {x, y, r} in source/crop pixel space (top-left origin).
   * Returns null when there are no stamps (caller should treat as “all tiles”).
   * @returns {number[]|null}
   */
  function eligibleTilesFromStamps(grid, stamps) {
    if (!stamps || stamps.length === 0) return null;
    const touched = [];
    for (let i = 0; i < grid.tiles; i++) {
      const origin = tileOrigin(i, grid.hor, grid.tileWidth, grid.tileHeight);
      for (let s = 0; s < stamps.length; s++) {
        const stamp = stamps[s];
        if (
          circleIntersectsRect(
            stamp.x,
            stamp.y,
            stamp.r,
            origin.x,
            origin.y,
            grid.tileWidth,
            grid.tileHeight
          )
        ) {
          touched.push(i);
          break;
        }
      }
    }
    return touched;
  }

  /**
   * Sample circle stamps along a stroke polyline so fast flicks still mark tiles.
   * @param {{ r: number, points: { x: number, y: number }[] }} stroke
   * @returns {{ x: number, y: number, r: number }[]}
   */
  function stampsFromStroke(stroke) {
    const stamps = [];
    const pts = stroke && stroke.points;
    const r = stroke && stroke.r;
    if (!pts || !pts.length || !(r > 0)) return stamps;
    stamps.push({ x: pts[0].x, y: pts[0].y, r: r });
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const step = Math.max(2, r * 0.7);
      const n = Math.max(1, Math.ceil(dist / step));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        stamps.push({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          r: r,
        });
      }
    }
    return stamps;
  }

  /**
   * Apply paint/erase strokes in order and return the eligible tile index list.
   * null → no mask (all tiles). [] → mask active but no tiles (e.g. crop-strip paint).
   * Fully erasing a previous selection returns null.
   * @param {object} grid
   * @param {{ r: number, points: { x: number, y: number }[], erase?: boolean }[]} strokes
   * @returns {number[]|null}
   */
  function eligibleTilesFromStrokes(grid, strokes) {
    if (!grid || !strokes || !strokes.length) return null;

    const selected = new Set();
    let paintHit = false;
    let paintMiss = false;

    for (let s = 0; s < strokes.length; s++) {
      const stroke = strokes[s];
      const stamps = stampsFromStroke(stroke);
      if (!stamps.length) continue;
      const hits = eligibleTilesFromStamps(grid, stamps) || [];
      if (stroke.erase) {
        for (let i = 0; i < hits.length; i++) selected.delete(hits[i]);
      } else if (hits.length) {
        paintHit = true;
        for (let i = 0; i < hits.length; i++) selected.add(hits[i]);
      } else {
        paintMiss = true;
      }
    }

    if (selected.size) {
      return Array.from(selected).sort(function (a, b) {
        return a - b;
      });
    }
    if (paintHit) return null;
    if (paintMiss) return [];
    return null;
  }

  /**
   * Normalize an optional eligible-index list against total tile count.
   * null/undefined → all indices (no brush).
   */
  function resolveEligibleIndices(tiles, eligible) {
    if (eligible == null) {
      return range(tiles);
    }
    const seen = new Set();
    const out = [];
    for (let i = 0; i < eligible.length; i++) {
      const idx = eligible[i];
      if (!Number.isInteger(idx) || idx < 0 || idx >= tiles) continue;
      if (seen.has(idx)) continue;
      seen.add(idx);
      out.push(idx);
    }
    return out;
  }

  /**
   * Uniform sample of `count` unique values from `pool`.
   * @param {number[]} pool
   * @param {number} count
   * @param {() => number} rng
   * @returns {number[]}
   */
  function selectFromPool(pool, count, rng) {
    if (count <= 0) return [];
    if (count > pool.length) {
      throw new Error("Cannot select more tiles than exist in the eligible pool.");
    }
    const indices = pool.slice();
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(rng() * (indices.length - i));
      swap(indices, i, j);
    }
    return indices.slice(0, count).sort((a, b) => a - b);
  }

  /**
   * Sattolo's algorithm — random cyclic permutation with no fixed points (n >= 2).
   * Mutates `arr` in place.
   * @param {number[]} arr
   * @param {() => number} rng
   */
  function sattoloShuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      swap(arr, i, Math.floor(rng() * i)); // 0 .. i-1 inclusive
    }
    return arr;
  }

  /**
   * Fisher–Yates shuffle (fixed points allowed). Mutates `arr` in place.
   * @param {number[]} arr
   * @param {() => number} rng
   */
  function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      swap(arr, i, Math.floor(rng() * (i + 1))); // 0 .. i inclusive
    }
    return arr;
  }

  /**
   * Squared distance between two tile descriptors (see `descriptors` on
   * `planShuffle`). Length-3 descriptors are read as RGB with luma weights; a
   * grayscale tile has r == g == b, so the result then reduces to a monotone
   * function of the brightness difference. Other lengths use plain squared
   * distance, which covers single-channel brightness descriptors.
   *
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number}
   */
  function descriptorDistance(a, b) {
    if (!a || !b) return Infinity;
    if (a.length === 3 && b.length === 3) {
      const dr = a[0] - b[0];
      const dg = a[1] - b[1];
      const db = a[2] - b[2];
      return 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
    }
    const n = Math.min(a.length, b.length);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = a[i] - b[i];
      sum += d * d;
    }
    return sum;
  }

  /**
   * True when every selected tile has a usable descriptor.
   * @param {number[]} selected
   * @param {ArrayLike<number[]>|null|undefined} descriptors
   */
  function hasDescriptorsFor(selected, descriptors) {
    if (!descriptors) return false;
    for (let i = 0; i < selected.length; i++) {
      const d = descriptors[selected[i]];
      if (!d || typeof d.length !== "number" || d.length === 0) return false;
    }
    return true;
  }

  /**
   * Similarity-guided variant of `createDerangementMap`: same selected tiles,
   * same "everyone moves" guarantee, but partners are chosen by descriptor
   * distance instead of at random.
   *
   * Greedy nearest-neighbour matching over a randomized visiting order:
   * each unpaired tile takes the most similar still-unpaired tile as its swap
   * partner, so a tile with no close match still gets the closest one left.
   * With an odd count the final tile joins its most similar pair as a 3-cycle.
   * The random visiting order is what keeps N_OUT variants distinct.
   *
   * Falls back to the random derangement when descriptors are unavailable.
   *
   * @param {number[]} selected unique tile indices (>= 2)
   * @param {ArrayLike<number[]>|null} descriptors indexed by tile index
   * @param {() => number} rng
   * @returns {Map<number, number>} destinationIndex → sourceIndex
   */
  function createSimilarityDerangementMap(selected, descriptors, rng) {
    const k = selected.length;
    if (k === 0) return new Map();
    if (k === 1) {
      throw new Error("Cannot derange a single tile without exceeding CHAOS.");
    }
    if (!hasDescriptorsFor(selected, descriptors)) {
      return createDerangementMap(selected, rng);
    }

    const order = shuffleInPlace(selected.slice(), rng);
    const paired = new Array(k).fill(false);
    /** @type {[number, number][]} */
    const pairs = [];
    let leftover = -1;

    for (let i = 0; i < k; i++) {
      if (paired[i]) continue;
      let best = -1;
      let bestDist = Infinity;
      for (let j = i + 1; j < k; j++) {
        if (paired[j]) continue;
        const d = descriptorDistance(descriptors[order[i]], descriptors[order[j]]);
        if (d < bestDist) {
          bestDist = d;
          best = j;
        }
      }
      if (best === -1) {
        leftover = order[i]; // odd count: nothing left to pair with
        break;
      }
      paired[i] = true;
      paired[best] = true;
      pairs.push([order[i], order[best]]);
    }

    const map = new Map();
    for (let i = 0; i < pairs.length; i++) {
      map.set(pairs[i][0], pairs[i][1]);
      map.set(pairs[i][1], pairs[i][0]);
    }

    if (leftover >= 0) {
      let bestPair = 0;
      let bestDist = Infinity;
      for (let i = 0; i < pairs.length; i++) {
        const d = Math.min(
          descriptorDistance(descriptors[leftover], descriptors[pairs[i][0]]),
          descriptorDistance(descriptors[leftover], descriptors[pairs[i][1]])
        );
        if (d < bestDist) {
          bestDist = d;
          bestPair = i;
        }
      }
      const a = pairs[bestPair][0];
      const b = pairs[bestPair][1];
      map.set(leftover, a);
      map.set(a, b);
      map.set(b, leftover);
    }

    map.forEach(function (source, dest) {
      if (source === dest) {
        throw new Error("Internal error: derangement produced a fixed point.");
      }
    });
    return map;
  }

  /**
   * Build a dest→source map for selected positions (derangement among selected only).
   * Unselected positions are omitted (identity implied).
   *
   * @param {number[]} selected sorted or unsorted unique tile indices
   * @param {() => number} rng
   * @returns {Map<number, number>} destinationIndex → sourceIndex
   */
  function createDerangementMap(selected, rng) {
    const k = selected.length;
    if (k === 0) return new Map();
    if (k === 1) {
      throw new Error("Cannot derange a single tile without exceeding CHAOS.");
    }

    const slots = range(k);
    sattoloShuffle(slots, rng);

    const map = new Map();
    for (let i = 0; i < k; i++) {
      const dest = selected[i];
      const source = selected[slots[i]];
      if (dest === source) {
        throw new Error("Internal error: derangement produced a fixed point.");
      }
      map.set(dest, source);
    }
    return map;
  }

  /**
   * Full permutation as array: result[dest] = source tile index.
   * Length = total tiles; identity outside the derangement map.
   */
  function buildSourceForDest(tiles, derangementMap) {
    const arr = range(tiles);
    derangementMap.forEach((source, dest) => {
      arr[dest] = source;
    });
    return arr;
  }

  /**
   * One independent shuffle plan for a single output variant.
   *
   * `options.descriptors` (one small numeric vector per tile index, e.g. average
   * RGB) switches partner selection to similarity-guided pairing — "subtle
   * chaos". Everything else (affected count, CHAOS ceiling, eligibility, the
   * guarantee that every selected tile moves) is identical either way.
   *
   * @param {number} tiles
   * @param {number} chaos
   * @param {() => number} rng
   * @param {number[]|null|undefined} eligible  null/undefined = all tiles
   * @param {{ descriptors?: ArrayLike<number[]>|null }} [options]
   * @returns {{
   *   affectedCount: number,
   *   selected: number[],
   *   sourceForDest: number[],
   *   moved: boolean,
   *   eligibleCount: number,
   *   pairing: "none" | "random" | "similar",
   *   reason?: string
   * }}
   */
  function planShuffle(tiles, chaos, rng, eligible, options) {
    const descriptors = (options && options.descriptors) || null;

    function unchanged(eligibleCount, reason) {
      return {
        affectedCount: 0,
        selected: [],
        sourceForDest: range(tiles),
        moved: false,
        eligibleCount,
        pairing: "none",
        reason,
      };
    }

    if (tiles < 2) {
      return unchanged(tiles, "Only one tile exists; no rearrangement is possible.");
    }

    const pool = resolveEligibleIndices(tiles, eligible);
    const eligibleCount = pool.length;

    if (eligibleCount === 0) {
      return unchanged(
        0,
        "No tiles were touched by the brush; producing an unchanged result."
      );
    }

    const raw = Math.floor(eligibleCount * chaos);
    const affectedCount = affectedTileCount(eligibleCount, chaos);

    if (affectedCount === 0) {
      const reason =
        raw === 1
          ? "Fewer than two tiles can be moved without exceeding the requested CHAOS value (one tile alone cannot move)."
          : "CHAOS selects fewer than two tiles; producing an unchanged result.";
      return unchanged(eligibleCount, reason);
    }

    const selected = selectFromPool(pool, affectedCount, rng);
    const similar = hasDescriptorsFor(selected, descriptors);
    const map = similar
      ? createSimilarityDerangementMap(selected, descriptors, rng)
      : createDerangementMap(selected, rng);
    return {
      affectedCount,
      selected,
      sourceForDest: buildSourceForDest(tiles, map),
      moved: true,
      eligibleCount,
      pairing: similar ? "similar" : "random",
    };
  }

  /**
   * Validate UI / CLI parameters against image dimensions.
   * @returns {{ ok: true } | { ok: false, error: string }}
   */
  function validateParams(opts) {
    const { isJpeg, width, height, hor, ver, chaos, nOut } = opts;

    if (!isJpeg) {
      return { ok: false, error: "Input must be a JPEG image (.jpg / .jpeg)." };
    }
    if (!Number.isInteger(hor) || hor < 1) {
      return { ok: false, error: "HOR must be an integer >= 1." };
    }
    if (!Number.isInteger(ver) || ver < 1) {
      return { ok: false, error: "VER must be an integer >= 1." };
    }
    if (width != null && hor > width) {
      return { ok: false, error: "HOR cannot exceed image width in pixels." };
    }
    if (height != null && ver > height) {
      return { ok: false, error: "VER cannot exceed image height in pixels." };
    }
    if (typeof chaos !== "number" || Number.isNaN(chaos) || chaos < 0 || chaos > 1) {
      return { ok: false, error: "CHAOS must be a number between 0 and 1 (inclusive)." };
    }
    if (!Number.isInteger(nOut) || nOut < 1) {
      return { ok: false, error: "N_OUT must be an integer >= 1." };
    }
    return { ok: true };
  }

  /**
   * Format CHAOS for filenames (e.g. 0.25, 1, 0.1).
   */
  function formatChaosForFilename(chaos) {
    const s = String(Number(chaos));
    return s;
  }

  /**
   * @param {string} originalName e.g. "portrait.jpg"
   * @param {number} hor
   * @param {number} ver
   * @param {number} chaos
   * @param {number} variantIndex 1-based
   */
  function generateFilename(originalName, hor, ver, chaos, variantIndex) {
    const base = originalName.replace(/\.[^.\\/]+$/, "") || "image";
    const nnn = String(variantIndex).padStart(3, "0");
    const c = formatChaosForFilename(chaos);
    return `${base}_shuffle_${hor}x${ver}_c${c}_${nnn}.jpg`;
  }

  /**
   * Assert helpers used by tests (and optional debug).
   */
  function assertPermutationValid(selected, sourceForDest) {
    const selectedSet = new Set(selected);
    const sources = [];
    const dests = [];
    for (const dest of selected) {
      const source = sourceForDest[dest];
      if (!selectedSet.has(source)) {
        throw new Error("Source index not in selected set.");
      }
      if (source === dest) {
        throw new Error("Fixed point in derangement.");
      }
      sources.push(source);
      dests.push(dest);
    }
    if (new Set(sources).size !== selected.length) {
      throw new Error("Duplicate source in permutation.");
    }
    // Outside selection must be identity
    for (let i = 0; i < sourceForDest.length; i++) {
      if (!selectedSet.has(i) && sourceForDest[i] !== i) {
        throw new Error("Unselected tile was moved.");
      }
    }
    return true;
  }

  const api = {
    createRng,
    createUnseededRng,
    parseSeed,
    calculateGrid,
    tileOrigin,
    affectedTileCount,
    circleIntersectsRect,
    eligibleTilesFromStamps,
    stampsFromStroke,
    eligibleTilesFromStrokes,
    resolveEligibleIndices,
    selectFromPool,
    sattoloShuffle,
    shuffleInPlace,
    descriptorDistance,
    hasDescriptorsFor,
    createDerangementMap,
    createSimilarityDerangementMap,
    buildSourceForDest,
    planShuffle,
    validateParams,
    generateFilename,
    formatChaosForFilename,
    assertPermutationValid,
  };

  global.PhotoShuffleCore = api;

  // Node / CommonJS for headless unit tests
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
