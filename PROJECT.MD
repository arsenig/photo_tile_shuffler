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

Local artistic utility: take a high-resolution JPEG, divide it into a rectangular grid, randomly rearrange a configurable fraction of tiles (derangement among selected cells only), and export multiple independently randomized full-resolution JPEG variants.

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
| `shuffle-core.js` | Pure algorithm: grid, CHAOS math, brush-eligible tiles, selection, derangement, seed/RNG, filenames, validation |
| `shuffle-image.js` | Browser image I/O: load, render tiles to canvas, JPEG encode, sequential multi-variant generation |
| `preview.js` | Input photo preview, grid overlay, round brush painting, checkerboard mask display |
| `tests.html` | In-browser unit tests for core |
| `run-tests.js` | Same core tests via Node (`node run-tests.js`) |
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
| `N_OUT` | Number of independent output variants | Integer ≥ 1 |
| `SEED` | Optional reproducibility seed | Empty → crypto/`Math.random`; numeric string → uint32; other string → stable FNV-ish hash |

`TILES = HOR × VER`

**Eligible pool**

- No brush paint → `ELIGIBLE = TILES` (every tile; original behavior).
- Any brush paint → `ELIGIBLE` = number of tiles whose rectangle **intersects** any brush stamp (circle). Paint on the cropped-off right/bottom strip does not touch tiles.
- Brush paint that hits zero tiles → `ELIGIBLE = 0` → no moves (this is not the same as “no selection”).

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
4. Build a **derangement** among those sampled positions only (`createDerangementMap` via **Sattolo’s algorithm**).
5. Produce `sourceForDest[dest] = source` (identity outside the sampled set).

Brush stamps are circles in **source image pixel space** (top-left origin, aligned with the crop). A tile is touched if the circle intersects the tile rectangle.

Each pointer stroke is independent: lifting the pointer and painting again starts a new, disconnected region (e.g. upper-left and lower-right). The preview paints strokes onto an incremental mask; it does not join all stamps into one path. Eligibility is sampled from stroke points as `{x, y, r}` — not a full-resolution bitmap.

Invariants for every plan:

- No tile lost or duplicated (permutation of sources).
- Unselected positions stay identity.
- Every selected tile **moves** (`source ≠ dest` for all selected dests).
- Moved count never exceeds CHAOS budget.

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

Controls: file picker, HOR, VER, CHAOS (range + label), N_OUT, optional SEED, Generate.

After a JPEG is loaded, show the input photo on screen with:

- Grid lines for the current HOR×VER (on the cropped region).
- A **round, resizable** brush to paint regions that may be shuffled.
- Painted regions as a **semi-transparent checkerboard**.
- **Clear selection** to discard the brush mask and start over (then all tiles are eligible again).

The preview may be CSS/canvas-scaled for display. Brush stamps and tile eligibility stay in full image pixel space.

Before generate, show: source size, post-crop size, grid, tile count, tile size, eligible tile count, CHAOS, affected tile count, crop note / single-tile / CHAOS&lt;2 / brush notes.

After generate: numbered variants (`Variant 001` …), CSS-scaled preview, Save JPEG per variant.

Validation errors surface clearly (non-JPEG, bad HOR/VER/CHAOS/N_OUT, HOR/VER vs dimensions, zero-size tiles).

---

## Testing expectations

Core tests (see `tests.html` / `run-tests.js`) cover at least:

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

---

## Design decisions to preserve

1. **Vanilla JS + classic scripts** — portable `file://` copy to Mac; no npm/build required for the app itself.
2. **Separation: core / image / UI** — keep `planShuffle` and friends pure.
3. **Sattolo derangement** — guaranteed no fixed points among selected tiles (n ≥ 2); do not use a plain Fisher–Yates that can leave tiles unmoved.
4. **CHAOS ceiling is hard** — never “round up” moves; the one-tile case becomes zero moves with an explanation.
5. **Sequential encode** — do not retain a stack of full-res canvases for all variants.
6. **Globals `PhotoShuffleCore` / `PhotoShuffleImage`** — also `module.exports` from core for Node tests.
7. **Dark, simple functional UI** — not a marketing landing page; clarity over decoration.

---

## Known limits / future work

- Very large images may hit browser canvas memory/size limits (especially older Safari). If that becomes common for users, reconsider a Python CLI path and document the cutoff.
- JPEG magic-byte validation is light (MIME/extension); stricter sniffing could be added.
- EXIF/metadata round-trip is not implemented.
- Outputs with CHAOS that yields 0 moves are intentionally identical (re-encode only).
- No drag-and-drop or progress cancel yet.
- No ZIP download of all variants.
- Brush is paint-only (no eraser besides Clear selection).

When changing behavior, update this file and extend `tests.html` / `run-tests.js` accordingly.
