/**
 * Photo Tile Shuffle — input preview, grid overlay, round brush mask.
 * Each pointer stroke is independent; strokes are not connected to each other.
 */
(function (global) {
  "use strict";

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

    /** @type {{ r: number, points: { x: number, y: number }[] }[]} */
    let strokes = [];
    /** @type {{ r: number, points: { x: number, y: number }[] }|null} */
    let currentStroke = null;
    let painting = false;
    let hover = null;

    const mask = document.createElement("canvas");
    const maskCtx = mask.getContext("2d");
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

    function hasPaint() {
      for (let i = 0; i < strokes.length; i++) {
        if (strokes[i].points.length) return true;
      }
      return false;
    }

    function scale() {
      return {
        sx: mask.width / imageWidth,
        sy: mask.height / imageHeight,
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

    function configureMaskBrush(r) {
      const { sx } = scale();
      maskCtx.fillStyle = "#fff";
      maskCtx.strokeStyle = "#fff";
      maskCtx.lineCap = "round";
      maskCtx.lineJoin = "round";
      maskCtx.lineWidth = Math.max(1, 2 * r * sx);
    }

    function stampMaskDot(point, r) {
      const { sx, sy } = scale();
      configureMaskBrush(r);
      maskCtx.beginPath();
      maskCtx.arc(point.x * sx, point.y * sy, r * sx, 0, Math.PI * 2);
      maskCtx.fill();
    }

    function stampMaskSegment(from, to, r) {
      const { sx, sy } = scale();
      configureMaskBrush(r);
      maskCtx.beginPath();
      maskCtx.moveTo(from.x * sx, from.y * sy);
      maskCtx.lineTo(to.x * sx, to.y * sy);
      maskCtx.stroke();
    }

    function rebuildMask() {
      maskCtx.setTransform(1, 0, 0, 1, 0, 0);
      maskCtx.clearRect(0, 0, mask.width, mask.height);
      if (!imageWidth || !imageHeight) return;
      for (let s = 0; s < strokes.length; s++) {
        const stroke = strokes[s];
        const pts = stroke.points;
        if (!pts.length) continue;
        if (pts.length === 1) {
          stampMaskDot(pts[0], stroke.r);
        } else {
          stampMaskDot(pts[0], stroke.r);
          for (let i = 1; i < pts.length; i++) {
            stampMaskSegment(pts[i - 1], pts[i], stroke.r);
          }
        }
      }
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
      [photoCanvas, overlay, mask].forEach((c) => {
        if (c.width !== pw || c.height !== ph) {
          c.width = pw;
          c.height = ph;
        }
        if (c !== mask) {
          c.style.width = cssW + "px";
          c.style.height = cssH + "px";
        }
      });
      wrap.style.height = cssH + "px";
      checkerPattern = null;
      rebuildMask();
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

      const sx = w / imageWidth;
      const sy = h / imageHeight;

      if (hasPaint() && mask.width && mask.height) {
        ctx.save();
        ctx.fillStyle = getChecker(ctx) || "rgba(250,250,250,0.45)";
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(mask, 0, 0);
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
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
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
        pts.push(pos);
        stampMaskSegment(prev, pos, r);
      } else {
        pts.push(pos);
        stampMaskDot(pos, r);
      }
      drawOverlay();
    }

    function onPointerDown(ev) {
      if (!image || ev.button !== 0) return;
      ev.preventDefault();
      overlay.setPointerCapture(ev.pointerId);
      painting = true;
      const pos = clientToImage(ev.clientX, ev.clientY);
      if (!pos) return;
      currentStroke = { r: imageRadiusFromCss(), points: [] };
      strokes.push(currentStroke);
      hover = { x: pos.x, y: pos.y, r: currentStroke.r };
      appendPoint(pos);
    }

    function onPointerMove(ev) {
      const pos = clientToImage(ev.clientX, ev.clientY);
      hover = pos ? { x: pos.x, y: pos.y, r: imageRadiusFromCss() } : null;
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
      onChange();
    }

    function onPointerLeave() {
      if (!painting) {
        hover = null;
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
      mask.width = 0;
      mask.height = 0;
      stage.hidden = true;
    }

    function setGrid(nextGrid) {
      grid = nextGrid;
      drawOverlay();
    }

    function clearSelection() {
      strokes = [];
      currentStroke = null;
      if (mask.width && mask.height) {
        maskCtx.clearRect(0, 0, mask.width, mask.height);
      }
      drawOverlay();
      onChange();
    }

    /**
     * Flatten strokes to circle stamps in image space for eligibility tests.
     * Samples along each stroke so fast flicks still mark crossed tiles.
     */
    function getStamps() {
      const stamps = [];
      for (let s = 0; s < strokes.length; s++) {
        const stroke = strokes[s];
        const pts = stroke.points;
        const r = stroke.r;
        if (!pts.length) continue;
        stamps.push({ x: pts[0].x, y: pts[0].y, r });
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
      }
      return stamps;
    }

    overlay.addEventListener("pointerdown", onPointerDown);
    overlay.addEventListener("pointermove", onPointerMove);
    overlay.addEventListener("pointerup", endStroke);
    overlay.addEventListener("pointercancel", endStroke);
    overlay.addEventListener("pointerleave", onPointerLeave);
    brushSizeEl.addEventListener("input", () => {
      updateBrushLabel();
      if (hover) hover.r = imageRadiusFromCss();
      drawOverlay();
    });
    clearBtn.addEventListener("click", clearSelection);
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
      getStamps,
      hasPaint,
      resize: resizeCanvases,
    };
  }

  global.PhotoShufflePreview = { createPreview };
})(typeof window !== "undefined" ? window : globalThis);
