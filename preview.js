/**
 * Photo Tile Shuffle — input preview, grid overlay, round brush mask.
 * Paint/erase select whole tiles; the overlay fills those tiles, not the freehand path.
 */
(function (global) {
  "use strict";

  const Core = global.PhotoShuffleCore;
  const BRUSH_NUDGE = 4;

  /**
   * @param {object} opts
   * @param {HTMLElement} opts.stage
   * @param {HTMLElement} opts.wrap
   * @param {HTMLCanvasElement} opts.photo
   * @param {HTMLCanvasElement} opts.overlay
   * @param {HTMLInputElement} opts.brushSize
   * @param {HTMLElement} opts.brushSizeValue
   * @param {HTMLButtonElement} opts.clear
   * @param {() => void} [opts.onChange]
   */
  function createPreview(opts) {
    const stage = opts.stage;
    const wrap = opts.wrap;
    const photoCanvas = opts.photo;
    const overlay = opts.overlay;
    const brushSizeEl = opts.brushSize;
    const brushSizeValue = opts.brushSizeValue;
    const clearBtn = opts.clear;
    const onChange = opts.onChange || function () {};

    /** @type {CanvasImageSource|null} */
    let image = null;
    let imageWidth = 0;
    let imageHeight = 0;
    /** @type {object|null} */
    let grid = null;

    /** @type {{ r: number, erase: boolean, points: { x: number, y: number }[] }[]} */
    let strokes = [];
    /** @type {{ r: number, erase: boolean, points: { x: number, y: number }[] }|null} */
    let currentStroke = null;
    let painting = false;
    let hover = null;
    let hoverErase = false;

    /** @type {Set<number>} */
    let selected = new Set();
    /** True when paint strokes exist but none ever hit a tile (crop strip only). */
    let cropOnlyPaint = false;

    let checkerPattern = null;
    let checkerKey = "";

    function brushCssRadius() {
      return Number(brushSizeEl.value) || 28;
    }

    function updateBrushLabel() {
      brushSizeValue.textContent = String(Math.round(brushCssRadius()));
    }

    function imageRadiusFromCss() {
      const cssW = overlay.getBoundingClientRect().width;
      if (!cssW || !imageWidth) return 20;
      return brushCssRadius() * (imageWidth / cssW);
    }

    function clientToImage(clientX, clientY) {
      const rect = overlay.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {
        x: ((clientX - rect.left) / rect.width) * imageWidth,
        y: ((clientY - rect.top) / rect.height) * imageHeight,
      };
    }

    function isEraseEvent(ev) {
      if (ev.button === 2) return true;
      if (ev.button === 0 && ev.metaKey) return true;
      return false;
    }

    function scale() {
      return {
        sx: overlay.width / imageWidth,
        sy: overlay.height / imageHeight,
      };
    }

    function getChecker(ctx) {
      const dpr = window.devicePixelRatio || 1;
      const cell = Math.max(8, Math.round(10 * dpr));
      const key = cell + ":" + ctx.canvas.width + "x" + ctx.canvas.height;
      if (checkerPattern && checkerKey === key) return checkerPattern;
      const tile = document.createElement("canvas");
      tile.width = cell * 2;
      tile.height = cell * 2;
      const t = tile.getContext("2d");
      t.fillStyle = "rgba(15, 15, 18, 0.5)";
      t.fillRect(0, 0, cell, cell);
      t.fillRect(cell, cell, cell, cell);
      t.fillStyle = "rgba(250, 250, 250, 0.5)";
      t.fillRect(cell, 0, cell, cell);
      t.fillRect(0, cell, cell, cell);
      checkerPattern = ctx.createPattern(tile, "repeat");
      checkerKey = key;
      return checkerPattern;
    }

    function rebuildSelection() {
      selected = new Set();
      cropOnlyPaint = false;
      if (!grid || !Core) return;
      const eligible = Core.eligibleTilesFromStrokes(grid, strokes);
      if (eligible == null) return;
      if (eligible.length === 0) {
        cropOnlyPaint = true;
        return;
      }
      for (let i = 0; i < eligible.length; i++) selected.add(eligible[i]);
    }

    function getEligibleTiles() {
      if (!grid || !Core) return null;
      return Core.eligibleTilesFromStrokes(grid, strokes);
    }

    function getStrokes() {
      return strokes;
    }

    function hasPaint() {
      return selected.size > 0 || cropOnlyPaint;
    }

    function resizeCanvases() {
      if (!image || !imageWidth || !imageHeight) return;
      const maxW = wrap.clientWidth || stage.clientWidth || 0;
      if (!maxW) {
        requestAnimationFrame(resizeCanvases);
        return;
      }
      const maxH = Math.min(window.innerHeight * 0.7, 720);
      let cssW = maxW;
      let cssH = (imageHeight / imageWidth) * cssW;
      if (cssH > maxH) {
        cssH = maxH;
        cssW = (imageWidth / imageHeight) * cssH;
      }
      cssW = Math.max(1, Math.round(cssW));
      cssH = Math.max(1, Math.round(cssH));

      const dpr = window.devicePixelRatio || 1;
      const pw = Math.max(1, Math.round(cssW * dpr));
      const ph = Math.max(1, Math.round(cssH * dpr));
      [photoCanvas, overlay].forEach((c) => {
        if (c.width !== pw || c.height !== ph) {
          c.width = pw;
          c.height = ph;
        }
        c.style.width = cssW + "px";
        c.style.height = cssH + "px";
      });
      wrap.style.height = cssH + "px";
      checkerPattern = null;
      drawPhoto();
      drawOverlay();
    }

    function drawPhoto() {
      const ctx = photoCanvas.getContext("2d");
      if (!ctx || !image) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
      ctx.drawImage(image, 0, 0, photoCanvas.width, photoCanvas.height);
    }

    function drawOverlay() {
      const ctx = overlay.getContext("2d");
      if (!ctx) return;
      const w = overlay.width;
      const h = overlay.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!imageWidth || !imageHeight) return;

      const { sx, sy } = scale();

      if (grid && selected.size > 0) {
        ctx.save();
        ctx.fillStyle = getChecker(ctx) || "rgba(250,250,250,0.45)";
        selected.forEach(function (index) {
          const origin = Core.tileOrigin(index, grid.hor, grid.tileWidth, grid.tileHeight);
          ctx.fillRect(
            origin.x * sx,
            origin.y * sy,
            grid.tileWidth * sx,
            grid.tileHeight * sy
          );
        });
        ctx.restore();
      }

      if (grid && (grid.cropRight || grid.cropBottom || grid.cropWidth < imageWidth)) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
        if (grid.cropWidth < imageWidth) {
          ctx.fillRect(grid.cropWidth * sx, 0, w - grid.cropWidth * sx, h);
        }
        if (grid.cropHeight < imageHeight) {
          ctx.fillRect(0, grid.cropHeight * sy, grid.cropWidth * sx, h - grid.cropHeight * sy);
        }
      }

      if (grid) {
        ctx.strokeStyle = "rgba(255, 214, 80, 0.85)";
        ctx.lineWidth = Math.max(1, window.devicePixelRatio || 1);
        ctx.beginPath();
        for (let c = 0; c <= grid.hor; c++) {
          const x = c * grid.tileWidth * sx + 0.5;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, grid.cropHeight * sy);
        }
        for (let r = 0; r <= grid.ver; r++) {
          const y = r * grid.tileHeight * sy + 0.5;
          ctx.moveTo(0, y);
          ctx.lineTo(grid.cropWidth * sx, y);
        }
        ctx.stroke();
      }

      if (hover) {
        const erasing = hoverErase || (currentStroke && currentStroke.erase);
        ctx.beginPath();
        ctx.strokeStyle = erasing ? "rgba(229, 115, 115, 0.95)" : "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = Math.max(1.5, window.devicePixelRatio || 1);
        ctx.ellipse(
          hover.x * sx,
          hover.y * sy,
          hover.r * sx,
          hover.r * sy,
          0,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }
    }

    function appendPoint(pos) {
      if (!currentStroke) return;
      const pts = currentStroke.points;
      const r = currentStroke.r;
      const prev = pts.length ? pts[pts.length - 1] : null;
      if (prev) {
        const minDist = Math.max(1, r * 0.15);
        if (Math.hypot(pos.x - prev.x, pos.y - prev.y) < minDist) return;
      }
      pts.push(pos);
      const before = selected.size;
      const beforeCrop = cropOnlyPaint;
      rebuildSelection();
      drawOverlay();
      if (selected.size !== before || cropOnlyPaint !== beforeCrop) onChange();
    }

    function onPointerDown(ev) {
      if (!image) return;
      if (ev.button !== 0 && ev.button !== 2) return;
      ev.preventDefault();
      overlay.setPointerCapture(ev.pointerId);
      painting = true;
      const erase = isEraseEvent(ev);
      hoverErase = erase;
      const pos = clientToImage(ev.clientX, ev.clientY);
      if (!pos) return;
      currentStroke = { r: imageRadiusFromCss(), erase: erase, points: [] };
      strokes.push(currentStroke);
      hover = { x: pos.x, y: pos.y, r: currentStroke.r };
      appendPoint(pos);
    }

    function onPointerMove(ev) {
      const pos = clientToImage(ev.clientX, ev.clientY);
      hover = pos ? { x: pos.x, y: pos.y, r: imageRadiusFromCss() } : null;
      hoverErase = painting
        ? !!(currentStroke && currentStroke.erase)
        : ev.metaKey || ev.buttons === 2;
      if (painting && pos) {
        ev.preventDefault();
        appendPoint(pos);
      } else {
        drawOverlay();
      }
    }

    function endStroke(ev) {
      if (!painting) return;
      painting = false;
      currentStroke = null;
      if (ev) {
        try {
          overlay.releasePointerCapture(ev.pointerId);
        } catch (_) {}
      }
      rebuildSelection();
      drawOverlay();
      onChange();
    }

    function onPointerLeave() {
      if (!painting) {
        hover = null;
        hoverErase = false;
        drawOverlay();
      }
    }

    function setImage(img, dims) {
      image = img;
      imageWidth = dims.width;
      imageHeight = dims.height;
      strokes = [];
      currentStroke = null;
      hover = null;
      hoverErase = false;
      selected = new Set();
      cropOnlyPaint = false;
      stage.hidden = false;
      resizeCanvases();
      onChange();
    }

    function clearImage() {
      image = null;
      imageWidth = 0;
      imageHeight = 0;
      grid = null;
      strokes = [];
      currentStroke = null;
      hover = null;
      hoverErase = false;
      selected = new Set();
      cropOnlyPaint = false;
      stage.hidden = true;
    }

    function setGrid(nextGrid) {
      grid = nextGrid;
      rebuildSelection();
      drawOverlay();
    }

    function clearSelection() {
      strokes = [];
      currentStroke = null;
      selected = new Set();
      cropOnlyPaint = false;
      drawOverlay();
      onChange();
    }

    function applyBrushSize(next) {
      const min = Number(brushSizeEl.min);
      const max = Number(brushSizeEl.max);
      const lo = Number.isFinite(min) ? min : 8;
      const hi = Number.isFinite(max) ? max : 90;
      const value = Math.min(hi, Math.max(lo, next));
      brushSizeEl.value = String(value);
      updateBrushLabel();
      const r = imageRadiusFromCss();
      if (currentStroke) currentStroke.r = r;
      if (hover) hover.r = r;
      if (currentStroke) {
        rebuildSelection();
      }
      drawOverlay();
    }

    function nudgeBrush(direction) {
      applyBrushSize(brushCssRadius() + direction * BRUSH_NUDGE);
    }

    function isTypingTarget(el) {
      if (!el || !el.tagName) return false;
      const tag = el.tagName;
      if (tag === "TEXTAREA" || tag === "SELECT") return true;
      if (tag === "INPUT") {
        const type = (el.type || "text").toLowerCase();
        return type !== "range" && type !== "button" && type !== "file" && type !== "checkbox";
      }
      return !!el.isContentEditable;
    }

    function onKeyDown(ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (isTypingTarget(ev.target)) return;
      // Physical keys (US [ / ]); Russian layout types х / ъ on the same positions.
      if (ev.code === "BracketLeft" || ev.key === "[") {
        ev.preventDefault();
        nudgeBrush(-1);
      } else if (ev.code === "BracketRight" || ev.key === "]") {
        ev.preventDefault();
        nudgeBrush(1);
      }
    }

    overlay.addEventListener("pointerdown", onPointerDown);
    overlay.addEventListener("pointermove", onPointerMove);
    overlay.addEventListener("pointerup", endStroke);
    overlay.addEventListener("pointercancel", endStroke);
    overlay.addEventListener("pointerleave", onPointerLeave);
    overlay.addEventListener("contextmenu", function (ev) {
      ev.preventDefault();
    });
    brushSizeEl.addEventListener("input", function () {
      applyBrushSize(brushCssRadius());
    });
    clearBtn.addEventListener("click", clearSelection);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", () => {
      if (image) resizeCanvases();
    });

    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(() => {
        if (image) resizeCanvases();
      });
      ro.observe(stage);
    }

    updateBrushLabel();

    return {
      setImage,
      clearImage,
      setGrid,
      clearSelection,
      getEligibleTiles,
      getStrokes,
      hasPaint,
      resize: resizeCanvases,
    };
  }

  global.PhotoShufflePreview = { createPreview };
})(typeof window !== "undefined" ? window : globalThis);
