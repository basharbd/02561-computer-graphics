"use strict";

async function main() {
  // WebGPU availability check
  if (!navigator.gpu) throw new Error("WebGPU not supported");

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");

  // Get GPU device
  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  // Configure swap chain
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  // Geometry: unit cube (0..1) and wireframe edges (line-list via index buffer)
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

  const edgeIdx = new Uint16Array([
    0,1, 1,2, 2,3, 3,0,  // bottom
    4,5, 5,6, 6,7, 7,4,  // top
    0,4, 1,5, 2,6, 3,7   // verticals
  ]);

  // Per-vertex color (black)
  const colors = Array.from({ length: positions.length }, () => vec4(0, 0, 0, 1));

  // GPU buffers: positions, colors, and edge indices
  const posBuf = device.createBuffer({
    size: flatten(positions).byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(posBuf, 0, flatten(positions));

  const colBuf = device.createBuffer({
    size: flatten(colors).byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(colBuf, 0, flatten(colors));

  const idxBuf = device.createBuffer({
    size: edgeIdx.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(idxBuf, 0, edgeIdx);

  // Vertex layouts (match shader locations 0 and 1)
  const posLayout = {
    arrayStride: sizeof["vec3"],
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
  };
  const colLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }],
  };

  // Camera + projection (perspective) with depth fix for WebGPU [0..1]
  let P = perspective(45, canvas.width / canvas.height, 0.1, 100.0);

  const depthFix = mat4(
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1
  );
  P = mult(depthFix, P);

  // Simple view transform
  const V = lookAt(vec3(0, 0, 0), vec3(0, 0, 1), vec3(0, 1, 0));

  // Center cube around origin before applying rotations/scales
  const center = translate(-0.5, -0.5, -0.5);

  // Scene layout parameters
  const S      = scalem(1.35, 1.35, 1.35);
  const zDist  = 6.3;
  const xGap   = 3.1;
  const yLift  = 0.10;

  // Three different model transforms (one-, two-, three-point views)
  const M_three = mult(
    translate(-xGap, yLift, zDist),
    mult(rotateY(-45), mult(rotateX(35), mult(S, center)))
  );

  const M_one = mult(
    translate(0, yLift, zDist),
    mult(S, center)
  );

  const M_two = mult(
    translate(+xGap, yLift, zDist),
    mult(rotateY(45), mult(S, center))
  );

  // Precompute MVP for each instance
  const MVP = [
    mult(P, mult(V, M_three)),
    mult(P, mult(V, M_one)),
    mult(P, mult(V, M_two)),
  ];

  // Uniform buffer: store 3 mat4 (one per instance)
  const uBuf = device.createBuffer({
    size: sizeof["mat4"] * 3,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(uBuf, sizeof["mat4"] * 0, flatten(MVP[0]));
  device.queue.writeBuffer(uBuf, sizeof["mat4"] * 1, flatten(MVP[1]));
  device.queue.writeBuffer(uBuf, sizeof["mat4"] * 2, flatten(MVP[2]));

  // Load WGSL and create pipeline
  const wgslUrl  = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslUrl, { cache: "reload" }).then(r => r.text());
  const shader   = device.createShaderModule({ code: wgslCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "main_vs", buffers: [posLayout, colLayout] },
    fragment: { module: shader, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "line-list" },
  });

  // Bind group for the uniform buffer (group 0, binding 0)
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uBuf } }],
  });

  const bg = vec4(0.3921, 0.5843, 0.9294, 1.0); // background

  function render() {
    // Clear + draw 3 cube instances
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
    pass.setVertexBuffer(0, posBuf);
    pass.setVertexBuffer(1, colBuf);
    pass.setIndexBuffer(idxBuf, "uint16");
    pass.drawIndexed(edgeIdx.length, 3); // instanceCount = 3

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  render();
}

window.onload = () => main();
