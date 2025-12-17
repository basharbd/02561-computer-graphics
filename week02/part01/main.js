"use strict";

function addPointAsQuad(dst, p, sizeNdcX, sizeNdcY) {
  const hx = sizeNdcX * 0.5;
  const hy = sizeNdcY * 0.5;

  const x0 = p[0] - hx, x1 = p[0] + hx;
  const y0 = p[1] - hy, y1 = p[1] + hy;

  // 2 triangles => 6 vertices
  dst.push(
    vec2(x0, y0), vec2(x1, y0), vec2(x0, y1),
    vec2(x0, y1), vec2(x1, y0), vec2(x1, y1)
  );
}

function mouseToNDC(ev, canvas) {
  const rect = canvas.getBoundingClientRect();

  const x = ( (ev.clientX - rect.left) / rect.width ) * 2 - 1;
  const y = 1 - ( (ev.clientY - rect.top) / rect.height ) * 2;

  return vec2(x, y);
}

async function main() {
  if (!navigator.gpu) throw new Error("WebGPU not supported.");

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Failed to get GPU adapter.");

  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({ device, format, alphaMode: "opaque" });

  // ----- Parameters -----
  const pointSizePx = 20;
  const maxPoints = 100;
  const vertsPerPoint = 6;

  // Convert 20px -> NDC size (separately for X and Y)
  const sizeNdcX = (pointSizePx / canvas.width) * 2.0;
  const sizeNdcY = (pointSizePx / canvas.height) * 2.0;

  // CPU-side storage
  const positions = [];
  let pointCount = 0;

  // GPU buffer big enough for max points
  const positionBuffer = device.createBuffer({
    size: sizeof["vec2"] * vertsPerPoint * maxPoints,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const positionLayout = {
    arrayStride: sizeof["vec2"],
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
  };

  // Shader
  const wgslUrl = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslUrl, { cache: "reload" }).then(r => r.text());
  const shader = device.createShaderModule({ code: wgslCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "main_vs", buffers: [positionLayout] },
    fragment: { module: shader, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  function render() {
    // Upload only what we have
    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 },
      }],
    });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, positionBuffer);
    pass.draw(pointCount * vertsPerPoint);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }

  canvas.addEventListener("click", (ev) => {
    if (pointCount >= maxPoints) return; // prevent overflow

    const p = mouseToNDC(ev, canvas);
    addPointAsQuad(positions, p, sizeNdcX, sizeNdcY);

    pointCount++;
    render();
  });

  // Initial render (blank canvas + no points)
  render();
}

window.addEventListener("load", () => {
  main().catch(err => console.error(err));
});
