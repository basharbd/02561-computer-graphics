"use strict";

function addPointAsQuad(dst, p, sizeNdcX, sizeNdcY) {
  // Make a square "point" as two triangles around p (in NDC)
  const hx = sizeNdcX * 0.5;
  const hy = sizeNdcY * 0.5;

  const x0 = p[0] - hx, x1 = p[0] + hx;
  const y0 = p[1] - hy, y1 = p[1] + hy;

  dst.push(
    vec2(x0, y0), vec2(x1, y0), vec2(x0, y1),
    vec2(x0, y1), vec2(x1, y0), vec2(x1, y1)
  );
}

function mouseToNDC(ev, canvas) {
  // Convert mouse pixel coordinates to NDC [-1,1]
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const y = 1 - ((ev.clientY - rect.top) / rect.height) * 2;
  return vec2(x, y);
}

async function main() {
  // WebGPU availability check
  if (!navigator.gpu) throw new Error("WebGPU not ensure supported.");

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

  // Preset colors (vec4 RGBA)
  const colorValues = [
    vec4(1.0, 1.0, 1.0, 1.0),         // white
    vec4(0.0, 0.0, 0.0, 1.0),         // black
    vec4(1.0, 0.0, 0.0, 1.0),         // red
    vec4(0.0, 1.0, 0.0, 1.0),         // green
    vec4(0.0, 0.0, 1.0, 1.0),         // blue
    vec4(1.0, 1.0, 0.0, 1.0),         // yellow
    vec4(1.0, 0.647, 0.0, 1.0),       // orange
    vec4(0.3921, 0.5843, 0.9294, 1.0) // cornflower
  ];

  // Point drawing settings
  const vertsPerPoint = 6;
  const maxPoints = 100;
  let pointCount = 0;

  // Convert point size (pixels) to NDC size in X/Y
  const pointSizePx = 20;
  const sizeNdcX = (pointSizePx / canvas.width) * 2.0;
  const sizeNdcY = (pointSizePx / canvas.height) * 2.0;

  // CPU-side storage (arrays of vec2 and vec4)
  let positions = [];
  let colors = [];

  // GPU buffers sized for the maximum number of points
  const positionBuffer = device.createBuffer({
    size: sizeof["vec2"] * vertsPerPoint * maxPoints,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const colorBuffer = device.createBuffer({
    size: sizeof["vec4"] * vertsPerPoint * maxPoints,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  // Vertex buffer layouts (match shader locations 0 and 1)
  const positionLayout = {
    arrayStride: sizeof["vec2"],
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
  };

  const colorLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }],
  };

  // Load WGSL from <script id="wgsl" src="...">
  const wgslUrl = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslUrl, { cache: "reload" }).then(r => r.text());
  const shader = device.createShaderModule({ code: wgslCode });

  // Pipeline: position + color attributes, triangle-list rendering
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "main_vs", buffers: [positionLayout, colorLayout] },
    fragment: { module: shader, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  // Current background clear color
  let bgColor = colorValues[Number(clearSelect.value)];

  function render() {
    // Upload current geometry to GPU
    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));
    device.queue.writeBuffer(colorBuffer, 0, flatten(colors));

    // Clear + draw all points
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
    pass.draw(pointCount * vertsPerPoint);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }

  // Click to add a new point-quad with the currently selected color
  canvas.addEventListener("click", (ev) => {
    if (pointCount >= maxPoints) return;

    const p = mouseToNDC(ev, canvas);
    addPointAsQuad(positions, p, sizeNdcX, sizeNdcY);

    const c = colorValues[Number(colorSelect.value)];
    colors.push(...Array(vertsPerPoint).fill(c));

    pointCount++;
    render();
  });

  // Clear button: remove all points and clear with selected background color
  clearBtn.addEventListener("click", () => {
    positions = [];
    colors = [];
    pointCount = 0;
    bgColor = colorValues[Number(clearSelect.value)];
    render();
  });

  // Background color change: keep shapes, just change clear color
  clearSelect.addEventListener("change", () => {
    bgColor = colorValues[Number(clearSelect.value)];
    render();
  });

  // Initial render
  render();
}

window.onload = function () { main(); };
