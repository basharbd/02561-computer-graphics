"use strict";

async function main() {
  // WebGPU availability check
  if (!navigator.gpu) throw new Error("WebGPU not supported in this browser.");

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");

  // Get GPU device
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Failed to get GPU adapter.");
  const device = await adapter.requestDevice();

  // Configure swap chain
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  // Triangle positions in clip/NDC space (-1..1)
  const positions = new Float32Array([
     0.0,  0.0,  // v0
     1.0,  0.0,  // v1
     1.0,  1.0,  // v2
  ]);

  // Per-vertex RGB colors (will interpolate across the triangle)
  const colors = new Float32Array([
    1.0, 0.0, 0.0, // v0 color
    0.0, 1.0, 0.0, // v1 color
    0.0, 0.0, 1.0, // v2 color
  ]);

  // Upload position buffer
  const posBuffer = device.createBuffer({
    size: positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(posBuffer, 0, positions);

  // Upload color buffer
  const colBuffer = device.createBuffer({
    size: colors.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(colBuffer, 0, colors);

  // Vertex buffer layouts (match shader @location(0) and @location(1))
  const posLayout = {
    arrayStride: 2 * 4,
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
  };

  const colLayout = {
    arrayStride: 3 * 4,
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }],
  };

  // Load WGSL from <script id="wgsl" src="shader.wgsl">
  const wgslUrl = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslUrl, { cache: "reload" }).then(r => r.text());
  const shaderModule = device.createShaderModule({ code: wgslCode });

  // Render pipeline: vertex + fragment shaders + triangle-list
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [posLayout, colLayout],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "main_fs",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
  });

  // Encode one render pass: clear + draw
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
  pass.setVertexBuffer(0, posBuffer);
  pass.setVertexBuffer(1, colBuffer);
  pass.draw(3);
  pass.end();

  device.queue.submit([encoder.finish()]);
}

window.addEventListener("load", () => {
  main().catch(err => console.error(err));
});
