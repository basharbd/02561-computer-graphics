"use strict";

async function main() {
  if (!navigator.gpu) throw new Error("WebGPU not supported");

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");

  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  // ------------------------------------------------------------
  // Geometry: unit cube (0..1) + wireframe edges as line-list
  // ------------------------------------------------------------
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
    // bottom
    0,1, 1,2, 2,3, 3,0,
    // top
    4,5, 5,6, 6,7, 7,4,
    // verticals
    0,4, 1,5, 2,6, 3,7
  ]);

  // Color per-vertex (black lines)
  const colors = Array.from({ length: positions.length }, () => vec4(0, 0, 0, 1));

  // ------------------------------------------------------------
  // Buffers
  // ------------------------------------------------------------
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

  const posLayout = {
    arrayStride: sizeof["vec3"],
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
  };
  const colLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }],
  };

  // ------------------------------------------------------------
  // Camera + Projection
  // ------------------------------------------------------------
  // Perspective camera (45° vertical fov)
  let P = perspective(45, canvas.width / canvas.height, 0.1, 100.0);

  // WebGPU uses depth in [0,1] (DirectX style). Fix from [-1,1] -> [0,1]
  const depthFix = mat4(
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1
  );
  P = mult(depthFix, P);

  // Camera at origin looking along +Z
  const V = lookAt(vec3(0, 0, 0), vec3(0, 0, 1), vec3(0, 1, 0));

  // Center cube about origin
  const center = translate(-0.5, -0.5, -0.5);

  // Composition tuned to be bigger but not clipped
  const S      = scalem(1.35, 1.35, 1.35);
  const zDist  = 6.3;
  const xGap   = 3.1;
  const yLift  = 0.10;

  // left = three-point (rotate X + rotate Y)
  const M_three = mult(
    translate(-xGap, yLift, zDist),
    mult(rotateY(-45), mult(rotateX(35), mult(S, center)))
  );

  // middle = one-point (no rotation)
  const M_one = mult(
    translate(0, yLift, zDist),
    mult(S, center)
  );

  // right = two-point (rotate Y only)
  const M_two = mult(
    translate(+xGap, yLift, zDist),
    mult(rotateY(45), mult(S, center))
  );

  const MVP = [
    mult(P, mult(V, M_three)),
    mult(P, mult(V, M_one)),
    mult(P, mult(V, M_two)),
  ];

  // ------------------------------------------------------------
  // Uniforms: 3 MVP matrices (instanced draw)
  // ------------------------------------------------------------
  const uBuf = device.createBuffer({
    size: sizeof["mat4"] * 3,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(uBuf, sizeof["mat4"] * 0, flatten(MVP[0]));
  device.queue.writeBuffer(uBuf, sizeof["mat4"] * 1, flatten(MVP[1]));
  device.queue.writeBuffer(uBuf, sizeof["mat4"] * 2, flatten(MVP[2]));

  // ------------------------------------------------------------
  // Shaders + Pipeline
  // ------------------------------------------------------------
  const wgslUrl  = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslUrl, { cache: "reload" }).then(r => r.text());
  const shader   = device.createShaderModule({ code: wgslCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shader,
      entryPoint: "main_vs",
      buffers: [posLayout, colLayout],
    },
    fragment: {
      module: shader,
      entryPoint: "main_fs",
      targets: [{ format }],
    },
    primitive: { topology: "line-list" },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uBuf } }],
  });

  const bg = vec4(0.3921, 0.5843, 0.9294, 1.0); // cornflower

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  function render() {
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
