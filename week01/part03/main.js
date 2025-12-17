"use strict";

async function main() {
  if (!navigator.gpu) throw new Error("WebGPU not supported in this browser.");

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Failed to get GPU adapter.");
  const device = await adapter.requestDevice();

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  // Triangle in NDC coordinates (range -1..1)
  // Updated to match the provided image: Center, Right-Middle, Top-Right
  const positions = new Float32Array([
     0.0,  0.0,  // center
     1.0,  0.0,  // right edge
     1.0,  1.0,  // top right corner
  ]);

  // One RGB color per vertex
  // Matching the image: Red at center, Green at right edge, Blue at top corner
  const colors = new Float32Array([
    1.0, 0.0, 0.0, // red
    0.0, 1.0, 0.0, // green
    0.0, 0.0, 1.0, // blue
  ]);

  const posBuffer = device.createBuffer({
    size: positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(posBuffer, 0, positions);

  const colBuffer = device.createBuffer({
    size: colors.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(colBuffer, 0, colors);

  const posLayout = {
    arrayStride: 2 * 4, // 2 floats
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
  };

  const colLayout = {
    arrayStride: 3 * 4, // 3 floats
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }],
  };

  // Load WGSL
  const wgslUrl = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslUrl, { cache: "reload" }).then(r => r.text());
  const shaderModule = device.createShaderModule({ code: wgslCode });

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

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 }, // cornflower blue
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