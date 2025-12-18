"use strict";

async function main() {
  // WebGPU availability check
  if (!navigator.gpu) {
    throw new Error("WebGPU not supported. Try Chrome/Edge with WebGPU enabled.");
  }

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");

  // Get GPU device
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Failed to get GPU adapter.");
  const device = await adapter.requestDevice();

  // Configure swap chain
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "opaque",
  });

  // Encode one render pass that only clears the screen
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 }, // background
      },
    ],
  });

  pass.end();
  device.queue.submit([encoder.finish()]);
}

window.addEventListener("load", () => {
  main().catch((err) => console.error(err));
});
