"use strict";

function buildCircleTriangleList(radius, segments) {
  // triangle-list: (center, p_i, p_{i+1})
  const verts = [];
  const cols = [];

  const cx = 0.0, cy = 0.0;

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;

    const x0 = radius * Math.cos(a0);
    const y0 = radius * Math.sin(a0);

    const x1 = radius * Math.cos(a1);
    const y1 = radius * Math.sin(a1);

    // center
    verts.push(cx, cy);
    cols.push(1.0, 1.0, 1.0);

    // p_i
    verts.push(x0, y0);
    cols.push(1.0, 1.0, 1.0);

    // p_{i+1}
    verts.push(x1, y1);
    cols.push(1.0, 1.0, 1.0);
  }

  return {
    positions: new Float32Array(verts),
    colors: new Float32Array(cols),
    vertexCount: verts.length / 2,
  };
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

  // ---- Circle geometry ----
  const r = 0.60;
  const segments = 120;
  const { positions, colors, vertexCount } = buildCircleTriangleList(r, segments);

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
    arrayStride: 2 * 4,
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
  };

  const colLayout = {
    arrayStride: 3 * 4,
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }],
  };

  // ---- Uniform (vec4 for alignment): offset = (0, ty, 0, 0) ----
  const uniformData = new Float32Array(4);
  const uniformBuffer = device.createBuffer({
    size: uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // ---- Shader ----
  const wgslUrl = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslUrl, { cache: "reload" }).then(r => r.text());
  const shaderModule = device.createShaderModule({ code: wgslCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shaderModule, entryPoint: "main_vs", buffers: [posLayout, colLayout] },
    fragment: { module: shaderModule, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const start = performance.now();

  function render() {
    const t = (performance.now() - start) * 0.001; // seconds

    // "Bouncing" up/down (stable): sinusoid within bounds
    const maxY = 1.0 - r;
    const ty = maxY * Math.sin(t * 2.0); // speed=2 rad/s 

    uniformData[0] = 0.0;
    uniformData[1] = ty;
    uniformData[2] = 0.0;
    uniformData[3] = 0.0;

    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

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
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, posBuffer);
    pass.setVertexBuffer(1, colBuffer);
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
