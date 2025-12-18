"use strict";

function buildCircleTriangleList(radius, segments) {
  // Build a circle as a triangle-list fan: (center, p_i, p_{i+1})
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

    // center vertex
    verts.push(cx, cy);
    cols.push(1.0, 1.0, 1.0);

    // rim vertex i
    verts.push(x0, y0);
    cols.push(1.0, 1.0, 1.0);

    // rim vertex i+1
    verts.push(x1, y1);
    cols.push(1.0, 1.0, 1.0);
  }

  return {
    positions: new Float32Array(verts),
    colors: new Float32Array(cols),
    vertexCount: verts.length / 2, // 2 floats per vertex (x,y)
  };
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

  // Circle geometry (radius in NDC, segment count controls smoothness)
  const r = 0.60;
  const segments = 120;
  const { positions, colors, vertexCount } = buildCircleTriangleList(r, segments);

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

  // Vertex layouts (match shader locations 0 and 1)
  const posLayout = {
    arrayStride: 2 * 4,
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
  };

  const colLayout = {
    arrayStride: 3 * 4,
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }],
  };

  // Uniform buffer (vec4 alignment): offset = (tx, ty, 0, 0)
  const uniformData = new Float32Array(4);
  const uniformBuffer = device.createBuffer({
    size: uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Load WGSL from <script id="wgsl" src="...">
  const wgslUrl = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslUrl, { cache: "reload" }).then(r => r.text());
  const shaderModule = device.createShaderModule({ code: wgslCode });

  // Pipeline: position+color inputs, triangle-list rendering
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shaderModule, entryPoint: "main_vs", buffers: [posLayout, colLayout] },
    fragment: { module: shaderModule, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  // Bind group for the uniform buffer (group 0, binding 0)
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const start = performance.now();

  function render() {
    // Time in seconds since start
    const t = (performance.now() - start) * 0.001;

    // Vertical bounce: keep circle inside [-1,1] by limiting max translation
    const maxY = 1.0 - r;
    const ty = maxY * Math.sin(t * 2.0); // oscillation speed

    // Update uniform (tx=0, ty=ty)
    uniformData[0] = 0.0;
    uniformData[1] = ty;
    uniformData[2] = 0.0;
    uniformData[3] = 0.0;
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    // Encode render pass: clear + draw circle
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
