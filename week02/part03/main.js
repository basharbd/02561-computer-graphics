"use strict";

// Helpers: mouse -> NDC and building a pixel-sized quad for a "point"
function mouseToNDC(ev, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const y = 1 - ((ev.clientY - rect.top) / rect.height) * 2;
  return vec2(x, y);
}

function makePointQuad(pos, sizeNdcX, sizeNdcY) {
  // Build a square centered at pos using two triangles (6 vertices)
  const hx = sizeNdcX * 0.5;
  const hy = sizeNdcY * 0.5;

  const x0 = pos[0] - hx, x1 = pos[0] + hx;
  const y0 = pos[1] - hy, y1 = pos[1] + hy;

  return [
    vec2(x0, y0), vec2(x1, y0), vec2(x0, y1),
    vec2(x0, y1), vec2(x1, y0), vec2(x1, y1),
  ];
}

async function main() {
  // WebGPU availability check
  if (!navigator.gpu) throw new Error("WebGPU not supported.");

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");

  // Get GPU device
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Failed to get GPU adapter.");
  const device = await adapter.requestDevice();

  // Configure swap chain
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  // UI elements
  const colorSelect = document.getElementById("color-select");
  const clearSelect = document.getElementById("clear-select");
  const clearBtn = document.getElementById("clear-button");
  const btnPoint = document.getElementById("mode-point");
  const btnTri = document.getElementById("mode-triangle");

  // Preset colors (vec4 RGBA)
  const colorValues = [
    vec4(1.0, 1.0, 1.0, 1.0),
    vec4(0.0, 0.0, 0.0, 1.0),
    vec4(1.0, 0.0, 0.0, 1.0),
    vec4(0.0, 1.0, 0.0, 1.0),
    vec4(0.0, 0.0, 1.0, 1.0),
    vec4(1.0, 1.0, 0.0, 1.0),
    vec4(1.0, 0.647, 0.0, 1.0),
    vec4(0.3921, 0.5843, 0.9294, 1.0)
  ];

  // Drawing constants
  const VERTS_PER_POINT = 6; // quad as two triangles
  const VERTS_PER_TRI = 3;

  // Point size in NDC (based on canvas pixel size)
  const pointSizePx = 20;
  const sizeNdcX = (pointSizePx / canvas.width) * 2.0;
  const sizeNdcY = (pointSizePx / canvas.height) * 2.0;

  // Background clear color
  let bgColor = colorValues[Number(clearSelect.value)];

  // Streaming state: append vertices to GPU buffers, sometimes "rewind"
  let vertexCount = 0;
  let pending = [];                 // triangle mode: stores {pos, col}
  let pendingPreviewPoints = 0;     // number of preview point-quads at the end (0..2)

  // GPU buffer capacity (in vertices)
  const MAX_VERTS = 20000;

  // GPU buffers for positions and colors
  const positionBuffer = device.createBuffer({
    size: MAX_VERTS * 2 * 4, // vec2
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const colorBuffer = device.createBuffer({
    size: MAX_VERTS * 4 * 4, // vec4
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  // Vertex layouts (match shader locations 0 and 1)
  const positionLayout = {
    arrayStride: 2 * 4,
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
  };

  const colorLayout = {
    arrayStride: 4 * 4,
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }],
  };

  // Load WGSL + create pipeline
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
    // Draw everything currently in the GPU buffers (0..vertexCount)
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

  // Current mode: "point" or "triangle"
  let mode = "point";

  function setMode(newMode) {
    if (mode === newMode) return;

    // If leaving triangle mode, remove any preview point-quads from the end
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

  // Clear: reset state and background
  clearBtn.addEventListener("click", () => {
    vertexCount = 0;
    pending = [];
    pendingPreviewPoints = 0;
    bgColor = colorValues[Number(clearSelect.value)];
    render();
  });

  // Update background immediately when clear color changes
  clearSelect.addEventListener("change", () => {
    bgColor = colorValues[Number(clearSelect.value)];
    render();
  });

  // Click to draw (point mode) or build a triangle (triangle mode)
  canvas.addEventListener("click", (ev) => {
    const p = mouseToNDC(ev, canvas);
    const c = colorValues[Number(colorSelect.value)];

    if (mode === "point") {
      // Append one point-quad
      if (vertexCount + VERTS_PER_POINT > MAX_VERTS) return;

      const quad = makePointQuad(p, sizeNdcX, sizeNdcY);
      const quadColors = Array(VERTS_PER_POINT).fill(c);

      device.queue.writeBuffer(positionBuffer, vertexCount * 2 * 4, flatten(quad));
      device.queue.writeBuffer(colorBuffer, vertexCount * 4 * 4, flatten(quadColors));

      vertexCount += VERTS_PER_POINT;
      render();
      return;
    }

    // Triangle mode: collect 3 clicks
    pending.push({ pos: p, col: c });

    if (pending.length < 3) {
      // Add a preview point-quad for the first two clicks
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

    // Third click: remove the two preview point-quads, then append one triangle
    vertexCount -= 2 * VERTS_PER_POINT;
    if (vertexCount < 0) vertexCount = 0;

    const triPos = [pending[0].pos, pending[1].pos, pending[2].pos];
    const triCol = [pending[0].col, pending[1].col, pending[2].col];

    if (vertexCount + VERTS_PER_TRI > MAX_VERTS) return;

    device.queue.writeBuffer(positionBuffer, vertexCount * 2 * 4, flatten(triPos));
    device.queue.writeBuffer(colorBuffer, vertexCount * 4 * 4, flatten(triCol));

    vertexCount += VERTS_PER_TRI;

    // Reset triangle staging
    pending = [];
    pendingPreviewPoints = 0;

    render();
  });

  // Initial clear
  render();
}

window.onload = function () { main(); };
