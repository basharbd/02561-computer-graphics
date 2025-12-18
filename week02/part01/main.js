"use strict";

function addPointAsQuad(dst, p, sizeNdcX, sizeNdcY) {
  // Build a pixel-sized "point" as two triangles (a quad) in NDC
  const hx = sizeNdcX * 0.5;
  const hy = sizeNdcY * 0.5;

  const x0 = p[0] - hx, x1 = p[0] + hx;
  const y0 = p[1] - hy, y1 = p[1] + hy;

  // Two triangles => 6 vertices (vec2 each)
  dst.push(
    vec2(x0, y0), vec2(x1, y0), vec2(x0, y1),
    vec2(x0, y1), vec2(x1, y0), vec2(x1, y1)
  );
}

function mouseToNDC(ev, canvas) {
  // Convert mouse pixel coords to NDC [-1,1] using the canvas rect
  const rect = canvas.getBoundingClientRect();

  const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const y = 1 - ((ev.clientY - rect.top) / rect.height) * 2;

  return vec2(x, y);
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

  // Point drawing settings
  const pointSizePx = 20;
  const maxPoints = 100;
  const vertsPerPoint = 6;

  // Convert point size (pixels) to NDC size in X/Y
  const sizeNdcX = (pointSizePx / canvas.width) * 2.0;
  const sizeNdcY = (pointSizePx / canvas.height) * 2.0;

  // CPU-side vertex storage (array of vec2)
  const positions = [];
  let pointCount = 0;

  // Pre-allocate a GPU buffer large enough for max points
  const positionBuffer = device.createBuffer({
    size: sizeof["vec2"] * vertsPerPoint * maxPoints,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  // Vertex layout (matches shader @location(0) vec2f)
  const positionLayout = {
    arrayStride: sizeof["vec2"],
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
  };

  // Load WGSL from <script id="wgsl" src="...">
  const wgslUrl = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslUrl, { cache: "reload" }).then(r => r.text());
  const shader = device.createShaderModule({ code: wgslCode });

  // Pipeline: position-only input, triangle-list quads
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "main_vs", buffers: [positionLayout] },
    fragment: { module: shader, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  function render() {
    // Upload current vertex data (only what's stored so far)
    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));

    // Clear + draw all point quads
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 }, // background
      }],
    });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, positionBuffer);
    pass.draw(pointCount * vertsPerPoint);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }

  canvas.addEventListener("click", (ev) => {
    // Stop if we reach buffer capacity
    if (pointCount >= maxPoints) return;

    // Add one quad at the clicked position
    const p = mouseToNDC(ev, canvas);
    addPointAsQuad(positions, p, sizeNdcX, sizeNdcY);

    pointCount++;
    render();
  });

  // Initial clear (no points yet)
  render();
}

window.addEventListener("load", () => {
  main().catch(err => console.error(err));
});
