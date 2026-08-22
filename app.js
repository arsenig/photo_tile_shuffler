/**
 * Photo Tile Shuffle — UI wiring.
 */
(function () {
  "use strict";

  const Core = window.PhotoShuffleCore;
  const Img = window.PhotoShuffleImage;

  const els = {
    file: document.getElementById("file"),
    hor: document.getElementById("hor"),
    ver: document.getElementById("ver"),
    chaos: document.getElementById("chaos"),
    chaosValue: document.getElementById("chaosValue"),
    subtleChaos: document.getElementById("subtleChaos"),
    nOut: document.getElementById("nOut"),
    seed: document.getElementById("seed"),
    generate: document.getElementById("generate"),
    info: document.getElementById("info"),
    status: document.getElementById("status"),
    error: document.getElementById("error"),
    results: document.getElementById("results"),
    stage: document.getElementById("stage"),
    stageWrap: document.getElementById("stageWrap"),
    photoCanvas: document.getElementById("photoCanvas"),
    overlayCanvas: document.getElementById("overlayCanvas"),
    brushSize: document.getElementById("brushSize"),
    brushSizeValue: document.getElementById("brushSizeValue"),
    clearBrush: document.getElementById("clearBrush"),
  };

  /** @type {File|null} */
  let currentFile = null;
  /** @type {ImageBitmap|HTMLImageElement|null} */
  let loadedImage = null;
  /** @type {{ width: number, height: number }|null} */
  let imageDims = null;
  /** @type {string[]} */
  let objectUrls = [];

  function setError(msg) {
    els.error.textContent = msg || "";
    els.error.hidden = !msg;
  }

  function setStatus(msg) {
    els.status.textContent = msg || "";
  }

  function revokeAllUrls() {
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls = [];
  }

  const preview = window.PhotoShufflePreview.createPreview({
    stage: els.stage,
    wrap: els.stageWrap,
    photo: els.photoCanvas,
    overlay: els.overlayCanvas,
    brushSize: els.brushSize,
    brushSizeValue: els.brushSizeValue,
    clear: els.clearBrush,
    onChange: updateInfo,
  });

  function currentEligible(grid) {
    return Core.eligibleTilesFromStrokes(grid, preview.getStrokes());
  }

  function readParams() {
    return {
      hor: Number(els.hor.value),
      ver: Number(els.ver.value),
      chaos: Number(els.chaos.value),
      nOut: Number(els.nOut.value),
      seedRaw: els.seed.value,
      subtle: els.subtleChaos.checked,
    };
  }

  function updateChaosLabel() {
    els.chaosValue.textContent = Number(els.chaos.value).toFixed(2);
  }

  function updateInfo() {
    if (!imageDims) {
      els.info.innerHTML =
        "<p class=\"muted\">Select a JPEG to see grid details.</p>";
      return;
    }

    const { hor, ver, chaos, subtle } = readParams();
    const horOk = Number.isInteger(hor) && hor >= 1;
    const verOk = Number.isInteger(ver) && ver >= 1;
    const chaosOk = typeof chaos === "number" && !Number.isNaN(chaos);

    if (!horOk || !verOk || hor > imageDims.width || ver > imageDims.height) {
      els.info.innerHTML =
        "<p class=\"muted\">Enter valid HOR / VER within image dimensions.</p>";
      return;
    }

    const grid = Core.calculateGrid(imageDims.width, imageDims.height, hor, ver);
    preview.setGrid(grid);

    const eligible = currentEligible(grid);
    const poolSize = eligible == null ? grid.tiles : eligible.length;
    const affected = chaosOk ? Core.affectedTileCount(poolSize, chaos) : 0;
    const rawAffected = chaosOk ? Math.floor(poolSize * chaos) : 0;

    function noteHtml(text) {
      return '<p class="note">' + text + "</p>";
    }

    let note = "";
    if (grid.tiles === 1) {
      note = noteHtml("Only one tile — no rearrangement possible.");
    } else if (eligible != null && eligible.length === 0) {
      note = noteHtml(
        "Brush paint did not touch any tiles (it may be on the cropped strip). Outputs will be unchanged."
      );
    } else if (chaosOk && rawAffected === 1) {
      note = noteHtml(
        "Calculated affected tiles = 1 → will move 0 (cannot move a single tile without exceeding CHAOS)."
      );
    } else if (chaosOk && affected === 0 && chaos > 0) {
      note = noteHtml("Fewer than two tiles selected by CHAOS → unchanged outputs.");
    } else if (eligible != null && chaosOk && affected < eligible.length) {
      note = noteHtml(
        "Brush is active: only painted tiles can move; CHAOS will move " +
          affected +
          " of " +
          eligible.length +
          " touched tiles."
      );
    }

    const cropNote =
      grid.cropRight || grid.cropBottom
        ? `<li>Cropped away: ${grid.cropRight}px right, ${grid.cropBottom}px bottom</li>`
        : `<li>No crop needed</li>`;

    els.info.innerHTML = `
      <ul>
        <li>Image: ${grid.sourceWidth} × ${grid.sourceHeight}</li>
        <li>After crop: ${grid.cropWidth} × ${grid.cropHeight}</li>
        <li>Grid: ${grid.hor} × ${grid.ver}</li>
        <li>Tiles: ${grid.tiles}</li>
        <li>Tile size: ${grid.tileWidth} × ${grid.tileHeight}</li>
        <li>Eligible tiles: ${eligible == null ? grid.tiles + " (all)" : eligible.length + " (painted)"}</li>
        <li>CHAOS: ${chaosOk ? chaos.toFixed(2) : "—"}</li>
        <li>Subtle chaos: ${subtle ? "on (swap similar tiles)" : "off (random swaps)"}</li>
        <li>Affected tiles: ${chaosOk ? affected : "—"}</li>
        ${cropNote}
      </ul>
      ${note}
    `;
  }

  async function onFileChange() {
    setError("");
    setStatus("");
    revokeAllUrls();
    els.results.innerHTML = "";

    Img.releaseImage(loadedImage);
    loadedImage = null;
    imageDims = null;
    currentFile = null;
    preview.clearImage();

    const file = els.file.files && els.file.files[0];
    if (!file) {
      updateInfo();
      return;
    }

    if (!Img.isJpegFile(file)) {
      setError("Please choose a JPEG file (.jpg / .jpeg).");
      updateInfo();
      return;
    }

    try {
      setStatus("Loading image…");
      loadedImage = await Img.loadImageOriented(file);
      imageDims = Img.imageSize(loadedImage);
      currentFile = file;
      preview.setImage(loadedImage, imageDims);
      setStatus(`Loaded ${file.name} (${imageDims.width} × ${imageDims.height})`);
      updateInfo();
    } catch (e) {
      setError(e.message || String(e));
      setStatus("");
      updateInfo();
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke shortly after click
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function appendVariantCard(variantIndex, objectUrl, filename, plan, blob) {
    const card = document.createElement("article");
    card.className = "variant";

    const title = document.createElement("h3");
    title.textContent = `Variant ${String(variantIndex).padStart(3, "0")}`;

    const meta = document.createElement("p");
    meta.className = "meta";
    if (plan.moved) {
      const how =
        plan.pairing === "similar"
          ? " (swapped with visually similar tiles)"
          : "";
      meta.textContent = `Moved ${plan.affectedCount} tiles${how}`;
    } else {
      meta.textContent = plan.reason || "Unchanged";
    }

    const img = document.createElement("img");
    img.src = objectUrl;
    img.alt = title.textContent;
    img.loading = "lazy";

    const actions = document.createElement("div");
    actions.className = "actions";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save JPEG";
    saveBtn.addEventListener("click", () => downloadBlob(blob, filename));

    const name = document.createElement("code");
    name.textContent = filename;

    actions.appendChild(saveBtn);
    actions.appendChild(name);

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(img);
    card.appendChild(actions);
    els.results.appendChild(card);
  }

  async function onGenerate() {
    setError("");
    revokeAllUrls();
    els.results.innerHTML = "";

    if (!currentFile || !loadedImage || !imageDims) {
      setError("Select a JPEG image first.");
      return;
    }

    const params = readParams();
    const validation = Core.validateParams({
      isJpeg: Img.isJpegFile(currentFile),
      width: imageDims.width,
      height: imageDims.height,
      hor: params.hor,
      ver: params.ver,
      chaos: params.chaos,
      nOut: params.nOut,
    });

    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    const { hor, ver, chaos, nOut, subtle } = params;
    const grid = Core.calculateGrid(imageDims.width, imageDims.height, hor, ver);

    if (grid.tileWidth < 1 || grid.tileHeight < 1) {
      setError("Grid produces zero-size tiles; reduce HOR/VER or use a larger image.");
      return;
    }

    const seed = Core.parseSeed(params.seedRaw);
    const rng =
      seed === null ? Core.createUnseededRng() : Core.createRng(seed);

    els.generate.disabled = true;
    setStatus(`Generating ${nOut} variant(s)…`);

    let unchangedNoteShown = false;
    let unchangedReason = "";
    let subtleUnavailable = false;

    try {
      await Img.generateVariants({
        sourceImage: loadedImage,
        grid,
        chaos,
        nOut,
        rng,
        subtle,
        eligible: currentEligible(grid),
        onProgress({ current, total }) {
          setStatus(`Generating variant ${current} of ${total}…`);
        },
        async onVariant({ index, blob, plan, objectUrl }) {
          objectUrls.push(objectUrl);
          const filename = Core.generateFilename(
            currentFile.name,
            hor,
            ver,
            chaos,
            index
          );
          appendVariantCard(index, objectUrl, filename, plan, blob);

          if (!plan.moved && plan.reason && !unchangedNoteShown) {
            unchangedNoteShown = true;
            unchangedReason = plan.reason;
          }
          if (subtle && plan.moved && plan.pairing !== "similar") {
            subtleUnavailable = true;
          }
        },
      });

      let doneMsg = `Done — ${nOut} variant(s) ready. Save each as needed.`;
      if (unchangedReason) doneMsg += " " + unchangedReason;
      if (subtleUnavailable) {
        doneMsg +=
          " Tile colours could not be read, so subtle chaos fell back to random swaps.";
      }
      setStatus(doneMsg);
    } catch (e) {
      setError(e.message || String(e));
      setStatus("");
    } finally {
      els.generate.disabled = false;
    }
  }

  els.file.addEventListener("change", onFileChange);
  els.hor.addEventListener("input", updateInfo);
  els.ver.addEventListener("input", updateInfo);
  els.chaos.addEventListener("input", () => {
    updateChaosLabel();
    updateInfo();
  });
  els.subtleChaos.addEventListener("change", updateInfo);
  els.generate.addEventListener("click", onGenerate);

  updateChaosLabel();
  updateInfo();
})();
