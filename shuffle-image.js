/**
 * Photo Tile Shuffle — image load, render, JPEG encode (browser APIs).
 */
(function (global) {
  "use strict";

  const Core = global.PhotoShuffleCore;
  const DEFAULT_JPEG_QUALITY = 0.97;

  /**
   * True if File looks like JPEG by MIME and/or extension.
   * @param {File} file
   */
  function isJpegFile(file) {
    if (!file) return false;
    const type = (file.type || "").toLowerCase();
    if (type === "image/jpeg" || type === "image/jpg") return true;
    // Some browsers leave type empty for local files
    return /\.jpe?g$/i.test(file.name || "");
  }

  /**
   * Decode image with EXIF orientation applied when the browser supports it.
   * @param {File|Blob} file
   * @returns {Promise<ImageBitmap|HTMLImageElement>}
   */
  async function loadImageOriented(file) {
    if (typeof createImageBitmap === "function") {
      try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch (_) {
        // Fall through to HTMLImageElement path
      }
    }

    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Failed to decode image."));
        el.src = url;
      });
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function imageSize(img) {
    return {
      width: img.width || img.naturalWidth,
      height: img.height || img.naturalHeight,
    };
  }

  /**
   * Render one shuffled variant onto a canvas at full cropped resolution.
   * Pixel-aligned copy only — no scaling of tiles.
   *
   * @param {CanvasImageSource} sourceImage
   * @param {ReturnType<typeof Core.calculateGrid>} grid
   * @param {number[]} sourceForDest result[dest] = source tile index
   * @param {HTMLCanvasElement} [canvas] reusable canvas
   * @returns {HTMLCanvasElement}
   */
  function renderShuffledImage(sourceImage, grid, sourceForDest, canvas) {
    const c = canvas || document.createElement("canvas");
    c.width = grid.cropWidth;
    c.height = grid.cropHeight;
    const ctx = c.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not get 2D canvas context.");

    // Integer-aligned equal-size copies — disable smoothing just in case
    ctx.imageSmoothingEnabled = false;

    // Clear / opaque fill avoids residual alpha weirdness
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, c.width, c.height);

    const { hor, tileWidth, tileHeight, tiles } = grid;

    for (let dest = 0; dest < tiles; dest++) {
      const source = sourceForDest[dest];
      const srcOrigin = Core.tileOrigin(source, hor, tileWidth, tileHeight);
      const dstOrigin = Core.tileOrigin(dest, hor, tileWidth, tileHeight);

      // Same src/dest size → browser copies pixels without resampling
      ctx.drawImage(
        sourceImage,
        srcOrigin.x,
        srcOrigin.y,
        tileWidth,
        tileHeight,
        dstOrigin.x,
        dstOrigin.y,
        tileWidth,
        tileHeight
      );
    }

    return c;
  }

  /**
   * Encode canvas to JPEG Blob once.
   * @param {HTMLCanvasElement} canvas
   * @param {number} [quality]
   * @returns {Promise<Blob>}
   */
  function encodeJpeg(canvas, quality) {
    const q = quality == null ? DEFAULT_JPEG_QUALITY : quality;
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("JPEG encoding failed (empty blob). Canvas may exceed browser limits."));
            return;
          }
          resolve(blob);
        },
        "image/jpeg",
        q
      );
    });
  }

  /**
   * Release ImageBitmap resources when applicable.
   * @param {ImageBitmap|HTMLImageElement} img
   */
  function releaseImage(img) {
    if (img && typeof img.close === "function") {
      img.close();
    }
  }

  /**
   * Generate N_OUT variants sequentially to limit memory.
   * Each variant: plan → render → encode → callback → clear canvas pixels.
   *
   * @param {object} options
   * @param {CanvasImageSource} options.sourceImage
   * @param {ReturnType<typeof Core.calculateGrid>} options.grid
   * @param {number} options.chaos
   * @param {number} options.nOut
   * @param {() => number} options.rng
   * @param {number[]|null} [options.eligible] brush-touched tile indices, or null for all
   * @param {number} [options.jpegQuality]
   * @param {(info: {
   *   index: number,
   *   blob: Blob,
   *   plan: ReturnType<typeof Core.planShuffle>,
   *   objectUrl: string
   * }) => void | Promise<void>} options.onVariant
   * @param {(progress: { current: number, total: number }) => void} [options.onProgress]
   */
  async function generateVariants(options) {
    const {
      sourceImage,
      grid,
      chaos,
      nOut,
      rng,
      eligible,
      jpegQuality,
      onVariant,
      onProgress,
    } = options;

    const canvas = document.createElement("canvas");

    for (let i = 0; i < nOut; i++) {
      if (onProgress) onProgress({ current: i + 1, total: nOut });

      const plan = Core.planShuffle(grid.tiles, chaos, rng, eligible);
      renderShuffledImage(sourceImage, grid, plan.sourceForDest, canvas);
      const blob = await encodeJpeg(canvas, jpegQuality);
      const objectUrl = URL.createObjectURL(blob);

      await onVariant({
        index: i + 1,
        blob,
        plan,
        objectUrl,
      });

      // Drop pixel buffer between variants (keep element for reuse)
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  global.PhotoShuffleImage = {
    DEFAULT_JPEG_QUALITY,
    isJpegFile,
    loadImageOriented,
    imageSize,
    renderShuffledImage,
    encodeJpeg,
    releaseImage,
    generateVariants,
  };
})(typeof window !== "undefined" ? window : globalThis);
