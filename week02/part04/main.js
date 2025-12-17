"use strict";

// ======================================================
// Week 2 - Part 4
// Point + Triangle + Circle drawing (triangle-list)
// Uses: MV.js (vec2/vec4/add/subtract/length/flatten, ...)
// ======================================================

// ---------- Small utilities ----------
function mouseToNDC(ev, canvas) {
  const r = canvas.getBoundingClientRect();
  const x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  const y = 1 - ((ev.clientY - r.top) / r.height) * 2;
  return vec2(x, y);
}

function pointQuad(pos, sizeNdcX, sizeNdcY) {
  const hx = sizeNdcX * 0.5;
  const hy = sizeNdcY * 0.5;

  const x0 = pos[0] - hx, x1 = pos[0] + hx;
  const y0 = pos[1] - hy, y1 = pos[1] + hy;

  // 2 triangles => 6 vertices
  return [
    vec2(x0, y0), vec2(x1, y0), vec2(x0, y1),
    vec2(x0, y1), vec2(x1, y0), vec2(x1, y1),
  ];
}

function fillColors(c, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = c;
  return out;
}

function buildCircleTriangleList(center, radius, segments, centerColor, rimColor) {
  const positions = [];
  const colors = [];

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;

    const p0 = add(center, vec2(radius * Math.cos(a0), radius * Math.sin(a0)));
    const p1 = add(center, vec2(radius * Math.cos(a1), radius * Math.sin(a1)));

    // triangle-list: center, p0, p1
    positions.push(center, p0, p1);

    // radial color interpolation: centerColor at center, rimColor on edge
    colors.push(centerColor, rimColor, rimColor);
  }

  return { positions, colors, vertexCount: segments * 3 };
}

async function main() {
  if (!navigator.gpu) throw new Error("WebGPU not supported.");

  // ---------- Canvas / WebGPU ----------
  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Failed to get GPU adapter.");
  const device = await adapter.requestDevice();

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  // ---------- UI ----------
  const colorSelect = document.getElementById("color-select");
  const clearSelect = document.getElementById("clear-select");
  const clearBtn = document.getElementById("clear-button");

  const btnPoint = document.getElementById("mode-point");
  const btnTri = document.getElementById("mode-triangle");
  const btnCircle = document.getElementById("mode-circle");

  // Robust defaults (
  if (!colorSelect.value) colorSelect.value = "1"; // Black
  if (!clearSelect.value) clearSelect.value = "7"; // Cornflower

  const colors = [
    vec4(1.0, 1.0, 1.0, 1.0),         // 0 White
    vec4(0.0, 0.0, 0.0, 1.0),         // 1 Black
    vec4(1.0, 0.0, 0.0, 1.0),         // 2 Red
    vec4(0.0, 1.0, 0.0, 1.0),         // 3 Green
    vec4(0.0, 0.0, 1.0, 1.0),         // 4 Blue
    vec4(1.0, 1.0, 0.0, 1.0),         // 5 Yellow
    vec4(1.0, 0.647, 0.0, 1.0),       // 6 Orange
    vec4(0.3921, 0.5843, 0.9294, 1.0) // 7 Cornflower
  ];

  // ---------- Drawing settings ----------
  const VERTS_POINT = 6;
  const VERTS_TRI = 3;

  const POINT_SIZE_PX = 20;

  function computePointSizeNDC() {
    const r = canvas.getBoundingClientRect(); // works even if CSS scales canvas
    const sx = (POINT_SIZE_PX / r.width) * 2.0;
    const sy = (POINT_SIZE_PX / r.height) * 2.0;
    return { sx, sy };
  }

  let bgColor = colors[Number(clearSelect.value)];

  // ---------- GPU buffers ----------
  const MAX_VERTS = 50000;

  // bytes per vertex attribute
  const BYTES_VEC2 = 2 * 4; // 2 floats
  const BYTES_VEC4 = 4 * 4; // 4 floats

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

  // triangle pending (preview points)
  let triPending = [];      // [{pos, col}, ...]
  let triPreview = 0;       // 0..2 preview point-quads in buffer tail

  // circle pending (preview point)
  let circleCenter = null;
  let circleCenterColor = null;
  let circlePreview = false;

  // ---------- Rendering (scheduled) ----------
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
    if (triPreview > 0) {
      vertexCount -= triPreview * VERTS_POINT;
      if (vertexCount < 0) vertexCount = 0;
    }
    triPending = [];
    triPreview = 0;
  }

  function resetCircleState() {
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

  // immediate update
  clearSelect.addEventListener("input", () => {
    bgColor = colors[Number(clearSelect.value)];
    scheduleRender();
  });

  // ---------- Click drawing ----------
  canvas.addEventListener("click", (ev) => {
    const p = mouseToNDC(ev, canvas);
    const c = colors[Number(colorSelect.value)];

    const { sx, sy } = computePointSizeNDC();

    // ---- POINT mode ----
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

    // ---- TRIANGLE mode ----
    if (mode === "triangle") {
      triPending.push({ pos: p, col: c });

      // first 2 clicks: show preview points
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

      // third click: remove 2 preview points, add 1 triangle
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

    // ---- CIRCLE mode ----
    if (mode === "circle") {
      // first click => center + preview point
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

      // second click => radius + circle triangles, replace preview
      const radius = length(subtract(circleCenter, p));
      const rimColor = c;

      // remove preview point
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

  // first draw (uses selected clear color)
  scheduleRender();
}

window.onload = () => { main(); };
