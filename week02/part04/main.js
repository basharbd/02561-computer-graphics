"use strict";

// Week 2 - Part 4: draw Points, Triangles, and Circles (all as triangle-list)
// Uses MV.js helpers (vec2/vec4/add/subtract/length/flatten, ...)

// ---------- Utilities ----------
function mouseToNDC(ev, canvas) {
  // Convert mouse pixel coordinates to NDC [-1,1]
  const r = canvas.getBoundingClientRect();
  const x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  const y = 1 - ((ev.clientY - r.top) / r.height) * 2;
  return vec2(x, y);
}

function pointQuad(pos, sizeNdcX, sizeNdcY) {
  // Build a pixel-sized point as a quad (two triangles)
  const hx = sizeNdcX * 0.5;
  const hy = sizeNdcY * 0.5;

  const x0 = pos[0] - hx, x1 = pos[0] + hx;
  const y0 = pos[1] - hy, y1 = pos[1] + hy;

  return [
    vec2(x0, y0), vec2(x1, y0), vec2(x0, y1),
    vec2(x0, y1), vec2(x1, y0), vec2(x1, y1),
  ];
}

function fillColors(c, n) {
  // Create an array with n copies of the same color
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = c;
  return out;
}

function buildCircleTriangleList(center, radius, segments, centerColor, rimColor) {
  // Triangle-list fan: (center, p0, p1) repeated around the circle
  const positions = [];
  const colors = [];

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;

    const p0 = add(center, vec2(radius * Math.cos(a0), radius * Math.sin(a0)));
    const p1 = add(center, vec2(radius * Math.cos(a1), radius * Math.sin(a1)));

    positions.push(center, p0, p1);
    colors.push(centerColor, rimColor, rimColor); // radial interpolation
  }

  return { positions, colors, vertexCount: segments * 3 };
}

async function main() {
  // WebGPU availability check
  if (!navigator.gpu) throw new Error("WebGPU not supported.");

  // ---------- Canvas / WebGPU ----------
  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");

  // Get GPU device
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Failed to get GPU adapter.");
  const device = await adapter.requestDevice();

  // Configure swap chain
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  // ---------- UI ----------
  const colorSelect = document.getElementById("color-select");
  const clearSelect = document.getElementById("clear-select");
  const clearBtn = document.getElementById("clear-button");

  const btnPoint = document.getElementById("mode-point");
  const btnTri = document.getElementById("mode-triangle");
  const btnCircle = document.getElementById("mode-circle");

  // Default UI selections (if empty)
  if (!colorSelect.value) colorSelect.value = "1"; // black
  if (!clearSelect.value) clearSelect.value = "7"; // cornflower

  // Preset colors (vec4 RGBA)
  const colors = [
    vec4(1.0, 1.0, 1.0, 1.0),
    vec4(0.0, 0.0, 0.0, 1.0),
    vec4(1.0, 0.0, 0.0, 1.0),
    vec4(0.0, 1.0, 0.0, 1.0),
    vec4(0.0, 0.0, 1.0, 1.0),
    vec4(1.0, 1.0, 0.0, 1.0),
    vec4(1.0, 0.647, 0.0, 1.0),
    vec4(0.3921, 0.5843, 0.9294, 1.0)
  ];

  // ---------- Drawing settings ----------
  const VERTS_POINT = 6; // quad
  const VERTS_TRI = 3;

  const POINT_SIZE_PX = 20;

  function computePointSizeNDC() {
    // Use DOM rect so it works even if canvas is CSS-scaled
    const r = canvas.getBoundingClientRect();
    const sx = (POINT_SIZE_PX / r.width) * 2.0;
    const sy = (POINT_SIZE_PX / r.height) * 2.0;
    return { sx, sy };
  }

  // Current clear/background color
  let bgColor = colors[Number(clearSelect.value)];

  // ---------- GPU buffers ----------
  const MAX_VERTS = 50000;

  const BYTES_VEC2 = 2 * 4;
  const BYTES_VEC4 = 4 * 4;

  const positionBuffer = device.createBuffer({
    size: MAX_VERTS * BYTES_VEC2,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const colorBuffer = device.createBuffer({
    size: MAX_VERTS * BYTES_VEC4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const positionLayout = {
    arrayStride: BYTES_VEC2,
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
  };

  const colorLayout = {
    arrayStride: BYTES_VEC4,
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }],
  };

  // ---------- Pipeline ----------
  const wgslUrl = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslUrl, { cache: "reload" }).then(r => r.text());
  const shader = device.createShaderModule({ code: wgslCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "main_vs", buffers: [positionLayout, colorLayout] },
    fragment: { module: shader, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  // ---------- Streamed geometry state ----------
  let vertexCount = 0;

  // Triangle mode state (stores clicks + preview quads)
  let triPending = [];
  let triPreview = 0;

  // Circle mode state (center click + preview quad)
  let circleCenter = null;
  let circleCenterColor = null;
  let circlePreview = false;

  // ---------- Render scheduling ----------
  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function render() {
    // Clear + draw all streamed vertices
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: bgColor[0], g: bgColor[1], b: bgColor[2], a: bgColor[3] },
      }],
    });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, colorBuffer);
    pass.draw(vertexCount);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }

  // ---------- Mode control ----------
  let mode = "point"; // "point" | "triangle" | "circle"

  function resetTriangleState() {
    // Remove preview quads from the end (if any)
    if (triPreview > 0) {
      vertexCount -= triPreview * VERTS_POINT;
      if (vertexCount < 0) vertexCount = 0;
    }
    triPending = [];
    triPreview = 0;
  }

  function resetCircleState() {
    // Remove preview center quad (if it exists)
    if (circlePreview) {
      vertexCount -= VERTS_POINT;
      if (vertexCount < 0) vertexCount = 0;
    }
    circleCenter = null;
    circleCenterColor = null;
    circlePreview = false;
  }

  function setMode(newMode) {
    if (mode === newMode) return;

    if (mode === "triangle") resetTriangleState();
    if (mode === "circle") resetCircleState();

    mode = newMode;

    btnPoint.classList.toggle("active", mode === "point");
    btnTri.classList.toggle("active", mode === "triangle");
    btnCircle.classList.toggle("active", mode === "circle");

    scheduleRender();
  }

  btnPoint.addEventListener("click", () => setMode("point"));
  btnTri.addEventListener("click", () => setMode("triangle"));
  btnCircle.addEventListener("click", () => setMode("circle"));

  // ---------- Clear / Background ----------
  clearBtn.addEventListener("click", () => {
    vertexCount = 0;
    resetTriangleState();
    resetCircleState();

    bgColor = colors[Number(clearSelect.value)];
    scheduleRender();
  });

  clearSelect.addEventListener("input", () => {
    bgColor = colors[Number(clearSelect.value)];
    scheduleRender();
  });

  // ---------- Click drawing ----------
  canvas.addEventListener("click", (ev) => {
    const p = mouseToNDC(ev, canvas);
    const c = colors[Number(colorSelect.value)];

    const { sx, sy } = computePointSizeNDC();

    // ---- Point mode ----
    if (mode === "point") {
      if (vertexCount + VERTS_POINT > MAX_VERTS) return;

      const quad = pointQuad(p, sx, sy);
      const quadCols = fillColors(c, VERTS_POINT);

      device.queue.writeBuffer(positionBuffer, vertexCount * BYTES_VEC2, flatten(quad));
      device.queue.writeBuffer(colorBuffer, vertexCount * BYTES_VEC4, flatten(quadCols));

      vertexCount += VERTS_POINT;
      scheduleRender();
      return;
    }

    // ---- Triangle mode ----
    if (mode === "triangle") {
      triPending.push({ pos: p, col: c });

      // First two clicks: add preview points (quads)
      if (triPending.length < 3) {
        if (vertexCount + VERTS_POINT > MAX_VERTS) return;

        const quad = pointQuad(p, sx, sy);
        const quadCols = fillColors(c, VERTS_POINT);

        device.queue.writeBuffer(positionBuffer, vertexCount * BYTES_VEC2, flatten(quad));
        device.queue.writeBuffer(colorBuffer, vertexCount * BYTES_VEC4, flatten(quadCols));

        vertexCount += VERTS_POINT;
        triPreview += 1;

        scheduleRender();
        return;
      }

      // Third click: remove two preview quads, then add the real triangle
      vertexCount -= 2 * VERTS_POINT;
      if (vertexCount < 0) vertexCount = 0;

      const triPos = [triPending[0].pos, triPending[1].pos, triPending[2].pos];
      const triCol = [triPending[0].col, triPending[1].col, triPending[2].col];

      if (vertexCount + VERTS_TRI > MAX_VERTS) return;

      device.queue.writeBuffer(positionBuffer, vertexCount * BYTES_VEC2, flatten(triPos));
      device.queue.writeBuffer(colorBuffer, vertexCount * BYTES_VEC4, flatten(triCol));

      vertexCount += VERTS_TRI;

      triPending = [];
      triPreview = 0;

      scheduleRender();
      return;
    }

    // ---- Circle mode ----
    if (mode === "circle") {
      // First click: store center and show preview point
      if (!circleCenter) {
        circleCenter = p;
        circleCenterColor = c;

        if (vertexCount + VERTS_POINT > MAX_VERTS) return;

        const quad = pointQuad(p, sx, sy);
        const quadCols = fillColors(c, VERTS_POINT);

        device.queue.writeBuffer(positionBuffer, vertexCount * BYTES_VEC2, flatten(quad));
        device.queue.writeBuffer(colorBuffer, vertexCount * BYTES_VEC4, flatten(quadCols));

        vertexCount += VERTS_POINT;
        circlePreview = true;

        scheduleRender();
        return;
      }

      // Second click: compute radius and build circle, replacing preview
      const radius = length(subtract(circleCenter, p));
      const rimColor = c;

      if (circlePreview) {
        vertexCount -= VERTS_POINT;
        if (vertexCount < 0) vertexCount = 0;
        circlePreview = false;
      }

      const SEGMENTS = 120;
      const circle = buildCircleTriangleList(circleCenter, radius, SEGMENTS, circleCenterColor, rimColor);

      if (vertexCount + circle.vertexCount > MAX_VERTS) return;

      device.queue.writeBuffer(positionBuffer, vertexCount * BYTES_VEC2, flatten(circle.positions));
      device.queue.writeBuffer(colorBuffer, vertexCount * BYTES_VEC4, flatten(circle.colors));

      vertexCount += circle.vertexCount;

      circleCenter = null;
      circleCenterColor = null;

      scheduleRender();
      return;
    }
  });

  // Initial draw
  scheduleRender();
}

window.onload = () => { main(); };
