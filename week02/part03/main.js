"use strict";

// ---------- Helpers ----------
function mouseToNDC(ev, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const y = 1 - ((ev.clientY - rect.top) / rect.height) * 2;
  return vec2(x, y);
}

function makePointQuad(pos, sizeNdcX, sizeNdcY) {
  const hx = sizeNdcX * 0.5;
  const hy = sizeNdcY * 0.5;

  const x0 = pos[0] - hx, x1 = pos[0] + hx;
  const y0 = pos[1] - hy, y1 = pos[1] + hy;

  // 2 triangles -> 6 vertices
  return [
    vec2(x0, y0), vec2(x1, y0), vec2(x0, y1),
    vec2(x0, y1), vec2(x1, y0), vec2(x1, y1),
  ];
}

// ---------- Main ----------
async function main() {
  if (!navigator.gpu) throw new Error("WebGPU not supported.");

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Failed to get GPU adapter.");
  const device = await adapter.requestDevice();

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  // UI
  const colorSelect = document.getElementById("color-select");
  const clearSelect = document.getElementById("clear-select");
  const clearBtn = document.getElementById("clear-button");
  const btnPoint = document.getElementById("mode-point");
  const btnTri = document.getElementById("mode-triangle");

  const colorValues = [
    vec4(1.0, 1.0, 1.0, 1.0),         // White
    vec4(0.0, 0.0, 0.0, 1.0),         // Black
    vec4(1.0, 0.0, 0.0, 1.0),         // Red
    vec4(0.0, 1.0, 0.0, 1.0),         // Green
    vec4(0.0, 0.0, 1.0, 1.0),         // Blue
    vec4(1.0, 1.0, 0.0, 1.0),         // Yellow
    vec4(1.0, 0.647, 0.0, 1.0),       // Orange
    vec4(0.3921, 0.5843, 0.9294, 1.0) // Cornflower
  ];

  // Drawing state
  const VERTS_PER_POINT = 6;
  const VERTS_PER_TRI = 3;

  const pointSizePx = 20;
  const sizeNdcX = (pointSizePx / canvas.width) * 2.0;
  const sizeNdcY = (pointSizePx / canvas.height) * 2.0;

  let bgColor = colorValues[Number(clearSelect.value)];

  // "Stream" into GPU buffers (append, and sometimes rewind)
  let vertexCount = 0;      // how many vertices to draw total
  let pending = [];         // triangle mode: store {pos, color}
  let pendingPreviewPoints = 0; // how many preview points are currently appended at the end (0..2)

  // Capacity
  const MAX_VERTS = 20000;

  const positionBuffer = device.createBuffer({
    size: MAX_VERTS * 2 * 4, // vec2 -> 2 floats
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const colorBuffer = device.createBuffer({
    size: MAX_VERTS * 4 * 4, // vec4 -> 4 floats
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const positionLayout = {
    arrayStride: 2 * 4,
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
  };

  const colorLayout = {
    arrayStride: 4 * 4,
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }],
  };

  // Shader / pipeline
  const wgslUrl = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslUrl, { cache: "reload" }).then(r => r.text());
  const shader = device.createShaderModule({ code: wgslCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "main_vs", buffers: [positionLayout, colorLayout] },
    fragment: { module: shader, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

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

  // Mode handling (buttons)
  let mode = "point"; // "point" | "triangle"

  function setMode(newMode) {
    if (mode === newMode) return;

    // إذا كنت بالـtriangle وعندي preview نقط، شيلهم (rewind)
    if (mode === "triangle" && pendingPreviewPoints > 0) {
      vertexCount -= pendingPreviewPoints * VERTS_PER_POINT;
      if (vertexCount < 0) vertexCount = 0;
      pending = [];
      pendingPreviewPoints = 0;
      render();
    }

    mode = newMode;
    btnPoint.classList.toggle("active", mode === "point");
    btnTri.classList.toggle("active", mode === "triangle");
  }

  btnPoint.addEventListener("click", () => setMode("point"));
  btnTri.addEventListener("click", () => setMode("triangle"));

  // Clear
  clearBtn.addEventListener("click", () => {
    vertexCount = 0;
    pending = [];
    pendingPreviewPoints = 0;
    bgColor = colorValues[Number(clearSelect.value)];
    render();
  });

  // Optional: changing clear color updates background immediately
  clearSelect.addEventListener("change", () => {
    bgColor = colorValues[Number(clearSelect.value)];
    render();
  });

  // Drawing click
  canvas.addEventListener("click", (ev) => {
    const p = mouseToNDC(ev, canvas);
    const c = colorValues[Number(colorSelect.value)];

    if (mode === "point") {
      // append a point as 2 triangles
      if (vertexCount + VERTS_PER_POINT > MAX_VERTS) return;

      const quad = makePointQuad(p, sizeNdcX, sizeNdcY);
      const quadColors = Array(VERTS_PER_POINT).fill(c);

      device.queue.writeBuffer(positionBuffer, vertexCount * 2 * 4, flatten(quad));
      device.queue.writeBuffer(colorBuffer, vertexCount * 4 * 4, flatten(quadColors));

      vertexCount += VERTS_PER_POINT;
      render();
      return;
    }

    // ---- triangle mode ----
    pending.push({ pos: p, col: c });

    if (pending.length < 3) {
      // show preview point (as quad)
      if (vertexCount + VERTS_PER_POINT > MAX_VERTS) return;

      const quad = makePointQuad(p, sizeNdcX, sizeNdcY);
      const quadColors = Array(VERTS_PER_POINT).fill(c);

      device.queue.writeBuffer(positionBuffer, vertexCount * 2 * 4, flatten(quad));
      device.queue.writeBuffer(colorBuffer, vertexCount * 4 * 4, flatten(quadColors));

      vertexCount += VERTS_PER_POINT;
      pendingPreviewPoints += 1;

      render();
      return;
    }

    // Third click: replace the two preview points with ONE triangle
    // Remove last 2 preview points from the end
    vertexCount -= 2 * VERTS_PER_POINT;
    if (vertexCount < 0) vertexCount = 0;

    const triPos = [pending[0].pos, pending[1].pos, pending[2].pos];
    const triCol = [pending[0].col, pending[1].col, pending[2].col];

    if (vertexCount + VERTS_PER_TRI > MAX_VERTS) return;

    device.queue.writeBuffer(positionBuffer, vertexCount * 2 * 4, flatten(triPos));
    device.queue.writeBuffer(colorBuffer, vertexCount * 4 * 4, flatten(triCol));

    vertexCount += VERTS_PER_TRI;

    // reset triangle record
    pending = [];
    pendingPreviewPoints = 0;

    render();
  });

  render();
}

window.onload = function () { main(); };
