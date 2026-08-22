# Photo Tile Shuffle — Project Notes

Living reference for future iterations. Prefer updating this file when behavior or architecture changes.

### Authority

This file describes **product behavior** and **architectural intent**.

If implementation and `PROJECT.MD` disagree:

1. **Do not silently change product behavior** to match either side.
2. **Identify the discrepancy first** (what the doc says vs what the code does).
3. Only then decide — with explicit intent — whether to fix the code, update this document, or both.

Bug fixes that restore documented behavior are fine once the mismatch is stated. Spec changes belong in this file before or together with code changes.

---

## Purpose

Local artistic utility: take a high-resolution JPEG, divide it into a rectangular grid, rearrange a configurable fraction of tiles (derangement among selected cells only), and export multiple independently randomized full-resolution JPEG variants. Rearrangement is fully random by default, or similarity-guided ("subtle chaos") when the user asks for a more visually coherent disturbance.

All processing is local. No upload, no backend, no build step.

---

## Approach decision

**Chosen: standalone browser HTML/JS app** (not a CLI).

Rationale:

- Modern Chrome/Safari canvases handle typical DSLR sizes (e.g. 6000×4000 and larger within common canvas limits).
- Pixel-aligned `drawImage` with equal src/dest sizes avoids tile resampling.
- `canvas.toBlob('image/jpeg', 0.97)` provides a single high-quality encode pass.
- `createImageBitmap(file, { imageOrientation: 'from-image' })` applies EXIF orientation when supported.
- Classic `<script>` tags (not ES modules) so opening `index.html` via `file://` works on Windows and macOS.

**Fallback (not implemented):** portable Python CLI if browser canvas size/quality limits become blocking for target images. Prefer keeping the HTML app unless that happens.

Out of scope: platform-native apps, servers, frameworks, bundlers.

---

## File layout

| File | Responsibility |
|------|----------------|
| `index.html` | UI markup + styles |
| `app.js` | UI wiring only (file pick, preview/brush events, validation display, generate loop callbacks, downloads) |
| `shuffle-core.js` | Pure algorithm: grid, CHAOS math, brush-eligible tiles, selection, derangement (random + similarity-guided), descriptor distance, seed/RNG, filenames, validation |
| `shuffle-image.js` | Browser image I/O: load, per-tile colour descriptors, render tiles to canvas, JPEG encode, sequential multi-variant generation |
| `preview.js` | Input photo preview, grid overlay, round brush paint/erase, tile-snapped mask |
| `core-tests.js` | Shared PhotoShuffleCore assertions (browser + Node) |
| `tests.html` | In-browser runner for `core-tests.js` |
| `run-tests.js` | Node runner (`node run-tests.js`) |
| `PROJECT.MD` | This document |

Keep algorithm logic out of `app.js`. Core must remain unit-testable without DOM/canvas.

---

## Inputs

| Parameter | Meaning | Constraints |
|-----------|---------|-------------|
| `INPUT` | Source JPEG | JPEG only; high-res photo expected (20–50+ MP possible) |
| `HOR` | Columns | Integer ≥ 1; ≤ image width (px) |
| `VER` | Rows | Integer ≥ 1; ≤ image height (px) |
| `CHAOS` | Fraction of tiles that may move | `0 ≤ CHAOS ≤ 1` |
| `SUBTLE` | "apply subtle chaos" — pair tiles by visual similarity instead of at random | Checkbox; default **off** |
| `N_OUT` | Number of independent output variants | Integer ≥ 1 |
| `SEED` | Optional reproducibility seed | Empty → crypto/`Math.random`; numeric string → uint32; other string → stable FNV-ish hash |

`TILES = HOR × VER`

**Eligible pool**

- No brush mask → `ELIGIBLE = TILES` (every tile; original behavior).
- A mask is active when at least one tile is selected, or when paint landed only on the cropped-off strip (zero tiles).
- A tile is selected if a **paint** stamp’s circle intersects that tile rectangle. A later **erase** stamp that intersects the same tile deselects it. Strokes apply in order.
- Erasing every selected tile returns to “no mask” (`ELIGIBLE = TILES`). Paint that never hits a tile (crop strip only) → `ELIGIBLE = 0` → no moves.
- Paint/erase on the cropped-off right/bottom strip does not touch tiles.

`AFFECTED_TILES = floor(ELIGIBLE × CHAOS)`, then:

- If `AFFECTED_TILES < 2` → treat as **0 moves** (one tile cannot move alone without changing another, which would exceed CHAOS).
- If `TILES == 1` → no rearrangement possible.

Never move more tiles than `floor(ELIGIBLE × CHAOS)` allows. Untouched tiles never move when a brush mask is active.

This is an intentional spec change from v1, which always used `floor(TILES × CHAOS)`.

---

## Core algorithm

### 1. Grid / crop

- Do **not** scale the photo to fit the grid.
- If width/height are not divisible by HOR/VER, crop the **minimum** excess from the **right** and/or **bottom**.
- All tiles share identical pixel size: `tileWidth = cropWidth / HOR`, `tileHeight = cropHeight / VER`.
- Tile index order is **row-major** (left→right, top→bottom).

Implemented as `calculateGrid()` / `tileOrigin()` in `shuffle-core.js`.

### 2. Per-output plan (`planShuffle`)

For each of `N_OUT` variants, independently (always from the **original** loaded image, never from a previous output):

1. Resolve the eligible tile index set (all tiles, or brush-touched tiles).
2. Compute affected count from **eligible count × CHAOS** (with `< 2` → 0 rule).
3. Uniformly sample that many **unique** indices from the eligible set only (`selectFromPool` — partial Fisher–Yates).
4. Build a **derangement** among those sampled positions only — `createDerangementMap` (**Sattolo’s algorithm**) by default, or `createSimilarityDerangementMap` when subtle chaos supplies tile descriptors.
5. Produce `sourceForDest[dest] = source` (identity outside the sampled set).

Steps 1–3 are identical in both modes: subtle chaos changes **who swaps with whom**, never how many tiles move or which ones are eligible. The returned plan reports `pairing: "none" | "random" | "similar"` so the UI can state what actually happened.

Brush stamps are circles in **source image pixel space** (top-left origin, aligned with the crop). A tile is touched if the circle intersects the tile rectangle. Eligibility is sampled from stroke points as `{x, y, r, erase}` — not a freehand bitmap.

Each pointer stroke is independent. Left-drag **paints** (adds tiles); right-drag **erases** (removes tiles). On Mac, Command-click (drag) erases. The preview shows the **whole tile** as masked once any stamp touches it (snap-to-grid). Changing HOR/VER recomputes which tiles the same strokes hit.

Invariants for every plan:

- No tile lost or duplicated (permutation of sources).
- Unselected positions stay identity.
- Every selected tile **moves** (`source ≠ dest` for all selected dests).
- Moved count never exceeds CHAOS budget.

### 2b. Subtle chaos (similarity-guided pairing)

Off by default. When on, tiles still move exactly as CHAOS dictates, but each one lands on a **visually similar** tile instead of an arbitrary one: sky swaps with sky, grass with grass, brick with brick.

**Descriptor** — `computeTileDescriptors()` renders the cropped image onto a throwaway `hor × ver` canvas (one pixel per tile) and reads back `[r, g, b]` averages in 0–255. Downscaling proceeds by **halving** rather than one huge-to-tiny `drawImage`, because a single extreme downscale aliases in some browsers and would sample a few pixels instead of averaging the tile. Descriptors depend only on the image and the grid, so they are computed **once per generation run** and reused by all `N_OUT` variants. The export canvas is never involved — output resolution and the single JPEG encode are untouched.

**Distance** — `descriptorDistance()` is a luma-weighted squared RGB distance (`0.299 / 0.587 / 0.114`). One descriptor form covers both cases the spec asks for: a grayscale tile has `r == g == b`, so the formula collapses to a monotone function of the brightness difference. Descriptors of other lengths fall back to plain squared distance, which keeps single-channel brightness descriptors usable in tests.

**Pairing** — greedy nearest-neighbour matching over a *randomized* visiting order:

1. Shuffle the selected tiles (this is the only source of variety, and it is what keeps the `N_OUT` variants distinct).
2. Walk the list; each still-unpaired tile takes the most similar still-unpaired tile as its swap partner (a 2-cycle).
3. With an odd count, the final tile has nobody left. It joins its most similar existing pair as a **3-cycle**, so it moves too.

Consequences, in spec terms: a tile with no good match is not left behind — it simply gets the closest candidate still available, which may be a poor one. The result is deliberately **not** a global optimum; greedy matching is cheap, predictable, and visually sufficient. Cost is `O(k²)` in the affected tile count `k`, which is negligible for realistic grids.

**Fallback** — if descriptors are missing or unreadable (e.g. `getImageData` throws on a tainted canvas), `computeTileDescriptors()` returns `null`, pairing silently reverts to the random Sattolo derangement, and the plan reports `pairing: "random"` so the UI can say so. The feature degrades; it never fails the run.

All step-2 invariants hold unchanged in this mode: permutation, identity outside the selection, no fixed points, CHAOS ceiling respected.

### 3. Render + encode

- One reusable canvas per generation run; full cropped resolution.
- Copy tiles with `drawImage` at integer origins; `imageSmoothingEnabled = false`.
- Encode **once** per variant: JPEG quality **0.97** (`DEFAULT_JPEG_QUALITY`).
- Clear canvas pixel buffer (`width/height = 0`) between variants to limit memory growth.
- Previews use object URLs; CSS may scale display; blobs remain full-res for download.

### 4. Output filenames

```text
<original-basename>_shuffle_<HOR>x<VER>_c<CHAOS>_<NNN>.jpg
```

Example: `portrait_shuffle_10x8_c0.25_001.jpg`

---

## Randomness & reproducibility

- Seeded path: **Mulberry32** (`createRng`).
- Unseeded path: `crypto.getRandomValues` when available, else `Math.random`.
- With a seed, one RNG instance is advanced across all `N_OUT` plans in order → same inputs + seed ⇒ same **sequence** of permutations.
- Without a seed, runs should differ.
- Subtle chaos stays seed-reproducible: the tile descriptors are deterministic, and the only random ingredient is the visiting order drawn from the same RNG. Note that toggling the checkbox changes how much RNG each plan consumes, so a given seed produces different (though individually stable) results in the two modes.

---

## Image quality & orientation

Priorities (in order):

1. Full pixel resolution (no intentional downscale).
2. Pixel-aligned tile moves; no per-tile interpolate/rescale.
3. Single final JPEG encode at high quality (~95–98%; implemented as 0.97).
4. Visual orientation matches input, including EXIF orientation when the browser applies it.
5. EXIF metadata preservation — **desirable but not required** in v1.

Untouched tiles will still be re-encoded in the final JPEG pass (unavoidable for a whole-image export).

---

## UI requirements (current)

Controls: file picker, HOR, VER, CHAOS (range + label), **apply subtle chaos** (checkbox, directly under the CHAOS slider, unchecked by default), N_OUT, optional SEED, Generate.

After a JPEG is loaded, show the input photo on screen with:

- Grid lines for the current HOR×VER (on the cropped region).
- A **round, resizable** brush. Left-drag paints tiles that may be shuffled; right-drag (Command-click drag on Mac) erases them.
- Touched tiles shown as a **full-tile** semi-transparent checkerboard (not a freehand trail).
- `[` / `]` shrink / grow the brush (physical keys, so Russian `х` / `ъ` work too). Radius ranges from **1** to 90 CSS px; steps are 1 below 10 and 4 above.
- `Ctrl+Z` / `Cmd+Z` undoes the **last drag** (paint or erase) as a whole, restoring the tile selection to its state before that drag. Repeating walks further back. There is no redo.
- Keyboard shortcuts are ignored while a text or number field is focused, so `Ctrl+Z` in SEED stays native text undo. Starting a drag on the preview takes focus off such a field, so shortcuts work right after painting without a separate click.
- **Clear selection** to discard the brush mask and start over (then all tiles are eligible again). This also discards undo history and cannot itself be undone.

The preview may be CSS/canvas-scaled for display. Brush stamps and tile eligibility stay in full image pixel space.

Before generate, show: source size, post-crop size, grid, tile count, tile size, eligible tile count, CHAOS, subtle-chaos state, affected tile count, crop note / single-tile / CHAOS&lt;2 / brush notes.

After generate: numbered variants (`Variant 001` …), CSS-scaled preview, Save JPEG per variant. A variant whose plan used similarity pairing is labelled `Moved N tiles (swapped with visually similar tiles)`. If subtle chaos was requested but descriptors could not be read, the status line says so and the run continues with random swaps.

Validation errors surface clearly (non-JPEG, bad HOR/VER/CHAOS/N_OUT, HOR/VER vs dimensions, zero-size tiles).

---

## Testing expectations

Core tests live in `core-tests.js` (see `tests.html` / `run-tests.js`) and cover at least:

- Grid tile count (e.g. 5×4 → 20).
- Minimal right/bottom crop.
- CHAOS = 0 → identity.
- CHAOS = 1 (tiles &gt; 1) → every tile moves.
- Partial CHAOS (100 @ 0.20 → exactly 20 moved, 80 fixed).
- Rounding (`floor(48 × 0.10) = 4`).
- Single affected tile → 0 moves.
- Derangement / permutation invariants.
- Seed reproducibility.
- Filename pattern.
- Parameter validation.
- No brush mask ≡ sample from all tiles.
- Brush-eligible subset: only those indices may move; CHAOS is a fraction of the eligible set.
- Empty eligible set → zero moves.
- Circle/tile intersection used to mark touched tiles.
- Paint then erase of the same tiles returns to no mask; crop-strip-only paint yields an empty eligible set.
- Paint then erase of the same tile → no mask.
- Erase-only strokes → no mask.
- Sequential paint / erase / paint restores the tile.
- Subtle chaos, grayscale: swaps stay inside a brightness cluster.
- Subtle chaos, colour: swaps stay inside a hue group even when the groups share luminance.
- Subtle chaos, odd affected count: the leftover tile still moves (3-cycle).
- Subtle chaos, no clusters at all: every tile still gets swapped with the nearest remaining candidate.
- Subtle vs random on the same seed: identical `selected` set and affected count, lower total descriptor distance.
- Subtle chaos is seed-reproducible, and consecutive variants from one RNG differ.
- Missing/partial descriptors → `pairing: "random"` fallback that still moves every selected tile.
- Subtle chaos respects the brush mask.
- `descriptorDistance` basics (identity, ordering, missing descriptor → `Infinity`).

---

## Design decisions to preserve

1. **Vanilla JS + classic scripts** — portable `file://` copy to Mac; no npm/build required for the app itself.
2. **Separation: core / image / UI** — keep `planShuffle` and friends pure.
3. **Sattolo derangement** — guaranteed no fixed points among selected tiles (n ≥ 2); do not use a plain Fisher–Yates that can leave tiles unmoved. Subtle chaos builds its own derangement (pairs + one optional 3-cycle) and carries the same guarantee.
4. **Subtle chaos is a pairing strategy, nothing more** — it must never touch selection, eligibility, the CHAOS ceiling, resolution, or encode settings. Off ⇒ byte-identical behaviour to the pre-feature app.
5. **CHAOS ceiling is hard** — never “round up” moves; the one-tile case becomes zero moves with an explanation.
6. **Sequential encode** — do not retain a stack of full-res canvases for all variants.
7. **Globals `PhotoShuffleCore` / `PhotoShuffleImage`** — also `module.exports` from core for Node tests.
8. **Dark, simple functional UI** — not a marketing landing page; clarity over decoration.

---

## Known limits / future work

- Very large images may hit browser canvas memory/size limits (especially older Safari). If that becomes common for users, reconsider a Python CLI path and document the cutoff.
- JPEG magic-byte validation is light (MIME/extension); stricter sniffing could be added.
- EXIF/metadata round-trip is not implemented.
- Outputs with CHAOS that yields 0 moves are intentionally identical (re-encode only).
- No drag-and-drop or progress cancel yet.
- No ZIP download of all variants.
- Brush erase uses right-click or Mac Command-click; there is no separate eraser tool.
- Undo is stroke-granular and one-directional: no redo (`Ctrl+Y`), and **Clear selection** is not undoable.
- Subtle chaos pairing is greedy, not globally optimal; the last few tiles processed take whatever partner is left, so a handful of weak matches per variant is expected and intended.
- Subtle chaos compares whole-tile averages only. Two tiles with the same average but different structure (e.g. a smooth gray and a black/white checker) count as similar.
- Pairing cost is `O(k²)` in affected tiles. Fine for realistic grids; a very large grid at CHAOS 1 would need a spatial index or a coarse bucket pass.
- Descriptors are read back with `getImageData`, which can throw on a tainted canvas in exotic setups; that path falls back to random swaps rather than failing.

When changing behavior, update this file and extend `tests.html` / `run-tests.js` accordingly.
