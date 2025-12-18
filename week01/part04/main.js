"use strict";

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

  // Centered quad (two triangles) in NDC
  const positions = new Float32Array([
    -0.5, -0.5,   0.5, -0.5,   0.5,  0.5,
    -0.5, -0.5,   0.5,  0.5,  -0.5,  0.5,
  ]);
  const vertexCount = positions.length / 2;

  // Upload position buffer
  const posBuffer = device.createBuffer({
    size: positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(posBuffer, 0, positions);

  // Vertex layout (matches shader @location(0) vec2f)
  const posLayout = {
    arrayStride: 2 * 4,
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
  };

  // Uniform buffer: pack theta into a vec4 for 16-byte alignment
  const uniformData = new Float32Array(4); // [theta, 0, 0, 0]
  const uniformBuffer = device.createBuffer({
    size: uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Load WGSL from <script id="wgsl" src="...">
  const wgslUrl = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslUrl, { cache: "reload" }).then(r => r.text());
  const shaderModule = device.createShaderModule({ code: wgslCode });

  // Pipeline: vertex uses theta uniform to rotate; fragment outputs color
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shaderModule, entryPoint: "main_vs", buffers: [posLayout] },
    fragment: { module: shaderModule, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  // Bind group for the uniform buffer (group 0, binding 0)
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const startTime = performance.now();

  function render() {
    // Time in seconds since start
    const t = (performance.now() - startTime) * 0.001;
    const theta = t; // rotation angle (radians)

    // Update uniform buffer
    uniformData[0] = theta;
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    // Encode render pass: clear + draw quad
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
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, posBuffer);
    pass.draw(vertexCount);
    pass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

window.addEventListener("load", () => {
  main().catch(err => console.error(err));
});
