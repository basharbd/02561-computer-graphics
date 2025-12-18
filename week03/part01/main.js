"use strict";

async function main() {
  // WebGPU availability check
  if (!navigator.gpu) throw new Error("WebGPU not supported.");

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");

  // Get GPU device
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  // Configure swap chain
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  // Unit cube vertices (0..1 in each axis)
  const positions = [
    vec3(0, 0, 0), // 0
    vec3(1, 0, 0), // 1
    vec3(1, 1, 0), // 2
    vec3(0, 1, 0), // 3
    vec3(0, 0, 1), // 4
    vec3(1, 0, 1), // 5
    vec3(1, 1, 1), // 6
    vec3(0, 1, 1), // 7
  ];

  // 12 edges => 24 indices (line-list)
  const edgeIdx = new Uint16Array([
    0,1, 1,2, 2,3, 3,0,   // bottom face
    4,5, 5,6, 6,7, 7,4,   // top face
    0,4, 1,5, 2,6, 3,7    // vertical edges
  ]);

  // Per-vertex colors (all black)
  const colors = Array.from({ length: positions.length }, () => vec4(0, 0, 0, 1));

  // --- GPU buffers: positions, colors, indices
  const positionBuffer = device.createBuffer({
    size: flatten(positions).byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, flatten(positions));

  const colorBuffer = device.createBuffer({
    size: flatten(colors).byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(colorBuffer, 0, flatten(colors));

  const indexBuffer = device.createBuffer({
    size: edgeIdx.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, edgeIdx);

  // Vertex buffer layouts (match shader locations 0 and 1)
  const positionLayout = {
    arrayStride: sizeof["vec3"],
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
  };

  const colorLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }],
  };

  // --- MVP setup: model + view + projection
  const model = translate(-0.5, -0.5, -0.5); // center cube at origin

  const eye = vec3(2, 2, 2);
  const at  = vec3(0, 0, 0);
  const up  = vec3(0, 1, 0);
  const view = lookAt(eye, at, up);

  // Ortho projection (MV.js style), then map depth to WebGPU's [0..1]
  let proj = ortho(-1.2, 1.2, -1.2, 1.2, -5, 5);

  const depthFix = mat4(
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 0.5, 0.5, // z' = 0.5*z + 0.5*w
    0, 0, 0, 1
  );
  proj = mult(depthFix, proj);

  const mvp = mult(proj, mult(view, model));

  // Uniform buffer for MVP matrix
  const uniformBuffer = device.createBuffer({
    size: sizeof["mat4"],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));

  // --- Load WGSL + create pipeline
  const wgslUrl = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslUrl, { cache: "reload" }).then(r => r.text());
  const shader = device.createShaderModule({ code: wgslCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "main_vs", buffers: [positionLayout, colorLayout] },
    fragment: { module: shader, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "line-list" },
  });

  // Bind group (group 0, binding 0) for uniforms
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  // --- Render: clear + draw indexed lines
  const bg = vec4(0.3921, 0.5843, 0.9294, 1.0);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: bg[0], g: bg[1], b: bg[2], a: bg[3] },
    }],
  });

  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.setVertexBuffer(0, positionBuffer);
  pass.setVertexBuffer(1, colorBuffer);
  pass.setIndexBuffer(indexBuffer, "uint16");
  pass.drawIndexed(edgeIdx.length);
  pass.end();

  device.queue.submit([encoder.finish()]);
}

window.onload = () => { main(); };
